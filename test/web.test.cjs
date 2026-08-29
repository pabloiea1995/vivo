// La web, de verdad, en un Chromium: se sube una foto, se elige un modo y se
// mira lo que sale — y sobre todo lo que SALE HACIA EL SERVIDOR.
//
// Los dos invariantes que este fichero existe para proteger, y que un refactor
// distraído rompe sin que nada falle en pantalla:
//
//   1. Lo que la página manda a /api/video como `imageBase64` es EXACTAMENTE la
//      foto que se está viendo. Es "el primer fotograma es siempre la imagen",
//      comprobado en el único sitio donde la promesa se puede romper.
//   2. La página manda un `ticket` opaco y NUNCA texto de prompt. El prompting
//      vive en el servidor.
//
// Los proveedores no se tocan: el servidor de pruebas sirve public/ y responde
// él mismo a /api/suggest y /api/video. Sin claves, sin red, sin gastar un euro.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webm': 'video/webm',
};

// Un clip de verdad, grabado por el propio Chromium (test/fixtures). Hace falta
// uno decodificable para poder comprobar lo que de verdad importa del
// reproductor: que el vídeo solo se enciende cuando tiene algo que pintar, con
// la foto debajo hasta ese momento.
const CLIP = path.join(__dirname, 'fixtures', 'clip.webm');

const SUGGEST = {
  source: 'vision',
  subject: 'a dog on a beach',
  costEur: 0.0015,
  modes: [
    { id: 'ai-0', label: 'Brisa',    emoji: '🌬️', surprise: false, ticket: 'tkt-0.mac' },
    { id: 'ai-1', label: 'Marea',    emoji: '🌊', surprise: false, ticket: 'tkt-1.mac' },
    { id: 'ai-2', label: 'Ventisca', emoji: '💨', surprise: false, ticket: 'tkt-2.mac' },
    // Tapada por el servidor: el nombre real va dentro del ticket.
    { id: 'ai-3', label: 'Sorpresa', emoji: '🎲', surprise: true,  ticket: 'tkt-3.mac' },
  ],
};

const received = { suggest: [], video: [], videoAt: [] };

function serve() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clipCostEur: 0.184 }));
      return;
    }
    if (req.url.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        if (req.url === '/api/suggest') {
          received.suggest.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(SUGGEST));
          return;
        }
        received.video.push(body);
        received.videoAt.push(Date.now());
        // Un nombre distinto por ticket, para poder comprobar que cada modo se
        // queda con SU clip y no con el del vecino.
        const names = {
          'tkt-0.mac': 'Brisa', 'tkt-1.mac': 'Marea',
          'tkt-2.mac': 'Ventisca', 'tkt-3.mac': 'Perros voladores',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          video: { url: '/clip.webm' },
          seconds: 5,
          // el nombre real de la sorpresa sale AQUÍ, con el vídeo ya hecho
          mode: names[body.ticket] || 'Desconocido',
          costEur: 0.184,
          prompt: 'Animate the provided photograph. It is literally the first frame…',
        }));
      });
      return;
    }
    const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const full = file === '/clip.webm' ? CLIP : path.join(PUBLIC, file);
    if ((!full.startsWith(PUBLIC) && full !== CLIP) || !fs.existsSync(full)) {
      res.writeHead(404).end('no');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

/** Los directorios de /opt/pw-browsers cambian de número con cada versión. */
function glob(dir, prefix, tail) {
  try {
    return fs.readdirSync(dir).filter((d) => prefix.test(d)).map((d) => path.join(dir, d, tail));
  } catch {
    return [];
  }
}

let fails = 0;
const ok = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + JSON.stringify(extra)?.slice(0, 200)}`);
  if (!cond) fails++;
};

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    // A propósito fuera de package.json: el postinstall de playwright se
    // descarga los navegadores, y Vercel instala devDependencies en cada build.
    console.log('SKIP  prueba de navegador (npm i -D playwright para activarla)');
    return;
  }

  const server = await serve();
  const base = `http://localhost:${server.address().port}`;
  // El Chromium del entorno puede no ser el que espera esta versión de
  // playwright, así que se apunta al binario que hay. VIVO_CHROME lo sobreescribe.
  const candidates = [
    process.env.VIVO_CHROME,
    ...glob('/opt/pw-browsers', /^chromium-/, 'chrome-linux/chrome'),
  ].filter(Boolean);
  const executablePath = candidates.find((p) => fs.existsSync(p));
  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (err) {
    console.log(`SKIP  sin Chromium utilizable (${String(err).split('\n')[0]})`);
    server.close();
    return;
  }
  // Un móvil: es donde vive esto, y el carrusel depende del ancho.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(base);
  ok('la portada arranca en la puerta', await page.isVisible('#gate'));
  ok('sin cámara no hay control de zoom', !(await page.isVisible('#zoom')));

  // Una foto de verdad, generada en el navegador: la ruta de subida usa el mismo
  // recorte que la cámara, así que prueba el mismo código.
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1600);
    g.addColorStop(0, '#ff9a3c'); g.addColorStop(1, '#12324f');
    x.fillStyle = g; x.fillRect(0, 0, 900, 1600);
    x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif';
    x.fillText('VIVO', 300, 820);
    return c.toDataURL('image/jpeg', 0.9);
  });
  const buffer = Buffer.from(jpeg.slice(jpeg.indexOf(',') + 1), 'base64');
  await page.setInputFiles('#upload', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer });

  await page.waitForSelector('.mode:not(.skeleton)', { timeout: 10000 });
  ok('una sola llamada de visión', received.suggest.length === 1, received.suggest.length);
  ok('la web no manda texto de prompt', !JSON.stringify(received.suggest[0]).match(/motion|prompt/i));

  const labels = await page.$$eval('.mode .name', (n) => n.map((e) => e.textContent));
  ok('cuatro modos + el chip ×4', labels.length === 5 && labels[4] === '×4', labels);
  ok('etiquetas del modelo', labels.slice(0, 3).join(',') === 'Brisa,Marea,Ventisca', labels);
  ok('la sorpresa va tapada', labels[3] === 'Sorpresa' &&
     (await page.$eval('.mode.surprise .disc', (e) => e.textContent)) === '🎲', labels[3]);
  ok('la foto se ve debajo', await page.isVisible('#shot'));
  ok('ningún modo nace con vídeo', (await page.$$('.mode.has-clip')).length === 0);

  // ── deslizar cambia de modo ──
  const selected = () => page.$$eval('.mode', (n) => n.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
  const swipe = async (dx) => {
    const box = await page.$eval('#frame', (e) => {
      const r = e.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx + dx, box.cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  };

  await swipe(-120);
  ok('deslizar a la izquierda avanza un modo', (await selected()) === 1, await selected());
  await swipe(-120);
  ok('...y otra vez', (await selected()) === 2, await selected());
  await swipe(120);
  ok('deslizar a la derecha retrocede', (await selected()) === 1, await selected());
  ok('deslizar no genera nada', received.video.length === 0, received.video.length);

  // ── generar uno ──
  await page.click('#shutter');
  await page.waitForSelector('.mode.has-clip', { timeout: 15000 });
  ok('un solo clip pedido', received.video.length === 1, received.video.length);
  const sent = received.video[0];
  ok('viaja el ticket del modo seleccionado', sent?.ticket === 'tkt-1.mac', sent?.ticket);
  ok('la web NO escribe el prompt', !sent?.prompt && !sent?.motion, Object.keys(sent || {}));

  // ── el invariante ──
  const shown = await page.$eval('#shot', (e) => e.src);
  ok('EL PRIMER FOTOGRAMA ES LA FOTO QUE SE VE',
     shown === `data:image/jpeg;base64,${sent.imageBase64}`,
     { shown: shown.slice(0, 48), sent: sent.imageBase64?.slice(0, 32) });

  const dims = await page.evaluate((b64) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.src = `data:image/jpeg;base64,${b64}`;
  }), sent.imageBase64);
  const frame = await page.$eval('#frame', (e) => {
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  ok('recortada a la proporción del encuadre visible',
     Math.abs(dims.w / dims.h - frame.w / frame.h) < 0.01, { dims, frame });
  ok('y al tamaño de subida', Math.max(dims.w, dims.h) === 1280, dims);

  await page.waitForSelector('#clip.ready', { timeout: 10000 });
  ok('el clip se enciende al estar listo y suena mudo',
     await page.$eval('#clip', (e) => e.classList.contains('ready') && !e.paused && e.muted));
  ok('la foto sigue debajo del clip', await page.isVisible('#shot'));
  ok('solo ese modo queda marcado', (await page.$$('.mode.has-clip')).length === 1);
  ok('el nombre real sale al terminar', (await page.textContent('#status')).includes('Marea'),
     await page.textContent('#status'));

  // ── deslizar a un modo CON vídeo lo reproduce solo, desde el principio ──
  //
  // Se le deja avanzar 1,5 s a propósito: el margen tiene que ser mayor que lo
  // que el propio gesto tarda, o la comprobación mide la reproducción nueva en
  // vez del rebobinado.
  await page.waitForTimeout(1500);
  const before = await page.$eval('#clip', (e) => e.currentTime);
  ok('el clip avanza', before > 1, before);
  await swipe(120);                            // a un modo sin vídeo
  ok('en un modo sin vídeo el clip se oculta', !(await page.isVisible('#clip')));
  ok('...y se queda parado', await page.$eval('#clip', (e) => e.paused));
  await swipe(-120);                           // de vuelta al que sí lo tiene
  ok('volver a un modo con vídeo lo reproduce solo',
     await page.$eval('#clip', (e) => !e.paused));
  const after = await page.$eval('#clip', (e) => e.currentTime);
  ok('...y desde el primer fotograma', after < before - 0.5, { antes: before, ahora: after });

  // ── el chip ×4 ──
  await page.click('.mode.all');
  await page.waitForTimeout(450);
  const status = await page.textContent('#status');
  ok('el ×4 avisa de lo que cuesta antes de tocarlo', /3 que faltan.*0[.,]55/.test(status), status);

  await page.click('#shutter');
  await page.waitForFunction(() => document.querySelectorAll('.mode.has-clip').length === 4, null,
    { timeout: 30000 });
  ok('el ×4 genera los que faltan y solo esos', received.video.length === 4, received.video.length);
  ok('...en paralelo, no en cola', (() => {
    // los tres del ×4 tienen que haber salido casi a la vez
    const t = received.videoAt.slice(1);
    return t[t.length - 1] - t[0] < 400;
  })(), received.videoAt);
  ok('...y cada uno con su ticket', new Set(received.video.map((v) => v.ticket)).size === 4,
     received.video.map((v) => v.ticket));
  ok('...sobre la MISMA foto', received.video.every((v) => v.imageBase64 === sent.imageBase64));
  ok('al acabar salta al primero', (await selected()) === 0, await selected());
  await page.waitForSelector('#clip.ready', { timeout: 10000 });
  ok('y se reproduce', await page.$eval('#clip', (e) => !e.paused));

  await page.click('.mode.all');
  await page.waitForTimeout(300);
  ok('con los cuatro hechos, el ×4 lo dice',
     (await page.textContent('#status')).includes('cuatro est'), await page.textContent('#status'));

  // ── persistencia ──
  await page.reload();
  await page.waitForSelector('.mode.has-clip', { timeout: 10000 });
  ok('al recargar NO vuelve a la puerta', !(await page.isVisible('#gate')));
  ok('los cuatro vídeos siguen ahí', (await page.$$('.mode.has-clip')).length === 4,
     (await page.$$('.mode.has-clip')).length);
  ok('...sin haber generado ni uno más', received.video.length === 4, received.video.length);
  ok('...ni haber vuelto a llamar a la visión', received.suggest.length === 1, received.suggest.length);
  ok('la misma foto', await page.$eval('#shot', (e) => e.src) === shown);
  await page.waitForSelector('#clip.ready', { timeout: 10000 });
  ok('y se reproduce el primero', await page.$eval('#clip', (e) => !e.paused));

  ok('sin errores de JavaScript', errors.length === 0, errors);

  const shots = process.env.VIVO_SHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'play.png') });
    await page.click('.mode.all');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, 'pick.png') });
    console.log(`      capturas en ${shots}`);
  }

  await browser.close();
  server.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall green');
  process.exit(fails ? 1 : 0);
})();

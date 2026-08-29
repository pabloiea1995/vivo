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

const received = { suggest: [], video: [] };

function serve() {
  const server = http.createServer((req, res) => {
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          video: { url: '/clip.webm' },
          seconds: 5,
          // el nombre real de la sorpresa sale AQUÍ, con el vídeo ya hecho
          mode: 'Perros voladores',
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
  // El indicador de zoom solo existe si la cámara lo permite; aquí no hay
  // cámara, así que no debe verse ni romper nada al pintar el estado.
  ok('sin cámara no hay control de zoom', !(await page.isVisible('#zoom')));

  // Una foto de verdad, generada en el propio navegador: la ruta de subida usa
  // el mismo recorte 9:16 que la cámara, así que prueba el mismo código.
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
  ok('cuatro modos', labels.length === 4, labels);
  ok('etiquetas del modelo', labels.slice(0, 3).join(',') === 'Brisa,Marea,Ventisca', labels);
  ok('la sorpresa va tapada', labels[3] === 'Sorpresa' &&
     (await page.$eval('.mode.surprise .disc', (e) => e.textContent)) === '🎲', labels[3]);
  ok('el primero nace elegido', await page.$eval('.mode', (e) => e.getAttribute('aria-selected')) === 'true');
  ok('la foto se ve debajo', await page.isVisible('#shot'));

  // Elegir por toque: el chip no centrado se centra, no se aplica.
  await page.click('.mode:nth-child(3)'); // :nth-child cuenta el ::before? no: los espaciadores son pseudoelementos
  await page.waitForTimeout(600);
  const selected = await page.$$eval('.mode', (n) => n.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
  ok('tocar un chip lo selecciona sin animar', selected === 2 && received.video.length === 0, { selected, video: received.video.length });

  // La sorpresa, y con ella la comprobación que importa.
  await page.click('.mode.surprise');
  await page.waitForTimeout(600);
  await page.click('#shutter');
  await page.waitForSelector('#again:not([hidden])', { timeout: 15000 });

  const sent = received.video[0];
  ok('un solo clip pedido', received.video.length === 1, received.video.length);
  ok('viaja el ticket de la sorpresa', sent?.ticket === 'tkt-3.mac', sent?.ticket);
  ok('la web NO escribe el prompt', !sent?.prompt && !sent?.motion && !sent?.modeId, Object.keys(sent || {}));

  // ── el invariante ──
  const shown = await page.$eval('#shot', (e) => e.src);
  ok('EL PRIMER FOTOGRAMA ES LA FOTO QUE SE VE',
     shown === `data:image/jpeg;base64,${sent.imageBase64}`,
     { shown: shown.slice(0, 48), sent: sent.imageBase64?.slice(0, 32) });

  // El recorte es EL DEL HUECO QUE SE VE, no el de la imagen original: la
  // proporción la fija la pantalla (390×844 aquí), no una constante.
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
  ok('cabe de sobra en el cuerpo de la función', sent.imageBase64.length < 4_000_000, sent.imageBase64.length);

  ok('la sorpresa se revela al final', (await page.textContent('#status')).includes('Perros voladores'),
     await page.textContent('#status'));
  ok('y con su coste', (await page.textContent('#status')).includes('0.18'), await page.textContent('#status'));
  ok('el prompt es consultable', await page.isVisible('#peek'));
  // El relevo. La foto NO se quita nunca: se queda debajo, y el vídeo se
  // enciende encima cuando el decodificador ya tiene algo que pintar. Es la
  // diferencia entre "mi foto se ha movido" y un parpadeo a negro en medio.
  ok('la foto sigue debajo del clip', await page.isVisible('#shot'));
  await page.waitForSelector('#clip.ready', { timeout: 10000 }).catch(() => {});
  ok('el clip se enciende al estar listo', await page.$eval('#clip', (e) => e.classList.contains('ready')));
  ok('y arranca solo y mudo', await page.$eval('#clip', (e) => !e.paused && e.muted));

  await page.click('#peek');
  ok('el prompt es el que compuso el servidor',
     (await page.textContent('#sheetBody')).includes('first frame'), await page.textContent('#sheetBody'));
  await page.click('#sheet');

  // Otro modo sobre la misma foto: un clip más, NI UNA visión más.
  await page.click('#again');
  await page.waitForTimeout(300);
  await page.click('.mode:nth-child(1)');
  await page.waitForTimeout(600);
  await page.click('#shutter');
  await page.waitForSelector('#again:not([hidden])', { timeout: 15000 });
  ok('otro modo no vuelve a llamar a la visión', received.suggest.length === 1, received.suggest.length);
  ok('y reutiliza la MISMA foto',
     received.video[1]?.imageBase64 === sent.imageBase64 && received.video[1]?.ticket === 'tkt-0.mac',
     received.video[1]?.ticket);

  ok('sin errores de JavaScript', errors.length === 0, errors);

  const shots = process.env.VIVO_SHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'play.png') });
    await page.click('#again');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'pick.png') });
    console.log(`      capturas en ${shots}`);
  }

  await browser.close();
  server.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall green');
  process.exit(fails ? 1 : 0);
})();

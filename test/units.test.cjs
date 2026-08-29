// Las piezas sueltas del backend: el ticket firmado, las guardas del prompt,
// la aritmética del precio y la validación de la foto.
//
// Corre contra el JavaScript compilado (`npm test` lo genera en .tmp/), no
// contra los .ts, para probar exactamente lo que se despliega.
process.env.VIVO_TICKET_SECRET = 'test-secret-at-least-16-chars';
const BUILD = '../.tmp/build/';
const { signTicket, verifyTicket } = require(BUILD + '_ticket');
const { buildVideoPrompt } = require(BUILD + '_videoPrompts');
const { videoMicros, microsToEur, textCostMicros, isKnownVideoModel } = require(BUILD + '_pricing');
const { readPhoto } = require(BUILD + '_http');

let fails = 0;
const ok = (name, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + extra}`); if (!cond) fails++; };

// --- ticket ---
// Web Crypto es asíncrono, así que esta parte va dentro de una función.
async function ticketChecks() {
const t = await signTicket({ motion: 'rain falls', intensity: 'wild', label: 'Diluvio' });
const v = await verifyTicket(t);
ok('ticket round-trip', v && v.motion === 'rain falls' && v.intensity === 'wild' && v.label === 'Diluvio', JSON.stringify(v));
ok('ticket rejects tampered payload', (await verifyTicket('x' + t)) === null);
const [body, mac] = t.split('.');
const forged = Buffer.from(JSON.stringify({ motion: 'anything I want', intensity: 'wild', label: 'x', exp: Date.now() + 1e6 })).toString('base64url');
ok('ticket rejects forged payload with old mac', (await verifyTicket(`${forged}.${mac}`)) === null);
ok('ticket rejects garbage',
   (await verifyTicket('nope')) === null && (await verifyTicket(null)) === null && (await verifyTicket(123)) === null);
ok('ticket rejects bad intensity',
   (await verifyTicket(await signTicket({ motion: 'm', intensity: 'nope', label: 'l' }))) === null);

// La regresión que costó un despliegue: /api/suggest y /api/video son DOS
// funciones serverless, así que nunca comparten proceso. Se simula recargando
// el módulo — si la clave no se deriva de algo estable del entorno, el ticket
// firmado por la primera instancia no verifica en la segunda y el usuario ve
// "ese modo ha caducado" en todos los intentos.
async function crossInstance(env, expectValid) {
  const before = { ...process.env };
  Object.assign(process.env, env);
  const path = require.resolve(BUILD + '_ticket');

  delete require.cache[path];
  const a = require(BUILD + '_ticket');
  const ticket = await a.signTicket({ motion: 'rain', intensity: 'wild', label: 'L' });

  delete require.cache[path];
  const b = require(BUILD + '_ticket');
  const seen = await b.verifyTicket(ticket);

  delete require.cache[path];
  process.env = before;
  return !!seen === expectValid;
}

ok('un ticket cruza de una función a otra con VIVO_TICKET_SECRET',
   await crossInstance({ VIVO_TICKET_SECRET: 'un-secreto-bastante-largo', FALAI_TOKEN: '', OPENAI_API_KEY: '' }, true));
ok('...y también solo con la clave de fal, que es la que siempre está',
   await crossInstance({ VIVO_TICKET_SECRET: '', FALAI_TOKEN: 'fal-abc123', OPENAI_API_KEY: '' }, true));
ok('...y con la de OpenAI si no hay otra',
   await crossInstance({ VIVO_TICKET_SECRET: '', FALAI_TOKEN: '', FAL_KEY: '', OPENAI_API_KEY: 'sk-abc' }, true));
ok('dos despliegues con secretos distintos NO se entienden',
   await (async () => {
     const before = { ...process.env };
     const path = require.resolve(BUILD + '_ticket');
     process.env.VIVO_TICKET_SECRET = 'secreto-numero-uno-largo';
     delete require.cache[path];
     const t = await require(BUILD + '_ticket').signTicket({ motion: 'm', intensity: 'wild', label: 'L' });
     process.env.VIVO_TICKET_SECRET = 'secreto-numero-dos-largo';
     delete require.cache[path];
     const seen = await require(BUILD + '_ticket').verifyTicket(t);
     delete require.cache[path];
     process.env = before;
     return seen === null;
   })());
}

// --- prompts ---
function syncChecks() {
const p = buildVideoPrompt({ motion: 'The dog blinks.', intensity: 'subtle' });
ok('prompt names the first frame', /first frame/i.test(p), p.slice(0, 80));
ok('prompt forbids speech', /no speech/i.test(p));
ok('wild deja oír el evento', /let the event be heard/i.test(buildVideoPrompt({ motion: 'm', intensity: 'wild' })));
ok('...pero sigue sin voz', /no speech/i.test(buildVideoPrompt({ motion: 'm', intensity: 'wild' })));
ok('subtle mantiene el ambiente quieto', /nothing more/i.test(p));
ok('prompt guards identity', /keeps its exact appearance/i.test(p));
ok('subtle pins the camera', /camera does not move/i.test(p));

// La línea que separa las dos guardas, y que hace posible medio catálogo: la
// identidad no se toca NUNCA, pero lo que puede aparecer sí escala.
const wild = buildVideoPrompt({ motion: 'a mothership arrives', intensity: 'wild' });
ok('subtle no deja entrar nada nuevo', /Nothing new enters the frame/i.test(p));
ok('wild SÍ deja entrar cosas nuevas', /New elements MAY enter/i.test(wild), wild.slice(0, 80));
ok('wild afloja la física', /Physics is optional/i.test(wild));
ok('...pero la identidad se guarda igual en wild', /keeps its exact appearance/i.test(wild));
ok('...y el encuadre tambien', /stays one continuous shot/i.test(wild));
ok('cinematic solo trae lo que cae del cielo',
   /belong to the sky/i.test(buildVideoPrompt({ motion: 'm', intensity: 'cinematic' })));
let threw = false; try { buildVideoPrompt({ motion: '  ', intensity: 'subtle' }); } catch { threw = true; }
ok('empty motion throws', threw);

// --- pricing ---
const promo = new Date(Date.UTC(2026, 7, 20));
const after = new Date(Date.UTC(2026, 8, 2));
ok('5s@768P promo = $0.20', videoMicros('minimax/h3-max/image-to-video', 5, '768P', promo) === 200000, videoMicros('minimax/h3-max/image-to-video', 5, '768P', promo));
ok('5s@768P list = $0.40', videoMicros('minimax/h3-max/image-to-video', 5, '768P', after) === 400000);
ok('lowercase 768p normalises', videoMicros('minimax/h3-max/image-to-video', 5, '768p', promo) === 200000);
ok('unknown resolution charges the dearest', videoMicros('minimax/h3-max/image-to-video', 5, '2K', promo) === 200000);
ok('unknown model costs 0 (and is not allowed)', videoMicros('some/other/model', 5, '768P') === 0 && !isKnownVideoModel('some/other/model'));
ok('eur conversion', Math.abs(microsToEur(200000) - 0.184) < 1e-9, microsToEur(200000));
ok('text cost prices luna', textCostMicros({ model: 'gpt-5.6-luna-2026-08-01', usage: { prompt_tokens: 1000, completion_tokens: 200 } }, 'gpt-5.6-luna') === 2200, textCostMicros({ model: 'gpt-5.6-luna', usage: { prompt_tokens: 1000, completion_tokens: 200 } }, 'gpt-5.6-luna'));

// --- photo validation ---
const big = 'A'.repeat(600);
ok('accepts bare base64', readPhoto(big).ok);
ok('accepts data uri', readPhoto('data:image/jpeg;base64,' + big).ok);
ok('rejects empty', readPhoto('').code === 'missing_image');
ok('rejects non-base64', readPhoto('<script>'.padEnd(600, 'x')).code === 'invalid_image');
ok('rejects oversize', readPhoto('A'.repeat(4_000_001)).code === 'image_too_large');
ok('rejects tiny', readPhoto('AAAA').code === 'invalid_image');

}

(async () => {
  await ticketChecks();
  syncChecks();
  console.log(fails ? `\n${fails} FAILED` : '\nall green');
  process.exit(fails ? 1 : 0);
})();

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
const t = signTicket({ motion: 'rain falls', intensity: 'wild', label: 'Diluvio' });
const v = verifyTicket(t);
ok('ticket round-trip', v && v.motion === 'rain falls' && v.intensity === 'wild' && v.label === 'Diluvio', JSON.stringify(v));
ok('ticket rejects tampered payload', verifyTicket('x' + t) === null);
const [body, mac] = t.split('.');
const forged = Buffer.from(JSON.stringify({ motion: 'anything I want', intensity: 'wild', label: 'x', exp: Date.now() + 1e6 })).toString('base64url');
ok('ticket rejects forged payload with old mac', verifyTicket(`${forged}.${mac}`) === null);
ok('ticket rejects garbage', verifyTicket('nope') === null && verifyTicket(null) === null && verifyTicket(123) === null);
ok('ticket rejects bad intensity', verifyTicket(signTicket({ motion: 'm', intensity: 'nope', label: 'l' })) === null);

// --- prompts ---
const p = buildVideoPrompt({ motion: 'The dog blinks.', intensity: 'subtle' });
ok('prompt names the first frame', /first frame/i.test(p), p.slice(0, 80));
ok('prompt forbids speech', /no speech/i.test(p));
ok('prompt guards identity', /same person/i.test(p));
ok('subtle pins the camera', /camera does not move/i.test(p));
ok('wild loosens physics', /impossibly/i.test(buildVideoPrompt({ motion: 'm', intensity: 'wild' })));
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

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);

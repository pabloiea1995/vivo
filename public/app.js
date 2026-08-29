// Vivo — una pantalla, y un carrusel de modos que se recorre con el dedo.
//
//   live ──disparo──▶ thinking ──GPT──▶ browse ⇄ (generar un modo)
//    ▲                                    │
//    └──────────── nueva foto ────────────┘
//
// El cambio que ordena el resto: **elegir y ver dejaron de ser dos estados**.
// Antes se elegía un modo, se generaba, se veía el vídeo y para probar otro
// había que volver atrás. Ahora siempre estás SOBRE un modo: si ya tiene vídeo
// se reproduce, y si no, el disparador lo genera. Deslizar cambia de modo, y
// eso convierte cuatro clips en algo que se recorre como un carrete.
//
// Lo que hace que funcione es que la foto no se mueve nunca. Está debajo de
// todo, es el primer fotograma de los cuatro clips, y por eso pasar de uno a
// otro no parpadea: lo único que cambia es lo que ocurre a partir del segundo
// cero.

import { clipKey, deleteClip, loadClip, loadSession, saveClip, saveSession } from '/store.js';

const $ = (id) => document.getElementById(id);

const el = {
  frame: $('frame'), preview: $('preview'), shot: $('shot'), clip: $('clip'),
  veil: $('veil'), veilLabel: $('veilLabel'), veilHint: $('veilHint'),
  flip: $('flip'), mute: $('mute'), zoom: $('zoom'), peek: $('peek'),
  gate: $('gate'), start: $('start'), upload: $('upload'), gateError: $('gateError'),
  status: $('status'), carousel: $('carousel'),
  fresh: $('fresh'), reroll: $('reroll'),
  shutter: $('shutter'), core: $('shutterCore'),
  sheet: $('sheet'), sheetTitle: $('sheetTitle'), sheetBody: $('sheetBody'),
};

// El chip de "genera los cuatro". No es un modo: es una acción que vive al
// final del carrusel porque es donde el pulgar llega después de haber visto
// las otras opciones y haber dudado.
const ALL = '__all__';

const S = {
  stage: 'idle',        // idle | live | thinking | browse
  facing: 'environment',
  stream: null,
  zoom: null,
  photo: null,          // { id, dataUrl }
  modes: [],            // + { key, clip?, busy?, failed? }
  index: 0,
  muted: true,
  clipCostEur: null,    // lo dice /api/health; sirve para avisar de lo que cuesta el ×4
};

const photoBase64 = () => S.photo.dataUrl.slice(S.photo.dataUrl.indexOf(',') + 1);

// ─── El backend ──────────────────────────────────────────────────────────────
//
// El único sitio que habla con la API. Y fíjate en lo que no hay: ni una línea
// de texto en inglés dirigida a un modelo. La web manda datos (una foto, un
// idioma, un ticket) y el servidor compone el prompt.

const KEY_STORE = 'vivo.key';
const appKey = (() => {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('key');
  if (fromUrl) {
    try { localStorage.setItem(KEY_STORE, fromUrl); } catch {}
    url.searchParams.delete('key');
    history.replaceState(null, '', url.pathname + url.search);
    return fromUrl;
  }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
})();

const MESSAGES = {
  content_blocked: 'Esta foto no se puede animar: no cumple las normas de contenido.',
  image_too_large: 'La foto es demasiado grande.',
  invalid_mode: 'Este modo ha caducado. Pide otras ideas.',
  fal_key_missing: 'El servidor no tiene configurada la clave de vídeo.',
  upstream_error: 'El generador de vídeo ha fallado. Inténtalo otra vez.',
  forbidden: 'Esta página no tiene acceso al servidor.',
  timeout: 'Ha tardado demasiado.',
  network: 'Sin conexión con el servidor.',
};

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function post(path, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(appKey ? { 'x-vivo-key': appKey } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    const code = err?.name === 'AbortError' ? 'timeout' : 'network';
    throw new ApiError(code, MESSAGES[code]);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const code = data.code || data.error || `http_${res.status}`;
    throw new ApiError(code, data.detail || MESSAGES[code] || 'Algo ha salido mal.');
  }
  return res.json();
}

const suggestModes = (base64) =>
  // Holgado respecto al tope del servidor (15 s): si el cliente cortase antes,
  // el usuario vería "sin conexión" cuando lo que hay es un modelo pensando.
  post('/api/suggest', { imageBase64: base64, locale: navigator.language?.slice(0, 2) || 'es' }, 30000);

const animate = (base64, mode) =>
  post('/api/video', mode.ticket ? { imageBase64: base64, ticket: mode.ticket }
                                 : { imageBase64: base64, modeId: mode.id },
       // Generoso: la inferencia son ~3 s, pero con el ×4 hay cuatro clips en
       // vuelo a la vez y la cola de fal se nota.
       180000);

// Cuánto cuesta un clip, para poder avisar antes del ×4. Es lo único que la
// página le pregunta al servidor sin que el usuario haya hecho nada, y falla
// en silencio: si no llega, el aviso sale sin cifra.
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => { S.clipCostEur = h?.clipCostEur ?? null; paint(); })
  .catch(() => {});

// ─── La cámara ───────────────────────────────────────────────────────────────

const frameAspect = () => {
  const box = el.frame.getBoundingClientRect();
  return box.width && box.height ? box.width / box.height : 9 / 16;
};

async function openCamera() {
  stopCamera();
  // Se pide la PROPORCIÓN de la pantalla, no una resolución: pedir 1080×1920
  // hace que el navegador recorte el sensor apaisado al centro, que es zoom
  // digital disfrazado (ver el historial de este fichero).
  S.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: S.facing, aspectRatio: { ideal: frameAspect() } },
    audio: false,
  });
  el.preview.srcObject = S.stream;
  el.preview.classList.toggle('mirrored', S.facing === 'user');
  await el.preview.play().catch(() => {});
  readZoom();
}

function stopCamera() {
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
  S.zoom = null;
}

// ─── Zoom ────────────────────────────────────────────────────────────────────

const track = () => S.stream?.getVideoTracks?.()[0] || null;

function readZoom() {
  const caps = track()?.getCapabilities?.() || {};
  S.zoom = caps.zoom
    ? { min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 1, value: track().getSettings?.().zoom ?? caps.zoom.min ?? 1 }
    : null;
  if (S.zoom && S.zoom.max <= S.zoom.min) S.zoom = null;
  paintZoom();
}

async function setZoom(v) {
  if (!S.zoom) return;
  const value = Math.min(S.zoom.max, Math.max(S.zoom.min, v));
  if (Math.abs(value - S.zoom.value) < 0.01) return;
  try {
    await track().applyConstraints({ advanced: [{ zoom: value }] });
    S.zoom.value = value;
    paintZoom();
  } catch { /* el dispositivo lo ha rechazado */ }
}

function paintZoom() {
  const on = !!S.zoom && S.stage === 'live';
  el.zoom.hidden = !on;
  if (on) el.zoom.textContent = `${(S.zoom.value / S.zoom.min).toFixed(1)}×`;
}

// ─── Gestos sobre el encuadre ────────────────────────────────────────────────
//
// Dos dedos: zoom. Un dedo que se arrastra: cambiar de modo. Un dedo que no se
// mueve: pausar o seguir. Los tres con eventos de puntero, así que el mismo
// código sirve para dedo, ratón y trackpad.

const pointers = new Map();
let pinchStart = null;
let swipe = null;

// Cuánto hay que arrastrar para que cuente. Por debajo de esto la gente cambia
// de modo sin querer al tocar para pausar, que es de las cosas que más molestan
// de una interfaz por gestos.
const SWIPE_PX = 45;

el.frame.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, e);
  if (pointers.size === 2 && S.stage === 'live') {
    pinchStart = { span: pinchSpan(), zoom: S.zoom?.value ?? 1 };
    swipe = null;
  } else if (pointers.size === 1) {
    swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
  }
});

el.frame.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, e);
  if (pointers.size === 2 && pinchStart && S.zoom) {
    e.preventDefault();
    setZoom(pinchStart.zoom * (pinchSpan() / pinchStart.span));
  }
});

el.frame.addEventListener('pointerup', (e) => {
  const start = pointers.size === 1 ? swipe : null;
  endPointer(e);
  if (!start || S.stage !== 'browse') return;

  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  // Horizontal de verdad: un arrastre en diagonal es casi siempre un intento de
  // desplazar la página, no de cambiar de modo.
  if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
    goTo(S.index + (dx < 0 ? 1 : -1));
  } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    togglePlay();
  }
});

const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) swipe = null;
};
el.frame.addEventListener('pointercancel', endPointer);

// Sin esto no hay gesto que valga, y el fallo es de los que se diagnostican mal.
//
// La foto es un <img>, y arrastrar una imagen inicia el drag-and-drop nativo del
// navegador. Cuando eso pasa, el sistema se queda el puntero y a nosotros nos
// llega `pointercancel` en vez de `pointerup`: el swipe simplemente NO ocurre,
// sin ningún error en consola. El CSS lo evita en la mayoría de los casos y esto
// cierra los que quedan (arrastres que empiezan sobre el vídeo, por ejemplo).
el.frame.addEventListener('dragstart', (e) => e.preventDefault());

function pinchSpan() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
}

// ─── La captura ──────────────────────────────────────────────────────────────
//
// Lo que se ve es lo que se manda: el preview va con `object-fit: cover`, así
// que aquí se reproduce ESE mismo recorte contra la proporción real del hueco.

const LONG_SIDE = 1280;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function coverCrop(w, h, aspect) {
  if (w / h > aspect) {
    const sw = h * aspect;
    return { sx: (w - sw) / 2, sy: 0, sw, sh: h };
  }
  const sh = w / aspect;
  return { sx: 0, sy: (h - sh) / 2, sw: w, sh };
}

function grab(source, w, h, mirror) {
  const aspect = frameAspect();
  const out = aspect >= 1
    ? { w: LONG_SIDE, h: even(LONG_SIDE / aspect) }
    : { w: even(LONG_SIDE * aspect), h: LONG_SIDE };

  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (mirror) { ctx.translate(out.w, 0); ctx.scale(-1, 1); }
  const { sx, sy, sw, sh } = coverCrop(w, h, aspect);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.w, out.h);
  return canvas.toDataURL('image/jpeg', 0.72);
}

// ─── El carrusel ─────────────────────────────────────────────────────────────

const chips = () => [...el.carousel.querySelectorAll('.mode')];
const current = () => S.modes[S.index] || null;   // null = el chip ×4
const pending = () => S.modes.filter((m) => !m.clip && !m.busy);

function renderModes() {
  el.carousel.className = 'carousel';
  el.carousel.innerHTML = '';

  S.modes.forEach((mode, i) => el.carousel.appendChild(chip(mode, i)));

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'mode all';
  all.dataset.key = ALL;
  all.innerHTML = '<span class="disc"></span><span class="name"></span>';
  all.querySelector('.disc').textContent = '⚡';
  all.querySelector('.name').textContent = '×4';
  all.addEventListener('click', () => (S.index === S.modes.length ? generateAll() : goTo(S.modes.length)));
  el.carousel.appendChild(all);

  paint();
}

function chip(mode, i) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `mode${mode.surprise ? ' surprise' : ''}`;
  btn.dataset.key = mode.key;
  btn.innerHTML = '<span class="disc"></span><span class="name"></span>';
  // textContent y no innerHTML: la etiqueta la escribe un modelo.
  btn.querySelector('.disc').textContent = mode.emoji;
  btn.querySelector('.name').textContent = mode.label;
  // Tocar un chip lo trae al centro; tocar el que YA está en el centro lo
  // aplica — genera si no hay vídeo, y lo rebobina si lo hay.
  btn.addEventListener('click', () => (i === S.index ? act() : goTo(i)));
  return btn;
}

function renderSkeleton() {
  el.carousel.className = 'carousel locked';
  el.carousel.innerHTML = Array.from({ length: 5 })
    .map(() => '<span class="mode skeleton"><span class="disc"></span><span class="name"></span></span>')
    .join('');
}

function renderHint(text) {
  el.carousel.className = 'carousel locked';
  el.carousel.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  el.carousel.appendChild(p);
}

// Mientras el carrusel se está colocando SOLO, su scroll no significa nada.
//
// Sin esto hay una pelea: `goTo` fija el modo y lanza un desplazamiento suave,
// el manejador de scroll se dispara a mitad de animación, mide que el chip del
// centro todavía es el anterior y deshace la selección; el desplazamiento sigue,
// vuelve a medir, y el modo oscila entre dos hasta que la animación acaba. En
// pantalla se veía como que deslizar "a veces" no rebobinaba el vídeo.
let settling = false;
let settleTimer = 0;

function markSettling() {
  settling = true;
  clearTimeout(settleTimer);
  // Red de seguridad: `scrollend` no existe en todos los navegadores, y sin
  // ella una animación que no termine dejaría el carrusel sordo para siempre.
  settleTimer = setTimeout(() => (settling = false), 700);
}

el.carousel.addEventListener('scrollend', () => {
  clearTimeout(settleTimer);
  settling = false;
});

/** Cambia de modo: centra el chip, pinta y arranca el vídeo si lo hay. */
function goTo(i) {
  const max = S.modes.length; // el ×4 ocupa la última posición
  const next = Math.max(0, Math.min(max, i));
  const moved = next !== S.index;
  S.index = next;
  markSettling();
  chips()[next]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  paint();
  show({ restart: moved });
}

// El chip del centro es el elegido. Se mide por posición real y no por
// aritmética de anchos: con los espaciadores y el `gap`, la cuenta se
// desincroniza en cuanto cambia un tamaño.
function nearest() {
  const box = el.carousel.getBoundingClientRect();
  const mid = box.left + box.width / 2;
  let best = 0, bestDist = Infinity;
  chips().forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

let scrollTick = 0;
el.carousel.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
    if (S.stage !== 'browse' || settling) return;
    const i = nearest();
    // Aquí NO se llama a goTo: goTo desplaza el carrusel, y desplazar desde el
    // manejador de scroll es una pelea con el dedo del usuario.
    if (i !== S.index) {
      S.index = i;
      paint();
      show({ restart: true });
    }
  });
});

// ─── El vídeo ────────────────────────────────────────────────────────────────

/**
 * Enseña lo que toque para el modo seleccionado.
 *
 * `restart: true` rebobina al segundo cero, que es lo que se quiere al cambiar
 * de modo: los cuatro clips arrancan en el MISMO fotograma —la foto—, así que
 * pasar de uno a otro se lee como cuatro futuros del mismo instante, no como
 * cuatro vídeos sueltos. Si no se rebobinase, volver a un clip lo retomaría por
 * la mitad y esa lectura se pierde.
 */
function show({ restart = false } = {}) {
  const mode = current();
  if (!mode?.clip) {
    el.clip.pause();
    el.clip.classList.remove('ready');
    return;
  }
  if (el.clip.dataset.key !== mode.key) {
    el.clip.classList.remove('ready');
    el.clip.dataset.key = mode.key;
    el.clip.src = mode.clip.src;
  } else if (restart) {
    el.clip.currentTime = 0;
  }
  el.clip.muted = S.muted;
  el.clip.play().catch(() => {});
}

function togglePlay() {
  if (!current()?.clip || !el.clip.classList.contains('ready')) return;
  if (el.clip.paused) el.clip.play().catch(() => {});
  else el.clip.pause();
}

// ─── Generar ─────────────────────────────────────────────────────────────────

/**
 * Un clip, y lo que cuesta guardarlo.
 *
 * El mp4 se descarga a un blob para meterlo en IndexedDB: la URL que devuelve
 * fal caduca, así que persistir el enlace sería persistir un vídeo roto. Si la
 * descarga falla (CORS, red), se sigue con la URL remota — el vídeo se ve igual
 * pero no sobrevive a recargar, y eso se dice en la consola en vez de fingir
 * que se guardó.
 */
async function keep(mode, data) {
  const meta = { prompt: data.prompt, costEur: data.costEur, label: data.mode };
  let blob = null;
  try {
    const r = await fetch(data.video.url);
    if (r.ok) blob = await r.blob();
  } catch { /* CORS o red */ }

  if (!blob) {
    console.warn('[vivo] el clip no se pudo descargar; solo vivirá esta sesión');
    return { ...meta, src: data.video.url };
  }
  saveClip(clipKey(S.photo.id, mode.key), { ...meta, blob });
  return { ...meta, blob, src: URL.createObjectURL(blob) };
}

async function generate(mode) {
  if (!S.photo || mode.clip || mode.busy) return;
  mode.busy = true;
  mode.failed = null;
  paint();
  try {
    const data = await animate(photoBase64(), mode);
    mode.clip = await keep(mode, data);
  } catch (err) {
    mode.failed = err.message;
    if (err.code === 'content_blocked' || err.code === 'invalid_mode') mode.dead = true;
  } finally {
    mode.busy = false;
    paint();
    if (current() === mode) show({ restart: true });
  }
}

/**
 * Los cuatro a la vez.
 *
 * En paralelo y no en cola: son ~10 s cada uno, así que en serie serían cuarenta
 * segundos mirando una foto quieta. `allSettled` y no `all` porque si uno falla
 * —moderación, un 5xx de fal— los otros tres ya están pagados y deben verse.
 *
 * Al terminar salta al primero que tenga vídeo, que es el gesto que el usuario
 * iba a hacer de todas formas.
 */
async function generateAll() {
  const targets = pending();
  if (!targets.length) return;
  await Promise.allSettled(targets.map(generate));
  const first = S.modes.findIndex((m) => m.clip);
  if (first >= 0) goTo(first);
  else paint();
}

/** Lo que hace el disparador sobre el chip seleccionado. */
function act() {
  const mode = current();
  if (!mode) return generateAll();          // el chip ×4
  if (mode.clip) return show({ restart: true });
  if (!mode.busy) return generate(mode);
}

// ─── Pintar ──────────────────────────────────────────────────────────────────

function paint() {
  const stage = S.stage;
  const thinking = stage === 'thinking';
  const working = S.modes.some((m) => m.busy);
  const mode = current();

  el.gate.hidden = stage !== 'idle';
  el.preview.hidden = stage !== 'live';
  el.shot.hidden = stage === 'idle' || stage === 'live' || !S.photo;
  el.clip.hidden = stage !== 'browse' || !mode?.clip;
  el.flip.hidden = stage !== 'live';
  el.mute.hidden = !(stage === 'browse' && mode?.clip);
  el.peek.hidden = !(stage === 'browse' && mode?.clip?.prompt);

  el.veil.hidden = !(thinking || (working && (!mode || mode.busy)));
  if (!el.veil.hidden) {
    const n = S.modes.filter((m) => m.busy).length;
    el.veilLabel.textContent = thinking ? 'Mirando la foto…' : n > 1 ? `Animando ${n}…` : 'Animando…';
    el.veilHint.textContent = thinking ? '' : 'unos 10 segundos';
  }

  el.fresh.hidden = stage !== 'browse';
  el.reroll.hidden = stage !== 'browse' || working;

  chips().forEach((c, i) => {
    const m = S.modes[i];
    c.setAttribute('aria-selected', String(i === S.index));
    c.classList.toggle('busy', !!m?.busy);
    c.classList.toggle('has-clip', !!m?.clip);
    c.classList.toggle('failed', !!m?.failed);
  });

  // El disparador dice lo que va a hacer, y sobre el ×4 dice cuánto cuesta.
  const shutter =
    stage === 'live' ? { glyph: '', kind: '', label: 'Disparar' }
    : !mode ? { glyph: '⚡', kind: 'apply', label: 'Generar los cuatro' }
    : mode.clip ? { glyph: '↺', kind: 'again', label: 'Repetir' }
    : { glyph: '▶', kind: 'apply', label: 'Animar' };

  el.core.className = `core ${shutter.kind}`.trim();
  el.core.textContent = shutter.glyph;
  el.shutter.setAttribute('aria-label', shutter.label);
  el.shutter.disabled =
    stage === 'idle' || thinking || (stage === 'browse' && (mode ? mode.busy || mode.dead : !pending().length));

  el.carousel.classList.toggle('locked', stage !== 'browse');
  paintZoom();
  paintStatus();
}

function paintStatus() {
  if (S.stage !== 'browse') return;
  const mode = current();

  if (!mode) {
    const n = pending().length;
    const each = S.clipCostEur;
    if (!n) return say('Los cuatro están generados');
    return say(each ? `Genera los ${n} que faltan · ~${(n * each).toFixed(2)} €` : `Genera los ${n} que faltan`);
  }
  if (mode.failed) return say(mode.failed, true);
  if (mode.busy) return say('');
  if (mode.clip) {
    // El nombre real de la sorpresa aparece AQUÍ y no en el chip: el carrusel
    // decía "Sorpresa", y esto es el chiste contado en el momento correcto.
    return say(`${mode.clip.label}${mode.clip.costEur != null ? ` · ${mode.clip.costEur.toFixed(2)} €` : ''}`);
  }
  say('Desliza para ver los modos · toca ▶ para animar este');
}

function say(text, isError = false) {
  el.status.textContent = text || '';
  el.status.classList.toggle('error', !!isError);
}

function setStage(stage) {
  S.stage = stage;
  paint();
}

// ─── El recorrido ────────────────────────────────────────────────────────────

async function begin() {
  el.gateError.hidden = true;
  try {
    await openCamera();
    forget();
    setStage('live');
    renderHint('Haz una foto y te propongo cómo animarla');
    say('');
  } catch (err) {
    el.gateError.hidden = false;
    el.gateError.textContent =
      err?.name === 'NotAllowedError' ? 'Has denegado la cámara. Actívala en los ajustes del navegador para esta página.'
      : err?.name === 'NotFoundError' ? 'Este dispositivo no tiene cámara. Puedes subir una foto.'
      : !window.isSecureContext ? 'La cámara solo funciona sobre HTTPS.'
      : 'No se pudo abrir la cámara. Puedes subir una foto.';
    setStage('idle');
  }
}

/** Suelta la foto y sus clips de la memoria (los de disco los pisa la siguiente). */
function forget() {
  S.modes.forEach((m) => m.clip?.blob && URL.revokeObjectURL(m.clip.src));
  S.photo = null;
  S.modes = [];
  S.index = 0;
  el.clip.removeAttribute('src');
  el.clip.removeAttribute('data-key');
  el.clip.load();
}

function shoot() {
  const v = el.preview;
  if (!v.videoWidth) return;
  const dataUrl = grab(v, v.videoWidth, v.videoHeight, S.facing === 'user');
  stopCamera();
  return usePhoto(dataUrl);
}

async function usePhoto(dataUrl) {
  forget();
  S.photo = { id: `p${Date.now().toString(36)}`, dataUrl };
  el.shot.src = dataUrl;
  await loadModes();
}

/**
 * Pide (o vuelve a pedir) los modos para la foto que ya está puesta.
 *
 * Cada llamada devuelve cuatro ideas distintas: el servidor sortea dos ejes por
 * petición. Cuesta ~0,0015 € — la cuatrocientésima parte de un clip — así que
 * volver a tirar los dados es lo más barato que hace esta app.
 */
async function loadModes() {
  if (!S.photo) return;
  // Los clips de la tirada anterior quedan huérfanos: sus modos ya no existen.
  const old = S.modes;
  setStage('thinking');
  renderSkeleton();
  say('');
  try {
    const result = await suggestModes(photoBase64());
    old.forEach((m) => {
      if (m.clip?.blob) URL.revokeObjectURL(m.clip.src);
      deleteClip(clipKey(S.photo.id, m.key));
    });
    // Una clave propia por modo, y no el `id` del servidor: los ids se repiten
    // entre tiradas (ai-0…ai-3), así que usarlos haría que una tirada nueva
    // heredase los vídeos de la anterior.
    S.modes = (result.modes || []).map((m) => ({ ...m, key: uid() }));
    S.index = 0;
    renderModes();
    setStage('browse');
    saveSession(S.photo, S.modes);
    if (result.source === 'catalog') {
      say('Modos genéricos (no se pudo analizar la foto)');
      console.warn('[vivo] visión no disponible:', result.reason);
    }
  } catch (err) {
    // Bloqueada por moderación o sin servidor: se vuelve a la cámara. Dejar una
    // foto congelada con un aviso encima es un callejón sin salida.
    say(err.message, true);
    forget();
    await begin();
  }
}

const uid = () =>
  (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).slice(0, 12);

/**
 * Lo que había al cerrar la pestaña.
 *
 * Los clips valen 0,18 € y diez segundos cada uno, y no se pueden volver a
 * pedir iguales porque el modelo no es determinista: perderlos al recargar es
 * tirar dinero y una idea que no vuelve.
 */
async function restore() {
  const saved = await loadSession();
  if (!saved?.photo?.dataUrl || !saved.modes?.length) return false;

  S.photo = saved.photo;
  S.modes = saved.modes.map((m) => ({ ...m, busy: false, failed: null }));
  el.shot.src = saved.photo.dataUrl;

  const found = await Promise.all(
    S.modes.map((m) => loadClip(clipKey(S.photo.id, m.key)))
  );
  found.forEach((rec, i) => {
    if (rec?.blob) S.modes[i].clip = { ...rec, src: URL.createObjectURL(rec.blob) };
  });

  S.index = Math.max(0, S.modes.findIndex((m) => m.clip));
  renderModes();
  setStage('browse');
  chips()[S.index]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  show({ restart: true });
  return true;
}

// ─── Cableado ────────────────────────────────────────────────────────────────

el.start.addEventListener('click', begin);
el.fresh.addEventListener('click', begin);
el.reroll.addEventListener('click', loadModes);

el.upload.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
    stopCamera();
    await usePhoto(grab(img, img.naturalWidth, img.naturalHeight, false));
  } catch {
    say('No se pudo leer esa imagen.', true);
  } finally {
    URL.revokeObjectURL(img.src);
  }
});

el.shutter.addEventListener('click', () => (S.stage === 'live' ? shoot() : act()));

el.zoom.addEventListener('click', () => setZoom(S.zoom?.min ?? 1));

el.flip.addEventListener('click', async () => {
  S.facing = S.facing === 'environment' ? 'user' : 'environment';
  try { await openCamera(); } catch { /* se queda con la que había */ }
});

el.mute.addEventListener('click', () => {
  S.muted = !S.muted;
  el.clip.muted = S.muted;
  el.mute.textContent = S.muted ? '🔇' : '🔊';
});

el.peek.addEventListener('click', () => {
  const clip = current()?.clip;
  el.sheetTitle.textContent = clip?.label || '';
  el.sheetBody.textContent = clip?.prompt || '';
  el.sheet.hidden = false;
});
el.sheet.addEventListener('click', () => { el.sheet.hidden = true; });

// Teclado: en un portátil no hay dedo que deslizar, y el prototipo se enseña
// tanto en escritorio como en móvil.
document.addEventListener('keydown', (e) => {
  if (S.stage !== 'browse') return;
  if (e.key === 'ArrowRight') goTo(S.index + 1);
  else if (e.key === 'ArrowLeft') goTo(S.index - 1);
  else if (e.key === ' ') { e.preventDefault(); act(); }
});

el.clip.addEventListener('canplay', () => el.clip.classList.add('ready'));
el.clip.addEventListener('error', () => {
  if (S.stage === 'browse' && current()?.clip) say('El vídeo no se pudo reproducir.', true);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.stage === 'live' && !S.stream) begin();
});

// Arranque: si hay una sesión guardada se entra directamente a ella, y la
// cámara espera detrás del botón de "Nueva foto".
renderHint('');
paint();
restore().catch(() => {});

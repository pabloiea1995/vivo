// Vivo — una pantalla, cinco estados, un solo botón que importa.
//
//   live ──disparo──▶ thinking ──GPT──▶ pick ──elección──▶ rendering ──fal──▶ play
//    ▲                                   │                                    │
//    └───────────── otra foto ───────────┴────────────────────────────────────┘
//
// La foto NO se tira al llegar a `play`: se queda debajo del clip (es su primer
// fotograma, literalmente) y sigue viva al volver a `pick`, así que probar un
// segundo modo sobre la misma foto no cuesta ni una foto ni una llamada de
// visión — los cuatro tickets valen diez minutos. Es lo que convierte el
// juguete en algo que se usa dos veces seguidas.

const $ = (id) => document.getElementById(id);

const el = {
  frame: $('frame'), preview: $('preview'), shot: $('shot'), clip: $('clip'),
  veil: $('veil'), veilLabel: $('veilLabel'), veilHint: $('veilHint'),
  flip: $('flip'), mute: $('mute'),
  gate: $('gate'), start: $('start'), upload: $('upload'), gateError: $('gateError'),
  status: $('status'), carousel: $('carousel'),
  again: $('again'), peek: $('peek'),
  shutter: $('shutter'), core: $('shutterCore'),
  sheet: $('sheet'), sheetTitle: $('sheetTitle'), sheetBody: $('sheetBody'),
};

// ─── Estado ──────────────────────────────────────────────────────────────────

const S = {
  stage: 'idle',        // idle | live | thinking | pick | rendering | play
  facing: 'environment',
  stream: null,
  photo: null,          // { dataUrl, base64 }
  modes: [],
  index: 0,
  clip: null,
  muted: true,
};

// ─── El backend ──────────────────────────────────────────────────────────────
//
// El único sitio que habla con la API. Si mañana hay que meter reintentos o
// telemetría, hay UN sitio donde meterlo — un fetch suelto en un manejador de
// eventos es un error, no un atajo.
//
// Y fíjate en lo que no hay aquí: ni una línea de texto en inglés dirigida a un
// modelo. La web manda datos (una foto, un idioma, un ticket) y el servidor
// compone el prompt. Por eso afinar un modo es un despliegue y no un cambio de
// cliente, y por eso la clave de fal no es utilizable para nada que no sea una
// de nuestras animaciones.

// La cerradura del backend (`VIVO_APP_SECRET`). Se pasa una vez por la URL
// (?key=…) y se recuerda; así no hay que compilar nada para cambiarla ni queda
// escrita en el repositorio.
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
  invalid_mode: 'Ese modo ha caducado. Vuelve a disparar.',
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

/** La foto entra, cuatro modos salen. Nunca falla por culpa del modelo: si la
 *  visión se cae, el servidor responde 200 con el catálogo. */
const suggestModes = (base64) =>
  post('/api/suggest', { imageBase64: base64, locale: navigator.language?.slice(0, 2) || 'es' }, 20000);

/** El clip. `ticket` es lo que devolvió suggestModes, sin tocar; el servidor lo
 *  verifica antes de mirar lo que lleva dentro. */
const animate = (base64, mode) =>
  post('/api/video', mode.ticket ? { imageBase64: base64, ticket: mode.ticket }
                                 : { imageBase64: base64, modeId: mode.id },
       // Generoso: la inferencia son ~3 s, pero la subida de la foto desde un
       // móvil con mala cobertura y la cola de fal en hora punta no.
       150000);

// ─── La cámara ───────────────────────────────────────────────────────────────

async function openCamera() {
  stopCamera();
  S.stream = await navigator.mediaDevices.getUserMedia({
    // El encuadre de la app es 9:16; se pide vertical para que el navegador no
    // entregue un 16:9 apaisado del que habría que tirar la mitad.
    video: { facingMode: S.facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
    audio: false,
  });
  el.preview.srcObject = S.stream;
  el.preview.classList.toggle('mirrored', S.facing === 'user');
  await el.preview.play().catch(() => {});
}

function stopCamera() {
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
}

// Lo que se ve es lo que se manda. Literalmente, y aquí es donde se cumple.
//
// El preview va con `object-fit: cover`, así que el navegador YA está
// recortando para llenar la pantalla. Capturar el fotograma entero de la cámara
// metería en el vídeo cosas que el usuario nunca vio, y "el primer fotograma es
// tu foto" dejaría de ser verdad justo en el detalle que la hace creíble. Así
// que se reproduce aquí el mismo recorte, contra la proporción REAL del hueco
// —la que tenga esta pantalla— y no contra una constante.
const LONG_SIDE = 1280;

function coverCrop(w, h, aspect) {
  if (w / h > aspect) {
    const sw = h * aspect;
    return { sx: (w - sw) / 2, sy: 0, sw, sh: h };
  }
  const sh = w / aspect;
  return { sx: 0, sy: (h - sh) / 2, sw: w, sh };
}

// Par, siempre: los codificadores de vídeo trabajan en bloques de 2 píxeles y
// una dimensión impar es una forma barata de encontrarse un borde raro.
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function grab(source, w, h, mirror) {
  const box = el.frame.getBoundingClientRect();
  const aspect = box.width && box.height ? box.width / box.height : w / h;
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
  // 0.72 y 1280 de lado largo: por debajo se nota en el primer fotograma, y por
  // encima solo engorda un base64 que tiene que subir por la red del móvil y
  // caber en el cuerpo de una función de Vercel (4,5 MB).
  const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

// ─── El carrusel ─────────────────────────────────────────────────────────────

function renderModes(modes) {
  el.carousel.className = 'carousel';
  el.carousel.innerHTML = '';
  modes.forEach((mode, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mode${mode.surprise ? ' surprise' : ''}`;
    btn.role = 'option';
    btn.setAttribute('aria-selected', String(i === 0));
    btn.innerHTML = `<span class="disc"></span><span class="name"></span>`;
    // textContent y no innerHTML: la etiqueta la escribe un modelo, y aunque
    // el servidor la recorta, meter texto ajeno en el DOM como HTML es una
    // costumbre que solo hace falta perder una vez.
    btn.querySelector('.disc').textContent = mode.emoji;
    btn.querySelector('.name').textContent = mode.label;
    // Tocar un chip lo trae al centro; tocar el que YA está en el centro lo
    // aplica, igual que en Instagram el filtro ya seleccionado se abre.
    btn.addEventListener('click', () => (i === S.index ? apply(modes[i]) : center(i)));
    el.carousel.appendChild(btn);
  });
  S.index = 0;
  center(0, 'auto');
}

function renderSkeleton() {
  el.carousel.className = 'carousel locked';
  el.carousel.innerHTML = Array.from({ length: 4 })
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

const chips = () => [...el.carousel.querySelectorAll('.mode:not(.skeleton)')];

function center(i, behavior = 'smooth') {
  chips()[i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior });
  select(i);
}

function select(i) {
  S.index = i;
  chips().forEach((c, n) => c.setAttribute('aria-selected', String(n === i)));
}

// El chip del centro es el elegido. Se mide por posición real y no por
// aritmética de anchos: con los espaciadores de los extremos y el `gap`, la
// cuenta se desincroniza en cuanto cambia un tamaño, y una selección que no
// coincide con lo que se ve es peor que ninguna.
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
    if (S.stage !== 'pick') return;
    const i = nearest();
    if (i !== S.index) select(i);
  });
});

// ─── Pintar el estado ────────────────────────────────────────────────────────

function setStage(stage) {
  S.stage = stage;
  const busy = stage === 'thinking' || stage === 'rendering';

  el.gate.hidden = stage !== 'idle';
  el.preview.hidden = stage !== 'live';
  el.shot.hidden = stage === 'idle' || stage === 'live' || !S.photo;
  el.clip.hidden = stage !== 'play';
  el.flip.hidden = stage !== 'live';
  el.mute.hidden = stage !== 'play';

  el.veil.hidden = !busy;
  if (busy) {
    el.veilLabel.textContent = stage === 'thinking' ? 'Mirando la foto…' : 'Animando…';
    el.veilHint.textContent = stage === 'rendering' ? 'unos 10 segundos' : '';
  }

  el.again.hidden = stage !== 'play';
  el.peek.hidden = stage !== 'play' || !S.clip?.prompt;

  el.shutter.disabled = busy || stage === 'idle' || (stage === 'pick' && !S.modes.length);
  el.core.className = 'core' + (stage === 'play' ? ' again' : stage === 'live' || stage === 'idle' ? '' : ' apply');
  el.core.textContent = stage === 'play' ? '↺' : stage === 'live' || stage === 'idle' ? '' : '▶';
  el.shutter.setAttribute('aria-label', stage === 'play' ? 'Otra foto' : stage === 'live' ? 'Disparar' : 'Animar');

  el.carousel.classList.toggle('locked', stage !== 'pick');
  chips().forEach((c, i) => c.classList.toggle('busy', stage === 'rendering' && i === S.index));
}

function say(text, isError = false) {
  el.status.textContent = text || '';
  el.status.classList.toggle('error', !!isError);
}

// ─── El recorrido ────────────────────────────────────────────────────────────

async function begin() {
  el.gateError.hidden = true;
  try {
    await openCamera();
    setStage('live');
    renderHint('Haz una foto y te propongo cómo animarla');
    say('');
  } catch (err) {
    // Denegado, sin cámara, o un contexto sin HTTPS. Se dice cuál, porque los
    // tres se arreglan de forma distinta y "no se pudo" no ayuda a ninguno.
    el.gateError.hidden = false;
    el.gateError.textContent =
      err?.name === 'NotAllowedError' ? 'Has denegado la cámara. Actívala en los ajustes del navegador para esta página.'
      : err?.name === 'NotFoundError' ? 'Este dispositivo no tiene cámara. Puedes subir una foto.'
      : !window.isSecureContext ? 'La cámara solo funciona sobre HTTPS.'
      : 'No se pudo abrir la cámara. Puedes subir una foto.';
  }
}

async function shoot() {
  const v = el.preview;
  if (!v.videoWidth) return;
  const photo = grab(v, v.videoWidth, v.videoHeight, S.facing === 'user');
  stopCamera();
  await usePhoto(photo);
}

async function usePhoto(photo) {
  S.photo = photo;
  S.clip = null;
  el.shot.src = photo.dataUrl;
  setStage('thinking');
  renderSkeleton();
  say('');
  try {
    const result = await suggestModes(photo.base64);
    S.modes = result.modes || [];
    renderModes(S.modes);
    setStage('pick');
    if (result.source === 'catalog') say('Modos genéricos (no se pudo analizar la foto)');
  } catch (err) {
    // Bloqueada por moderación o sin servidor: se vuelve a la cámara. Dejar una
    // foto congelada con un aviso encima es un callejón sin salida.
    say(err.message, true);
    S.photo = null;
    await begin();
  }
}

async function apply(mode) {
  if (!S.photo) return;
  say('');
  setStage('rendering');
  try {
    const data = await animate(S.photo.base64, mode);
    S.clip = { url: data.video.url, mode: data.mode, costEur: data.costEur, prompt: data.prompt };
    playClip();
  } catch (err) {
    say(err.message, true);
    // Un ticket caducado (diez minutos eligiendo) obliga a repetir la foto;
    // cualquier otro fallo deja el carrusel donde estaba para reintentar.
    if (err.code === 'invalid_mode') { S.photo = null; await begin(); }
    else setStage('pick');
  }
}

function playClip() {
  S.muted = true;
  el.mute.textContent = '🔇';
  el.clip.classList.remove('ready');
  el.clip.muted = true;
  el.clip.src = S.clip.url;
  setStage('play');
  // El nombre real de la sorpresa aparece AQUÍ y no antes: el chip decía
  // "Sorpresa", y esto es el chiste contado en el momento correcto.
  say(`${S.clip.mode}${S.clip.costEur != null ? ` · ${S.clip.costEur.toFixed(2)} €` : ''}`);
  el.clip.play().catch(() => {});
}

async function reset() {
  S.photo = null;
  S.clip = null;
  S.modes = [];
  el.clip.removeAttribute('src');
  el.clip.load();
  await begin();
}

// ─── Cableado ────────────────────────────────────────────────────────────────

el.start.addEventListener('click', begin);

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

el.shutter.addEventListener('click', () => {
  if (S.stage === 'live') return shoot();
  if (S.stage === 'play') return reset();
  if (S.stage === 'pick') return apply(S.modes[S.index]);
});

el.again.addEventListener('click', () => {
  // Vuelve al carrusel SIN volver a llamar a la visión: los tickets siguen
  // valiendo, así que otro modo sobre la misma foto cuesta un clip y nada más.
  el.clip.pause();
  S.clip = null;
  setStage('pick');
  say('');
});

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
  el.sheetTitle.textContent = S.clip?.mode || '';
  el.sheetBody.textContent = S.clip?.prompt || '';
  el.sheet.hidden = false;
});
el.sheet.addEventListener('click', () => { el.sheet.hidden = true; });

// Se enciende cuando hay algo que pintar: ver la nota de #clip en app.css.
el.clip.addEventListener('canplay', () => el.clip.classList.add('ready'));
el.clip.addEventListener('error', () => {
  if (S.stage === 'play') say('El vídeo no se pudo reproducir.', true);
});

// Volver a la pestaña con la cámara apagada por el sistema: se reabre sola.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.stage === 'live' && !S.stream) begin();
});

setStage('idle');
renderHint('');

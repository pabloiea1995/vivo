// Tablas de precio. Y, a la vez, las listas blancas.
//
// Es la misma decisión que en Ridio y merece repetirse: **un modelo que no
// sabemos tarifar es un modelo que no sabemos medir, y un modelo que no sabemos
// medir no tiene por qué ser alcanzable con nuestras claves.** Añadir uno es
// ponerle precio primero, en el mismo commit.
//
// En un prototipo esto no es burocracia. El vídeo se tarifa por SEGUNDO y
// resolución, no por generación: un clip de 5 s a 768p cuesta lo que trece
// ilustraciones. Un `duration` grande colado en el cuerpo de la petición
// multiplica la factura sin que nada falle ni se note.

// ─── Texto (visión) ──────────────────────────────────────────────────────────
// $/1M tokens. Los de la generación 5.x, con Luna a la cabeza: es cara para lo
// que hace en texto largo, pero esta llamada son ~300 tokens de entrada con la
// imagen en `detail: low` y una respuesta corta, y la calidad de las propuestas
// es LA feature.
const TEXT_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 1.0, output: 6.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
};

const extraModels = (): string[] =>
  (process.env.VIVO_EXTRA_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);

export const isKnownTextModel = (model: string): boolean =>
  Object.prototype.hasOwnProperty.call(TEXT_PRICING, model) || extraModels().includes(model);

/** Coste en micros USD de una respuesta de chat/completions, según su `usage`. */
export function textCostMicros(parsed: unknown, reqModel: string): number {
  const usage = (parsed as any)?.usage || {};
  const model = String((parsed as any)?.model || reqModel || '');
  // Prefijo, no igualdad: OpenAI devuelve el id con fecha ("gpt-5-mini-2026-…").
  const key = Object.keys(TEXT_PRICING).find((k) => model.startsWith(k));
  const price = (key && TEXT_PRICING[key]) || TEXT_PRICING[reqModel];
  if (!price) return 0;
  const cachedIn = Number(usage?.prompt_tokens_details?.cached_tokens) || 0;
  const inTok = Math.max(0, (Number(usage?.prompt_tokens) || 0) - cachedIn);
  const outTok = Number(usage?.completion_tokens) || 0;
  // Los tokens cacheados van al 10% en toda la gama 5.x.
  return Math.round(((inTok + cachedIn * 0.1) * price.input + outTok * price.output) / 1e6 * 1e6);
}

// ─── Vídeo ───────────────────────────────────────────────────────────────────
// ⚠️ La P va en MAYÚSCULA porque es lo que valida fal: mandar "768p" devuelve
// 422 (`Input should be '480P' or '768P'`) sin generar nada.
interface VideoTariff {
  promo: Record<string, number>;
  list: Record<string, number>;
}

const VIDEO_USD_PER_SECOND: Record<string, VideoTariff> = {
  // El único endpoint que este prototipo puede invocar, y a propósito: es
  // image-to-video. No hay camino de texto-a-vídeo porque no hay ningún caso de
  // uso aquí en el que el primer fotograma no sea la foto del usuario.
  'minimax/h3-max/image-to-video': {
    promo: { '480P': 0.025, '768P': 0.04 },
    list: { '480P': 0.05, '768P': 0.08 },
  },
};

// 1 de septiembre de 2026, 00:00 UTC: fal anuncia el fin del descuento de
// lanzamiento por día, sin hora ni huso. Se corta al EMPEZAR ese día — si lo
// alargan unas horas habremos estimado de más, que es el lado del error que no
// se come la caja.
const PROMO_ENDS_MS = Date.UTC(2026, 8, 1);

export function videoPromoActive(now: Date = new Date()): boolean {
  const forced = (process.env.VIVO_FAL_PROMO || '').trim().toLowerCase();
  if (forced === 'on') return true;
  if (forced === 'off') return false;
  return now.getTime() < PROMO_ENDS_MS;
}

const DEFAULT_RESOLUTION = '768P';

export const normalizeResolution = (r?: string): string =>
  String(r || DEFAULT_RESOLUTION).toUpperCase();

export function videoMicros(
  model: string,
  seconds: number,
  resolution?: string,
  now: Date = new Date()
): number {
  const tariff = VIDEO_USD_PER_SECOND[model];
  if (!tariff) return 0;
  const byRes = videoPromoActive(now) ? tariff.promo : tariff.list;
  const wanted = normalizeResolution(resolution);
  const res = byRes[wanted] != null ? wanted : DEFAULT_RESOLUTION;
  // Ante una resolución desconocida se estima la MÁS CARA que conocemos: si fal
  // añade 2K algún día, el error debe caer del lado que no regala dinero.
  const perSecond = byRes[res] ?? Math.max(...Object.values(byRes));
  return Math.round(perSecond * 1e6 * Math.max(0, seconds || 0));
}

export const isKnownVideoModel = (slug: string): boolean =>
  Object.prototype.hasOwnProperty.call(VIDEO_USD_PER_SECOND, slug) || extraModels().includes(slug);

/** Resoluciones tarifadas de un modelo: la lista blanca de `resolution`. */
export const videoResolutions = (model: string): string[] =>
  Object.keys(VIDEO_USD_PER_SECOND[model]?.list || {});

/** Micros USD → euros, para poder enseñar en pantalla lo que cuesta el juguete. */
export const microsToEur = (micros: number): number =>
  (micros / 1e6) * (Number(process.env.VIVO_USD_EUR) || 0.92);

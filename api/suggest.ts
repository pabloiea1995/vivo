// POST /api/suggest — la foto entra, cuatro modos salen.
//
// Lo que el cliente manda: la foto y su idioma. Nada más. Ni un fragmento del
// prompt, ni el modelo, ni la temperatura. Lo que recibe: cuatro chips con
// etiqueta, emoji y un TICKET opaco (`_ticket.ts`). El texto que dirige el
// vídeo nunca se le enseña, y por tanto nunca puede escribirlo él.
//
// Falla hacia adelante, siempre. Si no hay clave, si Luna tarda o si devuelve
// algo que no encaja en el esquema, se responde 200 con el catálogo fijo
// (`_modes.ts`) y `source: "catalog"`. Un carrusel genérico es un producto peor;
// un carrusel vacío no es un producto.

import { applyAccessCheck } from './_origin';
import { readBody, readPhoto, safeParse, methodGuard } from './_http';
import { moderateImage } from './_moderation';
import { buildVisionRequest, VISION_MODEL, VISION_FALLBACK_MODEL } from './_visionPrompts';
import { fallbackModes, isIntensity, type Intensity, type Mode } from './_modes';
import { signTicket } from './_ticket';
import { isKnownTextModel, textCostMicros, microsToEur } from './_pricing';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Quince segundos, y antes eran ocho.
//
// Ocho salió de suponer una llamada de texto corta. Pero esto es un modelo de
// razonamiento mirando una imagen y devolviendo JSON estructurado, y encima
// puede llevar dentro un reintento (si rechaza `temperature` se manda otra vez
// sin ella) que consume del MISMO presupuesto, porque el AbortController se
// arranca una sola vez. Con ocho segundos eso se agota antes de que el modelo
// conteste, y el usuario ve el catálogo fijo sin ninguna pista de por qué.
//
// El tope sigue existiendo: pasado ese punto el catálogo es mejor respuesta que
// la buena, porque el usuario está mirando una foto congelada. Pero tiene que
// dar margen a que la respuesta llegue. La función de Vercel admite 60 s y el
// cliente espera 30, así que quince cabe de sobra.
const VISION_TIMEOUT_MS = Number(process.env.VIVO_VISION_TIMEOUT_MS) || 15000;

export interface SuggestedMode {
  id: string;
  label: string;
  emoji: string;
  surprise: boolean;
  /** opaco: se devuelve tal cual a /api/video */
  ticket: string;
}

export default async function handler(req: any, res: any): Promise<void> {
  if (!applyAccessCheck(req, res)) return;
  if (!methodGuard(req, res)) return;

  const body = readBody(req);
  const photo = readPhoto(body.imageBase64);
  if (!photo.ok) {
    res.status(photo.status).json({ error: photo.code, code: photo.code });
    return;
  }
  const locale = typeof body.locale === 'string' ? body.locale : 'es';

  // La foto la ha puesto un humano con una cámara. Se mira ANTES de mandársela
  // a nadie, y este es el único punto del recorrido donde se mira: /api/video
  // la vuelve a ver, pero para entonces ya habría salido de aquí.
  const verdict = await moderateImage(photo.dataUri, process.env.OPENAI_API_KEY);
  if (verdict.flagged) {
    console.warn(`[moderation] blocked photo: ${verdict.categories.join(', ')}`);
    res.status(422).json({
      error: 'content_blocked',
      code: 'content_blocked',
      detail: 'No se puede animar esta foto: no cumple las normas de contenido.',
    });
    return;
  }

  const vision = await proposeModes(photo.dataUri, locale);
  const modes = vision.modes.length ? vision.modes : fallbackModes();

  res.setHeader('x-vivo-source', vision.modes.length ? 'vision' : 'catalog');
  res.status(200).json({
    modes: await Promise.all(modes.map(toWire)),
    source: vision.modes.length ? 'vision' : 'catalog',
    subject: vision.subject,
    model: vision.model || null,
    costEur: vision.costEur,
    // Por qué se cayó al catálogo. Lo enseña el cliente: cuando el carrusel sale
    // genérico en un móvil de verdad, esto es lo único que evita adivinar.
    reason: vision.reason,
    detail: vision.detail,
  });
}

// El chip que ve el cliente: etiqueta, emoji y el sobre cerrado. `motion` e
// `intensity` se quedan aquí dentro, dobladas en el ticket.
//
// Y la sorpresa viaja TAPADA. El nombre que le puso el modelo ("Invasión de
// medusas") es medio chiste, y leerlo en el chip lo gasta antes de verlo: el
// carrusel enseña "Sorpresa 🎲", el nombre real va dentro del ticket y sale a
// la luz en la respuesta de /api/video, cuando el vídeo ya está.
const toWire = async (m: Mode): Promise<SuggestedMode> => ({
  id: m.id,
  label: m.surprise ? 'Sorpresa' : m.label,
  emoji: m.surprise ? '🎲' : m.emoji,
  surprise: !!m.surprise,
  ticket: await signTicket({ motion: m.motion, intensity: m.intensity, label: m.label }),
});

interface VisionResult {
  modes: Mode[];
  subject?: string;
  costEur?: number;
  model?: string;
  reason?: string;
  /**
   * Lo que dijo OpenAI, recortado. Viaja al cliente a propósito: `upstream_400`
   * no dice nada, y "Unsupported parameter: temperature" lo dice todo. Es un
   * prototipo y el que mira la pantalla es quien lo mantiene.
   *
   * No filtra nada: los errores de OpenAI no llevan la clave dentro.
   */
  detail?: string;
}

// Dos cosas que se aprenden UNA vez por instancia y no en cada foto, porque
// costarían una llamada perdida cada vez:
//
//  - Si este modelo acepta `temperature`. Los de razonamiento la rechazan con
//    un 400, y la temperatura alta es media palanca de variedad: se intenta
//    siempre primero, y si dice que no, se deja de intentar.
//  - Si el modelo configurado existe siquiera. Un `VIVO_VISION_MODEL` que la
//    cuenta no tiene devuelve 404 en cada foto y el usuario ve el catálogo fijo
//    para siempre, sin ninguna pista de por qué.
let sendTemperature = true;
let modelOverride: string | null = null;

async function callVision(
  key: string,
  imageDataUri: string,
  locale: string,
  signal: AbortSignal
): Promise<{ res: Response; text: string; model: string }> {
  const model = modelOverride || VISION_MODEL;
  const send = async (m: string, temperature: boolean) => {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildVisionRequest({ imageDataUri, locale }, { model: m, temperature })),
      signal,
    });
    return { res, text: await res.text(), model: m };
  };

  let out = await send(model, sendTemperature);

  // 400 por la temperatura: se reintenta sin ella y no se vuelve a mandar.
  if (!out.res.ok && out.res.status === 400 && /temperature/i.test(out.text) && sendTemperature) {
    console.warn(`[suggest] ${model} no acepta temperature; se deja de mandar`);
    sendTemperature = false;
    out = await send(model, false);
  }

  // El modelo no existe en esta cuenta: se pasa al de respaldo y se recuerda.
  // Solo si está tarifado, que es la misma regla de siempre.
  if (!out.res.ok && (out.res.status === 404 || /model/i.test(out.text)) && model !== VISION_FALLBACK_MODEL) {
    if (isKnownTextModel(VISION_FALLBACK_MODEL)) {
      console.warn(`[suggest] ${model} no disponible (${out.res.status}); se usa ${VISION_FALLBACK_MODEL}`);
      modelOverride = VISION_FALLBACK_MODEL;
      out = await send(VISION_FALLBACK_MODEL, sendTemperature);
    }
  }

  return out;
}

async function proposeModes(imageDataUri: string, locale: string): Promise<VisionResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { modes: [], reason: 'no_openai_key' };
  // Coherencia con `_pricing.ts`: si el override apunta a un modelo sin tarifa,
  // no se llama. Un modelo que no sabemos tarifar no debería ver nuestra clave.
  if (!isKnownTextModel(VISION_MODEL)) return { modes: [], reason: 'model_not_priced' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  try {
    const { res: upstream, text, model } = await callVision(key, imageDataUri, locale, ctrl.signal);
    if (!upstream.ok) {
      console.warn(`[suggest] vision ${model} ${upstream.status}: ${text.slice(0, 200)}`);
      const msg = (safeParse(text) as any)?.error?.message;
      return {
        modes: [],
        reason: `upstream_${upstream.status}`,
        detail: String(msg || text).replace(/\s+/g, ' ').slice(0, 140),
      };
    }
    const parsed = safeParse(text) as any;
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) return { modes: [], reason: 'empty_completion' };

    const { modes, subject } = parseOptions(content);
    const costEur = microsToEur(textCostMicros(parsed, model));
    if (!modes.length) {
      // Cuántas opciones llegaron y por qué no valieron: si el modelo devuelve
      // tres en vez de cuatro, o una con la etiqueta vacía, esto lo dice sin
      // tener que reproducirlo.
      const raw = (safeParse(content) as any)?.options;
      return {
        modes: [],
        costEur,
        model,
        reason: 'unparseable_options',
        detail: `${Array.isArray(raw) ? raw.length : 0} opciones`,
      };
    }
    return { modes, subject, costEur, model };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    console.warn(`[suggest] vision ${aborted ? 'timeout' : 'error'}: ${(err as Error)?.message}`);
    return { modes: [], reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

const trim = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Del JSON del modelo a modos utilizables.
 *
 * Se valida en vez de confiar aunque el esquema sea `strict`: lo que salga de
 * aquí se firma, y firmar es decir "esto lo escribí yo". Una etiqueta de
 * cuarenta palabras rompe el carrusel y un `motion` vacío da cinco segundos de
 * nada por el precio de trece ilustraciones.
 */
function parseOptions(content: string): { modes: Mode[]; subject?: string } {
  const data = safeParse(content) as { options?: unknown; subject?: unknown };
  const raw = Array.isArray(data?.options) ? data.options : [];
  const out: Mode[] = [];

  raw.slice(0, 4).forEach((o: any, i) => {
    const motion = trim(o?.motion, 700);
    const label = trim(o?.label, 18);
    if (!motion || !label) return;
    const intensity: Intensity = isIntensity(o?.intensity) ? o.intensity : 'cinematic';
    const surprise = i === 3;
    out.push({
      id: `ai-${i}`,
      label,
      // el emoji puede venir como varios caracteres o vacío; se corta al primer
      // grapheme y hay red de seguridad por si llega texto en vez de emoji
      emoji: [...trim(o?.emoji, 8)][0] || (surprise ? '🎲' : '✨'),
      motion,
      // la cuarta es la sorpresa por posición, y se le fuerza la barra libre:
      // el prompt la pide "wild", pero un modelo obediente a veces la etiqueta
      // "cinematic" y entonces las guardas le atan justo lo que la hace gracia
      intensity: surprise ? 'wild' : intensity,
      surprise,
    });
  });

  // Cuatro o ninguno: tres chips y un hueco es peor que el catálogo entero.
  return { modes: out.length === 4 ? out : [], subject: trim(data?.subject, 120) || undefined };
}

// POST /api/video — la puerta única para todo lo que este prototipo anima.
//
// **El primer fotograma es SIEMPRE la foto.** No es una preferencia de la
// interfaz: es la forma del endpoint. Solo habla con modelos `image-to-video`
// (`_pricing.ts`), `image_url` es obligatorio, y una petición sin foto se cae
// con 400 antes de tocar la clave de fal. No existe un camino de texto-a-vídeo
// que alguien pueda encontrar por accidente, porque no existe un caso de uso
// aquí en el que el usuario quiera un vídeo que NO empiece por lo que acaba de
// fotografiar.
//
// Lo que el cliente manda: la foto y el ticket que le dio /api/suggest (o el id
// de un modo del catálogo). El prompt lo compone `_videoPrompts.ts`.
//
// El dinero. Se tarifa por SEGUNDO × resolución, no por generación: cinco
// segundos a 768p cuestan lo que trece imágenes. `duration` y `resolution`
// llegan del cliente, así que los dos se acotan aquí contra la tabla de precios
// — sin eso, un `duration: 900` en el cuerpo es una factura de tres cifras.

import { applyOriginCheck } from './_origin';
import { readBody, readPhoto, safeParse, methodGuard } from './_http';
import { moderateImage, moderateText } from './_moderation';
import { buildVideoPrompt } from './_videoPrompts';
import { verifyTicket } from './_ticket';
import { byId, FALLBACK_MODE, type Intensity } from './_modes';
import { isKnownVideoModel, videoMicros, videoResolutions, normalizeResolution, microsToEur } from './_pricing';

const FAL_TARGET = 'https://fal.run';

// Se pide por NOMBRE, nunca por ruta: aquí no hay paso de path, así que no hay
// forma de invocar un modelo que no esté en la tabla de precios.
const DEFAULT_MODEL = 'minimax/h3-max/image-to-video';

// 5 s es el mínimo del modelo y lo único que el prototipo usa. El tope existe
// porque el coste es lineal en la duración.
const MIN_SECONDS = 5;
const MAX_SECONDS = 10;

export default async function handler(req: any, res: any): Promise<void> {
  if (!applyOriginCheck(req, res)) return;
  if (!methodGuard(req, res)) return;

  const key = process.env.FALAI_TOKEN || process.env.FAL_KEY;
  if (!key) {
    res.status(500).json({ error: 'fal_key_missing', code: 'fal_key_missing' });
    return;
  }

  const body = readBody(req);

  const photo = readPhoto(body.imageBase64);
  if (!photo.ok) {
    res.status(photo.status).json({ error: photo.code, code: photo.code });
    return;
  }

  const mode = resolveMode(body);
  if (!mode) {
    // Un ticket caducado es lo normal (diez minutos mirando la foto) y el
    // cliente sabe rehacer /api/suggest; se distingue para que no lo trate
    // como un error de red.
    res.status(400).json({ error: 'invalid_mode', code: 'invalid_mode' });
    return;
  }

  const model = String(body.model || DEFAULT_MODEL);
  if (!isKnownVideoModel(model)) {
    res.status(403).json({ error: 'model_not_allowed', code: 'model_not_allowed' });
    return;
  }

  // fal valida la resolución como literal EN MAYÚSCULA ('480P'/'768P'): un
  // "768p" devuelve 422 sin generar nada. Se normaliza aquí para que ningún
  // cliente tenga que saberlo.
  const allowed = videoResolutions(model);
  const requested = normalizeResolution(body.resolution as string);
  const resolution = allowed.includes(requested) ? requested : '768P';
  const seconds = Math.min(
    MAX_SECONDS,
    Math.max(MIN_SECONDS, Math.round(Number(body.duration) || MIN_SECONDS))
  );

  let prompt: string;
  try {
    prompt = buildVideoPrompt({ motion: mode.motion, intensity: mode.intensity });
  } catch {
    res.status(400).json({ error: 'invalid_mode', code: 'invalid_mode' });
    return;
  }

  // Se moderan las dos entradas otra vez. /api/suggest ya miró la foto, pero
  // nada obliga a pasar por /api/suggest: esta función es alcanzable sola, y es
  // la que gasta dinero y manda la imagen a un tercero.
  const [textVerdict, imageVerdict] = await Promise.all([
    moderateText(prompt, process.env.OPENAI_API_KEY),
    moderateImage(photo.dataUri, process.env.OPENAI_API_KEY),
  ]);
  if (textVerdict.flagged || imageVerdict.flagged) {
    const categories = [...textVerdict.categories, ...imageVerdict.categories];
    console.warn(`[moderation] blocked ${imageVerdict.flagged ? 'photo' : 'prompt'}: ${categories.join(', ')}`);
    res.status(422).json({
      error: 'content_blocked',
      code: 'content_blocked',
      detail: 'No se puede animar esto: no cumple las normas de contenido.',
    });
    return;
  }

  const falBody = {
    prompt,
    // AQUÍ está la garantía del primer fotograma. Es la foto, sin recortar ni
    // reescalar por el camino: lo que el usuario encuadró es lo que arranca.
    image_url: photo.dataUri,
    duration: seconds,
    resolution,
  };

  try {
    const upstream = await fetch(`${FAL_TARGET}/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
      body: JSON.stringify(falBody),
    });
    const text = await upstream.text();

    if (!upstream.ok) {
      console.warn(`[video] fal ${upstream.status}: ${text.slice(0, 300)}`);
      res.status(upstream.status).json({ error: 'upstream_error', detail: text.slice(0, 300) });
      return;
    }

    const parsed = safeParse(text) as { video?: { url?: string } };
    const url = parsed?.video?.url;
    if (!url) {
      res.status(502).json({ error: 'no_video_returned', code: 'no_video_returned' });
      return;
    }

    // Se estima por lo PEDIDO, no por lo devuelto: fal factura los segundos
    // encargados y la respuesta no trae la duración real del mp4.
    const costEur = microsToEur(videoMicros(model, seconds, resolution));
    const falUnits = Number(upstream.headers.get('x-fal-billable-units'));
    console.log(
      `[video] ${model} ${seconds}s ${resolution} mode="${mode.label}" ~${costEur.toFixed(3)}€` +
        (Number.isFinite(falUnits) ? ` units=${falUnits}` : '')
    );

    // Solo lo que el cliente necesita. El mp4 lo descarga él directamente de
    // fal: pasar megabytes por una función serverless es ancho de banda tirado.
    res.status(200).json({
      video: { url },
      model,
      seconds,
      resolution,
      mode: mode.label,
      prompt,
      costEur,
    });
  } catch (err) {
    res.status(502).json({ error: 'fal_proxy_error', detail: (err as Error)?.message || String(err) });
  }
}

interface ResolvedMode {
  motion: string;
  intensity: Intensity;
  label: string;
}

/**
 * De lo que manda el cliente al movimiento que se va a dirigir. Dos entradas,
 * las dos verificadas contra algo que escribió el servidor:
 *
 *  - `ticket`: lo que compuso la visión, firmado en /api/suggest.
 *  - `modeId`: un id del catálogo fijo.
 *
 * No hay una tercera. Un `motion` suelto en el cuerpo se ignora, y ese es todo
 * el punto: el prompting vive en el servidor.
 */
function resolveMode(body: Record<string, unknown>): ResolvedMode | null {
  const payload = verifyTicket(body.ticket);
  if (payload) return { motion: payload.motion, intensity: payload.intensity, label: payload.label };

  // Un ticket presente que no verifica es un NO, no una invitación a elegir por
  // él: o está caducado (el cliente sabe rehacer /api/suggest) o no lo emitimos
  // nosotros. Gastar trece ilustraciones en un modo que nadie eligió sería la
  // peor forma de recuperarse.
  if (body.ticket) return null;

  if (typeof body.modeId === 'string') {
    const known = byId(body.modeId);
    return known ? { motion: known.motion, intensity: known.intensity, label: known.label } : null;
  }

  // Ni ticket ni id: una llamada directa, sin pasar por el carrusel (curl, un
  // script de pruebas). Se anima con el modo más conservador del catálogo.
  const { motion, intensity, label } = FALLBACK_MODE;
  return { motion, intensity, label };
}

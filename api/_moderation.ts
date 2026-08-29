// Moderación en el servidor, antes de que nada llegue al modelo de vídeo.
//
// Aquí pesa más que en Ridio. Allí la imagen de partida la había pintado
// nuestro propio pipeline; aquí la pone el usuario con la cámara, así que la
// entrada es literalmente "lo que sea que apunte alguien con un móvil". Se
// moderan las DOS cosas: la foto (image input) y el prompt compuesto.
//
// Política:
//  - FALLA CERRADO ante un positivo: 422 y no se genera nada.
//  - FALLA ABIERTO ante una CAÍDA de la moderación (sin clave, red, 5xx): se
//    genera igual. Tumbar la app entera por un error transitorio de OpenAI es
//    peor que el riesgo residual, que las guardas del prompt ya acotan.
//    Las caídas se registran.

const MODERATION_URL = 'https://api.openai.com/v1/moderations';
const MODEL = 'omni-moderation-latest';

export interface ModerationVerdict {
  flagged: boolean;
  categories: string[];
  /** true cuando la comprobación no pudo correr (los llamantes lo tratan como no marcado) */
  skipped?: boolean;
}

const CLEAN: ModerationVerdict = { flagged: false, categories: [] };

async function moderate(input: unknown[], key?: string): Promise<ModerationVerdict> {
  if (!key || !input.length) return { ...CLEAN, skipped: true };
  try {
    const res = await fetch(MODERATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input }),
    });
    if (!res.ok) {
      console.warn(`[moderation] upstream ${res.status}; failing open`);
      return { ...CLEAN, skipped: true };
    }
    const data = (await res.json()) as { results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }> };
    const results = data?.results || [];
    const categories = new Set<string>();
    let flagged = false;
    for (const r of results) {
      if (r?.flagged) flagged = true;
      for (const [name, hit] of Object.entries(r?.categories || {})) if (hit) categories.add(name);
    }
    return { flagged, categories: [...categories] };
  } catch (err) {
    console.warn(`[moderation] error: ${(err as Error)?.message}; failing open`);
    return { ...CLEAN, skipped: true };
  }
}

export const moderateText = (text: string, key?: string): Promise<ModerationVerdict> =>
  moderate(text?.trim() ? [{ type: 'text', text: text.slice(0, 8000) }] : [], key);

export const moderateImage = (dataUri: string, key?: string): Promise<ModerationVerdict> =>
  moderate(dataUri ? [{ type: 'image_url', image_url: { url: dataUri } }] : [], key);

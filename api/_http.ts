// Lo aburrido que si no se repite en cada función.

/** El cuerpo llega como objeto o como string según el runtime; aquí, siempre objeto. */
export function readBody(req: any): Record<string, unknown> {
  const raw = req?.body;
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// Tope del cuerpo de una función de Vercel: 4,5 MB. Una foto de 1024 px al 70%
// de calidad ronda los 200 KB en base64, así que este límite solo lo toca quien
// manda el original de 12 megapíxeles — y a ese conviene decirle que no ANTES de
// haber pagado la moderación de una imagen enorme.
const MAX_BASE64_CHARS = 4_000_000;

export interface PhotoResult {
  ok: true;
  base64: string;
  dataUri: string;
}
export interface PhotoError {
  ok: false;
  status: number;
  code: string;
}

/**
 * Valida la foto que llega del cliente. Acepta base64 pelado o data URI, y
 * devuelve las dos formas: fal quiere `data:`, el registro quiere el crudo.
 */
export function readPhoto(value: unknown): PhotoResult | PhotoError {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, status: 400, code: 'missing_image' };
  if (raw.length > MAX_BASE64_CHARS) return { ok: false, status: 413, code: 'image_too_large' };

  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(raw);
  const base64 = m ? m[2] : raw;
  const mime = m ? m[1].toLowerCase() : 'image/jpeg';
  // base64 y nada más: lo que se cuela aquí acaba dentro de una URL que se le
  // manda a un tercero.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 512) {
    return { ok: false, status: 400, code: 'invalid_image' };
  }
  return { ok: true, base64, dataUri: `data:${mime};base64,${base64}` };
}

export const methodGuard = (req: any, res: any, method = 'POST'): boolean => {
  if (req?.method === method) return true;
  res.status(405).json({ error: 'method_not_allowed', code: 'method_not_allowed' });
  return false;
};

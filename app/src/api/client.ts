// El único sitio de la app que habla con el backend.
//
// Camino único a propósito, igual que `ImageGenerationService` lo es en Ridio:
// si mañana hay que meter reintentos, telemetría o una pantalla de cuota, hay
// UN fichero donde meterlo. Un `fetch` suelto en una pantalla es un error, no
// un atajo.
//
// Y fíjate en lo que este fichero NO tiene: ni una línea de texto en inglés
// dirigida a un modelo. La app manda datos (una foto, un ticket) y el servidor
// compone el prompt. Es lo que permite afinar un modo con un despliegue en vez
// de con una actualización de la App Store esperando a que la gente la instale.

import { API_BASE, LOCALE } from './config';

export interface Mode {
  id: string;
  label: string;
  emoji: string;
  surprise: boolean;
  /** opaco y firmado por el servidor: se devuelve tal cual, no se inspecciona */
  ticket: string;
}

export interface SuggestResult {
  modes: Mode[];
  /** 'vision' = los propuso el modelo mirando la foto; 'catalog' = plan B */
  source: 'vision' | 'catalog';
  subject?: string;
  costEur?: number;
}

export interface Clip {
  url: string;
  seconds: number;
  mode: string;
  costEur?: number;
  /** el prompt que se usó: el prototipo lo enseña, un producto no lo haría */
  prompt?: string;
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

const MESSAGES: Record<string, string> = {
  content_blocked: 'Esta foto no se puede animar: no cumple las normas de contenido.',
  image_too_large: 'La foto es demasiado grande.',
  invalid_mode: 'Ese modo ha caducado. Vuelve a disparar.',
  fal_key_missing: 'El servidor no tiene configurada la clave de vídeo.',
  upstream_error: 'El generador de vídeo ha fallado. Inténtalo otra vez.',
  network: 'Sin conexión con el servidor.',
};

const message = (code: string): string => MESSAGES[code] || 'Algo ha salido mal.';

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    throw new ApiError(aborted ? 'timeout' : 'network', aborted ? 'Ha tardado demasiado.' : message('network'));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string; detail?: string };
    const code = data.code || data.error || `http_${res.status}`;
    throw new ApiError(code, data.detail || message(code), res.status);
  }
  return (await res.json()) as T;
}

/**
 * La foto entra, cuatro modos salen. Nunca lanza por culpa del modelo: si la
 * visión se cae, el servidor responde 200 con el catálogo. Solo lanza si la
 * foto está bloqueada o no hay servidor, que son las dos cosas que el usuario
 * sí tiene que saber.
 */
export const suggestModes = (imageBase64: string): Promise<SuggestResult> =>
  post<SuggestResult>('/api/suggest', { imageBase64, locale: LOCALE }, 15_000);

/**
 * El clip. `ticket` es lo que devolvió `suggestModes` sin tocar; `modeId` es la
 * vía del catálogo, para cuando no hubo visión.
 */
export async function animate(imageBase64: string, mode: Mode): Promise<Clip> {
  const data = await post<{
    video: { url: string };
    seconds: number;
    mode: string;
    costEur?: number;
    prompt?: string;
  }>(
    '/api/video',
    mode.ticket ? { imageBase64, ticket: mode.ticket } : { imageBase64, modeId: mode.id },
    // Generoso: H3 Max tarda ~3 s en inferencia, pero la cola de fal en hora
    // punta y la subida de la foto desde un móvil con mala cobertura no.
    120_000
  );
  return {
    url: data.video.url,
    seconds: data.seconds,
    mode: data.mode,
    costEur: data.costEur,
    prompt: data.prompt,
  };
}

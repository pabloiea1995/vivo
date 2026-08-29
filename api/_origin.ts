// La puerta de entrada: quién puede llamar a las funciones que gastan dinero.
//
// Dos comprobaciones independientes, y hacen falta las dos porque protegen de
// cosas distintas.
//
// **Origen** bloquea el abuso específico de navegador: que otra web invoque nuestras
// funciones desde el navegador de sus visitantes, con nuestras claves y a
// nuestra cuenta.
//
// Deliberadamente permisivo con el Origin AUSENTE: la app nativa (React Native)
// y cualquier herramienta de línea de comandos no mandan Origin, y un cliente
// que no sea navegador puede falsificarlo igualmente. Solo se rechaza a quien
// AFIRMA un origen de navegador que no reconocemos.

const DEFAULT_ALLOWED = [
  'http://localhost:8081', // expo web / metro
  'http://localhost:3000',
];

const VERCEL_ALIAS_RE = /^https:\/\/[a-z0-9-]*vivo[a-z0-9-]*\.vercel\.app$/;

export function originAllowed(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const raw = req.headers?.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (!origin) return true;
  const extra = (process.env.VIVO_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return DEFAULT_ALLOWED.includes(origin) || VERCEL_ALIAS_RE.test(origin) || extra.includes(origin);
}

/** Aplica la comprobación y escribe el 403 él mismo; `true` = seguir. */
export function applyOriginCheck(
  req: { headers?: Record<string, string | string[] | undefined> },
  res: { status(code: number): { json(body: unknown): void } }
): boolean {
  if (originAllowed(req)) return true;
  res.status(403).json({ error: 'forbidden_origin', code: 'forbidden_origin' });
  return false;
}

// ─── Clave compartida ────────────────────────────────────────────────────────
//
// La comprobación de origen NO protege del abuso real. Un `curl` no manda
// Origin, así que pasa — y tiene que pasar, porque la app nativa tampoco lo
// manda. Contra alguien que encuentre la URL del despliegue y le meta un bucle,
// lo único que sirve es un secreto que la app conoce y el resto del mundo no.
//
// FALLA ABIERTO cuando `VIVO_APP_SECRET` no está puesta, y es a propósito: un
// prototipo recién desplegado tiene que funcionar antes de configurar nada. En
// cuanto la variable existe, FALLA CERRADO — poner el secreto es el interruptor.
//
// No es autenticación de usuario: es una cerradura contra el paseante. Todos
// los instaladores de la app comparten la misma clave, así que un binario
// distribuido la regala. Para más de eso hace falta cuota por llamante, que es
// lo que Ridio tiene en `api/_quota.ts` y este prototipo no.

export function appKeyAllowed(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const expected = (process.env.VIVO_APP_SECRET || '').trim();
  if (!expected) return true;
  const raw = req.headers?.['x-vivo-key'];
  const got = Array.isArray(raw) ? raw[0] : raw;
  return typeof got === 'string' && got === expected;
}

/**
 * Origen + clave, que es lo que toda función que gasta dinero debe llamar
 * primero. Escribe el 403 ella misma; `true` = seguir.
 */
export function applyAccessCheck(
  req: { headers?: Record<string, string | string[] | undefined> },
  res: { status(code: number): { json(body: unknown): void } }
): boolean {
  if (!applyOriginCheck(req, res)) return false;
  if (appKeyAllowed(req)) return true;
  res.status(403).json({ error: 'forbidden', code: 'forbidden' });
  return false;
}

// Comprobación de origen para los proxies de IA.
//
// Bloquea el único abuso específico de navegador: que otra web invoque nuestras
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

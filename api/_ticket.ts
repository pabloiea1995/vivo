// El ticket: cómo viaja un modo propuesto por GPT hasta la petición de vídeo
// sin pasar por las manos del cliente.
//
// El problema. `/api/suggest` compone tres `motion` a medida de la foto y el
// usuario elige uno en la pantalla siguiente, así que ese texto tiene que
// sobrevivir a un viaje de ida y vuelta por el navegador. Devolverlo en claro y
// aceptarlo de vuelta convertiría el prototipo en un generador de vídeo con
// prompt libre y nuestra clave de fal: exactamente lo que la regla de "ningún
// cliente compone prompts" existe para impedir.
//
// La solución barata. Se firma. El cliente recibe un blob opaco, lo devuelve
// tal cual, y aquí se comprueba la firma antes de mirar el contenido. Un texto
// que no salió de este servidor no verifica, y uno que sí salió no ha podido
// cambiar por el camino.
//
// Por qué firmar y no guardar en una base de datos: no hay estado que mantener,
// no hay TTL que purgar y el prototipo despliega en Vercel sin tocar Redis. El
// coste es que el ticket lleva su propia caducidad dentro (`exp`).
//
// Web Crypto y no `node:crypto`: es la misma primitiva (HMAC-SHA256) con dos
// ventajas. Sirve igual en cualquier runtime —Node, edge, un Worker— y, sobre
// todo, es la única forma de que este fichero se compile sin `@types/node`, que
// el build de Vercel no instala. `subtle.verify` compara además en tiempo
// constante por contrato, así que no hay que escribirlo a mano.

import { isIntensity, type Intensity } from './_modes';

export interface TicketPayload {
  /** el texto de movimiento que compuso el servidor */
  motion: string;
  intensity: Intensity;
  /** la etiqueta que se le enseñó al usuario, solo para el registro */
  label: string;
  /** epoch ms a partir del cual el ticket ya no vale */
  exp: number;
}

// Diez minutos: lo que tarda alguien en mirar la foto, dudar entre cuatro
// modos y decidirse. Más allá de eso, la sesión es otra y conviene volver a
// pasar por la visión (la foto puede haberse quedado obsoleta en la pantalla).
const TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas: desde TS 5.7 el tipo es
// genérico sobre el buffer, y el genérico por defecto incluye SharedArrayBuffer,
// que Web Crypto no acepta. Fijarlo aquí evita un `as any` en cada llamada.
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// De dónde sale la clave de firma, y por qué esto es más importante de lo que
// parece.
//
// La primera versión generaba un secreto aleatorio por proceso cuando
// `VIVO_TICKET_SECRET` no estaba puesta, con el argumento de que "falla del
// lado seguro". Era falso, y de la peor manera: `/api/suggest` y `/api/video`
// son DOS funciones serverless distintas, así que NUNCA comparten proceso. El
// ticket que firmaba una jamás verificaba en la otra, y el usuario veía "ese
// modo ha caducado" en absolutamente todos los intentos. Un respaldo que falla
// siempre no es un respaldo, es una bomba de relojería con documentación.
//
// Ahora la clave se DERIVA (HKDF) de un secreto que ya existe en el entorno y
// es el mismo para todas las funciones del despliegue. El orden es de más
// específico a más disponible; `FALAI_TOKEN` sirve de ancla porque sin ella no
// hay vídeo que animar, así que si el prototipo funciona, existe.
//
// Derivar y no usar el secreto tal cual: así la clave de firma no ES la clave
// del proveedor, y el `info` distinto garantiza que no colisiona con ningún
// otro uso.
let keyPromise: Promise<CryptoKey> | null = null;

function seed(): Uint8Array<ArrayBuffer> {
  const configured = process.env.VIVO_TICKET_SECRET;
  if (configured && configured.length >= 16) return enc.encode(configured);
  const anchor = process.env.FALAI_TOKEN || process.env.FAL_KEY || process.env.OPENAI_API_KEY;
  if (anchor) return enc.encode(anchor);
  // Sin ninguna clave configurada el prototipo no puede generar nada de todas
  // formas, así que aquí ya no hay nada que romper.
  console.warn('[ticket] sin secreto ni clave de proveedor: los tickets no cruzarán funciones');
  return crypto.getRandomValues(new Uint8Array(32));
}

function hmacKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  keyPromise = crypto.subtle
    .importKey('raw', seed(), 'HKDF', false, ['deriveKey'])
    .then((material) =>
      crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode('vivo.ticket.v1'),
          info: enc.encode('mode-ticket'),
        },
        material,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      )
    );
  return keyPromise;
}

export async function signTicket(p: Omit<TicketPayload, 'exp'>): Promise<string> {
  const payload: TicketPayload = { ...p, exp: Date.now() + TTL_MS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(mac))}`;
}

/** `null` para cualquier ticket que no sea nuestro, esté tocado o haya caducado. */
export async function verifyTicket(ticket: unknown): Promise<TicketPayload | null> {
  if (typeof ticket !== 'string' || ticket.length > 4096) return null;
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(),
      fromB64url(ticket.slice(dot + 1)),
      enc.encode(body)
    );
  } catch {
    // base64 inválido en la firma: no es nuestro y no hay más que mirar
    return null;
  }
  if (!valid) return null;

  try {
    const parsed = JSON.parse(dec.decode(fromB64url(body))) as TicketPayload;
    if (typeof parsed?.motion !== 'string' || !parsed.motion.trim()) return null;
    if (!isIntensity(parsed?.intensity)) return null;
    if (typeof parsed?.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

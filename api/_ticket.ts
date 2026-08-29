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

// Sin secreto configurado se genera uno al arrancar la función. Es SUFICIENTE
// para lo que el ticket protege (que el cliente no escriba el prompt) y falla
// del lado seguro: cada instancia serverless firma con el suyo, así que un
// ticket emitido por otra simplemente no verifica y el cliente ve "ese modo ha
// caducado". En un despliegue serio se pone `VIVO_TICKET_SECRET`.
let keyPromise: Promise<CryptoKey> | null = null;

function hmacKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  const configured = process.env.VIVO_TICKET_SECRET;
  const raw =
    configured && configured.length >= 16
      ? enc.encode(configured)
      : crypto.getRandomValues(new Uint8Array(32));
  keyPromise = crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
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

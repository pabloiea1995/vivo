// El ticket: cómo viaja un modo propuesto por GPT hasta la petición de vídeo
// sin pasar por las manos del cliente.
//
// El problema. `/api/suggest` compone tres `motion` a medida de la foto y el
// usuario elige uno en la pantalla siguiente, así que ese texto tiene que
// sobrevivir a un viaje de ida y vuelta por el móvil. Devolverlo en claro y
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

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
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

// Sin secreto configurado se genera uno al arrancar la función. Es SUFICIENTE
// para lo que el ticket protege (que el cliente no escriba el prompt) y falla
// del lado seguro: cada instancia serverless firma con el suyo, así que un
// ticket emitido por otra simplemente no verifica y el cliente cae al catálogo.
// En un despliegue serio se pone `VIVO_TICKET_SECRET` y deja de haber sorpresas.
const secret = (): Buffer => {
  const env = process.env.VIVO_TICKET_SECRET;
  if (env && env.length >= 16) return Buffer.from(env, 'utf8');
  if (!ephemeral) ephemeral = randomBytes(32);
  return ephemeral;
};
let ephemeral: Buffer | null = null;

const b64url = (b: Buffer): string => b.toString('base64url');

export function signTicket(p: Omit<TicketPayload, 'exp'>): string {
  const payload: TicketPayload = { ...p, exp: Date.now() + TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = b64url(createHmac('sha256', secret()).update(body).digest());
  return `${body}.${mac}`;
}

/** `null` para cualquier ticket que no sea nuestro, esté tocado o haya caducado. */
export function verifyTicket(ticket: unknown): TicketPayload | null {
  if (typeof ticket !== 'string' || ticket.length > 4096) return null;
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const mac = ticket.slice(dot + 1);

  const expected = b64url(createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // longitudes distintas → timingSafeEqual lanza, así que se comprueba antes;
  // la longitud del MAC no es secreta.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketPayload;
    if (typeof parsed?.motion !== 'string' || !parsed.motion.trim()) return null;
    if (!isIntensity(parsed?.intensity)) return null;
    if (typeof parsed?.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

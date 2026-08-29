// El catálogo de MODOS de animación: la pieza que decide qué se le puede pedir
// al modelo de vídeo.
//
// Un modo no es una etiqueta bonita: es una política de movimiento completa
// (cuánto se mueve la cámara, qué puede cambiar de la foto, si suena algo). El
// texto que acaba en el modelo se compone en `_videoPrompts.ts` a partir de
// esto, nunca en el cliente (esa es la regla que hace que afinar un modo sea un
// despliegue y no una actualización de la App Store).
//
// Dos orígenes, misma forma:
//
//  1. **Propuestos**: GPT mira la foto y escribe tres `motion` a medida de lo
//     que ve. Vuelven al cliente dentro de un ticket firmado (`_ticket.ts`), así
//     que el texto que el servidor compuso es el mismo que el servidor recibe.
//  2. **De catálogo**: los de aquí abajo. Son el plan B cuando la visión falla
//     (sin clave, timeout, 5xx) y el suelo de calidad del prototipo: sirven para
//     cualquier foto porque no dependen de qué haya en ella.

/** Cuánta libertad se le da al modelo. Manda sobre la cámara y sobre el aire. */
export type Intensity = 'subtle' | 'cinematic' | 'wild';

export interface Mode {
  id: string;
  /** lo que se lee bajo el círculo del carrusel; corto o no cabe */
  label: string;
  emoji: string;
  /**
   * Qué se mueve, en inglés visual y en imperativo. Es lo ÚNICO específico de
   * la foto: todo lo demás (identidad, encuadre, audio) lo ponen las guardas.
   */
  motion: string;
  intensity: Intensity;
  /** el modo "sorpresa": el carrusel lo enseña tapado hasta que se usa */
  surprise?: boolean;
}

// Seis modos que funcionan sobre CUALQUIER foto porque describen fenómenos del
// aire y de la luz, no del sujeto. Es la diferencia entre "que le dé el viento"
// (vale para un perro, un plato de pasta o un edificio) y "que mueva la cola"
// (vale para un perro y estropea las otras dos).
export const CATALOG: Mode[] = [
  {
    id: 'breathe',
    label: 'Respira',
    emoji: '🫧',
    intensity: 'subtle',
    motion:
      'Bring the still to life with barely-there movement: a slow breath, an eye blink, hair and fabric stirring in a faint draught, dust motes drifting through the light.',
  },
  {
    id: 'cinematic',
    label: 'Cine',
    emoji: '🎬',
    intensity: 'cinematic',
    motion:
      'Play the moment as a single cinematic shot: shallow depth of field, a slow deliberate drift of the camera, light raking across the subject, the atmosphere settling around it.',
  },
  {
    id: 'weather',
    label: 'Tormenta',
    emoji: '🌧️',
    intensity: 'cinematic',
    motion:
      'Weather rolls in over the scene: the light drops and turns cold, wind picks up, rain or snow starts falling through the frame, surfaces darken and glisten.',
  },
  {
    id: 'goldenhour',
    label: 'Hora dorada',
    emoji: '🌅',
    intensity: 'cinematic',
    motion:
      'The light warms and lowers into golden hour: long amber light sweeps across the scene, shadows stretch, dust and haze catch the sun, everything glows.',
  },
  {
    id: 'dreamy',
    label: 'Sueño',
    emoji: '💫',
    intensity: 'wild',
    motion:
      'The scene slips into a daydream: colours bloom, soft light leaks and floating particles drift in, the edges of the frame breathe and shimmer gently.',
  },
  {
    id: 'chaos',
    label: 'Sorpresa',
    emoji: '🎲',
    intensity: 'wild',
    surprise: true,
    motion:
      'Something unexpected but harmless happens in the scene: an improbable creature wanders through the background, gravity loosens for a second, the weather does something it should not. Keep it playful and keep the subject intact.',
  },
];

export const byId = (id: string): Mode | undefined => CATALOG.find((m) => m.id === id);

/** El modo de catálogo que se usa cuando ni siquiera llega un id válido. */
export const FALLBACK_MODE = CATALOG[0];

export const isIntensity = (v: unknown): v is Intensity =>
  v === 'subtle' || v === 'cinematic' || v === 'wild';

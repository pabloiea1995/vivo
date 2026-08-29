// El catálogo de MODOS de animación: la pieza que decide qué se le puede pedir
// al modelo de vídeo.
//
// Un modo no es una etiqueta bonita: es una política de movimiento completa
// (cuánto se mueve la cámara, qué puede aparecer en la foto, si suena algo). El
// texto que acaba en el modelo se compone en `_videoPrompts.ts` a partir de
// esto, nunca en el cliente — esa es la regla que hace que afinar un modo sea
// un despliegue y no una versión nueva del cliente.
//
// Dos orígenes, misma forma:
//
//  1. **Propuestos**: GPT mira la foto y escribe tres `motion` a medida de lo
//     que ve. Vuelven al cliente dentro de un ticket firmado (`_ticket.ts`), así
//     que el texto que el servidor compuso es el mismo que el servidor recibe.
//  2. **De catálogo**: los de aquí abajo. Son el plan B cuando la visión falla
//     (sin clave, timeout, 5xx) y el suelo de calidad del prototipo.

/**
 * Cuánta libertad se le da al modelo. Manda sobre la cámara y, sobre todo,
 * sobre si pueden APARECER cosas que no estaban en la foto.
 */
export type Intensity = 'subtle' | 'cinematic' | 'wild';

export interface Mode {
  id: string;
  /** lo que se lee bajo el círculo del carrusel; corto o no cabe */
  label: string;
  emoji: string;
  /**
   * Qué pasa, en inglés visual y en imperativo. Es lo ÚNICO específico de la
   * foto: la identidad, el encuadre y el audio los ponen las guardas.
   */
  motion: string;
  intensity: Intensity;
  /** el modo "sorpresa": el carrusel lo enseña tapado hasta que se usa */
  surprise?: boolean;
}

// El catálogo es casi todo ESPECTÁCULO, y es una corrección deliberada.
//
// La primera versión venía de Ridio, donde el vídeo ilustra una novela y lo que
// se pide es contención: brisa, respiración, la luz cambiando. Aquí eso es un
// error de producto. Nadie saca el móvil, hace una foto y espera diez segundos
// para ver la misma foto con un poco de viento. Lo que hace que quieras
// enseñárselo a alguien es que aparezca una nave sobre tu calle.
//
// Se queda UN modo contenido —"Respira"— porque es el que demuestra que el
// vídeo es de verdad tu foto, y ese contraste hace que los otros impresionen
// más. El resto describen fenómenos que caben sobre cualquier imagen: algo que
// llega por el cielo, algo que le pasa a la luz, algo que entra en el fondo.
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
    id: 'ufo',
    label: 'Nave',
    emoji: '🛸',
    intensity: 'wild',
    motion:
      'A vast alien mothership slides silently into the sky above the scene, its underside glowing. Its shadow sweeps across everything below, light beams rake down, and dust and loose objects lift in the downdraft.',
  },
  {
    id: 'hero',
    label: 'Superhéroe',
    emoji: '🦸',
    intensity: 'wild',
    motion:
      'A caped figure drops out of the sky and lands hard in the scene, cracking the ground and blasting a ring of dust outward, then rises slowly to standing as the debris settles around them.',
  },
  {
    id: 'psychedelic',
    label: 'Psicodelia',
    emoji: '🌀',
    intensity: 'wild',
    motion:
      'Reality melts into a psychedelic trip: colours bleed and oversaturate into impossible hues, surfaces ripple and breathe, fractal patterns bloom outwards and kaleidoscopic trails follow every movement.',
  },
  {
    id: 'kaiju',
    label: 'Kaiju',
    emoji: '🦖',
    intensity: 'wild',
    motion:
      'A colossal creature rises far behind the scene, dwarfing everything. The ground trembles, dust shakes loose, birds scatter, and it lets out a roar that ripples the air.',
  },
  {
    id: 'portal',
    label: 'Portal',
    emoji: '🌌',
    intensity: 'wild',
    motion:
      'A glowing rift tears open in mid-air within the scene, spilling light and drifting embers. Through it another world is faintly visible, and the air around its edges warps and shimmers.',
  },
  {
    id: 'storm',
    label: 'Tormenta',
    emoji: '🌩️',
    intensity: 'cinematic',
    motion:
      'A violent storm rolls in fast: the light drops and turns cold and blue, wind whips through the frame, rain lashes down and lightning cracks across the sky, throwing hard white flashes over everything.',
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
    id: 'chaos',
    label: 'Sorpresa',
    emoji: '🎲',
    intensity: 'wild',
    surprise: true,
    motion:
      'Something gloriously unexpected takes over the scene: an absurd creature, a physics-defying event, a sudden genre shift into something nobody would predict from this photo. Make it funny and harmless, and keep the people in the frame exactly as they are.',
  },
];

export const byId = (id: string): Mode | undefined => CATALOG.find((m) => m.id === id);

/**
 * Los cuatro del plan B: uno contenido para anclar, dos espectaculares y la
 * sorpresa — la misma forma que devuelve la visión.
 *
 * Los dos del medio se sortean. Cuesta una línea y evita lo peor de un plan B:
 * que quien se lo encuentre dos veces piense que la app tiene cuatro modos
 * fijos. Con la visión caída el carrusel es peor, pero al menos no es el mismo.
 */
export function fallbackModes(): Mode[] {
  const quiet = byId('breathe') as Mode;
  const surprise = CATALOG.find((m) => m.surprise) as Mode;
  const spectacle = CATALOG.filter((m) => m !== quiet && !m.surprise);
  for (let i = spectacle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spectacle[i], spectacle[j]] = [spectacle[j]!, spectacle[i]!];
  }
  return [quiet, ...spectacle.slice(0, 2), surprise];
}

/** El modo que se usa en una llamada directa, sin ticket ni id. */
export const FALLBACK_MODE = CATALOG[0];

export const isIntensity = (v: unknown): v is Intensity =>
  v === 'subtle' || v === 'cinematic' || v === 'wild';

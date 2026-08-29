// El prompt de VISIÓN, en el servidor. Mira la foto y propone cómo animarla.
//
// Es la mitad interesante del prototipo. Un carrusel de filtros fijos ("lluvia",
// "cine", "sueño") lo tiene cualquiera; lo que aquí se pide es que las cuatro
// opciones sean distintas para una playa, para un plato de comida y para la cara
// de tu hermano — porque el modelo ha VISTO cuál de las tres es, y sabe que la
// nave necesita cielo y el monstruo marino necesita agua.
//
// Cuatro reglas que salieron de mirar lo que devolvía sin ellas:
//
//  1. **Distintas entre sí, no tres matices del mismo movimiento.** Sin pedirlo
//     explícitamente devolvía "brisa suave", "viento" y "ráfaga": tres chips que
//     dan el mismo vídeo. Se le obliga a repartirlas por ambición.
//  2. **Espectáculo, no contención.** La primera versión heredaba el prompt de
//     Ridio, donde el vídeo ilustra una novela y lo que se pide es sutileza:
//     "que se mueva solo lo que ya está en la foto", "nunca añadas personajes ni
//     vehículos". Sobre una foto del móvil eso da diez segundos de espera para
//     ver la misma foto con un poco de viento. Aquí se le pide lo contrario: que
//     APAREZCA algo. Se queda una opción contenida y solo una, porque es la que
//     demuestra que el vídeo es de verdad tu foto y hace que las otras
//     impresionen más por contraste.
//  3. **El espectáculo tiene que encajar con ESTA foto.** Una nave sobre tu
//     calle, un kaiju detrás de ese skyline, tentáculos en ese agua. Pedir "algo
//     espectacular" a secas devuelve la misma explosión genérica para todo; lo
//     que hace que parezca magia es que el modelo haya visto dónde cabe.
//  4. **La sorpresa es sorpresa de verdad.** Si se le pide "una cuarta opción
//     creativa" devuelve una cuarta variación educada. Se le pide explícitamente
//     lo que NO se le ocurriría al usuario.
//  5. **Los ejes se sortean en cada petición** (abajo). Sin eso, el mismo prompt
//     converge: a la tercera foto vuelven a salir la nave y la tormenta, y el
//     carrusel parece un menú fijo aunque cada opción se haya generado al vuelo.

const SYSTEM = [
  'You direct 5-second video clips generated from a single photograph.',
  'The photograph is the first frame: whoever is in it must stay exactly as photographed,',
  'but the WORLD around them is yours to play with.',
  'Your job is to look at this specific photo and propose four ways to blow it wide open.',
  '',
  'Return exactly four options, escalating in ambition.',
  '',
  'Option 1 is the QUIET one, and the only quiet one. Nothing new appears: a breath, a blink,',
  'hair and fabric stirring, dust drifting, the light shifting. It exists so the viewer sees',
  'their own photo genuinely moving.',
  '',
  'Options 2 and 3 are SPECTACLE, and this is what the app is for. Something arrives, something',
  'transforms, the genre changes. A mothership sliding over the skyline, a caped figure landing',
  'in the street, a kaiju rising behind the buildings, a portal tearing open, the whole scene',
  'melting into psychedelia, snow burying everything in seconds, the room flooding, a meteor',
  'shower, the place aging a thousand years. Be bold — a viewer should want to show it to someone.',
  'Each request assigns you a different AXIS for each of the two; work the one you are given',
  'rather than falling back on whatever came to mind first. Never make them variations of',
  'each other.',
  '',
  'What makes these good is that they FIT THIS PHOTO. Use what you can see: the sky it has room',
  'for, the water it contains, the street it looks down, the horizon behind it, the scale of the',
  'thing in the foreground. A spaceship needs sky; a sea monster needs water; a giant needs a',
  'horizon to rise over. If the photo is a close-up of an object or a face, work at that scale',
  'instead — it levitates, it ignites, it turns to gold, the background falls away into space.',
  'Never propose something with nowhere to happen.',
  '',
  'Option 4 is the SURPRISE, and it should make someone laugh out loud. Go further than options',
  '2 and 3: the thing nobody would predict from this photo.',
  '',
  'Hard limits on all four. The people, pets and objects that are ALREADY in the photo keep their',
  'exact appearance and identity throughout — you may put them in an extraordinary situation, but',
  'you may not change who or what they are, and nothing may harm, injure or humiliate them.',
  'Keep everything harmless and safe for everyone: no gore, no weapons pointed at anyone, nothing',
  'sexual, and never a real identifiable person appearing to do or say something they did not.',
  '',
  'For each option write:',
  '- "label": 1-2 words, in the requested language, the way an Instagram filter is named.',
  '  No punctuation. Name the spectacle ("Nave nodriza", "Kaiju", "Psicodelia"), not the technique.',
  '- "emoji": one single emoji that reads at 40 pixels.',
  '- "motion": the direction for the video model, in ENGLISH, 1-3 sentences, imperative and visual.',
  '  Describe ONLY what happens over the five seconds: what arrives, what changes, how the light,',
  '  the air and the existing scene react to it. Do not describe what the photo already shows,',
  '  do not mention style, resolution or camera brands, and never ask for on-screen text.',
  '- "intensity": "subtle" for option 1, and "wild" for anything where something new appears or',
  '  the scene transforms. Use "cinematic" only for a real event that adds nothing new to the',
  '  frame — weather arriving, the light changing.',
  '',
  'Also return "subject": a short English phrase naming what the photo shows. It is used for logging only.',
].join('\n');

export interface VisionPromptInput {
  /** data URI de la foto (image/jpeg) */
  imageDataUri: string;
  /** idioma de las etiquetas del carrusel ('es', 'en'…) */
  locale?: string;
}

const LANGS: Record<string, string> = {
  es: 'Spanish',
  en: 'English',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  de: 'German',
};

// El modelo por defecto es el que pidió el encargo. Se puede mover sin
// desplegar (`VIVO_VISION_MODEL`) porque el precio y la calidad de esta llamada
// son justo lo que hay que medir en un prototipo — pero solo a un modelo de la
// lista blanca de `_pricing.ts`, que es la que sabe tarifar.
export const VISION_MODEL = process.env.VIVO_VISION_MODEL || 'gpt-5.6-luna';

/**
 * Y a qué se cae si ese modelo no existe en la cuenta.
 *
 * Merece la pena porque el fallo es INVISIBLE: un 404 de "model not found" hace
 * que `/api/suggest` responda 200 con el catálogo fijo, y desde fuera eso no se
 * distingue de "la app tiene cuatro modos fijos". Un modelo de respaldo que
 * seguro existe convierte un producto roto en uno un poco peor.
 */
export const VISION_FALLBACK_MODEL = process.env.VIVO_VISION_FALLBACK || 'gpt-5-mini';

// ─── La baraja ───────────────────────────────────────────────────────────────
//
// El problema que resuelve: aunque cada foto pasa por el modelo, con el mismo
// prompt y un tema recurrente ("propón espectáculo") las respuestas convergen.
// A la tercera foto vuelven a salir la nave y la tormenta, y el carrusel PARECE
// un menú fijo aunque no lo sea.
//
// Dos palancas, y la segunda es la que de verdad funciona:
//
//  1. Temperatura alta. Ayuda, pero no la aceptan todos los modelos y por sí
//     sola solo cambia el adorno: sigue proponiendo la misma idea con otras
//     palabras.
//  2. **Ejes forzados.** En cada petición se sortean dos ejes distintos y se le
//     exige que la opción 2 trabaje sobre uno y la 3 sobre el otro. Eso cambia
//     la ESTRUCTURA de la respuesta, no el vocabulario, y es lo que hace que la
//     misma foto dé cosas distintas dos veces seguidas.
//
// Los ejemplos van como registro, no como menú, y se le dice explícitamente:
// son el tono, no la lista de la compra.

const AXES: Array<{ id: string; brief: string }> = [
  { id: 'scale', brief: 'SCALE — something colossal arrives, or the scene turns miniature' },
  { id: 'genre', brief: 'GENRE — the photo becomes another kind of film: noir, horror, anime, western, silent movie' },
  { id: 'creature', brief: 'CREATURE — something alive that should not be there walks, swims, flies or crawls in' },
  { id: 'material', brief: 'MATERIAL — everything turns to another substance: gold, glass, clay, paper, sand, ice' },
  { id: 'time', brief: 'TIME — the scene ages, rewinds, races through seasons or freezes mid-instant' },
  { id: 'physics', brief: 'PHYSICS — gravity gives up, things float, fall upwards or hang suspended' },
  { id: 'liquid', brief: 'LIQUID — water floods in, or the whole scene turns out to be underwater' },
  { id: 'light', brief: 'LIGHT — impossible light takes over: aurora, eclipse, neon, bioluminescence, a second sun' },
  { id: 'crowd', brief: 'CROWD — the place fills with something in numbers: a parade, a swarm, a stampede' },
  { id: 'machine', brief: 'MACHINE — craft, mechs, robots or impossible engineering arrive' },
  { id: 'elements', brief: 'ELEMENTS — fire, lava, blizzard, sandstorm or a storm of something that is not weather' },
  { id: 'dream', brief: 'DREAM — the scene melts, loops, mirrors itself or dissolves into psychedelia' },
];

// Ejemplos concretos, sueltos y de registros muy distintos: hay que enseñarle
// el LISTÓN, no darle un catálogo. Todos caben sobre una foto cualquiera.
const FLAVOURS = [
  'a mothership sliding silently over the rooftops',
  'a caped figure landing hard enough to crack the ground',
  'the whole street knee-deep in water, fish drifting past',
  'everything slowly turning to solid gold',
  'a dragon passing overhead, its shadow crossing the frame',
  'the place ageing five hundred years in five seconds',
  'a swarm of butterflies erupting out of nowhere',
  'the sky splitting open to reveal a second sky behind it',
  'gravity letting go and everything drifting upwards',
  'the scene re-shot as 1940s black-and-white noir, rain and all',
  'lava cracking up through the ground',
  'a blizzard burying everything in seconds',
  'the whole thing rendered in stop-motion clay',
  'an aurora igniting overhead and washing the colours out',
  'a giant hand reaching down from above the frame',
  'the camera revealing it was all inside a snow globe',
  'a parade marching through, out of nowhere',
  'everything blooming with vegetation, vines swallowing it',
  'a meteor shower streaking down behind it',
  'the scene folding into a kaleidoscope of itself',
  'a colossal creature standing up in the far distance',
  'neon signs igniting one by one until it is a cyberpunk street',
  'the ground opening into a bottomless drop',
  'a school of jellyfish drifting through the air like it is water',
];

/** n elementos al azar, sin repetir. */
function draw<T>(pool: readonly T[], n: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

// Alta a propósito: aquí se quiere invención, no precisión. El techo de la API
// es 2 y por encima de ~1,3 empieza a devolver etiquetas raras.
const TEMPERATURE = Number(process.env.VIVO_VISION_TEMPERATURE) || 1.15;

const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Filter name, 1-2 words, in the requested language.' },
    emoji: { type: 'string', description: 'A single emoji.' },
    motion: { type: 'string', description: 'Direction for the video model, in English.' },
    intensity: { type: 'string', enum: ['subtle', 'cinematic', 'wild'] },
  },
  required: ['label', 'emoji', 'motion', 'intensity'],
  additionalProperties: false,
} as const;

export interface VisionRequestOptions {
  /** el modelo a usar; por defecto el configurado */
  model?: string;
  /**
   * Mandar `temperature`. Los modelos de razonamiento la rechazan con un 400,
   * así que el llamante puede quitarla y reintentar (ver `suggest.ts`).
   */
  temperature?: boolean;
}

/**
 * Cuerpo listo para POST /v1/chat/completions.
 *
 * OJO: **no es determinista**. Cada llamada sortea dos ejes y una mano de
 * ejemplos, que es justo lo que hace que la misma foto no dé siempre lo mismo.
 */
export function buildVisionRequest(
  input: VisionPromptInput,
  opts: VisionRequestOptions = {}
): Record<string, unknown> {
  const language = LANGS[(input.locale || 'es').slice(0, 2).toLowerCase()] || 'Spanish';
  const [axisA, axisB] = draw(AXES, 2);
  const flavours = draw(FLAVOURS, 6);

  const brief = [
    'Propose the four options for this photograph: one quiet, two spectacular, one surprise.',
    '',
    'For this photo, option 2 must work on this axis:',
    `  ${axisA!.brief}`,
    'and option 3 on this one:',
    `  ${axisB!.brief}`,
    'Those two axes are assigned, not suggestions. If an axis seems hard for this particular',
    'photo, that is the interesting part — find the version of it that fits what you can see.',
    '',
    'For register only, some things other clips have done:',
    ...flavours.map((f) => `  · ${f}`),
    'That list is the LEVEL you should aim at, not a menu. Do not reuse one of those unless it',
    'genuinely is the best fit here; you are expected to come up with something not on the list.',
    '',
    `Write "label" in ${language}; keep "motion" in English.`,
  ].join('\n');

  return {
    model: opts.model || VISION_MODEL,
    ...(opts.temperature === false ? {} : { temperature: TEMPERATURE }),
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: brief },
          // `detail: 'low'` a propósito: la decisión es "qué hay aquí y qué
          // podría moverse", no leer la matrícula del coche del fondo. En alta
          // resolución la llamada cuesta varias veces más y las propuestas no
          // mejoran — y esta llamada corre una vez por cada foto que se saca.
          { type: 'image_url', image_url: { url: input.imageDataUri, detail: 'low' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'animation_options',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            options: {
              type: 'array',
              description: 'Exactly four options: three grounded, then the surprise.',
              items: OPTION_SCHEMA,
            },
          },
          required: ['subject', 'options'],
          additionalProperties: false,
        },
      },
    },
  };
}

/** Lo que enseñaría un panel de prompts sin provocar una llamada. */
export function describeVisionPrompt(): {
  model: string;
  fallbackModel: string;
  temperature: number;
  system: string;
  axes: string[];
  flavours: number;
} {
  return {
    model: VISION_MODEL,
    fallbackModel: VISION_FALLBACK_MODEL,
    temperature: TEMPERATURE,
    system: SYSTEM,
    axes: AXES.map((a) => a.id),
    flavours: FLAVOURS.length,
  };
}

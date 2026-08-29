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
  'The two must not be variations of each other: pick two clearly different kinds of event.',
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

/** Cuerpo listo para POST /v1/chat/completions. */
export function buildVisionRequest(input: VisionPromptInput): Record<string, unknown> {
  const language = LANGS[(input.locale || 'es').slice(0, 2).toLowerCase()] || 'Spanish';
  return {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Propose the four options for this photograph: one quiet, two spectacular, one surprise. Write "label" in ${language}; keep "motion" in English.`,
          },
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
export function describeVisionPrompt(): { model: string; system: string } {
  return { model: VISION_MODEL, system: SYSTEM };
}

// El prompt de VISIÓN, en el servidor. Mira la foto y propone cómo animarla.
//
// Es la mitad interesante del prototipo. Un carrusel de filtros fijos ("lluvia",
// "cine", "sueño") lo tiene cualquiera; lo que aquí se pide es que las cuatro
// opciones sean distintas para una playa, para un plato de comida y para la cara
// de tu hermano — porque el modelo ha VISTO cuál de las tres es.
//
// Tres reglas que salieron de mirar lo que devolvía sin ellas:
//
//  1. **Distintas entre sí, no tres matices del mismo movimiento.** Sin pedirlo
//     explícitamente devolvía "brisa suave", "viento" y "ráfaga": tres chips que
//     dan el mismo vídeo. Se le obliga a repartirlas por intensidad.
//  2. **Lo que se mueve tiene que estar EN la foto.** "Que pase un tren por
//     detrás" en una foto sin vías obliga al modelo de vídeo a inventar
//     geometría, y lo que inventa lo paga la cara del sujeto.
//  3. **La sorpresa es sorpresa de verdad.** Si se le pide "una cuarta opción
//     creativa" devuelve una cuarta variación educada. Se le pide explícitamente
//     lo que NO se le ocurriría al usuario, y se le deja romper la física.

const SYSTEM = [
  'You direct 5-second video clips generated from a single photograph.',
  'The photograph is the first frame and cannot be repainted: whoever and whatever is in it stays exactly as photographed.',
  'Your job is to look at this specific photo and propose four different ways to bring IT to life.',
  '',
  'Return exactly four options.',
  '',
  'Options 1-3 are the grounded ones, and they must be genuinely DIFFERENT from each other,',
  'not three intensities of the same idea. Spread them: one should be almost imperceptible',
  '(breath, blink, a draught, drifting dust), one should be a clear cinematic beat',
  '(light changing, weather arriving, the camera settling), and one should be the boldest thing',
  'that still respects the photo.',
  'Every movement you propose must involve something ALREADY VISIBLE in the frame,',
  'or something that can plausibly enter it (light, wind, rain, smoke, water, dust, shadow).',
  'Never propose new characters, vehicles, buildings, limbs or text.',
  '',
  'Option 4 is the SURPRISE, and it is the one that should make someone laugh out loud.',
  'Here you may break physics, scale and plausibility — an improbable creature strolling through',
  'the background, gravity giving up for a second, the weather doing something absurd.',
  'It must still be harmless, playful and safe for everyone, and the main subject of the photo',
  'must survive it intact and recognisable. Do not make it about a real identifiable person doing',
  'something they did not do.',
  '',
  'For each option write:',
  '- "label": 1-2 words, in the requested language, the way an Instagram filter is named. No punctuation.',
  '- "emoji": one single emoji that reads at 40 pixels.',
  '- "motion": the direction for the video model, in ENGLISH, 1-3 sentences, imperative and visual.',
  '  Describe ONLY what changes over the five seconds: movement, light, weather, atmosphere.',
  '  Never describe what the photo already shows, never mention style, resolution or camera brands,',
  '  and never ask for on-screen text.',
  '- "intensity": "subtle" for the near-still one, "cinematic" for a real but controlled beat,',
  '  "wild" for the bold one and always for the surprise.',
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
            text: `Propose the four options for this photograph. Write "label" in ${language}; keep "motion" in English.`,
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

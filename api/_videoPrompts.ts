// Composición del prompt de MOVIMIENTO. Lo mismo que hace Ridio en su
// `_videoPrompts.ts`, adaptado a que aquí el primer fotograma es una FOTO y no
// una ilustración generada.
//
// El cambio de material cambia la guarda principal. En Ridio lo frágil es el
// medio: pedirle a un modelo de vídeo que anime una acuarela y no rellene el
// papel en blanco. Aquí lo frágil es la CARA: la foto es de alguien real, que
// además la va a ver, y un modelo generativo completo tiende a rejuvenecer,
// adelgazar y "arreglar" a la gente en cuanto se le da margen. Por eso la
// guarda de identidad va primero, va siempre y no depende del modo.
//
// La segunda diferencia es el aire. Un modo llamado "Tormenta" tiene que poder
// traer una tormenta, así que la libertad no es constante: la fija la
// `intensity` del modo, y solo afecta a la cámara y al clima — nunca a quién
// sale en la foto.

import type { Intensity } from './_modes';

export interface VideoPromptInputs {
  /** qué se mueve: del catálogo o escrito por la visión, nunca por el cliente */
  motion: string;
  intensity: Intensity;
}

// La instrucción sin la cual todo lo demás da igual. H3 Max es un modelo
// generativo completo: si no se le dice que el fotograma que le das MANDA, no
// lo anima — lo reinterpreta, y el sujeto sale con otra cara al segundo tres.
const FIRST_FRAME_GUARD = [
  'Animate the provided photograph. It is literally the first frame of the clip and the single',
  'source of truth for identity, framing, lens, colour and grain.',
  'The clip must start on that exact image, unchanged, and evolve from it.',
].join(' ');

// Personas. Se enumera lo que el modelo "mejora" por su cuenta cuando no se le
// prohíbe: es más eficaz que un "keep them the same", que interpreta como una
// sugerencia estética.
const IDENTITY_GUARD = [
  'Every person in the frame must remain the same person for the whole clip:',
  'same face, same bone structure, same age, same body, same skin, same hair, same clothing.',
  'Do not beautify, slim, re-age, re-light or otherwise retouch anyone.',
  'Do not add or remove people, animals, limbs, hands or objects,',
  'and never add text, captions, logos, watermarks or UI on top of the image.',
].join(' ');

// La foto es una foto. Sin esto, el clip deriva a "render": contraste de más,
// saturación de más y un acabado 3D que delata el generador a la primera.
const PHOTO_GUARD = [
  'Keep it photographic and keep it the SAME photograph: preserve the original exposure,',
  'white balance, depth of field, lens character, noise and grain.',
  'Do not increase saturation, contrast, sharpness or dynamic range,',
  'do not add cinematic colour grading that is not already there,',
  'and never drift towards CGI, 3D render, illustration or plastic skin.',
].join(' ');

// Cámara: lo único que la intensidad mueve de verdad. Un travelling en cinco
// segundos reencuadra la foto, y la foto la encuadró el usuario.
const CAMERA: Record<Intensity, string> = {
  subtle:
    'The camera does not move. At most an imperceptible drift. Never zoom, never re-frame, no cuts.',
  cinematic:
    'The camera is almost still — a slow, gentle parallax drift at most. Never zoom in hard, never re-frame the subject out of the shot, no cuts.',
  wild:
    'The camera may drift a little more freely, but it stays on the same subject in the same shot: no cuts, no scene changes, no whip pans, and the subject never leaves the frame.',
};

// Lo que puede pasar en el aire, por intensidad. Aquí sí hay barra libre
// creciente: el clima y la luz se pueden inventar porque no tienen cara.
const LICENCE: Record<Intensity, string> = {
  subtle: 'Change as little as possible. Restraint is the point.',
  cinematic:
    'Light, weather and atmosphere may change over the five seconds; the subject and the framing may not.',
  wild:
    'Light, weather, atmosphere and physics may behave impossibly and playfully. The subject of the photo still survives it intact and recognisable.',
};

// H3 Max genera audio en la misma pasada, así que o se dirige o se sufre. Sin
// voz: una voz inventada sobre la cara de alguien real es un deepfake por
// accidente, y encima nunca hablaría su idioma.
const AUDIO_DIRECTION = [
  'Audio: quiet, diegetic ambience that matches the setting.',
  'Absolutely no speech, no dialogue, no narration, no singing and no music with lyrics.',
].join(' ');

const clip = (s: string, max: number): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
};

/**
 * El texto que se le manda a fal. `motion` es obligatorio: sin él el modelo se
 * inventa el movimiento, y un prompt genérico da cinco segundos de nada.
 */
export function buildVideoPrompt(inputs: VideoPromptInputs): string {
  const motion = clip(inputs?.motion || '', 700);
  if (!motion) throw new Error('missing_motion');
  const intensity: Intensity = inputs.intensity || 'cinematic';

  return [
    FIRST_FRAME_GUARD,
    IDENTITY_GUARD,
    `What happens over the five seconds: ${motion}`,
    LICENCE[intensity],
    CAMERA[intensity],
    PHOTO_GUARD,
    AUDIO_DIRECTION,
  ].join(' ');
}

/** Lo que enseñaría un panel de prompts sin provocar una generación. */
export function describeVideoPrompts(): Array<{ id: string; text: string }> {
  return [
    { id: 'firstFrame', text: FIRST_FRAME_GUARD },
    { id: 'identity', text: IDENTITY_GUARD },
    { id: 'photo', text: PHOTO_GUARD },
    { id: 'audio', text: AUDIO_DIRECTION },
    ...(['subtle', 'cinematic', 'wild'] as Intensity[]).map((i) => ({
      id: `camera:${i}`,
      text: `${LICENCE[i]} ${CAMERA[i]}`,
    })),
  ];
}

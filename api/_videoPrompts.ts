// Composición del prompt de MOVIMIENTO. Lo mismo que hace Ridio en su
// `_videoPrompts.ts`, adaptado a que aquí el primer fotograma es una FOTO y no
// una ilustración generada.
//
// El cambio de material cambia la guarda principal. En Ridio lo frágil es el
// medio: pedirle a un modelo de vídeo que anime una acuarela y no rellene el
// papel en blanco. Aquí lo frágil es la CARA: la foto es de alguien real, que
// además la va a ver, y un modelo generativo completo tiende a rejuvenecer,
// adelgazar y "arreglar" a la gente en cuanto se le da margen.
//
// De ahí la línea que separa las guardas en dos, y es LA decisión de este
// fichero:
//
//   - **Quién sale en la foto no se toca. Nunca, en ningún modo.** Misma cara,
//     misma edad, mismo cuerpo, misma ropa.
//   - **El mundo alrededor sí.** Un modo llamado "Nave" tiene que poder traer
//     una nave, y eso significa meter en el fotograma algo que no estaba.
//
// La primera versión mezclaba las dos en una sola guarda ("no añadas personas,
// animales ni objetos") y eso hacía imposible la mitad del catálogo: el modelo
// obedecía y devolvía cinco segundos de nada. Ahora lo que puede aparecer lo
// decide la `intensity`, y la identidad se queda fuera de esa negociación.

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
  'Every person, animal and object ALREADY in the photograph keeps its exact appearance for the',
  'whole clip: same faces, same bone structure, same age, same bodies, same skin, same hair,',
  'same clothing, same colours. Do not beautify, slim, re-age or otherwise retouch anyone,',
  'do not swap anyone for someone else, and do not remove anyone or anything that is in the frame.',
  'Whatever happens around them, they must still be recognisably themselves in the last frame,',
  'unharmed and unhurt.',
  'Never add text, captions, subtitles, logos, watermarks or UI on top of the image.',
].join(' ');

// La foto es una foto, y lo que llegue nuevo también tiene que serlo. Sin esto
// el clip deriva a "render" —contraste de más, acabado 3D— y la nave se ve
// pegada encima en vez de estar ahí. Ojo: aquí NO se prohíbe que aparezcan
// cosas (de eso se encarga LICENCE), se exige que parezcan fotografiadas por la
// misma cámara.
const PHOTO_GUARD = [
  'The result must look like real footage shot on the same camera as the photograph:',
  'keep its exposure, white balance, depth of field, lens character, noise and grain,',
  'and make anything new that enters the scene obey that same light, perspective and grain',
  'so it looks photographed rather than pasted on top.',
  'Do not globally boost saturation, contrast or sharpness, and never drift into cartoon,',
  'illustration, video-game render or plastic skin.',
].join(' ');

// Cámara: lo único que la intensidad mueve de verdad. Un travelling en cinco
// segundos reencuadra la foto, y la foto la encuadró el usuario.
// La cámara se mantiene corta incluso en `wild`, y no por prudencia: el
// encuadre lo eligió el usuario, y un travelling en cinco segundos lo recompone
// hasta que la foto de partida ya no se reconoce. La espectacularidad tiene que
// venir de lo que PASA, no de que la cámara se mueva.
const CAMERA: Record<Intensity, string> = {
  subtle:
    'The camera does not move. At most an imperceptible drift. Never zoom, never re-frame, no cuts.',
  cinematic:
    'The camera is almost still — a slow, gentle parallax drift at most. Never zoom in hard, never re-frame the subject out of the shot, no cuts.',
  wild:
    'The camera holds the original framing: a slight drift or a shake from the event is welcome, but it stays one continuous shot on the same view — no cuts, no scene changes, no whip pans, and the original subject never leaves the frame.',
};

// Qué puede APARECER. Es la escala que hace posible el catálogo: `subtle` no
// admite nada nuevo, `cinematic` admite lo que trae el cielo, y `wild` admite
// que llegue una nave. Lo único que no escala es quién sale en la foto.
const LICENCE: Record<Intensity, string> = {
  subtle:
    'Nothing new enters the frame. Only what is already there may move. Restraint is the point.',
  cinematic:
    'Light, weather and atmosphere may change over the five seconds, and things that belong to the sky or the air may arrive — cloud, rain, snow, dust, smoke, birds. Nothing else is added.',
  wild:
    'Go all in on the event described above. New elements MAY enter the frame and the environment MAY transform, dramatically and impossibly: craft, creatures, portals, fire, flood, impossible light, a shift of scale or of genre. Physics is optional. The event should be unmistakable within the first two seconds — a viewer must not have to squint to find it.',
};

// H3 Max genera audio en la misma pasada, así que o se dirige o se sufre. Y
// escala con la intensidad por el mismo motivo que la imagen: pedir "ambiente
// tranquilo" mientras baja una nave nodriza es contradecirse, y el modelo
// resuelve las contradicciones como le parece.
//
// Lo que NO escala es la voz. Una voz inventada sobre la cara de alguien real
// es un deepfake por accidente, y encima nunca hablaría su idioma.
const AUDIO: Record<Intensity, string> = {
  subtle: 'Audio: quiet, diegetic ambience that matches the setting, nothing more.',
  cinematic:
    'Audio: diegetic ambience that matches the setting and follows the weather and the light as they change.',
  wild:
    'Audio: let the event be heard — rumble, roar, wind, impact, whatever it is — over the ambience of the place, without drowning it.',
};

const NO_SPEECH =
  'Absolutely no speech, no dialogue, no narration, no singing and no music with lyrics.';

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
    AUDIO[intensity],
    NO_SPEECH,
  ].join(' ');
}

/** Lo que enseñaría un panel de prompts sin provocar una generación. */
export function describeVideoPrompts(): Array<{ id: string; text: string }> {
  return [
    { id: 'firstFrame', text: FIRST_FRAME_GUARD },
    { id: 'identity', text: IDENTITY_GUARD },
    { id: 'photo', text: PHOTO_GUARD },
    { id: 'noSpeech', text: NO_SPEECH },
    ...(['subtle', 'cinematic', 'wild'] as Intensity[]).map((i) => ({
      id: `intensity:${i}`,
      text: `${LICENCE[i]} ${CAMERA[i]} ${AUDIO[i]}`,
    })),
  ];
}

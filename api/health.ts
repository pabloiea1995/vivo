// GET /api/health — ¿está el backend en pie y con qué claves?
//
// Sin secretos, solo presencia: es lo primero que se mira cuando la app dice
// "no se pudo animar" y no se sabe si es la red del móvil, la clave de fal o el
// despliegue. Nunca devuelve un valor de variable, solo si está puesta.

import { describeVideoPrompts } from './_videoPrompts';
import { describeVisionPrompt } from './_visionPrompts';
import { microsToEur, videoMicros, videoPromoActive } from './_pricing';
import { CATALOG } from './_modes';

export default function handler(req: any, res: any): void {
  const verbose = String(req?.query?.prompts || '') === '1';
  res.status(200).json({
    ok: true,
    env: {
      openai: !!process.env.OPENAI_API_KEY,
      fal: !!(process.env.FALAI_TOKEN || process.env.FAL_KEY),
      ticketSecret: !!process.env.VIVO_TICKET_SECRET,
      appSecret: !!process.env.VIVO_APP_SECRET,
    },
    visionModel: describeVisionPrompt().model,
    videoPromoActive: videoPromoActive(),
    // Lo que cuesta un clip hoy. La página lo pide al arrancar para poder
    // avisar de lo que vale el ×4 ANTES de tocarlo: cuatro clips no son una
    // cifra que deba descubrirse después de pagarla. Va aquí y no en una
    // constante del cliente porque la tarifa cambia el 1 de septiembre.
    clipCostEur: microsToEur(videoMicros('minimax/h3-max/image-to-video', 5, '768P')),
    catalog: CATALOG.map((m) => ({ id: m.id, label: m.label, intensity: m.intensity })),
    ...(verbose ? { prompts: { vision: describeVisionPrompt(), video: describeVideoPrompts() } } : {}),
  });
}

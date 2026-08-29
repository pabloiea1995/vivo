// GET /api/health — ¿está el backend en pie y con qué claves?
//
// Sin secretos, solo presencia: es lo primero que se mira cuando la app dice
// "no se pudo animar" y no se sabe si es la red del móvil, la clave de fal o el
// despliegue. Nunca devuelve un valor de variable, solo si está puesta.

import { describeVideoPrompts } from './_videoPrompts';
import { describeVisionPrompt } from './_visionPrompts';
import { videoPromoActive } from './_pricing';
import { CATALOG } from './_modes';

export default function handler(req: any, res: any): void {
  const verbose = String(req?.query?.prompts || '') === '1';
  res.status(200).json({
    ok: true,
    env: {
      openai: !!process.env.OPENAI_API_KEY,
      fal: !!(process.env.FALAI_TOKEN || process.env.FAL_KEY),
      ticketSecret: !!process.env.VIVO_TICKET_SECRET,
    },
    visionModel: describeVisionPrompt().model,
    videoPromoActive: videoPromoActive(),
    catalog: CATALOG.map((m) => ({ id: m.id, label: m.label, intensity: m.intensity })),
    ...(verbose ? { prompts: { vision: describeVisionPrompt(), video: describeVideoPrompts() } } : {}),
  });
}

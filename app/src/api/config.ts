// A qué backend habla la app.
//
// En un prototipo esto cambia diez veces al día (túnel local, preview de
// Vercel, producción), así que se lee de `EXPO_PUBLIC_API_URL` y se puede
// tocar sin recompilar. Sin ella apunta a localhost, que es lo que quiere
// alguien que acaba de clonar el repo.
//
// Aquí NO hay ninguna clave de proveedor. Las de OpenAI y fal viven en el
// servidor y no tienen por qué existir en el binario; es la única forma de que
// publicar la app no sea publicar la factura.
//
// `APP_SECRET` es otra cosa y conviene no confundirlas: es la cerradura del
// backend (`VIVO_APP_SECRET` allí), y sí viaja en el binario. No autentica a
// nadie — evita que quien encuentre la URL del despliegue le monte un bucle.

import { Platform, NativeModules } from 'react-native';

const fromEnv = process.env.EXPO_PUBLIC_API_URL;

// En un simulador, "localhost" es la propia máquina virtual. Se saca la IP del
// host del script de Metro, que es lo que ya está apuntando al portátil.
function devHost(): string | null {
  const url: string | undefined =
    (NativeModules as any)?.SourceCode?.scriptURL || (globalThis as any)?.location?.href;
  const m = url && /^[a-z]+:\/\/([^:/]+)/i.exec(url);
  return m ? m[1] : null;
}

/** La cerradura del backend. Vacía = el servidor la tiene desactivada. */
export const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET || '';

export const API_BASE = (() => {
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Platform.OS === 'web' ? 'localhost' : devHost() || 'localhost';
  return `http://${host}:3000`;
})();

/** Idioma de las etiquetas del carrusel: lo decide el servidor con esto. */
export const LOCALE = (() => {
  const tag =
    (Intl as any)?.DateTimeFormat?.().resolvedOptions?.().locale ||
    (globalThis as any)?.navigator?.language ||
    'es';
  return String(tag).slice(0, 2).toLowerCase();
})();

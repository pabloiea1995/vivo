// Lo único de Node que usan estas funciones, declarado a mano.
//
// Existe para NO depender de `@types/node`: el build de Vercel no instala las
// devDependencies de este proyecto, así que un tsconfig con `types: ["node"]`
// compila limpio en local y rojo en el despliegue — y un log rojo que hay que
// aprender a ignorar es una trampa para el siguiente que mire. Todo lo demás
// (fetch, crypto, TextEncoder, btoa, console) ya está en `lib: DOM`.
declare const process: {
  env: Record<string, string | undefined>;
};

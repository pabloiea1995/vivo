# Vivo

**Sacas el móvil, haces una foto, y la foto se mueve.**

GPT mira lo que acabas de fotografiar y propone cuatro formas de animarlo —tres
pensadas para *esa* foto y una sorpresa—. Eliges una en un carrusel de filtros y
el modelo de vídeo genera cinco segundos que **empiezan exactamente en tu foto**.

Prototipo. Una pantalla, tres funciones serverless, ningún registro, ninguna
base de datos.

```
 cámara ──📸──▶ /api/suggest ──▶ 4 modos ──👆──▶ /api/video ──▶ ▶️ clip
                (gpt-5.6-luna)                  (H3 Max i2v)
```

## La decisión que ordena todo lo demás

**El primer fotograma del vídeo es siempre la foto.** No es una preferencia de
la interfaz, es la forma del backend: `/api/video` solo habla con modelos
*image-to-video*, `image_url` es obligatorio, y una petición sin foto se cae con
un 400 antes de tocar la clave de fal. No existe un camino de texto-a-vídeo que
alguien pueda encontrar por accidente, porque no existe aquí un caso de uso en
el que quieras un vídeo que no empiece por lo que acabas de fotografiar.

En la app, la misma idea se sostiene en la capa de presentación: la foto se
queda **debajo** del reproductor y el vídeo aparece encima solo cuando el
decodificador está listo (`ClipPlayer`). Sin eso hay un parpadeo a negro de un
par de décimas justo en el relevo, y ese parpadeo es lo único que separa "mi
foto se ha movido" de "me han hecho otro vídeo".

## Las otras tres

**Ningún cliente compone prompts.** La app manda datos —una foto, un idioma, un
ticket— y el servidor escribe el texto (`api/_visionPrompts.ts`,
`api/_videoPrompts.ts`). Afinar un modo es un despliegue, no una actualización
de la App Store esperando a que la gente la instale. Y la clave de fal no es
utilizable para nada que no sea una de nuestras animaciones.

**Los modos propuestos viajan firmados.** GPT escribe la dirección de movimiento
a medida de la foto, pero el usuario elige en la pantalla siguiente, así que ese
texto tiene que hacer un viaje de ida y vuelta por el móvil. Devolverlo en claro
convertiría el prototipo en un generador de vídeo con prompt libre y nuestra
clave; se firma con HMAC (`api/_ticket.ts`) y se verifica al volver. El cliente
recibe un sobre cerrado y lo devuelve sin abrirlo.

**El backend tiene cerradura, y falla abierto hasta que la pones.** Sin
`VIVO_APP_SECRET`, `/api/video` está abierto a quien encuentre la URL — y cada
llamada gasta dinero. En cuanto la variable existe, toda petición debe traer esa
cadena en `x-vivo-key` y el resto se va con un 403. La comprobación de origen no
cubre esto: un `curl` no manda `Origin`, y tiene que pasar porque la app nativa
tampoco lo manda.

**Un modelo que no sabemos tarifar no es alcanzable.** Las tablas de
`api/_pricing.ts` *son* las listas blancas. El vídeo se cobra por segundo ×
resolución, no por generación: un clip de 5 s a 768p cuesta lo que trece
ilustraciones, y un `duration: 900` colado en el cuerpo sería una factura de tres
cifras sin que nada fallase. `duration` y `resolution` se acotan contra la tabla.

## Cómo se prueba

```bash
npm install

# 1. backend (necesita el CLI de Vercel y un .env con las claves)
cp .env.example .env      # y rellena OPENAI_API_KEY y FALAI_TOKEN
npm run dev:api              # http://localhost:3000

# 2. app
cd app && npx expo start  # y ábrela en el móvil con Expo Go
```

```bash
npm test        # sin claves ni red: los proveedores van simulados
npm run typecheck
```

Las pruebas cubren los dos invariantes que un refactor distraído rompe sin que
nada falle en pantalla: que el cuerpo que llega a fal lleva **la foto** como
`image_url`, y que un `motion` metido a mano en la petición **no llega a ningún
sitio**.

`GET /api/health` dice qué claves ve el servidor (nunca sus valores) y
`?prompts=1` enseña los prompts compuestos sin provocar ninguna generación.

La app busca el backend en `EXPO_PUBLIC_API_URL`; sin esa variable deduce la IP
del host de Metro, que es lo que quiere alguien que acaba de clonar el repo. Con
el backend ya en Vercel:

```bash
EXPO_PUBLIC_API_URL=https://vivo-xxxx.vercel.app npx expo start
```

**La cámara no funciona en Expo Go web ni en el simulador de iOS.** Hace falta un
dispositivo real; es una app de cámara.

## Qué hay dentro

| | |
|---|---|
| `api/suggest.ts` | La foto entra, cuatro modos salen. Modera la foto, llama a la visión, firma los tickets. Cae al catálogo fijo si la visión falla. |
| `api/video.ts` | El clip. Verifica el modo, modera, compone el prompt, llama a fal, estima el coste. |
| `api/_visionPrompts.ts` | Lo que se le pide a GPT al mirar la foto. |
| `api/_videoPrompts.ts` | Las guardas de identidad, encuadre, textura fotográfica y audio, más la libertad por intensidad. |
| `api/_modes.ts` | El catálogo fijo y la forma de un modo. |
| `api/_ticket.ts` | El sobre cerrado. |
| `api/_pricing.ts` | Precios = listas blancas. |
| `app/src/screens/CameraScreen.tsx` | La pantalla única y su máquina de estados. |
| `app/src/components/ModeCarousel.tsx` | El carrusel de filtros. |
| `app/src/components/ClipPlayer.tsx` | El relevo invisible foto → vídeo. |
| `app/src/api/client.ts` | El único sitio que habla con el backend. |
| `test/` | El recorrido completo con los proveedores simulados, y las piezas sueltas. |

Notas de diseño, coste real y lo que queda por validar: [`docs/DESIGN.md`](docs/DESIGN.md).

## Origen

El backend es un primo pequeño del de [Ridio](https://web-ridio.vercel.app) y le
debe cuatro cosas: la puerta única para el vídeo, el prompting en el servidor,
las tablas de precio como listas blancas y la guarda de identidad del prompt de
movimiento. La diferencia de material es la que cambia el diseño: allí el primer
fotograma es una ilustración generada y lo frágil es el medio (que no se rellene
el papel en blanco de una acuarela); aquí es la cara de alguien real, que además
va a ver el resultado.

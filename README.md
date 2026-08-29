# Vivo

**Sacas el móvil, haces una foto, y la foto se mueve.**

GPT mira lo que acabas de fotografiar y propone cuatro formas de animarlo —tres
pensadas para *esa* foto y una sorpresa—. Eliges una en un carrusel de filtros y
el modelo de vídeo genera cinco segundos que **empiezan exactamente en tu foto**.

**En marcha:** https://vivo-two.vercel.app — pendiente de que el proyecto de
Vercel tenga sus variables de entorno (ver más abajo).

Prototipo. Una página, tres funciones serverless, ningún registro, ninguna base
de datos, ningún paso de compilación.

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

En el cliente la misma idea se sostiene dos veces:

- **Al capturar.** El preview llena la pantalla con `object-fit: cover`, así que
  el navegador ya está recortando. La captura reproduce *ese mismo* recorte,
  contra la proporción real del hueco visible — si se mandara el fotograma
  entero de la cámara, el vídeo tendría cosas que nunca viste.
- **Al reproducir.** La foto se queda **debajo** del `<video>`, que aparece
  encima solo cuando el decodificador está listo. Sin eso hay un parpadeo a
  negro de un par de décimas justo en el relevo, y ese parpadeo es lo único que
  separa "mi foto se ha movido" de "me han hecho otro vídeo".

Las dos cosas se comprueban en un Chromium de verdad (`test/web.test.cjs`).

## Las otras tres

**Ningún cliente compone prompts.** La página manda datos —una foto, un idioma,
un ticket— y el servidor escribe el texto (`api/_visionPrompts.ts`,
`api/_videoPrompts.ts`). Afinar un modo es un despliegue, no una versión nueva
del cliente. Y la clave de fal no es utilizable para nada que no sea una de
nuestras animaciones.

**Los modos propuestos viajan firmados.** GPT escribe la dirección de movimiento
a medida de la foto, pero eliges en la pantalla siguiente, así que ese texto
tiene que hacer un viaje de ida y vuelta por el navegador. Devolverlo en claro
convertiría el prototipo en un generador de vídeo con prompt libre y nuestra
clave; se firma con HMAC (`api/_ticket.ts`) y se verifica al volver. El cliente
recibe un sobre cerrado y lo devuelve sin abrirlo.

La clave de firma se deriva de un secreto del entorno, y eso no es un detalle:
`/api/suggest` y `/api/video` son dos funciones serverless distintas y **nunca**
comparten proceso, así que un secreto generado al arrancar no vale para nada
— el ticket que firma una no verifica jamás en la otra. Hay una prueba que
firma en una instancia y verifica en otra.

**El backend tiene cerradura, y falla abierto hasta que la pones.** Sin
`VIVO_APP_SECRET`, `/api/video` está abierto a quien encuentre la URL — y cada
llamada gasta dinero. En cuanto la variable existe, toda petición debe traer esa
cadena en `x-vivo-key` y el resto se va con un 403. La comprobación de origen no
cubre esto: un `curl` no manda `Origin`.

**Y un modelo que no sabemos tarifar no es alcanzable.** Las tablas de
`api/_pricing.ts` *son* las listas blancas. El vídeo se cobra por segundo ×
resolución, no por generación: un clip de 5 s a 768p cuesta lo que trece
ilustraciones, y un `duration: 900` colado en el cuerpo sería una factura de tres
cifras sin que nada fallase. `duration` y `resolution` se acotan contra la tabla.

## Cómo se prueba

```bash
npm install
cp .env.example .env      # y rellena OPENAI_API_KEY y FALAI_TOKEN
npm run dev:api           # necesita el CLI de Vercel
# abre http://localhost:3000
```

La página y la API viven en el mismo origen, así que no hay nada que configurar
en el cliente. **La cámara solo funciona sobre HTTPS o en `localhost`**: es una
regla del navegador, no del prototipo. En el despliegue de Vercel funciona.

Con la cerradura puesta en el servidor, se le pasa a la página una vez por la
URL y se queda recordada:

```
https://vivo-two.vercel.app/?key=<VIVO_APP_SECRET>
```

### Lo que falta para que funcione de verdad

Las claves no están en el repositorio ni pueden estarlo. En **Vercel → vivo →
Settings → Environment Variables** (Production) hacen falta tres, y luego un
redespliegue:

| Variable | Sin ella |
|---|---|
| `FALAI_TOKEN` | `/api/video` responde 500: no hay clip. |
| `OPENAI_API_KEY` | El carrusel sale genérico (catálogo) y no hay moderación. |
| `VIVO_APP_SECRET` | **`/api/video` queda abierto a quien encuentre la URL**, y cada llamada cuesta ~0,18 €. Ponla a la vez que las otras dos. |

`VIVO_TICKET_SECRET` es opcional de verdad: si no está, la clave de firma de los
tickets se deriva de `FALAI_TOKEN`, que sin ella no habría vídeo que animar de
todas formas. Ponerla solo hace falta si algún día se rotan las claves de
proveedor sin querer invalidar los tickets en vuelo.

`GET /api/health` dice cuáles ve el servidor sin revelar ninguna.

Verificación:

```bash
npm test              # sin claves ni red: los proveedores van simulados
npm run typecheck
npm i -D playwright   # opcional: activa la prueba de navegador (si no, se salta)
```

Las pruebas cubren los invariantes que un refactor distraído rompe sin que nada
falle en pantalla: que el cuerpo que llega a fal lleva **la foto** como
`image_url`, que lo que la página manda como `imageBase64` es **exactamente** la
foto que se está viendo, y que un `motion` metido a mano en la petición **no
llega a ningún sitio**.

`GET /api/health` dice qué claves ve el servidor (nunca sus valores) y
`?prompts=1` enseña los prompts compuestos sin provocar ninguna generación.

## Qué hay dentro

| | |
|---|---|
| `api/suggest.ts` | La foto entra, cuatro modos salen. Modera la foto, llama a la visión, firma los tickets. Cae al catálogo fijo si la visión falla. |
| `api/video.ts` | El clip. Verifica el modo, modera, compone el prompt, llama a fal, estima el coste. |
| `api/_visionPrompts.ts` | Lo que se le pide a GPT al mirar la foto. |
| `api/_videoPrompts.ts` | Las guardas de identidad, encuadre, textura fotográfica y audio, más la libertad por intensidad. |
| `api/_modes.ts` | El catálogo fijo y la forma de un modo. |
| `api/_ticket.ts` | El sobre cerrado (HMAC con Web Crypto: sin `@types/node`, el build de Vercel compila limpio). |
| `api/_origin.ts` | Origen + cerradura compartida. |
| `api/_pricing.ts` | Precios = listas blancas. |
| `public/index.html` | Las tres capas del encuadre y los mandos. |
| `public/app.css` | Pantalla completa con los mandos flotando; el carrusel con `scroll-snap`. |
| `public/app.js` | La máquina de estados, la captura y el único sitio que habla con la API. |
| `test/` | Los handlers con los proveedores simulados, las piezas sueltas, y la página en un Chromium. |

Notas de diseño, coste real y lo que queda por validar: [`docs/DESIGN.md`](docs/DESIGN.md).

## Origen

El backend es un primo pequeño del de [Ridio](https://web-ridio.vercel.app) y le
debe cuatro cosas: la puerta única para el vídeo, el prompting en el servidor,
las tablas de precio como listas blancas y la guarda de identidad del prompt de
movimiento. La diferencia de material es la que cambia el diseño: allí el primer
fotograma es una ilustración generada y lo frágil es el medio (que no se rellene
el papel en blanco de una acuarela); aquí es la cara de alguien real, que además
va a ver el resultado.

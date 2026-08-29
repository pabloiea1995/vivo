# Vivo

Web app experimental para crear vídeos cortos de cinco segundos, en distintos
estilos, a partir de una foto.

**Sacas el móvil, haces una foto, y la foto se mueve.**

GPT mira lo que acabas de fotografiar y propone cuatro formas de animarlo —tres
pensadas para *esa* foto y una sorpresa—. Eliges una en un carrusel de filtros y
el modelo de vídeo genera cinco segundos que **empiezan exactamente en tu foto**.

> 🎥 **Verlo funcionando:**
> [el hilo en X](https://x.com/pablosanchezmv/status/2093753224847040813)
> tiene el vídeo de la app en marcha.
>
> No hay despliegue público: era un experimento y el proyecto de Vercel está
> parado. Para probarlo hay que levantarlo, y abajo está cómo.

Prototipo. Una página, tres funciones serverless, ningún registro, ninguna base
de datos, ningún paso de compilación.

```
 cámara ──📸──▶ /api/suggest ──▶ 4 modos + ×4 ──👆──▶ /api/video ──▶ ▶️ clip
                (gpt-5.6-luna)        │                (H3 Max i2v)
                                      └── deslizas entre ellos como un carrete
```

## La idea

Un modelo de vídeo *image-to-video* es una máquina rarísima: le das una foto y
un párrafo de instrucciones y te devuelve cinco segundos que arrancan en esa
foto. Lo difícil no es la máquina, es el párrafo. Nadie que acaba de sacar el
móvil quiere escribir *"cinematic dolly-in, volumetric light, the subject turns
slowly"*, y si le pones una caja de texto delante lo que consigues es que se
vaya.

Vivo quita la caja de texto. Quien escribe el párrafo es GPT, que además ha
visto la foto: sabe si hay una persona, un plato de comida, un tejado o el mar,
y propone cuatro cosas que le podrían pasar *a eso*. Tú solo eliges, y eliges
como se elige un filtro de Instagram — deslizando por un carrusel abajo, sin
salir del encuadre.

Lo que queda es un gesto de dos pasos, foto y desliz, con un momento bueno al
final: la imagen que estabas mirando empieza a moverse sin cortar. Ese "sin
cortar" es la app entera, y de ahí sale la decisión que ordena todo lo demás.

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

**Elegir y ver no son dos pantallas.** Siempre estás *sobre* un modo: si ya
tiene vídeo se reproduce, y si no, el disparador lo genera. Deslizar cambia de
modo, y al llegar a uno que ya tiene clip arranca solo **desde el primer
fotograma** — que es la misma foto en los cuatro. Por eso pasar de uno a otro se
lee como cuatro futuros del mismo instante y no como cuatro vídeos sueltos.

**El chip `×4`** al final del carrusel genera de una vez todos los que falten,
en paralelo (~10 s en total en vez de 40), y al terminar salta al primero. Avisa
de lo que cuesta *antes* de tocarlo: cuatro clips no son una cifra que deba
descubrirse después de pagarla.

**Los clips no se pierden.** Cada mp4 se descarga a un blob y se guarda en
IndexedDB junto con la foto y los modos; al recargar, la sesión vuelve entera y
no se regenera —ni se paga— nada. IndexedDB y no `localStorage` porque un clip
pesa uno o dos megas y ahí caben cinco. La contrapartida es que el ticket de
cada modo tiene que durar más que una sesión: por eso su TTL pasó de diez
minutos a un día (`api/_ticket.ts` explica por qué eso no afloja nada).

**Los cuatro modos se inventan en cada foto, y no dos veces iguales.** El
catálogo de `_modes.ts` es solo el plan B; lo normal es que GPT mire *tu* foto y
escriba cuatro propuestas nuevas. Para que de verdad varíen no basta con subir
la temperatura —eso cambia el vocabulario, no la idea—: cada petición **sortea
dos ejes** (escala, género, criatura, material, tiempo, física, líquido, luz,
multitud, máquina, elementos, sueño) y le exige que la opción 2 trabaje uno y la
3 el otro, más una mano de seis ejemplos que se le dan como registro y no como
menú. El botón "🎲 Otras" vuelve a tirar sobre la misma foto por ~0,0015 €.

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

## Montarlo en local

Hace falta Node 18 o más nuevo y una cuenta en OpenAI y en [fal.ai](https://fal.ai).

```bash
git clone https://github.com/pabloiea1995/vivo.git
cd vivo
npm install
npm i -g vercel            # las funciones de api/ las sirve el CLI de Vercel

cp .env.example .env       # y rellena al menos FALAI_TOKEN
npm run dev:api            # http://localhost:3000
```

`vercel dev` sirve la página estática de `public/` y las funciones de `api/` en
el mismo origen, así que **el cliente no necesita configurar nada**: no hay URL
de API que apuntar ni CORS que abrir. `.env` está en `.gitignore` y ninguna de
esas claves llega al navegador.

De las variables de `.env.example`, solo una es imprescindible:

| Variable | Sin ella |
|---|---|
| `FALAI_TOKEN` | **Requerida.** `/api/video` responde 500: no hay clip. |
| `OPENAI_API_KEY` | La app funciona, pero el carrusel sale con el catálogo fijo en vez de modos a medida, y no hay moderación. |
| `VIVO_TICKET_SECRET` | Recomendada en producción, irrelevante en local: sin ella cada función serverless firma con un secreto efímero propio y los tickets no cruzan de una a otra ("Ese modo ha caducado"). En `vercel dev` es un solo proceso, así que no se nota. |
| `VIVO_APP_SECRET` | En local, ninguna: sin ella el backend queda abierto, y en `localhost` eso es lo cómodo. En un despliegue público es otra cosa — ver abajo. |

Las opcionales (modelo de visión, temperatura, tiempos de espera, tarifa de fal)
están comentadas en `.env.example` con lo que hace cada una.

**La cámara solo funciona sobre HTTPS o en `localhost`**: es una regla del
navegador, no del prototipo. En `localhost` va; si abres el `dev` desde el móvil
por la IP de la red, no — usa el botón "o sube una foto", o despliega.

### Comprobar que va

```bash
npm test              # sin claves y sin red: los proveedores van simulados
npm run typecheck
npm i -D playwright   # opcional: activa la prueba de navegador (si no, se salta)
```

Las pruebas cubren los invariantes que un refactor distraído rompe sin que nada
falle en pantalla: que el cuerpo que llega a fal lleva **la foto** como
`image_url`, que lo que la página manda como `imageBase64` es **exactamente** la
foto que se está viendo, y que un `motion` metido a mano en la petición **no
llega a ningún sitio**.

`GET /api/health` dice qué claves ve el servidor (nunca sus valores), qué modelo
de visión usará y cuánto cuesta un clip; `?prompts=1` enseña los prompts
compuestos sin provocar ninguna generación.

## Desplegarlo en Vercel

No hay paso de compilación: `vercel.json` sirve `public/` tal cual y compila las
funciones de `api/*.ts`. Con el repositorio importado en Vercel, cada push a
`main` despliega.

```bash
vercel link           # o importa el repo desde vercel.com/new
vercel --prod
```

Después, en **Settings → Environment Variables** (entorno *Production*), las
tres que importan, y **un redespliegue** para que las cojan:

| Variable | Sin ella |
|---|---|
| `FALAI_TOKEN` | `/api/video` responde 500: no hay clip. |
| `OPENAI_API_KEY` | El carrusel sale genérico (catálogo) y no hay moderación. |
| `VIVO_APP_SECRET` | **`/api/video` queda abierto a quien encuentre la URL**, y cada llamada cuesta ~0,18 € de tu cuenta de fal. Ponla a la vez que las otras dos. |

> ⚠️ **Si lo despliegas desde un repositorio público, `VIVO_APP_SECRET` no es
> opcional.** Una URL de Vercel es adivinable y el código que explica cómo
> llamar a `/api/video` está aquí a la vista: sin cerradura es un grifo de
> dinero con dirección conocida. Genera una cadena larga al azar
> (`openssl rand -base64 24`), **no la escribas en ningún archivo del repo**, y
> confirma en `/api/health` que responde `"appSecret": true`.

Con la cerradura puesta, a la página se le pasa una vez por la URL y el
navegador la recuerda:

```
https://<tu-despliegue>.vercel.app/?key=<VIVO_APP_SECRET>
```

`VIVO_TICKET_SECRET` es opcional de verdad: si no está, la clave de firma de los
tickets se deriva de `FALAI_TOKEN`, que sin ella no habría vídeo que animar de
todas formas. Ponerla solo hace falta si algún día se rotan las claves de
proveedor sin querer invalidar los tickets en vuelo.

### Lo que cuesta

Un clip de 5 s a 768P son ~0,18 €; una tirada de modos, ~0,0015 €; el chip `×4`,
cuatro clips de golpe. No hay cuentas, ni cuotas, ni límite por usuario: **quien
despliega paga todo lo que se genere**, así que si lo dejas abierto al público,
ponle antes un tope de gasto en fal.

## Qué hay dentro

| | |
|---|---|
| `api/suggest.ts` | La foto entra, cuatro modos salen. Modera la foto, llama a la visión, firma los tickets. Cae al catálogo fijo si la visión falla. |
| `api/video.ts` | El clip. Verifica el modo, modera, compone el prompt, llama a fal, estima el coste. |
| `api/_visionPrompts.ts` | Lo que se le pide a GPT al mirar la foto: el encargo, los ejes que se sortean y los ejemplos. |
| `api/_videoPrompts.ts` | Las guardas de identidad, encuadre, textura fotográfica y audio, más la libertad por intensidad. |
| `api/_modes.ts` | El catálogo fijo y la forma de un modo. |
| `api/_ticket.ts` | El sobre cerrado (HMAC con Web Crypto: sin `@types/node`, el build de Vercel compila limpio). |
| `api/_origin.ts` | Origen + cerradura compartida. |
| `api/_pricing.ts` | Precios = listas blancas. |
| `public/index.html` | Las tres capas del encuadre y los mandos. |
| `public/app.css` | Pantalla completa con los mandos flotando; el carrusel con `scroll-snap`. |
| `public/app.js` | La máquina de estados, los gestos, la captura y el único sitio que habla con la API. |
| `public/store.js` | IndexedDB: la foto, los modos y los mp4 que sobreviven a cerrar la pestaña. |
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

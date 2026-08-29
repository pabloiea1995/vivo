# Notas de diseño

Lo que se decidió y por qué, para no volver a discutirlo dentro de tres semanas.
Escrito el 29-08-2026.

## 0. Espectáculo, no contención

El primer catálogo era todo sutileza —brisa, respiración, la luz cambiando— y
estaba mal. Venía tal cual de Ridio, donde el vídeo ilustra una novela y lo que
se pide es que la ilustración no se reinterprete. Aquí el contexto es el
opuesto: alguien saca el móvil, hace una foto y espera diez segundos. Devolverle
la misma foto con un poco de viento no justifica ni la espera ni los 0,18 €.

Lo que hace que quieras enseñárselo a alguien es que aparezca una nave sobre tu
calle. Así que el catálogo y el prompt de visión piden ahora eso: una nave
nodriza, un superhéroe aterrizando, un kaiju detrás del skyline, un portal, la
escena derritiéndose en psicodelia.

Se queda **un** modo contenido, "Respira", y solo uno. No por prudencia: es el
que demuestra que el vídeo es de verdad tu foto, y ese contraste hace que los
otros impresionen más.

El cambio obligó a partir en dos las guardas del prompt, que es la decisión
técnica que lo sostiene (`_videoPrompts.ts`):

- **Quién sale en la foto no se toca, en ningún modo.** Misma cara, misma edad,
  misma ropa, y sale ileso.
- **El mundo alrededor sí**, y cuánto lo decide la `intensity`.

La versión anterior mezclaba las dos en una sola línea ("no añadas personas,
animales ni objetos"), y por eso la mitad del catálogo nuevo habría sido
imposible: el modelo obedece y devuelve cinco segundos de nada.

## 0 bis. Cómo se consigue que no se repita

Con el catálogo nuevo apareció el problema siguiente: aunque cada foto pase por
el modelo, el mismo prompt converge. A la tercera foto vuelven a salir la nave y
la tormenta, y el carrusel PARECE un menú fijo aunque cada opción se haya
generado al vuelo. Es un fallo peor que tener modos fijos de verdad, porque
encima se paga la llamada.

Dos palancas, y la segunda es la que funciona:

1. **Temperatura alta** (1.15). Ayuda poco: sube la variedad del vocabulario,
   no la de la idea. Y no todos los modelos la aceptan — los de razonamiento
   devuelven un 400, así que el servidor lo detecta una vez y deja de mandarla.
2. **Ejes sorteados.** En cada petición se eligen dos de doce (escala, género,
   criatura, material, tiempo, física, líquido, luz, multitud, máquina,
   elementos, sueño) y se le EXIGE que la opción 2 trabaje sobre uno y la 3
   sobre el otro. Eso cambia la estructura de la respuesta, no las palabras, y
   es lo que hace que la misma foto dé cosas distintas dos veces seguidas.

Los ejemplos concretos (24, se sortean 6) van explícitamente como *registro, no
menú*: "esto es el listón, se espera que propongas algo que no esté en la
lista". Sin esa frase el modelo elige de la lista, que es exactamente el menú
fijo que se quería evitar.

El botón "🎲 Otras" existe por lo mismo: pedir otras cuatro ideas cuesta la
cuatrocientésima parte de un clip, así que conviene que se note.

## 0 ter. El carrete, y las dos trampas que esconde

Al juntar "guarda los vídeos", "desliza para cambiar de modo" y "el ×4", la app
deja de tener dos estados (elegir / ver) y pasa a tener uno: estás sobre un
modo, que tiene vídeo o no. Es un cambio pequeño de código y grande de
sensación — cuatro clips que arrancan en el mismo fotograma y se recorren con el
pulgar se leen como cuatro futuros del mismo instante.

Dos cosas que costaron y que no se ven en el resultado:

**El arrastre sobre una foto no es un gesto, es un drag-and-drop.** La foto es un
`<img>`, y arrastrarla dispara el arrastre nativo del navegador: el sistema se
queda el puntero y a la página le llega `pointercancel` en vez de `pointerup`.
El swipe simplemente no ocurría, sin ningún error en consola. Se arregla con
`user-drag: none` y un `preventDefault` en `dragstart`.

**`scrollIntoView` y el manejador de scroll se pelean.** Al centrar un chip por
código, el scroll suave dispara el manejador a mitad de animación, que mide que
el chip del centro todavía es el anterior y deshace la selección; el
desplazamiento sigue, vuelve a medir, y el modo oscila. En pantalla se veía como
que deslizar "a veces" no rebobinaba el vídeo. Se arregla ignorando el scroll
mientras el carrusel se coloca solo (`scrollend`, con temporizador de respaldo
porque no todos los navegadores lo tienen).

Y una decisión de producto: **el `×4` dice su precio antes de que lo toques**.
Son cuatro clips, ~0,74 € de una vez. La cifra la da el servidor en
`/api/health` y no una constante del cliente, porque la tarifa de fal cambia el
1 de septiembre.

## 0 quater. Dos trampas de `vercel.json`

Van aquí porque el fichero no las puede documentar solo, y esa es justo la
primera:

**`vercel.json` no admite comentarios, ni siquiera el truco de la clave `"//"`.**
Vercel lo valida contra un esquema estricto y una propiedad que no conozca tumba
el build entero con `should NOT have additional property '//'`. Se aprendió
rompiendo el primer despliegue desde Git con un comentario que explicaba por qué
la línea siguiente era necesaria. Otros JSON del repo (`tsconfig.json`,
`api/package.json`) sí llevan esa clave y no pasa nada: nadie los valida así.

**`"framework": null` está a propósito.** Los despliegues anteriores se hacían
subiendo ficheros, con los ajustes pasados por fuera. Conectado a Git, Vercel
autodetecta el framework, y aquí no hay ninguno — solo estáticos y funciones.
Declararlo evita que el primer despliegue desde el repo salga distinto al que ya
funcionaba.

## 1. Por qué la visión propone y no elige

Lo obvio sería que GPT mirase la foto y devolviera *el* mejor vídeo. Se descartó
por dos motivos, y el segundo es el que manda.

El primero es de coste. El clip cuesta unas 250 veces la llamada de visión (ver
§4): equivocarse eligiendo por el usuario sale caro y encima no se puede
deshacer sin volver a pagar.

El segundo es que **elegir es la mitad de la diversión**. La app no compite con
un generador de vídeo, compite con los filtros de Instagram, y en un filtro lo
que engancha no es el resultado sino deslizar y ver cómo cambia la misma foto.
Cuatro opciones a medida de tu foto son cuatro razones para volver a mirar la
foto; una sola es un botón.

De ahí la regla de las tres primeras: **distintas entre sí, no tres matices del
mismo movimiento**. Sin pedirlo explícitamente en el prompt, el modelo devuelve
"brisa suave", "viento" y "ráfaga" — tres chips que dan el mismo vídeo. Se le
obliga a repartirlas por intensidad: una casi imperceptible, una que es un plano
de cine, y la más atrevida que la foto aguante.

## 2. Por qué la sorpresa va tapada

Es el cuarto chip y no enseña ni su nombre ni su emoji hasta que se ha usado. El
servidor manda "Sorpresa 🎲" en el cable y guarda el nombre real dentro del
ticket firmado; sale a la luz en la respuesta de `/api/video`, cuando el vídeo ya
está.

Es una decisión pequeña con una razón concreta: el nombre que le pone el modelo
("Invasión de medusas") es medio chiste, y leerlo en el chip lo gasta antes de
verlo. Contarlo en el momento correcto es gratis y es lo único que separa una
cuarta opción de una sorpresa.

La sorpresa además corre siempre con `intensity: 'wild'`, aunque el modelo la
etiquete de otra forma. Un modelo obediente a veces la marca "cinematic", y
entonces las guardas le atan la cámara y el clima justo en la opción cuya gracia
es que no esté atada.

## 3. Qué se le prohíbe al modelo de vídeo, y por qué esas cosas

H3 Max es un modelo generativo completo: si le das un fotograma y le dices
"anímalo", no lo anima — lo reinterpreta. Las guardas de `_videoPrompts.ts` son
la lista de lo que reinterpreta cuando se le deja.

- **Identidad.** Se enumera lo que "mejora" por su cuenta (rejuvenecer, adelgazar,
  reiluminar, retocar la piel) porque un "keep them the same" genérico lo lee
  como una sugerencia estética. Aquí la foto es de alguien real que va a ver el
  resultado: es la guarda que no depende del modo y no se relaja nunca.
- **Encuadre.** La cámara se pide casi quieta. Con "a slow camera push" el modelo
  cierra el plano lo bastante como para recomponer la escena en cinco segundos, y
  el encuadre lo eligió el usuario.
- **Textura fotográfica.** Sin pedirlo, el clip deriva a "render": más contraste,
  más saturación, piel de plástico. Se pide preservar exposición, balance de
  blancos, profundidad de campo, grano y carácter de lente.
- **Audio.** Se genera en la misma pasada, así que o se dirige o se sufre. Sin voz
  nunca: una voz inventada sobre la cara de alguien real es un deepfake por
  accidente, y encima no hablaría su idioma.

Lo que **sí** varía con el modo es la libertad del aire: la luz, el clima y (en
`wild`) la física pueden hacer lo que quieran. No tienen cara.

## 4. Por qué una web y no una app nativa

Se empezó con Expo y se cambió a una página. Para un prototipo de esto, la web
gana en las tres cosas que importan: se prueba abriendo una URL (sin Expo Go,
sin build, sin TestFlight), se despliega en el mismo proyecto que la API —así
que no hay CORS que configurar ni una base de API que mantener en dos sitios— y
se puede verificar de punta a punta en un Chromium sin cámara.

Lo que se paga por ello: la cámara del navegador exige HTTPS, no hay acceso al
carrete ni al compartir nativo, y el vídeo se descarga en vez de guardarse. Para
enseñar la idea no estorba ninguno de los tres.

## 5. El dinero

| | Coste | |
|---|---|---|
| Visión (`gpt-5.6-luna`, imagen en `detail: low`) | ~0,0015 € | por foto |
| Clip de 5 s a 768p, tarifa de lanzamiento | ~0,184 € | por animación |
| Clip de 5 s a 768p, a partir del 1-09-2026 | ~0,368 € | por animación |

Dos consecuencias de diseño:

- **La visión es gratis comparada con el clip** (~1/250). Por eso se llama a GPT
  en cada foto sin pensárselo, y por eso la imagen va en `detail: low`: en alta
  resolución la llamada cuesta varias veces más y las propuestas no mejoran,
  porque la decisión es "qué hay aquí y qué podría moverse", no leer la matrícula
  del coche del fondo.
- **Probar un segundo modo sobre la misma foto no cuesta una segunda visión.** Los
  cuatro tickets valen diez minutos, así que "Otro modo" vuelve al carrusel sin
  llamar a nadie. Cuesta un clip, que es lo que tiene que costar.

No hay cuota ni límite por usuario: es un prototipo sin registro. La cerradura
`VIVO_APP_SECRET` para al paseante que encuentre la URL, pero no a quien reciba
el enlace: la clave viaja en él (`…/?key=…`) y se queda en el navegador, así que
compartir la app es compartir la llave. Y el repositorio es público, con lo que
la dirección del despliegue la tiene cualquiera. Antes de enseñárselo a más de cinco personas hace falta lo
que Ridio tiene en `api/_quota.ts`: un contador por llamante con presupuesto
real.

## 6. Lo que queda por validar

- **Relación de aspecto.** La página captura con la proporción del hueco
  visible, que en un móvil ronda 9:19,5. La ficha de H3 Max documenta los aspect
  ratios para *text-to-video*; en *image-to-video* se asume que sale del
  fotograma de entrada, pero está sin comprobar. Si fal devuelve el clip
  apaisado o con bandas, el arreglo es forzar una proporción fija en `grab`
  (`public/app.js`) en vez de leerla de la pantalla.
- **Latencia real de punta a punta.** La inferencia son ~3 s, pero falta medir la
  subida de la foto desde un móvil con mala cobertura y la cola de fal en hora
  punta. El texto "unos 10 segundos" de la pantalla de espera es una estimación,
  no una medida.
- **Cuánto aguanta la guarda de identidad en caras.** Está probada en
  ilustraciones (es de donde viene); en fotos de personas reales, y sobre todo en
  el modo `wild`, hace falta un lote de pruebas antes de fiarse.
- **Cuánto aguanta H3 Max un `wild` de verdad.** Las guardas están escritas para
  que aparezca una nave sin que cambie la cara de nadie, pero la única forma de
  saber dónde se rompe ese equilibrio es un lote de pruebas con caras reales.
- **El zoom por pellizco.** `applyConstraints({ zoom })` lo expone Chrome en
  Android y poco más; en Safari de iOS probablemente no haya control de zoom y
  el indicador no aparezca. Comprobado solo que no estorba cuando falta.
- **La cámara en Safari de iOS.** `getUserMedia` se pide desde un gesto y sobre
  HTTPS, que es lo que hace la portada, pero el comportamiento de
  `facingMode: 'user'` y el reflejado del selfie solo están probados en
  Chromium. Es lo primero que hay que mirar en un iPhone real.

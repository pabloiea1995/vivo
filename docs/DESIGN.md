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
`VIVO_APP_SECRET` para al paseante que encuentre la URL, pero no al que instale
la app: todos los instaladores comparten la misma clave, así que un binario
distribuido la regala. Antes de enseñárselo a más de cinco personas hace falta lo
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

# Notas de diseño

Lo que se decidió y por qué, para no volver a discutirlo dentro de tres semanas.
Escrito el 29-08-2026.

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

## 4. El dinero

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

No hay cuota ni límite por usuario: es un prototipo sin registro. **Cualquiera
que llegue al despliegue puede gastar.** Antes de enseñárselo a más de cinco
personas hace falta lo que Ridio tiene en `api/_quota.ts`: un contador por
llamante con presupuesto real.

## 5. Lo que queda por validar

- **Relación de aspecto.** La app captura y manda 9:16 (es una cámara de móvil).
  La ficha de H3 Max documenta los aspect ratios para *text-to-video*; en
  *image-to-video* se asume que sale del fotograma de entrada, pero está sin
  comprobar. Si fal devuelve el clip apaisado con bandas, la corrección es una
  constante: `ASPECT` en `CameraScreen.tsx` a `16/9`.
- **Latencia real de punta a punta.** La inferencia son ~3 s, pero falta medir la
  subida de la foto desde un móvil con mala cobertura y la cola de fal en hora
  punta. El texto "unos 10 segundos" de la pantalla de espera es una estimación,
  no una medida.
- **Cuánto aguanta la guarda de identidad en caras.** Está probada en
  ilustraciones (es de donde viene); en fotos de personas reales, y sobre todo en
  el modo `wild`, hace falta un lote de pruebas antes de fiarse.
- **Utilidad del modo `subtle` en el mundo real.** Es el que menos se ve y el que
  más barato sería quitar si nadie lo usa.

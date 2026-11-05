# 0028 — Lápiz de grafito medido sobre una hoja real

## Estado

Propuesto

En prueba en `task/graphite-fit8` y `task/brush-preset-keep` (esta contiene todo lo aplicado), sin subir ni fusionar. Pendiente de que el usuario juzgue la recalibración del frotado en el sandbox. Registro de la sesión, commits y evidencia: [058](../history/058-2026-11-W45.md); investigación y scripts: [investigación](../investigaciones/grafito-2026-11/investigacion.md).

## Fecha

2026-11-05

## Contexto

El pincel medido a 20 px tenía los grados invertidos (4B más claro que 2H), las pasadas llegaban casi a negro puro y la textura era 40 % ruido por píxel. Se ajustó un modelo en Python contra una hoja real de 12 grados; el usuario eligió la variante «fit8» frente a las siguientes.

## Decisión

- **Un grado es un tono máximo, no una opacidad.** `brushLead.ts` escribe en cada píxel el color de ese máximo (más claro en los valles del papel) y como alfa cuánto avanza esta pasada hacia él.
- **Se compone con `darken`.** Es exactamente `T -= (T - techo) * alfa` donde `T > techo`: las pasadas se acumulan y paran en el tono del grado, y un grado duro no aclara a uno blando. **El trazo no lee la capa:** deshacer, mover y reconstruir siguen usando la máscara en caché.
- **Contacto y frotado.** Cada píxel guarda su contacto más fuerte (perfil y puntas nítidas) y, encima, frotar suma con la distancia que la punta recorre sobre el píxel (`RUB` 0,5 y `FIRST` 0,8 en `brushLead.ts`; el «cuarto del depósito por cruce» de los mensajes es el efecto medido en el rayado de prueba, no la constante): una recta sigue siendo una pasada pareja y repasar sin soltar acumula despacio, hasta el tono del grado. Una primera versión (`87fd100c`) sumaba el depósito completo y sin contacto: el usuario la vio cremosa, sin filo y demasiado fácil de oscurecer, y la rechazó.
- **Papel medido.** Espectro radial del papel de la muestra 2B, sintetizado con fases aleatorias en una baldosa de 256 px.
- **Un trazo ancho es un haz de trazos finos,** cada uno con su ganancia, según la distancia a la línea central.
- **Los parámetros vienen del ajuste** (`LEAD_FITS`). Lo que el ajuste repartía entre muchos trazos finos por píxel, una pasada lo lleva en proporción al rayado de una mano.

## Alternativas

- **Leer la capa en cada trazo:** descartada; obliga a recalcular trazos posteriores al deshacer o mover, y `getImageData` cuesta 5–130 ms en lienzos enteros.
- **Las rondas de ajuste posteriores (fit10, fit11):** descartadas por el usuario frente a fit8.

## Consecuencias

- Coste medido en Node (ms por segmento de 10 px; entre paréntesis, el motor anterior en Chrome): tamaño 20, 0,06 (0,26); 80, 0,8 (2,6); 240, 6,9 (18,8). Crear el papel lleva unos 170 ms una sola vez, en reposo.
- Con `lead`, Hardness, Texture, Tooth, Edge y la forma de la punta no actúan.
- Sin compatibilidad hacia atrás: los presets 2H, HB y 4B cambian de aspecto (`no-backcompat` hasta declarar versión estable). Los trazos ya guardados conservan su punta.
- Pruebas: `tests/brush-lead.test.ts`.

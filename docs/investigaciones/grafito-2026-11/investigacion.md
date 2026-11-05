# Investigación del lápiz de grafito (2026-11-05)

Soporte de [0028](../../decisions/0028-lapiz-grafito.md) y del registro [058](../../history/058-2026-11-W45.md). Todo lo medido aquí viene de scripts de esta carpeta ([índice](../README.md)); lo que no se pudo comprobar está marcado «sin verificar». Horas en hora local (UTC-4).

## 1. Fallas medidas en el motor anterior

Motor real, tamaño 20 px, medido con [measure.mjs](scripts/measure.mjs) (el motor se empaquetó con [entry.ts](scripts/entry.ts)).

| Falla | Medida |
|---|---|
| Grados invertidos | Presión 1, L* (menos es más oscuro): 2H 51, HB 41, 4B 57. El 4B salía más claro que el 2H. |
| Pasadas a casi negro | 4B con 20 pasadas, L* 2–3; HB con 20 pasadas, L* 2. |
| Curvas sin efecto uniforme | Texture strength: saltos de L* 16/11/4/2. Valley fill: 0,2/2,6/4,6/7. Edge al 25 % sin efecto a 20 px. |
| Spacing cambia el tono | L* 33 a 80 al pasar de 5 % a 25 %. |
| Textura | `textureAt('graphite')` = 60 % ruido suave + 40 % ruido por píxel, 33 % de píxeles recortados, correlación de 3–4 px. |

## 2. Fuentes

| Fuente | Qué se leyó de verdad | Qué se tomó |
|---|---|---|
| Bertin 2026, «The physics of pencil drawing» (Research Square, sin revisión por pares) | Leído. | Desgaste de Archard; dureza por grado en MPa (6B 50, 4B 117, 2B 332, HB 600, 2H 884, 4H 1100); cobertura ≈ 6,6·F/(σ·A0), que no vale en 2H ni 4H; espectro del papel q^-2(1+H), H≈0,5. |
| Sousa y Buchanan, Graphics Interface 1999 | Leído. | Papel como mapa de alturas; mina acumulada por punto; Ag = Gt/TotalLead; Ir = 1 − Ag. |
| Sousa y Buchanan, Eurographics 1999 y CGF 2000 | **No leído**: el PDF llegó truncado (1 MB de 11,6 MB) y las páginas dieron 403 o muro de pago. | La ecuación de depósito en función de presión, altura y dureza queda **sin verificar**. |
| Rudolf 2005, ceras | Leído. | Altura de la punta según la fuerza; la cera depositada eleva la superficie y baja la fricción, así el depósito se satura. |
| Van Haevre 2007 | **No leído** (repositorio caído). | Nada. |
| Patente Painter US5347620 (Zimmer) | Solo por resumen de búsqueda del subagente, sin abrir la patente. | Mapa de altura de 8 bits; penetración = altura de la herramienta − altura del grano. Sin verificar en la fuente. |
| Krita y libmypaint | Código y manual consultados (Krita: grano anclado al lienzo, modos de textura sin estado, máximo de pincel 1000 px, Instant Preview en el manual; MyPaint: radio logarítmico, sin código de grano). | Nadie lleva cuenta del grafito por píxel: ventaja posible, no demostrada frente a apps cerradas. |
| ArtRage | Manual de ArtRage 5 leído directo. | Presión llena la textura; Softness de 2H a 6B; Precise Mode; ruido propio separado del papel. Fundadores (Bearsley, Fox-Wilson, ex-MetaCreations): solo por resumen de búsqueda, sin verificar. |
| SketchBook | Manual: solo Texture y Depth. | Sin autores ni patentes encontrados. |
| Procreate, Clip Studio, Photoshop, Rebelle | Sin información interna. | No se puede afirmar que se les supere. |
| Latencia | Annett et al. 2014 (~50 ms en tinta), Ng et al. 2014, Ink & Switch (~20 ms, informal). | Meta del usuario: ~12 ms por fotograma; el pincel, 2–3 ms. |
| Código de GIMP | **No encontrado** (solo hay GIMP instalado por Flatpak). | Pendiente: hace falta la ruta del usuario. |
| Muestras reales con grado y escala | No aparecieron en la web. | El usuario aportó la lámina de 12 grados y una foto de líneas (8H, 6H, HB, 2B, 6B). |

No se encontró ningún paper sobre rehacer trazos que dependen de lo que tienen debajo. De ahí la decisión de que un trazo no lea la capa.

## 3. Referencias y su límite

Las imágenes de referencia (la lámina de 12 grados, la foto de líneas y la hoja de tramas H–14B) las envió el usuario o salieron de la web, y **no se versionan** (derechos y tamaño). Los scripts las esperaban en `scratchpad/refs/` y `scratchpad/images/`, que ya no existen; para repetir los ajustes hace falta recuperar la lámina.

- Lámina: parches 4H…6B, 4 columnas × 3 filas, 5 bandas de presión por parche.
- Líneas (L*): 8H 94, 6H 89, HB 66, 2B 42, 6B 45; anchos 4, 4, 4, 5, 7 px. Foto de producto, marcas mixtas, presión desconocida.
- Banda de la lámina, de más a menos presión (L*): 2H 77 78 83 85 92; HB 60 61 71 80 87; 2B 44 42 53 67 77; 4B 28 29 40 61 74; 6B 35 39 47 75 82.

## 4. Rondas de ajuste

Cadena de scripts: `v5` → `fit5` → `fit6` → `fit7` → `fit8` → `fit9` → `fit10` y `fit11` (cada uno ejecuta el anterior con `exec`). Resultados en `fitN.json`.

| Ronda | Qué probó | Resultado |
|---|---|---|
| [sweep.py](scripts/sweep.py) | 800 configuraciones en local contra topes puestos por el asistente | Buena nota con manchas enormes: las métricas no penalizaban lo blotchy. Hubo además un error de forma (matriz transpuesta), corregido. |
| [stateless.py](scripts/stateless.py), [v5.py](scripts/v5.py) | Trazo sin estado, velo por grado, variación por trazo | Orden de grados correcto; HB 65 frente a 66 de la foto. |
| [fit5.py](scripts/fit5.py) | Ajuste a la lámina | Tono cercano; textura en bloques, bordes rectos, zona oscura plana. |
| [fit6.py](scripts/fit6.py) | Más refinamiento numérico | Las cifras mejoraron y el aspecto empeoró (borroso, nubes). |
| [fit7.py](scripts/fit7.py) | Papel sintetizado con el espectro radial del parche 2B (periodo pico 11 px) | Mejor, aún artificial. |
| [fit8.py](scripts/fit8.py) | Trazos finos en capas, techo por píxel según el papel, depósito según penetración | **Elegida por el usuario** y portada al motor. |
| [fit9.py](scripts/fit9.py) | Rampa de definición 2H 1,00, HB 0,72, 2B 0,48, 4B 0,30, 6B 0,18 | Mejor a ojo; 2H con demasiadas rayas, 4B grumoso. |
| [fit10.py](scripts/fit10.py), [fit11.py](scripts/fit11.py) | Recorte del 2H pedido por el usuario; papel más fino según el grado | 2H mejor, grado blando peor (2B y 6B lisos). **Descartadas por el usuario.** |

Comparación con la lámina (L*, de más a menos presión; fit8, tomado del chat de 15:17): 2H 77 79 81 85 90; HB 66 67 71 79 91; 2B 40 44 52 67 76; 4B 27 31 40 59 76; 6B 35 39 51 72 83. Motor anterior: 2H 32 43 54 68 81 y 4B 59 68 74 80 87.

## 5. Qué métricas engañaron

- **Barrido y fit6:** el puntaje subió mientras el aspecto empeoraba. Desde entonces, toda ronda se mira a ojo ([hojas](../README.md)).
- **Ajuste contra la misma lámina:** fit8 se ajustó a esa lámina, así que coincidir en tono y grano era lo esperable. La prueba útil fue visual.
- **Nitidez como diferencia vertical:** sube con el contraste, así que da más en los grados oscuros aunque sus trazos sean menos definidos. No confirma la rampa de definición; la juzga el ojo.
- **Líneas de la foto:** la presión de la prueba (0,85) se eligió para que encajaran; son orientación, no prueba.
- **Topes de oscuridad:** puestos a ojo de la lámina, que muestra sombreado de una capa y no el máximo de la mina. Eso explicó que nunca se viera negro; se bajaron (por ejemplo 6B de L* ~26 a ~15–18).

## 6. Rendimiento

Chrome, 8 hilos, ms por segmento de 10 px ([bench.js](scripts/bench.js), [bench2.js](scripts/bench2.js)).

| Size | Motor anterior | Versión ligera |
|---|---|---|
| 5 | 0,06 | 0,008 |
| 20 | 0,26 | 0,035 |
| 80 | 2,6 | 0,23 |
| 240 | 18,8 | 2,1 |
| 500 | sin medir | ~9 |
| 1000 | 266 | 31–39 |

- Motor portado (`brushLead.ts`, medido en Node, no en Chrome): 20 px 0,06; 80 px 0,8; 240 px 6,9 (6,8 tras el frotado). Comparar con el motor anterior en Chrome es orientativo.
- Crear el papel: unos 170 ms una sola vez, en reposo (la primera versión tardaba 504 ms por una ordenación).
- Lienzo: `getImageData` completo 5/39/130 ms (1024/2048/4096); un bloque de 256 px, 1–3 ms; componer una zona de 64 px, 0,04–0,5 ms.
- Solo la parte nueva del disco (en vez de todo): ganó 1,2–2,6 veces; se descartó como solución.
- Pinceles grandes: Size log 1–1000, resolución completa hasta ~240 px y menor mientras se dibuja por encima (estilo Instant Preview). El coste a media resolución es aritmética, sin medir.

## 7. Contrastes de diseño

| Idea | Estado |
|---|---|
| Leer la capa (alfa) entre pasadas | Descartada: obliga a recalcular al deshacer o mover. |
| Trazo sin estado + techo por píxel + `darken` | **Elegida.** `darken` equivale a `T -= (T − techo)·alfa` donde `T > techo`; un grado duro no aclara a uno blando. |
| Trazos viejos idénticos | Descartada por el usuario: ver [no hay compatibilidad hacia atrás hasta una versión estable](../../history/058-2026-11-W45.md). |
| Test de curvas (cada ajuste movido 25 % cambia ≥ 2 L* o ≥ 1 px; Spacing no cambia el tono) | Propuesto; con presets `lead` esos ajustes no actúan (ver pendientes). |
| `getPredictedEvents`, canvas `desynchronized` | No encontrados en la app; sin probar. |

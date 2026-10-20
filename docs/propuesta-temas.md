# Propuesta: base «Atlas» y color de resaltado

Fecha: 2026-10-20. Estado: **propuesta, sin implementar**; los cinco colores de resaltado están aprobados (Predeterminado lima por defecto) (no hay código de la app en este cambio). Maqueta: [temas.html](mockups/temas.html), con [base-atlas.css](mockups/base-atlas.css), [base-grafito.css](mockups/base-grafito.css) y [base-tinta.css](mockups/base-tinta.css), [acentos.css](mockups/acentos.css) y la segunda parte [temas-2.html](mockups/temas-2.html). Complementa [el sistema visual de las tarjetas](propuesta-sistema-visual-tarjetas.md).

## 1. Modelo

- **Un solo esquema para toda la app, sin catálogo de temas.** Los neutros de «Atlas» (muestreados de una imagen de referencia: solo colores y formas, ningún nombre, imagen ni contenido) pasan a ser la base: fondos, superficies, niveles de texto, líneas y estados. Botones y chips son **píldora (999px)**: `--btn-radius` y `--chip-radius`.
- **Lo único que varía es el color de resaltado**, con una fila de muestras en Ajustes («Color de resaltado») y cinco opciones fijas. Cada una define solo la familia del acento: `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--select-on`, `--select-on-soft` (más `--select-line`, igual al relleno). Selección y botón primario siguen al acento.
- **Alternativa «Grafito»** (segunda referencia, §5): otros neutros con matiz azulado. No es un tema que elegir; es la otra base posible, para decidir una sola.

## 2. Base Atlas

| Token | Valor | Nota |
|---|---|---|
| `--bg`, `--surface` | `#1e1f20` | muestreado |
| `--bg-canvas` | `#131314` | muestreado |
| `--surface-2`, `--surface-3` | `#282a2c`, `#333537` | muestreados |
| `--surface-hover` | `#2d2f31` | derivado |
| `--border`, `--border-strong`, `--border-focus` | `#333537`, `#444746`, `#8d908e` | muestreados |
| `--text`, `--text-2`, `--text-3`, `--text-4` | `#e3e3e3`, `#c4c7c5`, `#8d908e`, `#747775` | text-4 derivado |
| `--danger`, `--warn`, `--ok` | `#f28b82`, `#fdd663`, `#81c995` | estados, derivados |
| `--btn-radius`, `--chip-radius` | `999px` | estándar |

## 3. Colores de resaltado

Los acentos evitan los matices de los estados (`--danger` rojo-coral, `--warn` ámbar, `--ok` verde): por eso **no hay coral, naranja ni ámbar**, y el verde que se ofrece es un verde agua, no el verde de «hecho». Rosa y agua son la propuesta nueva; azul sale de Atlas.

| Nombre (`data-accent`) | `--accent` | `--accent-ink` | `--select-on-soft` (relleno) | `--select-on` (texto) |
|---|---|---|---|---|
| Predeterminado (`lima`) | `#d8ff3a` | `#10140a` | `#3d4d0a` | `#e6ff7a` |
| Azul (`azul`) | `#a8c7fa` | `#062e6f` | `#004a77` | `#c2e7ff` |
| Violeta (`violeta`) | `#d0bcff` | `#381e72` | `#4f378b` | `#eaddff` |
| Rosa (`rosa`) | `#ffb1c8` | `#5e1133` | `#7b2949` | `#ffd9e3` |
| Verde agua (`agua`) | `#6bd8d6` | `#003735` | `#004f4d` | `#9cf1ee` |

`--accent-soft` = acento al 14 % y `--accent-line` = acento al 45 %. `--select-line` = relleno de selección.

### Contrastes (WCAG, todos ≥ 4,5)

Sobre tarjeta `#1e1f20` y lienzo `#131314`.

| Preset | tinta / relleno | acento / tarjeta | acento / lienzo | texto elegido / relleno |
|---|---|---|---|---|
| Predeterminado | 16,23 | 14,37 | 16,17 | 8,37 |
| Azul | 7,50 | 9,60 | 10,80 | 7,20 |
| Violeta | 7,71 | 9,68 | 10,89 | 7,23 |
| Rosa | 7,72 | 9,73 | 10,94 | 7,22 |
| Verde agua | 7,77 | 9,76 | 10,98 | 7,29 |

El relleno de selección frente a la tarjeta ronda 1,8: no es texto, la selección se lee por el texto y la marca claros sobre él.

## 4. Almacenamiento

Atributo `data-accent` en `<html>` y `localStorage` (`ogs-accent`), leído antes de pintar. Sin atributo vale `lima`. Pasarlo a los ajustes persistidos del proyecto **requiere aprobación del usuario** (toca la zona de persistencia protegida); hasta entonces, solo localStorage.

## 5. Segunda referencia: «Grafito»

Muestreada de un editor oscuro (solo colores y formas; sus fotos, marcas y nombres no se usan). Píxeles dominantes: `#1a1a1e` (página, 1,6 M píxeles), `#232327` (paneles), `#313135` (bordes y botones secundarios), `#0c0c0d` (fondo más profundo), `#cbccd0` (texto), `#8d8d8f` (meta), acento `#90e957`.

| Token | Valor | Nota |
|---|---|---|
| `--bg-canvas` | `#1a1a1e` | muestreado |
| `--bg`, `--surface` | `#232327` | muestreado |
| `--surface-2`, `--surface-hover` | `#2a2a2e` | derivado |
| `--surface-3`, `--border` | `#313135` | muestreado |
| `--border-strong` | `#3f3f44` | derivado |
| `--text`, `--text-2` | `#e8e8ea` (derivado), `#cbccd0` | |
| `--text-3`, `--text-4` | `#8d8d8f`, `#6b6b70` | text-4 derivado, solo decorativo |

Contrastes sobre su tarjeta `#232327`: texto 12,8; texto 2 9,76; **meta `#8d8d8f` 4,73** (5,24 sobre el lienzo); text-4 2,95 (solo adorno, no texto).

**Radio:** la referencia usa botones de ~8 px; Atlas, píldoras. Se mantienen las **píldoras (999px) como estándar** (preferencia del usuario) y el 8 px queda como diferencia observada.

**Verde frente a lima.** El acento de la referencia, `#90e957`, está a 25° de tono del lima (97° frente a 72°) y la razón de contraste entre ambos es 1,31: **demasiado cerca para ser una muestra aparte**. Propuesta: **no añadir «Verde»**; el lima Predeterminado cubre ese hueco (con Grafito, el verde de la referencia sería su acento natural; si se prefiere, se sustituye el lima por él, no se suman). Su ratio, por si se cambia: tinta `#0e1f08` / relleno 11,48; acento / tarjeta 10,42; acento / lienzo 11,55; texto elegido `#c4f5a6` sobre relleno `#2f5a14` 6,54.

**Recomendación:** quedarse con Atlas (más neutro, ya probado en la maqueta de tarjetas); Grafito solo si se prefiere su matiz azulado. Se decide una base, no dos.

## 6. Tercera referencia: «Tinta» (monocromo, claro y oscuro)

Muestreada de dos imágenes del mismo diseño (solo colores y formas; sin logo, nombre ni texto). Es la primera base con **modo claro**, así que el modelo de tokens pasa a tener un juego oscuro y otro claro por base (`data-mode="dark|light"` junto a `data-base`).

Muestreo: claro, lienzo `#f1efec` (de lejos el más frecuente) y texto `#000000`; oscuro, superficie `#1b1b1b` (con grano entre `#101010` y `#1f1f1f`) y texto blanco; barra morada `#423163` (claro) y `#8c67d3` (oscuro); magenta `#a14c88` en los extremos del degradado. El degradado `#5b3fd6 → #c2408f` supuesto no se confirmó en píxeles: se usan los valores muestreados.

| Token | Oscuro | Claro |
|---|---|---|
| `--bg-canvas` | `#141414` (derivado) | `#f1efec` (muestreado) |
| `--surface` | `#1b1b1b` (muestreado) | `#fbfaf8` (derivado) |
| `--surface-2`, `--surface-3` | `#222222`, `#2c2c2c` | `#e9e6e1`, `#dedad4` |
| `--border`, `--border-strong`, `--border-focus` | `#333333`, `#444444`, `#8f8f8f` | `#d8d4ce`, `#bdb8b0`, `#6e6b67` |
| `--text`, `--text-2`, `--text-3`, `--text-4` | `#f5f5f5`, `#c9c9c9`, `#8f8f8f`, `#666666` | `#111111`, `#4a4846`, `#6e6b67`, `#9a968f` |
| `--danger`, `--warn`, `--ok` | `#f28b82`, `#fdd663`, `#81c995` | `#b3261e`, `#8a5a00`, `#1e6b3a` |

### Contrastes de Tinta (WCAG)

| Par | Oscuro (sobre `#1b1b1b`) | Claro (sobre `#fbfaf8`) |
|---|---|---|
| texto | 15,8 | 18,1 |
| texto 2 | 10,4 | 8,73 |
| meta (`--text-3`) | 5,33 (5,70 sobre lienzo) | 5,08 (4,62 sobre lienzo) |
| estados danger / warn / ok | 7,21 / 12,28 / 8,79 | 6,27 / 5,68 / 6,25 |
| Monocromo: tinta / relleno | 16,9 | 18,88 |
| Monocromo: texto elegido / relleno | 10,76 | 14,48 |
| Monocromo: línea de selección / tarjeta | 5,33 | 5,08 |

Valores corregidos: el morado `#8c67d3` como acento de texto da 3,74 en oscuro (no pasa), y el meta `#8a8a8a` queda en 4,55 (justo): se usó `#8f8f8f`. El borde claro `#d8d4ce` es solo separador (1,41), no transmite información.

### Modo claro y los colores de resaltado

Los pasteles del oscuro no se leen sobre claro, así que cada color tiene un **juego claro** (acento oscuro, tinta blanca, línea de selección = acento, porque el relleno suave apenas se separa de la tarjeta: 1,2):

| Preset | `--accent` | tinta / acento | acento / tarjeta | acento / lienzo | texto elegido / relleno |
|---|---|---|---|---|---|
| Predeterminado | `#4f6b00` | 6,11 | 5,86 | 5,33 | 9,75 |
| Azul | `#1a56b0` | 7,00 | 6,71 | 6,10 | 10,03 |
| Violeta | `#5b3fd6` | 6,72 | 6,44 | 5,85 | 10,48 |
| Rosa | `#b0285f` | 6,34 | 6,07 | 5,52 | 10,15 |
| Verde agua | `#00797a` | 5,23 | 5,01 | 4,56 | 10,59 |

Rellenos y textos elegidos: lima `#e3efb8`/`#2c3d00`, azul `#d3e3fd`/`#0b2f66`, violeta `#e5dcff`/`#2a1a7a`, rosa `#ffd9e3`/`#5e1133`, agua `#bff0ee`/`#003735`. El lima Predeterminado sigue siendo el valor por defecto y, en claro, se vuelve un verde oliva oscuro.

### Primario monocromo

Opción **«Monocromo»**, sexta muestra, sin aprobar: el primario es el color inverso del texto (píldora negra con texto blanco en claro; blanca con texto negro en oscuro) y no lleva color. Encaja en el modelo sin tokens nuevos: es otro bloque `[data-accent="mono"]` con `--accent` = inverso, `--accent-ink` = el fondo, y la selección neutra (`--select-on-soft` gris, `--select-on` = texto). **La selección sigue legible**: texto elegido / relleno 10,76 (oscuro) y 14,48 (claro), más una línea `--select-line` de 5,3 y 5,1 contra la tarjeta y la marca de verificación, así que no depende del color. Coste: el enlace deja de tener color (se subraya) y primario y selección se parecen más entre sí; por eso es una opción y no el estándar.

### Degradado y textura

- **Degradado** (`--brand-grad`, morado a magenta): solo decorativo, sin texto encima y fuera de la regla de acento. Dónde, como mucho: el indicador de «generando» (barra fina) y los estados vacíos. Nunca en botones, selección ni tarjetas de decisión: sería una tercera variante visual. Un solo uso a la vez.
- **Textura** (grano fino, clase `.grain`): solo opcional en el lienzo; no por defecto, para no ir contra el rendimiento (ver «velocidad antes que completitud») ni ensuciar el texto pequeño.
- **Tipografía** (títulos grandes y ligeros): fuera de alcance; no se cambia ninguna fuente.

### Recomendación

Atlas oscuro sigue siendo la base por defecto. **Modo claro: sí**, pero como segundo juego de la misma base (Atlas ya podría tener uno derivado de Tinta claro), no como esquema aparte: es lo que más pide un usuario de día y los contrastes pasan. **Primario monocromo: solo como sexta muestra opcional**, no como valor por defecto, porque el lima da al primario la identidad de la app. Maqueta: [temas-2.html](mockups/temas-2.html).

## 7. Migración (cuando se apruebe)

1. Mover los neutros de Atlas a `tokens.css` (sustituyen a los actuales) y añadir `--btn-radius` / `--chip-radius`.
2. Añadir la familia del acento y los cinco bloques `[data-accent]`.
3. Tarjetas: aplicar los puentes de `base-atlas.css` (selección y primario leen `--select-*` y `--accent-*`).
4. Fila de muestras en Ajustes (`aria-pressed`, nombre accesible), con su test jsdom.
5. Tras aprobarlo: valorar guardar la elección en los ajustes persistidos.

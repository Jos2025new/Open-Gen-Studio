# Propuesta: base «Atlas» y color de resaltado

Fecha: 2026-10-20. Estado: **propuesta, sin implementar**; los cinco colores de resaltado están aprobados (Predeterminado lima por defecto) (no hay código de la app en este cambio). Maqueta: [temas.html](mockups/temas.html), con [base-atlas.css](mockups/base-atlas.css), [base-grafito.css](mockups/base-grafito.css) y [base-tinta.css](mockups/base-tinta.css), [aurora.css](mockups/aurora.css), [acentos.css](mockups/acentos.css) y la segunda parte [temas-2.html](mockups/temas-2.html). Complementa [el sistema visual de las tarjetas](propuesta-sistema-visual-tarjetas.md).

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

## 6. Tercera referencia: «Aurora» (degradado con grano) y modo claro

Muestreada de dos recortes de una esfera (en oscuro y en claro; solo colores y formas, sin logo, nombre ni texto). Una lectura anterior como monocromo fue un error: el carácter es un **degradado suave de varias paradas más grano fino**, no un morado liso ni una interfaz en blanco y negro.

**Paradas muestreadas** (en ambas imágenes coinciden dentro de ±6 por canal), del resalte al cuerpo y al magenta:

| # | Zona | Valor |
|---|---|---|
| 1 | luz pálida, arriba | `#c1a2d0` |
| 2 | arriba-izquierda | `#8d63af` |
| 3 | azul violáceo, izquierda | `#5a4690` |
| 4 | cuerpo | `#5c367c` |
| 5 | base oscura, abajo-izquierda | `#3e2957` |
| 6 | cuerpo hacia la derecha | `#7d3c75` |
| 7 | magenta cálido, derecha y abajo | `#9c4376` |

Los tonos reales son más apagados que los estimados a ojo (`#c9b6ee`, `#5a3fa0`, `#c2508c`): la foto lleva grano y sombreado. Tampoco se confirmó el sector translúcido arriba a la derecha (se ve como una zona más clara, `#975da9`) ni los números diminutos, que no se usan.

### Aurora como color de resaltado

Es un **sexto preset** junto a los cinco (que no cambian), con versión oscura y clara. Las paradas de la esfera son demasiado oscuras para llevar tinta clara y demasiado medias para tinta oscura, así que la interfaz usa una banda **elevada** de la misma trayectoria (lavanda a rosa), de modo que la tinta oscura pase en todas las paradas.

| | Oscuro | Claro |
|---|---|---|
| paradas (0, 38, 70, 100 %) | `#c9b6ee`, `#b9a4ec`, `#d19fd9`, `#ec9cc0` | `#5a3fa0`, `#7b3f9e`, `#a03c92`, `#b0357f` |
| `--accent` (texto, enlace) | `#c9b6ee` | `#5a3fa0` |
| `--accent-ink` | `#1c1030` | `#ffffff` |
| relleno de selección / texto elegido | `#3a2d5c` / `#f0e6ff` | `#e9e0f7` / `#2a1a5e` |

**Contrastes** (oscuro sobre tarjeta `#1e1f20`; claro sobre `#fbfaf8`):

| Par | Oscuro | Claro |
|---|---|---|
| tinta / cada parada | 9,78; 8,22; 8,29; 8,65 | 7,91; 6,89; 5,91; 5,74 |
| **peor parada** | **8,22** | **5,74** |
| acento / tarjeta | 8,97 | 7,59 |
| acento / lienzo | 10,09 | 6,90 |
| texto elegido / relleno | 10,22 | 11,70 |

### Dónde vive el degradado

Identidad sin dañar la lectura: solo en superficies pequeñas o decorativas, y **el texto nunca va sobre el degradado en bruto** salvo si todas las paradas pasan (las de arriba pasan: peor 8,22 y 5,74).

1. **Botón primario**: relleno degradado suave con grano; la tinta pasa en cada parada.
2. **Fila o chip elegido**: tinte degradado sutil sobre la superficie más **borde degradado** (capa `border-box`); el texto va sobre el tinte, no sobre el degradado.
3. **Casilla activa**: relleno degradado, marca con `--accent-ink`.
4. **Indicador de «generando»**: esfera o anillo pequeño con grano, con la trayectoria completa de la esfera (7 paradas). Es decorativo y no lleva texto.

Las demás tarjetas, rótulos y fondos no lo usan. Los otros cinco resaltados siguen liso; el CSS cae a color liso porque `--accent-grad` solo existe en Aurora.

### Grano

Un SVG `feTurbulence` en línea (data URI de ~0,5 KB, `--grain-img`) a baja opacidad (~12 % efectivo), solo en las superficies con degradado; no en lienzos ni texto. No por defecto en otros presets.

### Modo claro

Off-white cálido como segunda mitad de la base: lienzo `#f1efec` (muestreado), tarjeta `#fbfaf8`, texto `#111`, texto 2 `#4a4846`, meta `#6e6b67`; estados `#b3261e`, `#8a5a00`, `#1e6b3a`. Contrastes: texto 18,1; texto 2 8,73; meta 5,08 (4,62 sobre lienzo); estados 6,27 / 5,68 / 6,25. El modo oscuro es Atlas, sin cambios. Los pasteles no se leen sobre claro: cada color tiene un juego claro (acento oscuro, tinta blanca, línea de selección = acento, porque el relleno apenas se separa de la tarjeta, 1,2):

| Preset | `--accent` | tinta / acento | acento / tarjeta | acento / lienzo | texto elegido / relleno |
|---|---|---|---|---|---|
| Predeterminado | `#4f6b00` | 6,11 | 5,86 | 5,33 | 9,75 |
| Azul | `#1a56b0` | 7,00 | 6,71 | 6,10 | 10,03 |
| Violeta | `#5b3fd6` | 6,72 | 6,44 | 5,85 | 10,48 |
| Rosa | `#b0285f` | 6,34 | 6,07 | 5,52 | 10,15 |
| Verde agua | `#00797a` | 5,23 | 5,01 | 4,56 | 10,59 |

Rellenos y textos elegidos: lima `#e3efb8`/`#2c3d00`, azul `#d3e3fd`/`#0b2f66`, violeta `#e5dcff`/`#2a1a7a`, rosa `#ffd9e3`/`#5e1133`, agua `#bff0ee`/`#003735`. En claro, el lima Predeterminado se vuelve oliva oscuro.

### Monocromo: descartado

La opción de primario inverso (negro en claro, blanco en oscuro) se retira: choca con el degradado como identidad y con el lima por defecto. Solo queda de aquella idea el principio de que la selección no dependa solo del color (línea y marca).

### Recomendación

Atlas oscuro sigue siendo la base por defecto. **Modo claro: sí**, como segundo juego de la misma base. **Aurora: sí, como sexto preset**, sin tocar el valor por defecto (lima). Maqueta: [temas-2.html](mockups/temas-2.html), con [aurora.css](mockups/aurora.css) y [base-tinta.css](mockups/base-tinta.css) (el modo claro).

## 7. Migración (cuando se apruebe)

1. Mover los neutros de Atlas a `tokens.css` (sustituyen a los actuales) y añadir `--btn-radius` / `--chip-radius`.
2. Añadir la familia del acento y los cinco bloques `[data-accent]`.
3. Tarjetas: aplicar los puentes de `base-atlas.css` (selección y primario leen `--select-*` y `--accent-*`).
4. Fila de muestras en Ajustes (`aria-pressed`, nombre accesible), con su test jsdom.
5. Tras aprobarlo: valorar guardar la elección en los ajustes persistidos.

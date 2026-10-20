# Propuesta: base «Atlas» y color de resaltado

Fecha: 2026-10-20. Estado: **propuesta, sin implementar** (no hay código de la app en este cambio). Maqueta: [temas.html](mockups/temas.html), con [base-atlas.css](mockups/base-atlas.css), [base-grafito.css](mockups/base-grafito.css) y [acentos.css](mockups/acentos.css). Complementa [el sistema visual de las tarjetas](propuesta-sistema-visual-tarjetas.md).

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

## 6. Migración (cuando se apruebe)

1. Mover los neutros de Atlas a `tokens.css` (sustituyen a los actuales) y añadir `--btn-radius` / `--chip-radius`.
2. Añadir la familia del acento y los cinco bloques `[data-accent]`.
3. Tarjetas: aplicar los puentes de `base-atlas.css` (selección y primario leen `--select-*` y `--accent-*`).
4. Fila de muestras en Ajustes (`aria-pressed`, nombre accesible), con su test jsdom.
5. Tras aprobarlo: valorar guardar la elección en los ajustes persistidos.

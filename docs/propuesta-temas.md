# Propuesta aprobada: bases y color de resaltado

Fecha: 2026-10-20. Estado: **aprobada (2026-10-20); pasos 1 y 2 del plan implementados** (tokens, bases y selector en Ajustes), pasos 3 a 5 pendientes. Justificación y correcciones del usuario: [ADR 0024](decisions/0024-identidad-visual-tarjetas-bases-resaltado.md). Maqueta: [temas.html](mockups/temas.html) y [temas-2.html](mockups/temas-2.html), con [base-atlas.css](mockups/base-atlas.css), [base-grafito.css](mockups/base-grafito.css), [base-claro.css](mockups/base-claro.css), [base-original.css](mockups/base-original.css), [acentos.css](mockups/acentos.css) y [aurora.css](mockups/aurora.css). Complementa [el sistema visual de las tarjetas](propuesta-sistema-visual-tarjetas.md).

## Decisiones aprobadas

- Plantillas base fijas para las tarjetas, y una o dos tarjetas que destacan.
- «Decisión» sin banda y con la huella antigua.
- La selección sigue al color de resaltado; el verde queda solo para estados.
- Radio de píldora (999px) en botones y chips.
- Un selector de base (cinco opciones) y una fila de resaltado independiente, sin catálogo de temas.
- Los cinco resaltados originales, con lima por defecto, más Aurora.

- «Decisión» se mantiene como variante; las tarjetas de cambio de modelo y de seguimiento usan `card-m`.
- Original conserva sus colores y esquinas de 10 px y usa las plantillas nuevas.
- Estas reglas son la identidad visual: cambiarlas exige aprobación explícita del usuario (regla 6 de AGENTS.md).
- **Marco tranquilo** (2026-10-20, [ADR 0024 M](decisions/0024-identidad-visual-tarjetas-bases-resaltado.md)): el acento solo va en el botón principal o de enviar, la marca, la selección dentro de las tarjetas (casillas, interruptores, deslizadores) y lo que está en curso. Navegación, pestañas, chips y menús activos son neutros (`--active-bg` = `--surface-3`, `--active-text` = `--text`, sin línea); barra lateral, panel derecho y su cabecera sin contorno (`--frame-border` transparente). Dinero y «Connected» no usan el acento (el punto de conectado es `--ok`). Original redefine esos tokens con el lima y los contornos de antes.

**Pendiente:** nada.

## 1. Selector de base (Ajustes → Apariencia)

En este orden:

1. **Sistema** (por defecto): sigue `prefers-color-scheme`; da Atlas en oscuro y Claro en claro.
2. **Atlas**: la base oscura principal.
3. **Grafito**: la oscura secundaria, de carbón azulado.
4. **Claro**: off-white cálido, el modo claro general.
5. **Original (antigua)**: el oscuro verdoso de hoy (`tokens.css`), tal cual. **No recibe mejoras de color ni de radios**: conserva sus colores y esquinas de 10 px, sin píldoras. Sí usa las plantillas de disposición de las tarjetas (aprobado por el usuario, 2026-10-20). Se retirará más adelante.

Debajo, la fila **«Color de resaltado»**, independiente de la base: Predeterminado (lima, en todas las bases), Azul, Violeta, Rosa, Verde agua y Aurora. Cada uno tiene su juego oscuro y su juego claro. Cada resaltado define solo la familia del acento (`--accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--select-on`, `--select-on-soft`, `--select-line`); selección y primario lo siguen.

## 2. Las bases

### Atlas (oscuro)

Neutros muestreados de una referencia (solo colores y formas; ningún nombre, imagen ni contenido).

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

### Grafito (oscuro, carbón azulado)

Muestreado de otra referencia: página `#1a1a1e` (1,6 M de píxeles), paneles `#232327`, bordes y botones secundarios `#313135`, texto `#cbccd0`, meta `#8d8d8f`.

| Token | Valor | Nota |
|---|---|---|
| `--bg-canvas` | `#1a1a1e` | muestreado |
| `--bg`, `--surface` | `#232327` | muestreado |
| `--surface-2`, `--surface-hover` | `#2a2a2e` | derivado |
| `--surface-3`, `--border` | `#313135` | muestreado |
| `--border-strong` | `#3f3f44` | derivado |
| `--text`, `--text-2` | `#e8e8ea` (derivado), `#cbccd0` | |
| `--text-3`, `--text-4` | `#8d8d8f`, `#6b6b70` | text-4 derivado, solo decorativo |

Contrastes sobre `#232327`: texto 12,8; texto 2 9,76; meta 4,73 (5,24 sobre lienzo); text-4 2,95 (adorno). La referencia usa botones de ~8 px: se queda la píldora (diferencia observada, no adoptada). Su acento verde `#90e957` está a 25° de tono del lima y a una razón de 1,31: demasiado cerca, **no se añade «Verde»**; lima cubre ese hueco.

### Claro (off-white cálido, ex Tinta claro)

Lienzo `#f1efec` (muestreado); tarjeta `#fbfaf8` (derivado).

| Token | Valor |
|---|---|
| `--bg-canvas`, `--bg`/`--surface` | `#f1efec`, `#fbfaf8` |
| `--surface-2`, `--surface-3`, `--surface-hover` | `#e9e6e1`, `#dedad4`, `#ebe8e3` |
| `--border`, `--border-strong`, `--border-focus` | `#d8d4ce`, `#bdb8b0`, `#6e6b67` |
| `--text`, `--text-2`, `--text-3`, `--text-4` | `#111111`, `#4a4846`, `#6e6b67`, `#9a968f` |
| `--danger`, `--warn`, `--ok` | `#b3261e`, `#8a5a00`, `#1e6b3a` |

Contrastes sobre la tarjeta: texto 18,1; texto 2 8,73; meta 5,08 (4,62 sobre lienzo); estados 6,27 / 5,68 / 6,25. El borde `#d8d4ce` (1,41) solo separa.

### Original (antigua)

`--bg #0a0a0b`, `--surface #151518`, `--border #2a2a30`, `--text #ececf0`, estados `#f06a6a` / `#ffc25e` / `#86e3a5` y los radios de hoy. Sin cambios; se retirará.

## 3. Colores de resaltado

Evitan los matices de los estados (`--danger`, `--warn`, `--ok`): no hay coral, naranja ni ámbar, y el verde es un verde agua.

### Juego oscuro (Atlas, Grafito, Original)

| Nombre (`data-accent`) | `--accent` | `--accent-ink` | relleno elegido | texto elegido |
|---|---|---|---|---|
| Predeterminado (`lima`) | `#d8ff3a` | `#10140a` | `#3d4d0a` | `#e6ff7a` |
| Azul (`azul`) | `#a8c7fa` | `#062e6f` | `#004a77` | `#c2e7ff` |
| Violeta (`violeta`) | `#d0bcff` | `#381e72` | `#4f378b` | `#eaddff` |
| Rosa (`rosa`) | `#ffb1c8` | `#5e1133` | `#7b2949` | `#ffd9e3` |
| Verde agua (`agua`) | `#6bd8d6` | `#003735` | `#004f4d` | `#9cf1ee` |

`--accent-soft` = acento al 14 %, `--accent-line` = 45 %, `--select-line` = relleno. Contrastes sobre tarjeta `#1e1f20`:

| Preset | tinta / relleno | acento / tarjeta | acento / lienzo | texto elegido / relleno |
|---|---|---|---|---|
| Predeterminado | 16,23 | 14,37 | 16,17 | 8,37 |
| Azul | 7,50 | 9,60 | 10,80 | 7,20 |
| Violeta | 7,71 | 9,68 | 10,89 | 7,23 |
| Rosa | 7,72 | 9,73 | 10,94 | 7,22 |
| Verde agua | 7,77 | 9,76 | 10,98 | 7,29 |

### Juego claro (base Claro)

Los pasteles no se leen sobre claro: cada color usa un tono oscuro, tinta blanca y línea de selección = acento (el relleno apenas se separa de la tarjeta, 1,2).

| Preset | `--accent` | relleno / texto elegido | tinta / acento | acento / tarjeta | acento / lienzo | texto elegido / relleno |
|---|---|---|---|---|---|---|
| Predeterminado | `#4f6b00` | `#e3efb8` / `#2c3d00` | 6,11 | 5,86 | 5,33 | 9,75 |
| Azul | `#1a56b0` | `#d3e3fd` / `#0b2f66` | 7,00 | 6,71 | 6,10 | 10,03 |
| Violeta | `#5b3fd6` | `#e5dcff` / `#2a1a7a` | 6,72 | 6,44 | 5,85 | 10,48 |
| Rosa | `#b0285f` | `#ffd9e3` / `#5e1133` | 6,34 | 6,07 | 5,52 | 10,15 |
| Verde agua | `#00797a` | `#bff0ee` / `#003735` | 5,23 | 5,01 | 4,56 | 10,59 |

**A revisar por el usuario:** en Claro, el lima Predeterminado se vuelve un **verde oliva oscuro** (`#4f6b00`), no el lima brillante: un lima brillante no se lee sobre claro. Se ve en [temas-2.html](mockups/temas-2.html).

### Aurora (degradado con grano)

Sexto resaltado. Muestreado de dos recortes de una esfera (solo colores y formas): un degradado suave de varias paradas más grano fino. Paradas, del resalte al cuerpo y al magenta: `#c1a2d0` (luz pálida arriba), `#8d63af`, `#5a4690` (azul violáceo), `#5c367c` (cuerpo), `#3e2957` (base oscura), `#7d3c75`, `#9c4376` (magenta cálido). Son más apagadas que las estimadas a ojo (`#c9b6ee`, `#5a3fa0`, `#c2508c`).

Esas paradas no llevan tinta, así que la interfaz usa una banda **elevada** de la misma trayectoria:

| | Oscuro | Claro |
|---|---|---|
| paradas (0, 38, 70, 100 %) | `#c9b6ee`, `#b9a4ec`, `#d19fd9`, `#ec9cc0` | `#5a3fa0`, `#7b3f9e`, `#a03c92`, `#b0357f` |
| `--accent` / `--accent-ink` | `#c9b6ee` / `#1c1030` | `#5a3fa0` / `#ffffff` |
| relleno / texto elegido | `#3a2d5c` / `#f0e6ff` | `#e9e0f7` / `#2a1a5e` |
| tinta / cada parada | 9,78; 8,22; 8,29; 8,65 | 7,91; 6,89; 5,91; 5,74 |
| **peor parada** | **8,22** | **5,74** |
| acento / tarjeta; acento / lienzo | 8,97; 10,09 | 7,59; 6,90 |
| texto elegido / relleno | 10,22 | 11,70 |

**Dónde vive el degradado** (identidad sin dañar la lectura; el texto nunca va sobre él en bruto salvo que todas las paradas pasen):
1. Botón primario: relleno degradado suave con grano.
2. Fila o chip elegido: tinte degradado sutil más borde degradado; el texto va sobre el tinte.
3. Casilla activa: relleno degradado, marca con `--accent-ink`.
4. Indicador de «generando»: esfera o anillo pequeño con grano y las 7 paradas, decorativo.

Los demás resaltados siguen lisos (el CSS cae a color liso porque `--accent-grad` solo existe en Aurora). **Grano:** un SVG `feTurbulence` en línea (data URI) a baja opacidad, solo en las superficies con degradado.

## 4. Almacenamiento

`localStorage`: `ogs-base` (`sistema`, `atlas`, `grafito`, `claro`, `original`) y `ogs-accent` (`lima`, `azul`, `violeta`, `rosa`, `agua`, `aurora`). Se aplican como `data-base` y `data-accent` en `<html>`, con una lectura de una línea antes del primer pintado (`sistema` se resuelve con `matchMedia('(prefers-color-scheme: light)')` a `claro` o `atlas`). Sin atributo valen `atlas` y `lima`. **No se guarda en los ajustes persistidos**: toca la zona de persistencia protegida.

## 5. Migración

Una sola secuencia para temas y tarjetas, con sus pruebas, en [el plan único del sistema visual de las tarjetas](propuesta-sistema-visual-tarjetas.md#8-plan-de-migración-único-tarjetas-y-temas): tokens y bases, selector, plantillas, migración tarjeta a tarjeta y script de comprobación.

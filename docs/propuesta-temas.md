# Propuesta: temas de color, y un primer tema «Atlas»

Fecha: 2026-10-20. Estado: **propuesta con maqueta, sin implementar** (sin cambios en el código de la app). Depende de [propuesta-sistema-visual-tarjetas.md](propuesta-sistema-visual-tarjetas.md): sus tokens de selección y de radio son lo que un tema sobrescribe. Maqueta: [mockups/temas.html](mockups/temas.html) (hojas reales + [propuesta.css](mockups/propuesta.css) + [tema-atlas.css](mockups/tema-atlas.css)).

La referencia de Atlas es una captura de una app de fotos con modo oscuro; se usaron **solo sus colores y formas** (muestreados del píxel), nada de su contenido, nombres ni imágenes.

## 1. El modelo de tema

Un tema **sobrescribe solo tokens de color** y, opcionalmente, el radio de chips y botones. **Nunca** toca la escala tipográfica, el espaciado ni las maquetaciones de la propuesta de tarjetas (`card-s/m/l`, plantillas, variantes). Así un tema cambia el aspecto sin cambiar la estructura.

Tokens que cada tema debe definir (todos; sin herencia parcial):

| Grupo | Tokens |
|---|---|
| Fondos | `--bg`, `--bg-canvas`, `--surface`, `--surface-2`, `--surface-3`, `--surface-hover`, `--overlay` |
| Líneas | `--border`, `--border-strong`, `--border-focus` |
| Texto | `--text`, `--text-2`, `--text-3`, `--text-4` |
| Acento (acción primaria) | `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line` |
| Selección | `--select-on` (texto y marca), `--select-on-soft` (relleno), `--select-line` (borde) |
| Estados | `--danger`, `--danger-soft`, `--warn`, `--ok` |
| Forma (opcional) | `--chip-radius`, `--btn-radius` (nuevo) |

Los matices por tipo de medio (`--type-*`) y las sombras no cambian en esta primera versión. La propuesta de tarjetas hoy define `--select-on*` como alias del acento lima; con temas pasan a ser tokens propios (en el tema actual siguen valiendo lima: `--accent`, `--accent-soft`, `--accent-line`).

## 2. Dónde se elige y cómo se guarda

- **Aplicación:** atributo `data-theme="<id>"` en `<html>`. El tema actual no lleva atributo (o `data-theme="actual"`) y usa los valores de `:root` de `tokens.css`; cada tema nuevo es un bloque `[data-theme="id"]` en su propio archivo (`src/styles/themes/<id>.css`).
- **Dónde se elige:** una sección «Apariencia» en el panel de Ajustes (`SettingsPanel.tsx`), con una muestra de cada tema.
- **Cómo se guarda (preferencia de interfaz, no dato del usuario):** lo más seguro es `localStorage` (`ogs-theme`) y una línea mínima en `index.html` que la lee antes del primer pintado para evitar el parpadeo. No toca el almacén protegido ni `data/`.
- **Si se prefiere guardarlo en los ajustes de la app** (`settings.theme` en el store), eso es estado persistido: **hay que pedir autorización al usuario** antes, y no se tocan los archivos de la zona protegida (`docs/persistencia-protegida.md`).
- Sin JS en esta propuesta de maqueta; la lógica real son ~10 líneas.

## 3. Contrastes (WCAG 2.x)

Calculados con la fórmula de luminancia relativa. Mínimos: 4,5 para texto normal, 3 para texto grande y componentes.

| Par | Atlas | Tema actual |
|---|---|---|
| Texto `#e3e3e3` sobre tarjeta `#1e1f20` | **12,86** | 15,47 (`#ececf0` sobre `#151518`) |
| Texto sobre el panel de contenido `#131314` | 14,47 | — |
| Texto secundario `#c4c7c5` sobre tarjeta | 9,69 | 10,40 |
| Meta (`--text-3`) `#8d908e` sobre tarjeta / panel | 5,12 / 5,76 | 5,62 |
| Tenue (`--text-4`) `#747775` sobre tarjeta | **3,65** (no llega a 4,5; solo para texto no esencial) | 2,97 |
| Texto del primario `#062e6f` sobre su relleno `#a8c7fa` | **7,50** | 17,10 |
| Texto elegido `#c2e7ff` sobre relleno de selección `#004a77` | **7,20** | — |
| Enlace / acento `#a8c7fa` sobre tarjeta / panel | 9,60 / 10,80 | — |
| Texto sobre `--surface-2` `#282a2c` | 11,22 | — |
| Estados sobre tarjeta: peligro `#f28b82` / aviso `#fdd663` / correcto `#81c995` | 6,91 / 11,77 / 8,43 | — |

Todos los pares de uso normal pasan AA con holgura; solo `--text-4` queda por debajo de 4,5 (mejor que el actual 2,97) y se reserva a marcadores de posición y texto desactivado.

## 4. Primer tema: «Atlas»

Neutro y sin matiz cálido ni verde; azul de Material oscuro como único acento. Valores completos en [tema-atlas.css](mockups/tema-atlas.css).

| Token | Valor | Origen |
|---|---|---|
| `--bg` (barra lateral y superior), `--surface` | `#1e1f20` | muestreado |
| `--bg-canvas` (panel de contenido) | `#131314` | muestreado |
| `--surface-2` (campo de búsqueda) | `#282a2c` | muestreado |
| `--surface-3` (pista de la barra de almacenamiento) | `#333537` | muestreado |
| `--surface-hover` | `#2d2f31` | derivado |
| `--border` | `#333537` | muestreado (pista) |
| `--border-strong` (divisores) | `#444746` | muestreado |
| `--border-focus` (contorno del botón secundario) | `#8d908e` | muestreado |
| `--text` / `--text-2` | `#e3e3e3` / `#c4c7c5` | muestreado |
| `--text-3` / `--text-4` | `#8d908e` / `#747775` | muestreado / derivado |
| `--accent` (enlaces, botones de texto, barra) | `#a8c7fa` | muestreado |
| `--accent-ink` | `#062e6f` | derivado (Material oscuro) |
| `--accent-soft` / `--accent-line` | `rgba(168,199,250,.14)` / `.45` | derivado |
| `--select-on-soft` (píldora elegida) | `#004a77` | muestreado |
| `--select-on` (texto de lo elegido) | `#c2e7ff` | muestreado |
| `--danger` / `--warn` / `--ok` | `#f28b82` / `#fdd663` / `#81c995` | derivado |
| `--chip-radius`, `--btn-radius` | `999px` (píldoras) | forma de la referencia |

**Elecciones y dudas:**
- **Fondos al revés de lo esperado.** Muestreado: las barras y la columna lateral son `#1e1f20` y el **panel de contenido es más oscuro**, `#131314`. Atlas mantiene esa relación: las tarjetas (`--surface`) toman el color de la barra, más claro que el panel donde viven.
- **Selección** = píldora con relleno azul profundo `#004a77` y texto `#c2e7ff` (como el elemento activo del menú de la referencia); en la casilla, relleno azul claro con la marca en azul profundo.
- **Primario.** La referencia **no tiene botón relleno**: su acción visible es una píldora con contorno gris y texto azul. Se propone el primario relleno **azul claro `#a8c7fa` con tinta `#062e6f`** (par primario y «sobre primario» de Material oscuro), coherente con el relleno de selección; y se conserva el **secundario como en la referencia** (contorno `#8d908e`, texto azul, sin relleno).
- **Ambiguo:** los estados (`--danger`, `--warn`, `--ok`) no aparecen en la captura (solo un corazón rojo diminuto); se derivan de la paleta de Material oscuro. `--text-4` y `--surface-hover` también son derivados. Pedir al usuario más imágenes antes de fijarlos.
- **Radio de las tarjetas** (`--r-m`) y de las teselas no cambia; la referencia redondea el panel de contenido (~24 px), pero eso es maquetación, no color.

## 5. Plan de migración (pasos pequeños, cada uno con su prueba)

1. **Tokens de tema** en `tokens.css`: `--select-on*`, `--btn-radius`, y mover los colores fijos de las tarjetas a tokens (depende de la migración de tarjetas). Prueba: `check-sizes`, suite.
2. **Los selectores actuales leen los tokens** (`.q-opt.is-on`, `.set-model.is-on`, `.cc-pick`, `.btn`, `.btn-secondary`, `.cc-chip`): hoy fijan colores y radios (los «puentes» de `tema-atlas.css` los simulan). Prueba: jsdom de tarjetas sin cambios visibles en el tema actual.
3. **Mecanismo `data-theme`** y `src/styles/themes/atlas.css` (pasar el bloque de la maqueta). Prueba: test que comprueba que cada tema define todos los tokens de §1.
4. **Selector en Ajustes → Apariencia** y persistencia (`localStorage`; `settings.theme` solo con autorización). Prueba: jsdom del selector.
5. **Comprobación de contraste en CI** (`scripts/check-themes.mjs`, solo propuesta): lee los bloques de tema y falla bajo los mínimos de §3.

## Límites

- Es un documento y una maqueta; no cambia la app.
- Atlas se basa en una sola imagen; los valores derivados están marcados y pueden ajustarse.
- Los temas no cambian estructura: eso es la propuesta de tarjetas.

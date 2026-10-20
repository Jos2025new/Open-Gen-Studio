# Propuesta: un sistema visual acotado para las tarjetas del chat

Fecha: 2026-10-20. Estado: **propuesta, sin implementar** (solo documento; ningún cambio de código). Alcance: todas las tarjetas del chat y las superficies parecidas; la regla sirve para el resto de la app.

## Por qué

Las tarjetas nuevas (cambio de modelo y seguimiento, `cc-narrow`) desentonan con las habituales, y no hay nada escrito sobre el estilo visual: cada agente trabaja dentro del aspecto general pero inventa su propia maqueta, tamaños y rejilla. Hay tokens (`src/styles/tokens.css`) y una nota de «cohesión» (radios, cinco tamaños de letra, una escala de espacio), pero **las tarjetas casi no los usan**: `chat-cards.css` tiene 174 valores en `px` frente a 98 usos de `var(--…)`, y `chat.css` ya mezcla ambos.

## 1. Inventario (desde el código)

Tokens existentes (`tokens.css:1-60`): letras `--fs-xs 11 / s 12 / m 13 / l 15 / xl 20`; radios `--r-s 6 / --r-m 16 / --r-l 24 / --r-full` (y la familia antigua `--radius-xs 5 … -xl 18`); espacio `--sp-1 4 / 2 8 / 3 12 / 4 16 / 5 24`; verde `--ok #86e3a5`; acento `--accent` (lima `#d8ff3a`).

Leyenda: **[px]** = valor fijo en vez de token.

| Superficie | Ancho | Relleno / huecos | Radio | Título / cuerpo / meta | Botones | Chips / píldoras | Iconos | Código |
|---|---|---|---|---|---|---|---|---|
| Base común `.gen-card, .plan-card, .q-card` | `max-width:100%` | — | `--r-m` 16 | — | — | — | — | `chat.css:3`, `:169` |
| **Ajustes (confirm_settings)** `q-card set-card cc-card cc-w` | `.cc-w`: `min(620px,100%)` **[px]**, `margin-right:auto` | `16px 18px 12px` **[px]**; cabecera `margin-bottom:14px`; pie `margin-top:14px; padding-top:12px` | `--r-m` | título `600 16px/1.3` **[px]** (`.cc-title`); cuerpo `--fs-m`; meta `.set-total` 11px **[px]** | `Button` primario `sm`/`md` (`.btn` 8px 12px; `.btn-sm` 5px 9px, 12px **[px]**) | `.cc-chip` 8px 12px, radio 10 **[px]**, `--fs-m` | 13-16 | `chat-cards.css:2,6-7,18,41-42,102`; `SettingsCard.tsx:61` |
| Ajustes confirmada `cc-set-done` | `.cc-w` | `11px 14px` **[px]** | `--r-m` | nombre 600; chips `.cc-mini` 12px **[px]** | — | `.cc-mini` 3px 9px, radio 8 **[px]** | 16 | `chat-cards.css:131-135`; `SettingsCard.tsx:35` |
| **Plan** `plan-card cc-w` | `.cc-w` 620 | igual que ajustes; pasos `padding:12px 0 6px`, hueco 12 **[px]** | `--r-m` | título `600 16px` **[px]**; paso `--fs-m` 600; detalle `--fs-s`; coste `--fs-s` | aprobar `.cc-approve` 10px 16px, radio 12, 700 **[px]** | miniatura de paso 44×44 radio 9 **[px]** | 44 | `chat-cards.css:3-9,43-70,102-111`; `PlanCard.tsx:182` |
| **Preguntas** `q-card` | sin `.cc-w`: ancho del contenedor | `padding:16px` **[px]**; `q-block margin:16px 0` | `--r-m` | `q-question` 550 (hereda 13); intro 12px/1.6 **[px]** | pie a la derecha, hueco 8 | `.q-opt` 7px 10px, **radio 5**, 12px **[px]**; elegida = acento lima | — | `chat.css:3-5`; `QuestionsCard.tsx:67` |
| Preguntas respondida `q-card is-done` | contenedor | `16px` | `--r-m` | `q-summary` 12px | — | — | — | `QuestionsCard.tsx:30` |
| **Generación** `gen-card` | `.is-fit`: `fit-content`, mín `min(100%,240px)`; error `min 300 / max 480` **[px]** | cabecera `12px 16px 6px`, meta `2px 16px 12px`; `.is-fit` 9px 10px **[px]** | `--r-m` (teselas 7) | prompt 12px, meta `--fs-xs` | barra de tesela | — | 30 (origen) | `chat.css:3,62-73,92` |
| **Cambio de modelo** (nueva) `cc-narrow cc-switch` | `fit-content`, `max-width:min(360px,100%)` **[px]** | `12px 14px 10px` **[px]**; línea `margin-bottom:6px`; pie `margin-top:10px` | `--r-m` | solo una línea `--fs-xs` | «Keep» ghost `sm`, «Change» primario `sm` | `.cc-mini` | — | `chat-cards.css:112-118`; `SettingsCard.tsx:262-280` |
| **Seguimiento** (nueva) `cc-narrow cc-follow` | igual | igual; filas `padding:5px 8px`, hueco 4 **[px]** | filas **8** **[px]** | línea y filas `--fs-xs` | ninguno (un clic) | casilla 16×16 radio 4, borde 1.5 **[px]**; `ModelField` en `cc-chip` 5px 9px | 12-13 | `chat-cards.css:114-122`; `SettingsCard.tsx:283-315` |
| Aviso / `notice-retry` | contenedor | botón propio | — | — | `.notice-retry` (estilo aparte del `Button`), primario `.is-primary` | — | — | `chat.css:120`; `FeedList.tsx:95-137` |
| Popover del modelo `.cc-pop` | 480 **[px]** (`ChipPop`) | `14px` **[px]** | **16** (no `--r-m` por casualidad) | filas `.q-opt set-model` | — | — | — | `chat-cards.css:29`; `ChipPop.tsx` |
| Popover genérico `.popover` | — | `5px` | `--radius` 10 (familia antigua) | — | — | — | — | `ui.css:26` |
| Burbuja del usuario | `max-width:85%` | `12px 16px` | `12 12 3 12` **[px]** | — | — | — | — | `chat.css:2` |

## 2. Qué comparten y quién se sale

**Lo que casi todas comparten** (el «centro de gravedad»):
- Contenedor `border:1px solid var(--border); border-radius: var(--r-m); background: var(--surface)`.
- Relleno de 16 px (16/18 en las grandes) y huecos de 8, 10, 12, 14 px.
- Título 16 px / 600 con icono de 16 px a la izquierda; cuerpo 13 px (`--fs-m`); detalle 11-12 px.
- Pie con borde superior, acciones a la derecha, hueco 8; un solo botón primario.
- Tamaños de letra de rejilla (11/12/13) y botones `Button` `sm`/`md`.

**Los que se salen:**
1. **Cambio de modelo y seguimiento (las dos nuevas)**: todo en `--fs-xs`, relleno 12/14, filas con radio 8, casilla propia, ancho `fit-content`. Son la única superficie con letra *toda* pequeña y sin cabecera de icono y título; junto a tarjetas de 620 px parecen un elemento de otra interfaz.
2. **Preguntas**: sin `.cc-w` (ancho = contenedor), `q-card` con relleno 16 y *chips* de radio 5 y verde-lima, no el `cc-chip` de ajustes (radio 10). Tampoco usa la cabecera de icono y título.
3. **Dos familias de chip**: `.q-opt` (radio 5, 12 px, 7×10) frente a `.cc-chip` (radio 10, 13 px, 8×12) y `.cc-mini` (radio 8, 12 px, 3×9). Tres formas para «una opción/valor».
4. **Selección con dos colores**: `.q-opt.is-on` y `.cc-ratio.is-on` usan el acento lima; la casilla nueva usa `--ok` (verde). El usuario pidió verde; el resto de la app usa lima.
5. **Botones**: `notice-retry` es un botón distinto del `Button`; `.cc-approve` añade su propio relleno y radio 12; `set-more` radio 5 con borde discontinuo.
6. **Radios**: `--r-m` 16 en tarjetas, 16 fijo en popovers, 10 en chips, 8-9 en miniaturas y filas, 5 en `.q-opt`, 12 en burbuja y `.cc-approve`. Siete valores donde la nota de cohesión prevé tres.
7. **Tamaños fijos**: ancho 620 (`.cc-w`), 360 (`cc-narrow`), 480 (popover), 300/480 (generación con error), 240 (generación): sin tokens.
8. **Estilos solapados**: las tarjetas viven en dos archivos (`chat.css` mínimo, comprimido en pocas líneas; `chat-cards.css` encima), con `!important` en `.cc-result`.

## 3. Escala propuesta: tres tamaños

Principio: **la tarjeta se mide por lo que contiene, no por quién la hizo.** Tres tamaños y nada más; todo con tokens. Se añaden a `tokens.css` los tokens de tarjeta y a `chat-cards.css` tres clases (`card-s`, `card-m`, `card-l`) que definen *todo* lo de esta sección; el código de cada tarjeta solo elige la clase.

Tokens nuevos (valores = los más usados hoy, ver §2):

```css
--card-w-s: 22rem;   /* 352 px: mínimo, ancho de contenido con tope */
--card-w-m: 32rem;   /* 512 px */
--card-w-l: 38.75rem;/* 620 px: el .cc-w actual */
--card-pad-s: var(--sp-3);            /* 12 */
--card-pad-m: var(--sp-4);            /* 16 */
--card-pad-l: var(--sp-4) 18px;       /* sustituir 18 por --sp-4 en el paso de migración */
--card-gap: var(--sp-2);              /* 8: hueco entre elementos */
--card-gap-l: var(--sp-3);            /* 12: entre bloques en la grande */
--card-radius: var(--r-m);            /* 16, el contenedor */
--chip-radius: var(--radius);         /* 10: chips y píldoras; elimina 5/8/9 */
--select-on: var(--ok);               /* selección: verde */
--select-on-soft: color-mix(in srgb, var(--ok) 16%, transparent);
```

| | **mínimo** `card-s` | **medio común** `card-m` | **estándar** `card-l` |
|---|---|---|---|
| Para | confirmación en línea: una línea más acciones (cambio de modelo, seguimiento, avisos con acción) | preguntas, tarjetas de estado/confirmadas, errores con acción, vista previa corta | confirm settings, plan, resultados: contenido con secciones |
| Ancho | `fit-content`, `max-width: var(--card-w-s)`, alineada a la izquierda | `width: min(var(--card-w-m), 100%)` | `width: min(var(--card-w-l), 100%)` |
| Relleno | `--card-pad-s` | `--card-pad-m` | `--card-pad-l` |
| Radio | `--card-radius` | `--card-radius` | `--card-radius` |
| Título | `--fs-m` / 600, sin cabecera propia: la línea de pregunta hace de título | `--fs-l` (15) / 600 | `--fs-l`+ `font-head` 16 / 600 (hoy `.cc-title`) |
| Cuerpo | `--fs-s` (12) | `--fs-m` (13) | `--fs-m` |
| Meta | `--fs-xs` (11), `--text-4` | `--fs-xs` | `--fs-s` (12) |
| Cabecera | sin icono; opcional un icono de 14 px dentro de la línea | icono 16 + título (`.cc-head`) | icono 16 + título, subtítulo a 30 px de sangría (como hoy) |
| Acciones | misma fila que la línea o pie sin borde, alineadas a la derecha; un solo primario `Button sm` | pie con borde superior, a la derecha, `Button md`; un solo primario | pie con borde superior, total/meta a la izquierda, acciones a la derecha, un solo primario `Button md` |
| Chip / píldora | `.cc-mini` (modelo, valor) | `.cc-chip` `sm` | `.cc-chip` (hoy) y `ModelField` |
| Opciones y selección | casilla `.cc-check` (16×16, radio 4): gris vacío; marcada = relleno `--select-on` con check | igual, o `.cc-chip` con `is-on` verde cuando son valores | `.cc-chip`, `StepSlider`, `AspectPicker`; marcada verde |
| Iconos | 14 | 16 | 16 (44 en miniaturas de paso) |

Selección verde en todas: `.q-opt.is-on`, `.cc-ratio.is-on` y `.cc-pick.is-on` pasan a `--select-on` / `--select-on-soft`; **el acento lima queda para la acción primaria y el estado activo de navegación**, como dice el comentario de `tokens.css`. (Decisión pendiente del usuario: el verde en toda la app, o solo en tarjetas.)

## 4. Reglas para los agentes (vinculantes)

1. **Elige uno de los tres tamaños** (`card-s`, `card-m`, `card-l`); no se crean anchos, rellenos ni radios nuevos.
2. **Reutiliza** `ModelField`, `ChipPop`, `Button`, `.cc-mini`, `.cc-chip` y `AspectPicker`. Un selector de modelo se hace con `ModelField` y nada más.
3. **Valores solo con tokens**: ni `px`, ni `rem` sueltos, ni colores fijos en CSS de tarjetas; si falta un valor se discute en este documento antes de añadirlo.
4. **Un solo primario por tarjeta**, a la derecha; la selección es verde (`--select-on`).
5. **Ninguna tarjeta nueva ni cambio de aspecto sin actualizar este documento** y su fila del inventario; la revisión comprueba el tamaño elegido.
6. **Los tests de interfaz** (jsdom) afirman el tamaño (`card-s|m|l`) y los componentes reutilizados.

Dónde viven: este documento (`docs/`, enlazado desde `docs/README.md`) y **una línea en AGENTS.md**. AGENTS.md pesa ahora 3 064 bytes y el tope es de 3 KB (3 072): caben solo ~8 bytes, así que la línea exige recortar otra primero (p. ej. quitar la frase del punto «Dónde mirar → Rendimiento» o abreviar «Salvaguardas»). Propuesta de línea (≈ 110 bytes): «Tarjetas del chat: elige un tamaño de [docs/sistema-visual.md](docs/sistema-visual.md) y reutiliza sus componentes; sin px sueltos.» Alternativa sin tocar AGENTS.md: enlazarlo desde `docs/README.md` y exigirlo en `docs/map.md` (un contrato `card-sizes` cuya prueba lea las clases).

**Script de comprobación (solo propuesta):** `scripts/check-card-style.mjs`, en `npm test` junto a los `check-*`: recorre los CSS de tarjetas (`chat-cards.css`, bloques de tarjeta de `chat.css`) y falla ante un `px`/`rem` literal, un color hexadecimal o un `border-radius` que no sea token, con una lista de excepciones congelada (baseline, como `check-sizes`) que **solo puede bajar**. Hoy habría ~170 excepciones en el baseline.

## 5. Plan de migración (pasos pequeños, cada uno con su prueba)

1. **Tokens y clases** (`tokens.css`, `chat-cards.css`): añadir `--card-*`, `--chip-radius`, `--select-on` y `card-s/m/l` sin usarlos aún. Prueba: ninguna visual; `check-sizes` y suite.
2. **Cambio de modelo y seguimiento → `card-s`**: ancho `fit-content` con tope `--card-w-s`, letra por tamaño (título `--fs-m`, cuerpo `--fs-s`), relleno `--card-pad-s`. Prueba: `switch-model-card-ui.test.ts` afirma `card-s`, la píldora y la casilla.
3. **Selección verde unificada**: `.q-opt.is-on`, `.cc-ratio.is-on`, `.cc-pick.is-on` a `--select-on` (con decisión del usuario). Prueba: los jsdom de `chat-cards-c5/c7b` afirman la clase, no el color.
4. **Preguntas → `card-m`**: añadir `.cc-w`-equivalente `card-m`, cabecera icono + título y `.cc-chip` en vez de `.q-opt`. Prueba: `chat-cards` de preguntas actuales + nueva afirmación del tamaño. Es el paso con más riesgo visual.
5. **Ajustes y plan → `card-l`**: sustituir `620px`, `16px 18px` y `.cc-title 16px` por tokens (sin cambio visible). Prueba: los tests actuales sin tocar, más la afirmación de `card-l`.
6. **Chips y radios**: una sola forma de chip (`.cc-chip`/`.cc-mini` con `--chip-radius`); `.q-opt`, `.set-more` y `.cc-approve` migran. Prueba: jsdom de chips.
7. **Avisos y generación**: `notice-retry` a `Button`; la tarjeta de generación a `card-m`. Prueba: `chat-cards-c7b`, tests de aviso.
8. **Script `check-card-style`** con su baseline congelado. Prueba: el propio script en `npm test`.

Cada paso es un commit con `npm run test:related`; al cerrar, `npm test`. El usuario revisa visualmente los pasos 2, 4 y 5 en el sandbox (no hay navegador automatizado).

**Qué tamaño deben tomar las tarjetas nuevas:** **mínimo (`card-s`)**. Son confirmaciones de una línea con acciones y no deben competir con la tarjeta de ajustes; lo que las desentona hoy no es el tamaño, sino mezclar un ancho estrecho con letra y relleno propios. En `card-s` conservan la anchura corta, pero con los tokens y la jerarquía de letra del resto (título 13 px, cuerpo 12 px), píldora `.cc-mini`, casilla verde y un único primario. Si el usuario prefiere que se parezcan más a las demás, `card-m` (512 px, relleno 16, título 15 px) es la alternativa; el seguimiento, con su lista de modelos, puede pasar a `card-m` sin cambiar de lógica.

## Límites

- Es un documento; no cambia código ni estilos.
- Los valores de la escala salen de los más usados hoy; el usuario puede ajustarlos antes del paso 1.
- No se cubren las superficies fuera del chat (Home, Designer, nodos), que seguirán la misma norma de tokens en un segundo tiempo.

# Propuesta: un sistema visual acotado para las tarjetas del chat

Fecha: 2026-10-20. Estado: **propuesta, sin implementar** (solo documento; ningún cambio de código). Alcance: todas las tarjetas del chat y las superficies parecidas; la regla sirve para el resto de la app.

## Por qué (y qué se busca)

Una sola identidad visual con **jerarquía**, no uniformidad aburrida: un estándar fijo para todo y, solo donde aporta, unas pocas variaciones permitidas, con motivo y con tope. Lo que no tiene motivo se migra.

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

## 2. Qué comparten, quién se sale, y qué vale la pena conservar

**Lo que casi todas comparten** (el centro de gravedad): contenedor `border 1px --border; radius --r-m; background --surface`; relleno de 16 px (16/18 en las grandes); título 16 px / 600 con icono de 16 px; cuerpo 13 px (`--fs-m`); detalle 11-12 px; pie con borde superior, acciones a la derecha y un solo primario; botones `Button` `sm`/`md`.

**Clasificación de las diferencias** (no todas son malas):

| Diferencia | Veredicto | Motivo |
|---|---|---|
| Cambio de modelo y seguimiento (`cc-narrow`): letra toda `--fs-xs`, relleno 12/14, casilla propia, sin cabecera | **Deriva: migrar a `card-s`** | Es un tamaño legítimo (mínimo), pero con letra, relleno y radios inventados; no tiene papel de jerarquía. |
| Preguntas: sin `.cc-w`, `.q-opt` de radio 5, sin cabecera de icono y título | **Deriva: migrar a `card-m`** | Es una tarjeta común con otro esqueleto, sin motivo. |
| `.cc-set-done` (la tarjeta resuelta en una línea de resumen) | **Conservar y promover a estado común** | Toda tarjeta, al resolverse, se pliega a una línea; reduce ruido del historial. Pasa a ser plantilla («resuelta»), no excepción de ajustes. |
| `.cc-mini` (píldora de solo lectura) frente a `.cc-chip` (control que abre algo) | **Conservar con dos papeles** | Mostrar un valor frente a editarlo. Ambos con `--chip-radius`. |
| `.q-opt` radio 5 y `.set-more` radio 5 | **Deriva** | Forma de chip repetida sin papel; migran a `.cc-chip`/`--chip-radius`. |
| Selección: `.q-opt` y `.cc-ratio` en lima; casilla en verde | **Deriva (a decidir)** | Dos colores para «elegido». Se propone el verde para selección y la lima solo para la acción primaria y la navegación activa. |
| `notice-retry` como botón aparte | **Deriva** | Debe ser un `Button` `sm`. |
| `.cc-approve` (relleno 10×16, radio 12, 700) y el coste del plan | **Conservar dentro de la variante «Decisión»** (§3) | Es la acción que gasta dinero: merece énfasis. |
| Generación `is-fit` (ancho = medios), teselas de radio 7, barra de tesela, error 300-480 | **Conservar dentro de la variante «Resultado»** (§3) | El contenido manda: el ancho sigue a la imagen. |
| Popover del modelo (480 px, radio 16, relleno 14) | **Conservar como categoría «superposición»** | No es una tarjeta del hilo; se le dan tokens (`--pop-w`, `--pop-radius`) sin cambiar el aspecto. |
| Burbuja del usuario (radio 12/12/3/12, 85 %) | **Conservar** | Es un mensaje, no una tarjeta. |
| Siete radios, anchos fijos (620/360/480/300/240), `!important` en `.cc-result`, estilos repartidos en `chat.css` y `chat-cards.css` | **Deriva** | Sin papel; pasan a tokens y a un solo archivo de tarjetas. |

## 3. La base fija: plantillas de maquetación

Todas las tarjetas usan **las mismas plantillas**. Tres tamaños; cambian el ancho y un paso de letra, no la estructura.

**Tipografía (tokens, los mismos en todas las tarjetas):**

| Papel | Familia | Tamaño | Peso |
|---|---|---|---|
| Título | `--font-head` | `--fs-l` (15); en `card-l` 16 (`--fs-title`, nuevo) | 600 |
| Etiqueta / pregunta / nombre | cuerpo | `--fs-m` (13) | 550 |
| Cuerpo | cuerpo | `--fs-m` (en `card-s`: `--fs-s`) | 400 |
| Meta / detalle | cuerpo | `--fs-xs`-`--fs-s`, `--text-4` | 400 |
| Cifra (precio, coste) | cuerpo, `num` | igual que su papel | 600 |

**Espaciado (una escala, no valores sueltos):** dentro de un elemento `--sp-2` (8); entre bloques `--sp-3` (12); relleno de tarjeta `--sp-3` (`card-s`) o `--sp-4` (`card-m`, `card-l`); el pie se separa con borde superior y `--sp-3` de relleno en `card-m`/`card-l`.

**Plantillas (clases que se añaden en `chat-cards.css`):**

1. **Cabecera** `.card-head`: icono 16 (14 en `card-s`) + título; a la derecha, meta o menú opcionales. En `card-s` la propia línea de pregunta hace de cabecera.
2. **Cuerpo** `.card-body`: texto, campos o secciones (`.card-section`, separadas por borde superior y `--sp-3`).
3. **Opciones** `.card-options`: tres formas permitidas, nada más: **casillas** `.card-check` (16×16, radio 4, gris vacío; elegida = relleno `--select-on` + check), **chips** `.cc-chip` (valor editable, abre un `ChipPop`/`ModelField`) y **píldoras** `.cc-mini` (valor de solo lectura). Elegido = verde.
4. **Pie** `.card-foot`: meta o total a la izquierda; acciones a la derecha; **un solo primario**; borde superior en `card-m`/`card-l`, sin borde en `card-s`.
5. **Resuelta** `.card-done`: una línea con check, nombre y píldoras de lo elegido, más «editar». Todas las tarjetas que piden algo la tienen.

**Tamaños:**

| | `card-s` mínimo | `card-m` medio | `card-l` estándar |
|---|---|---|---|
| Para | confirmación en línea: una línea más acciones (cambio de modelo, seguimiento, avisos con acción) | preguntas, estados, errores con acción, vista previa corta | ajustes, plan: contenido con secciones |
| Ancho | `fit-content`, máx. `--card-w-s` (352) | `min(--card-w-m, 100%)` (512) | `min(--card-w-l, 100%)` (620) |
| Relleno | `--card-pad-s` | `--card-pad-m` | `--card-pad-l` |
| Título / cuerpo / meta | 13 / 12 / 11 | 15 / 13 / 11 | 16 / 13 / 12 |
| Chip / botón | `.cc-mini` / `Button sm` | `.cc-chip` / `Button md` | `.cc-chip`, `ModelField` / `Button md` |

Tokens nuevos en `tokens.css`: `--card-w-s: 22rem`, `--card-w-m: 32rem`, `--card-w-l: 38.75rem`, `--card-pad-s: var(--sp-3)`, `--card-pad-m: var(--sp-4)`, `--card-pad-l: var(--sp-4)` (hoy 16×18), `--card-radius: var(--r-m)`, `--chip-radius: var(--radius)`, `--fs-title: 16px`, `--select-on: var(--ok)`, `--select-on-soft: color-mix(in srgb, var(--ok) 16%, transparent)`, `--pop-w: 30rem`, `--pop-radius: var(--r-m)`.

## 4. Variaciones permitidas (máximo dos)

Una tarjeta destaca cuando es un **momento clave** del flujo. Se proponen dos, y ninguna más sin pasar por la regla de §5.

### Variante «Decisión»: la tarjeta del plan (aprobar y gastar)
Por qué: es el punto donde el usuario autoriza coste; debe leerse como lo más importante del hilo.
- **Puede variar:** borde y cabecera con `--accent-line` / `--accent-soft`; el coste total en `--fs-l` 600 junto al primario; el primario más grande (`.cc-approve`: relleno 10×16, radio 12, 700, ya existente); miniaturas de paso más grandes (44 px) con sus estados.
- **Debe seguir fijo:** escala tipográfica, espaciado, plantillas (cabecera, pasos como secciones, pie), un solo primario a la derecha, `card-l` de ancho.
- Aplica a: `PlanCard` (y, si el usuario quiere, la aprobación de coste de un paso).

### Variante «Resultado»: la tarjeta de generación
Por qué: el contenido es lo que el usuario vino a ver; los medios mandan, la tarjeta se retira.
- **Puede variar:** el ancho (`fit-content` según el medio, mínimo 240 px, `--card-w-l` de tope); medios grandes con teselas de radio propio y barra de acciones superpuesta (`tile-bar`); cabecera mínima (prompt de dos líneas) y meta bajo el medio.
- **Debe seguir fijo:** tipografía y espaciado, `--card-radius` del contenedor, acciones con `Button`/iconos del sistema, un solo primario cuando lo hay (p. ej. «Run»), estados (error, cancelada) solo cambian color de borde e icono.
- Aplica a: `GenerationCard` y `StudioGeneration`.

**Estados no son variantes:** error (`--danger`), cancelada, resuelta y en curso cambian color de borde, icono o la plantilla «resuelta»; no maquetación.

## 5. Regla para añadir una variación

Una variante nueva solo entra si cumple las tres:
1. **Un papel en la jerarquía** escrito en la tabla de §4 («momento clave de…»). «Se veía mejor» no es un papel.
2. **Una entrada en este documento** con qué varía y qué sigue fijo, aprobada por el usuario antes de escribir CSS.
3. **Tope: dos variantes** a la vez. Una tercera exige retirar o fusionar una existente.

Las cosas pequeñas (un icono, un color de estado) no son variantes: usan tokens de estado.

## 6. Reglas vinculantes para los agentes

1. **Elige un tamaño** (`card-s`, `card-m`, `card-l`) y las plantillas de §3 (cabecera, cuerpo, opciones, pie, resuelta). Sin anchos, rellenos ni radios nuevos.
2. **Reutiliza** `ModelField`, `ChipPop`, `Button`, `.cc-mini`, `.cc-chip`, `.card-check` y `AspectPicker`. Un selector de modelo es `ModelField` y nada más.
3. **Solo tokens**: ni `px`, ni `rem` sueltos, ni colores fijos en CSS de tarjetas.
4. **Un solo primario por tarjeta**, a la derecha; selección en verde (`--select-on`).
5. **Ninguna tarjeta nueva ni cambio de aspecto sin actualizar este documento.** Una variación nueva sigue §5 (papel, entrada, tope de dos).
6. **Los tests jsdom** afirman el tamaño (`card-s|m|l`), la variante si la hay, y los componentes reutilizados.

**Dónde viven:** este documento (enlazado desde `docs/README.md`) y **una línea en AGENTS.md**. AGENTS.md pesa 3 064 bytes y el tope es 3 KB (3 072): hay que recortar otra línea antes (p. ej. abreviar «Salvaguardas»). Línea propuesta (≈ 110 bytes): «Tarjetas del chat: un tamaño y una plantilla de [docs/propuesta-sistema-visual-tarjetas.md](docs/propuesta-sistema-visual-tarjetas.md); sin px sueltos.» Alternativa sin tocar AGENTS.md: contrato `card-sizes` en `docs/map.md`.

**Script de comprobación (solo propuesta):** `scripts/check-card-style.mjs`, en `npm test` junto a los `check-*`: recorre los CSS de tarjetas y falla ante un `px`/`rem` literal, un hexadecimal o un `border-radius` que no sea token, con una lista de excepciones congelada (como `check-sizes`) que **solo puede bajar** (hoy ~170). También podría contar las variantes declaradas y fallar si pasan de dos.

## 7. Plan de migración (pasos pequeños, cada uno con su prueba)

1. **Tokens y plantillas** (`tokens.css`, `chat-cards.css`): añadir los tokens de §3 y las clases `card-s/m/l`, `.card-head/body/options/foot/done`, `.card-check`; sin usarlas. Prueba: `check-sizes`, suite.
2. **Cambio de modelo y seguimiento → `card-s`**: ancho `fit-content` con tope, letra por plantilla (13/12/11), relleno `--card-pad-s`, casilla `.card-check`. Prueba: `switch-model-card-ui.test.ts` afirma `card-s`, píldora y casilla.
3. **Selección verde unificada** (con decisión del usuario): `.q-opt.is-on`, `.cc-ratio.is-on` a `--select-on`. Prueba: jsdom de `chat-cards-c5/c7b` afirman la clase, no el color.
4. **Resuelta común**: `.cc-set-done` pasa a `.card-done` y la usan preguntas y plan. Prueba: tests de tarjetas resueltas.
5. **Preguntas → `card-m`**: cabecera de icono y título, `.cc-chip` en vez de `.q-opt`. Prueba: tests de preguntas + afirmación de tamaño. Mayor riesgo visual.
6. **Ajustes → `card-l`** y **Plan → `card-l` + variante «Decisión»**: sustituir `620px`, `16px 18px`, `.cc-title 16px` por tokens y marcar la variante con una clase `card-v-decision`. Sin cambio visible salvo el énfasis de la variante. Prueba: tests actuales + afirmación de clase.
7. **Generación → variante «Resultado»** (`card-v-result`): tokens en sus anchos y radios, sin tocar su maquetación. Prueba: `chat-cards-c7b` y tests de generación.
8. **Chips, botones, radios**: un `--chip-radius`; `notice-retry` a `Button`; `.set-more`, `.cc-approve` con tokens; eliminar `!important`. Prueba: jsdom de chips y avisos.
9. **Script `check-card-style`** con su baseline congelado. Prueba: el propio script en `npm test`.

Cada paso es un commit con `npm run test:related`; al cerrar, `npm test`. El usuario revisa visualmente los pasos 2, 5 y 6 en el sandbox.

**Tamaño de las tarjetas nuevas:** `card-s` (mínimo). Son confirmaciones de una línea con acciones; conservan la anchura corta pero con la jerarquía de letra, relleno y píldoras del sistema. El seguimiento, por su lista de modelos, puede pasar a `card-m` sin cambiar de lógica.

## Límites

- Es un documento; no cambia código ni estilos.
- Los valores salen de los más usados hoy; el usuario puede ajustarlos antes del paso 1. La decisión del verde (toda la app o solo tarjetas) está pendiente.
- No cubre Home, Designer ni nodos, que seguirán la misma norma de tokens después.

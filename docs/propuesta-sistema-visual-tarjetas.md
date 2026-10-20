# Propuesta: un sistema visual acotado para las tarjetas del chat

Fecha: 2026-10-20. Estado: **propuesta aprobada en lo esencial, sin implementar** (solo documento y maqueta; ningún cambio de código). Alcance: todas las tarjetas del chat y las superficies parecidas; la regla sirve para el resto de la app. Va junto a [la propuesta de temas](propuesta-temas.md) (bases y color de resaltado), también aprobada.

**Aprobado:** plantillas base fijas; tres tamaños; una o dos tarjetas que destacan; «Decisión» sin banda y con la huella antigua; la línea «resuelta»; Atlas como base por defecto; botones y chips en píldora; todo color sale de tokens (selección = resaltado, verde solo para estados).

**Pendiente:** si «Decisión» sigue siendo una variante (o el plan pasa a una `card-l` normal); el tamaño de las tarjetas de cambio de modelo (`card-s`, o `card-m` el seguimiento); el puntero en `AGENTS.md`.

## Por qué (y qué se busca)

Una sola identidad visual con **jerarquía**, no uniformidad aburrida: un estándar fijo para todo y, solo donde aporta, unas pocas variaciones permitidas, con motivo y con tope. Lo que no tiene motivo se migra.

Las tarjetas nuevas (cambio de modelo y seguimiento, `cc-narrow`) desentonan con las habituales, y no hay nada escrito sobre el estilo visual: cada agente trabaja dentro del aspecto general pero inventa su propia maqueta, tamaños y rejilla. Hay tokens (`src/styles/tokens.css`) y una nota de «cohesión» (radios, cinco tamaños de letra, una escala de espacio), pero **las tarjetas casi no los usan**: `chat-cards.css` tiene 174 valores en `px` frente a 98 usos de `var(--…)`, y `chat.css` ya mezcla ambos.

## 1. Inventario (desde el código)

Tokens existentes (`tokens.css:1-60`): letras `--fs-xs 11 / s 12 / m 13 / l 15 / xl 20`; radios `--r-s 6 / --r-m 16 / --r-l 24 / --r-full` (y la familia antigua `--radius-xs 5 … -xl 18`); espacio `--sp-1 4 / 2 8 / 3 12 / 4 16 / 5 24`; verde de estado `--ok`; acento `--accent` (lima `#d8ff3a`). Los neutros y el acento pasan a ser bases y resaltados según [la propuesta de temas](propuesta-temas.md).

Leyenda: **[px]** = valor fijo en vez de token.

| Superficie | Ancho | Relleno / huecos | Radio | Título / cuerpo / meta | Botones | Chips / píldoras | Iconos | Código |
|---|---|---|---|---|---|---|---|---|
| Base común `.gen-card, .plan-card, .q-card` | `max-width:100%` | — | `--r-m` 16 | — | — | — | — | `chat.css:3`, `:169` |
| **Ajustes (confirm_settings)** `q-card set-card cc-card cc-w` | `.cc-w`: `min(620px,100%)` **[px]**, `margin-right:auto` | `16px 18px 12px` **[px]**; cabecera `margin-bottom:14px`; pie `margin-top:14px; padding-top:12px` | `--r-m` | título `600 16px/1.3` **[px]** (`.cc-title`); cuerpo `--fs-m`; meta `.set-total` 11px **[px]** | `Button` primario `sm`/`md` (`.btn` 8px 12px; `.btn-sm` 5px 9px, 12px **[px]**) | `.cc-chip` 8px 12px, radio 10 **[px]**, `--fs-m` | 13-16 | `chat-cards.css:2,6-7,18,41-42,102`; `SettingsCard.tsx:61` |
| Ajustes confirmada `cc-set-done` | `.cc-w` | `11px 14px` **[px]** | `--r-m` | nombre 600; chips `.cc-mini` 12px **[px]** | — | `.cc-mini` 3px 9px, radio 8 **[px]** (propuesta: píldora) | 16 | `chat-cards.css:131-135`; `SettingsCard.tsx:35` |
| **Plan** `plan-card cc-w` | `.cc-w` 620 | igual que ajustes; pasos `padding:12px 0 6px`, hueco 12 **[px]** | `--r-m` | título `600 16px` **[px]**; paso `--fs-m` 600; detalle `--fs-s`; coste `--fs-s` | aprobar `.cc-approve` 10px 16px, radio 12, 700 **[px]** | miniatura de paso 44×44 radio 9 **[px]** | 44 | `chat-cards.css:3-9,43-70,102-111`; `PlanCard.tsx:182` |
| **Preguntas** `q-card` | sin `.cc-w`: ancho del contenedor | `padding:16px` **[px]**; `q-block margin:16px 0` | `--r-m` | `q-question` 550 (hereda 13); intro 12px/1.6 **[px]** | pie a la derecha, hueco 8 | `.q-opt` 7px 10px, **radio 5**, 12px **[px]**; elegida = color de resaltado (hoy lima) | — | `chat.css:3-5`; `QuestionsCard.tsx:67` |
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
| `.cc-mini` (píldora de solo lectura) frente a `.cc-chip` (control que abre algo) | **Conservar con dos papeles** | Mostrar un valor frente a editarlo. Ambos con `--chip-radius` (píldora, 999px, según la propuesta de temas). |
| `.q-opt` radio 5 y `.set-more` radio 5 | **Deriva** | Forma de chip repetida sin papel; migran a `.cc-chip`/`--chip-radius`. |
| Selección: `.q-opt`, `.cc-ratio`, fila elegida de `ModelField` | **Conservar: es el estándar** | Elegir = color de resaltado (`--select-on*`, `--select-line`), igual que la acción primaria; cambia con el resaltado elegido. El verde `--ok` queda solo para estados (hecho, correcto). |
| `notice-retry` como botón aparte | **Deriva** | Debe ser un `Button` `sm`. |
| `.cc-approve` (relleno 10×16, 700) y el coste del plan | **Conservar dentro de la variante «Decisión»** (§4) | Es la acción que gasta dinero: merece énfasis. Su radio pasa a píldora (`--btn-radius`). |
| Generación `is-fit` (ancho = medios), teselas de radio 7, barra de tesela, error 300-480 | **Conservar dentro de la variante «Resultado»** (§4) | El contenido manda: el ancho sigue a la imagen. |
| Popover del modelo (480 px, radio 16, relleno 14) | **Conservar como categoría «superposición»** | No es una tarjeta del hilo; se le dan tokens (`--pop-w`, `--pop-radius`) sin cambiar el aspecto. |
| Burbuja del usuario (radio 12/12/3/12, 85 %) | **Conservar** | Es un mensaje, no una tarjeta. |
| Siete radios, anchos fijos (620/360/480/300/240), `!important` en `.cc-result`, estilos repartidos en `chat.css` y `chat-cards.css` | **Deriva** | Sin papel; pasan a tokens y a un solo archivo de tarjetas. |

## 3. Color, bases y radios

- **Base por defecto: Atlas** (oscura). Las tarjetas funcionan igual en Sistema, Atlas, Grafito, Claro y Original, y con cualquiera de los seis resaltados, porque no fijan ningún color.
- **Color solo desde tokens:** neutros (`--bg`, `--surface*`, `--border*`, `--text*`), acento y selección (`--accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--select-on`, `--select-on-soft`, `--select-line`) y estados (`--danger`, `--warn`, `--ok`, **solo para estado**: error, aviso, hecho). Nada de hexadecimales ni verde para elegir.
- **Selección y primario siguen al resaltado.** Elegido = relleno suave `--select-on-soft`, borde `--select-line` y texto o marca en `--select-on`. La selección no depende solo del color: lleva marca de verificación o línea.
- **Radios:** botones y chips en píldora (`--btn-radius`, `--chip-radius`, 999px; en la base Original valen lo de hoy). La tarjeta conserva `--card-radius` (`--r-m`); la casilla, 4 px; `.cc-mini` también es píldora. Los radios de teselas y popovers siguen siendo sus tokens.
- **Aurora (degradado con grano)** solo en los cuatro sitios que fija [la propuesta de temas](propuesta-temas.md#aurora-degradado-con-grano): botón primario, borde o tinte de lo elegido, casilla activa e indicador de «generando». Ninguna tarjeta lo usa en otro lugar, y el texto nunca va sobre el degradado en bruto.

## 4. La base fija: plantillas de maquetación

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
3. **Opciones** `.card-options`: tres formas, nada más: **casillas** `.card-check` (16×16, gris vacío; encendida = relleno `--select-on` y marca `--accent-ink`), **chips** `.cc-chip` (valor editable, abre un `ChipPop`/`ModelField`) y **píldoras** `.cc-mini` (valor de solo lectura).
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

Tokens nuevos en `tokens.css` (los de color, radio de botón y selección vienen de la propuesta de temas): `--card-w-s: 22rem`, `--card-w-m: 32rem`, `--card-w-l: 38.75rem`, `--card-pad-s: var(--sp-3)`, `--card-pad-m: var(--sp-4)`, `--card-pad-l: var(--sp-4)` (hoy 16×18), `--card-radius: var(--r-m)`, `--fs-title: 16px`, `--pop-w: 30rem`, `--pop-radius: var(--r-m)`.

## 5. Variaciones permitidas (máximo dos)

Una tarjeta destaca cuando es un **momento clave** del flujo. Se proponen dos, y ninguna más sin pasar por la regla de §6.

### Variante «Decisión»: la tarjeta del plan (aprobar y gastar)
Por qué: es el punto donde el usuario autoriza coste; el énfasis va en la acción, no en la cabecera. Sin banda de cabecera tintada, con la huella de hoy (mismo relleno exterior, sin sangría extra en la lista de pasos) y los títulos de paso con su peso y tamaño actuales.
- **Puede variar (solo esto):** un borde sutil `--accent-line`; el botón de aprobar con el coste, ya existente (`.cc-approve`, 700, en píldora); un aire algo mayor entre filas de pasos (`padding-top` de 12 a `--sp-4`).
- **Debe seguir fijo:** cabecera sobre la superficie plana (título y subtítulo como hoy), escala tipográfica (título de paso 13/600, coste a la derecha como hoy), relleno de la tarjeta, plantillas, un solo primario a la derecha, `card-l` de ancho.
- **Pendiente:** lo que queda es poco, un borde y el botón de aprobar con coste. Si el usuario lo prefiere, la variante se retira y el plan es una `card-l` normal con ese botón (queda entonces un hueco de variante libre).
- Aplica a: `PlanCard` (y, si el usuario quiere, la aprobación de coste de un paso).

### Variante «Resultado»: la tarjeta de generación
Por qué: el contenido es lo que el usuario vino a ver; los medios mandan, la tarjeta se retira.
- **Puede variar:** el ancho (`fit-content` según el medio, mínimo 240 px, `--card-w-l` de tope); medios grandes con teselas de radio propio y barra de acciones superpuesta (`tile-bar`); cabecera mínima (prompt de dos líneas) y meta bajo el medio.
- **Debe seguir fijo:** tipografía y espaciado, `--card-radius` del contenedor, acciones con `Button`/iconos del sistema, un solo primario cuando lo hay (p. ej. «Run»), estados (error, cancelada) solo cambian color de borde e icono.
- Aplica a: `GenerationCard` y `StudioGeneration`.

**Estados no son variantes:** error (`--danger`), cancelada, resuelta y en curso cambian color de borde, icono o la plantilla «resuelta»; no maquetación.

## 6. Regla para añadir una variación

Una variante nueva solo entra si cumple las tres:
1. **Un papel en la jerarquía** escrito en la tabla de §5 («momento clave de…»). «Se veía mejor» no es un papel.
2. **Una entrada en este documento** con qué varía y qué sigue fijo, aprobada por el usuario antes de escribir CSS.
3. **Tope: dos variantes** a la vez. Una tercera exige retirar o fusionar una existente.

Las cosas pequeñas (un icono, un color de estado) no son variantes: usan tokens de estado.

## 7. Reglas vinculantes para los agentes

1. **Elige un tamaño** (`card-s`, `card-m`, `card-l`) y las plantillas de §4 (cabecera, cuerpo, opciones, pie, resuelta). Sin anchos, rellenos ni radios nuevos.
2. **Reutiliza** `ModelField`, `ChipPop`, `Button`, `.cc-mini`, `.cc-chip`, `.card-check` y `AspectPicker`. Un selector de modelo es `ModelField` y nada más.
3. **Solo tokens**: ni `px`, ni `rem` sueltos, ni colores fijos en CSS de tarjetas; el color sale de los tokens de §3 y funciona en cualquier base y resaltado.
4. **Un solo primario por tarjeta**, a la derecha; selección con `--select-*`; el verde `--ok` y los demás estados solo para estado.
5. **Ninguna tarjeta nueva ni cambio de aspecto sin actualizar este documento.** Una variación nueva sigue §6 (papel, entrada, tope de dos).
6. **Los tests jsdom** afirman el tamaño (`card-s|m|l`), la variante si la hay, y los componentes reutilizados.

**Dónde viven:** este documento (enlazado desde `docs/README.md`) y **una línea en AGENTS.md** (pendiente). AGENTS.md pesa 3 064 bytes y el tope es 3 KB (3 072): hay que recortar otra línea antes (p. ej. abreviar «Salvaguardas»). Línea propuesta (≈ 110 bytes): «Tarjetas del chat: un tamaño y una plantilla de [docs/propuesta-sistema-visual-tarjetas.md](docs/propuesta-sistema-visual-tarjetas.md); sin px sueltos.» Alternativa sin tocar AGENTS.md: contrato `card-sizes` en `docs/map.md`.

## 8. Plan de migración único (tarjetas y temas)

Una sola secuencia; cada paso es un commit con `npm run test:related`, y al cerrar `npm test`. [La propuesta de temas](propuesta-temas.md) solo define los valores; el orden está aquí. El usuario revisa visualmente los pasos 1, 2, 4b y 4d en el sandbox.

**1. Tokens y bases** (`tokens.css`, un archivo de acentos)
- Neutros de Atlas como valores por defecto; bloque `[data-base="original"]` con los de hoy; bloques de Grafito y Claro; `--btn-radius` y `--chip-radius`; los seis `[data-accent]` con juego oscuro y claro y `--select-*`; `--accent-grad` y el grano solo en Aurora; tokens `--card-*`, `--fs-title`, `--pop-*`.
- Pruebas: `check-sizes`, `check-docs`; un test nuevo que calcula los contrastes de cada base y resaltado (tinta/relleno, acento/tarjeta, texto elegido/relleno ≥ 4,5; meta ≥ 4,5) leyendo los CSS; suite entera (nada debe cambiar en pantalla salvo el aspecto de la base).

**2. Selector de base y de resaltado**
- Apariencia en Ajustes (cinco bases, seis muestras con `aria-pressed`), claves `ogs-base` y `ogs-accent` en `localStorage`, `data-base` y `data-accent` en `<html>`, lectura de una línea antes del primer pintado; `Sistema` resuelto con `matchMedia`.
- Pruebas: jsdom del selector y de las muestras; claves y atributos escritos y leídos; `Sistema` con `matchMedia` simulado a claro y a oscuro; valor por defecto `atlas` + `lima`. No toca los ajustes persistidos.

**3. Plantillas de tarjeta** (`chat-cards.css`)
- Clases `card-s/m/l`, `.card-head/body/options/foot/done`, `.card-check`; sin usarlas aún.
- Pruebas: `check-sizes`, suite.

**4. Migración tarjeta a tarjeta**
- 4a. Cambio de modelo y seguimiento a `card-s` (ancho `fit-content` con tope, letra 13/12/11, casilla de plantilla). Prueba: `switch-model-card-ui.test.ts` afirma `card-s`, píldora y casilla.
- 4b. Resuelta común (`.cc-set-done` a `.card-done`) y Preguntas a `card-m` (`.cc-chip` en vez de `.q-opt`): el mayor riesgo visual. Pruebas: tarjetas resueltas y preguntas, con afirmación de tamaño.
- 4c. Ajustes y Plan a `card-l`; el plan con `card-v-decision` (si sigue siendo variante). Pruebas: las actuales más la afirmación de clase.
- 4d. Generación a `card-v-result`, con su indicador de «generando» (esfera con grano en Aurora). Pruebas: `chat-cards-c7b` y las de generación.
- 4e. Chips, botones y radios: `notice-retry` a `Button`; `.set-more` y `.cc-approve` con tokens; fuera `!important`. Prueba: jsdom de chips y avisos.

**5. Script `check-card-style`** (`scripts/check-card-style.mjs`, en `npm test` junto a los `check-*`)
- Falla ante un `px`/`rem` literal, un hexadecimal o un `border-radius` que no sea token en los CSS de tarjetas, con una lista de excepciones congelada que **solo puede bajar** (hoy ~170); puede contar las variantes y fallar si pasan de dos, y comprobar que el degradado solo aparece en los cuatro sitios permitidos.
- Prueba: el propio script en `npm test`.

**Después:** retirar la base Original cuando el usuario lo decida.

## Maqueta

Una maqueta estática con las hojas reales de la app y los tokens propuestos, antes y después, de cada caso: [mockups/tarjetas.html](mockups/tarjetas.html) (CSS propuesto en [mockups/propuesta.css](mockups/propuesta.css); «Después» sobre [base-atlas.css](mockups/base-atlas.css) y [acentos.css](mockups/acentos.css)). Se abre directamente en el navegador; las fuentes salen de `node_modules`. Si el visor bloquea las hojas locales enlazadas, la página sale sin estilo: ábrela desde un navegador con acceso a archivos.

## Límites

- Es un documento; no cambia código ni estilos.
- Los valores salen de los más usados hoy; el usuario puede ajustarlos antes del paso 1.
- No cubre Home, Designer ni nodos, que seguirán la misma norma de tokens después.

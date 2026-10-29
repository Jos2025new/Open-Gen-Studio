---
type: rastreo
title: Rastreo de Studio (1/2): pendientes y decisiones revertidas
description: Qué quedó escrito como frágil, pendiente o bajo revisión en el área Studio, su estado hoy contrastado con el código, y las decisiones que se tomaron y luego se revirtieron.
tags: [studio, rastreo, pendientes, reversiones]
updated: 2026-10-28
---
# Rastreo de Studio (1/2)

Solo lectura de código, documentos y `git log` en la rama `task/designer-measure` (HEAD `1f0a2b0`). No se ejecutó la app ni el sandbox. Los documentos y mensajes de commit son pistas; el estado de hoy sale del código. «Sin verificar» marca lo que la lectura no confirma.

Archivos del rastreo:

- `studio.md` (este): secciones 1 y 2.
- [studio-2.md](studio-2.md): secciones 3, 4 y 5, y los diez puntos de mayor impacto.

Leyenda de estado: **cerrado** (con commit o código), **abierto** (con evidencia de código), **no verificable** (necesita proveedor, sandbox o medición).

## 1. Pendientes, frágiles y bajo revisión: estado hoy

### 1.1 Agente (A) y proveedores (B) de `pendientes-agente.md`

Fuente de las filas: [pendientes-agente.md](../pendientes-agente.md) (A1 a A28, B1 a B13) e índice [pendientes.md](../pendientes.md).

| ID | Dónde se escribió | Qué decía | Estado hoy | Evidencia |
| --- | --- | --- | --- | --- |
| A1 | pendientes-agente.md (A1), 2026-10-22 | `confirm_settings` repetida pone otra tarjeta | **Cerrado por sustitución.** Auto ya no pone tarjeta de ajustes; `confirmRepeat.ts` no existe | `e5b2c17` (2026-10-23) lo añadió; `8fc96c0` (2026-10-24) lo retiró; `ls src/engine/agent/confirmRepeat.ts` no existe. El índice [pendientes.md](../pendientes.md) sigue diciendo «hecho en código, falta probar con LLM real» (ver 5.4) |
| A2 | A2, 2026-10-21 | Etiqueta de proveedor falsa tras pasar de Atlas a NanoGPT | **Abierto** | `credit.ts:158-160` (`switchTo`) solo parchea `modelRef` y `modelName`; `Generation.provider` se fija al crear (`jobs.ts:108`) y no se actualiza |
| A3 | A3, 2026-10-21 | Keep/Change no nombra los dos proveedores | **No verificable en el caso del informe.** El código nombra el proveedor solo si `changeOf(...) === 'provider'` | `SettingsCard.tsx:282-285` («is also on»); pruebas `tests/switch-model-card-ui.test.ts`, `tests/ask-change-accepted.test.ts`. Si el cambio se clasifica como `model`, la tarjeta dice «Found model» sin proveedor |
| A4 | A4, 2026-10-21 | Repetir la prueba visual de ADR 0025 | **No verificable** (prueba visual) | Sin informe posterior en `docs/` |
| A5 | A5, 2026-10-21 | DeepSeek repite un plan sin `prompt`; la app debe cortar | **Abierto** | Sin lógica de plan repetido en `llmTurn.ts`, `turnStop.ts` ni `stopNotice.ts` (búsqueda de «twice/repeated/same plan» sin resultados). `8ebc736` quitó un rechazo evitable, otra causa de «plan no válido», no esta |
| A6 | A6, 2026-10-21 | Tomas en imagen saltadas antes del vídeo | **No verificable** (comportamiento del LLM) | Nota de 049 «primero ver por qué, no tocar nada» |
| A7 | A7, 2026-10-21 | «1 problem to fix» tras Continue | **No verificable.** Una causa posible se corrigió el 2026-10-27 | `8ebc736`: el esquema rechazaba planes sin `user_requested` |
| A8 | A8, 2026-10-21 | Tarjeta extra al nombrar un modelo, sin decidir | **Abierto, sin decisión registrada** | La tarjeta «Keep/Change» sigue (`switchModel.ts`, `llmTurn.ts:280`) |
| A9 | A9, 2026-10-21 | Probar vídeo con 3 referencias (Wan 3.0) | **No verificable** (gasto de proveedor) | `c034614`, `tests/nanogpt-body-budget.test.ts` |
| A10 | A10, 2026-10-21 | Sin comprobar: tope 1,5× con unidades distintas, etc. | **Parcialmente respondido: hay un hueco.** Con unidades distintas `ratio` queda `undefined` y la opción se ofrece sin tope ni marca «pricier» | `credit.ts:124-128` |
| A11 | A11, 2026-10-21 | Contexto del agente de 37 000 a 50 000 tokens | **No verificable por lectura** | Pide medir |
| A12 | A12, 2026-10-19 y 047 | Paso 6 sin ejecutar; `userPicked` de `plan.ts` usa el historial | **Parcial.** La ruta `userPicked` ya no está en `plan.ts`; un comentario de revisión sigue sin sumarse al borrador (sin verificar) | `grep userPicked src/engine/plan.ts` sin resultados; `95f81d8` (2026-10-25) suma las respuestas a un plan o tarjeta a la petición |
| A13 | A13, 2026-10-20 | Notas de operaciones en inglés; falso positivo de continuidad | **Sin verificar** | Se mantiene como lista de ADR 0024 |
| A14 | A14, 2026-10-16 | Cola de agentes «cuando X termine, haz Y» | **Abierto: no hay código** | Solo `queue` en `store.ts:560` (`queueMicrotask`), sin cola de agentes |
| A15 | A15, 2026-10-15 | `triggers.ts` amplios; tarjeta de ajustes en vivo; guías sin verificar | **Sin verificar** | Ver [038](../history/038-2026-10-W42.md) |
| A16–A23 | pendientes-agente.md | Métricas, casos reales de `remove_bg`/`grid_split`, cápsulas de respuesta | **No verificable** | Dependen de proveedor o de decisión del usuario |
| A24–A28 | pendientes-agente.md | Cerrados 2026-10-23 y 2026-10-27 | **Cerrados**, con las salvedades de 1.3 | `a6f1ea8`, `67757c1`, `b43fb48`, `bf64252` |
| B1 | B1, 2026-10-16 | Posible cobro de $0,068 por una generación interrumpida | **No verificable** (panel del proveedor) | Ver respuesta a G1 en 4.1 |
| B2 | B2, 2026-10-21 | Arreglos del relay sin llevar a la app real | **Abierto fuera del repo** | En esta rama `mediaHosts.ts` ya trae el host R2 de NanoGPT (`MEDIA_EXACT`) |
| B3 | B3, 2026-10-08 | El presupuesto no es un máximo | **Abierto** | Decidido 2026-10-29: el límite avisa, no bloquea. Precio desconocido con límite activo pide confirmar («Continue once» / «Don’t ask again») y, si el coste real lo pasa, un aviso único con «Review limit» / «Ignore» |
| B4 | B4, 2026-10-21 | El gasto bajó de $15,46 a $15,45 sin generar | **Sin verificar** | Sin hipótesis en el código leído |
| B5 | B5, 2026-10-18 | 3D (Tripo) «Failed to fetch»; host de 3D fuera de `MEDIA_HOSTS` | **Abierto** | `mediaHosts.ts:7-8`: ningún host de 3D |
| B8 | B8, 2026-10-08 | Modelos `-spicy` excluidos de forma provisional | **Abierto, provisional** | `modelIndex.ts:81-86` |
| B10–B12 | pendientes-agente.md | Cerrados 2026-10-23 | **Cerrados** | `43203ea`, `6ff43fe`, `a047c82` |
| B13 | B13, 2026-10-26 | Reglas de entradas por proveedor por verificar | **No verificable** | Falta en el índice (5.4) |

### 1.2 Lo marcado «frágil» o «abierto» en el historial y las fichas

| Origen | Qué decía | Estado hoy | Evidencia |
| --- | --- | --- | --- |
| [053](../history/053-2026-10-W43.md) línea 1 y [studio.md:3](../features/studio.md), [agente-auto-tarjeta.md:3](../features/agente-auto-tarjeta.md) | «ABIERTO, FRÁGIL / bajo prueba, frágil» (2026-10-24) | **Sigue abierto**: ningún documento posterior lo cierra; 054 lo sigue citando como pendiente de prueba del usuario | 054, «Pendiente: prueba del usuario en el sandbox de todo lo anterior» |
| 053, Frágil 1 | `fitsChosen` compara por subcadena | **Mitigado**: ahora usa `partNamed` (ref exacto, luego misma línea y proveedor) | `settingsParts.ts:111-118` |
| 053, Frágil 2 | `providerFit` solo protege el proveedor de la petición actual | **Abierto**: `ensureSchema` sin tiempo máximo; solo vídeo e imagen | `providerFit.ts:43` (`providersIn(request)`), `:44` y `:49` |
| 053, Frágil 3 | `stopNotice` clasifica por expresiones regulares; `durationOwed` depende del texto del último mensaje | **Abierto** | `stopNotice.ts` (cuatro coincidencias), `modelLimits.ts:95`, `llmTurn.ts:294` |
| 053, Frágil 4 a 14 (menos 10) | Calidad pedida, tope de 4000, velocidad sin medir, tarjetas de Nodes desde Studio, decisión de imagen de inicio, resumen con duración vieja, freno de storyboard, referencias NanoGPT por texto del catálogo, texto Auto de `draftGate`, selector por `variantKey` | **No verificable por lectura** (comportamiento o medición) | 053, sección «Frágil, sin resolver» |
| 053, Pendiente | Restos de la auditoría de rechazos (A2, B1, C3, C4, C5, F1, `ThreadPeek`), sin tocar | **Sin verificar** | No hay commit posterior con esos IDs |
| [video-quality.md:7](../video-quality.md) | «Mecanismo de estilo (2026-10-24). REVISAR DESPUÉS»; cuatro puntos abiertos sin prueba con el generador | **Abierto** | `continuity.ts:103` `applyPlanStyle`; los puntos son mediciones |
| [agente.md:17](../features/agente.md) | «Freno del storyboard (frágil)»: depende de que el agente marque `storyboard` | **Abierto** | 053, Frágil 11 |
| [agente-auto-tarjeta.md:46](../features/agente-auto-tarjeta.md) | Pendiente: la duración cubra las marcas de tiempo del storyboard; el aspecto de la fuente gane al confirmado | **Sin verificar** | Sin commit posterior |
| [047](../history/047-2026-10-W43.md), [agente.md:52](../features/agente.md) | `userPicked` de `plan.ts` aún lee el historial | **Obsoleto por movimiento de código** (ver A12) | |
| [048](../history/048-2026-10-W43.md) | Marco tranquilo: «si no gusta, se revierte su commit»; pasos 3 a 5 de tarjetas; «Look» en inglés | **Abierto**, a la espera de la revisión del usuario | [pendientes-sistema.md](../pendientes-sistema.md) G5 a G7 |
| [plan-proveedores-2026-10-25.md:3](../plan-proveedores-2026-10-25.md), [proveedores-ejecucion-2026-10-25.md:7](../proveedores-ejecucion-2026-10-25.md) | F0 a F5 implementadas, «pendiente de prueba del usuario en el sandbox» (R5) y de proveedor (R6); F1 «frágil: data URL real», F3 «frágil: prueba pagada de Mini» | **Abierto** | 053 líneas 109 a 125 |
| ADR 0005, 0006, 0008, 0009 (y 0015) | Estado «Propuesto», implementados | **Abierto** (formalidad) | [pendientes-sistema.md](../pendientes-sistema.md) G1; `docs/decisions/0009-disparo-forzado.md` «Estado: Propuesto» |
| [054](../history/054-2026-10-W44.md), A26 | Divisor del tablero «sin verificar con un puntero real ni en Nodes o Designer» | **No verificable** | `67757c1`, `tests/studio-divider-drag.test.ts` |

### 1.3 Salvedades a los ítems «cerrados» (A24 a A28)

| ID | Cierre declarado | Salvedad |
| --- | --- | --- |
| A25 | 054: interruptor «Ajustar prompt» espera durante la reescritura | El coste de la reescritura sigue sin mostrarse antes (H6 de [hallazgos](../studio-controles/hallazgos.md)); `planSettings.ts:188` lo suma como `agent` |
| A26 | 054: divisor sin solape | Sin verificación con puntero real (texto de 054) |
| A28 | 054: lo escrito en la tarjeta de ajustes llega marcado como respuesta | `conversation.ts:57-58`: la tarjeta pasa a `skipped` al escribir; sin confirmación (H11 sigue válido) |

## 2. Decisiones tomadas y luego revertidas o sustituidas

| N.º | Decisión original | Reversión | Huellas hoy |
| --- | --- | --- | --- |
| D1 | Suelo determinista que devuelve el plan, y `tool_choice` al proveedor, para forzar la ruta de una operación (`bc8c505`, `187ca48`, `ae4c86d`; 2026-10-07/08) | Retirados; solo queda la «señal» al agente (ADR 0009, «Dos versiones intermedias se retiraron»; `631f5e9` 2026-10-08) | ADR 0009 «Alternativas». Sin rastro en código |
| D2 | Umbral de reutilización de ajustes de 0,50 USD: en Auto vuelve la tarjeta si el coste es desconocido o mayor (ADR 0006/0009; restaurado en `df2dff5`, 2026-10-08, y aprobado en 019 punto 39) | `2120c71` (2026-10-15): «Auto: a confirmed kind never re-asks the settings card for cost; the plan card still approves spending». En Auto se muestra el plan con el precio en vez de preguntar | `procedure.ts:68-70` (`costly` → `expose` en Auto), `procedure.ts:93`. Siguen diciendo lo contrario: [agente.md:21](../features/agente.md), ADR 0009 (4, Auto), ADR 0004/0006 (sin verificar el texto exacto de 0006) |
| D3 | ADR 0009 (5): una operación con modelo de imagen exige la tarjeta de imagen una vez por sesión en Auto | `cd15ef0` (2026-10-24): «Auto confirma los ajustes sin tarjeta» | ADR 0009 sin enmienda posterior a ADR 0025 D; `procedure.ts:93` |
| D4 | «Silencioso» → tarjeta: `82147f5` conservaba el modelo confirmado en silencio ante un modelo nombrado | Sustituido por `2eef21d` (2026-10-19): rechazo del plan y tarjeta Keep/Change | [047](../history/047-2026-10-W43.md) |
| D5 | Pregunta de seguimiento tras un cambio de modelo (`1795568`, 2026-10-19; `82ac194`, `49819ce`) | `cd15ef0` (2026-10-24): «The Auto follow-up question after a switch is removed» | Código sin alcanzar: `SettingsCard.tsx:60,295` `FollowUpCard`; `llmTurn.ts:280` pasa `follow=undefined`; `plan.ts:562` `followUpProblem`; `types.ts:911` `switchedTo` (H14) |
| D6 | A1 (2026-10-23): la app responde sola una `confirm_settings` repetida (`e5b2c17`, `42c31fc`) | Retirada en `8fc96c0` (2026-10-24), «drop the repeated-confirmation shortcut (confirmRepeat)» | Menciones en `agente-auto-tarjeta.md`, `pendientes-agente.md` y 050/051 |
| D7 | Tarjeta de ajustes separada y propia del plan en Auto | `cd15ef0`, `a34ba6a`: la tarjeta del plan lleva modelo, valores y Borrador/Alta calidad | Código de tarjeta de ajustes sigue para Guided |
| D8 | `210cb6b` (2026-10-27): `user_requested` obligatorio, con `superRefine` que rechaza el plan | `8ebc736` (mismo día): la app lo infiere (`userChoice.ts`); `4fbf59f`: coincidencia por tokens. Motivo: el sandbox del 14:08 perdió un plan de 6 pasos | `tools.ts:379,403` `optional()`. Persisten `tools.ts:169` (`required: ['kind','user_requested']` del esquema JSON del LLM) y `tools.ts:260` («Required with model») |
| D9 | `210cb6b` también hacía que cambiar el Composer a la variante de los adjuntos contara como elección de sesión | `515dceb` (2026-10-27): `pickComposerModel(mode, want, false)` | `Composer.tsx:374`. `catalog.ts:235` sigue marcando `userPicked[kind]=true` (H2) |
| D10 | `1f063e3` (2026-10-27): «Ajustar prompt» y la elección de modelo desactivados durante la reescritura | `a6f1ea8` (mismo día): el modelo elegido se aplica igualmente (gana la reescritura más nueva); solo el interruptor espera | `planSettings.ts` (`runs`); 054 A25 |
| D11 | `143fef4` (F-01, 2026-10-21): la tarjeta ordinaria conserva el modelo confirmado | `e5c7d53` (2026-10-21): excepción si el usuario eligió el modelo en el Composer (`composerChosen`); la primera versión deshacía su propia elección | ADR 0025 G; `llmTurn.ts:281` |
| D12 | Aviso «The agent replied without a plan» con botón «Propose the plan» y lista de verbos | Retirado en `fa8480e` (2026-10-26) | [agente-auto-tarjeta.md](../features/agente-auto-tarjeta.md) «Sin adivinar palabras» |
| D13 | Reglas del agente y descripciones de herramientas recortadas para caber en la base de tamaño | Restauradas en `9b93c37` (2026-10-20) | 048 «Revisión del trabajo anterior»; `tests/agent-rules-kept.test.ts` |
| D14 | `rewritePrompts` reescribía a ciegas al cambiar el usuario la duración (`cd15ef0`) | `943f4e7` (2026-10-24): recibe los valores de la tarjeta, interruptor «Ajustar prompt» (`agent.enhance`) | 053 punto 8 |
| D15 | Líneas «Keep» (sujetos y estilo) visibles en la tarjeta del plan | `7e9accb`, `da49864` (2026-10-25): sin líneas Keep en ningún modo; van al registro | [tarjeta-plan.md](../studio-controles/tarjeta-plan.md), G3 de [huecos](../studio-controles/huecos.md) |
| D16 | Tiles «Large/Small» en el tablero de Studio | Deslizador «Tile size» (054, 2026-10-27, petición del usuario) | [studio.md:16](../features/studio.md) aún dice «Large/Small funciona también en Studio» (H18) |
| D17 | Maqueta `referencias-arroba.html` como requisito de F5.2 | Retirada por el usuario ([plan-proveedores](../plan-proveedores-2026-10-25.md) F5.2) | Maqueta como propuesta histórica |
| D18 | Modelos y rama `task/provider-nanogpt` (`7ea4630`, `4943a41`, `26ca1b4`, `70cd33d`) | No fusionada: provider-plan los rehízo (`506db1c`, `e0848f8`, `87e59c8`) | Etiquetas `archive/*` (054) |
| D19 | `referenceAudios` de NanoGPT | Retirado como no documentado: `1781841` (2026-10-25) | [plan-proveedores](../plan-proveedores-2026-10-25.md) F2.4 |
| D20 | Tamaño del plan: «Alta calidad» cambiaba la resolución más baja por la más alta | `8772f19` (2026-10-26) | Ver 3.2 |

Reglas de modelo en Memoria del proyecto: la regla «ops heredan el modelo de origen» quedó sustituida por ADR 0009 (ops de imagen confirman su modelo) y esa, a su vez, desplazada en Auto por `cd15ef0` (D3). La regla de capas del modelo (Composer = defecto global; sesión = última elección explícita; comparaciones no cambian nada) vive desde `210cb6b`/`515dceb` y su contrapunto automático es `betterProvider` (ver 3.1).

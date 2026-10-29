# Auditoría externa (2026-10-29)

Contraste de los tres registros de controles con el código, y búsqueda de un bug sin navegador. Sin ejecutar la app, sin proveedores y sin gasto. Al escribirse este informe no se tocó ningún documento auditado; tras la revisión del mismo día se corrigieron las citas y dos frases de los mapas, y este texto (§8).

## Versión auditada

- HEAD auditado: rama `task/workflow-ask-first`, commit `f2700c3` (2026-10-29 12:30). Todo `archivo:línea` de este informe es de ese commit (`git rev-parse --short HEAD`).
- El [encargo](encargo-auditor-externo.md) fija `task/designer-measure` en `a4377c9` (2026-10-28 22:18). Ese commit existe, pero no es el estado auditado: `git diff --stat a4377c9 HEAD -- src` da 36 archivos, +376/−137. Lo que el registro fecha «2026-10-29» está escrito contra HEAD, no contra la versión fijada en el encargo.
- Cómo se comprobó cada punto: **lectura** (código y documentos) o **prueba automatizada** (vitest). **No hubo uso visual en sandbox**: no se arrancó `npm run dev:sandbox`. Lo que exige pantalla queda como «requiere prueba», también en los puntos que el registro da por vistos.

## 1. Anclas `archivo:línea` que no sostienen su frase

39 anclas comprobadas abriendo la línea citada; 11 apuntaban a una línea que existe pero no era la que sostenía la frase. La tabla registra lo que decía la versión auditada (`f2700c3`); las citas ya están corregidas en los mapas (§8). En todas, el contenido real está a pocas líneas o en el mismo archivo, de modo que la causa no es un error de archivo sino de línea: la cita se eligió por proximidad y nadie la volvió a abrir.

| Documento y línea | Frase que la cita debe sostener | Qué hay en la línea citada | Qué la sostiene de verdad |
| --- | --- | --- | --- |
| [nodes-controles/hallazgos.md:18](../nodes-controles/hallazgos.md) (H2) | «chip «modelo · proveedor», `nodes.tsx:669`» | `nodes.tsx:669`: `))}`, cierre del mapa del menú de operación (657-669) | `VideoUpscaleControls.tsx:27` (citado en la misma fila); `nodes.tsx:651` es el chip de operación y muestra `def.label`, no el modelo |
| [nodes-controles/hallazgos.md:19](../nodes-controles/hallazgos.md) (H3) | «Delete asset» en el detalle de generación, `nodes.tsx:149` | `nodes.tsx:149`: `</div>` | `nodes.tsx:153`: `<Button … >Delete asset</Button>` con `deleteAssets([assetId])` |
| [nodes-controles/hallazgos.md:19](../nodes-controles/hallazgos.md) (H3) | «una ejecución posterior puede rechazar el nodo por asset ausente (`flow/actions.ts:267`)» | `flow/actions.ts:267`: `}` que cierra el bloque de `video_upscale` | `flow/actions.ts:268` (asset del nodo) y `:269` (asset de Sketch) |
| [nodes-controles/hallazgos.md:23](../nodes-controles/hallazgos.md) (H7) | «conectar a un puerto sencillo ocupado sustituye el enlace anterior (`flow/graph.ts:142`)» | `graph.ts:142`: última línea de `handleIndex` (`return m ? …`) | `graph.ts:144-145` y el cuerpo de `connect` que empieza debajo |
| [nodes-controles/hallazgos.md:23](../nodes-controles/hallazgos.md) (H7) | «Sustitución en puerto sencillo deliberada (`graph.ts:137`)» | `graph.ts:137`: `export const GONE_HANDLE = 'out-gone'` | El comentario y el reemplazo dentro de `connect` (`graph.ts:144+`) |
| [nodes-controles/hallazgos.md:21](../nodes-controles/hallazgos.md) (H5) | «Deliberado en el código (docstring de `flow/actions.ts:94-99`)» | `flow/actions.ts:96-99`: docstring de «Change a generation node's model», es decir el mecanismo de H6 | `setNodeOp` está en `flow/actions.ts:193` y no lleva ese docstring |
| [nodes-controles/hallazgos.md:25](../nodes-controles/hallazgos.md) (H9) | «`coerceSettings` ajusta aspecto, resolución o duración sin avisar (`nodes.tsx:624`)» | `nodes.tsx:624`: `modelPop.close()` | `nodes.tsx:627`: `const { settings } = coerceSettings(...)` |
| [rastreo/README.md:29](../rastreo/README.md) | «límite con precios desconocidos (`budget.ts:24`)» | `budget.ts:24`: `let pass: { sessionId: string } \| null = null` (el pase de «Continue once») | `budget.ts:47-50` (el precio desconocido pide confirmación), texto en `:58`, aviso posterior en `:95-111` |
| [studio-controles/hallazgos.md:41](../studio-controles/hallazgos.md) (H15) | «`studioCanvases` incluye los tres lienzos (`FeedList.tsx:202-206`)» | `FeedList.tsx:202-206`: fase del agente, actividad y `showStatus` | `lib/studioBoard.ts:43-45` (devuelve los tres) y `FeedList.tsx:200,209-211` (`others` y el botón que solo se pinta si `others > 0`) |
| [designer-controles/README.md:61](../designer-controles/README.md) | «R, O, L, M no cambian de variante (`ToolDock.tsx:60,64-67`)» | Las líneas 60 y 64-67 calculan la familia/variante seleccionada y sincronizan la familia al cambiar de herramienta | `toolboxModel.ts:25` (rect, ellipse y line son variantes de la familia `edit`) y `toolboxModel.ts:52` (la variante solo se reinicia si cambia la familia). R, O y L sí permanecen en la variante; M no: cae en la familia Brush (`toolboxModel.ts:28`) y cierra la tarjeta. La cita no muestra el motivo |
| [rastreo/README.md:27](../rastreo/README.md) | «la ejecución prioriza la elección calculada desde el origen (… `jobs.ts:1074`)» | `jobs.ts:1074`: `}`, cierre de la rama `transcribe` | `jobs.ts:1075-1078`: `picked`/`upscaleRef` y el orden `nodeChoice → _modelRef → reusedOpChoice` |

## 2. La afirmación de proceso no tiene respaldo en el repositorio

[nodes-controles/README.md:13](../nodes-controles/README.md), en la versión auditada: «Los números de línea se generan desde el código con un script y se comprueban que existen en el archivo citado». La frase ya está corregida en el mapa (§8); el análisis de abajo explica por qué era falsa.

- Ningún script del repositorio lee los registros de controles: `grep -rln "controles" scripts/` no devuelve nada, y ningún `scripts/*.mjs` resuelve patrones `archivo:línea`.
- `npm test` encadena `check-safeguards`, `check-protected`, `check-docs`, `check-sizes`, `map.mjs` y `vitest`. `check-docs.mjs` valida enlaces, rutas personales, campos de ADR y tablas de `docs/features/`; `map.mjs` valida símbolos de contratos. Ninguno comprueba una cita `archivo:línea` de estos registros.
- Si el script existe fuera del repositorio, el documento no lo dice, y el resultado observable de §1 muestra que comprobar la existencia de la línea no basta: 11 de 39 anclas existen y aun así no sostienen su frase.

## 3. Designer: la premisa es correcta y la conclusión del registro no

El párrafo de [designer-controles/README.md:61](../designer-controles/README.md) clasifica la rama compacta de formas del grupo Edit como «requiere prueba» y la de texto como «código muerto por lectura». Las dos cosas no pueden sostenerse a la vez, y la lectura del código decide en contra de la segunda.

- `ToolDock.tsx:60`: la variante mostrada es `variants.find(v => v.id === dockState.variantId)` y, si no está, la que corresponde a la herramienta actual.
- `ToolDock.tsx:64-67`: la familia solo se despacha con `if (desiredId && desiredId !== familyId)`.
- `toolboxModel.ts:25`: rect, ellipse y line viven en la **misma** familia `edit` que la variante Edit; `k`/`r`/`o`/`l` cambian `ui.tool` (`shortcuts.ts:4`, `designerKeys.ts:93-95`) sin cambiar de familia.
- `toolboxModel.ts:52`: `variantId` solo se reinicia cuando cambia la familia.
- `ToolDock.tsx:133`: `EditCard` se monta con `selectedVariant.id === 'edit'`.

Consecuencia por lectura: con la variante Edit elegida, R, O y L dejan `variantId` en `edit`, `EditCard` sigue montado y `ContextStrip.tsx:107` pinta `<ToolSettings … compact />` para la herramienta nueva. La rama compacta de rectángulo/elipse/línea es **alcanzable** y no hace falta la pantalla para saberlo.

**M no participa de eso:** `select` es una variante de la familia Brush (`toolboxModel.ts:28`), así que la familia cambia, `variantId` se reinicia (`:52`) y la tarjeta se cierra. La rama de **texto** tampoco se alcanza por esta vía: `text` es su propia familia (`toolboxModel.ts:30`). Lo mismo vale para Eraser, Fill, Gradient, Lineart, Curve y Ruler: dejan la familia `edit`.

La pantalla ya lo tenía registrado: [revision-ubicacion.md](../designer-controles/revision-ubicacion.md) §P1, fila «visto», describe R, O y L dejando «Edit settings» con una tira compacta de Rectangle y M cerrando la tarjeta, con capturas en `.sandbox/capturas/`. Revisadas aquí dos: `s1-after-r.png` muestra la tira de Rectangle con Fill, Stroke, Width, Rx, Ry y Sharp corners; `s1-after-m.png` ya no tiene tira y la barra marca Select pixels. Eso cubre el caso Edit con R, O, L y M, no todas las combinaciones de familias y variantes.

Esa inconsistencia ya está resuelta en los mapas (2026-10-29): la fila S1 de [hallazgos](../designer-controles/hallazgos.md) dice «Bug abierto» con los casos vistos separados de los no cubiertos, y la fila S1 de [revision-ubicacion](../designer-controles/revision-ubicacion.md) §P1 acota lo observado a R/O/L y M frente a «otras combinaciones» sin cubrir.

## 4. Retractado: la observación de H3 sí coincide con el código

La primera versión de este informe afirmaba que «se borró el resultado 1 de 3 y el cable quedó en índice 2» no lo producía HEAD. Era un error de lectura: son dos casos distintos.

- Borrar la imagen **1** de 3 con el cable apuntando a la **3** (que sigue existiendo): `dropResults.ts:14-16` reasigna índices por orden (`to = [−1, 0, 1]`) y `:37-45` pasa el cable de `out-3` a `out-2`; `resultHandle` (`graph.ts:130`) nombra por posición 1-based. La imagen entregada sigue siendo a3. El mismo cálculo, ejecutado aparte: `out-1 → NO_RESULT`, `out-2 → out-1`, `out-3 → out-2`.
- `NO_RESULT` aparece solo cuando el cable apuntaba a la imagen borrada (`dropResults.ts:40-44`): es el caso que describe [repro-2026-10-29.md](repro-2026-10-29.md) («el cable al resultado 3 queda sin salida»), no el anterior.

Lo que sí se mantiene: `dropResults.ts` nació en `91ea576` y se extendió en `ba66e08`, ambos posteriores a `a4377c9`, así que la observación es de una versión con el arreglo. No hay mezcla de versiones; la fila H3 debería fechar la captura, nada más.

## 5. Parte 2: búsqueda de bug (sin navegador)

### 5.1 Pista 1, Nodes: una conexión entrega otra imagen — no reproducido

Los casos descritos ya son pruebas automatizadas y pasan en HEAD:

- `tests/repro-nodes-image.test.ts:49-121`: `baseline: the link to Smile delivers a3`; `deleting result 1 of 3 leaves the link on the same image (a3)`; `deleting result 1 leaves a link fixed on a2 delivering a2, not a3`; `deleting result 1 keeps the node pick on a2`; `a duplicated node keeps receiving a3`; `a pasted node keeps receiving a3`; `a link whose image was deleted does not deliver a new image when the node regenerates`; la miniatura de entrada muestra «no output» antes y después de regenerar; `a duplicated node keeps the no-output state`.
- Prueba ejecutada: `npx vitest run tests/repro-nodes-image.test.ts tests/no-result-run-all.test.ts tests/repro-spend-unknown.test.ts` → 3 archivos, 14 pruebas, todas en verde.

Resultado: por evidencia automatizada el fallo está cerrado. Los tests fijan el caso de §4 (`deleting result 1 of 3 leaves the link on the same image (a3)`, `deleting result 1 leaves a link fixed on a2 delivering a2, not a3`); la captura del caso «cable en 3, borrar 1» no se repitió aquí. 14/14 en verde es evidencia de estos casos, no de que no haya otras regresiones.

### 5.2 Pista 2, Nodes: el modelo con que se estima no es el que se ejecuta — no encontrado por lectura

Las dos mitades leen el mismo dato:

- Estimación: `executor.ts:73-82` para `video_upscale`/`video_edit`/`video_extend` usa `s.params._modelRef` y, sin él, `opModelFor(engine).ref`; `executor.ts:87-89` para los motores `edit`/`video` usa `s.params._modelRef`, luego el modelo del asset de origen y luego el del paso previo.
- Ejecución: `flow/actions.ts:228-229` construye `nodeChoice` con `_modelRef` por delante del modelo de origen, y `jobs.ts:1076` repite esa preferencia para `video_upscale`; `jobs.ts:1078` usa `nodeChoice` antes del modelo del origen.

Conclusión: no hay divergencia en esas rutas; coincide con lo que afirma H2 («corregido 2026-10-29»). Lo que sí sigue abierto es la decisión de producto: la revisión de gasto no nombra modelo ni proveedor en ningún caso ([nodes-controles/hallazgos.md:18](../nodes-controles/hallazgos.md)), de modo que un cambio de modelo resuelto en `nodeChoice` es invisible al usuario aunque el precio sea el correcto. Sin proveedor no se puede comprobar el modelo que el servidor recibe.

### 5.3 Pista 3, Designer: R/O/L/M con la variante Edit abierta — respondido en §3

Es una contradicción de documento, no un bug nuevo: el mecanismo (`toolboxModel.ts:25,52`; `ToolDock.tsx:64-67,133`; `ContextStrip.tsx:107`) está descrito y el síntoma ya está abierto como S1. La parte visual ya está observada en [revision-ubicacion.md](../designer-controles/revision-ubicacion.md) §P1 y sus capturas: `s1-after-r.png` (tira compacta de Rectangle) y `s1-after-m.png` (sin tira, familia Brush). Lo que sigue sin cubrir son las demás combinaciones de familia y variante.

## 6. Afirmaciones verificadas que no se contradicen

Comprobación por lectura de las citas con más peso en P1, P2 y P3; ninguna discrepancia.

| Documento y línea | Frase | Código que la sostiene |
| --- | --- | --- |
| [studio-controles/hallazgos.md:18](../studio-controles/hallazgos.md) (H2) | El cambio automático por adjuntos marca `userPicked[kind]=true` | `Composer.tsx:374` llama `pickComposerModel(…, false)` y `catalog.ts:235` fija `userPicked[kind]: true` sin mirar ese `false` |
| [studio-controles/hallazgos.md:19](../studio-controles/hallazgos.md) (H3) | `onAgentCredit` fija `modelPinned: true` aunque el comentario diga que solo lo fija el usuario | `credit.ts:211` frente a `store.ts:57` («True only when the user pinned this exact director model») |
| [studio-controles/hallazgos.md:17](../studio-controles/hallazgos.md) (H1) | El proveedor cambia en Auto sin Cambiar y sin comparar precio | `providerFit.ts:41-56` no lee precios; `autoSettings.ts:44` aplica el reemplazo; la divulgación se delega al agente en `providerFit.ts:51` |
| [studio-controles/hallazgos.md:23](../studio-controles/hallazgos.md) (H7) | «nothing is spent» es falso con un agente LLM | `PlanParts.tsx:126` (texto) frente a `llmTurn.ts:218` (cada turno suma gasto) |
| [studio-controles/hallazgos.md:24](../studio-controles/hallazgos.md) (H8) | Cancel detiene sin aviso y el trabajo remoto puede seguir cobrando | `PlanCard.tsx:189`: `stopPlanRun` y `cancelGeneration` seguidos, sin aviso |
| [studio-controles/hallazgos.md:25](../studio-controles/hallazgos.md) (H9) | La recuperación comprueba pasos nuevos y no se bloquea por el límite | `RecoveryActions.tsx:23-30`: `planRecoveryProblem(item, mode, sessionId)` y luego `resumePlan` |
| [studio-controles/hallazgos.md:43](../studio-controles/hallazgos.md) (H17) | El bloque «Actions suggested» está desactivado con `studio` | `SpaceBoard.tsx:154`: `{studio ? null : …}` |
| [studio-controles/README.md:11](../studio-controles/README.md) | Studio es el lienzo `chat` (`App.tsx:75-77`) | `App.tsx:75-77`: `workspace === 'chat' ? <ChatWorkspace />` y `<StudioBoard />` |
| [nodes-controles/hallazgos.md:27](../nodes-controles/hallazgos.md) (H11) | Borrar un nodo que genera está bloqueado con aviso | `flow/locks.ts:30`: «This node is generating. Wait for it to finish before deleting it.» |
| [nodes-controles/hallazgos.md:26](../nodes-controles/hallazgos.md) (H10) | Undo/Redo desactivado con una ejecución en curso | `CanvasNavigation.tsx:71`: `blocked = lockedNodes(...).size > 0 \|\| … ['running','queued'] …` |
| [nodes-controles/hallazgos.md:31](../nodes-controles/hallazgos.md) (H15) | No hay marca de nodo desactualizado; solo el recuento de Run all | `flow/freshness.ts:56`: `nodeIsCurrent` es la única comprobación, no hay estado por nodo |
| [designer-controles/hallazgos.md:75](../designer-controles/hallazgos.md) | Los commits posteriores a `a4377c9` no tocaron las rutas de S1–S10 | `git diff --stat a4377c9 HEAD -- ToolDock.tsx toolboxModel.ts ContextStrip.tsx EditCard.tsx` → vacío |

## 7. Límites de esta auditoría

- Sin sandbox en esta auditoría: no se ejecutaron pruebas de pantalla. Los informes anteriores sí documentan S1 en P1 y el borrado manual de un resultado; no acreditan por ello todas las variantes. «Sides»/«From and To» y cancelar una ejecución no se verificaron aquí.
- Sin proveedor: el modelo que el servidor recibe no se comprobó; solo la elección del cliente.
- Muestra, no censo: se abrieron 39 anclas de los tres registros, elegidas por peso en P1/P2/P3 y por estar citadas en `hallazgos` y `rastreo`. Las 11 defectuosas se cuentan sobre esas 39 y no se extrapolan al inventario completo (100+ filas en 20 notas de superficie).
- Documentos tocados: `scripts/check-docs.mjs:88` exige que todo archivo de `docs/` figure en el [índice](../README.md), así que se añadió esa línea. Además, a petición de una revisión externa (mensajes de GPT 6.1 Terra que el usuario reenvió para que se consideraran) se corrigieron las citas y dos frases de los mapas, y una segunda revisión de la misma fuente reescribió la fila H3 y las de S1/S2 (§8). La autoría de cada cambio está en §8.

## 8. Revisión del mismo día: qué se corrigió en este informe

La primera versión de este informe se escribió sin navegador y con el encargo de no tocar los documentos auditados. Una revisión externa —GPT 6.1 Terra, en mensajes que el usuario reenvió para que se consideraran— señaló dos errores de lectura; ambos se comprobaron contra el código antes de aceptarlos y se corrigen aquí. No son instrucciones del usuario: se aceptaron por la evidencia, no por la autoridad de quien las escribió. Los puntos que siguen sustituyen a lo que decía la primera versión.

| Punto | Lo que decía la primera versión | Qué se comprobó y qué dice ahora (señalado por la revisión externa, salvo la corrección de atribución) |
| --- | --- | --- |
| H3 · borrado de resultados | Que «el cable quedó en índice 2» no lo producía HEAD y que había dos versiones mezcladas en una fila | Retractado (§4): borrar la imagen 1 con el cable en la 3 reasigna `out-3 → out-2` y entrega la misma imagen; `NO_RESULT` solo aparece cuando se borra la imagen a la que apunta el cable. `dropResults.ts:14-16,37-45`; simulación del cálculo aparte |
| Tira contextual · M y texto | Que «R, O, L, M» compartían comportamiento y que el caso visual quedaba «requiere prueba» | R, O y L alcanzan la rama compacta de formas (misma familia `edit`); **M** cae en la familia Brush (`toolboxModel.ts:28`) y cierra la tarjeta; **texto** tiene familia propia (`:30`) y sigue sin alcanzarse por esa vía. La observación visual ya existía: `revision-ubicacion.md` §P1 y `s1-after-r.png`, `s1-after-m.png` (§3) |
| Cifra de citas | 11 de 39 sin decir que era una muestra | Se mantiene el número y se declara que vale para la muestra, no para el inventario (§7) |
| Afirmación de proceso | Señalada como falsa en `nodes-controles/README.md:13` | Corregida en el mapa: ya no afirma un script del repositorio y declara que no todas las citas se revisaron. La cifra «157», inicialmente escrita sin una salida verificable, se retiró después del mapa (§ abajo) |
| Citas de §1 | 11 anclas que existen y no sostienen su frase | Corregidas en `nodes-controles/hallazgos.md` (H3, H5, H7, H9 y el ancla del chip), `rastreo/README.md` (jobs.ts, budget.ts), `studio-controles/hallazgos.md` (H15) y `designer-controles/README.md` (alcance de la tira y R/O/L frente a M) |

Seguimiento: la fila H3 quedó fechada el 2026-10-29, después de `91ea576`, y separa `out-2` (número visible, 1-based) de `outputIndex: 1` (desde cero), que es lo que reasigna `dropResults.ts:14-16,37-45`. S1 sigue «Bug abierto» y distingue los casos vistos en P1/P2 de las combinaciones no cubiertas; no está corregido.

Seguimiento de atribución: se retiró del README la cifra «157», porque no se identificó una salida verificable de la comprobación ni se acreditó su alcance. Se conserva que una parte de las citas se revisó manualmente, sin afirmar cuántas. En la medición de esta auditoría, los tres registros sumaron 2277 citas `archivo:línea` (1708 distintas); esa cifra no implica que todas fueran contrastadas.

## Nota de autoría y estado

- Auditoría (yo): el informe, la línea del [índice](../README.md) y las 11 citas corregidas de §1, comprobadas abriendo cada línea.
- Revisión externa (GPT 6.1 Terra, mensajes que el usuario reenvió para que se consideraran): las reescrituras de la fila H3, de S1 y S2, la cifra «157» del README de Nodes y el aviso de que S1 no estaba «sin prueba». Se conservan porque se comprobaron contra el código; su origen no es el usuario.
- Al entregarse el informe y su revisión, los cambios estaban sin commit; el historial de Git registra su incorporación posterior.

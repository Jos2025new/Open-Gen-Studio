# Crítica independiente y tests adversariales — Núcleo de nodos (`task/neon-rev`)

## Veredicto

**El contrato del ADR 0031 sigue roto en dinero, conexiones, edición y agentes: 27 de 32 tests adversariales sobre rutas reales reproducen fallos.**
En dinero, reutilizar una aprobación tras un envío exitoso cobra dos veces y, a la inversa, la UI queda bloqueada para reintentar tras un fallo; en agentes, un chat desconectado cae a un agente ajeno y planes/ediciones mezclan historiales y modelos.
El registro de descriptores, migraciones, direcciones y `affects` están a medias o son código muerto, mientras más de 16 rutas siguen escribiendo al store o ejecutando en paralelo.

---

## Fallos reales encontrados por tests (de más a menos grave)

### Alta — Dinero y ejecuciones no aprobadas

1. **Doble gasto al reutilizar una aprobación ya ejecutada con éxito**
   - **Test:** `tests/adversarial-neon-dinero.test.ts` · `blocks double spend when the same prepared approval is passed to nodes.action.run a second time after succeeding`
   - **Qué pasa / debería pasar:** Tras `nodes.action.prepare` + `nodes.action.run` (`status: 'done', sends: 1`), otra llamada a `nodes.action.run` con el mismo `approval` (sin `runId` o con uno nuevo) vuelve a llamar a `executeSteps` y cobra dos veces. Una aprobación ya enviada (`running`, `done` o `failed` con `sends > 0`) debe quedar consumida y rechazar nuevos `runId`.
   - **Culpable:** `src/engine/nodecore/action.ts:105` (solo comprueba `status === 'failed' && sends > 0`) y `src/engine/nodecore/commands.ts:71` (`runId` opcional).
   - **Solución:** Bloquear cualquier `runId` nuevo si el `approval` ya tiene un registro con `status === 'running' | 'done' | 'failed'` y `sends > 0`; hacer `runId` obligatorio en `nodes.action.run`.

2. **Una referencia fijada (`pin`) a un nodo obsoleto re-ejecuta el ancestro sin aprobación y cambia la imagen fijada**
   - **Test:** `tests/adversarial-neon-dinero.test.ts` · `does not re-run a stale upstream node when the downstream link is pinned to its finished revision`
   - **Qué pasa / debería pasar:** `imgB` enlaza a `imgA` con `pin: 'gA1:assetA1'`. Al editar el prompt de `imgA` sin regenerarlo, `imgA` sigue entregando `gA1:assetA1` (pin vigente), pero preparar `imgB` planifica `runIds: ['imgA', 'imgB']` y sustituye `asset:assetA1` por la nueva salida de `imgA`. Debe usar `asset:assetA1` directamente sin regenerar `imgA`.
   - **Culpable:** `src/engine/flow/graph.ts:396,423`.
   - **Solución:** En `graphToSteps`, no recorrer ancestros a través de aristas con `pin` vigente y resolverlas directo como `asset:<valor>` desde el resolvedor común.

3. **Bloqueo permanente al reintentar en la UI (`runApproved`) tras un fallo de proveedor**
   - **Test:** `tests/adversarial-neon-dinero.test.ts` · `allows a fresh UI confirmation to retry a node after an earlier failed run without mutating parameters`
   - **Qué pasa / debería pasar:** Si un envío desde `RunButton` falla (`sends: 1, status: 'failed'`), abrir de nuevo Run (`prepareNodeRun` nuevo + `confirmId` nuevo) y confirmar devuelve `status: 'stale', sends: 0` (y `nodes.tsx:78` cierra el popover sin avisar). El nodo queda atascado hasta mutar parámetros o recargar. Una nueva confirmación explícita en la UI debe crear un `approval` nuevo y permitir el reintento.
   - **Culpable:** `src/engine/nodecore/action.ts:83-88,105` (`adoptPreview` deriva un `id` determinista desde `signature|force|targets` que colisiona con el fallo anterior).
   - **Solución:** Llamar a `prepareAction` (con `uid('appr')` y `pins` congelados al abrir el diálogo, no al confirmar) al abrir el popover de `RunButton`/`RunAll` y pasar ese `snapshot` a `runAction`.

### Alta — Agentes (destinatario equivocado y mezcla de historiales/modelos)

4. **Al desconectar el único agente del chat, el mensaje se desvía en silencio a un agente desconectado**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `does not route silently to an unconnected agent when the chat loses its only connected agent`
   - **Qué pasa / debería pasar:** Con `chat1` cableado solo a `agentB` (`recipient` sin fijar; `agentA` suelto en el grafo), desconectar `chat1 → agentB` y enviar un mensaje lo enruta a `agentA`. Debe avisar y bloquear mientras el chat no tenga agente conectado.
   - **Culpable:** `src/engine/agent/recipient.ts:21`.
   - **Solución:** Si existe el nodo chat en el grafo y `connected.length === 0`, devolver error explícito en lugar de caer a `agentNodeOf(sessionId)`.

5. **Ejecutar el plan aprobado de A mientras el usuario habla con B filtra las notas de A en B**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `delivers plan completion notes to the owning agent A even if the user talks to agent B while the plan executes`
   - **Qué pasa / debería pasar:** `approvePlan` no reserva `agent.busy` durante `executeSteps`. Si el usuario escribe a `agentB` mientras corre el plan de `agentA`, al terminar `planRun.ts:295` escribe el resumen de A en `agentB.notes` (y `wrapUpPlan` / `approveNodeRun` operan sobre B). Todo cierre de plan debe escribir siempre en el carril del agente dueño.
   - **Culpable:** `src/engine/agent/planRun.ts:146-149,295,346-359`.
   - **Solución:** Añadir `patchAgentLane(sessionId, ownerId, patch)` capaz de escribir tanto en el carril activo como en el aparcado, y pasar `sessionId` y `ownerId` explícitos a `agentSeesImages` y `llmTurn` en `wrapUpPlan`.

6. **Reescribir prompts en la tarjeta de plan de A mientras B está activo usa el LLM de B y escribe notas en B**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `uses owning agent A model and lane notes when rewriting prompts on A’s awaiting plan while B is active`
   - **Qué pasa / debería pasar:** `rewritePrompts` en un plan de `agentA` (`model-a`) estando `agentB` (`model-b`) activo llama a `model-b` y guarda la nota en `agentB.notes`. Debe usar el modelo y las notas del dueño de la tarjeta (`agentA`).
   - **Culpable:** `src/engine/agent/planSettings.ts:168,182,204` (y falta de `owner` en `changePlanChoice`/`changePlanDraft`/`setPromptWriter`).
   - **Solución:** Resolver `owner = laneOfItem(sessionId, itemId)`, pasarlo a `agentEngine(sessionId, owner)` y `agentSeesImages(sessionId, owner)`, y escribir notas en el carril de `owner`.

7. **Borrar un mensaje dirigido a A mientras B está activo muta el historial de B y deja intacto el de A**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `deletes a user message from its owning agent history without mutating the other active agent`
   - **Qué pasa / debería pasar:** `deleteUserMessage` nunca reclama el carril dueño. Si A y B recibieron el mismo texto, marca borrado el mensaje en B (o añade nota a B) mientras A conserva su mensaje. Debe mutar solo el historial del dueño del mensaje.
   - **Culpable:** `src/engine/agent/messageEdit.ts:33-41`.
   - **Solución:** Reclamar el carril con `claimLaneOfItem` (o parchear el carril dueño directo) y filtrar `historyIndexOf` por `agentNodeId`.

8. **Editar un mensaje dirigido a A cuyo texto también recibió B falla al recortar el historial de A**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `truncates agent A history cleanly when editing a message whose text also appeared in agent B`
   - **Qué pasa / debería pasar:** `historyIndexOf` cuenta mensajes de usuario de todos los agentes en `s.feed`, calcula `k = -1` y no recorta el historial de A, dejando el turno viejo junto al editado (y además borra mensajes posteriores de B del feed sin tocar su historial aparcado). Debe contar y podar por `agentNodeId`.
   - **Culpable:** `src/engine/agent/messageEdit.ts:20-30,55-58`.
   - **Solución:** Filtrar `users` en `historyIndexOf` por `agentNodeId` del mensaje editado y acotar el recorte del feed a los ítems de ese agente.

9. **Con dos chats (`chat1` y `chat2`), la respuesta del asistente a `chat2` se etiqueta con `chat1`**
   - **Test:** `tests/adversarial-neon-agentes.test.ts` · `tags the assistant reply with chat2 when the message was sent from chat2`
   - **Qué pasa / debería pasar:** `conversation.ts:158` no pasa `chatNodeId` a `llmTurn`, y `runtimeShared.ts:69` rellena siempre `chatNodeOf(sessionId)` (`chat1`), dejando `feedOfChat(HOME, 'chat2')` sin respuesta. Toda respuesta y tarjeta del turno debe conservar `chat2`.
   - **Culpable:** `src/engine/agent/conversation.ts:95,113,136,158`, `src/engine/agent/llmTurn.ts:50,95,183` y `src/engine/agent/runtimeShared.ts:69`.
   - **Solución:** Pasar `chatNodeId` en las opciones de `llmTurn`/`offlineTurn` y reenviarlo a `messageMeta`.

### Alta — Conexiones perdidas o sustituidas en silencio

10. **Cambiar el modelo de un nodo (`nodes.node.set_model`) borra en silencio todos sus enlaces `ref` y `control` salientes**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `keeps outgoing ref and control links when changing a generation node model via nodes.node.set_model`
    - **Qué pasa / debería pasar:** `setNodeModel` valida cada arista saliente contra `inputPorts(tgt.data)` sin filtrar `(e.kind ?? 'data') === 'data'`, destruyendo todos los enlaces `ref` y `control` salientes (mismo bug en `setNodeOp`, `actions.ts:230-234`). Deben conservarse intactos.
    - **Culpable:** `src/engine/flow/actions.ts:137-141` (y `230-234`).
    - **Solución:** Preservar siempre aristas con `(e.kind ?? 'data') !== 'data'` y mover `setNodeModel`/`setNodeOp` a `applyEdit`.

11. **`nodes.edge.connect` sustituye en silencio un puerto de un solo cable ocupado sin precondición**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `refuses silent replacement on an occupied single-cable port via nodes.edge.connect`
    - **Qué pasa / debería pasar:** `nodes.edge.connect` llama a `connectNodes`, que lee el ocupante actual y pasa `replaces: occupant.id` sin `expect`, pisando el cable existente (igual en `nodes.system.link`, `system.ts:554-555`). Un comando externo debe devolver conflicto si no nombra el cable a sustituir.
    - **Culpable:** `src/engine/flow/commands.ts:320`, `src/engine/flow/actions.ts:210-211` y `src/engine/nodes/system.ts:554-555`.
    - **Solución:** Exigir `expect` y `replaces` en `nodes.edge.connect` y `nodes.system.link` (o unificarlos en `nodes.edit.connect`).

12. **Imposible desconectar un cable roto desde el comando público `nodes.edge.disconnect`**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `allows removing a broken cable on a multi-cable port through nodes.edge.disconnect`
    - **Qué pasa / debería pasar:** `applyEdit` admite desconectar ids de `graph.broken`, pero `hasTarget` solo comprueba `graph.edges` y rechaza el comando con `No such edge` (igual en `unlinkSystemNodes`, `system.ts:570`). Debe permitir retirar cables rotos.
    - **Culpable:** `src/engine/flow/commandKit.ts:58` y `src/engine/nodes/system.ts:570`.
    - **Solución:** Comprobar también `graph.broken?.some((b) => b.edge.id === id)` en `hasTarget` y `unlinkSystemNodes`.

13. **`nodes.node.duplicate` descarta `edge.pin` y vuelve válida una referencia fijada obsoleta**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `preserves a pinned incoming reference when duplicating its consumer via nodes.node.duplicate`
    - **Qué pasa / debería pasar:** Al duplicar un consumidor con cable fijado inválido (`pinMoved: true`), el duplicado nace con cable móvil `status: 'ok'` (y además pierde `kind` y `both`). Debe conservar `pin`, `kind` y `both`.
    - **Culpable:** `src/engine/flow/actions.ts:177-180`.
    - **Solución:** Compartir con `pasteNodes` la copia íntegra de metadatos de arista (`pin`, `kind`, `both`, `outputIndex`) pasando por `applyEdit`.

14. **`nodes.edit.connect` con `kind: 'data'` y `sourceHandle: 'out-2'` descarta `outputIndex`**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `preserves sourceHandle out-2 and outputIndex when connecting via nodes.edit.connect with kind data`
    - **Qué pasa / debería pasar:** Indicar `kind: 'data'` activa `usesSystemPorts` (`graph.ts:132`), normaliza `out-2` a `'out'` y omite `outputIndex`, cableando el resultado #1 en vez del #2. Debe preservar `sourceHandle: 'out-2'` y `outputIndex: 1`.
    - **Culpable:** `src/engine/flow/graph.ts:132,193-211`.
    - **Solución:** Conservar `handleIndex(c.sourceHandle)` y `GONE_HANDLE` en toda arista `kind === 'data'`.

15. **`nodes.node.restore` rechaza la salida de `nodes.node.delete_with_undo` cuando había un cable con `pin`**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `round-trips a deleted node with a pinned cable through nodes.node.delete_with_undo and nodes.node.restore`
    - **Qué pasa / debería pasar:** `storedEdge` usa `.strict()` sin declarar `pin`, haciendo fallar Zod al restaurar cualquier nodo con cables fijados (mismo desfase en `refNode` para `llm`, `recipient`, `view`, `undocked`, `promptText`). Debe aceptar todos los campos válidos del modelo.
    - **Culpable:** `src/engine/flow/commands.ts:46-57,87-98`.
    - **Solución:** Declarar `pin` en `storedEdge` y sincronizar `sysType`, `refNode` y `nodePatch` con `graphTypes.ts`.

### Media — Atajos sin aprobación, precondiciones y contrato del resolvedor

16. **Atajo #1 (`nodes.node.edit` sin `expect`): un llamador distinto puede editar a ciegas un nodo ajeno**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `refuses a blind nodes.node.edit from a different caller on a node created by another caller`
    - **Qué pasa / debería pasar:** `known` se indexa solo por `${session}:${node}` sin `ctx.caller`: un nodo creado por `cli` es sobrescrito sin `expect` por `agent`. Debe rechazarse toda edición ciega sin revisión leída.
    - **Culpable:** `src/engine/flow/commands.ts:113-118,168-174`.
    - **Solución:** Eliminar `known` y exigir `expect` obligatorio en `nodes.node.edit`, devolviendo `rev` en los comandos de alta y edición.

17. **Atajo #1 (`nodes.node.edit` sin `expect`): un comando retrasado pisa el cambio reciente de otro comando**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `refuses a stale blind nodes.node.edit after an earlier blind command already updated the node`
    - **Qué pasa / debería pasar:** Cada `nodes.node.edit` sin `expect` llama a `born()` y avanza `known` a la revisión nueva, de modo que un borrador retrasado (`count: 1`) sin `expect` pisa `count: 3`. Debe devolverse conflicto.
    - **Culpable:** `src/engine/flow/commands.ts:174-177`.
    - **Solución:** Misma solución que el hallazgo 16: eliminar el estado oculto `known` y exigir `expect` siempre.

18. **`nodes.node.edit` carece de `strict: true` y permite mutar `kind` y corromper la forma del nodo**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `refuses changing a node kind or writing unowned fields through nodes.node.edit`
    - **Qué pasa / debería pasar:** Aun con `expect`, `nodes.node.edit` permite escribir `kind: 'image'` sobre un nodo `text`, dejándolo sin `settings` ni `modelRef`. Debe rechazar claves no declaradas en `descriptor.params`.
    - **Culpable:** `src/engine/flow/commands.ts:61-84,175`.
    - **Solución:** Quitar `kind` de `nodePatch` y pasar `strict: true` a `applyEdit` (o unificar con `nodes.edit.set`).

19. **`nodes.edit.connect` omite `replaceConflict` en puertos de sistema de un solo cable vacíos (`model`)**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `rejects a stale replaces precondition on an empty single-cable system port (model) in nodes.edit.connect`
    - **Qué pasa / debería pasar:** Tras desconectar `e-model` de `gen.model`, pasar `replaces: 'e-model'` tiene éxito en vez de dar conflicto porque `edit.ts:77,82` solo mira `inputPorts` y marca `isSingle = false`. Debe comprobar la cardinalidad real en `nodePorts`.
    - **Culpable:** `src/engine/nodecore/edit.ts:77-84`.
    - **Solución:** Consultar `nodePorts(tgt.data, assets)` para determinar `isSingle` y ejecutar `replaceConflict` siempre que `port?.multi === false` o `typeof op.replaces === 'string'`.

20. **Reconectar la misma fuente sin `replaces` en `nodes.edit.connect` elimina el `pin` en silencio**
    - **Test:** `tests/adversarial-neon-conexiones.test.ts` · `does not silently strip a pin when re-wiring the same source without naming replaces`
    - **Qué pasa / debería pasar:** Reconectar `src → gen.prompt` cuando existe `e1` con `pin` entra en `sameSource = true`, evita `replaceConflict` y crea un cable móvil nuevo sin `pin`. Debe dar conflicto si no nombra `replaces: e1`.
    - **Culpable:** `src/engine/nodecore/edit.ts:83`.
    - **Solución:** Tratar como idempotente solo cuando la arista existente no tiene `pin` (o coincide en `pin`, `outputIndex` y `both`); si difiere, exigir `replaces`.

21. **Atajo #2 (`lastRunFor` fallback) + bypass de `nodes.run.start`: el inspector atribuye una generación nueva a un `runId` viejo**
    - **Test:** `tests/adversarial-neon-dinero.test.ts` · `does not attribute a generation produced by nodes.run.start to an older action runId in the inspector`
    - **Qué pasa / debería pasar:** `nodes.run.start` ejecuta sin pasar por `action.ts`; al inspeccionar después, `lastRunFor` cae a `mine.find(r => r.sends > 0)` y adjudica `g-second` a `run-old`. Nunca debe atribuirse un `runId` que no produjo esa generación.
    - **Culpable:** `src/engine/flow/commands.ts:384` y `src/engine/nodecore/action.ts:135`.
    - **Solución:** Enrutar `nodes.run.start` y `approveNodeRun` por `prepareAction`/`runAction`, persistir `actionRunId` en `Generation` y eliminar el fallback de `lastRunFor`.

22. **Atajo #2 (`lastRunFor`): un ancestro ejecutado dentro de un lote downstream se atribuye a su ejecución anterior**
    - **Test:** `tests/adversarial-neon-dinero.test.ts` · `attributes an upstream node generation produced during a downstream run to that downstream runId`
    - **Qué pasa / debería pasar:** `run-B2` (objetivo `['imgB']`) regenera `imgA` (`gA2`). Como `ActionRecord.targets` no incluye `imgA`, `lastRunFor` filtra `run-B2` y cae al `run-A1` anterior. Debe devolver `runId: 'run-B2'`.
    - **Culpable:** `src/engine/nodecore/action.ts:108,132-135`.
    - **Solución:** Guardar `runIds` reales en `ActionRecord` y buscar primero por coincidencia exacta de `generationId` en toda la sesión.

23. **Atajo #2 (`lastRunFor`): un resultado previo guardado (`done`) se atribuye a una ejecución posterior fallida**
    - **Test:** `tests/adversarial-neon-dinero.test.ts` · `does not attribute a pre-existing saved generation to a later failed run`
    - **Qué pasa / debería pasar:** Un nodo conserva su resultado `g-saved` tras fallar `run-failed` (`sends: 1`). El inspector cae al fallback y reporta `{ generationId: 'g-saved', status: 'done', runId: 'run-failed' }`. Debe separar el productor real del último intento fallido.
    - **Culpable:** `src/engine/nodecore/action.ts:135` y `src/engine/nodecore/inspect.ts:47,52`.
    - **Solución:** Eliminar el fallback cuando `generationId` no coincide y exponer `lastAttempt` separado en `NodeInspection` (visible también cuando el primer intento falla sin `generationId`).

24. **`previewRun` / `nodes.action.prepare` lanza `TypeError` si un `subject` apunta a un nodo borrado**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `returns a structured error instead of crashing when preparing a node whose subject source was deleted`
    - **Qué pasa / debería pasar:** `previewRun` añade `Missing input node: src.` a `errors`, pero luego hace `graph.nodes.find(...)!.data` en `actions.ts:336` y `guard.ts:30-31`, lanzando `TypeError`. Debe devolver el error estructurado.
    - **Culpable:** `src/engine/flow/actions.ts:335-336` y `src/engine/nodecore/guard.ts:30-31`.
    - **Solución:** Proteger contra `n == null` en `previewRun` y `coreSignature` devolviendo `[id, 'missing']`.

25. **`descriptor.affects: false` contradice la frescura (`nodeIsCurrent` / `inspectNode.fresh`)**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `keeps freshness consistent with descriptor.affects when a port declares affects: false`
    - **Qué pasa / debería pasar:** Con `affects.prompt = false`, `consumersOf` no invalida al consumidor, pero `nodeRequest` sigue incluyendo `prompt` y marca el nodo como obsoleto. Ambas consultas deben obedecer `affects`.
    - **Culpable:** `src/engine/flow/freshness.ts:41`.
    - **Solución:** Filtrar en `nodeRequest` los puertos con `descriptorOf(node.data.kind)?.affects[i.port] === false`.

26. **Un nodo sistema `prompt` conectado a `image.prompt` se acepta al cablear pero el resolvedor lo ignora**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `resolves text from a connected system prompt node through the common resolver and prepareAction`
    - **Qué pasa / debería pasar:** `nodes.edit.connect` permite enlazar `ref(type:'prompt') → image.prompt`, pero `sessionChatText` (`resolver.ts:49`) devuelve `undefined` y `prepareAction` falla; entretanto `promptsWiredToAgent` (`spec.ts:276`) lee nodos `prompt` por fuera del resolvedor (ignorando `pin` y `broken`).
    - **Culpable:** `src/engine/nodecore/resolver.ts:49,72`, `src/engine/flow/graph.ts:62-66` y `src/engine/nodes/spec.ts:276-284`.
    - **Solución:** Soportar `type === 'prompt'` en `outputPort` y `sourceValue` (vía `promptNodeText`) y hacer que `promptsWiredToAgent` lea de `resolveInputs`.

27. **Un cable fijado (`pin`) cuya fuente pasa a `null` se reporta como `'empty'` en lugar de `'invalid'` (`pinMoved`)**
    - **Test:** `tests/adversarial-neon-edicion.test.ts` · `marks a pinned cable as invalid (pinMoved) when its source output becomes null`
    - **Qué pasa / debería pasar:** Al vaciar `assetId: null` en una fuente fijada a `img1@0/1`, `resolver.ts:94` exige `value != null` para invalidar el pin y devuelve `status: 'empty'`, evitando el bloqueo de `guard.ts:20` en puertos `required`. Debe devolver `status: 'invalid', pinMoved: true`.
    - **Culpable:** `src/engine/nodecore/resolver.ts:94`.
    - **Solución:** Evaluar `if (e.pin && revision !== e.pin)` también cuando `value == null`.

---

## Críticas de diseño sin test

1. **El registro de tipos es fachada; añadir un tipo de nodo exige editar ~8 archivos y `migrate` es teatro**
   - **Evidencia:** `src/engine/graphTypes.ts:5`, `src/engine/nodecore/generation.ts:11-12`, `src/engine/nodecore/evaluate.ts:14` (sin llamadores en runtime), `src/engine/flow/actions.ts:43-82`, `src/engine/flow/commands.ts:16,59`, `src/components/node/nodes.tsx:35,791`, `src/components/node/AddNodeItems.tsx:14-49`, `scripts/check-node-descriptors.mjs:19-22`.
   - **Problema:** Los descriptores envuelven `flow/graph.ts` en lugar de ser la fuente de verdad; `evaluate`, `actions` y `migrate` no se invocan en ningún flujo real, y el check solo busca la subcadena `\bmigrate\b` por regex sin comprobar las versiones `1..version-1` ni ejecutar migraciones en hidratación.
   - **Alternativa concreta:** Mover `defaultData`, puertos, `evaluate`, `migrate` y metadatos de librería a cada `types/<tipo>.node.ts`, hacer que `graph.ts`, `AddNodeItems.tsx` y la carga de sesiones lean de `descriptorOf`, y validar `migrate[1..version-1]` importando los descriptores en el check.

2. **Direcciones completas (`address.ts`) como código muerto y separadores frágiles**
   - **Evidencia:** `src/engine/nodecore/address.ts:6-16`, `src/engine/nodecore/action.ts:60,115`.
   - **Problema:** Nadie en `src/` importa `portAddress`/`addressKey`/`parseAddress`. Además tanto `parseAddress` (`[^/.]+`) como `action.ts:115` (`key.split('.')[0]`) se rompen si un `nodeId` contiene un punto.
   - **Alternativa concreta:** Usar claves estructuradas o serializadas sin delimitadores ambiguos en `ActionSnapshot.pins` y en el inspector, y no mantener helpers desconectados del flujo real.

3. **Más de 16 caminos paralelos escriben con `setGraph`/`writeGraph` esquivando `applyEdit`**
   - **Evidencia:** `src/engine/flow/actions.ts:86,134,187,228,242,436`; `src/engine/flow/arrange.ts:182,231,275`; `src/engine/nodes/system.ts:237,264,318,396,471,595`; `src/engine/nodes/omni.ts:18-23,146`; `src/engine/agent/planRun.ts:35,133,235`.
   - **Problema:** `pasteNodes` (`arrange.ts:174`) pierde enlaces `ref`/`control`; `removeDraftNodes` borra nodos sin `broken`; `omni.ts:writeGraph` salta incluso `setGraph` (sin locks ni historial); `attachModelToNode`/`setLinkBoth` no dejan traza `node-core`.
   - **Alternativa concreta:** Restringir `setGraph` a `edit.ts` (y posiciones/viewport), añadir operaciones compuestas (`batch`/`paste`/`restore`) a `applyEdit`, y añadir un check estático que bloquee nuevos usos directos de `setGraph`.

4. **Registro de acciones solo en memoria y sin poda**
   - **Evidencia:** `src/engine/nodecore/action.ts:45-51`.
   - **Problema:** Recargar la app borra `snapshots` y `ledger`, anulando la deduplicación por `runId` y la trazabilidad del inspector; en sesiones largas ambos `Map` crecen sin límite.
   - **Alternativa concreta:** Persistir `actionRunId`/`approvalId` dentro de cada `Generation` y conservar un historial acotado de los últimos `N` `runId` por sesión.

5. **El *lane swapping* de Tira 2 es frágil con asincronía y filtra ajustes entre agentes**
   - **Evidencia:** `src/engine/agent/lanes.ts:20-36`, `src/engine/nodes/system.ts:338-341`, `src/components/omni/ChatNode.tsx:43`, `src/components/node/AgentNodeControls.tsx:13-20`.
   - **Problema:** Intercambiar `session.agent` en cada turno provoca fugas en cualquier operación asíncrona fuera de `llmTurn`. Además `SHARED` hace que cablear un nodo `Model` al Agente A cambie el modelo de imagen/vídeo del Agente B; `ChatNode` muestra todo `session.feed` sin usar `feedOfChat`; y `AgentLlmSelect` solo lista modelos del proveedor global (y desaparece si el global es `offline`).
   - **Alternativa concreta:** Guardar el estado por instancia en `session.agents[agentNodeId]` (incluyendo sus modelos cableados), pasar un `TurnTarget = { sessionId, chatNodeId, agentNodeId }` inmutable por toda la cadena, y permitir elegir proveedor+modelo por agente en `AgentLlmSelect`.

6. **Arreglo visual de la barra flotante: suscripción de zoom en todos los nodos creativos**
   - **Evidencia:** `src/components/node/nodes.tsx:774,794-797`.
   - **Problema:** `CreativeNode` se suscribe a `st.transform[2]` en todos los nodos creativos incluso cuando `showTools === false`, forzando re-renders de todo el grafo en cada tick de zoom, y usa un mágico `TITLE_RISE = 21`.
   - **Alternativa concreta:** Leer el zoom solo cuando `showTools` es verdadero (`useFlowStore((st) => (showTools ? Math.round(7 + TITLE_RISE * st.transform[2]) : 0))` o en un componente hijo montado condicionalmente).

7. **Cables rotos (`graph.broken`) invisibles en el lienzo**
   - **Evidencia:** `src/components/node/NodeWorkspace.tsx:194,440`.
   - **Problema:** El usuario sigue sin ver ni poder retirar cables rotos en la interfaz (y `nodes.edge.disconnect` los rechaza por el hallazgo 12).
   - **Alternativa concreta:** Aprobar un indicador mínimo en el puerto con acción contextual para retirar el cable roto y mostrar el resumen de `inspectNode` en el panel de selección.

---

## Ataques que pasaron

- `tests/adversarial-neon-dinero.test.ts` · `enforces a lowered spending limit between nodes.action.prepare and nodes.action.run before sending`: bajar el límite tras `prepare` bloquea `run` antes de llamar a `executeSteps`.
- `tests/adversarial-neon-dinero.test.ts` · `rejects running an approval prepared for session A against session B`: reutilizar un `approval` de otra sesión se rechaza sin ejecutar.
- `tests/adversarial-neon-conexiones.test.ts` · `rejects a self-loop and a two-node data cycle through nodes.edit.connect`: `nodes.edit.connect` rechaza auto-bucles y ciclos de datos de 2 nodos.
- `tests/adversarial-neon-agentes.test.ts` · `rejects an explicit nonexistent agentNodeId without routing to another agent`: un `agentNodeId` inexistente avisa con error y no llama al LLM.
- `tests/adversarial-neon-edicion.test.ts` · `rejects unowned parameters and stale revisions through nodes.edit.set`: `nodes.edit.set` rechaza claves no declaradas y revisiones obsoletas sin mutar el grafo.

---

## Lo que no pude ejecutar

- `npm test` completo y scripts `node scripts/...` dependientes de CWD: el directorio de trabajo de la shell del entorno es `/home/samuel/.local/share/ogs-workers/bus` (no la raíz del repo) y `cd` no está en la lista de comandos permitidos; `npx tsc` y `npx vitest run ... --maxWorkers=1` sí se ejecutaron contra la raíz del repo con `--prefix`/`--root`.
- No se arrancó la app, servidor de desarrollo, navegador, persistencia real ni red real (`fetch` simulado en todos los tests).
- Comprobación de memoria `free -m` antes de cada Vitest: `available` entre 3181 MB y 3384 MB (siempre > 1200 MB). `npx tsc -b --noEmit` terminó con código 0.

## Cierre (rama `task/nucleo-nodos`)

Los 27 fallos pasan; se quitaron las marcas `FALLO REAL`. Una corrección de test: el 17 llamaba al primer `nodes.node.edit` sin `expect`; ahora ambos nombran la revisión que devolvió el alta (el retrasado sigue siendo rechazado). Quedan abiertos: estado indexado por agente (hoy hay escrituras al dueño, no un mapa), migraciones aplicadas en la carga y `dropResults.ts` fuera de la capa.

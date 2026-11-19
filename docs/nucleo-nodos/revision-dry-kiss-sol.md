**Veredicto**  
En `task/neon-rev` (`c4c6b440`), el mayor beneficio está en quitar las guardas obsoletas de selección de hilo, fijar el dueño al iniciar cada turno y unificar Stop.  
Revisé `09ac4b55..HEAD` en solo lectura. Los tests citados son comprobaciones para una futura implementación y quedaron sin ejecutar.

### Hallazgos, de mayor a menor beneficio

1. **KISS · Seleccionar un hilo ya no puede bloquear una acción.** `src/engine/agent/lanes.ts:23,54`, `conversation.ts:43,224,282`, `planRun.ts:48,343`, `messageEdit.ts:61,120`. `enterLane` siempre devuelve `null`, pero sus llamadores aún tienen salidas de error.  
   Usa `enterLane(...): void` y haz que `claimLaneOfItem` devuelva el dueño que ya resolvió. Conserva el orden de selección, la herencia de ajustes y las guardas reales. Comprueba el cambio de agente a mitad de turno en `nodecore-strip2.test.ts:81` y `adversarial-neon-hilos-agent-ui.test.ts:392`. La primera prueba también fija el retorno interno `null`.

2. **KISS · El dueño vuelve a ser opcional dentro de un turno.** `src/engine/agent/llmTurn.ts:51–57,205`, `planRun.ts:93`, `canvasCalls.ts:95`. Los llamadores de producción ya pasan el dueño.  
   Exige `agentNodeId` en `llmTurn` y `owner` en `presentNodeRun`, antes de los demás argumentos opcionales. Usa el mismo ID para el motor, el estado y el reintento por crédito. Riesgo de usar el modelo de otro agente o mover su historial. Compruébalo con `agent-parallel-owner.test.ts` y `agent-own-llm.test.ts`.

3. **DRY · Stop y el borrado de un nodo abortan el mismo turno por separado.** `src/engine/agent/conversation.ts:320–324`, `runtimeShared.ts:37–45`.  
   Lleva `stopAgent(sessionId, owner)` al módulo que posee `controllers` y `ending`, y reutilízalo desde el borrado antes de `dropThread`. Conserva el orden abortar → finalizar y la comprobación de identidad del controlador. Pruebas `agent-stop.test.ts`, `agent-cancel.test.ts` y `adversarial-neon-hilos-agent-ui.test.ts:125,163`.

4. **DRY · La atribución de filas antiguas se calcula tres veces.** `src/engine/agent/threads.ts:69–77`, `lanes.ts:39–47`, `src/engine/nodecore/resolver.ts:47–60`.  
   Comparte un `feedOwner(row, kind, fallbackId)` y deja que cada consumidor calcule su fallback una vez. El resolvedor usa `node.id` cuando no encuentra el primer nodo y recorre el feed hacia atrás sin copiarlo. Conserva ambas cosas. Pruebas `chat-owns-feed.test.ts`, `adversarial-neon-hilos-agent-ui.test.ts:370` y `adversarial-neon-hilos-perf.test.ts:175`.

5. **DRY · Editar y reabrir repiten el recorte del feed.** `src/engine/agent/messageEdit.ts:21–34,62–70,123–135`.  
   Calcula las filas posteriores del dueño una vez y comparte su eliminación, incluida la limpieza de borradores. Editar incluye la fila inicial y reabrir la conserva. Mantén el emparejamiento por orden para textos idénticos y el conteo actual de `editLog`, que difiere entre ambas acciones. Pruebas `adversarial-neon-agentes.test.ts:189`, `adversarial-neon-owner-cross.test.ts:124,139,347` y `agent-retry.test.ts:246,262`.

6. **DRY · La conexión por puertos resueltos repite cómo se sustituyen aristas.** `src/engine/nodecore/edit.ts:70–101`, `src/engine/flow/graph.ts:193–218`.  
   Comparte primero solo la construcción del conjunto de aristas para puertos de sistema ya resueltos. Deja las precondiciones en `planConnect` y conserva la rama de datos que calcula `outputIndex`. Riesgo de perder un cable fijado o pisar una entrada ocupada. Pruebas `nodecore-core.test.ts:90,105` y `adversarial-neon-conexiones.test.ts:58,68,146`.

7. **DRY · Preparar y adoptar una aprobación duplican su registro.** `src/engine/nodecore/action.ts:83–94,103–108`.  
   Haz que `prepareAction` llame a `adoptPreview` tras validar y preparar la vista previa, conservando su evento de preparación. La deduplicación de clics de `src/engine/agent/planNodeRun.ts:13–23` y el consumo al intentar el envío en `action.ts:126–152` cubren ventanas distintas. Pruebas `nodecore-strip1.test.ts:53,67,95` y `adversarial-neon-hilos-money.test.ts:74,100,148,160`.

8. **KISS · La puerta de envío vuelve a elegir la sesión.** `src/engine/agent/sendGate.ts:6–12`, `conversation.ts:35–41`, `src/components/shell/HomeBar.tsx:26`, `src/components/composer/Composer.tsx:248,388,536`.  
   Pasa `sessionId` y `owner` a `agentAccepts`. Conserva el indicador de ocupado del compositor y la validación de envío al actuar. El contrato protegido de `writerLock.ts` y `writerHandoff.ts` queda intacto, incluido el rechazo de trabajo nuevo durante el traspaso. Pruebas `send-gate.test.ts`, `adversarial-neon-owner-handoff.test.ts:51` y `adversarial-neon-hilos-agent-ui.test.ts:113,125,231`.

9. **DRY · Dos helpers idénticos reconstruyen un hilo ausente y un tercero lo repite en línea.** `src/engine/agent/runtimeShared.ts:69`, `requestGuides.ts:13`, `llmTurn.ts:56`, `lanes.ts:65`.  
   Define `agentOf` una vez junto a `laneState`. Conserva `laneState` y `threadOf` para quienes necesitan distinguir un hilo ausente de uno vacío. Riesgo de ocultar un agente eliminado. Pruebas `agent-parallel-owner.test.ts` y `adversarial-neon-hilos-agent-ui.test.ts:163,370`.

10. **DRY · Los checks AST duplican el recorrido y el cálculo de líneas.** `scripts/check-graph-writes.mjs:18–37,45–65`, `scripts/check-agent-owner.mjs:18–37,55–78`.  
    Extrae el recorrido de archivos, el parseo y la visita AST con entrada y salida. Mantén los predicados, las exclusiones y los mensajes en cada check. El riesgo es perder el contexto de `setSettings` o cambiar diagnósticos. Pruebas `adversarial-neon-hilos-core-ast.test.ts:176,187` y `adversarial-neon-owner-stop-escapes.test.ts:180`.

### Conviene conservar

`agentLane` aún decide si el cierre de un plan cambia de lienzo y participa en la herencia de ajustes al seleccionar un hilo.  
`main` y `onlyMain` preservan el chat sin nodo agente y la adopción del historial antiguo por el primer agente.  
`recipientOf` valida el destino de un envío nuevo. `resolveOwner` atribuye filas existentes, incluso si se borró su nodo. Cada regla tiene su propio fallback.
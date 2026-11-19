# Crítica del núcleo de nodos — Grok, 2026-11-19

Repositorio `ogs-nucleo-nodos`, rama `task/nucleo-nodos`, `b0025cd6`. Solo lectura.

## Veredicto

No es el cimiento de «todo es un nodo» ni de un space como subnet: el valor de un cable y el gasto no tienen una sola puerta (`src/engine/agent/planRun.ts:177`, `src/engine/flow/dropResults.ts:32`).
Aguanta un grafo chico de un solo escritor. No aguanta miles de nodos ni el próximo tipo sin reabrir el resolvedor y el ejecutor (`src/engine/nodecore/evaluate.ts:14`).
Freno para fusionar: sí. El plan de nodos gasta fuera del registro de aprobaciones, y borrar la imagen elegida cambia lo que entrega el cable `out`.

## Fallos graves

1. **Se paga dos veces.** Aprobar un plan en el lienzo llama a `executeSteps` directo (`src/engine/agent/planRun.ts:154`, `src/engine/agent/planRun.ts:177`) y no toma `lockNodes` (`src/engine/flow/locks.ts:20`, solo lo usa `src/engine/flow/actions.ts:356`). `graphToSteps` fuerza cada objetivo cuando `force` no es `false` (`src/engine/flow/graph.ts:386`, `src/engine/flow/graph.ts:402`); ese plan no lo pasa. Un Run a la vez, o aprobar otra vez tras un fallo, reenvía nodos ya cobrados. El registro que sí impide el segundo envío (`src/engine/nodecore/action.ts:132`) vive en un `Map` (`src/engine/nodecore/action.ts:48`) y al recargar se esfuma; el aviso pide regenerar (`src/engine/jobs.ts:828`). Solución: `runPlanItem` entra por `runAction`, con `force: false` salvo pedido explícito, y `lockNodes` antes de enviar; el id de aprobación se guarda con la generación.

2. **Un cable cambia de imagen en silencio.** Si se borra el resultado elegido y quedan otros, el nodo adopta el índice vecino (`src/engine/flow/dropResults.ts:32`). El cable del puerto `out` no guarda índice (`src/engine/flow/graph.ts:213`) y el resolvedor usa el del nodo (`src/engine/nodecore/resolver.ts:86`). Sigue conectado y el siguiente Run paga esa otra imagen. El cable con índice sí queda en `NO_RESULT` (`src/engine/flow/dropResults.ts:41`). `deleteGeneration` pasa por ahí y luego solo limpia `generationId` (`src/engine/actions.ts:522`, `src/engine/actions.ts:530`). Solución: el `out` cuyo resultado ya no está queda en `NO_RESULT`; no se reasigna el pick.

3. **Borrar un agente se lleva su memoria, y el deshacer no la trae.** `dropThread` quita `session.agents[id]` (`src/engine/agent/lanes.ts:17`) al borrar el nodo (`src/engine/agent/runtimeShared.ts:51`). Restaurar solo devuelve nodos y cables (`src/engine/flow/actions.ts:408`). Se pierden historial, pendientes y modelo. Al cargar, si no hay `agentLane`, ese estado único se guarda bajo el autor del último mensaje (`src/engine/agent/threads.ts:60`): puede despertar otro agente con el pendiente. Solución: el snapshot de deshacer incluye el hilo; migrar con `agentLane` o el primer agente, nunca con el último autor.

## Diseño

Un tipo nuevo no es un archivo. `evaluate` (`src/engine/nodecore/evaluate.ts:16`), `sourceValue` (`src/engine/nodecore/resolver.ts:78`) y `graphToSteps` (`src/engine/flow/graph.ts:458`) vuelven a decidir por `kind`. El descriptor delega los puertos (`src/engine/nodecore/types/text.node.ts:9`). El `ref` ya vale `null` en un sitio (`src/engine/nodecore/evaluate.ts:19`) y texto del feed en el otro (`src/engine/nodecore/resolver.ts:79`). Hacerlo ahora: el descriptor declara valor y puertos, y el plan de ejecución solo lee `resolveInputs`. Hacerlo después: cada tipo se desalinea en tres `switch`.

El subnet no cabe sin reescribir los recorridos. `address.ts` solo hashea (`src/engine/nodecore/address.ts:10`); no hay dirección sesión/grafo/nodo/puerto. Ciclos y ejecución asumen un grafo plano (`src/engine/nodecore/deps.ts:41`, `src/engine/flow/graph.ts:392`). Houdini cocina el subnet como un nodo y aplana al compilar; aquí un grupo es un marco. Meterlo ahora: nodos Entrada y Salida y un plan plano, antes de más recorridos. Meterlo después: resolvedor, ciclos, frescura y ejecutor, con cables ya guardados por id local.

La guarda contra el recableo no mira lo que el cable entrega: compara origen, destino y handles, no `pin`, `kind` ni `outputIndex` (`src/engine/nodecore/edit.ts:123`). Por eso el fallo 2 no puede pararlo. Cada resolve de un chat sin mensaje recorre el feed entero (`src/engine/nodecore/resolver.ts:58`); con miles de nodos el coste crece con el uso, no con el cambio.

`compound`, `present`, `travel` y `silent` (`src/engine/nodecore/edit.ts:38`) son capas puestas encima de un grafo que sigue interpretándose fuera del descriptor. No tapan el fallo; lo rodean.

## No tocar

La escritura de topología por `applyEdit` y el check de que nadie más llame a `setGraph` (`src/engine/nodecore/edit.ts:262`).
El cable cuya fuente se borró se conserva como inválido (`src/engine/nodecore/edit.ts:154`), y una aprobación ya intentada no se reenvía en el camino que entra al registro (`src/engine/nodecore/action.ts:130`).
`patchLane` escribe por id de agente (`src/engine/agent/lanes.ts:73`): A y B no comparten el turno.

# Diagnóstico: por qué el dinero abre un frente nuevo con cada arreglo

2026-11-22, sesión maestra 8. Lectura de código (rama task/p9-7, 7fe7e1b9) e historial (sesiones 5-8, 52 hallazgos de dinero en historia 068-075 y el bus de workers). Sin ejecución de proveedor. Las líneas citadas son de task/p9-7.

## Síntoma

Cada ronda de arreglos de dinero cierra sus hallazgos y el siguiente ataque encuentra otros en una ruta vecina: gasto-puerta (3 rondas), envíos durables (rondas A-D), dinero-7, p9 (3 rondas). De 52 hallazgos, unos 40 están arreglados con test y aun así siguen apareciendo nuevos.

## Causas raíz

### 1. Lo que el usuario aprobó y lo que salió al proveedor no comparten identidad

Hay un registro durable por envío, `Generation.sends[]` (sendMark.ts:88, guardado con espera antes del fetch). Pero cada capa de decisión lleva su propio «ya salió», sin cruzarlo con él:

| Capa | Su registro | Persistido | Mira `g.sends` |
|---|---|---|---|
| Tarjeta de comandos | `stepProgress` (commandCalls.ts:80) | solo de rebote | no |
| Plan | `stepStates`/`stepGenerations` (planRun.ts:185) | solo de rebote | no |
| Node run | `runs` Map (nodecore/action.ts:55) | nunca | no |
| Grafo | `node.data.generationId`, escrito al terminar (flow/actions.ts:345) | sí | no: `nodeIsCurrent` exige `done` (freshness.ts:71) |
| Retry / Regenerate | ninguno (relinkAttempt.ts:24, actions.ts:322) | — | solo avisa la UI |

Consecuencia: tras recargar o reintentar, cada capa reconstruye «qué falta» con su dato. Si ese dato no coincide con lo que dice el registro de envíos, el resultado es un doble envío (p9 H1/H2: `graphToSteps` reenvía un nodo ya enviado y todavía sin `done`) o un bloqueo (p9 H3-H6). Además no hay clave de idempotencia: el `reqId` nace en cada intento (jobs.ts:236, 312) y no viaja al proveedor, y nadie comprueba un envío anterior antes de mandar.

Hallazgos que explica: unos 22 (historial causas B y E; p9 entero).

### 2. Hay muchas puertas hacia el mismo envío de pago y cada una pone sus reglas

El transporte es uno (providerFetch.ts:26). En cambio, el tope, la autorización y el candado se aplican en cada entrada:

- `assertWithinLimit` solo existe en `createGeneration` (jobs.ts:56) y se salta con `stepApproved`/`batchStepApproved`.
- Las relanzadas por 402 (credit.ts:262, 334) no pasan por él: tienen su propio mecanismo de pases (budget.ts:245).
- Las llamadas LLM (turnModelCall.ts:71, planSettings.ts:206) no tienen marca de envío ni ledger; el gasto se anota después.
- Los comandos de pago comprueban `budgetProblem` con `ctx.budgetPass`, pero la tarjeta que los aprueba comprueba sin pase (commandCalls.ts:247 frente a actions.commands.ts:247).
- El candado es por ruta: `runInNodes`, `regenerate`, `approveNodeRun` y el 402 lo tomaban o no por separado.

Es la causa dominante del historial (unos 24 hallazgos, causas A y D). `commitPaidSend` y `budgetVerdict` ya fueron un paso hacia una puerta única, pero solo los usan algunas rutas.

### 3. El precio no es un dato único de la acción aprobada

Para la misma acción el precio se calcula hasta en cuatro sitios, que pueden discrepar:

- el estimate guardado en la tarjeta;
- el que recalcula el comando;
- `requestEstimate` con `memoryOnly` y `operationFactor` en el envío;
- el quote del adaptador.

Hay más fuentes de discrepancia:

- Los quotes no se persisten (mergePersistedState.ts:7), así que tras recargar se usa el precio de catálogo.
- `remainingBudget` (budget.ts:21) no reserva lo que está en vuelo, y dos aprobaciones simultáneas pueden pasar las dos.
- `0` significa a la vez «gratis», «desconocido» y «aún sin anotar». Aparece en al menos 6 sitios (historial causa C, unos 11 hallazgos).

### Por qué cada arreglo abre otro frente

Cada parche añade otra deducción local en la capa donde apareció el fallo: `wouldRun`, `pendingEstimate`, `stepProgress`, la limpieza de `stale`. La siguiente ruta no la tiene, y la nueva deducción puede bloquear gasto legítimo: un 15 % de los hallazgos son falsos bloqueos nacidos de un arreglo anterior. Mientras las tres causas sigan, el número de casos crece con rutas × estados de recarga × tipos de precio.

## Decisiones del usuario que cualquier rediseño respeta (no se vuelven a preguntar)

- La app no inventa topes; respeta el que pone el usuario; precio honesto, «estimado» cuando no es exacto (memoria spending-is-users-call; ADR 0004).
- Con límite activo, un precio desconocido pregunta en todas las puertas; `$0` nunca para (2026-10-29, 2026-11-20; historia 071).
- Registro de envíos (diseño C, historia 072): guardar antes de cada POST de pago, con tope de 8 s; un incierto nunca se reenvía sin confirmar; lo local y gratis no pasa por la puerta.
- Al recargar no se envía nada sin el usuario; lo pendiente se aprueba con un clic; lo ya enviado sigue su curso y nunca se reenvía (historia 074).
- Auto-cambio de proveedor por saldo: preguntar, siempre o nunca; con `always`, solo mismo modelo y precio igual o menor (historia 070, ADR 0025).
- Crítico = promesa rota: nunca gastar más de lo mostrado, una alerta nunca dice algo falso (pendientes.md:5).

## Dos arquitecturas candidatas

Las dos cierran la causa 2 con una única puerta de envío de pago y una regla de comprobación que impide llamar al transporte de pago desde otro sitio. Se diferencian en dónde vive la identidad de lo aprobado (causa 1).

### A. Ticket de aprobación durable

Toda acción de pago, venga de donde venga (tarjeta, plan, nodos, Retry, 402, LLM), crea antes de nada un **ticket** persistido con: id, huecos de envío (cada uno con su id estable), precio máximo aprobado y estado por hueco (pendiente, enviado, dudoso, hecho, fallido).

- `paidSend(ticket, hueco)` es la única puerta. Rechaza un hueco que no está pendiente, reserva el presupuesto mientras está en vuelo, marca durable, envía con el id del hueco y libera o anota al terminar.
- Las tarjetas, planes y nodos *leen* el ticket. `stepProgress`, `stepStates` y el `runs` Map desaparecen o pasan a ser vistas derivadas.
- Tras recargar, «qué falta» = huecos pendientes del ticket. Un nodo cuenta como «ya enviado» si tiene un hueco de ticket no fallido.
- El precio de la acción es el del ticket (causa 3): uno, persistido, con `desconocido` explícito en vez de `0`.

Coste: hay que migrar todas las rutas a crear tickets. Es un cambio grande, pero sustituye mecanismos (no se conservan los viejos, memoria no-backcompat-until-stable).

### B. Puerta única y consulta única sobre el registro que ya existe

Se mantiene la aprobación por flujo, pero:

- `paidSend()`, que extiende `commitPaidSend`, es la única puerta, incluidas las relanzadas por 402 y las llamadas LLM: tope con reserva en vuelo, marca durable y candado único.
- Una sola consulta, `sendStateOf(generación | nodo | paso)`, sobre `g.sends`. Todas las capas (replay, graphToSteps, Retry, Regenerate) la usan en vez de sus registros propios.
- `node.data.generationId` se escribe al **enviar**, no al terminar, para que el grafo vea lo que está en vuelo.

Coste: menor y más gradual. Queda la aprobación por flujo (causa 1 a medias): la tarjeta y el plan siguen guardando qué pasos aprobaron y hay que mapearlos a generaciones.

## Siguiente paso propuesto: prototipo medido (memoria design-before-patching)

Implementar A y B, en ramas separadas, solo sobre el caso más difícil conocido: tarjeta de comandos con `n1 → n2`, recarga en vuelo y doble aprobación (p9 H1/H2), más un Retry de un dudoso. Medir en cada una:

1. los tests adversariales de p9 (haiku, neon, p9-replay-pending) y los de dinero (adversarial-envios, sonnet-dinero, sonnet-dinero-2) en verde, sin cambiar sus aserciones;
2. los campos de estado de «ya salió» que quedan (hoy, 5 registros);
3. las líneas añadidas y quitadas, y los archivos tocados;
4. un ataque adversarial corto de otro modelo sobre cada prototipo, contando los hallazgos.

Se elige con esos números. Mientras tanto, los parches de dinero de p9 quedan congelados: la rama task/p9-7 se conserva como evidencia y sus tests como red de casos.

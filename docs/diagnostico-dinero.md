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

## Arquitecturas candidatas

A y B cierran la causa 2 con una única puerta de envío de pago y una regla de comprobación que impide llamar al transporte de pago desde otro sitio. Se diferencian en dónde vive la identidad de lo aprobado (causa 1).

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

### C. El ticket de A, guardado en SQLite y aplicado en el proxy del servidor

Dos hechos del código hacen posible esta variante:

- **Todo envío de pago ya cruza el servidor local.** `providerFetch` (providerFetch.ts:26) va a `/x/store/proxy` (server/local-store.js:229 → server/provider-proxy.js), que añade la clave.
- **El servidor ya tiene SQLite** (server/store-sqlite.js, server/sqlite/; adoptado en `task/sqlite-adopt`, historia 067). Tiene transacciones y tablas `spend`, `gen_history` y `event_journal`. Falta migrar los datos reales, que necesita tu aprobación (pendientes.md:28).

Diseño:

- Tabla `paid_sends` (ticket, hueco, estado, precio aprobado y cobrado), con clave única por hueco.
- El cliente manda el id del hueco en una cabecera, como ya hace con `X-OGS-Target`. El proxy, en una transacción, solo reenvía si el hueco está `pendiente` y lo pasa a `enviado` antes de contactar al proveedor. Un segundo POST con el mismo hueco se rechaza (409) aunque el cliente tenga un fallo.
- La reserva de presupuesto vive en la misma transacción.

Qué gana frente a A:

- La red final es independiente del código del cliente: ninguna ruta nueva puede saltársela.
- La marca es atómica y no depende de la espera de 8 s de IndexedDB.
- Recargar no la borra.

Qué cuesta:

- Exige que los datos reales estén en SQLite, o una tabla propia que no dependa de esa migración. Hay que decidirlo contigo.
- Toca la persistencia protegida (regla 1 de AGENTS.md).
- En móvil y escritorio sin servidor local, la puerta tendría que vivir en la capa nativa equivalente.

SQLite resuelve la parte de **registro y persistencia** (causa 1 y la mitad de la 3: precio y reserva persistidos), pero no por sí solo la causa 2. Las rutas del cliente siguen teniendo que crear tickets en vez de decidir cada una, aunque la puerta del proxy convierte cualquier olvido en un rechazo y no en un doble cobro.

## Siguiente paso propuesto: prototipo medido (memoria design-before-patching)

Implementar A, B y C (C con una tabla propia, sin migrar datos reales), en ramas separadas, solo sobre el caso más difícil conocido: tarjeta de comandos con `n1 → n2`, recarga en vuelo y doble aprobación (p9 H1/H2), más un Retry de un dudoso. Medir en cada una:

1. los tests adversariales de p9 (haiku, neon, p9-replay-pending) y los de dinero (adversarial-envios, sonnet-dinero, sonnet-dinero-2) en verde, sin cambiar sus aserciones;
2. los campos de estado de «ya salió» que quedan (hoy, 5 registros);
3. las líneas añadidas y quitadas, y los archivos tocados;
4. un ataque adversarial corto de otro modelo sobre cada prototipo, contando los hallazgos.

Se elige con esos números. Mientras tanto, los parches de dinero de p9 quedan congelados: la rama task/p9-7 se conserva como evidencia y sus tests como red de casos.

## Revisiones (2026-11-22)

Informes completos en el bus de workers: `20261122-neon-opina-dinero.md` (Neon, código) y `20261122-sol-dinero-practicas.md` (GPT Sol, prácticas con fuentes web).

- **Coinciden** en: un ticket durable de lo aprobado; una sola puerta de pago con reserva en vuelo y tope de importe en todo pase; una regla de comprobación que impida pagar fuera de la puerta; un piloto antes de migrar todo.
- **Neon añade una causa 4:** el grafo se recompila al ejecutar. `graphToSteps` (flow/graph.ts:412) añade ancestros según `nodeIsCurrent` (freshness.ts:69-102), que depende de `status === 'done'`, de `modelRef` tras pasar al modelo de edición y de esquemas que no se persisten. Por eso el ticket debe congelar al aprobar los nodos ya expandidos y la secuencia completa, incluidos los pasos `write`.
- **Discrepan en C.** Sol la quiere como red final, citando a Stripe y PayPal, y señala la salida directa de providerFetch.ts:31. Neon la descarta con hechos del código:
  - el proxy es un relé ciego por el que también pasan POST que no cobran (saldo, sondeo, subidas);
  - corta el envío al proveedor si se cierra la conexión (provider-proxy.js:56);
  - no puede liquidar un LLM en streaming sin parsear SSE;
  - un segundo `.sqlite` queda fuera de `/export`.
- **Neon elige D:** A corregida (ticket con alcance congelado) más la puerta `paidSend` en el cliente; el ticket pasa a SQLite cuando se migren los datos. Sol deja como punto de extensión mover la puerta al lado nativo o del servidor.
- **Urgente en main, comprobado en el código:**
  - `beginOncePass` no tiene tope de importe (budget.ts:210);
  - `llmCallEstimate` sin precio devuelve $0.0001 y no «desconocido» (budget.ts:383);
  - `nodes.action.run` sin snapshot estima `usd: 0` (nodecore/commands.ts:74);
  - `generationId` del nodo solo se escribe al terminar (flow/actions.ts:345), y la recuperación no lo enlaza.
- **Prueba de elección:** la matriz de 6 escenarios de Neon sustituye a la de 4 medidas. Cubre recargas p9/p9c, «Allow this time» con subida de precio, Retry de un dudoso y lote parcial, reintento de Atlas más 402, dos envíos junto al tope, y LLM en streaming.

## Revisión cruzada y convergencia (2026-11-22)

Informes en el bus: `20261122-sol-critica-neon.md` y `20261122-neon-critica-sol.md`.

- **Sol pasa de C a D** después de comprobar en el código los hechos de Neon. Retira el segundo `.sqlite`, porque quedaría fuera de `/export` y sin transacción común con `spentUsd`.
- **Neon mantiene D y la amplía a D+** con cuatro aportes de Sol:
  - un precio con tres tipos (exacto, estimado y desconocido) y un máximo verificable; un estimado que es solo un mínimo (`lowerBound`) no cabe en el límite sin decisión del usuario, y hoy `budgetVerdict` lo ignora (budget.ts:144-155);
  - una reserva retenida mientras un envío esté `dudoso`, con liquidación idempotente: `addSpend` no deduplica hoy (store/spend.ts:13);
  - una interfaz única `PaidSendStore`, en cliente e IndexedDB hoy, enchufable mañana a `ogs.sqlite` o al lado nativo;
  - un simulador con corte después de que el proveedor acepte y antes de devolver el id, y con dos aprobaciones que compiten por el mismo saldo.

**Plan común (D+):**
- **Ticket durable.** Congela al aprobar la secuencia completa (incluidos `write` y `$N`), los nodos resueltos y el máximo.
- **Id de cada envío.** Se asigna al prepararlo, de modo que caben lotes y LLM.
- **Puerta `paidSend` en el cliente.** Sale de `commitPaidSend` y del `Generation.sends[]` actual. Lleva reserva en vuelo, tope en todo pase y candado único. Una regla de comprobación (`check-paid-send`) impide pagar fuera de ella.
- **Nodo ligado antes de enviar**, con su solicitud.
- **Fuera:** el proxy, la interfaz, `data/` y la persistencia protegida.

**Matiz pendiente.** Sol deja el LLM, los lotes y los reintentos para una segunda fase; Neon pide que el piloto los cubra desde el principio. El piloto incluye la matriz completa de 6 escenarios de Neon.

## Veredicto sobre D+ y versión final (2026-11-22)

Informes: `20261122-opus-propuesta-dplus.md` (la propuesta), `20261122-neon-veredicto-dplus.md` y `20261122-sol-veredicto-dplus.md`.

- **Neon:** de acuerdo con los 6 puntos. No aporta razones ni evidencia, así que cuenta como conformidad y no como comprobación.
- **Sol:** de acuerdo con 2, 4 y 5. En desacuerdo con 1, 3 y 6, con citas que se comprobaron en el código.

**Decisión de Opus, punto por punto:**

1. **Se defiende, con una aclaración.** El punto solo quita a `stepStates`/`stepGenerations` el papel de fuente de «ya salió». Siguen siendo el enlace a las salidas de un plan para reanudarlo (planRun.ts:385), y las generaciones antiguas sin `sends` siguen leyéndose por el camino heredado de sendLedger. Requisito explícito del piloto: ninguna salida ya entregada de un plan guardado se pierde. No hay dos registros de «ya salió».
2. **Sin cambios:** no hay interfaz enchufable hasta que exista un segundo backend.
3. **Se acepta la objeción.** La regla («se envía exactamente la vista previa aprobada; no se recalculan ancestros») no basta sola. El ticket guarda además la **secuencia completa**, incluidos los pasos `write` y los productores de `$N` (run.ts:134, 371; commandCalls.ts:164), como ya habían acordado Neon y Sol.
4. **Sin cambios:** un implementador, ataque del otro, matriz de 6 escenarios en verde y menos estado que hoy, o se para.
5. **Sin cambios:** prueba final con proveedor real y coste máximo aprobado por el usuario.
6. **Se acepta la objeción y se rehace el cuarto arreglo urgente.** Escribir `generationId` al empezar una regeneración oculta el resultado anterior si el intento falla (jobs.ts:74, graph.ts:334, flow/actions.ts:338). Lo nuevo: `generationId` sigue siendo el último resultado terminado. El intento en curso queda ligado aparte (la generación conoce su nodo) y lo enlaza también la recuperación (followRemote, allDelivered). `previewRun`/`graphToSteps` tratan como ocupado un nodo con un intento en curso o dudoso y no lo reenvían. Los otros tres urgentes no cambian.

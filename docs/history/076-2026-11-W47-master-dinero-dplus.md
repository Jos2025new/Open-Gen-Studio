# 076 · Dinero urgente, rediseño D+ y colocación p10 (sesión maestra 8, 2026-11-22/23)

Base `819ed2fc` → `main` en `c2238949` (aprobado por el usuario). Diseño del dinero en [diagnostico-dinero.md](../diagnostico-dinero.md); retro en `bus/20261123-neon-retro-sesion8.md`; transcript en `argon-input/sesion8/transcript-sesion8.md`. Evidencia del cierre, no estado actual.

## Objetivo

Nació para reatacar y fusionar **p9** y **p10**, los dos pendientes de la sesión 7 ([075](075-2026-11-W47-master-dinero-checks.md)). Al divergir los parches de p9 en tres rondas (2 → 6 → 10 hallazgos, 6 críticos), el usuario frenó el bucle y pidió diagnosticar las causas raíz del dinero. La sesión pasó a cerrar 4 agujeros urgentes en `main`, diseñar e implementar el núcleo **D+**, cerrar **p10** y analizar la colocación nodal estilo Blender.

## Qué quedó en `main` (`819ed2fc..c2238949`)

### Commits de integración

- `f43b5352` — `merge: task/piloto-dplus`: 4 arreglos urgentes de dinero (`991769f8`..`b680bf2b`), diagnóstico (`47c377da`), núcleo D+ (`f7f3d73a`..`58e3b749`), recarga local/gratis visible con Retry gratis (`5393ecd1`, `fe14b3a5`, `18557629`) y ajuste de espera de test (`5b739140`). Neto sobre `819ed2fc`: +1 481 líneas en `src/`+`scripts/` (81 archivos), +7 285 en `tests/` (99 archivos).
- `e476225a` — `merge: task/p10-7`: rejilla espacial, paneles de 350 px y zonas de clic de handles (`26bb8c69`..`8c9fa04d`). Neto: +491 en `src/`+`scripts/` (6 archivos), +619 en `tests/` (10 archivos).
- `7df693d2` y `a7e25f1c` — estabilidad de tests bajo carga de suite completa (`best of 3` en 200 soltados manteniendo el tope de 50 ms; espera de hasta 5 s en el reintento tras recarga local/remoto gratis, mismas expectativas).
- `c2238949` — `merge: history 075 (master session 7)`.

### Qué garantiza D+ (sobre los 4 arreglos urgentes)

- **Ticket por aprobación** (`src/engine/money/ticket.ts`): registro propio persistido (también para LLM, que no crea `Generation`). Congela al aprobar la secuencia completa —incluidos `write` y `$N`—, los nodos resueltos y precio tipado (`exact`, `lowerBound`/estimado, `unknown`; nunca `$0` para desconocido).
- **Puerta `paidSend` no rodeable** (`paidSend.ts`, `storeBridge.ts`, `transport.ts`): único paso para media, operaciones especiales (`transcribe`, `createVoice`, `createStyle`), reintentos/sustitutos 402 y LLM (`turnModelCall.ts`, `planSettings.ts`). Candado único, marca durable con tope de 8 s antes del POST y clasificación fail-closed (`uncertain` exige `confirmedCharge`). Vigilada en `npm test` por `scripts/check-paid-send.mjs`.
- **Huella de la petición real** (`sendInputs.ts`, `transport.ts`, adaptadores): cada adaptador construye la petición con el mismo código para enviarla y para calcular su huella, comprobada antes del transporte (`COMMAND_REVIEW_CHANGED` si cambia algo tras aprobar). Pasos dinámicos congelan `staticAssets` (p. ej. máscaras) y los cambios de proveedor tras 402 conservan y reverifican la huella.
- **Pase único por paso** (`ticket.pass` + `budget.ts`): un solo motor de presupuesto (`budgetVerdict` alineado con `evaluateBudgetGate`); cada paso lleva tope propio, «Allow this time / Continue once» valida contra el importe aprobado (y en `lowerBound`, la cotización viva contra el presupuesto restante) y cierra su pase al terminar.
- **Reserva y liquidación idempotente**: reserva síncrona en vuelo y retenida en `uncertain` (`remainingBudget` resta reservas abiertas para frenar envíos concurrentes junto al tope) y `addSpend` idempotente por `sendId`.
- **Lo interrumpido visible con Retry gratis** (`fe14b3a5`, hallado por Haiku en sandbox, heredado de `main`): generaciones locales/gratis hacen *flush* best-effort (250 ms) antes de arrancar, no se reenvían solas tras recargar y salen automáticamente en `Failed` como `Interrupted` con botón de un clic `Retry · Free`, sin tocar la ruta de pago.
- **Base de urgentes**: tope en `beginOncePass`; LLM y `nodes.action.run` sin precio como «desconocido» (esperando catálogo LLM en el primer turno); `nodeAttempt` impide reenviar un nodo en vuelo sin ocultar el último `generationId` terminado.

### Qué aporta p10 (rejilla espacial, paneles y zonas de clic)

- **Rejilla espacial** (`src/engine/flow/graph-layout.ts`, `5b9ca450`, `e5822f3d`): `SpatialGrid` (celdas 512 px), caché `WeakMap`, anillos monotónicos, barrido 1D y esquinas cercanas; 200 tarjetas superpuestas o 200 soltados repetidos bajan de ~340 ms a **< 50 ms**.
- **Paneles** (`3b5fbb06`, `dcfefe8a`): `findFreePosition` y `settleFresh` reservan 350 px de alto del composer (`.nt-refs` + prompt máximo + fila modelo) y actualizan la zona al mover.
- **Zonas de clic** (`281a8ac5`, `80a0927a`, `837975b4`): `--rf-hit-zoom` (clamp `0.05`) mantiene 24 px en pantalla hasta zoom 0,05 y desplaza hacia fuera `.port`, `.nc-next` y `.nc-result` sin tapar el cuerpo de las tarjetas.

## Evidencia

### Verificado

- **Urgentes**: Sol implementó; Sonnet atacó dos veces (2 altos → 0, «fusionable sí»); `npm test` verde (5 074 pasan; 3 fallos por carga pasan 54/54 aparte).
- **Ataques a D+ y simplificación**: matriz de 6 escenarios con simulador de red/recarga (17/17 verde); auditoría KISS de Opus (`bus/20261123-opus-simplifica-dplus.md`: ~650–800 líneas accidentales por 3 coexistencias → recorte de +2 190 a +1 195 netas sobre urgentes); **8 ataques** (16 → 11 → 11 → 4 → 5 → 6 → 4 → 0 entre Sol, Hydrogen y Neon) hasta el cierre de Hydrogen (`5ebc5c5d`, `bus/20261123-hydrogen-comprueba-cierre.md`): **0 críticos, 0 bloqueos**, 3 notas menores.
- **`npm test` completo**: en D+ halló 39 regresiones en 14 archivos (4 bugs reales —el más serio: `onAgentCredit` sin freno de tope al cambiar tras 402— y 35 ajustes de preparación/firma a contratos fail-closed, sin relajar aserciones), arregladas por Neon (`58e3b749`, `bus/20261123-neon-regresiones-dplus.md`). Tras el fix de recarga local y los merges, los 3 tests con espera frágil bajo carga se ajustaron (`5b739140`, `7df693d2`, `a7e25f1c`) y `npm test` quedó en verde.
- **p10**: 5 ataques (4 Haiku + 1 Hydrogen con 7 hallazgos, 2 críticos de rendimiento), cerrados por Sonnet, el orquestador y Neon (`e5822f3d`, `8c9fa04d`); `npm test` en verde.
- **Sandbox (Haiku, usuario nuevo, gratis)**: `bus/20261123-haiku-sandbox-dplus.md` sobre `task/piloto-dplus` (`http://localhost:5183`, sin claves). Cazó la pérdida crítica de generación local al recargar, cubierta luego con 5 tests en `tests/local-reload-visible.test.ts` (`fe14b3a5`).

### No verificado

- **Prueba real con proveedor de pago: NO hecha.** Ningún camino de D+ (precio exacto/estimado/desconocido en pantalla, aviso de tope, Cancel, cobro o 402 real, recarga en envío real) se probó contra proveedor real. Requiere clave del usuario en el sandbox (`5183`) y modelo + coste máximo aprobado explícitamente ([ADR 0004](../decisions/0004-coste-maximo.md)).
- Tampoco se re-probó en navegador el fix de recarga local (`fe14b3a5`) ni «Warn after a reload during a send» (exige envío de pago).

## Qué se descartó

- **p9 (`task/p9-7`, 11 commits)**: congelado y absorbido por D+. Sus 3 rondas divergentes (2 → 6 → 10) confirmaron que parchear con 5 registros paralelos de «ya salió» abría un frente nuevo cada vez.
- **Arquitectura C en el proxy con SQLite** ([diagnostico-dinero.md](../diagnostico-dinero.md)): descartada por convergencia Neon↔Sol con hechos del código. El proxy (`/x/store/proxy`) es un relé ciego que recibe POST gratuitos (saldo, sondeo, subidas), corta al cerrarse la conexión (`server/provider-proxy.js:56`), no liquida SSE de LLM sin parsearlo y un segundo `.sqlite` queda fuera de `/export` y sin transacción con `spentUsd`. También se descartó `PaidSendStore` enchufable hasta tener un segundo backend.

## Pendientes concretos

1. **Prueba real con proveedor en sandbox**: con clave del usuario en `5183` y tope + modelo aprobados antes (precios exacto/estimado/desconocido, límite, Cancel, recarga en envío real).
2. **Decisión `nodes.node.add` y colocación estilo Blender**: decidir si `nodes.node.add` busca hueco o respeta posición explícita; regla de paneles (solo seleccionada vs. todas reservan; 2 `it.fails` en `tests/adversarial-haiku-p10d.test.ts`); y si adoptar el enfoque Blender (`bus/20261123-neon-blender-nodos.md`: colocar en cursor sin anti-solape, caché `WeakMap<Graph, GraphIndex>`, culling/LOD < 20 %, tope en mundo para hit-zones).
3. **Notas menores de cierre (Hydrogen)** (`bus/20261123-hydrogen-comprueba-cierre.md`): falso `COMMAND_REVIEW_CHANGED` recuperable en lote parcial tras 402 si cambia `maxCountPerRequest` (`sendInputs.ts:212` usa `count` total); `OVER_LIMIT` en `lowerBound` si la cotización viva supera presupuesto restante y mínimo inicial (`paidSend.ts:68`); `bindDynamicFingerprint` (`jobs.ts:97,224`) sin reintento en `specialSends.ts` para `transcribe` dinámico.
4. **Altos y medios del ataque final (Neon)** (`bus/20261123-neon-ataque-final-dplus.md`): *alto*: `scripts/check-paid-send.mjs:28-31` (`resolveTarget`) no limpia `?query`/`#hash` ni maneja `/src/...` (sin fuga real hoy); *medios*: `[write, spend]` fallido con `COMMAND_REVIEW_CHANGED` revierte `write` pero deja `state: 'done'` en el ticket; `approveNodeRunNow` (`planNodeRun.ts:29`) sin guardia para `runIds` vacío; `priceFromEstimate` (`ticket.ts:83`) ignora `unbounded` con `usd === 0`; `compactApprovalTickets` puede purgar `plan:<itemId>` en planes `error`/`partial`.
5. **Confirmación de gasto en reescritura automática**: decidir si `rewritePrompts` (`src/engine/agent/planSettings.ts`) debe pedir confirmación de gasto como un turno normal.
6. **Hallazgos menores de Haiku en sandbox** (`bus/20261123-haiku-sandbox-dplus.md`): chat sin LLM confuso en primer uso (responde «Estoy en modo local (sin LLM)» y no genera nada, alto UX); Local Sketch devuelve degradado genérico con sol/colinas sin relación con el prompt (medio; se suma a la falta de etiqueta «Free» y demás medios heredados de [075](075-2026-11-W47-master-dinero-checks.md) y 073 puntos 3–7).

## No repetir (reglas de la retro)

Fuente: `bus/20261123-neon-retro-sesion8.md` (13 h 45 m activos, 44 corridas CLI, 8 ataques sobre D+ y reintentos de suite completa).

1. **Parar a las 2 rondas y auditar diseño**: si el 2.º ataque halla ≥ 1 crítico de igual causa o no bajan los hallazgos, prohibido 3.er parche; auditoría de diseño obligatoria.
2. **Fusionar lo verde al momento**: rama con `npm test` verde y reataque limpio se ofrece a fusión enseguida (máximo 1 lista en cola; no retener ramas verdes como `urgente-dinero` y `p10`).
3. **Techo de piloto**: declarar tope de archivos/líneas netas en `src/` y qué borra; si crece sin borrar en revisión 1, frenar (D+ llegó a 81 archivos de `src/`/`scripts/`).
4. **`npm test` temprano y UNA vez, repitiendo solo los archivos que fallan**: correr `npm test` tras la 1.ª implementación; no diferirlo 7 rondas ni repetir toda la suite por 2–3 fallos puntuales.
5. **Verificar que los lanzamientos arrancan**: confirmar que cada worker arrancó de verdad (sin quedarse en cuota agotada, timeout sin informe, OOM ni aplazado sin lanzar); abrir informe antes de editar y exigir `archivo:línea` también en «de acuerdo».
6. **Roles fijos**: Neon, Sol y Opus diseñan y arreglan causas; Hydrogen y Haiku atacan y prueban sandbox.
7. **Cabecera de estado**: cada parte al usuario abre con `Objetivo | En main | Listo sin fusionar | Bloqueo | Siguiente`.

# 0031 — Núcleo de nodos: el estado vive en el nodo, un resolvedor, acciones explícitas

## Estado

Aceptado

Para la rama experimental `task/nucleo-nodos` (usuario, 2026-11-18): tiras 1 y 2 allí; el usuario la prueba antes de cualquier fusión.

## Fecha

2026-11-18

## Contexto

- **Lo que pide el usuario.** «Todo es un nodo», sin perder conexiones, con resolución sólida de conflictos, como Houdini, Blender o Maya. Cerrar el diagnóstico, construir bien los componentes que sostienen todo y dejar «las varillas» para que cada sección siguiente se amarre sin rehacer: depuración, continuidad, nuevas features y escala.
- **Lo que mostró el diagnóstico** ([tabla](../nucleo-nodos/diag-desacople.md), [revisión independiente de GPT 6.2 Sol](../nucleo-nodos/revision-desacople.md) y [del núcleo](../nucleo-nodos/revision-nucleo.md), comprobado en el código):
  - Los nodos del sistema espejan el estado global; casi no tienen efecto real.
  - Hay dos caminos para conectar: `tryConnect` desde la UI (`NodeWorkspace.tsx:449`) y `linkSystemNodes` desde comandos (`system.ts`); solo el segundo aplica modelo→agente.
  - La vista previa, la frescura y la ejecución resuelven entradas por rutas distintas (`freshness.ts:37`, `graph.ts:428`, `refText.ts:8`).
  - El ejecutor ignora los grupos (`graph.ts:345`); un `GraphGroup` es solo un marco.
  - Composer y `activeSessionId` globales como contexto implícito; el envío elige siempre el primer agente (`conversation.ts:31`, `runtimeShared.ts:108`, `llmTurn.ts:50`).
  - Registro de tipos cerrado: un tipo nuevo toca la unión, dos registros, los defaults y el menú.
- **Lección.** Inventariar la interfaz componente por componente no converge: cada revisión encuentra más. El fallo está en el núcleo; arreglándolo, envolver cada componente es mecánico.
- **Referencias.** Houdini registra dependencias y recalcula bajo demanda; Maya declara qué entrada afecta a qué salida y propaga la invalidación; Blender evalúa una copia en su contexto; ComfyUI reutiliza resultados según entradas y parámetros. Errores conocidos en [propuesta-contratos-puertos](../propuesta-contratos-puertos.md).

## Decisión

Siete piezas forman el núcleo. Cada una es una varilla: lo que venga después se apoya en ella sin cambiarla.

1. **Descriptor único por tipo de nodo.** Un archivo por tipo declara: parámetros (el estado del que el nodo es dueño), puertos tipados con id estable, `evaluate` puro, acciones explícitas, versión y migraciones. Un registro los recoge solo, como los comandos de [ADR 0030](0030-nucleo-de-comandos.md), y un check en `npm test` falla con archivo:línea si falta algo. Añadir un tipo es añadir un archivo.
2. **Identidad y direcciones.** Un puerto se direcciona por sesión, grafo, nodo y puerto, todos estables. Una referencia es *móvil* (sigue la vigente) o *fijada* (a una revisión), y se fija al preparar una acción. Una referencia rota queda visible como inválida, nunca borrada ni sustituida, y bloquea la acción si la entrada es obligatoria.
3. **Un resolvedor común.** Una sola función calcula las entradas efectivas de un nodo y sus revisiones; la usan la vista previa, la firma de frescura y la ejecución. La firma es tipo y versión, parámetros y entradas resueltas. Nada lee el store por fuera del resolvedor durante la resolución.
4. **Dependencias, frescura y ciclos.** Cada descriptor declara qué entradas afectan a qué salidas. Un cambio de parámetro, enlace o contenido invalida a los consumidores; se recalcula bajo demanda y el último resultado se muestra como desactualizado, sin regenerar solo. Los ciclos en dependencias evaluables se rechazan al editar y al preparar; los enlaces de control declarativos pueden ser bidireccionales.
5. **Edición con precondiciones.** Una sola capa de operaciones de topología y parámetros (conectar, desconectar, sustituir, editar) para UI, agente y comandos. Cada operación lleva la revisión esperada del dueño; si cambió, devuelve conflicto y conserva el borrador. En una entrada de un solo cable, la sustitución es parte de la operación y el cable anterior es su precondición. Conectar nunca dispara efectos. `baseAt` sigue protegiendo el guardado; no se toca la persistencia protegida.
6. **Acciones explícitas.** Generar o enviar es un comando con destino explícito (sesión, nodo), que consume una instantánea aprobada, recibe un id de ejecución y liga el resultado a su origen aunque cambie la vista. Un reintento reconcilia por id antes de reenviar: sin gasto duplicado. El coste y la confirmación siguen como hoy. Las claves nunca salen por un puerto.
7. **Un solo camino de escritura.** Los paneles existentes no cambian de aspecto: pasan a leer los parámetros del nodo dueño mediante el resolvedor y a escribir mediante la capa del punto 5. Cada campo que se incorpora pierde su segunda escritura en el mismo commit.

**Depuración desde el principio.** Un inspector por nodo muestra entradas resueltas, firma, motivo de «desactualizado» y última ejecución, con su id. Es una vista del resolvedor, no un sistema aparte. La traza existente registra cada operación del punto 5 y cada acción del punto 6.

**Space.** Por ahora sigue navegando como hoy y `GraphGroup` queda como marco de presentación. Encapsular un space como subnet evaluable, con nodos de Entrada y Salida que se normalizan a un plan plano para el mismo ejecutor, es una decisión aparte, después de la tira 2. El diseño de los puntos 2 a 4 ya lo admite: los ids externos se corresponden con Entrada y Salida internas, y los ciclos se validan a través de la frontera.

## Orden: tiras verticales

1. **Texto → generación, en Omni, con los controles actuales.** Sirve para demostrar los puntos 1 a 6. Aceptación (proveedor simulado): una edición actualiza la vista previa; invalida el resultado y la aprobación anteriores sin generar; una ejecución aprobada queda ligada a su sesión al cambiar de vista; un reintento no duplica el gasto; borrar el destino deja el cable visible como inválido.
2. **Chat con dos agentes.** Destinatario, historial, pendientes y LLM por instancia. Resuelve que hoy responda siempre el primero.
3. **Space como subnet**, si se aprueba.
4. **El resto de componentes**, uno a uno con la misma receta. El inventario de cada uno se hace al envolverlo.

## Cómo se revisa

Contra este contrato, no contra la completitud del inventario. Cada regla de los puntos 1 a 7 se convierte en un check o un test. GPT ataca cada tira con tests adversariales. Un hallazgo que no rompa una regla del contrato se apunta en pendientes y no frena la tira.

## Alternativas

- **Seguir con el inventario por componente** (tanda del 2026-11-18): descartada; no converge y cada revisión abre más filas.
- **Tipos de nodo nuevos pieza por pieza** (tanda del 2026-11-17): descartada; produjo espejos y el envío a varios agentes nunca funcionó.
- **Space como subnet evaluable desde ya:** aplazada; cambia el significado de los cables actuales y conviene decidirla tras la tira 2.

## Consecuencias

- Añadir un nodo, un puerto o una acción es un archivo y sus tests; el check del registro lo exige.
- Hay que migrar de forma explícita los datos de prueba que cambien de forma. No hay compatibilidad hacia atrás hasta tener una versión estable.
- Los dos caminos de conexión y escritura desaparecen campo a campo; mientras tanto, el check marca los que quedan.
- Queda fuera de este ADR: puertos propios y cables entre ventanas (paso 13), JSON, CLI y MCP externos, y el diseño visual de cualquier pieza nueva.

## Decisiones del usuario pendientes

- Aprobar este contrato.
- Aprobar el cambio de la primera tira: texto → generación primero y dos agentes después (propuesta de GPT; la sesión maestra está de acuerdo).
- Space: decidir más adelante si encapsula o solo navega (recomendado: decidir después de la tira 2).

## Notas de implementación

Ajustes que obligó el código al construir las piezas 1 a 5 (rama `task/nucleo-nodos`):

- **Código.** `src/engine/nodecore/`: `descriptor.ts` y `types/<tipo>.node.ts` (punto 1; `registry.ts` los recoge con `import.meta.glob`; `scripts/check-node-descriptors.mjs` en `npm test`), `address.ts` (2), `resolver.ts` (3), `deps.ts` y `guard.ts` (4), `edit.ts` y `revision.ts` (5).
- **Revisión del dueño.** Se calcula (resumen de los parámetros del nodo y de sus cables, sin `generationId` ni `sketchAssetId`); no se guarda, así que no hay migración. Un resultado terminado no cuenta como edición.
- **Cable fijado.** `GraphEdge.pin` (opcional): la revisión de la fuente a la que se fijó. Si la fuente ya entrega otra, la entrada es inválida. Las referencias se fijan al preparar la acción (punto 6), no al conectar.
- **Cable inválido.** `Graph.broken` guarda el cable cuya **fuente** se borró y cuyo consumidor sigue; el resolvedor lo devuelve como entrada inválida y bloquea la acción solo si el puerto es `required` en el descriptor. Se retira al recablear el puerto, al volver la fuente o al borrar al consumidor. **Desviación:** al borrar el *destino* del cable no se deja marca: el cable pertenece al nodo que lo posee y se va con él (las tarjetas separadas de `arrange.ts` son destinos efímeros y no deben dejar rastro). La acción que nombraba un destino borrado se rechaza (punto 6).
- **Un solo commit de edición.** `tryConnect`/`connectNodes`, `linkSystemNodes`, `unlinkSystemNodes`, `patchNodeData`, `disconnectEdges` y `deleteNodes` llaman a `applyEdit`. Cada llamador sigue validando sus puertos; el reemplazo en entrada de un solo cable (cardinalidad del descriptor, no la tabla genérica del comando), el ciclo (datos y sujetos), los bloqueos y la traza están en la capa. Los dos llamadores internos pasan el cable que ocupa el puerto como precondición; un cliente externo debe pasar `replaces`/`expect` para tener conflicto real.
- **Efecto de conectar.** La copia modelo→agente de un enlace de control es copia de parámetros (sin red ni coste) y ahora la hace la capa para los dos caminos. Conectar nunca llama a un proveedor.
- **Pantalla.** Que `broken` se dibuje como cable inválido en el lienzo es decisión visual pendiente (identidad protegida): hoy solo lo ven el resolvedor y el inspector.

### Tira 2: chat con dos agentes (implementación)

- **Destinatario.** `sendAgentMessage(texto, { agentNodeId })`; sin nombre, el que fija el nodo chat (`recipient`, dato del nodo) y, si no, el primer agente conectado (lo de siempre). Un id que no es un agente da un aviso, nunca otro agente. `agentEngine`, `messageMeta` y `llmTurn` reciben el id; sin id usan el agente activo de la sesión.
- **Estado por instancia.** `session.agent` sigue siendo el estado del agente activo (todo lector actual funciona); los demás quedan aparcados en `session.agentLanes` (`agent/lanes.ts`). Cambiar de destinatario aparca el estado actual (historial, tarjetas abiertas, notas, petición) y carga el del destino. El primer agente al que se escribe hereda la conversación que ya tuviera la sesión. Se comparten `settings`, `switchedTo` y `enhance` (elecciones del trabajo, no del agente). Las acciones de una tarjeta traen primero el estado del agente dueño.
- **Límite.** Un turno a la vez por sesión: con un agente trabajando no se puede cambiar a otro (aviso). Un trabajo en paralelo de dos agentes no entra.
- **Controles nuevos (pedidos por el contrato).** El nodo agente tiene un selector de modelo (`setAgentLlm`) y el nodo chat un selector «To» cuando hay dos o más agentes conectados. No cambian las tarjetas existentes; el aspecto de los dos controles es provisional.

### Correcciones de la revisión de GPT (hallazgos 1 a 3)

- **Cables rotos.** Cada cable roto conserva su identidad (`Graph.broken`): otro cable en el mismo puerto ya no lo oculta. Solo lo retiran: borrar al consumidor, volver la fuente, desconectarlo explícitamente, o recablear un puerto de un solo cable del mismo tipo. También se marcan los enlaces `ref` y `control`. Sigue sin dibujarse en el lienzo (decisión visual pendiente) y borrar al consumidor se lleva su cable (desviación ya anotada).
- **Plan desde el resolvedor.** `graphToSteps` descarta los cables cuya fijación (`pin`) ya no coincide: no se ejecutan ni se pasan al proveedor; si el puerto es obligatorio, la guardia bloquea. La firma de la aprobación incluye la versión del descriptor y la revisión y validez de cada entrada; la firma de frescura incluye la revisión de una fuente cuyo contenido se revisó (los resultados guardados no cambian).
- **Ejecutar pasa por el registro.** Los botones Run de nodo y de lote usan `runApproved`: un id por confirmación, ligado a su aprobación. Un id conocido nunca reenvía, tampoco tras un fallo (puede haber llegado al proveedor); reintentar exige una aprobación nueva y un id nuevo. Un id de otra aprobación se rechaza.

### Correcciones de la revisión de GPT (hallazgos 4 a 6)

- **Tarjetas al dueño.** Toda acción de tarjeta (aprobar, responder, comentar, editar) entra primero en el agente dueño (`claimLaneOfItem`); si no puede (otro agente trabaja) avisa y no cambia nada. Los controles de comentario pasan el agente dueño.
- **Turno reservado.** `sendAgentMessage` marca el turno ocupado antes de la primera espera (adjuntos) y lleva sesión, chat y agente hasta historial, proveedor y feed (`messageMeta`, `engineLabel`, `agentEngine`). El puerto de un agente lee su última respuesta por autor (los datos antiguos sin autor siguen yendo al primero).
- **Destinatario.** Uno guardado y desconectado no se sustituye: el selector muestra «Not connected — choose one» y el envío avisa. El `Composer` del nodo chat pasa el id de su chat.

### Correcciones de la revisión de GPT (hallazgos 7 y 8)

- **Una sola vía de edición.** `expect` es obligatorio en `nodes.edit.connect/set`; `replaces` con un cable ya ausente es conflicto; `ownerRev` incluye los cables rotos; `set` rechaza ciclos por `subjects`; la operación nueva `add` cubre «crear conectado»; `setAgentLlm` y `addConnected` usan `applyEdit`; el tipo de enlace Modelo→Agente arrastrado se infiere igual que en el comando.
- **Registro e inspector.** `affects: false` en un puerto evita invalidar al consumidor; el inspector enseña la última ejecución del nodo (`lastRunFor`); `check-node-descriptors` exige `migrate` si `version` > 1.
- **Sigue abierto.** `NodeKind` sigue cerrado y las direcciones completas siguen siendo ayudas (los cables usan ids locales); el inspector no tiene panel; el registro de acciones vive en memoria.

### Correcciones de los tests adversariales (10 fallos)

- **Dinero.** La aprobación que adopta la interfaz incluye destino y `force` en su id; una aprobación cuyo envío falló no se reenvía con un `runId` nuevo (hay que preparar otra).
- **Conexiones.** Pegar conserva el `pin` del cable; restaurar omite el cable que cerraría un ciclo (también por sujetos); el historial cuenta `broken` como cambio; `replaces` que nombra un cable de otro nodo es conflicto.
- **Edición.** `nodes.node.edit` acepta `expect` (revisión leída). Sin él solo vale para un nodo que un comando del mismo llamador creó o editó y que nadie ha tocado desde (revisión igual a la recordada); si no, se rechaza.
- **Agentes.** Un destinatario guardado y desconectado siempre bloquea; `agentSeesImages(sesión, agente)` usa el modelo del agente elegido; `lastRunFor(sesión, nodo, generación)` liga el resultado a la ejecución que lo produjo (`ActionRecord.generationIds`).

### Causas de raíz del revisor Neon

- **Una sola vía de escritura.** Fuera de `nodecore/edit.ts` nadie llama a `setGraph`: `scripts/check-graph-writes.mjs` (en `npm test`) falla con archivo:línea. La capa añade `compound` (cambio compuesto: ningún cable entre nodos vivos desaparece si no se nombra en `dropped`; sin ciclos ni cables colgantes), `present` (posición, grupos: no toca datos ni cables) y `travel` (deshacer/rehacer y reversión de una secuencia). `nodes.node.edit` exige `expect`, es estricto y no cambia `kind`; los comandos de conectar nombran el cable que sustituyen (`replaces`). Excepción mantenida: `flow/dropResults.ts`, un reductor dentro del borrado atómico de assets.
- **Aprobaciones de un solo uso.** Una aprobación paga un envío, acabe bien o mal; reintentar es preparar y aprobar de nuevo (cada confirmación de la interfaz es una aprobación nueva). `nodes.run.start` y la aprobación de un plan de nodos pasan por el registro. Un cable fijado a una revisión terminada no vuelve a ejecutar la fuente. El inspector atribuye un resultado solo a la ejecución que produjo esa generación (sin caída a otra) y muestra aparte el último intento (`lastAttempt`).
- **Agentes.** El fin de un plan, la reescritura de prompts y la edición o borrado de un mensaje escriben en el agente dueño (`patchLane`), también aparcado; un chat sin agente conectado bloquea el envío; las respuestas llevan el chat de origen. Sigue abierto: el estado vivo se intercambia por carriles (`session.agent` = el activo) en vez de un mapa por id.
- **Direcciones y registro.** Se quitaron `portAddress/addressKey/parseAddress` (nadie las usaba) y las claves de pins son estructuradas. 
- **Registro abierto y migraciones.** Añadir un tipo de nodo es un archivo `nodecore/types/<kind>.node.ts` que declara sus datos por fusión (`declare module … { interface ExtraNodeKinds { <kind>: Datos } }`; `ExtraSystemTypes` para partes del sistema): `NodeKind`/`SystemNodeType` = base + extras y `graphTypes.ts` no cambia. El dato de un nodo lleva `v` (versión del descriptor con que se escribió; ausente = 1); `nodecore/migrate.ts` lo sube paso a paso (`migrate[n]`: n → n+1) al cargar (`merge` del store) y la capa de edición sella `v` en los nodos nuevos. `check-node-descriptors` exige una migración por cada subida de versión y acepta un tipo fuera de la unión base si su archivo lo declara. Tests: `nodecore-registry`. Las partes del sistema (`SYSTEM_NODE_TYPES`, resolvers de `nodes/spec.ts`) siguen siendo registros exhaustivos: solo su tipo es abierto.

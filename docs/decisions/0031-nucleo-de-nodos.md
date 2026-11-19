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

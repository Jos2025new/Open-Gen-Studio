# 068 · Sesión maestra 2026-11-18/19: núcleo de nodos (ADR 0031) en rama experimental

Rama `task/nucleo-nodos` (worktree `ogs-nucleo-nodos`, desde `task/sqlite-adopt`), sin push ni fusión. El usuario la prueba antes de fusionar nada.

## Recorrido

1. **Diagnóstico de puntos de desacople** (Sonnet, solo lectura): una tabla de entradas y salidas por componente ([diag-desacople](../nucleo-nodos/diag-desacople.md)).
2. **Revisión independiente** (GPT 6.2 Sol, [revision-desacople](../nucleo-nodos/revision-desacople.md)): la tabla vale como mapa, pero no para programar. Faltan puertos y el núcleo tiene dos caminos de cableado y un ejecutor que ignora los grupos.
3. **Cambio de enfoque** (sesión maestra, aprobado por el usuario): dejar el inventario, que no converge, y fijar un contrato de núcleo. GPT revisó la propuesta ([revision-nucleo](../nucleo-nodos/revision-nucleo.md)) y propuso 7 cambios. El resultado es el [ADR 0031](../decisions/0031-nucleo-de-nodos.md).
4. **Cadena que pidió el usuario:**
   1. Sonnet (subsesión) construyó las piezas 1 a 7 y las tiras 1 y 2.
   2. GPT encontró 8 fallos ([revision-commits-nucleo](../nucleo-nodos/revision-commits-nucleo.md)) y Sonnet los corrigió.
   3. GPT escribió tests adversariales: 10 fallos reales en 24 ([adversarial-nucleo](../nucleo-nodos/adversarial-nucleo.md)). Los reparó un subagente Sonnet.
   4. Suite completa en verde: 4208 tests.
5. **Prueba de usuario nuevo** (Haiku, sandbox): nada roto, pero tampoco demostró lo nuevo. No hubo generación ni segundo agente.
6. **Defectos visuales que vio el usuario**, arreglados y aprobados (`452f100f`, `38a13278`):
   - los puertos de los nodos de space flotaban fuera de la tarjeta (`.nc` con ancho fijo dentro de un envoltorio de 320 px);
   - el buscador de «Add connected node» era una caja metida en otra;
   - la barra de copiar y borrar quedaba lejos del nodo y con una sombra intensa.
7. **Gemini 4 Neon** (High), crítica y tests adversariales: 27 fallos reales en 32, después de dos rondas de GPT ([informe-neon](../nucleo-nodos/informe-neon.md)). Comprobado en el código. La causa era de estructura:
   - quedaban 34 escrituras del grafo por fuera de la capa única;
   - el estado de los agentes se intercambiaba entre ellos;
   - una aprobación se podía usar más de una vez.
8. **Arreglo de raíz** (Sonnet, a petición del usuario: «de raíz», no parchear los 27):
   - una sola vía de escritura, con `check-graph-writes` en `npm test`;
   - aprobaciones de un solo uso;
   - estado por agente;
   - registro de tipos abierto, con migraciones al cargar;
   - `commitSystemGraph` nombra los cables que quita.

   Los 27 tests de Neon pasan.
9. **Avisos y cables inválidos:** se leyó el código fuente de Blender 5.2.3 ([blender-avisos](../nucleo-nodos/blender-avisos.md)) y se encargó un boceto visual.

## Decisiones del usuario (vigentes)

- **Núcleo:** «todo es un nodo». El estado vive en el nodo y los paneles son vistas de sus parámetros. Las siete piezas del ADR 0031 son la base, y el space como subnet se decide más adelante.
- **Arreglos:** de raíz, nunca parche por parche. Un hallazgo que no rompe el contrato va a pendientes y no frena la tira.
- **Avisos a escala** (aprobado 2026-11-19):
  - solo el origen se marca fuerte, con el tirador en rojo, un icono de prohibido y «Se requiere …»;
  - los nodos afectados quedan apagados con «Bloqueado por …» e «Ir al origen»;
  - un contador «N problemas» con una lista que salta a cada nodo;
  - un space o grupo cerrado muestra el recuento de lo que tiene dentro;
  - un cable fijado cuyo origen cambió es un aviso ámbar, con «Usar el valor nuevo» o «Mantener el fijado».

  De Blender se copia: tres niveles con el icono del más grave, el cable inválido en rojo con su motivo, los avisos que suben al grupo y la búsqueda por texto de aviso. Lo que se evita: borrar cables cuando desaparece un socket.
- **Corrección del usuario al boceto** (2026-11-19, manda sobre lo anterior). La regla es pocos mensajes, y solo cuando algo es inválido de verdad:
  - **Textos solo al pasar el ratón.** El color y el icono se ven siempre; nunca hay cajas de texto abiertas en el lienzo.
  - **Puerto incompatible:** no se deja soltar el cable. Junto al cursor aparece un aviso breve, «Este puerto no admite texto», y no queda ningún estado de error.
  - **Borrar un nodo uno mismo no es un error.** El cable se va (con «Deshacer» en el aviso de borrado) y no se dibuja ningún cable rojo. Si esa entrada era obligatoria, solo se pone en rojo el puerto que se quedó sin nada, con «Falta el prompt» al pasar el ratón.
  - **Editar el origen uno mismo no es un error.** Por defecto, un cable sigue el valor vigente y lo de abajo solo queda desactualizado, como ya ocurre. Fijar un cable es una acción explícita y rara. Si el origen de un cable fijado cambia, basta con una marca discreta en el cable; al pasar el ratón ofrece «Usar el valor nuevo · Mantener el fijado». Nunca sale una ventana.
  - **Cable rojo solo si el cable existe pero no puede funcionar.** Por ejemplo, cambiar el modelo deja un puerto con otro tipo.
  - **Se mantienen** el resumen «N problemas» con su lista y la insignia de recuento en un space o grupo cerrado.
- **Arreglos visuales de los nodos de space, el buscador y la barra:** aprobados tal cual.
- **Paralelismo por agente** (decidido en 0, recogido en el ADR 0031 el 2026-11-19): cada agente lleva su turno; dos pueden trabajar a la vez. La corrección de borrado y los avisos de arriba ya están también en el ADR.

## Reveses y su causa

- **«Hecho» antes de tiempo.** Tras GPT y una suite en verde di el núcleo por hecho, y Neon sacó 27 fallos más. Los tests en verde probaban lo que había, no el contrato.
- **Decisiones propias de un subagente** para no romper tests viejos: la edición sin `expect` en un nodo propio y la caída del inspector a la última ejecución. Neon las refutó y se quitaron.
- **Afirmaciones sin verificar.** Describí Blender de memoria y no era exacto: no pone en rojo la cabecera del nodo, pone un icono.
- **`pkill -f` con un patrón amplio** mató el propio shell al detener el sandbox.
- **La suite se paró dos veces** en `tsc`, por un cast en un test de GPT, y en `check-sizes`, porque `flow/actions.ts` creció.
- **La PC se apagó de noche** porque alguien desconectó el cable. No se perdió nada: cada parte tenía su commit.

## Revisión externa de la sesión (Sonnet sin contexto, 2026-11-19)

La sesión maestra comprobó en el código los dos primeros puntos.
- **Grave, en zona protegida.** `src/store/writerHandoff.ts:14` cuenta una sesión como ocupada solo con `s.agent.busy`, es decir, solo el agente en pantalla. Con agentes en paralelo (`b07c5090`), un agente ocupado en segundo plano no frena el traspaso del bloqueo de escritor. Arreglarlo exige autorización expresa y revisión independiente. La alternativa es volver a «un turno a la vez por sesión», que es lo que dice el ADR.
- **El ADR se contradice con la rama.** El ADR 0031 (línea 88) dice «Un turno a la vez por sesión… un trabajo en paralelo de dos agentes no entra», y `b07c5090` hace lo contrario. Además, el ADR no recoge todavía la corrección del usuario sobre borrar un nodo uno mismo, y sigue diciendo «Aceptado» y «Aprobar este contrato» a la vez.
- **Otros lectores de `agent.busy`** siguen mirando solo al agente en pantalla: `retryAgentTurn` (`conversation.ts:297`), `messageEdit.ts:39,54,87`, `HomeBar.tsx:15`, `Composer.tsx:245` y `FeedList.tsx:68,139,227`.
- **El estado por agente es parcial.** Hay dos copias, `session.agents[id]` y la proyección `session.agent`, que se sincronizan (`store.ts:461-468`). `lanes.ts` todavía comparte `settings`, `switchedTo` y `enhance` entre agentes.
- **Los checks son débiles.** `check-graph-writes` busca por regex y lo esquivan alias o un `setState`; `dropResults.ts` es una excepción. `check-node-descriptors` solo comprueba que aparezcan ciertas palabras. El nodo `ref` agrupa todos los nodos de sistema, cuyos puertos siguen en `nodes/spec.ts`. El render, el menú y `SYSTEM_NODE_TYPES` siguen cerrados: «añadir un tipo es un archivo» vale para el descriptor, no para el nodo entero.
- **Migraciones.** Se registran por efecto lateral (`setLoadMigration`), y si `migrate.ts` no se ha importado antes de rehidratar, no migra (no verificado). Migrar datos reales necesita aprobación y una copia previa; hoy solo existe la tubería.
- **Registro de acciones en memoria.** Tras recargar, se olvida qué aprobaciones se gastaron.
- **El arreglo de raíz no tiene revisión independiente.** `compound`, `present`, `travel` y las aprobaciones solo los ha probado quien los hizo (regla [done-needs-another-model]).
- **Recortes de alcance que no se dijeron:**
  - el inicio y fin de space, que la 067 llama «la manda», quedó aplazado;
  - las piezas sin nodo de la 067 (board, log de generaciones, ajustes, layer, paneles de Designer, historial de prompts) no están nombradas;
  - otros pendientes de la 067: imagen de doc y library, nodos no idempotentes, la prueba de Argon en el sandbox, el panel de exportación, el idioma, A3-A6 y B1-B2.
- **Decisiones sin aprobar:**
  - `nodes.node.edit` exige `expect`, y el contexto del agente no lo menciona;
  - los selectores «To» y de modelo del agente tienen un aspecto provisional;
  - borrar el destino no deja marca;
  - un chat sin agente bloquea el envío.
- **Archivos cerca de 30 KB:** `map-contracts.md` (29 960 B), `map-contracts-2.md`, `informe-neon.md`, `flow/actions.ts` (31 121 B, por encima de 30 KB y por debajo de su base), `store.ts` y `Composer.tsx`.
- **Visión:** el inspector no tiene panel y nadie ha medido el resolvedor con grafos grandes.

Sugerencias, por impacto:
1. Arreglar los lectores de `busy`, o prohibir los turnos en paralelo hasta que el usuario decida.
2. Que el usuario decida sobre los agentes en paralelo, y alinear el ADR.
3. Pasar al ADR la corrección sobre cables y borrado.
4. Importar `migrate.ts` desde el arranque y probar una carga con datos viejos.
5. Revisión independiente del arreglo de raíz, y suite completa después.
6. Mantener anotados los recortes de alcance de arriba.
7. Endurecer `check-graph-writes` y `check-node-descriptors` antes de llamar «mecánica» a la siguiente tanda.

## Revisión de Neon al informe externo (2026-11-19)

Gemini 4 Neon revisó el informe de Sonnet: [revision-neon-externa](../nucleo-nodos/revision-neon-externa.md). Acierta en los síntomas, exagera cuatro puntos (`retryAgentTurn` ya reclama carril; los recortes sí se aprobaron; `nodes.node.edit` sí recibe `expect`; el registro en RAM no reusa aprobaciones al recargar) y se queda corto en lo grave. La sesión maestra comprobó en el código tres puntos:
- **Doble gasto:** `approveNodeRun` (`agent/planRun.ts:118-130`) espera `prepareNodeRun` con la tarjeta aún en `awaiting`, sin el candado `planRuns`, y crea un `uid('run')` nuevo: un doble clic puede cobrar dos veces.
- **Escape de la capa única:** `deleteGeneration` (`engine/actions.ts:516`) escribe `graph` con `useStore.setState` y `check-graph-writes` no lo ve.
- **Lentitud:** `RunButton` (`nodes.tsx:60`) y `RunAll` (`NodeCanvasParts.tsx:44`) se suscriben al store entero.
Sin comprobar aún: la corrupción cruzada entre agentes en paralelo (`llmTurn`/`conversation` escriben sin `owner`, `turnChats` único por sesión, `reopenCard`, `stopAgent`). Suite completa tras el arreglo de raíz: 600 archivos y 4244 tests en verde (no cubre nada de lo anterior).

## Pendiente, en orden

0. **Decisión del usuario sobre agentes en paralelo** (`ddf27bcb`; `b07c5090` solo cambió tests). Recomendado por ambos revisores: volver a un turno por sesión, como dice el ADR, y evitar la zona protegida (`writerHandoff.ts:14`). Si se aprueba paralelo: autorización para `writerHandoff.ts`, `owner` en todo `llmTurn`/`conversation`/`runtimeShared`/`spec`/`reopenCard`/`stopAgent`, y revisión independiente.
1. Cerrar el doble gasto: candado antes del `await` en `approveNodeRun`, `runId` estable por tarjeta, y gastar la aprobación al intentar enviar (`action.ts:113`).
2. Cerrar escapes del núcleo: `deleteGeneration` por `edit.ts`, `expect`/`replaces` en `nodeTools.ts`, validar `broken` en `compoundProblem`, revisar `silent: true`, y `check-graph-writes` multilínea o por AST.
3. Rendimiento: quitar `useStore(s => s)`, acotar `snapshots`/`ledger`, evitar `[...feed].reverse()` en `resolver.ts:56`.
4. Importar `migrate.ts` desde el arranque, con un test `v1 → v2`.
5. ADR 0031: quitar «Aprobar este contrato», alinear 87-88 con lo decidido en 0, añadir la corrección de borrado y la decisión de avisos.
6. Rehacer el boceto de avisos con la corrección del usuario (ver «Decisiones»), aprobarlo e implementarlo.
7. Revisión independiente de 0-4 y suite completa una vez.
8. Prueba del usuario en el sandbox, con una clave de proveedor: una generación real y dos agentes.
9. Decisión sobre el space: subnet o solo navegación; envolver el resto de componentes.
10. Fusionar o no `task/nucleo-nodos`; entonces actualizar `pendientes.md` (con `067:66-69`) y `docs/map.md`.

## Lecciones

- **Nada está hecho sin un revisor distinto del que lo construyó.** La suite no es evidencia del contrato. Antes de decir «hecho», un modelo distinto lo ataca: aquí, GPT y después Neon.
- **Un subagente no toma decisiones de diseño por su cuenta.** Si un test viejo choca con el contrato, lo reporta en vez de añadir excepciones.
- **Lo que dice cómo lo hacen Blender, Houdini u otros se verifica en el código o en sus documentos antes de usarlo.**
- **Para detener procesos**, por pid tras `readlink /proc/<pid>/cwd`, nunca con `pkill -f`.
- **Worktrees con `node_modules` enlazado:** `VITE_CACHE_DIR` en la carpeta y `systemd-run` con tope de memoria.
- **Modelos:**
  - GPT: `codex exec -m gpt-6.2-sol -s workspace-write --disable use_legacy_landlock`.
  - Gemini: `agy-run.sh <wt> <log> <brief> complejo gemini-4-neon-high`, con `VITE_CACHE_DIR` exportada.

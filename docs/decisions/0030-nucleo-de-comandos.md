# 0030 — Núcleo de comandos: un registro, dos entradas, un paso de deshacer por historial

## Estado

Aceptado

El usuario aprobó el [plan revisado](../propuesta-todo-es-un-nodo-plan.md) y dio la orden de empezar el paso 1 el 2026-11-13. En `task/commands` están el núcleo (paso 1) y el Designer con las dos herramientas del agente (paso 2). La interfaz todavía no llama a los comandos: sigue llamando a las acciones.

## Fecha

2026-11-13

## Contexto

- **Lo que pide el usuario.** Que todo lo que la app sabe hacer sea un comando, usable igual desde la interfaz, el agente, un CLI interno y, más adelante, un CLI externo o MCP ([propuesta](../propuesta-todo-es-un-nodo.md)).
- **Lo que hay.** Unas 100 acciones repartidas en cuatro módulos, sin registro común. El agente tiene 22 herramientas escritas a mano; en el Designer solo 3.
- **Lo acordado antes de escribir código** (usuario, Opus y Fable, 2026-11-12): solo JSON, sin lenguaje de texto; `aliases`; `available()` con motivo; eco de los últimos comandos; validar solo en la frontera; destino explícito; un paso de deshacer por historial tocado; índice automático.

## Decisión

El núcleo vive en `src/engine/commands/` y no importa nada de la app.

| Archivo | Qué tiene |
|---|---|
| `types.ts` | `CommandSpec`, `Target`, `Call`, `Sequence`, `RunResult`, `CommandError`, `defineCommand` |
| `registry.ts` | `register`, `command` (por id o alias), `findCommands`, `availability`, `argsSchema` |
| `run.ts` | `invoke` (código tipado), `run` (frontera), referencias `$n`, aprobación |
| `history.ts` | Adaptadores de historial y transacciones |
| `echo.ts` | Los últimos 50 comandos |
| `collect.ts`, `index.ts` | Índice automático |

### Un comando

`id` (`designer.layer.add`), `title`, `description`, `aliases`, `args` (zod), `effect`, `needs`, `history`, `available`, `debt`, `run`. El resultado debe ser un dato que sobreviva a JSON.

- `available(ctx, args?)` devuelve `true` o el motivo. Sin argumentos responde por el destino en general (una lista, la paleta); con ellos, por esa llamada concreta («No layer "x" in this document»).
- `debt` dice qué le falta al comando para cumplir el contrato (lee algo «activo» por dentro). El check del paso 4 lo lista.
- `effect: 'delete'` es solo para lo que no se puede deshacer. Borrar capas es `write`: vuelve con deshacer.

### Dos entradas al mismo registro

1. **`invoke(spec, args, on)`**: para botones, atajos y el final de un gesto. No valida argumentos (el código ya está tipado) ni pide aprobación (el usuario acaba de pulsar). Devuelve lo que devuelve el comando: síncrono si el comando lo es. Lanza lo que el comando lance.
2. **`run(llamada, { caller })`**: la frontera, para el agente, el CLI y fuera. Valida todo con zod, pide aprobación, nunca lanza y devuelve `{ ok, results }` o `{ ok: false, error: { code, message, step }, results, rolledBack }`.

Medido: `invoke` añade 0,82 µs por llamada sobre un comando vacío (20 000 llamadas, `COMMANDS_BENCH=1`). Un fotograma son 16 600 µs.

### Reglas

1. **Destino explícito.** Quien llama resuelve el destino y lo pasa en `on` (`session`, `doc`, `node`). Ningún comando lee «el doc activo» por dentro. `needs` dice qué partes de `on` son obligatorias. Así el agente actúa sobre un doc que no está en pantalla.
2. **Secuencias.** `{ seq: [...], on }` con un máximo de 40 pasos. `"$1"` es el resultado del paso 1 y `"$1.layer.id"` un campo suyo; solo como cadena entera, para no perder el tipo. `"$$1"` es el texto «$1».
3. **Todo lo comprobable se comprueba antes del primer paso:** que cada comando exista, que las referencias apunten hacia atrás, y los argumentos y el destino que no dependen de una referencia.
4. **Deshacer.** Cada comando declara los historiales que toca (`designer:<doc>`, `nodes:<sesión>`). Cada apartado registra un adaptador con `begin(id)` que devuelve `commit` y `rollback`. Una llamada o una secuencia abre una transacción por historial y la cierra al acabar: un paso de deshacer en cada uno. No hay historial global. Un comando que llama a otro sobre el mismo historial se une a la transacción abierta.
5. **Una secuencia es todo o nada** en sus historiales: si un paso falla, vuelven a como estaban. El gasto ya hecho no se deshace; `results` dice qué pasos corrieron.
   - **Excepción: si la secuencia esperó, no se deshace.** Mientras un paso espera de verdad (decodificar una imagen, una descarga), el usuario puede editar el mismo doc; volver atrás borraría su cambio junto con los del agente. En ese caso los cambios se quedan como un solo paso de deshacer y el resultado lo dice en `kept`, con `rolledBack: false`.
   - «Esperó» se decide sin adivinar: un paso que termina dentro de las microtareas de su turno no dejó correr nada más, y se deshace igual que uno síncrono. Entre dos pasos síncronos no hay espera alguna.
   - Vale también para `invoke` con un comando asíncrono que falla.
6. **Aprobación por `effect`.** `spend` y `delete` piden aprobación cuando no llama la interfaz; desde fuera (`external`), `write` también. Se pregunta una sola vez por secuencia, con todos los pasos que la necesitan. Sin nadie que pregunte, se rechaza.
7. **Eco.** Cada comando deja `{ cmd, args, on, caller, ok, ms, at, error, seq }` en un anillo de 50. Los argumentos se guardan por referencia: un comando recibe identificadores, nunca píxeles.
8. **Índice automático.** `index.ts` reúne con `import.meta.glob` cada `commands.ts` y cada `*.commands.ts` de `src/` y registra su export `commands`. Un id o alias repetido falla al cargar y dice en qué archivo está el primero.

### Convención de archivos

`commands.ts` junto a cada `actions.ts`. Donde ese nombre ya existe o choca, `<nombre>.commands.ts`:

- `src/engine/fx/fxCommands.ts` contiene las operaciones FX; los comandos registrados viven en `src/engine/design/fx.commands.ts`.
- Los comandos de `src/engine/actions.ts` no pueden ir en `src/engine/commands.ts`: `import '../commands'` dejaría de llegar a la carpeta del núcleo. Van en `src/engine/actions.commands.ts`.

## Designer y agente (paso 2, 2026-11-13)

### Las 39 acciones

`DESIGNER_ACTIONS` (`src/engine/design/commands.ts`) dice, para cada función exportada de `actions.ts`, qué comando la ejecuta o por qué no es uno. Un test la mantiene completa: no se puede añadir una acción sin decidir.

- **32 acciones → 30 comandos**: 12 de documento (`designer.doc.*`, en `commands.ts`) y 18 de capa (`designer.layer.*`, en `layer.commands.ts`). Ninguna acción se reescribió.
- **7 no son comandos**: `mutateDoc`, `addDoc`, `assetCanvas`, `canvasToAsset`, `noticeSkippedLayer`, `prunePicks` y `applyLayerStep`. Reciben o devuelven una función, un documento entero o un canvas, o son fontanería de otra acción.
- Todos reciben el destino en `on` (`session`, `doc`). Una acción devolvía `null` y avisaba con un toast cuando no hacía nada; su comando lanza el motivo, para que quien llama lo lea.

### Deuda (5 comandos)

| Comando | Qué lee por dentro |
|---|---|
| `designer.doc.ensure` | El doc activo de la sesión |
| `designer.doc.from_asset` | Cambia el apartado en pantalla |
| `designer.layer.add` | Va encima de la capa activa del doc; el texto toma el estilo de la herramienta |
| `designer.layer.place_asset` | `new` y `replace` dependen de la capa activa del doc |
| `designer.layer.ensure_paint` | Depende de la capa activa del doc y no registra deshacer |

Solo el primero lee el doc activo. Los demás dependen de la capa activa del doc, que es estado de ese doc y no de la pantalla.

### Deshacer

`openHistoryGroup(docId)` en `src/engine/design/history.ts`: mientras el grupo está abierto, el primer `record()` es el paso de deshacer y los siguientes no añaden nada. Al fallar, `revert()` devuelve píxeles, selección y documento al estado inicial y quita ese paso. El adaptador `designer` está en `commandKit.ts`.

### Agente

Dos herramientas, en `src/engine/agent/commandTools.ts` y `commandCalls.ts`. Desde 2026-11-14 llegan a las 7 áreas y se ofrecen en todos los espacios de trabajo (antes: solo `designer.*` y solo en el Designer).

- `find_commands { area?, text? }`: sin `area` ni `text` responde un índice (una línea por área: `área (n) — para qué sirve`). Con alguno, una línea por comando, `id {argumentos} — qué hace [needs the user's approval…] [not now: motivo]`. Un área desconocida devuelve el índice. La línea de contexto nombra el doc en pantalla solo si hay uno.
- `run_commands { seq }`: la secuencia sobre la sesión del agente; los pasos del Designer actúan sobre el doc en pantalla, salvo que un paso nombre otro en `on.doc`. El agente no puede nombrar otra sesión.
- **Ocultos al agente** (`AGENT_HIDDEN` en `commandCalls.ts`; no se listan y `run_commands` los rechaza con el motivo, sin ejecutar nada): `models.composer.pick`, `models.composer.reset`, `models.agent.pick`, `models.agent.reset` y `skills.skill.select`, `skills.workflow.select` (los elige el usuario); `sessions.select`, `sessions.new`, `sessions.archive` (llevarían al usuario a otra sesión a mitad del turno del agente).
- **Gasto y borrado:** no hay quien apruebe, así que fallan con `denied`. El listado los marca y la respuesta dice que hace falta la aprobación del usuario y que no se ejecutó nada. Eso cambió con el paso 7: ahora piden aprobación (ver «Aprobación con coste y límite»).

Las herramientas anteriores (nodos, Designer, generación) no cambian. Las guías `app:designer`, `app:nodes` y `app:canvas` ganan una línea.

### Medido (`COMMANDS_BENCH=1`, mejor de cinco rondas)

| Qué | Acción directa | Por el registro |
|---|---|---|
| `designer.layer.select` (sin deshacer) | 1,4–2,6 µs | `invoke` 1,9 µs |
| `designer.layer.set` (con deshacer) | 3,7 µs | `invoke` 5,4–5,9 µs |
| Una llamada por la frontera (`run`) | — | 15 µs |

| Lo que lee el modelo | Caracteres |
|---|---|
| Las dos herramientas, en cada turno | 1 319 |
| Una herramienta por comando (30), en cada turno | 12 376 |
| Lista de `find_commands`, solo cuando la pide | 4 463 |

### Cumplido

- El agente encadena tres comandos del Designer en una llamada, con un solo paso de deshacer (`tests/designer-commands.test.ts`, con el modelo simulado).
- `invoke` añade unos 2 µs con el adaptador real: por debajo de los 5 µs fijados.

## El resto de apartados (paso 5, 2026-11-14)

Envoltura mecánica, sin reescribir ninguna acción. El agente llega a todo esto por `find_commands` y `run_commands` (ver «Agente»).

### Nodes

- `NODES_ACTIONS` (`src/engine/flow/commands.ts`): **23 acciones → 21 comandos** `nodes.*` (nodo, arista, orden y ejecución). `tryConnect` y `prepareNodeRun` no son comandos; la lista dice por qué.
- El destino es `on.session`; nodos y aristas van en los argumentos. `hasTarget` (`commandKit.ts`) rechaza antes de ejecutar un nodo o una arista que no existe.
- Deshacer: historial `nodes:<sesión>`. `openHistoryGroup` en `src/engine/flow/history.ts` hace de una llamada o secuencia un solo paso del grafo y respeta la fusión de 700 ms por clave. Al fallar, el grafo vuelve con `patchSession`.
- `nodes.run.start` es `spend`: sin quien apruebe se rechaza (`denied`) y no se llama a ningún proveedor (test).
- **Deuda (4 comandos):**

| Comando | Qué queda |
|---|---|
| `nodes.node.new_data` | Lee el modelo y los ajustes del compositor para los valores por defecto |
| `nodes.node.add_connected` | Si la conexión se rechaza, la acción avisa y devuelve `null`; el comando solo dice que ninguna entrada encajó |
| `nodes.node.rename` | También renombra el asset del resultado; deshacer devuelve el título del nodo, no el nombre del asset |
| `nodes.node.set_sketch` | La copia sustituida se borra de la galería; deshacer no la devuelve |

- `nodes.run.start` prepara la ejecución dos veces: `runNodes` devuelve `null` sin motivo y el comando lo calcula antes para poder decirlo. Se quita cuando `runNodes` devuelva el motivo.

### Sesiones

- `SESSION_ACTIONS` (`src/store/commands.ts`): 7 funciones del store → 7 comandos `sessions.*` (`list`, `new`, `select`, `rename`, `pin`, `auto_title`, `archive`). Las sesiones no tienen deshacer: sin historial.
- `sessions.pin` recibe el estado deseado y no alterna si ya está así. `sessions.list` lee la sesión activa solo para marcarla.
- **Deuda (2 comandos):** `sessions.new` y `sessions.select` cambian la sesión en pantalla.
- Fuera: `deleteSession` (borra datos; va con su aprobación en otra pasada).

### Biblioteca y catálogo de modelos

- `LIBRARY_ACTIONS` (`src/engine/library.commands.ts`): las 8 funciones de biblioteca de `src/engine/actions.ts` → 8 comandos `library.*` (sujeto, hoja, estilo y voz). `library.style.create` y `library.voice.create` son `spend`; `library.subject.delete` es `delete`. Sin quien apruebe se rechazan y no se llama a `fetch` (test).
- `CATALOG_ACTIONS` (`src/engine/catalog.commands.ts`): de las 33 funciones exportadas de `catalog.ts`, 7 son comandos `models.*` (listar por tipo, leer un modelo, cargar catálogos, elegir o reiniciar el modelo del compositor y el del agente). Las otras 26 son ayudas internas. **`apiKeyFor` nunca es un comando**: devuelve un secreto.
- Sin historial: ni la biblioteca ni el catálogo están en deshacer.
- **Deuda (7 comandos):** `library.subject.from_sheet` recurre a la sesión activa si el asset no tiene sesión; `library.subject.from_attachments`, `library.style.create` y `library.voice.create` leen los adjuntos del compositor; `models.catalog.load`, `models.composer.pick` y `models.composer.reset` cambian el compositor en pantalla.
- Las acciones de hoja, estilo y voz se tragan el motivo del fallo: sus comandos solo pueden dar un motivo genérico.

### Studio y chat

- `STUDIO_ACTIONS` (`src/engine/actions.commands.ts`): cada función exportada de `src/engine/actions.ts` → un comando `studio.*`, la marca de que es de biblioteca, o por qué no es un comando. **23 comandos**: 6 `read`, 10 `write`, 4 `spend` y 3 `delete`.
- `spend`: `studio.generate.start`, `studio.generation.regenerate`, `studio.asset.run_op` y `studio.layer.run_op`. `delete`: `studio.generation.delete`, `studio.assets.delete` y `studio.session.delete`. Los siete se rechazan sin quien apruebe, con `fetch` bloqueado y el store intacto (test).
- No son comandos: `uploadFiles` y `attachFiles` (reciben `File`), `assetObjectUrl` (URL de objeto del navegador), `copyText` (portapapeles), `downloadAsset` (descarga) y `needsSpendCheck` (ayuda de presupuesto).
- Las dos estimaciones de operación (`studio.asset.estimate`, `studio.layer.estimate`) y `studio.model.prepare` son `write`: pueden pedir y guardar el esquema del proveedor.
- Cinco comandos actúan sobre la sesión en pantalla aunque reciban `on.session` (`studio.direct.check`, `studio.asset.estimate`, `studio.node.send_asset`, `studio.generate.start`, `studio.asset.run_op`). Si `on.session` no es la sesión en pantalla, se rechazan (`unavailable`): nunca generan en una sesión distinta de la nombrada.
- **Deuda (17 comandos, en `scripts/commands-debt/studio.json`)**, de dos clases:
  - leen la sesión activa, el compositor o la pantalla por dentro;
  - **la acción solo avisa con un toast cuando no hace nada, así que el comando puede responder bien sin haber actuado** (generar, regenerar, operaciones, borrar assets en uso, letras, editar en el compositor, usar como referencia). Se quita cuando esas acciones devuelvan el motivo.

### FX del Designer

- `FX_DO` (`src/engine/design/fx.commands.ts`): cada forma `do` de `FxCommand` → un comando `designer.fx.*` (`add`, `set`, `add_op`, `set_op`, `move_op`, `remove_op`, `delete`). Son 7, hechos con `docCommand` sobre `runFx`: mismo destino y mismo paso de deshacer que el resto del Designer. Como son `designer.*`, el agente ya llega a ellos por `run_commands`.
- `src/engine/fx/commands.ts` pasó a llamarse `fxCommands.ts`: tenía el nombre de la convención sin exportar `commands` y el índice lo saltaba. Ya no hay archivos saltados.
- **Deuda (1 comando):** `designer.fx.add` sin `above` va encima de la capa activa del doc.

### Skills, workflows y guías

- `SKILLS_ACTIONS` (`src/engine/skills/commands.ts`): 8 comandos `skills.*`: listar, leer y elegir skill; listar, leer y elegir workflow; listar y leer guías. Las otras 8 funciones exportadas de `src/engine/skills/` son ayudas internas o devuelven una tarjeta.
- Elegir recibe el estado deseado (`null` para quitar) y hace lo mismo que `AgentControls.tsx`: `setComposer`. Sin historial.
- **Deuda (2 comandos):** `skills.skill.select` y `skills.workflow.select` cambian la selección del compositor en pantalla.

### Sin comprobar

- Generar, regenerar u operar con un proveedor real. Crear estilos o voces con un proveedor real. Ejecutar nodos de verdad, y ambos apartados en el sandbox. Ninguno de estos comandos se llama aún desde la interfaz ni desde el agente.

## Check y prueba de humo (paso 4)

`node scripts/check-commands.mjs` comprueba los campos obligatorios, ids y alias únicos, esquemas estrictos, lecturas activas sin declarar y deuda nueva. Lista por área los comandos y su deuda, incluidos los archivos que no exportan `commands`. Una lectura activa legítima lleva una marca con motivo junto al código. Si desaparece o cambia deuda, revisa el resultado y ejecuta `node scripts/check-commands.mjs --update`; cada área tiene su propia línea base. `--self-test` prueba los rechazos del check.

`tests/commands-smoke.test.ts` genera argumentos desde los esquemas y comprueba los invariantes de documentos, grafos y sesiones. Rechaza el gasto y bloquea `fetch`. Lista las excepciones que necesitan navegador o píxeles. No prueba proveedores, resultados visuales ni todos los valores o secuencias posibles; un fallo distinto de argumentos o referencias puede ser una respuesta válida del comando.

## Alternativas

- **Una herramienta del agente por comando.** Descartada: 100 herramientas inflan el contexto y desorientan a los modelos débiles. El agente tendrá `find_commands` y `run_commands`.
- **Forma de texto con `|`.** Descartada: es un segundo lenguaje que mantener, y ni el agente ni MCP lo necesitan.
- **Validar siempre con zod.** Descartada: la interfaz ya está tipada y pagaría la validación en cada clic.
- **Historial global de comandos.** Descartada por ahora: el Designer y Nodes ya tienen el suyo, por documento y por grafo.
- **Secuencia que conserva siempre los pasos anteriores al fallo.** Descartada como regla general: deja el doc a medias. Se acepta solo cuando la secuencia esperó (regla 5), y entonces se avisa al agente de que lea el doc antes de seguir.
- **Bloqueo de escritura del doc durante la secuencia.** Aplazada: la interfaz aún no pasa por comandos y bloquear la entrada del usuario va contra su prioridad de no frenar.
- **Lista de archivos de comandos escrita a mano.** Descartada: varias sesiones añadiendo apartados en paralelo chocarían en ese archivo.

## Consecuencias

- `invoke` no aplica los valores por defecto del esquema; `run` sí. Un esquema con `.default()` se comporta distinto en cada entrada: los comandos no deben usarlo.
- Dos comandos asíncronos que se solapan sobre el mismo historial acaban en un solo paso de deshacer. Regla del plan: nunca dos escrituras a la vez sobre el mismo destino.
- El adaptador del Designer (paso 2) tiene que agrupar las llamadas a `record()` de sus acciones en una sola. `history.ts` del Designer no está en [persistencia protegida](../persistencia-protegida.md); si el adaptador necesitara tocar una zona protegida, se para y se pide autorización.
- La puerta externa no existe. `caller: 'external'` solo fija la regla de aprobación; [seguridad](../seguridad.md) sigue rechazando peticiones de fuera.
- **Crear y borrar documentos queda fuera de deshacer**, como en la app: una secuencia que falla no quita el doc que creó.
- `designer.doc.delete` es `delete`: desde el agente pide la tarjeta de aprobación.
- En una secuencia, un paso con gasto cuyos argumentos llevan `$n` llega al aprobador sin resolver: la tarjeta no puede mostrar el coste real. Lo resuelve el paso 7.
- Si el usuario edita el doc mientras una secuencia del agente espera, su cambio cae en el mismo paso de deshacer que los del agente. Nunca se pierde (regla 5), pero un Ctrl+Z quita ambos. Separarlos pide un bloqueo de escritura por doc o que la interfaz pase por comandos; queda para el paso de ventanas.
- **Sin comprobar:**
  - Los comandos que tocan píxeles (`place_asset`, `flatten`, `merge_down`, `rasterize`, `to_asset`, `replace_pixels`, `place_above`, `ensure_paint`, y `add` o `duplicate` de una capa raster): node no tiene canvas. Los tests cubren capas vectoriales y de texto.
  - El agente con un modelo real, y todo ello en el sandbox.
  - El índice dentro de la app compilada: `canvasCalls.ts` ya lo importa, pero solo se ha ejecutado en vitest.

## Aprobación con coste y límite (paso 7)

- Una sola tarjeta por secuencia (`CommandApprovalCard`, mismo estilo que el plan). Antes de preguntar, `run` ejecuta los pasos que no gastan ni borran y cuyos `$n` ya se pueden resolver, para que los pasos de gasto lleven sus argumentos reales; si el usuario no aprueba, o algo falla, se deshace el estado (`takeStateSnapshot`). El total suma las estimaciones de los pasos `spend` (`sumEstimates`); un precio desconocido hace el total aproximado.
- Borrar pide aprobación sin coste. Sin límite activo, o por debajo de él, hay un solo botón «Approve».
- Al tope del límite la solicitud queda retenida salvo que el usuario elija: «Allow this time» (solo esta secuencia, `beginOncePass`), «Allow for the whole session» (`allowForSession`) o «Don’t ask again until next session» (`dontAskUntilNextSession`). No hay modo automático y la app no inventa topes.
- «Don’t ask again until next session» (decisión del usuario, 2026-11-14): vale mientras el chat abierto sea el mismo; termina al abrir un chat en otra sesión, al cambiar el límite o cuando el usuario lo apaga («Ask again» en Ajustes → Budget, fila «This session»). La regla está en `untilNextSessionStillHolds` (`src/engine/budget.ts`).

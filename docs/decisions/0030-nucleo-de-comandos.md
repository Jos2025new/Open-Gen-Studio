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
6. **Aprobación por `effect`.** `spend` y `delete` piden aprobación cuando no llama la interfaz; desde fuera (`external`), `write` también. Se pregunta una sola vez por secuencia, con todos los pasos que la necesitan. Sin nadie que pregunte, se rechaza.
7. **Eco.** Cada comando deja `{ cmd, args, on, caller, ok, ms, at, error, seq }` en un anillo de 50. Los argumentos se guardan por referencia: un comando recibe identificadores, nunca píxeles.
8. **Índice automático.** `index.ts` reúne con `import.meta.glob` cada `commands.ts` y cada `*.commands.ts` de `src/` y registra su export `commands`. Un id o alias repetido falla al cargar y dice en qué archivo está el primero.

### Convención de archivos

`commands.ts` junto a cada `actions.ts`. Donde ese nombre ya existe o choca, `<nombre>.commands.ts`:

- `src/engine/fx/commands.ts` ya existe y no es un archivo de comandos. El índice lo salta porque no exporta `commands` y lo deja en `collected.skipped`, que el check del paso 4 listará como deuda.
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

Dos herramientas, en `src/engine/agent/commandTools.ts` y `commandCalls.ts`:

- `find_commands { area?, text? }`: una línea por comando, `id {argumentos} — qué hace [not now: motivo]`.
- `run_commands { seq }`: la secuencia sobre el doc en pantalla, salvo que un paso nombre otro en `on.doc`. El agente no puede nombrar otra sesión.

Las 22 herramientas anteriores no cambian. La guía `app:designer` gana una línea.

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

## Alternativas

- **Una herramienta del agente por comando.** Descartada: 100 herramientas inflan el contexto y desorientan a los modelos débiles. El agente tendrá `find_commands` y `run_commands`.
- **Forma de texto con `|`.** Descartada: es un segundo lenguaje que mantener, y ni el agente ni MCP lo necesitan.
- **Validar siempre con zod.** Descartada: la interfaz ya está tipada y pagaría la validación en cada clic.
- **Historial global de comandos.** Descartada por ahora: el Designer y Nodes ya tienen el suyo, por documento y por grafo.
- **Secuencia que conserva los pasos anteriores al fallo.** Descartada: deja el doc a medias y el agente no sabe en qué estado quedó.
- **Lista de archivos de comandos escrita a mano.** Descartada: varias sesiones añadiendo apartados en paralelo chocarían en ese archivo.

## Consecuencias

- `invoke` no aplica los valores por defecto del esquema; `run` sí. Un esquema con `.default()` se comporta distinto en cada entrada: los comandos no deben usarlo.
- Dos comandos asíncronos que se solapan sobre el mismo historial acaban en un solo paso de deshacer. Regla del plan: nunca dos escrituras a la vez sobre el mismo destino.
- La aprobación todavía no lleva coste. Llega con el nodo de comando (paso 7 del plan).
- El adaptador del Designer (paso 2) tiene que agrupar las llamadas a `record()` de sus acciones en una sola. `history.ts` del Designer no está en [persistencia protegida](../persistencia-protegida.md); si el adaptador necesitara tocar una zona protegida, se para y se pide autorización.
- La puerta externa no existe. `caller: 'external'` solo fija la regla de aprobación; [seguridad](../seguridad.md) sigue rechazando peticiones de fuera.
- **Crear y borrar documentos queda fuera de deshacer**, como en la app: una secuencia que falla no quita el doc que creó.
- `designer.doc.delete` es `delete`: desde el agente se rechaza siempre hasta que exista la tarjeta de aprobación (paso 7).
- En una secuencia, un paso con gasto cuyos argumentos llevan `$n` llega al aprobador sin resolver: la tarjeta no puede mostrar el coste real. Lo resuelve el paso 7.
- Si el usuario edita el doc mientras una secuencia del agente espera, su cambio cae en el mismo paso de deshacer.
- **Sin comprobar:**
  - Los comandos que tocan píxeles (`place_asset`, `flatten`, `merge_down`, `rasterize`, `to_asset`, `replace_pixels`, `place_above`, `ensure_paint`, y `add` o `duplicate` de una capa raster): node no tiene canvas. Los tests cubren capas vectoriales y de texto.
  - El agente con un modelo real, y todo ello en el sandbox.
  - El índice dentro de la app compilada: `canvasCalls.ts` ya lo importa, pero solo se ha ejecutado en vitest.

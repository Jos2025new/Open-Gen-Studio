# 0030 — Núcleo de comandos: un registro, dos entradas, un paso de deshacer por historial

## Estado

Aceptado

El usuario aprobó el [plan revisado](../propuesta-todo-es-un-nodo-plan.md) y dio la orden de empezar el paso 1 el 2026-11-13. Implementado solo el núcleo, en `task/commands`: ningún apartado tiene comandos todavía y la app no lo usa.

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

`id` (`designer.layer.add`), `title`, `description`, `aliases`, `args` (zod), `effect`, `needs`, `history`, `available`, `run`. El resultado debe ser un dato que sobreviva a JSON.

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

## Cómo sabremos si funcionó

- Paso 2: las 39 acciones del Designer como comandos, y el agente encadena tres en una llamada.
- El coste por llamada sigue por debajo de 5 µs con el adaptador real del Designer.
- Ningún comando del Designer necesita leer el doc activo; el que lo necesite lo dice en `available()` y cuenta como deuda.

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
- Sin comprobar: el índice dentro de la app compilada (solo en vitest), porque nada lo importa todavía.

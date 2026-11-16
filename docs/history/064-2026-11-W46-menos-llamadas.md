# 064 — Menos llamadas del agente con `run_commands` (2026-11-14)

Rama `task/agent-fewer-calls` ([ADR 0030](../decisions/0030-nucleo-de-comandos.md)).

## Diagnóstico de la prueba real (`ses_mwgpedm876izixcbsj`, Claude Haiku 5.5)

En la prueba real, dos peticiones sencillas necesitaron **8 llamadas al modelo y 26,4 s** (5 llamadas y 18,4 s en Designer; 3 llamadas y 8,0 s en Nodes):

1. **Ronda extra de descubrimiento (`find_commands`) en Designer (llamada 1, 2,3 s) y en Nodes (llamada 1, 2,3 s):**
   - El prompt de sistema no incluía las firmas de los comandos y [commandTools.ts](../../src/engine/agent/commandTools.ts) ordenaba llamar a `find_commands` antes de `run_commands` cuando no se conocieran los ids o argumentos.
   - Además, `designer.fx.add` en [fx.commands.ts](../../src/engine/design/fx.commands.ts) no indicaba qué operaciones pertenecen a `filter` (`blur`, `brightness`, `contrast`…) frente a `effect` (`glow`, `shadow`, `flare`), lo que consumió 1 151 tokens de razonamiento (5,2 s) en la llamada 2.
2. **Fallo por `on.doc` y partición en dos llamadas en Designer (llamadas 2 y 3, 7,6 s + 1,9 s):**
   - Sin documento previo en pantalla, la llamada 2 envió los 6 pasos en una sola secuencia (`designer.doc.new`, `designer.layer.add_text`, `designer.layer.set`, `designer.layer.add_shapes` ×2, `designer.fx.add`) sin `on` en los pasos 2–6 y falló en la validación previa con `Step 2 failed (target): designer.layer.add_text needs on.doc. Nothing ran.`
   - La descripción de `run_commands` decía `unless "on" names another one (ids from designer.doc.list)`: no explicaba que `on` acepta `"$1.doc"` (ni el esquema admitía el atajo `"on": "$1.doc"` como cadena), ni [commandCalls.ts](../../src/engine/agent/commandCalls.ts) propagaba `"$1.doc"` a los pasos posteriores cuando un paso previo crea el documento en pantalla (`designer.doc.new`, `designer.doc.ensure`, `designer.doc.from_asset`).
   - Tras el error, el modelo tampoco supo que podía referenciar `"$1.doc"` en la misma llamada, así que ejecutó `designer.doc.new` en solitario en la llamada 3 y el resto de pasos en la llamada 4.

## Qué cambió y qué llamadas desaparecen

- **Catálogo estático de comandos en el prompt cacheado** (`commandCatalog()` en [commandCalls.ts](../../src/engine/agent/commandCalls.ts) e inyección en `agentSystem()` de [llmTurn.ts](../../src/engine/agent/llmTurn.ts)): los 86 comandos visibles con su firma en una línea (`id {args} — descripción`) van en el bloque de sistema con `cache_control: { type: 'ephemeral' }`, sin estado de sesión ni `[not now: …]`, manteniéndose idéntico byte a byte entre llamadas. **Desaparecen la llamada 1 de Designer y la llamada 1 de Nodes (`find_commands`).**
- **Destino `"on": "$1.doc"` explícito e implícito** ([commandTools.ts](../../src/engine/agent/commandTools.ts) y [commandCalls.ts](../../src/engine/agent/commandCalls.ts)):
  - `runCommandsSchema` acepta tanto `"on": "$1.doc"` como `"on": { "doc": "$1.doc" }` (rechazando cualquier clave ajena como `session`).
  - `runCommandsTool` propaga automáticamente `on: { doc: "$<i>.doc" }` a los pasos siguientes que requieren `doc` y omiten `on` cuando un paso anterior crea el documento en pantalla (`designer.doc.new`, `designer.doc.ensure`, `designer.doc.from_asset`), y añade una pista con `"on": "$1.doc"` si un paso falla por falta de `on.doc`.
  - **Desaparecen las llamadas 2 y 3 de Designer (el fallo `needs on.doc` y el `designer.doc.new` separado), quedando fundidas con la llamada 4 en una única llamada a `run_commands`.**
- **Tipos de filtro y efecto en `designer.fx.add`** ([fx.commands.ts](../../src/engine/design/fx.commands.ts)) y guías de espacio ([designer.md](../../src/engine/skills/app/designer.md), [nodes.md](../../src/engine/skills/app/nodes.md), [canvas.md](../../src/engine/skills/app/canvas.md)): `designer.fx.add` enumera los `filter` (`blur` incluido) y `effect` (`glow`, `shadow`, `flare`) en su línea del catálogo.

| Petición de la evidencia | Antes | Ahora | Llamadas que desaparecen |
|---|---|---|---|
| Designer («Cartel» 1080×1350 + texto «Titular» + rectángulo + círculo + desenfoque) | 5 llamadas (18,4 s) | **2 llamadas** (`run_commands` + respuesta) | Llamada 1 (`find_commands`), llamada 2 (fallo `needs on.doc`) y llamada 3 (`designer.doc.new` suelto) |
| Nodes (2 nodos conectados) | 3 llamadas (8,0 s) | **2 llamadas** (`run_commands` + respuesta) | Llamada 1 (`find_commands`) |

## Evidencia

- Tests en [designer-commands.test.ts](../../tests/designer-commands.test.ts) y [agent-commands.test.ts](../../tests/agent-commands.test.ts): reproducen las secuencias exactas de `ses_mwgpedm876izixcbsj` sin documento previo en pantalla (sin `on`, con `"on": "$1.doc"` y con `"on": { "doc": "$1.doc" }`) y en Nodes, verificando 2 llamadas al modelo por petición, 1 paso de deshacer y estabilidad byte a byte del prompt de sistema.

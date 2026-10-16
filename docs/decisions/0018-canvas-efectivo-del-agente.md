# 0018 — Canvas efectivo del agente y la herramienta open_board

## Estado

Aceptado

## Fecha

2026-10-15

## Contexto

El agente trabaja sobre un canvas (chat, node o designer) y sus herramientas y reglas dependen de él (`read_graph`, `edit_node` solo en node; `view_canvas`, `designer_fx` solo en designer). Con el tablero de Studio ([0017](0017-espacios-panel-y-tablero.md)) el usuario ve Nodes o el Designer sin salir del chat, así que el canvas que ve y el espacio de trabajo dejaron de coincidir. El agente debe poder, en la misma petición, abrir esa vista y usar las herramientas de ese canvas.

## Decisión

- **Canvas efectivo.** `agentCanvas()` = la vista del tablero (`node` o `designer`) cuando el espacio de trabajo es `chat` y el tablero está abierto en Nodes o Designer; si no, el espacio de trabajo. `sendAgentMessage` lo toma al empezar y `llmTurn` lo relee en cada puerta tras `open_board` y tras `continue_in_canvas`, `continue_in_designer` y `continue_in_chat` (antes quedaba obsoleto dentro del turno).
- **`open_board({view})`** (assets, nodes, designer o closed): solo en Studio (fuera, mensaje claro que nombra el canvas actual); fija la vista del tablero y no cambia `ui.workspace`; con Nodes responde con el índice del grafo. Está en `TOOLS`, por tanto en `CAPABILITIES`, en las guías de app y en el SYSTEM_PROMPT; la regla de visibilidad del contexto no se debilita. Va en `agentCanvas.ts` porque `context.ts`, `runtime.ts` y `tools.ts` no pueden crecer (ADR 0008).
- **No hay `read_board`.** La línea de contexto «You are in Studio (chat). The board shows: …» dice qué enseña el tablero; el agente lo fija, no lo consulta.
- **Etiquetado.** Los mensajes de un turno con tablero en Nodes o Designer se etiquetan con el canvas efectivo, y los planes mantienen `plan.workspace='node'` o `'designer'` y se ejecutan igual; el estado aparcado por canvas y las aprobaciones se apoyan en `item.workspace`. El chat de Studio muestra los mensajes de `chat` y los del canvas que enseña el tablero, con la insignia (decisión del usuario).

## Alternativas

- **Etiquetar siempre `chat`.** Descartada: habría que cambiar el estado aparcado por canvas y las aprobaciones, que usan `item.workspace`.
- **Que el agente cambie `ui.workspace`.** Descartada: arrastra el cierre automático de espacios y un salto de vista que el usuario no pidió.
- **Una herramienta de lectura (`read_board`).** Descartada: el contexto ya lo dice y cada herramienta más pesa en el mapa de capacidades.

## Consecuencias

- Una petición como «edita el keyframe» en Studio puede abrir Nodes y editar en el mismo turno (test con LLM simulado), pero solo con el tablero abierto en esa vista.
- Todo punto nuevo que lea el canvas del agente debe llamar a `agentCanvas()` en vez de leer `ui.workspace` o el parámetro del turno.
- Pendiente de ejecución real con un modelo del agente (sin gasto no se ha visto el agente elegir `open_board` por sí solo): [pendientes-gui.md](../pendientes-gui.md).

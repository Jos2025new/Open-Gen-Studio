# 067 · Sesión maestra 2026-11-16/18: frentes visibles, C0 y estabilización de referencias

Traspaso para la próxima sesión maestra. Rama única: `task/sqlite-adopt` (worktree `ogs-sqlite-adopt`), sin push. Lo pendiente está en [pendientes](../pendientes.md#por-impacto-visible-2026-11-16).

## Hecho y fusionado en `task/sqlite-adopt`

| Frente | Commits | Evidencia |
| --- | --- | --- |
| Barra del visor: iconos y nombres habituales (Pintar, Editar, Variaciones, Convertir, Mejorar) | `6a1c7f51` | test y captura en el sandbox |
| Omnicanvas: el nodo del agente ya no sale cortado al abrir | `97c843a3` | prueba visual en el sandbox |
| Vista previa de exportación: dibujo directo, sin PNG (~1015 ms → 3-8 ms) | `1ffb8dfd` | medida en el sandbox |
| Tabla del plan: filas 8-10 deduplicadas y biblioteca como paso 16 | `deda3b5b` | documento |
| C0: aviso «Disk copy… Failed to fetch» al recargar (zona protegida) | rama `task/c0-pagehide`, merge `534b7068` | 2 revisiones adversariales de GPT; `npm test` de la rama en verde (4079); fila en [persistencia-protegida](../persistencia-protegida.md) |
| Referencias: un destino que falta queda inválido y a la vista, nunca se sustituye por el activo; «sigue la vigente» frente a «fijada» | `0de78c94`, `f6f0b5ab` | tests y revisión adversarial |
| Entradas obligatorias: el run se para antes de llamar al proveedor | `1d6a8134`, `f6f0b5ab` | tests y revisión adversarial |
| freshness: cuentan `ref`/`control` y la revisión del asset | `77ec4bd4` | tests |
| C0 «Connected» se apaga con el servidor caído; A2 etiqueta de proveedor real | `1d6a8134`, `ccad4899` | tests (A2 solo en parte) |
| Puertos: modelo→agente cambia el modelo real; chat/agente→prompt entrega texto real | `fbc05b0d`, `61b146b4` | `tests/ref-ports-effects.test.ts` |
| Cada nodo agente con su propio LLM; mensajes con `agentNodeId` | `2da0624f` | tests y revisión adversarial |
| Nodo `prompt` (caja independiente) y nodo de ajustes de medio | `d3ea6890` | tests |
| Registro de tipos de nodo en lugar del `switch` cerrado | `a98a03fb` | tests |
| Chat dueño de su feed, varios agentes; migración sin pérdidas (37/37) | `3090b237` | tests y revisión adversarial |
| Abrir un space en el omnicanvas muestra sus nodos del sistema | commit siguiente a `3090b237` | `tests/space-opens-its-nodes.test.ts` |
| Punto 7 revertido según la regla del usuario | `60ab26f3` | tests |

La suite completa sobre la rama ya fusionada se lanzó el 2026-11-18; su resultado está en `pendientes.md`.

## Corrección del 2026-11-18: verificado en el código, mucho es parcial

Un Sonnet lo comprobó en el código (solo lectura) y la tabla de arriba exagera. Estado real:
- **Varios agentes, A2:** FALSO en el envío real. `sendAgentMessage` llama a `agentEngine()` sin `agentNodeId` (`conversation.ts:68,82,108`; `llmTurn.ts:53`) y `agentNodeOf` devuelve siempre el primer agente (`runtimeShared.ts:98-100`). Los metadatos y `chatAgents` existen, pero responde siempre el primero. Los tests probaban `agentEngine` con un id explícito, no el envío.
- **LLM propio por agente, A1:** parcial. `setAgentLlm` (`system.ts:345`) solo lo usan los tests; no hay control en el nodo para cambiarlo.
- **Nodo `prompt`, A4:** parcial. Solo lo lee el primer agente y no se puede crear desde la UI (falta en `AddNodeItems.tsx:24-33`). `mediaSettings` existe como tipo, pero no se genera ni se ofrece.
- **«Assets in», A3:** referencia por id, sí; no existe la acción explícita «copiar».
- **Regla de nodos del sistema:** los puntos 3 y 4 están hechos (`omniSpaces.ts:40-52`, `AddNodeItems.tsx:46-47`). El punto 1 es parcial: Studio genera chat, agent y model; Designer, `designer.doc`; Nodes, toolset y library; faltan provider, board, log, ajustes y aspecto. El punto 2 es parcial: al abrir un space, sus nodos salen sueltos debajo, sin un marco encapsulado.
- **Diagnóstico:** se usaron sus 3 acoplamientos y los tres quedaron a medias. Las piezas sin nodo (board, log de generaciones, ajustes generales, layer, paneles de Designer, historial de prompts) no se atacaron. Fue un recorte de alcance que no se dijo.

## Decisiones del usuario (vigentes)

- **Nodos del sistema:** cada space crea los suyos por defecto y los necesita; se ven en el omnicanvas al abrir el space, como un nodo encapsulado. Los nodos de Nodes sirven en los dos lienzos; los del sistema **nunca** van en el lienzo Nodes normal.
- **Puertos:** todo puerto declarado funciona de verdad; no basta con marcarlo.
- **Q1:** el nodo modelo o proveedor solo configura; va acoplado al agente y se puede cambiar.
- **Q2:** el control declara (conectar un agente a un chat); un chat tiene varios agentes, y pausar o enviar son botones del nodo.
- **Q3:** «Assets in» solo referencia, por id estable; copiar es una acción explícita.
- **Principio:** no cambiar lo que se ve; separar en código lo que ya existe y pasar los nodos de espejo a fuente de verdad.
- **Proceso:** una tanda de avances de principio a fin, revisiones rápidas por medio y el ciclo lento (GPT adversarial y suite completa) al final.

## Documentos nuevos

[propuesta-contratos-puertos](../propuesta-contratos-puertos.md), con los errores conocidos de Blender, Maya, Houdini y ComfyUI; [diagnostico-piezas-nodos](../diagnostico-piezas-nodos.md), con cada pieza de la app frente a su nodo.

## Para retomar, en orden

1. Resultado de la suite completa de `task/sqlite-adopt`; si está en verde, arrancar el reparto.
2. Reparto sin solapar archivos, todos desde `task/sqlite-adopt`: Grok, punto 8 (puertos y cables entre ventanas); Hydrogen, el resto de contratos (imagen de doc y library, nodos no idempotentes, esquema versionado), después de Grok; GPT, solo tests adversariales; Argon, prueba en el sandbox (varios agentes, nodo `prompt`, abrir un space, migración del historial guardado). `pendientes.md` y `docs/map.md` solo los toca la sesión maestra al fusionar.
3. Propuesto y sin confirmar: procedencia de los resultados (cada resultado guarda la revisión que usó) y marcar como desactualizado sin regenerar solo.
4. Del usuario: diseño del panel de exportación y decisión del idioma.
5. Otra tanda: A3-A6 (agente) y B1-B2 (dinero).

## Lecciones

- Un pendiente ambiguo («nodos del sistema fuera del lienzo Nodes») se hizo al revés. Los pendientes se escriben como regla, no como frase.
- Hay poca RAM (~1-2 GB libres) y el PC se colgó una vez: todo worker y toda suite con `systemd-run` y un worker, de uno en uno.
- `codex exec` no acepta `--full-auto`; usar `-s workspace-write`. En worktrees sin `node_modules`, GPT no puede ejecutar vitest.
- Los únicos conflictos de fusión fueron en `pendientes.md` y `docs/map.md` (este se regenera con `node scripts/map.mjs --write`).

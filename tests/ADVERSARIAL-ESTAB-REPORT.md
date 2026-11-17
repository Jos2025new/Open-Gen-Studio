# Informe adversarial — estabilización de referencias

Comparación solicitada: `task/sqlite-adopt..HEAD`, rama `claude/estabilizacion-refs-5223a3`. Pruebas añadidas en esta revisión: `adversarial-estab-refs.test.ts`, `adversarial-estab-agents.test.ts` y `adversarial-estab-required.test.ts`. No se modificó código de producto.

## Resultados

| Test | Resultado | Evaluación |
| --- | --- | --- |
| `adversarial-estab-refs`: modelo de catálogo eliminado/renombrado no se sustituye por el modelo activo | **Falla** | Bug real: `resolveSystemNodeLive` devuelve un nodo tipo `model` sin `invalid`, aunque la ref `gone::renamed-model` no exista. La vista no expone estado inválido para esa referencia rota. |
| `adversarial-estab-refs`: revisión nueva del asset vuelve obsoleto el resultado enlazado | **Pasa** | Cambio de `revisionIndex` y revisión detectado por la firma de `nodeRequest`; el resultado deja de ser vigente. |
| `adversarial-estab-refs`: quitar del grafo un prompt conectado no deja su texto en las entradas actuales del agente | **Pasa** | `promptsWiredToAgent` consulta las aristas y nodos actuales; tras borrar el nodo no devuelve el texto anterior. |
| `adversarial-estab-agents`: un sender ID desconocido no se atribuye al primer agente | **Pasa** | `messageMeta` no escribe `sys_agent` como identidad sustituta del sender borrado. |
| `adversarial-estab-agents`: dos agentes conectados conservan LLM, modelo y metadatos de remitente separados | **Pasa** | Se verificaron motores y metadata por `agentNodeId`; el modelo propio del segundo agente no se mezcla con el del primero. |
| `adversarial-estab-agents`: feed legado conserva conteo, IDs únicos y orden al inicializar nodos | **Pasa** | 37 mensajes antes y después, sin IDs duplicados ni reordenados. Es una comprobación de cardinalidad del feed en memoria, no de persistencia/reinicio real. |
| `adversarial-estab-agents`: dos feeds de chat no se mezclan | **Pasa** | Cada chat solo devuelve su mensaje aunque compartan el feed de sesión. |
| `adversarial-estab-agents`: etiqueta visible muestra modelo/proveedor seleccionados | **Pasa** | `engineLabel()` refleja el modelo y proveedor configurados en `settings.agent`. |
| `adversarial-estab-ui`: servidor caído apaga Connected con proveedores configurados | **Pasa** | Prueba el estado `disk` junto a cuatro proveedores; verifica la función de estado, no una caída real del servidor. |
| `adversarial-estab-ui`: Nodes normal excluye nodos de sistema presentes en el grafo | **Pasa** | `ordinaryGraph` filtra el nodo `chat` y conserva un nodo de texto. No cubre la presentación al abrir un Space. |
| `adversarial-estab-required`: operación `edit` sin instrucción obligatoria se rechaza antes de proveedor | **Falla** | Bug real: con un asset de entrada válido, `runNodes` llega a `runGeneration` pese a `instruction: ''`. El espía reemplaza `runGeneration` por un rechazo local antes de red; se observó la llamada al límite de generación, sin contactar proveedor externo. |

**Balance:** 8 pruebas pasan y 2 fallan. Las dos fallas corresponden a expectativas del contrato, no a errores del harness.

## Límites de esta ejecución

- El primer comando pedido de Vitest no pudo cargar la configuración: Vite intentó escribir en `node_modules/.vite-temp`, que está montado de solo lectura en este worktree. Con el cargador `runner`, se ejecutaron los mismos archivos sin escribir ahí.
- No se ejecutaron tests previos del branch, `npm test`, pruebas de navegador, sandbox ni proveedor. Por ello no afirmo evidencia de UI real, caída real del servidor, llamada de proveedor ni migración persistida del feed.
- La cobertura nueva enfoca referencias, freshness de asset, eliminación de prompt, atribución de agente, agentes múltiples, separación y cardinalidad de feeds, campos obligatorios, función `Connected` y filtrado de `ordinaryGraph`. Los casos de revisión de doc/sesión, freshness de `control`, migración persistida y apertura visual de omnicanvas/Space siguen sin probarse aquí.

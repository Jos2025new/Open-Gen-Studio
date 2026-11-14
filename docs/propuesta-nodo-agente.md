# Propuesta: el agente, el chat y los espacios como nodos

**Fecha:** 2026-11-14 · **Estado:** Propuesta lista para aprobación · **Relacionado:** [Todo es un nodo](propuesta-todo-es-un-nodo.md), [Plan revisado](propuesta-todo-es-un-nodo-plan.md), [ADR 0030](decisions/0030-nucleo-de-comandos.md), [ADR 0017](decisions/0017-espacios-panel-y-tablero.md), [ADR 0018](decisions/0018-canvas-efectivo-del-agente.md), [Persistencia protegida](persistencia-protegida.md).

---

## 1. Reconciliación: propuesta original, plan de ventanas y visión del usuario

Los dos diseños previos tenían tensiones opuestas que el enunciado del 2026-11-14 resuelve:

| Eje | [Propuesta original](propuesta-todo-es-un-nodo.md) | [Plan revisado (Fable)](propuesta-todo-es-un-nodo-plan.md) | Reconciliación definitiva (este diseño) |
| --- | --- | --- | --- |
| **Agente y Chat** | Nodos `agent` y `chat` unidos por enlace bidireccional `control`. | Eliminados como nodos; reducidos a un dock flotante global sobre ventanas. | **`agent` y `chat` son nodos reales en `Session.graph`.** Todo nace como nodo. En `Designer` o `Studio`, el mismo nodo `chat` (con su `agent` acoplado) se proyecta como panel o columna sin dejar de ser nodo. |
| **Proveedores y Modelos** | Nodo `model` suelto conectado por cable `ref` al agente o generador. | Eliminado (`ref` descartado por «ruido visual»); selector interno oculto en cada tarjeta. | **Nodos `provider` y `model` con 4 estados intercambiables:** *conectado* por cable `ref`, *acoplado* (`dockedTo`) al borde de `agent`/`chat`, *agrupado* (`GraphGroup`) o *fusionado* (`mergedModels`). Cero ruido cuando se acopla; control total en el omnilienzo. |
| **Spaces (`Designer`, `Nodes`, `Studio`, `Library`, `Create`, `Tools`)** | Solo existía `design-doc`; los Spaces seguían siendo pestañas globales fuera del grafo. | El omnilienzo pasaba a ser un escritorio de ventanas de documentos, desplazando al grafo. | **Los Spaces son nodos (`kind: 'space'`) y los diseños son nodos (`kind: 'doc'`).** Todo es visible y conectable en el omnilienzo (`Nodes`). Cada Space proyecta esos mismos nodos en la vista que le corresponde. |
| **Almacenamiento y comandos** | Sugería meter documentos, capas y mensajes dentro de `GraphNode.data`. | Mostró que meter capas en `GraphNode.data` rompe el undo y los archivos congelados (> 30 KB), y fijó `src/engine/commands/` ([ADR 0030](decisions/0030-nucleo-de-comandos.md)). | **Se conserva la regla de ingeniería del plan revisado:** los nodos `chat`, `agent`, `doc` y `space` viven en `Session.graph` pero referencian por `refId` sus colecciones pesadas (`session.feed`, `session.agent`, `session.docs`, `assets`, `generations`) y se mutan mediante comandos. |

---

## 2. Evidencia en código: por qué el agente pierde el contexto al pasar de Designer a Nodes

En `argon-input/prueba-real.md`, `ses_mwgp90798tzp5mzc4p.json` (Sesión A: 22 herramientas antiguas) y `ses_mwgpedm876izixcbsj.json` (Sesión B: `find_commands` + `run_commands`), el usuario diseña en **Designer** un cartel 1080×1350 llamado `"Cartel"` con el texto `"Gran apertura"`, cambia a **Nodes** y pide: *«añade dos nodos al lienzo de nodos y conéctalos entre sí»*. El cambio de espacio falla por **cuatro causas exactas en el código**:

1. **Ramas mutuamente excluyentes en `<studio_context>` ([src/engine/agent/context.ts](../src/engine/agent/context.ts)):**
   - En `buildContext()` (`context.ts:334-357`), `if (opts.workspace === 'designer')` (`L334`) e `if (opts.workspace === 'node')` (`L342`) se excluyen entre sí. Al pasar a `Nodes`, desaparece el bloque `designer document "Cartel" (1080×1350, 3 layers): ...` (`L336-339`) y la lista de activos (`L319-324`) filtra con `canvas.visible(a, opts.workspace)` (`src/engine/canvas.ts:47`), imprimiendo `recent assets on the node canvas (other canvases are not listed)`.
   - **Efecto medido en la Sesión B (`ses_mwgpedm876izixcbsj.json`):** en `Nodes`, aunque `find_commands({area: "nodes"})` listó `Document on screen: doc_mwgpewjfemvqjnfopl "Cartel", 1080x1350`, el agente perdió las capas de `"Cartel"` (`"Gran apertura"`) y creó un nodo `Prompt` vacío (`text: ""`) y un nodo `Image` genérico desconectados del cartel.
2. **Evaluación estática de `on.doc` antes de correr un lote ([src/engine/agent/commandCalls.ts](../src/engine/agent/commandCalls.ts)):**
   - En `runCommandsTool()` (`commandCalls.ts:67-68`), `const doc = activeDoc(s)` se calcula una sola vez antes del paso 1. Cuando el agente envió `[designer.doc.new, designer.layer.add_text, ...]`, `doc` era `undefined`; el paso 2 abortó todo el lote con `Step 2 failed (target): designer.layer.add_text needs on.doc. Nothing ran.` (`run.ts:69`), forzando una llamada extra de **39.210 tokens de entrada**.
3. **Ocultación de mensajes por `workspace` ([src/components/chat/FeedList.tsx](../src/components/chat/FeedList.tsx)) y estado `parked` ([src/engine/agent/runtimeShared.ts](../src/engine/agent/runtimeShared.ts)):**
   - `FeedList.tsx:198-200` filtra los mensajes cuyo `f.workspace` no coincide con el lienzo activo salvo en `Studio` (`Show the other canvases too (N)`), y `toCanvas()` (`runtimeShared.ts:98-115`) aparca turnos en `agent.parked[ws]`.
4. **Falta de lectura de trazas tras ejecutar y desfase en métricas ([src/engine/agent/planRun.ts](../src/engine/agent/planRun.ts) y [src/engine/agent/metrics.ts](../src/engine/agent/metrics.ts)):**
   - En la Sesión A (`ses_mwgp90798tzp5mzc4p.json`), tras ejecutar el plan en `Nodes`, el agente dijo: *«Todavía no los he visto y no sé si quedaron conectados»*.
   - Además, `approvePlan()` (`planRun.ts:75`) llama a `closeRequest(sessionId, 'approved')` **antes** de `runPlanItem() → wrapUpPlan() → llmTurn()` (`planRun.ts:88,294,350`). Como `patchOpen()` (`metrics.ts:18`) ignora peticiones ya cerradas, los turnos `wrap-up` suman a `session.usage` (`llmTurn.ts:72`) pero no a `session.agentMetrics`, causando en la Sesión A un desfase de **68.537 tokens de entrada** (`270.592` en `session.usage` vs `202.055` en `agentMetrics`).

---

## 3. Modelo de datos completo («Todo es un nodo»)

Para cumplir el límite de 30 KB por archivo ([scripts/size-baseline.json](../scripts/size-baseline.json) congela `src/engine/types.ts` en 37.306 B), las nuevas interfaces viven en `src/engine/nodes/types.ts` (~6 KB).

### 3.1. Tipos de nodo (`NodeKind`)

Todo objeto nace como un `GraphNode` en `Session.graph.nodes`. A los 7 tipos actuales (`text | image | video | audio | model3d | tool | asset`) se suman 7 tipos estructurales y de ejecución:

| `NodeKind` | Qué representa | Vista en el omnilienzo (`Nodes`) | Proyección en otros Spaces |
| --- | --- | --- | --- |
| `'agent'` | Instancia de agente (prompt, estilo `auto`/`ask`/`direct`, habilidades, presupuesto y estado). | Tarjeta con puertos `control` (`chat`), `ref` (`models`, `skills`, `spaces`, `docs`) y riel de modelos acoplados. | Selector/cabecera de agente acoplado al panel del `chat` activo. |
| `'chat'` | Conversación usuario–agente con mensajes fechados y riel multimodelo. | Tarjeta con últimos mensajes, modelos acoplados y puertos `control` (`agent`) y `data` (`messages`). | Columna de chat en `Studio`/`Create`; panel lateral en `Designer`, `Nodes` y `Tools`. |
| `'provider'` | Conexión a proveedor (`nanogpt`, `fal`, `replicate`, `google`, `openai`, `anthropic`, `local`) y techo de gasto. | Pastilla/nodo conectable o acoplable a `model`, `agent` o `chat`. | Insignia de proveedor en las píldoras de modelo. |
| `'model'` | Modelo (`modelRef = "provider::id"`, rol `director | image | video | audio | model3d | compare`, parámetros). | Nodo con entrada `provider` y salida `ref:model`; acoplable, agrupable o fusionable. | Píldora interactiva en la barra del `chat` o en el inspector del generador. |
| `'space'` | Espacio (`spaceKind: 'studio' | 'designer' | 'nodes' | 'library' | 'create' | 'tools'`) con su alcance y vista. | Nodo marco conectado por `ref` a los nodos (`doc`, `chat`, `agent`, activos) que muestra. | La vista activa cuando el usuario abre ese Space en la barra superior. |
| `'doc'` | Documento multicapa de Designer (`DesignDoc` de `width × height`). | Miniatura en vivo con entradas (`image`, `text`, `layer`) y salida (`image` compuesta). | Mesa de trabajo editable en `Designer`; tarjeta en `Studio` y `Library`. |
| `'command'` | Paso o macro del núcleo de comandos (`cmd`, `args`, `on`) encadenable. | Nodo compacto de operación con puertos `control:trigger` y `data`. | Paso trazable en una tarjeta de actividad. |
| `'text' \| 'image' \| 'video' \| 'audio' \| 'model3d' \| 'tool' \| 'asset'` | Generadores, herramientas (`bg-remove`, `upscale`, `inpaint`, `join`…) y activos existentes. | Tarjetas actuales de `src/components/node/nodes.tsx` con puerto `ref:model` opcional. | Tarjetas en `Studio`/`Library` o vista focalizada en `Create`/`Tools`. |

### 3.2. Acople, agrupación y fusión (`dock`, `group`, `merge`) y multimodelo en el chat

Siguiendo la mediana profesional (Blender, Figma, ComfyUI, Weave), una misma relación (`model` / `provider` → `agent` o `chat`) soporta **4 modos convertibles sin pérdida** mediante el comando `nodes.attachment.set_mode`:

```ts
export type ModelRole = 'director' | 'image' | 'video' | 'audio' | 'model3d' | 'compare';

export interface NodeDock {
  hostId: string; // ID del nodo 'agent', 'chat' o generador anfitrión
  slot: ModelRole | 'provider' | 'skill' | 'space';
  order: number;  // orden en el riel acoplado (0, 1, 2...)
}

export interface MergedModelSlot {
  originNodeId: string; // permite desacoplarlo de vuelta al lienzo conservando su identidad
  role: ModelRole;
  provider: string;
  modelRef: string;
  params?: Record<string, unknown>;
  enabled: boolean;
}
```

1. **Conectado por cable (`wired`):** nodo independiente en `(x, y)` con arista `kind: 'ref'` hacia `agent.models` o `chat.models`. Útil cuando un mismo modelo alimenta a varios nodos.
2. **Acoplado (`docked`, `node.dockedTo?: NodeDock`):** el nodo sigue en `graph.nodes`, pero se encaja en el riel del `agent` o `chat`, moviéndose con él como píldora sin cable suelto. Arrastrar un `model` o `provider` sobre un `agent` o `chat` lo acopla por defecto.
3. **Agrupado (`grouped`, `GraphGroup` en `graph.groups`):** marco visual en el omnilienzo (`nodeIds: [agentId, chatId, model1Id, ...]`) que mueve o colapsa el equipo entero.
4. **Fusionado (`merged`, `mergedModels: MergedModelSlot[]`):** el modelo se absorbe dentro de `AgentNodeData` o `ChatNodeData` y puede volver a extraerse con `nodes.model.unmerge`.

**Enrutamiento de múltiples modelos de distintos proveedores en un mismo `chat` o `agent`:**
- Los modelos adjuntos al `chat` se combinan con los de su `agent` (prevaleciendo los del `chat` para ese hilo).
- Si hay **1 modelo `role: 'director'`** (LLM), conduce el turno. Si hay **2+ modelos `director` activos** (p. ej. `anthropic::claude-sonnet-4` y `google::gemini-2.5-pro`), el turno corre en **comparación multimodelo** (o director + revisor según `order`), emitiendo respuestas identificadas con su `modelRef`.
- Los modelos de medios (`image`, `video`, `audio`, `model3d`) adjuntos reemplazan el estado oculto `session.agent.settings` (`src/engine/types.ts:624`): 1 modelo activo por modalidad actúa como selección confirmada; 2+ modelos activos de la misma modalidad activan automáticamente la ejecución comparativa (`comparisonKinds`).

### 3.3. Puertos (`PortSpec`) y las tres clases de enlace (`EdgeKind`)

Se restauran las tres clases de enlace (`data`, `ref`, `control`) sobre `GraphEdge` (`kind` omitido equivale a `'data'`):

| Clase (`EdgeKind`) | Semántica y dirección | Regla de ciclos | Trazo en el omnilienzo | Puertos compatibles (`sourcePort → targetPort`) |
| --- | --- | --- | --- | --- |
| `'data'` *(defecto)* | Flujo unidireccional de contenido (`source → target`). | **DAG estricto** (`wouldCycle` en `src/engine/flow/graph.ts:87`). | Línea continua por tipo (`text`, `image`, `video`, `audio`, `model3d`, `layer`, `messages`). | `text→prompt`, `image→image`, `video→video`, `audio→audio`, `model3d→model3d`, `doc.image→image`, `chat.messages→text`. |
| `'ref'` | Adjunción de capacidad o contexto (`model`, `provider`, `skill`, `subject`, `doc`, `space`). | Sin ciclos en el mismo par; relación `1:N`. | Línea discontinua fina (oculta si el nodo está en `dockedTo`). | `provider→model`, `model→agent/chat/generador`, `doc↔agent`, `space↔agent`, `space→doc/chat`. |
| `'control'` | Gobernabilidad, disparo de ejecución acotada y vínculo `chat ↔ agent`. | `chat ↔ agent` es **bidireccional** (`both: true`); `trigger → trigger` es DAG. | Doble línea con pulso cuando está en ejecución (`running`). | `chat.agent↔agent.chat`, `command.done→command.trigger`, `agent.trace→text/chat`. |

### 3.4. Metadatos de cada mensaje del chat (`ChatMessageMeta`)

Cada mensaje en `session.feed` incorpora `meta?: ChatMessageMeta` con fecha, hora, huso, origen nodal, proveedor/modelo, coste y traza:

```ts
export interface ChatMessageMeta {
  isoDateTime: string;     // ISO 8601 con huso local (ej. "2026-11-14T18:42:11.304-04:00")
  tzOffsetMin: number;     // desfase respecto a UTC en minutos (ej. -240)
  endedAt?: number;        // epoch ms de fin de turno o ejecución
  durationMs?: number;     // endedAt - createdAt
  chatNodeId: string;      // por defecto 'node_chat_main'
  agentNodeId?: string;    // por defecto 'node_agent_main'
  spaceNodeId?: string;    // 'space_designer', 'space_nodes', 'space_studio', etc.
  provider?: string;       // proveedor que sirvió la respuesta
  modelRef?: string;       // "provider::modelId"
  attachedModels?: string[];
  usage?: { input: number; output: number; reasoning?: number; cached?: number };
  costUsd?: { actual?: number; estimated?: number };
  runId?: string;          // enlace a RunTrace.runId
  commandSeqs?: number[];  // enlace a EchoEntry.seq en echo.ts
  replyToId?: string;
  editedAt?: number;
}
```

### 3.5. Esquema persistido y campos opcionales (cero cambios en `persistencia-protegida.md`)

En `src/store/formatV2.ts:46-54`, cada `Session` se serializa como JSON dentro de `sessions`. Al usar únicamente campos opcionales en `Graph`, `GraphNode`, `GraphEdge`, `FeedBase` y `Session`, el formato `ogs-store-v2` (`version: 2`) no cambia y no se toca ningún archivo de [docs/persistencia-protegida.md](persistencia-protegida.md):

```ts
export interface AgentNodeData {
  kind: 'agent'; title: string; engine: 'llm' | 'local'; style: 'auto' | 'ask' | 'direct';
  systemPrompt?: string; skillIds?: string[]; workflowId?: string;
  mergedModels?: MergedModelSlot[];
  budget?: { maxIterations?: number; maxSteps?: number; timeoutMs?: number; maxUsd?: number };
  status?: 'idle' | 'running' | 'awaiting' | 'stopped' | 'error'; lastRunId?: string;
}
export interface ChatNodeData {
  kind: 'chat'; title: string; isPrimary?: boolean; mergedModels?: MergedModelSlot[];
  activeSpaceNodeId?: string; messageCount?: number; lastMessageAt?: number;
}
export interface ProviderNodeData {
  kind: 'provider'; title: string; providerId: string; enabled: boolean; spendCapUsd?: number;
}
export interface ModelNodeData {
  kind: 'model'; title: string; provider: string; modelRef: string;
  role: ModelRole; params: Record<string, unknown>; enabled?: boolean;
}
export interface SpaceNodeData {
  kind: 'space'; title: string; spaceKind: 'studio' | 'designer' | 'nodes' | 'library' | 'create' | 'tools';
  memberNodeIds?: string[]; layout?: { viewMode?: 'canvas' | 'board' | 'split' | 'focus'; zoom?: number; panX?: number; panY?: number };
}
export interface DocNodeData {
  kind: 'doc'; title: string; docId: string; width: number; height: number; layerCount: number; previewAssetId?: string;
}
export interface CommandNodeData {
  kind: 'command'; title: string; cmd: string; args: Record<string, unknown>; targetRef?: string; lastSeq?: number;
}
```

Extensiones opcionales sobre tipos existentes:
- `GraphNode`: `dockedTo?: NodeDock`, `groupId?: string`.
- `GraphEdge`: `kind?: EdgeKind`, `both?: boolean`.
- `Graph`: `groups?: GraphGroup[]` (`{ id, title, color?, nodeIds, collapsed? }`).
- `FeedBase`: `meta?: ChatMessageMeta`.
- `Session`: `traces?: RunTrace[]` (anillo de las últimas 50 ejecuciones).

---

## 4. Mapeo sin pérdida de sesiones, chat y Spaces actuales

Al cargar cualquier `Session`, una función pura e idempotente `ensureSessionNodes(session: Session): Graph` materializa sus nodos en `session.graph` sin borrar ni migrar campos existentes:

| Estado actual | Dónde vive hoy | Mapeo al modelo de nodos (sin pérdida de datos) |
| --- | --- | --- |
| **Chat (`session.feed`)** | `Session.feed: FeedItem[]` (`types.ts:696`) | Se asegura `node_chat_main` (`kind: 'chat'`, `isPrimary: true`). Los `FeedItem` sin `meta.chatNodeId` pertenecen a `node_chat_main` y derivan `meta.isoDateTime` de `createdAt`. **`FeedList.tsx` deja de ocultar mensajes por `workspace`:** la conversación es continua entre Spaces y muestra la insignia del `spaceNodeId` en cada mensaje. |
| **Agente (`session.agent` y `parked`)** | `Session.agent: AgentState` (`types.ts:629`) | Se asegura `node_agent_main` (`kind: 'agent'`) unido a `node_chat_main` por `{ kind: 'control', both: true }`. Las notas y ajustes de `agent.parked` se consolidan en `node_agent_main`, eliminando conversaciones partidas por lienzo. |
| **Modelos (`agent.settings` + `llmModel`)** | `agent.settings[kind]` y `catalog.llmModel` | Se materializan como nodos `kind: 'model'` con `dockedTo: { hostId: 'node_agent_main', slot: kind, order }`, haciendo visibles y editables las elecciones de modelo. |
| **Diseños (`session.docs`)** | `Session.docs: DesignDoc[]` (`types.ts:703`) | Cada `DesignDoc` tiene su nodo `node_doc_<doc.id>` (`kind: 'doc'`, `docId: doc.id`) enlazado por `ref` a `space_designer` y a `node_agent_main`. `designer.doc.new` crea el `DesignDoc` y su nodo `doc` en el mismo paso. |
| **Spaces (`Studio`, `Designer`, `Nodes`, `Library`, `Create`, `Tools`)** | `ui.space`, `ui.workspace` y `spaceSession.ts` (`hidden: true`) | Existen los nodos `space_studio`, `space_designer`, `space_nodes`, `space_library`, `space_create` y `space_tools`. Las generaciones de la sesión oculta de `Create`/`Tools` (`findSpaceSessionId` en `src/store/spaceSession.ts:9`) se exponen como nodos vinculados a `space_create`/`space_tools` dentro de la sesión activa (`hidden: true` sigue leyéndose por compatibilidad). |

**Solución directa al fallo Designer → Nodes:**
1. Al crear `"Cartel"` (1080×1350, `"Gran apertura"`) en `Designer` y cambiar a `Nodes`, el usuario ve en el omnilienzo el nodo `node_doc_Cartel` conectado a `node_agent_main` y `node_chat_main`, en vez de un lienzo vacío de 0 nodos.
2. `<studio_context>` reemplaza el `if (workspace === 'designer') / else if (workspace === 'node')` por el **subgrafo conectado al nodo `agent`/`chat`**: incluye siempre una línea por cada nodo `doc`, `model` o generador enlazado al agente (`doc:doc_Cartel "Cartel" 1080×1350 [3 layers: bg, text "Gran apertura", shape]`).
3. En `runCommandsTool()` (`commandCalls.ts`), `on.doc` y `on.node` se actualizan dinámicamente paso a paso dentro de `runCommands`: cuando el paso 1 ejecuta `designer.doc.new`, su `doc` resultante pasa a ser el `on.doc` por defecto de los pasos 2..N.

---

## 5. Ejecución acotada, parada y trazabilidad unificada (`RunTrace`)

### 5.1. Ejecución acotada (`RunBudget`) y parada (`nodes.run.stop`)

Se unifican el bucle del agente (`llmTurn.ts`), el ejecutor de comandos (`run.ts`) y el ejecutor de nodos (`flow/actions.ts` + `executor.ts`) bajo `src/engine/nodes/runner.ts`:

```ts
export interface RunBudget {
  maxSteps: number;      // máx. comandos o nodos por ejecución (defecto: 40)
  maxIterations: number; // máx. vueltas LLM del nodo agente por turno (defecto: 5)
  timeoutMs: number;     // tope total en ms antes de abortar (defecto: 300_000 ms)
  maxUsd?: number;       // techo de gasto en USD autorizado para la ejecución
}
```

- **Inicio acotado:** verifica orden topológico (`wouldCycle`), firma de frescura (`nodeRequest`) y `RunBudget`.
- **Parada unificada (`nodes.run.stop({ runId?, nodeId? })`):** cada ejecución crea un `runId` con un `AbortController` jerárquico que propaga `signal` a `llmTurn` (`untilStopped`), a `runCommands` (`opts.signal` en `run.ts:62`) y al proveedor, pasa los nodos en vuelo a `'stopped'`, libera cerrojos (`locks.ts`) y mueve `closeRequest()` al `finally` posterior a `wrapUpPlan()` (`planRun.ts:350`) para que `session.usage` y `session.agentMetrics` cuadren siempre.

### 5.2. Trazabilidad unificada (`RunTrace`) para la app, depuración y el agente

Sustituimos la fragmentación actual (`echo.ts`, `ActivityFeedItem`, `agentMetrics`, `journeyTrace.ts`, `turnLog.ts`) por `RunTrace` en `src/engine/nodes/trace.ts` (guardado en `session.traces`, anillo de 50 ejecuciones):

```ts
export interface TraceSpan {
  spanId: string; nodeId: string; nodeKind: NodeKind;
  op: 'llm.call' | 'command.run' | 'node.generate' | 'tool.run' | 'plan.step';
  cmd?: string; modelRef?: string; provider?: string;
  startedAt: number; endedAt?: number; ms?: number;
  status: 'running' | 'ok' | 'error' | 'stopped' | 'skipped';
  inputSummary?: string; outputSummary?: string; // máx. 160 caracteres
  tokens?: { input: number; output: number }; usd?: number; error?: string; seq?: number;
}

export interface RunTrace {
  runId: string; sessionId: string; triggerNodeId: string; spaceNodeId: string;
  startedAt: number; endedAt?: number; status: 'running' | 'ok' | 'partial' | 'error' | 'stopped';
  budget: RunBudget;
  totals: { steps: number; llmCalls: number; inputTokens: number; outputTokens: number; usd: number; ms: number };
  spans: TraceSpan[];
}
```

- **App:** insignia en vivo en cada nodo (`running`, `ok · 1,2s`, `error`, `stopped`) y desglose de `spans` en el mensaje del `chat`.
- **Depuración (`Ctrl+Alt+P` y `/x/store/log`):** lectura directa de `session.traces`.
- **Agente:** nuevo comando de lectura `trace.read({ runId?, nodeId?, last? })` + resumen de 3 líneas de `session.traces.at(-1)` (~180 caracteres) inyectado en `<studio_context>` para que el agente verifique siempre el resultado real de sus acciones.

---

## 6. Dos arquitecturas comparadas con números medibles en el código

- **Arquitectura A (Grafo unificado con almacenes desacoplados por `refId` y proyecciones por Space):** `Session.graph` aloja todos los tipos de nodo (`agent`, `chat`, `provider`, `model`, `space`, `doc`, `command`, medios, `tool`, `asset`), sus acoplamientos (`dockedTo`) y enlaces (`data`, `ref`, `control`), mientras que las capas de `DesignDoc` (`session.docs`), los mensajes (`session.feed`) y los activos (`assets`, `generations`) permanecen en sus colecciones actuales referenciadas por ID.
- **Arquitectura B (Grafo monolítico de contenedores — todo embebido en `GraphNode.data`):** se eliminan `session.docs`, `session.feed` y `session.agent`; las capas de `DesignDoc`, los arreglos `FeedItem[]` y `AgentState` viven dentro de `GraphNode.data`.

| Métrica medida en el código | Hoy (línea base) | Arquitectura A (`refId` desacoplado) | Arquitectura B (Todo en `GraphNode.data`) |
| --- | --- | --- | --- |
| **Esquemas de herramientas enviados por llamada LLM** (`tools.ts` vs `commandTools.ts`) | 22 herramientas (`tools.ts`, 31.490 B): **~18.400 caracteres (~4.600 tokens)/llamada**. Ruta de comandos (`commandTools.ts`): **1.319 caracteres (~330 tokens)/llamada**. | Usa `COMMAND_TOOLS`: **1.319 caracteres (~330 tokens)/llamada**. | Igual: **1.319 caracteres (~330 tokens)/llamada**. |
| **`<studio_context>` por llamada al pasar de Designer a Nodes** (`context.ts` + `argon-input/`) | **~1.950 caracteres (~490 tokens)**, pero **pierde el 100 % del diseño** al pasar a `Nodes`. En la Sesión B (8 llamadas) gastó **289.820 tokens de entrada** ($0,03072), incluidos **39.210 tokens** en un fallo por falta de `on.doc`. | **~2.280 caracteres (~570 tokens)/llamada** (+330 caracteres por resumen de nodos conectados y última traza). Conserva el contexto entre Spaces y ahorra **~39.000 tokens por sesión mixta**. | **~8.500 a 24.000 caracteres (~2.100–6.000 tokens)/llamada** si serializa `graph.nodes` con capas y mensajes embebidos. |
| **Clonación por cada paso de Undo/Redo en el grafo** (`src/engine/flow/history.ts:77`) | `recordGraph()` hace `structuredClone` (pila de 40 pasos) y `JSON.stringify` en `logical(g)` (`history.ts:18`). Con 15 nodos hoy: **~14 KB/paso** (< 1 ms). | +6 nodos estructurales ligeros (~350 B/nodo): **~16,5 KB/paso** (~1 ms). Editar nodos no clona capas ni mensajes. | Con un `DesignDoc` (~85 KB) + 60 mensajes (~95 KB) dentro de `GraphNode.data`: **~196 KB/paso** (**×12 más pesado**, ~7,8 MB en 40 pasos). |
| **Archivos congelados (> 30 KB en `scripts/size-baseline.json`)** | **11 archivos congelados**, incluidos `src/engine/types.ts` (37.306 B), `nodes.tsx` (44.895 B), `context.ts` (44.464 B) y `flow/actions.ts` (31.176 B). | **0 archivos congelados crecen**; se crean módulos nuevos de < 12 KB y se adelgazan `context.ts` y `nodes.tsx`. | Obliga a reescribir `DesignDoc`, `FeedItem` y `AgentState` en `types.ts` y `store.ts` (29,4 KB). |
| **Sitios de lectura en `src/` y persistencia protegida** | `session.feed`, `session.docs` y `session.agent` se leen en **> 140 sitios** (~48 archivos). | **0 archivos de `persistencia-protegida.md` tocados**; cero migración de `data/`. | **Rompe `formatV2.ts` y `store-v2.js`**, exige migrar `data/` y rompe ~48 archivos a la vez. |

---

## 7. Elección recomendada y por qué

**Elección: Arquitectura A (Grafo unificado en `Session.graph` con almacenes pesados desacoplados por `refId` y proyecciones por Space).**

1. **Cumple al 100 % el modelo «todo es un nodo» del usuario:** el agente, el chat, los proveedores, los modelos, los diseños y los Spaces viven como nodos en el omnilienzo, se conectan con enlaces `data`, `ref` y `control`, se acoplan (`dockedTo`), agrupan (`GraphGroup`) o fusionan (`mergedModels`) y se proyectan en cada Space.
2. **Cero riesgo sobre [docs/persistencia-protegida.md](persistencia-protegida.md):** las sesiones actuales cargan al instante mediante `ensureSessionNodes` sin tocar `store-v2.js`, `formatV2.ts`, `idb.ts`, `disk.ts` ni `data/`.
3. **Rendimiento y límite de 30 KB:** mantiene el undo del grafo en ~16,5 KB, evita reintentos LLM de 39.210 tokens y no engorda ningún archivo de `scripts/size-baseline.json`.

---

## 8. Orden de construcción en pasos pequeños y visibles

Cada paso respeta el tope de 30 KB, pasa `npm run test:related` y termina en algo visible en el sandbox:

1. **Paso 1 — Tipos nodales, enlaces (`data | ref | control`), `dockedTo` y `ensureSessionNodes` (`src/engine/nodes/`):** materializa en `session.graph` los nodos `chat`, `agent`, `model`, `doc` y `space` al abrir cualquier sesión. *Visible:* `find_commands` y el estado muestran el grafo completo sin romper sesiones guardadas.
2. **Paso 2 — Tarjetas en el omnilienzo para `agent`, `chat`, `model`, `provider`, `doc` y `space` (`src/components/node/AgentChatNodes.tsx`):** renderiza los nuevos nodos, el riel de píldoras `dockedTo` y los 3 trazos de arista en `Nodes`. *Visible:* al pasar de `Designer` a `Nodes`, el cartel `"Cartel"`, el `Chat` y el `Agente` aparecen conectados en el omnilienzo.
3. **Paso 3 — Comandos de acople, agrupación, fusión y multimodelo (`src/engine/commands/agentNodes.ts`):** registra `nodes.model.attach` (`wired | docked | grouped | merged`), `nodes.model.detach`, `nodes.group.create` y amplía `nodes.connect`. *Visible:* se pueden adjuntar varios modelos de distintos proveedores a un mismo `chat` o `agent`.
4. **Paso 4 — Metadatos de mensaje (`ChatMessageMeta`) e hilo continuo en `FeedList.tsx`:** guarda y muestra fecha, hora, huso, modelo/proveedor, coste, `spaceNodeId` y `runId` en cada mensaje, eliminando el filtro que ocultaba mensajes entre lienzos. *Visible:* cada mensaje muestra su fecha/hora y modelo, y el hilo no se corta al cambiar de Space.
5. **Paso 5 — Contexto nodal unificado (`src/engine/agent/nodeContext.ts`) y `on.doc` dinámico en `commandCalls.ts`:** alimenta al agente desde su subgrafo conectado y propaga el `doc`/`node` recién creado dentro del mismo lote de `run_commands`. *Visible:* el flujo Designer → Nodes (`"Cartel"` con `"Gran apertura"` → *"añade dos nodos y conéctalos"*) funciona a la primera.
6. **Paso 6 — Ejecución acotada (`RunBudget`), comando `nodes.run.stop` y cierre exacto de métricas (`planRun.ts`):** añade parada inmediata por `runId`/`nodeId` y cierra `closeRequest` tras `wrapUpPlan`. *Visible:* botón Stop funcional en cada nodo/chat y cero desfase entre `session.usage` y `agentMetrics`.
7. **Paso 7 — Trazabilidad unificada (`RunTrace`) y comando `trace.read` (`src/engine/nodes/trace.ts`):** guarda `spans` en `session.traces`, los muestra en cada nodo/mensaje y los expone a `Ctrl+Alt+P` y al agente. *Visible:* el agente y la UI leen la traza verificada de cada ejecución.
8. **Paso 8 — Proyección de Spaces (`Studio`, `Designer`, `Create`, `Tools`, `Library`) sobre los nodos del grafo:** vincula `Create` y `Tools` a `space_create` y `space_tools` en el grafo de la sesión. *Visible:* todo lo creado en cualquier Space aparece inmediatamente como nodo en el omnilienzo y en `Library`.

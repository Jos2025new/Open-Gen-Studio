# Investigación nodos pro (solo lectura, 2026-10-29)
Alcance real: 3 WebSearch extended + 2 WebFetch. magnific.com devolvió 403 (no reintenté con agent-browser). No se leyó código fuente directamente; los datos de código vienen de títulos/resúmenes de PRs. Marcado: primaria/secundaria/sin verificar. Lo no encontrado se dice «sin dato».

## 1. Varias salidas, borrar/duplicar/pegar/soltar cable
| App | Qué hace | Fuente |
|---|---|---|
| ComfyUI | Un enlace es origen+slot de salida (origin_slot = índice de salida) + destino+slot. Se identifica por índice de slot, no por id estable. Un PR reporta que al quitar un slot de subgrafo quedaban enlaces con origin_slot obsoleto que apuntaban «al slot que se movió ahí», sin error (corregido). Otro: enlace con origin_slot irresoluble rompía el desempaquetado a medias (corregido validando antes). | secundaria (resumen de búsqueda): https://github.com/Comfy-Org/ComfyUI_frontend/pull/18211 , https://github.com/Comfy-Org/ComfyUI_frontend/pull/17330 ; docs: https://docs.comfy.org/custom-nodes/js/javascript_objects_and_hijacking (primaria) |
| ComfyUI | Salida de un nodo de lote: ComfyUI trata un batch como un solo tensor en una salida; no hay «imagen n» como salida direccionable. | sin verificar (conocimiento propio) |
| Weave, Magnific, Krea, Runway | Sin dato sobre borrar un resultado, duplicar, pegar o soltar cable con salida concreta. | sin dato |
Conclusión Q1: solo ComfyUI documenta algo, y es un riesgo (índice posicional que se desplaza), no un diseño.

## 2. Coste antes de ejecutar
| App | Qué hace | Fuente |
|---|---|---|
| ComfyUI | Insignia de precio en cada nodo API/Partner; la doc dice que el coste real varía con tamaño, nº de generaciones y parámetros. Reglas en campo price_badge de la definición del nodo, evaluadas en cliente con JSONata (useNodePricing.ts) según widgets y entradas conectadas; solo si api_node y hay price_badge. Si la regla falla al compilar/evaluar, un PR añade telemetría (antes se tragaba el fallo) y la regla se desactiva; qué muestra la UI: sin dato. Algunos nodos reportan el coste tras ejecutar. | primaria: https://docs.comfy.org/interface/credits ; secundaria: https://github.com/Comfy-Org/ComfyUI_frontend/pull/16953 |
| ComfyUI | Insignias se desincronizan de la tabla de docs con frecuencia (PRs de sincronización). | secundaria: https://github.com/Comfy-Org/docs/pull/1570 |
| Magnific Spaces | Coste en créditos visible en el botón Run antes de ejecutar, se actualiza con modelo/resolución/duración; modos Run Node / Run Workflow / Run Downstream; MCP con herramienta gratuita simulate_spaces que estima el coste de un Space. | secundaria (resumen búsqueda de docs): https://www.magnific.com/ai/docs/nodes-and-connections , https://docs.magnific.com/modelcontextprotocol |
| Figma Weave | Una reseña dice que cada ejecución muestra su coste en créditos antes de empezar; coste por modelo muy variable. | secundaria: https://uxmagic.ai/blog/figma-weave-review |
Mismo modelo que se ejecuta: el precio se deriva de los widgets/parámetros del propio nodo (ComfyUI, Magnific), así que es el modelo seleccionado. No hay fuente que lo afirme como garantía. Precio desconocido: sin dato en ninguna.

## 3. Límite de gasto / créditos
| App | Qué hace | Fuente |
|---|---|---|
| ComfyUI | Sin tope por ejecución ni por cuenta documentado. Sin comprobación previa de saldo documentada: puede quedar saldo negativo porque los nodos a veces reportan coste después; con saldo negativo los Partner Nodes quedan bloqueados hasta recargar. Equipos Cloud: saldo compartido bajo límites del propietario. | primaria: https://docs.comfy.org/interface/credits |
| Magnific, Weave | Sin dato de tope de usuario; solo planes con créditos. | sin dato |

## 4. Cambio de modelo automático
Sin dato en ninguna app sobre cambio automático de modelo por origen, asistente o actualización del grafo. No inventado.

## 5. Recuperación tras recarga/pérdida de conexión
| App | Qué hace | Fuente |
|---|---|---|
| ComfyUI | Fallos conocidos y corregidos: tras caída del socket el front solo refrescaba la cola; PR #21282 consulta detalle/historial del servidor y reproduce las salidas de una ejecución terminada con el socket caído (backports 1.58). PR #16739: recuperar un trabajo activo obsoleto en cada sondeo de cola, no solo al reconectar. Issue #7961 (antiguo): el estado de ejecución solo está en memoria y no se reconstruye tras recarga (posiblemente desfasado). Token de sesión de nodos API dura 90 min: PR #16943 lo renueva en backend para trabajos largos en cola. El trabajo vive en el servidor, no se reenvía. Sobre cobro doble: sin dato. | secundaria: https://github.com/Comfy-Org/ComfyUI_frontend/pull/21282 , .../pull/16739 , .../issues/7961 , https://github.com/Comfy-Org/ComfyUI/pull/16943 |
| Magnific, Weave | Sin dato. | sin dato |

## 6. Asistentes con IA en el canvas
Weave: no es un chat, es canvas de nodos; el agente de Figma es otro producto (barra lateral de Figma Design). Nada sobre preguntas de aclaración ni sobre escribir sin responder. Magnific: no se encontró asistente en Spaces. ComfyUI: nombrado un «agent» en PRs del front (https://github.com/Comfy-Org/ComfyUI_frontend/pull/21644), sin detalle de preguntas. Fuentes: https://www.figma.com/solutions/ai-design-assistant/ (primaria), https://techcrunch.com/2026/05/20/figma-adds-an-ai-assistant-to-its-collaborative-canvas/ (secundaria). Resto: sin dato.

## Patrones comunes
- Precio visible junto al nodo/botón y calculado de los parámetros del nodo (ComfyUI, Magnific, Weave).
- Ejecución parcial (Magnific: solo nodo / downstream) para no repagar pasos anteriores.
- Enlaces por índice de slot (ComfyUI); la corrección de desplazamientos llegó como bugs.
- Resultados del trabajo viven en servidor y se reconcilian por consulta (ComfyUI).

## Dónde alguna lo hace mejor
- Magnific: estimación gratuita de un Space completo (simulate_spaces) y modos de ejecución parciales.
- ComfyUI: precio como regla de datos evaluable y recuperación por historial del servidor tras socket caído.
- ComfyUI: bloquea Partner Nodes con saldo negativo (único comportamiento documentado de «no continuar»).

## Comparación con vuestras correcciones (sin juzgar)
- Borrar resultado reubica cables / cable sin salida si la imagen se borró: difiere o sin dato; ComfyUI, con índice posicional, tuvo cables que apuntaban a otro slot sin error.
- Duplicar/pegar/soltar conservan la salida: sin dato en las apps; no comparable.
- Se ejecuta el modelo del plan aprobado = el de la estimación: coincide en espíritu (precio derivado de los parámetros del nodo); ninguna documenta un «plan aprobado».
- Precio desconocido con límite activo pide confirmación de sobrepasar, una vez: difiere; ninguna tiene límite de usuario documentado, y con coste tardío ComfyUI permite saldo negativo y bloquea después.
- Escribir con tarjeta de preguntas abierta envía las recomendadas: sin dato.
- «Check status» → «Check anyway» solo si gasta por encima: sin dato; lo más cercano es la reconciliación por historial de ComfyUI, sin cobro documentado.

---
# ACTUALIZACIÓN 2 — código leído (primaria) y webs
Clones superficiales (solo lectura): src-comfy-frontend @030a5ae (Comfy-Org/ComfyUI_frontend), src-comfy @0df1646 (comfyanonymous/ComfyUI), en este mismo scratchpad. Rutas relativas a `src/` del frontend.

## ComfyUI frontend: código (primaria, commit 030a5ae)
| Tema | Qué hace | archivo:línea |
|---|---|---|
| Copiar/pegar | Se serializa selección con sus enlaces (`_serializeItems`) y se deserializa creando nodos nuevos; para cada enlace del portapapeles se llama `originNode.connect(info.origin_slot, targetNode, targetSlot ?? info.target_slot)`: se conserva el índice de salida y la entrada. Si falla, `rollbackClipboardPaste` deshace todo. Enlaces con origen fuera de la selección no se pegan salvo reroutes del portapapeles (`clipboardLinkOrigin`). | lib/litegraph/src/LGraphCanvas.ts:4379 (serialize), 4500-4600 (deserialize+rollback), 9210-9236 (createClipboardLink) |
| Clonar nodo | `clone()` crea nodo, copia serialización y BORRA todos los enlaces (input.link=null, outputs links vacíos). Clonar un nodo suelto no conserva cables. Alt-arrastre/duplicar con selección usa `_deserializeItems(_serializeItems(...))`, que sí conserva enlaces internos. | lib/litegraph/src/LGraphNode.ts:1483-1505 ; LGraphCanvas.ts:2179, 2812 |
| Soltar cable en vacío | Se abre menú de conexión (`showConnectionMenu`) o, con Shift, `showSearchBox` con `node_from`+`slot_from` (salida concreta) y `type_filter_in` = tipo del slot de origen; la opción «Search» del menú pasa el mismo `slot_from`. Es decir el filtro y el origen son el slot arrastrado; el nodo creado se conecta desde ese slot. (No verifiqué la conexión final tras elegir en el buscador.) | LGraphCanvas.ts:1290-1310, 7370-7392, 7547 |
| Borrar nodo | `connectInputToOutput()` antes de `graph.remove(node)`: puentea entrada→salida del nodo borrado (cables se reubican si hay tipo compatible). | LGraphCanvas.ts:4925-4945 |
| Slot inválido | `connect()` devuelve null si el slot no existe (con nombre inexistente, log de error). No hay id estable de salida: es índice. | lib/litegraph/src/LGraphNode.ts:~3203-3230 |
| Lista/batch | Backend: un enlace del prompt es `[id_nodo, índice_salida]` (execution.py:946-949 `val[0]`, `val[1]`). Una salida de lista (OUTPUT_IS_LIST) es UNA sola salida cuyo contenido es una lista; el nodo consumidor se ejecuta por elemento salvo INPUT_IS_LIST. Cambiar la longitud no cambia el enlace. No hay «imagen n» direccionable. | ComfyUI/execution.py:254-335, 946-949 |
| Precio | Solo si `api_node` y hay `price_badge` compilado; si no, devuelve cadena vacía '' (sin insignia). Mientras se evalúa async devuelve la última etiqueta o ''. Es decir, precio desconocido = no se muestra nada, sin aviso. | composables/node/useNodePricing.ts:226-246 ; componente components/node/NodePricingBadge.vue |
| Saldo insuficiente | No hay comprobación previa en el cliente: `app.queuePrompt` envía el prompt y registra errores; el 402/«Insufficient credits to queue workflows» llega del servidor y se enruta a un catálogo de errores (`insufficient_credits`) con pantalla de créditos. El saldo se lee en authStore pero no bloquea el botón. | scripts/app.ts:1895-1935 ; platform/workflowErrors/errorCatalog/runtimeErrorMatcher.ts:32-42, 248-254 ; accountPreconditionRouting.ts:20 ; stores/authStore.ts:167,687 |
Corrección a la 1.ª entrega: «bloquea con saldo negativo» (doc) lo hace el servidor al encolar, no el cliente antes de ejecutar.

## Magnific Spaces y Figma Weave: acceso
- magnific.com/ai/docs/... : 403 «security filter» también con agent-browser (dos intentos, uno `--headed` ignorado por daemon activo). help.weavy.ai: bloqueado por Cloudflare en agent-browser y 403 en WebFetch. No se evadió la protección. Resto del apartado = secundaria o sin verificar.
- Weave, coste (secundaria, resumen de búsqueda de help.figma.com/hc/en-us/articles/33459875669015 y help.weavy.ai): el coste por ejecución se muestra antes; para herramientas con coste dinámico (p. ej. iterador dinámico) el agente avisa de que NO puede dar el coste antes de ejecutar; «Generate product variations» 110 créditos; la mayoría ~18-21. Pool de créditos de Weave separado del de Figma AI. Mensaje de créditos insuficientes y coste de variaciones/lotes: sin dato.
- Weave MCP (https://help.weavy.ai/en/articles/16202764-running-weave-tools-from-external-agents-mcp, secundaria por resumen de búsqueda): existe ejecución desde agentes externos; detalles no leídos.
- Magnific: ver apartado 2 (Run en botón con coste, Run Node/Workflow/Downstream, simulate_spaces) — secundaria. Sin créditos, recuperación, salidas múltiples: sin dato.

## Krea Nodes y Freepik Spaces (secundaria, una búsqueda)
- Freepik Spaces: el coste de cada nodo aparece al pasar el ratón; un nodo List que alimenta vídeo con 10 elementos puede consumir gran parte de la asignación mensual en una sola ejecución (fan-out multiplica coste) — https://kingy.ai/news/freepik-spaces-freepik-lists-review-the-bulk-creative-production-tool-agencies-have-been-waiting-for/
- Krea: mide en compute units; al agotarse, recarga o mejora de plan; hay comparativa oficial https://www.krea.ai/blog/freepik-spaces-vs-krea-nodes (no leída). Mensaje de saldo insuficiente, run downstream, variaciones: sin dato.

## Comparación revisada con vuestras correcciones
- Borrar resultado reubica cables / sin salida: ComfyUI reubica al borrar NODO (`connectInputToOutput`), pero no tiene resultados de lote direccionables; difiere de vuestro caso.
- Duplicar/pegar/soltar conservan salida: ComfyUI pegar conserva `origin_slot` (coincide); soltar cable filtra por el slot arrastrado (coincide); clonar un nodo suelto pierde todos los cables (difiere).
- Modelo del plan aprobado = el de la estimación: ComfyUI calcula precio de los widgets vivos del propio nodo (coincide en espíritu); no hay plan aprobado.
- Precio desconocido con límite: ComfyUI muestra '' sin aviso y no tiene límite de usuario documentado; el servidor rechaza al encolar si no hay saldo (difiere). Weave avisa de que el coste dinámico no se puede cotizar (parecido a «desconocido», sin límite de usuario documentado).
- Tarjeta de preguntas y «Check anyway»: sin dato en ninguna.

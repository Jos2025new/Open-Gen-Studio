# Revisión de la propuesta de núcleo de nodos

**Sí, se puede redactar el contrato** a partir de parámetros propios, puertos tipados, cálculo puro y acciones explícitas.  
**La tira puede empezar cuando se fijen** la identidad del destino, la resolución de entradas y las reglas de edición y ejecución.  
**Empezaría con texto y una generación en Omni.** Varios agentes y un Space ejecutable quedarían para después de demostrar ese recorrido.

Revisión estática de `task/sqlite-adopt` en `3f74fef4`, con la propuesta sin versionar del worktree. Las referencias al comportamiento de la app proceden del código.

## 1. Solidez del contrato

Houdini registra dependencias incluso fuera del cable visible y recalcula lo desactualizado bajo demanda. Maya declara qué entradas afectan a qué salidas y propaga la invalidación antes de evaluar. Blender conserva el original y evalúa una copia en el contexto de escena y capa de vista. ComfyUI reutiliza resultados según entradas y parámetros, y permite declarar cambios externos. La separación entre cálculo puro y acción explícita es una regla propia de OGS que protege el gasto y el historial. [Houdini HDK](https://www.sidefx.com/docs/hdk/_h_d_k__op_basics__overview__dependencies.html) · [Maya SDK](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-DEVHELP/files/Dependency-graph-plug-ins/Maya_DEVHELP_Dependency_graph_plug_ins_DirtyPropagation_html.html) · [Blender Python API](https://docs.blender.org/api/current/bpy.types.Depsgraph.html) · [ComfyUI](https://docs.comfy.org/custom-nodes/backend/server_overview#is-changed)

- **Identidad y contexto.** La dirección de un puerto debe incluir sesión, grafo, nodo y puerto estables. Los IDs de sistema se repiten por sesión. Una referencia móvil se declara como tal y se fija al preparar una ejecución. Una referencia fijada que falla conserva el cable inválido y bloquea la acción si es obligatoria. `src/engine/nodes/system.ts:75`, `src/engine/graphTypes.ts:100`.
- **Dependencias y frescura.** Resolver una vez las entradas efectivas y sus revisiones para vista previa, firma y ejecución. Un cambio de parámetro, enlace o contenido referenciado invalida los consumidores. Basta evaluar por nodo y bajo demanda con una firma de tipo/versión, parámetros y entradas resueltas. El último resultado puede verse como desactualizado. Hoy la firma y el plan resuelven entradas por rutas distintas, y `refNodeText` lee el store durante la resolución. `src/engine/flow/freshness.ts:37`, `src/engine/flow/graph.ts:428`, `src/engine/flow/refText.ts:8`.
- **Topología y efectos.** Rechazar ciclos en dependencias evaluables tanto al editar como al preparar la ejecución, incluidas referencias a otros pasos. Los enlaces de control declarativos pueden ser bidireccionales. Un envío o generación consume una instantánea aprobada, registra su ejecución por ID y liga el resultado al origen aunque cambie la vista. Reintentar la misma acción debe reconciliar el trabajo previo antes de volver a enviarlo. `src/engine/flow/graph.ts:153`, `src/engine/flow/graph.ts:345`, `src/engine/flow/graph.ts:381`, `src/engine/flow/actions.ts:362`.

## 2. Un solo camino de escritura

Sí, mediante una vista del mismo dato y un comando por operación, enlazados al dueño explícito. El mayor riesgo es cambiar el destino de un turno conservando una interfaz idéntica. `ChatNode` usa la sesión activa y monta el composer global. El envío toma adjuntos de ese composer, reúne destinatarios para los metadatos y lee prompts del primer agente. `llmTurn(sessionId)` selecciona el motor sin pasarle sesión ni agente. Cambiar solo el setter dejaría abiertos el cruce de borradores, el uso del modelo equivocado y la entrega al chat incorrecto. Pasar el destino desde la vista hasta el resultado y retirar la segunda escritura de cada campo al incorporarlo. `src/components/omni/ChatNode.tsx:17`, `src/components/omni/ChatNode.tsx:41`, `src/engine/agent/conversation.ts:31`, `src/engine/agent/runtimeShared.ts:108`, `src/engine/agent/llmTurn.ts:50`.

`baseAt` rechaza una base obsoleta al guardar. Para editar en el núcleo, usar la revisión esperada del dueño, aplicar cambios atómicos y devolver conflicto conservando el borrador cuando la base cambie. En un puerto de entrada único, la sustitución debe formar parte del comando explícito, con el cable anterior como precondición. Hoy ambos caminos pueden sustituir el cable y solo el comando de sistema aplica además configuración modelo→agente. `server/sqlite/store-b.js:280`, `src/engine/flow/graph.ts:197`, `src/engine/nodes/system.ts:573`, `src/engine/nodes/system.ts:592`.

## 3. Space y subnet

Encaja como modelo futuro. `GraphGroup` guarda miembros de un marco. `omni.ts` añade piezas ausentes en el grafo de la sesión y las vincula por referencia. Los puertos de Space ya se dibujan y el ejecutor recorre aristas de datos y referencias a pasos en un grafo plano. `src/engine/graphTypes.ts:114`, `src/engine/nodes/omni.ts:153`, `src/engine/nodes/spec.ts:84`, `src/engine/flow/graph.ts:345`.

La decisión previa es si **Space navega a un área de trabajo o encapsula una instancia evaluable que posee su grafo**. Mantendría la navegación actual durante la tira. Si se elige encapsular, definir qué devuelve la Salida y cómo se corresponden sus IDs externos con Entrada/Salida internas. Validar ciclos a través de esa frontera y normalizar a un plan plano para reutilizar el ejecutor. Conservar los marcos como presentación y el filtro del lienzo Nodes. [Subredes de Houdini](https://www.sidefx.com/docs/houdini/nodes/sop/subnet.html) · [Grupos de Blender](https://docs.blender.org/manual/en/5.1/interface/controls/nodes/groups.html)

## 4. Primera tira

**Texto editable → prompt de una generación existente**, desde Omni y con los controles actuales. Reutilizar el recorrido de texto que ya ensambla `graphToSteps`. La prueba de aceptación debe demostrar que una edición actualiza la vista previa, invalida el resultado anterior sin generar, invalida una aprobación vieja y que una ejecución aprobada queda ligada a su sesión al cambiar de vista. Puede verificarse con proveedor simulado. El chat con dos agentes sería la segunda tira para comprobar destinatario, historial y pendientes por instancia. Hoy el puerto de agente devuelve la última respuesta de la sesión sin distinguir agente. `src/engine/flow/graph.ts:428`, `src/engine/flow/actions.ts:364`, `src/engine/flow/refText.ts:8`.

## 5. Tres riesgos principales

1. **Grave. Respuesta o gasto en el destino equivocado, o gasto duplicado.** Fijar sesión, agente, configuración y autorización al preparar la acción. Reconciliar el reintento por ID usando el flujo de ejecución existente.
2. **Grave. Cables sustituidos o editados sobre una base vieja.** Unificar las operaciones de topología de UI y comandos. Validar revisión y cardinalidad en la misma edición. Mantener visible una referencia rota.
3. **Grave. La vista previa promete una entrada y se ejecuta otra.** Compartir el resolvedor y verificar la firma aprobada antes de ejecutar. Mantener la frontera Space fuera de la primera tira para conservar el significado de los cables actuales.

## Cambios concretos a la propuesta

1. Definir identidad de instancia y puerto, versión del esquema y tratamiento de referencias fijas, móviles e inválidas.
2. Fijar un resolvedor común para previsualizar, comprobar frescura y ejecutar, con evaluación bajo demanda.
3. Definir qué enlaces crean dependencias y dónde se rechazan los ciclos.
4. Reemplazar la promesa de resolver conflictos con `baseAt` por precondiciones de edición en el núcleo, conservando la protección de guardado.
5. Especificar la acción con destino, instantánea aprobada, ID de ejecución y reconciliación de reintentos.
6. Hacer de Space ejecutable una decisión explícita y conservar `GraphGroup` como marco.
7. Cambiar la primera tira a texto → generación y usar dos agentes como segunda prueba.

---
type: huecos
title: Huecos de Nodes
description: Lo que esta auditoría de Nodes no leyó o no pudo confirmar sin ejecutar, el estado que le da el rastreo y las pruebas que lo cerrarían.
tags: [nodes, huecos]
updated: 2026-10-29
related: [hallazgos, dependencias]
---
# Huecos de Nodes

Esta auditoría empezó como **lectura de código**; la evidencia posterior se separa por caso. No cubre rendimiento ni comportamiento del proveedor salvo donde se indique. Las pruebas locales usan el sandbox (`npm run dev:sandbox`, puerto 5183), nunca la app real.

## Qué queda abierto (2026-10-29)

**Enlace sin salida:** usa `out-gone` y monta un puerto no conectable con aviso para conservar el cable. `tests/no-result-port.test.ts` comprueba el puerto. El 2026-10-29 se vio el cable con indicador en sandbox con un grafo sintético, sin ejecutar proveedores; la reconexión no se comprobó. La carga de fuentes tuvo advertencias por las dependencias enlazadas, así que esa vista no valida tipografía.

**Sketch:** `nodeOutputAsset` respeta el enlace sin salida incluso si el nodo origen tiene un Sketch; se cubre con `tests/no-result-sketch.test.ts`. Sin prueba en pantalla.

La tabla y la lista siguiente son pendientes, no el inventario de todo lo ya resuelto. La regresión de índices/resultados se corrigió en `91ea576`, `ba66e08` y `5c65acc`; la discrepancia entre modelo estimado y ejecutado en `ea47987`. Hay tests automatizados para esos contratos y el caso de índices, duplicar y soltar cable se comprobó en sandbox con gasto real aprobado (detalles y límites en [auditoría](../audits/repro-2026-10-29.md)). No se ejecutaron las pruebas de esta revisión. Fuente: [rastreo de Nodes](../rastreo/nodes.md) y [Pendiente](../rastreo/README.md#pendiente-2026-10-28).

- **Pruebas en sandbox** (sin gasto ni datos reales):
  - **Enlace sin salida tras borrar su imagen:** corregido en `ba66e08` (`NO_RESULT`) y `5c65acc` (Run all no lo convierte en la primera imagen). `tests/repro-nodes-image.test.ts` y `tests/no-result-run-all.test.ts` cubren regeneración y ejecución conjunta; no se comprobó esta variante visual en sandbox. La reconexión deliberada sigue sin probarse en pantalla.
  - **Modelo estimado distinto del ejecutado:** corregido en `ea47987`; `tests/repro-nodes-model.test.ts` compara modelo de precio y modelo preparado. En sandbox con gasto real, la edición aprobada con Seedream 5.0 Flash mostró estimado y facturado de 0,027 USD. No implica que se haya probado cada operación/modelo.
  - Ejecución de `edit_region`, `remove_object` y `create_voice` desde un nodo (H12), con proveedor de coste 0 o simulado.
  - `edit_node.model_ref` con un agente real; campos `required` vacíos; recarga durante una ejecución; accesibilidad por teclado; ajustes ocultos hasta el proveedor; coste de `previewRun`.
- **Lectura pendiente** (sin ejecutar la app): migraciones del formato de guardado de `graph` (solo lectura: zona protegida).
- **Decisiones o pruebas pendientes**: observar el criterio contextual del usuario aplicado a `edit_node` y decidir si requiere una guarda compatible (H1, [hallazgos](hallazgos.md)); alcance de las excepciones del límite (H4/H17); modelo visible de las operaciones de imagen (H2); confirmar «Delete asset» (H3); aviso al soltar enlaces (H5/H6); marca de desactualizado (H15); si el bloqueo de Undo durante un Run debe permanecer (H10).
- **Preguntas a proveedor**: qué responde con una instrucción vacía en `edit`, `replace_background`, `video_edit`, `video_extend` (H13); efecto real de los ajustes ocultos copiados (H8).
- **Comentario obsoleto en `locks.ts:12`** («cannot be edited»): cambio de código, para después; `locks.ts:4-7` y `:27` dicen que editar es libre.
- **Decisiones que faltan en la lista anterior**: aviso al ajustar aspecto, resolución o duración al cambiar de modelo (H9); confirmar Auto layout (H16); Stop por nodo (H11); solapamiento de acciones con el pase y precio desconocido (H4/H17; [Studio H4/H5](../studio-controles/hallazgos.md)); ADR 0009 frente al modelo del origen en Nodes (rastreo 5.1).
- **Sospechas del rastreo sin probar**: Run cuya confirmación no hace nada sin decirlo (3.8); error de bloqueo no capturado ante dos clics (3.10); tooltip «Use output N downstream» (5.6).
- **Ajuste en ADR 0009** (fuera de este registro): su texto y alcance requieren revisión frente al código actual: en las operaciones que siguen al origen se respeta `_modelRef` confirmado desde `ea47987`; sin esa elección se usa la ruta del origen. No implica que todas las operaciones ya muestren el modelo o proveedor.

Vocabulario de estado: «respondido por lectura» (el código lo explica; no es que esté corregido ni que una prueba pendiente pasara), «respondido parcialmente», «requiere prueba», «requiere decisión». «Sin decisión encontrada» no equivale a olvido.

## Tabla de huecos

| Hueco | Qué falta | Prueba que lo cierra | Estado del rastreo |
| --- | --- | --- | --- |
| Comportamiento real del agente con `edit_node.model_ref` (H1) | El criterio contextual ya está documentado; falta observar una sesión real y decidir si hace falta una guarda general compatible con ese criterio | Reproducir en el sandbox con una petición ambigua y observar cambios de precio/cascada | **Requiere prueba · requiere decisión de protección.** El criterio del usuario permite cambios similares y pide aviso/consulta según contexto para modelos más caros, sin cascadas; la regla de `changeRules.ts:2` sigue siendo de `confirm_settings`, no de `edit_node`. [Criterio H1](hallazgos.md), [rastreo 3.3](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Efecto real de los ajustes ocultos copiados al nodo (H8) | No se siguió la ruta hasta la petición al proveedor | Ejecutar un nodo con realismo activo y comparar la petición | **Requiere prueba** (y pregunta a proveedor). Sin respuesta en docs. [Rastreo 4](../rastreo/nodes.md#4-respuestas-a-hallazgos-h1h17-y-huecos) |
| Ejecución de `edit_region`, `remove_object`, `create_voice` desde un nodo (H12) | La ruta de Nodes está trazada en código, pero no se ejecutaron estas operaciones desde un grafo | Ejecutarlos en el sandbox con un proveedor de coste 0 o simulado | **Respondido parcialmente · requiere prueba.** `nodes.tsx:657-667` ofrece `OP_IDS` en el selector; `flow/actions.ts:217-230, 347-350` prepara operaciones de nodos y llama `executeSteps`. `tests/masks.test.ts:87-117` prueba envíos de `edit_region`/`remove_object` por `opSpec`, no por `runNodes`; `:120-125` comprueba exclusiones de otros menús/rutas, no del selector de Nodes. `fromChat.ts:26` habla de importar resultados, no demuestra que ejecutar desde Nodes sea imposible. [Rastreo 5.8](../rastreo/nodes.md#5-contradicciones-entre-docs-y-con-el-código) |
| Validación de campos `required` (H13) | Solo se leyó la interfaz | Ejecutar una operación con un campo vacío | **Respondido parcialmente · requiere prueba.** Se validan entradas y assets (`flow/actions.ts:258`); no los `required` de operaciones (la ficha de assets sí, `opRun.tsx:70`). Falta ver la respuesta del proveedor. [Rastreo 3.4](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Recuperación tras recargar durante una ejecución y cancelación desde otras superficies (H11) | Stop/Comprobar por nodo no existen en `components/node`; falta ver el hilo | Ejecutar, recargar y cancelar en el sandbox | **Respondido parcialmente · requiere prueba.** `locks.ts` es un `Map` en memoria (se pierde al recargar; las generaciones persisten). Resto sin leer. [Rastreo 4](../rastreo/nodes.md#4-respuestas-a-hallazgos-h1h17-y-huecos) |
| Coste de `previewRun` en cada cambio (H14) | No medido | Sonda según docs/depuracion.md | **Respondido por lectura · requiere prueba.** Decisión deliberada (`docs/history/002-2026-10-W40.md:39`); coste sin medir. |
| Formato de guardado de `graph` y migraciones | No se leyó la persistencia | Leer `docs/persistencia-protegida.md` (zona protegida: solo lectura) | **Respondido parcialmente.** `GraphEdge.outputIndex` es opcional y los grafos antiguos se leen igual (`types.ts:659`, `docs/history/050-2026-10-W43.md:11`); migraciones sin leer. |
| Marca visual de nodo desactualizado (H15) | La búsqueda registrada en estilos y componentes no encontró coincidencias; no cubre otros mecanismos | Captura en el sandbox solo si se decide añadirla | **Respondido parcialmente por lectura · requiere decisión.** La búsqueda acotada no halló marca en estilos/componentes; no demuestra ausencia global. Tampoco se encontró decisión de producto. |
| Efecto de borrar un asset sobre un nodo de generación que lo tiene como resultado | El primer inventario solo había leído el caso del nodo Asset | Borrar y reconectar en sandbox | **Corregido; evidencia mixta.** `91ea576` reubica `outputIndex` de nodos/cables y conserva el puerto al duplicar, pegar y soltar; `ba66e08` marca `NO_RESULT` (-1, `out-gone`) si se borra la imagen elegida por el cable; `5c65acc` hace que Run all falle con «has no output», también si el origen está en el lote. Tests: `tests/repro-nodes-image.test.ts`, `tests/no-result-run-all.test.ts`; sandbox con gasto real aprobado: borrar resultado 1 de 3, duplicar destino y soltar desde 2, verificado en [auditoría](../audits/repro-2026-10-29.md). **Pendiente:** la rama `NO_RESULT` y Run all solo tienen evidencia automatizada; la reconexión no se comprobó visualmente. Los índices fuera de rango preexistentes al cambio no se pueden distinguir y conservan su estado. [Rastreo 3.6](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Accesibilidad por teclado del lienzo (foco, flechas) | No se auditó | Prueba con teclado en el sandbox | **Requiere prueba.** Sin respuesta en docs. |

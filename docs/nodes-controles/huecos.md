---
type: huecos
title: Huecos de Nodes
description: Lo que esta auditoría de Nodes no leyó o no pudo confirmar sin ejecutar, el estado que le da el rastreo y las pruebas que lo cerrarían.
tags: [nodes, huecos]
updated: 2026-10-28
related: [hallazgos, dependencias]
---
# Huecos de Nodes

Esta auditoría es de **lectura de código**. No cubre comportamiento en pantalla, rendimiento ni proveedores. Cada punto necesita la prueba indicada en el sandbox (`npm run dev:sandbox`, puerto 5183), nunca en la app real.

## Qué queda abierto (2026-10-28)

Nada de esto está hecho. Es la lista completa de lo que la tabla deja abierto; será el punto de partida de las pruebas automatizadas. Fuente: [rastreo de Nodes](../rastreo/nodes.md) y [Pendiente](../rastreo/README.md#pendiente-2026-10-28).

- **Pruebas en sandbox** (sin gasto ni datos reales):
  - Imagen equivocada: borrar un resultado ([3.6](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas)) o duplicar un nodo / soltar un cable en el fondo (3.5) deja una conexión apuntando a otro resultado. Corregido en la rama (borrar reubica, duplicar/pegar/soltar conservan el puerto); falta prueba en pantalla.
  - Modelo distinto: la estimación usa `params._modelRef` (`executor.ts:87`) y la ejecución de operaciones de imagen lo ignora (`flow/actions.ts:217-228`, `jobs.ts:1074`). Reproducción gratuita.
  - Ejecución de `edit_region`, `remove_object` y `create_voice` desde un nodo (H12), con proveedor de coste 0 o simulado.
  - `edit_node.model_ref` con un agente real; campos `required` vacíos; recarga durante una ejecución; accesibilidad por teclado; ajustes ocultos hasta el proveedor; coste de `previewRun`.
- **Lectura pendiente** (sin ejecutar la app): migraciones del formato de guardado de `graph` (solo lectura: zona protegida).
- **Decisiones del usuario** (sin decisión encontrada en historial ni ADR): guarda para `edit_node` (H1); H4/H17 (límite global y precios desconocidos); modelo visible de las operaciones de imagen (H2); confirmar «Delete asset» (H3); aviso al soltar enlaces (H5/H6); marca de desactualizado (H15); si el bloqueo de Undo durante un Run debe permanecer (H10).
- **Preguntas a proveedor**: qué responde con una instrucción vacía en `edit`, `replace_background`, `video_edit`, `video_extend` (H13); efecto real de los ajustes ocultos copiados (H8).
- **Comentario obsoleto en `locks.ts:12`** («cannot be edited»): cambio de código, para después; `locks.ts:4-7` y `:27` dicen que editar es libre.
- **Decisiones que faltan en la lista anterior**: aviso al ajustar aspecto, resolución o duración al cambiar de modelo (H9); confirmar Auto layout (H16); Stop por nodo (H11); «Continue anyway» global y precios desconocidos fuera del límite (H4/H17, [Studio H4/H5](../studio-controles/hallazgos.md)); ADR 0009 frente al modelo del origen en Nodes (rastreo 5.1).
- **Sospechas del rastreo sin probar**: Run cuya confirmación no hace nada sin decirlo (3.8); error de bloqueo no capturado ante dos clics (3.10); tooltip «Use output N downstream» (5.6).
- **Ajuste en ADR 0009** (fuera de este registro): no dice que se limita a planes de chat; el código de Nodes sigue usando el modelo del origen.

Vocabulario de estado: «respondido por lectura» (el código lo explica; no es que esté corregido ni que una prueba pendiente pasara), «respondido parcialmente», «requiere prueba», «requiere decisión». «Sin decisión encontrada» no equivale a olvido.

## Tabla de huecos

| Hueco | Qué falta | Prueba que lo cierra | Estado del rastreo |
| --- | --- | --- | --- |
| Comportamiento real del agente con `edit_node.model_ref` (H1) | La política (`changeRules.ts`) está leída; falta ver si un agente cambia el modelo por su cuenta | Reproducir en el sandbox con una petición ambigua | **Requiere prueba · requiere decisión.** La regla de `changeRules.ts:2` es de `confirm_settings`; sin decisión encontrada para `edit_node`. [Rastreo 3.3](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Efecto real de los ajustes ocultos copiados al nodo (H8) | No se siguió la ruta hasta la petición al proveedor | Ejecutar un nodo con realismo activo y comparar la petición | **Requiere prueba** (y pregunta a proveedor). Sin respuesta en docs. [Rastreo 4](../rastreo/nodes.md#4-respuestas-a-hallazgos-h1h17-y-huecos) |
| Ejecución de `edit_region`, `remove_object`, `create_voice` desde un nodo (H12) | No se leyó el ejecutor | Ejecutarlos en el sandbox con un proveedor de coste 0 o simulado | **Respondido parcialmente · requiere prueba.** `fromChat.ts:26` solo describe la importación del chat (no prueba que no se ejecuten; contradice los selectores, [5.8](../rastreo/nodes.md#5-contradicciones-entre-docs-y-con-el-código)). |
| Validación de campos `required` (H13) | Solo se leyó la interfaz | Ejecutar una operación con un campo vacío | **Respondido parcialmente · requiere prueba.** Se validan entradas y assets (`flow/actions.ts:258`); no los `required` de operaciones (la ficha de assets sí, `opRun.tsx:70`). Falta ver la respuesta del proveedor. [Rastreo 3.4](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Recuperación tras recargar durante una ejecución y cancelación desde otras superficies (H11) | Stop/Comprobar por nodo no existen en `components/node`; falta ver el hilo | Ejecutar, recargar y cancelar en el sandbox | **Respondido parcialmente · requiere prueba.** `locks.ts` es un `Map` en memoria (se pierde al recargar; las generaciones persisten). Resto sin leer. [Rastreo 4](../rastreo/nodes.md#4-respuestas-a-hallazgos-h1h17-y-huecos) |
| Coste de `previewRun` en cada cambio (H14) | No medido | Sonda según docs/depuracion.md | **Respondido por lectura · requiere prueba.** Decisión deliberada (`docs/history/002-2026-10-W40.md:39`); coste sin medir. |
| Formato de guardado de `graph` y migraciones | No se leyó la persistencia | Leer `docs/persistencia-protegida.md` (zona protegida: solo lectura) | **Respondido parcialmente.** `GraphEdge.outputIndex` es opcional y los grafos antiguos se leen igual (`types.ts:659`, `docs/history/050-2026-10-W43.md:11`); migraciones sin leer. |
| Marca visual de nodo desactualizado (H15) | Búsqueda en estilos y componentes hecha: sin coincidencias | Captura en el sandbox solo si se decide añadirla | **Respondido por lectura · requiere decisión.** No existe marca (sin coincidencias en estilos y componentes); sin decisión encontrada. |
| Efecto de borrar un asset sobre un nodo de generación que lo tiene como resultado | Solo se leyó el caso del nodo Asset | Borrar en el sandbox | **Respondido por lectura · requiere prueba.** `deleteAssets` reubica `outputIndex` de nodos y cables con `flow/dropResults.ts`; un cable cuya imagen se borró queda sin salida. [Rastreo 3.6](../rastreo/nodes.md#3-regresiones-y-contradicciones-con-promesas) |
| Accesibilidad por teclado del lienzo (foco, flechas) | No se auditó | Prueba con teclado en el sandbox | **Requiere prueba.** Sin respuesta en docs. |

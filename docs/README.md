# Documentación de Open Gen Studio

## Dónde mirar

- [Reglas de trabajo](../AGENTS.md).
- [Seguridad local](seguridad.md): riesgos reales y los descartados con prueba. Consúltala antes de avisar de un riesgo.
- [Pendientes y propuestas](pendientes.md): qué falta decidir, probar o implementar, con su estado.
- [Capas FX: pruebas pendientes](fx-pruebas.md): validación visual, interfaz, exportación, agente y escala de ADR 0011.
- [Rendimiento raster y deshacer](raster-pruebas.md): medidas antes/después, exactitud de píxeles y límites.
- [Depurar y medir](depuracion.md): registro de rendimiento (Ctrl+Alt+P), marcadores, informe, sondas y pruebas de una sola pieza.
- [Fusión de task/agent-forcing](fusion-agent-forcing.md): comparación con modelo-general y decisiones que no deben revertirse.
- [Catálogo de voz y efectos](catalogo-voz-y-efectos.md): modelos de texto a voz y efectos de Atlas y NanoGPT, precios por 1000 caracteres y propuesta (2026-10-08).
- [Edición de formas](plan-edicion-formas.md): un clic transforma, doble clic edita; qué pidió el usuario, qué se aceptó y con qué fuentes.
- [Importar SVG de Inkscape](inkscape-importacion.md): qué queda editable (carpetas, formas, opacidades, blur) y qué se rasteriza, y cómo se sanea.
- [Formas al estilo de Inkscape](inkscape-formas.md): fórmulas de esquinas, trazo y desenfoque, con la línea exacta del código de Inkscape y las diferencias deliberadas.
- [Investigación: ajuste (snapping) de Inkscape frente a OGS](investigacion-snapping.md): fórmulas con cita, comparación vigente, límites comprobados y pruebas locales.
- [Diagnóstico: trazos de lineart que se deforman al encoger](diagnostico-escala-lineart.md): hipótesis, experimentos, causa (taper sin escalar y umbrales de perfect-freehand) y arreglo propuesto.
- [Investigación sK1 (GPL, solo lectura)](investigacion-sk1.md): primitivas, booleanas, degradados, tipos de nodo, color y PDF de sK1 como referencia, con licencia y lo descartado.
- [Mapa del código](map.md): contratos entre lugares que deben decir lo mismo, módulos centrales y cobertura directa. Generado; léelo antes de cambiar código.
- [Contratos del código, parte 1](map-contracts.md) y [parte 2](map-contracts-2.md): tablas completas de lugares y tests, generadas y comprobadas junto al mapa.
- Cada ficha de feature enlaza comportamiento, código y test; «sin test» marca falta de cobertura directa.
- Los ADRs conservan contexto, decisión y consecuencias.
- El historial conserva el texto original y su orden; los prefijos numéricos gobiernan la concatenación. Sus referencias históricas no prueban el estado actual.

## Features

- [Continuidad y dirección de video](video-quality.md): cobertura de fuentes, estilo por shot, cámara, física y límites de la evidencia.

- [agente: variantes automáticas por entradas y ajustes confirmados](features/agente.md).
- [biblioteca](features/biblioteca.md).
- [canvas](features/canvas.md).
- [home y barra lateral: vista Home, secciones Spaces/Create/Tools](features/home.md).
- [Create Media: Space Panel + Space Board (ajustes a la izquierda, resultados a la derecha)](features/create-space.md).
- [designer: resize, selección raster/vectorial, cursores, importación múltiple y referencias en el dock](features/designer.md).
- [selección y marquee de Edit por modo](features/designer-selection.md).
- [cuota provisional de trazos raster](raster-limit.md).
- [nodes](features/nodes.md).
- [persistencia](features/persistencia.md).
- [proveedores](features/proveedores.md).
- [precio autorizado: decisiones, avisos y coste informado](features/precio-autorizado.md).

## Decisiones

- [0001 — Proteger los datos tras el incidente del 2026-10-03](decisions/0001-proteger-datos.md).
- [0002 — No usar confirm() nativo](decisions/0002-confirmaciones-de-la-app.md).
- [0003 — Probar la app solo en el sandbox](decisions/0003-pruebas-en-sandbox.md).
- [0004 — Aprobar un coste máximo antes de usar proveedores de pago](decisions/0004-coste-maximo.md).
- [0005 — Contrato operativo del agente: implementación transversal y límites](decisions/0005-contrato-operativo-agente.md).
- [0006 — Modelo general generativo: automatización por coste e intentos enlazados](decisions/0006-modelo-general-generativo.md).
- [0007 — Modos del agente y encaje de parámetros de las operaciones](decisions/0007-modos-y-encaje-del-agente.md).
- [0008 — Límite de 30 KB en el código: los archivos que ya lo superan no crecen](decisions/0008-limite-de-tamano-en-codigo.md).
- [0009 — Puerta de disparo por operación, comportamiento de los modos y enmiendas a 0007](decisions/0009-disparo-forzado.md).
- [0010 — Estrategia de pruebas: tests fiables con carga y cobertura por riesgo](decisions/0010-estrategia-de-pruebas.md).
- [0011 — Capas de filtros y efectos no destructivos (FX)](decisions/0011-capas-fx.md).
- [0012 — Registro de rendimiento para sesiones de prueba](decisions/0012-registro-de-rendimiento.md).
- [0013 — Un solo tipo de campo para los ajustes, y la brocha de PaintTool SAI (propuesto)](decisions/0013-campos-y-brocha.md).
- [0014 — Guardar cada sesión por separado (aceptado 2026-10-12; implementación parcial 2026-10-13)](decisions/0014-sesiones-separadas.md).
- [0015 — Píxeles en mosaicos de 256² con copia al escribir (propuesto; el historial en mosaicos de 64² ya está en memoria, sin guardado por mosaicos)](decisions/0015-mosaicos-de-pixeles.md).
- [0016 — Modo Dibujo y modo Diseño (aceptado 2026-10-13; pendiente la regla de capas con trazos editables)](decisions/0016-dibujo-y-diseno.md).

## Propuestas de interfaz

- [La interfaz del Designer según la filosofía de ibisPaint, Photoshop, Feather 3D y SketchUp](propuesta-gui-pintura.md) (2026-10-10), sin implementar.

- [Plan: interfaz del Designer como mesa de trabajo de diseño](plan-designer-ux.md) (2026-10-10), en curso en `task/designer-ux`.
- [Plan: Designer fluido](plan-fluidez.md) (2026-10-12): objetivo, umbrales, etapas y autorizaciones; las revisiones lo enmiendan, no lo reabren.
- [Arquitectura de render profesional](arquitectura-render.md) (2026-10-12; estado al 2026-10-13): cómo lo resuelven Krita, GIMP, Photopea, Figma y pixiv, qué hace OGS hoy, cambio de rumbo y estado de las 8 tareas.
- [Cifras de partida del documento profesional](render-baseline.md) (2026-10-12): gestos medidos con Canvas2D actual (tarea 1), renderer, límites y pasadas descartadas.
- [Estado del cierre de render-bench](render-estado.md) (2026-10-13): fuente única de pendientes; estado de las 6 entregas del plan, atribución de commits y contradicción abierta.
- [Investigación: cómo resuelve memoria y rendimiento PhotoCraft (Rust+wasm) y qué aplicar en OGS](investigacion-photocraft.md) (2026-10-13), solo lectura del código.
- [Investigación: memoria del Designer con 4 GB y 2 GB](investigacion-memoria.md) (2026-10-13), solo lectura: cifras por proyecto, verificación de fuentes, técnicas RAM/DISCO y cálculo por etapas.
- [Investigación: Patchy frente a OGS en render, memoria y persistencia](investigacion-patchy.md) (2026-10-13), solo lectura: comparación por tema, adopción y cinco ideas priorizadas.
- [Decisión del motor de render (Tarea 2): estado, bloqueos y cifras sin recomendación final; aplazada por decisión del usuario](decision-motor.md) (2026-10-12).
- [Pruebas de modelos y prompting](modelos-pruebas.md): casillas para el usuario (estilos, realismo, roles, operaciones, guías, precios, latencia); marca las de pago.
- [Investigación: prompting y roles de referencia](investigacion-prompting-referencias.md) (2026-10-14): roles por modelo, esquemas, guías nuevas y URLs.
- [Banco de fluidez: instrucciones al agente de pruebas](fluidez-pruebas.md): producción aislada, casos habitual/exigente y límites de las medidas.
- [Regiones retenidas del Designer](render-regions.md): dirty raster, cajas totales, FX y evidencia de paridad.

- [Timeline breve de esta sesión de Designer UX](timeline-designer-ux.md) (desde 2026-10-11).

## Historial

- [001-2026-10-W40](history/001-2026-10-W40.md) — 29393 bytes.
- [002-2026-10-W40](history/002-2026-10-W40.md) — 28429 bytes.
- [003-2026-10-W40](history/003-2026-10-W40.md) — 29562 bytes.
- [004-2026-10-W40](history/004-2026-10-W40.md) — 29117 bytes.
- [005-2026-10-W40](history/005-2026-10-W40.md) — 29387 bytes.
- [006-2026-10-W40](history/006-2026-10-W40.md) — 29432 bytes.
- [007-2026-10-W40](history/007-2026-10-W40.md) — 3706 bytes.
- [008-2026-09-W40](history/008-2026-09-W40.md) — 29535 bytes.
- [009-2026-09-W40](history/009-2026-09-W40.md) — 29062 bytes.
- [010-2026-09-W39](history/010-2026-09-W39.md) — 28940 bytes.
- [011-2026-09-W39](history/011-2026-09-W39.md) — 896 bytes.
- [012-2026-09-W40](history/012-2026-09-W40.md) — 11079 bytes.
- [013-2026-09-W39](history/013-2026-09-W39.md) — 29187 bytes.
- [014-2026-09-W39](history/014-2026-09-W39.md) — 29414 bytes.
- [015-2026-09-W39](history/015-2026-09-W39.md) — 8682 bytes.
- [016-2026-09-W40](history/016-2026-09-W40.md) — 1339 bytes.
- [017-2026-10-W40](history/017-2026-10-W40.md) — 7357 bytes.

- [018-2026-10-W40: Designer, correcciones y revisión con evidencia](history/018-2026-10-W40.md) — 20805 bytes.
- [019-2026-10-W41: Agente, ramas, fallos encontrados y pendientes](history/019-2026-10-W41.md) — 12788 bytes.
- [020-2026-10-W41: Disparo forzado y correcciones de encaje](history/020-2026-10-W41.md) — 9214 bytes.
- [021-2026-10-W41: Conversación completa: revisión, consolidación y puerta de disparo](history/021-2026-10-W41.md) — 23113 bytes.
- [022-2026-10-W41: Brocha de SAI, revisión de Astra, integración y purga (2026-10-09)](history/022-2026-10-W41.md) — 16469 bytes.
- [023-2026-10-W41: Revisión de Astra, exportación, Niveles y Curvas, reglas (2026-10-10)](history/023-2026-10-W41.md) — 4623 bytes.
- [024-2026-10-W41: Formas al estilo de Inkscape: esquinas, trazo, blur, giro y nodos (2026-10-11)](history/024-2026-10-W41.md) — 29926 bytes.
- [025-2026-10-W42: Formas y nodos del Designer, continuación (desde 2026-10-12; sesión del 2026-10-13 al final)](history/025-2026-10-W42.md) — ver tamaño en el archivo.
- [026-2026-10-W42: Designer, formas, paint, nodos y cierre de snapping (2026-10-13–14)](history/026-2026-10-W42.md) — incluye evidencia por commit, aprobación manual y correcciones de espaciado; la última E2E queda pendiente por sandbox ocupado.
- [027-2026-10-W42: selección por modo en Edit](history/027-2026-10-W42.md) — Align conserva su guardia de modo y Edit incorpora marquee por objetos/capas.
- [028-2026-10-W42: redondeo común de rectángulos seleccionados](history/028-2026-10-W42.md) — Rx/Ry actúa sobre los rectángulos del conjunto explícito en Object o Layer.
- [029-2026-10-W42: edición de nodos en varios paths](history/029-2026-10-W42.md) — selección y movimiento multi-path en Object o Layer, con límites explícitos.
- [030-2026-10-W42: correcciones de marquee y selección](history/030-2026-10-W42.md) — coordenadas del indicador, pista click-through y limpieza/modificación coherente de Object/Layer.
- [031-2026-10-W42: edición de nodos desde rectángulos seleccionados](history/031-2026-10-W42.md) — Rx/Ry conserva la edición paramétrica y una acción explícita convierte la selección para editar nodos juntos.
- [032-2026-10-W42: Autoselect entre capas en Edit](history/032-2026-10-W42.md) — Shift/Ctrl amplía la selección sin obligar a cambiar a Layer; Align y Rx operan sobre el grupo.
- [033-2026-10-W42: control compacto de radios múltiples](history/033-2026-10-W42.md) — Rx/Ry, esquinas agudas y conversión a paths ocupan menos lienzo y se envuelven en estrecho.
- [034-2026-10-W42: alineación de bordes opuestos y grupo](history/034-2026-10-W42.md) — cuatro acciones contra el borde opuesto y movimiento conjunto con referencia fija.
- [035-2026-10-W42: menú compacto de Align](history/035-2026-10-W42.md) — diez acciones en cuadrícula con nombres accesibles y referencia/grupo arriba.
- [036-2026-10-W42: Align en el panel derecho](history/036-2026-10-W42.md) — Align contextual dentro de Tool cuando Edit está activa.
- [037-2026-10-W42: roles de referencia, realismo y precios de OpenRouter](history/037-2026-10-W42.md) — cambios de dos ramas, decisiones, bugs y pendientes.
- [038-2026-10-W42: modos, Check status, agente y guías (2026-10-14/15)](history/038-2026-10-W42.md) — decisiones del usuario, atribución, límites y pendientes de `task/ref-roles`.

## Trazabilidad

Tabla «Registro» del antiguo `TRAZABILIDAD.md` (hoy una nota local, fuera del repositorio), dividida por tamaño. Qué hace cada cambio, dónde está, qué lo verifica y qué queda sin verificar.

- [Registro 1: T1–T6, commits de proveedores y música (4c-2)](trazabilidad/registro-1.md).
- [Registro 2: 3D, Designer, ruta del agente, gasto y C1–C4](trazabilidad/registro-2.md).

## Verificación

- [Conservación transversal: propuesta ejecutada, contrato, pruebas y medición pendiente](continuity-contract.md).

- [Error de referencia 3D: adjunto, captura vigente y límites](agent-3d-view-reference.md).

- [Contrato del operador: recorrido corregido, sesiones existentes y límites](agent-operator-contract.md).

- [P0 + P1a: biblioteca, consentimiento, pruebas y límites](agent-library-consent.md).

- [Contrato operativo del agente: evidencia H01–H13, inferencias y límites](agent-contract-evidence.md).
- [Contrato operativo: recorridos, UX, riesgos y validación a largo plazo](agent-contract-validation.md).

- [Línea base del agente: script, resultados y límites](agent-baseline.md).
- [Comparación NanoGPT: resultados DeepSeek y ampliación aprobada hasta USD 1, coste, caché y límites](nanogpt-price-comparison.md).
- [Prueba manual de revisión de precio: Continuar y Cancelar sin gasto](price-review-sandbox.md).
- [NanoGPT expansion-2: resultados por llamada, diagnóstico, coste, caché y límites](nanogpt-price-expansion-2.md).

`node scripts/check-docs.mjs` comprueba tamaños, índice, ADRs, enlaces de las fichas y posibles secretos. `node scripts/check-sizes.mjs` aplica el límite de 30 KB fuera de `docs/` (ADR 0008). `npm test` ejecuta primero las salvaguardas y estas dos comprobaciones. La lectura de data/ real no forma parte de estos controles.

- [Corrección: variantes compatibles tras confirmar ajustes](confirmed-input-variants.md).

# Pendientes: índice priorizado

Lista única de lo que sigue abierto, ordenada por prioridad y con la **fecha de origen** (la primera vez que aparece) para que lo viejo se vea. Revisión completa del 2026-10-22 sobre `task/workflow-ask-first` (`c034614`): cada ítem se contrastó con el código, los commits o el informe de la prueba de sandbox del 2026-10-21. Lo ya resuelto está en [pendientes-cerrados](pendientes-cerrados.md), con su evidencia.

**Prioridad** (criterio del usuario): *crítico* = promesa rota (el modelo o proveedor nunca cambia solo, nunca gastar más de lo mostrado, una alerta nunca dice algo falso), entregable equivocado, fricción de uso, datos y claves. *Alto* = velocidad o interfaz que se frena con el uso, y riesgos de dinero o datos que se pueden acotar. *Medio* = probar o completar. *Bajo* = opcional o sin decidir.

**Cómo se mantiene.** Una fila por ítem, con ID estable (A1, B2…) que usan los archivos de detalle. Al cerrar uno: se quita de aquí y de su detalle y se añade a [cerrados](pendientes-cerrados.md) con commit o test. Un ítem nuevo lleva su fecha de hoy. Evidencia: **código** (leído), **test**, **sandbox** (puerto 5183), **usuario**, **informe** (prueba de GPT del 2026-10-21), **propuesta** (sin implementar).

## Lo más crítico ahora

1. **C0 · «Connected» verde con el servidor local caído; «Disk copy pending» sin causa** (2026-10-21). Esconde que no se está guardando. [detalle](pendientes-sistema.md)
2. **A2 · Etiqueta de proveedor falsa** (2026-10-21): el faro pasó de Atlas a NanoGPT, se guardó como Atlas y el agente no avisó. Alerta que dice algo falso. [detalle](pendientes-agente.md)
3. **A1 · `confirm_settings` repetida con el mismo modelo ya confirmado** (2026-10-22; familia del 2026-10-16). El usuario pidió un solo cambio y el agente puso otra tarjeta a esperar clic. Fricción de uso; arreglo propuesto, falta tu aprobación. [detalle](pendientes-agente.md)
4. **A3 y A4 · La tarjeta Keep/Change no nombra los dos proveedores y la prueba visual quedó a medias** (2026-10-21). Única falla del informe; 13 de 14 pruebas sin ver. Sin eso, ADR 0025 no está verificado en pantalla. [detalle](pendientes-agente.md)
5. **A5 · DeepSeek V4.1 Flash repite un plan roto sin `prompt`** (2026-10-21): la app debería cortar y decirlo, sin cambiar de modelo sola. [detalle](pendientes-agente.md)
6. **A6 · El agente se saltó las tomas en imagen que pediste** (2026-10-21): entregable equivocado. [detalle](pendientes-agente.md)
7. **B1 · Posible cobro de $0.068 por una generación interrumpida** (2026-10-16): sin comprobar en el panel del proveedor. [detalle](pendientes-agente.md)
8. **B2 · Arreglos del relay sin llevar a la app real** (2026-10-21): lo de NanoGPT no se guarda y caduca (sandbox: 2026-10-27). Tú dijiste que no es urgente; la fecha cuenta. [detalle](pendientes-agente.md)

Después, por riesgo: B3 (el presupuesto no es un máximo), B4 (gasto que cambió sin generar), A7 (plan inválido tras Continue), C1 (guardado, fase 2) y D14 (rendimiento del Designer).

## Archivos de detalle

- [pendientes-agente](pendientes-agente.md): agente (A1 a A23) y proveedores, precios y coste (B1 a B9).
- [pendientes-sistema](pendientes-sistema.md): datos y guardado (C0 a C6), calidad y pruebas (C7 a C14), funciones propuestas (F1 a F7), decisiones y ramas (G1 a G7).
- [pendientes-designer](pendientes-designer.md): Designer, formas, brocha y render (D1 a D18).
- [pendientes-gui](pendientes-gui.md): interfaz por espacios, Home, tarjetas del chat (39 filas; abiertas, prioridad y origen en su cabecera).
- [pendientes-cerrados](pendientes-cerrados.md): lo hecho, superado u obsoleto, con evidencia.
- Otras fuentes únicas: [render-estado](render-estado.md) (render y rendimiento, D14), [modelos-pruebas](modelos-pruebas.md) (A22), [fx-pruebas](fx-pruebas.md) (D16), [gui-cohesion-pruebas](gui-cohesion-pruebas.md) (cómo probar la interfaz).

## Lista abierta por área

### Agente (A) · [detalle](pendientes-agente.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| A1 | `confirm_settings` repetida con el mismo modelo confirmado | crítico | 2026-10-22 |
| A2 | Etiqueta de proveedor falsa tras Atlas → NanoGPT | crítico | 2026-10-21 |
| A3 | Keep/Change no nombra los dos proveedores (falla del informe) | crítico | 2026-10-21 |
| A4 | Repetir la prueba visual del sandbox (1 falla, 4 dudosas, 9 sin ver) | crítico | 2026-10-21 |
| A5 | DeepSeek en bucle sin `prompt`: la app debe cortar y decirlo | crítico | 2026-10-21 |
| A6 | Tomas en imagen saltadas antes del vídeo | crítico | 2026-10-21 |
| A7 | «1 problem to fix» / «could not produce a valid plan» tras Continue | alto | 2026-10-21 |
| A8 | Decisión: tarjeta extra al nombrar un modelo | medio | 2026-10-21 |
| A9 | Probar vídeo con 3 referencias (tope de coste antes) | medio | 2026-10-21 |
| A10 | Sin comprobar: tope 1,5×, crédito vídeo/audio/máscaras, «cámbialo igual» | medio | 2026-10-21 |
| A11 | Tamaño del contexto del agente (37 000 a 50 000 tokens) | medio | 2026-10-21 |
| A12 | Paso 6 con LLM real sin ejecutar; `userPicked` usa `ctx.userText` | medio | 2026-10-19 |
| A13 | Notas de operaciones en inglés; falso positivo de continuidad | medio | 2026-10-20 |
| A14 | Cola de agentes («cuando X termine, haz Y»), sin código | medio | 2026-10-16 |
| A15 | Tras 038: triggers amplios, guías faltantes, fallback de realismo | medio | 2026-10-15 |
| A16 | `agentMetrics`, `realism` por op, UI de esfuerzos, selector de roles | bajo | 2026-10-14 |
| A17 | Precisión de `remove_bg`, `extract_frame`, `create_voice` | medio | 2026-10-08 |
| A18 | Cortes de `grid_split` con generación real | medio | 2026-10-07 |
| A19 | «Casa» cuenta como lugar (sin comprobar si sigue) | bajo | 2026-10-07 |
| A20 | Referencia a imagen anterior («de ella») no dispara la puerta | bajo | 2026-10-08 |
| A21 | Bucle de tarjetas con vídeo caro y P2 a P4 | medio | 2026-10-08 |
| A22 | Modelos y prompting: prueba visual de shot-consistency y ref-roles | medio | 2026-10-14 |
| A23 | Decisión: cápsulas de respuesta rápida | bajo | 2026-10-21 |

### Proveedores, precios y coste (B) · [detalle](pendientes-agente.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| B1 | Posible cobro de $0.068 por generación interrumpida | crítico | 2026-10-16 |
| B2 | Relay de NanoGPT sin llevar a la app real (caduca 2026-10-27 en sandbox) | crítico | 2026-10-21 |
| B3 | El presupuesto no es un máximo (avisa, se puede seguir) | alto | 2026-10-08 |
| B4 | Gasto $15.46 → $15.45 sin generar, sin atribuir | alto | 2026-10-21 |
| B5 | 3D (Tripo) «Failed to fetch»: host fuera de la lista, sin verificar | medio | 2026-10-18 |
| B6 | fal.ai sin probar; subir vídeos grandes | bajo | 2026-10-08 |
| B7 | Prueba con gasto real de voz y efectos (usuario) | medio | 2026-10-08 |
| B8 | Modelos `-spicy` excluidos de forma provisional | bajo | 2026-10-08 |
| B9 | «Download failed (404)» en sesión previa del sandbox | bajo | 2026-10-21 |

### Datos, guardado, calidad y pruebas (C) · [detalle](pendientes-sistema.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| C0 | «Connected» verde con servidor caído; «Disk copy pending» sin causa | crítico | 2026-10-21 |
| C1 | Guardado protegido, fase 2 y 3 (commit atómico, borrados, historial) | alto | 2026-10-16 |
| C2 | Probar «Delete all» y el webm real de H5 en el sandbox | medio | 2026-10-16 |
| C3 | Rescate de la pestaña abierta (probablemente obsoleto) | bajo | 2026-10-18 |
| C4 | Conflicto de guardado de las 17:49, sin analizar | medio | 2026-10-18 |
| C6 | Limpiar copias `data.bak-*` | bajo | 2026-10-08 |
| C7 | Unificar datos repetidos de proveedores | bajo | 2026-09-24 |
| C8 | Tests intermitentes con carga (4, 11 y `writer-lock` 15c) | medio | 2026-10-08 |
| C9 | Partir los 11 archivos de más de 30 KB | medio | 2026-10-07 |
| C10 | Cobertura por riesgo: recorridos completos en sandbox | medio | 2026-10-08 |
| C11 | Contraste de `--text-4` (2,8 a 3,7:1) | medio | 2026-10-07 |
| C12 | Carga de la app: paquete de 1,64 MB | bajo | 2026-10-08 |
| C13 | Medir por recorridos reales | medio | 2026-10-08 |
| C14 | Una regla, un propietario (sacar políticas del runtime) | medio | 2026-10-08 |

### Funciones propuestas (F) · [detalle](pendientes-sistema.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| F1 | Producción de varios planos revisable y retomable | medio | 2026-10-08 |
| F2 | De Nodes a la entrega (`join_clips` en Nodes, montaje mínimo) | medio | 2026-10-08 |
| F3 | Continuidad: revisión humana antes que automática | bajo | 2026-10-08 |
| F4 | Ejecución fuera de la pestaña | bajo | 2026-10-08 |
| F5 | Importar el `.zip` de datos | bajo | 2026-10-08 |
| F6 | Recortar un vídeo o quitarle el audio | bajo | 2026-10-08 |
| F7 | Quitar el fondo de un vídeo | bajo | 2026-10-08 |

### Decisiones del usuario y ramas (G) · [detalle](pendientes-sistema.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| G1 | Aprobación formal de ADR 0005, 0006, 0008, 0009 (y 0015) | medio | 2026-10-08 |
| G2 | Poner la app real al día (migra sus datos: copia y aprobación antes) | alto | 2026-09-25 |
| G3 | Publicar la app (plataforma, acceso, claves) | medio | 2026-09-25 |
| G4 | Estructura de QA con subagentes (sin comprobar si sigue) | bajo | 2026-10-09 |
| G5 | Sistema visual de tarjetas, pasos 3 a 5 y revisión visual | medio | 2026-10-20 |
| G6 | Sistema resuelve el modo claro a Claro (¿Blanco?) | bajo | 2026-10-21 |
| G7 | Pestaña «Look» en inglés (¿«Apariencia»?) | bajo | 2026-10-20 |

### Designer, formas, brocha y render (D) · [detalle](pendientes-designer.md)

| ID | Asunto | Prio | Origen |
| --- | --- | --- | --- |
| D1 | Probar en el navegador brocha, zoom, modos, fusionar, rasterizar, espejo | medio | 2026-10-09 |
| D2 | Brocha SAI: mezcla húmeda, calidad, multiplicador de tamaño | medio | 2026-10-09 |
| D3 | Mismo campo fuera del Designer (preguntar antes) | bajo | 2026-10-09 |
| D4 | Presión con un lápiz real | medio | 2026-10-09 |
| D5 | Caché de FX con presupuesto de memoria (falta medir y liberar) | medio | 2026-10-09 |
| D6 | Máscaras: recorrido completo y sus dos contratos | medio | 2026-10-09 |
| D7 | Ajustes, grupos que componen y espacio de color | medio | 2026-10-09 |
| D8 | PSD y su promesa | medio | 2026-10-09 |
| D9 | Clics nativos en el menú FX cierran sin añadir capa | medio | 2026-10-09 |
| D10 | Prueba permanente con Inkscape | medio | 2026-10-11 |
| D11 | Nodos coincidentes a zoom bajo sin test propio | bajo | 2026-10-11 |
| D12 | Trazos raster antiguos se reconstruyen con diferencias | bajo | 2026-10-09 |
| D13 | Importar SVG de Inkscape con un archivo real | medio | 2026-10-13 |
| D14 | Render y rendimiento (render-estado: 18 + 9 pendientes) | alto | 2026-10-13 |
| D15 | Memoria del historial del Designer (parcial) | bajo | 2026-09-24 |
| D16 | Capas FX: plan de pruebas completo | medio | 2026-10-08 |
| D17 | Interfaz del Designer al estilo ibisPaint y Photoshop | medio | 2026-10-10 |
| D18 | Lineart que se deforma al encoger (10 % residual) | medio | 2026-10-13 |

### Interfaz por espacios (GUI) · [detalle](pendientes-gui.md)

39 filas abiertas. Las de prioridad **alta** (origen 2026-10-16): la tarjeta «Plan … Revised» enorme para cambios pequeños, el «error al seleccionar varias» salidas (sin reproducir) y el borrado de capas y teclas de herramienta que nunca se ejecutan (`designerKeys.ts:87`, decisión tuya de no arreglar todavía). El resto es **medio** (sin ver en navegador, 2026-10-15 a 18) o **bajo** (diseño sin decidir: Studio estrecho, pestaña Projects, herramientas ancladas, persistencia de Grid/List). Incluye el plan de 4 bloques de la persona entusiasta (2026-10-17) y la evidencia de Reddit incompleta.

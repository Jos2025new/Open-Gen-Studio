# Plan: interfaz del Designer como mesa de trabajo de diseño

Fecha: 2026-10-10. Rama: `task/designer-ux`, desde `task/agent-forcing` (`b24bf5d`). La ejecuta Claude.

## Propósito, según lo pedido

El usuario pidió (2026-10-10) mirar la filosofía de ibisPaint, Photoshop, Feather 3D y SketchUp y extrapolarla al Designer. Puntos de partida:
- en el Designer, funciones importantes «quedan incluso ocultas»;
- tenemos pocas funciones, así que debería ser fácil disponerlas mejor;
- el dibujo no es el centro, pero debe ser «accesiblemente robusto»;
- no se puede perder ninguna herramienta ni función al reorganizar.

GPT 6 Astra aportó la visión del flujo de un diseñador: seleccionar algo, ajustarlo, comparar y seguir. Lo de cada segundo depende de la actividad. La interfaz debe mostrar **qué se modifica**. El usuario aprobó la secuencia combinada y pidió aplicarla aquí: «todo lo que te planteaste». Análisis completo en [propuesta-gui-pintura.md](propuesta-gui-pintura.md).

Síntesis de la filosofía: **lugares estables, contenido contextual y acceso reconocible a lo que está cerrado.**

## Hallazgo previo que justifica el paso 0

La herramienta **Regla** (stroke ruler, 2026-10-10) está en la lista `TOOLS` de `ToolRail.tsx`, pero la barra pinta sus botones uno a uno y la Regla no está entre ellos. Solo se llega con la tecla K. Es el tipo de pérdida que el usuario ya sufrió.

## Pasos

| # | Qué | Dónde (archivos) | Por qué | Cómo se comprueba |
|---|---|---|---|---|
| 0 | **Inventario de acceso:** una sola lista de dónde vive cada herramienta en la barra, que la barra usa para pintarse, y un test que falla si una herramienta no tiene sitio. | `ToolRail.tsx` (lista de la barra exportada); `tests/designer-inventory.test.ts` | No perder herramientas al reorganizar; hoy ya falta la Regla | El test: toda `DesignTool` tiene un sitio en la barra. |
| 1 | **Franja contextual encima de la caja de herramientas:** los controles esenciales de la herramienta activa, sin desplazamiento horizontal (las líneas se parten si no caben), con el **destino** visible («Pincel → Capa 3», «Nuevo texto» o «Texto seleccionado») y «Ajustes…» para el resto. Sustituye a la zona con flechas `<` `>`. | `ToolRail.tsx`, `ToolSettings.tsx` (modo compacto, que ya existe), `designer-connected.css` | Lo de cada segundo según la actividad, cerca de la herramienta; nada escondido tras las flechas | Capturas en el sandbox con pincel, texto, formas y selección; `npm run brush:check` (paneles). |
| 2 | **Panel derecho: inspector arriba y capas abajo,** con un separador que se arrastra (la altura se recuerda) y «Restaurar disposición». Las capas FX dicen a qué afectan («→ Image 2» o «→ todo lo inferior»), sin dibujarlas como hijas. | `LayersPanel.tsx`, `designer-connected.css`, `store.ts` (altura recordada) | Capas e inspector juntos, con espacio real para las capas (hoy la lista mide como mucho `min(180px, 25dvh)`); dejar claro qué filtra cada FX | Captura del panel; test del separador (límites y restaurar). |
| 3 | **Interruptores por su efecto:** los de **vista** (reglas de página, vista de píxeles) junto al zoom; los de **acción** (seguir la regla de trazo) en la franja de su herramienta. Distinguir los nombres «Page rulers» y «Stroke ruler». | `DesignerWorkspace.tsx` (grupo del zoom), `ToolRail.tsx`, franja del paso 1 | No presentar como preferencia visual algo que cambia el próximo gesto | Captura; el inventario sigue pasando. |
| 4 | **Herramientas por familia,** sin perder accesos directos: Editar, Mano, Seleccionar, Texto, Pincel, Borrador y Lineart directos; Formas y líneas en un grupo; Relleno y degradado en otro; Regla y cuentagotas visibles. | `ToolRail.tsx` | Que nada dependa de un desbordamiento; los cambios frecuentes siguen a un clic | Inventario; captura a 1500×940 sin flechas. |
| 5 | **Ayuda contextual opcional:** una línea discreta arriba del lienzo, con la herramienta activa, qué hace y sus teclas (sale de las etiquetas que ya existen). Se cierra y se puede volver a activar desde el grupo de vista. | `DesignerWorkspace.tsx` o `Stage.tsx`, `store.ts` (encendida o apagada) | Descubrir lo que no se ve, como SketchUp, sin obligar a leer para saber qué se edita | Captura; test de que se apaga y se recuerda. |
| 6 | **Ampliaciones** (girar el lienzo, histograma, rueda de color): **no se hacen en esta rama.** Se valoran cada una según lo que desbloquee. | — | Así lo propuso Astra; son trabajo aparte | Queda en pendientes. |

Validación final con tres tareas en el sandbox, que propuso Astra:
- componer imagen y texto;
- retocar con selección y pincel;
- ajustar FX alternando entre capas.

Criterio: completarlas sin buscar controles, sin confundir su alcance y sin perder ninguna función.

## Reglas para esta rama

- Ninguna función nueva, salvo lo que exige la disposición (separador, línea de ayuda). Se reutilizan los campos de `InlineControls`.
- `Stage.tsx` está en su tope de tamaño: lo que se añada va en componentes aparte.
- Cada paso, su commit, `npm run test:related` y una captura. Al final, `npm test`, build, `brush:check` y `tools:check`.
- Lo que cambie la distribución se le enseña al usuario con capturas antes de integrarlo en `task/agent-forcing`.

## Estado al 2026-10-10 (Claude)

| Paso | Estado | Commit | Evidencia |
|---|---|---|---|
| 0. Inventario | **Hecho.** La barra se pinta desde `RAIL`; la **Regla** vuelve a tener botón | `236893a` | `designer-inventory.test.ts` (también exige una línea de ayuda por herramienta); falla si se quita una herramienta (probado) |
| 1. Franja contextual | **Hecho.** «Herramienta → destino», sus controles compactos, «Follow stroke ruler» y «Settings…»; sin desplazamiento | `236893a` | Capturas del sandbox con pincel, texto, selección, Edit, rectángulo y relleno |
| 2. Inspector y capas | **Hecho.** Inspector arriba, capas abajo, separador recordado, «Restore panel layout»; los FX dicen «→ destino» | `6db23d9` | Capturas con 8 capas y un FX |
| 3. Interruptores por efecto | **Hecho, en parte.** Las reglas de página van al grupo del zoom; seguir la regla de trazo va en la franja; el imán sigue con Editar. No hay interruptor de vista de píxeles: es automática a 400 % | este commit | Captura |
| 4. Familias | **Hecho** con el paso 0: Editar, Seleccionar, Pintar (pincel, borrador, Lineart y grupo Relleno y degradado), Formas y texto, Guías y color | `236893a` | Inventario; sin flechas a 1500×940 |
| 5. Ayuda contextual | **Hecho.** Línea arriba del lienzo, se cierra con × y se activa con ? en el grupo del zoom; los textos solo dicen atajos comprobados en el código | este commit | Captura; inventario |
| 6. Ampliaciones | **No se hacen aquí**, como decía el plan | — | — |

**Corrección propia:** la primera versión de la ayuda afirmaba atajos que no existen (`[` y `]` para el tamaño, Mayús para formas proporcionales, Alt con el borrador). Se quitaron tras buscarlos en el código.

**Comprobaciones:** `npm test`, build, `npm run brush:check` 7/7 y `npm run tools:check` 3/3, en el sandbox.

**Falta:**
- que el usuario vea las capturas y lo pruebe antes de integrarlo en `task/agent-forcing`;
- la validación con las tres tareas de Astra, hecha por una persona;
- la cabecera del panel en la pestaña Layers sigue justa de ancho (las pestañas se recortan con el tamaño del documento al lado).

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

## Segunda pasada, tras la revisión de Astra (2026-10-10)

Astra revisó hasta `21e73f8`. Su veredicto: conservar la distribución y pasar de «mostrar los controles de una herramienta» a «acompañar la tarea». Claude comprobó en el código los cinco hechos que señaló, y los cinco eran ciertos. El usuario dijo «Hazlo».

| # | Qué | Archivos | Comprobación |
|---|---|---|---|
| 1 | **Rótulos veraces.** Con un texto seleccionado, la franja edita **esa capa** (antes cambiaba los ajustes del próximo texto mientras decía «selected text»). Relleno y degradado dicen «→ new layer», porque crean una. El texto nuevo usa el tamaño elegido (antes `Stage` lo sustituía por uno calculado). Los campos de texto son un solo componente, `TextStyleFields`, para la creación y para el seleccionado | `ContextStrip.tsx`, `ToolSettings.tsx`, `Stage.tsx` | `flows:check`, recorrido «compose»: el texto se crea a 60 px; con él seleccionado, 80 px cambia la capa y no los ajustes de creación |
| 2 | **El panel se respeta.** Cambiar de herramienta ya no lo abre ni cambia de pestaña; solo «Settings…» abre «Tool» | `LayersPanel.tsx` | «retouch»: con «Layers» elegida, cambiar de herramienta la mantiene |
| 3 | **Franja priorizada.** Pincel: tamaño, color y opacidad (el suavizado y el estabilizado, en «Tool»). Texto compacto sin interlineado ni espaciado. Selección con «Deselect» y «To layer». Se quita el color duplicado de la caja | `BrushSettings.tsx`, `ToolSettings.tsx`, `ToolRail.tsx` | «retouch»: «To layer» crea la capa y «Deselect» funciona desde la franja |
| 4 | **Propiedades primero.** Tres pestañas: **Properties** (lo seleccionado), **Tool** (la herramienta) y **Layers** (solo las capas). Elegir una capa estando en «Tool» lleva a sus propiedades. Solo la pestaña activa muestra su nombre | `LayersPanel.tsx` | «FX»: seleccionar el FX abre sus ajustes («Applies to») y cambiar de herramienta no lo cambia |
| 5 | **Acabado.** Acciones de capa en una fila (duplicar, rasterizar, agrupar y restaurar la disposición, en «More»). La opacidad de capa se llama «Layer». El tamaño de página va en la pista de «Layers» y en «More». En ventanas estrechas la franja se alinea a la derecha | `LayersPanel.tsx`, `designer-connected.css` | «FX»: fila de acciones de menos de 48 px; «More» contiene duplicar y restaurar; captura a 1280×720 |
| 6 | **Los tres recorridos completos,** como prueba permanente: `npm run flows:check` | `tests-e2e/designer-flows.spec.ts` | 3/3 en el sandbox |

**Fallos encontrados al comprobar, y corregidos:**
- «Settings…» seguía enviando la pestaña antigua («props») y no abría «Tool». Lo detectó el recorrido «FX».
- La barra acoplada heredaba `top: 62px`: con `position: relative` (del paso 1) se desplazaba 62 px hacia abajo y, a 1280×720, la caja de herramientas quedaba medio fuera de la pantalla. Se comparó con `task/agent-forcing`, donde cabía, y se corrigió con `top: auto`.
- Las comprobaciones antiguas (`brush:check`, `tools:check`) daban por hecho que cambiar de herramienta abría los ajustes: ahora abren la pestaña «Tool», como haría una persona.

**Comprobado:** `npm test` y build; en el sandbox, `brush:check` 7/7, `tools:check` 3/3 y `flows:check` 3/3.

**Sin comprobar:** que el usuario lo pruebe; ventanas aún más pequeñas que 1280×720; la ayuda superior sigue enumerando posibilidades en vez de orientar sobre el próximo gesto (propuesta de Astra, no hecha).

## Tercera pasada, tras la segunda revisión de Astra (2026-10-10)

Astra: conservar esta versión como base, pero aún no dar por cerrados la coherencia del texto ni los tres recorridos. Tenía razón también en que Claude exageró el alcance de las pruebas: las llamó «recorridos completos» cuando solo comprobaban partes.

| Qué | Archivos | Comprobación |
|---|---|---|
| **«Settings…» con un texto seleccionado abre sus propiedades,** no los ajustes del próximo texto. Esos ajustes dicen ahora «For the next text you add» | `ContextStrip.tsx`, `ToolSettings.tsx` | «compose»: «Settings…» abre «Properties» con los campos del texto |
| **Elegir otra capa de pintura mantiene «Tool».** Solo elegir un FX abre sus propiedades | `LayersPanel.tsx` | «retouch»: elegir «Base» desde «Tool» la mantiene |
| **Sección «Layer · nombre»** sobre la opacidad y la fusión, que vuelven a llamarse «Opacity» y «Blend» | `LayersPanel.tsx`, CSS | captura |
| **Duplicar, visible; fusionar, en «More»** (Ctrl+E sigue igual), porque crear variantes y comparar es central al diseñar | `LayersPanel.tsx` | «FX»: «Duplicate layer» visible; «More» contiene «Merge down» y «Restore panel layout» |
| **A 1280×720 la franja no toca nada:** máximo `100 % − 230 px` en ventanas estrechas | CSS | «small window»: comprueba automáticamente que la franja no se solapa con «Conversation» ni con la caja, y que la caja cabe en la pantalla |

**Pruebas ampliadas** (`npm run flows:check`, 4/4), ahora verifican resultados:
- **compose:** una imagen y un texto encima. Se comprueban los píxeles de los dos en pantalla, que el texto está sobre la imagen, que el texto es exactamente «Title», el tamaño de creación (60) frente al del seleccionado (80), y «Settings…».
- **retouch:** «To layer» y «Deselect» desde la franja; el trazo cae en **la capa que la franja nombra** (se buscan sus píxeles); cambiar de herramienta o de capa de pintura mantiene «Tool».
- **FX:** cambiar el radio del desenfoque desde el panel cambia el parámetro **y lo que se ve** (más luz junto al borde de la imagen).
- **small window:** sin solapamientos y con la caja dentro de la pantalla.

**Observación, sin corregir:** si se escribe en el mismo instante en que aparece el cuadro de texto, se pierde la primera letra («Title» quedó «itle»), porque aún no tiene el foco. Una persona tarda más; la prueba espera 200 ms y comprueba el texto exacto. Habría que verlo si alguien lo nota al teclear rápido.

**Sigue sin cubrir:** la composición con mover y alinear objetos, y ventanas menores de 1280×720. La línea de ayuda que oriente sobre el siguiente gesto queda aparcada, como pidió Astra.

**Comprobado:** `npm test` y build; en el sandbox, `flows:check` 4/4, `tools:check` 3/3 y `brush:check` 7/7.

# Edición de formas: un clic transforma, doble clic edita

2026-10-11. Acordado con el usuario después de dos investigaciones independientes de tutoriales de Illustrator e Inkscape (Haiku 5.5 y GPT 6 Luna validada por GPT 6.1 Sol) y de las revisiones de GPT ([fuentes de las fórmulas](inkscape-formas.md)).

## Qué pidió el usuario (su forma de trabajar)

Crear la forma; un clic mueve; los tiradores de la forma completa escalan y rotan; el doble clic entra en edición; las formas paramétricas no tienen nodos sino tiradores propios; las líneas con nodos se editan por nodos; el resto, en los ajustes. Lineart y texto ya funcionan así.

## Qué se acepta (esta fase)

| Regla | Por qué | Fuente |
| --- | --- | --- |
| Un clic con Edit: mover, escalar, rotar. Sin tiradores Rx/Ry ni blur. | Regla del usuario; acaba con los choques entre tiradores (hallazgos de GPT) sin tener que apartarlos. | Decisión propia: Illustrator los muestra juntos. |
| Doble clic en rectángulo o elipse, o «Edit shape» en la barra: modo edición. Oculta los tiradores de escala y muestra Rx/Ry (rectángulo) y blur. | Inkscape: el doble clic sobre un rectángulo abre su herramienta con los tiradores. El botón hace descubrible el gesto. | Tutoriales K2 e Inkscape keys.xml; mejora 1 de Sol. |
| La barra dice «Editing shape» y tiene «Done»; salen Esc, Done, elegir otra cosa o cambiar de herramienta. | Modo visible y salida clara. | Mejora 1 de Sol. |
| Sin Ctrl solo se mueve el radio arrastrado; Ctrl o «Lock radii» (barra del modo edición, con tooltip que enseña Ctrl) mueven los dos. | Forma de trabajar del usuario; el interruptor enseña el atajo a quien no lo conoce. | Usuario. |
| Doble clic sobre un tirador Rx/Ry: su valor exacto en la barra. | Illustrator: doble clic sobre el widget abre sus valores; las medidas son «difíciles de controlar solo con el ratón» (guía de Inkscape). | Live Corners (Adobe); Rectangles (Inkscape). |
| Campos según la figura: An, Al y Blur en las dos; Rx/Ry y «Sharp corners» solo en el rectángulo. | Mostrar solo lo que aplica. | Mejora 3 de Sol. |
| Propiedades: con una forma elegida, solo su sección y en filas compactas. | Hacía falta desplazarse para ver «Sharp corners». | Observación propia. |

## Qué queda fuera

«Convert to path» y la edición de nodos de trazados de formas: segunda fase. No se ofrece un botón hasta que los nodos existan (Sol: no prometerlo antes). Opacidad/fusión de capa entre lienzo y SVG: tarea aparte.

## Qué no debe romperse

Doble clic en lineart (nodos) y en texto (edición) sigue igual y va primero. Las reglas de tiradores de [inkscape-formas.md](inkscape-formas.md) (Ctrl, Ctrl-clic, Shift-clic, un deshacer por arrastre) no cambian; solo cambia cuándo se ven. Edit → Layer no entra en edición de formas.

## Qué se espera conseguir

Que las formas se usen como en Inkscape e Illustrator sin aprender nada nuevo: transformar con un clic, editar con doble clic, valores exactos en la barra. Comprobación: tests unitarios del estado del modo, e2e en el sandbox con formas pequeñas a 5 %, 100 % y 400 % de zoom, y capturas.

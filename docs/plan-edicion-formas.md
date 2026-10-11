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

## Giro libre (añadido)

Girar o inclinar un rectángulo o una elipse ya no los convierte en trazado: siguen editables (doble clic, Rx/Ry, blur), con sus tiradores girados, como en Inkscape. El SVG los escribe como `<rect>`/`<ellipse>` con `transform`. Una línea girada sigue siendo línea.

## Nodos y Convert to path (añadido)

Doble clic en un trazado (polígono, curva, flecha, trazados del agente o convertidos) o «Edit nodes»: nodos cuadrados y manejadores redondos, como la herramienta Nodos de Inkscape. Arrastrar un nodo lleva sus manejadores; un manejador da forma a la curva; un deshacer por arrastre. En el modo edición de un rectángulo o una elipse, «Convert to path» (Objeto a trayecto de Inkscape) da el mismo contorno, giro incluido, como nodos editables; Ctrl+Z lo deshace. Sin atajo: Ctrl+Mayús+C abre el inspector de Chrome. La conversión conserva el giro o la inclinación (como Inkscape cuando preserva la transformación) y empieza un rectángulo con guiones en el centro del borde superior: el lienzo no cambia ni un píxel (e2e). Las curvas cuadráticas se editan como la cúbica equivalente, como en Inkscape, así que cada nodo arrastra su manejador; los nodos se dibujan sobre los manejadores y se ocultan los manejadores de longitud casi cero.

## Qué queda fuera

Hecho después (2026-10-11): tipos de nodo esquina/suave/simétrico (barra, Shift+C/S/Y, `sodipodi:nodetypes`), añadir nodo con doble clic en el contorno y borrar el elegido con Supr; la opacidad y fusión de capa se componen como un grupo SVG. Borrar un nodo suave o simétrico con Supr conserva la forma como Inkscape (path-manipulator.cpp L812–907: 10 muestras por segmento, direcciones de los manejadores exteriores fijas, una cúbica ajustada por mínimos cuadrados); uno de esquina une los vecinos; Ctrl+Supr une en recta.

## Qué no debe romperse

Doble clic en lineart (nodos) y en texto (edición) sigue igual y va primero. Las reglas de tiradores de [inkscape-formas.md](inkscape-formas.md) (Ctrl, Ctrl-clic, Shift-clic, un deshacer por arrastre) no cambian; solo cambia cuándo se ven. Edit → Layer no entra en edición de formas.

## Qué se espera conseguir

Que las formas se usen como en Inkscape e Illustrator sin aprender nada nuevo: transformar con un clic, editar con doble clic, valores exactos en la barra. Comprobación: tests unitarios del estado del modo, e2e en el sandbox con formas pequeñas a 5 %, 100 % y 400 % de zoom, y capturas.

## Propuesta: herramientas de nodos (2026-10-11, pendiente de revisión)

Fuente: código de Inkscape en el commit [21f4270](https://gitlab.com/inkscape/inkscape/-/commit/21f427000de1e19f5a262e75cfa83c3f82564f8b), leído por Haiku: `multi-path-manipulator.cpp`, `path-manipulator.cpp`, `node-tool.cpp`, `control-point-selection.cpp` y `keys.xml`. Lo marcado «doc» sale solo de `keys.xml`, no del código.

| Función | Inkscape | Aquí | Fuente |
| --- | --- | --- | --- |
| Selección múltiple | Clic elige; Shift+clic alterna; arrastre en vacío = rectángulo (Ctrl añade); Ctrl+A todos; Esc vacía la selección y, si ya está vacía, sale | `node` pasa a `nodes: number[]`; mismos gestos. El rectángulo, solo dentro del modo edición | keys.xml 2757–2793 (doc); node-tool.cpp 516–531, 821–825 |
| Mover varios | Arrastrar uno mueve todos los elegidos; flechas: 2 px, Shift ×10, Alt 1 px de pantalla | Igual, un deshacer por gesto | keys.xml 2971 (doc); control-point-selection.cpp 533–546 |
| Unir nodos (Shift+J) | Solo extremos, emparejados por cercanía; nodo en el punto medio; conserva el manejador de entrada de uno y el de salida del otro; queda de esquina; mismo subtrazado → se cierra; dos → se unen | Igual. Sin parejas: no hace nada (Inkscape suelda nodos contiguos; queda fuera) | multi-path-manipulator.cpp 57–79, 386–426 |
| Unir con segmento (Alt+J) | Mismas parejas; recta entre ellos, que quedan de esquina | Igual | 457–475 |
| Romper (Shift+B) | Cada nodo interior elegido se parte en dos extremos coincidentes; uno se lleva el manejador de entrada; los dos de esquina; en un subtrazado cerrado, lo abre por ahí | Igual | path-manipulator.cpp 646–676 |
| Borrar segmento (Alt+Supr) | Entre nodos elegidos contiguos: quita los segmentos, retrae los manejadores de los extremos (esquina); en un cerrado, lo abre | Igual | path-manipulator.cpp 915–980 |
| Segmento a recta / curva (Shift+L / Shift+U) | Entre nodos elegidos contiguos. Recta: manejadores sobre sus nodos. Curva (solo si era recta): manejadores a 1/3 del segmento. Los tipos no cambian | Igual; la curva se guarda como C | path-manipulator.cpp 1015–1038 |

**Base técnica:** los subtrazados ya se editan como nodos y aristas (`toSubs`/`fromSubs` en `pathNodes.ts`), así que cada operación es una función pura sobre esa lista, que también mantiene `nodeTypes`. Cada operación es un solo paso de deshacer y pasa por `withSegs`, con la compensación del giro.

**Interfaz:** en la barra del modo nodos, botones con icono y nombre accesible: Unir, Unir con segmento, Romper, Borrar segmento, A recta, A curva. Solo se activan cuando aplican (dos extremos elegidos, nodos contiguos…). Los atajos solo funcionan en edición de nodos y nunca dentro de un campo de texto. Supr y Ctrl+Supr no cambian.

**Conflictos que hay que vigilar:**
- Ctrl+A ya selecciona todos los píxeles: dentro de la edición de nodos debe seleccionar todos los nodos.
- Alt+J y Shift+B no deben chocar con atajos existentes.
- Las flechas no deben mover la capa mientras se editan nodos.
- El arrastre en vacío dentro del modo edición hoy sale del modo: pasaría a seleccionar con rectángulo, y Esc o Done serían la forma de salir.

**Verificación:** tests puros de cada operación (abiertos, cerrados, varios subtrazados, nodos coincidentes, tipos, giro). Un e2e por gesto que falle al quitar la corrección. Ctrl+A y las flechas comprobados sin efectos fuera del modo.

**Commits previstos:**
1. Selección múltiple y mover varios.
2. Unir y unir con segmento.
3. Romper y borrar segmento.
4. Segmento a recta o curva.

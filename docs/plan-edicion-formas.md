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
| Selección múltiple | Clic elige; Shift+clic alterna; arrastre en vacío = rectángulo (Shift añade, Ctrl elige fuera, Ctrl+Shift resta dentro); Ctrl+A todos; Esc vacía la selección y, si ya está vacía, sale | `nodes: number[]`; los gestos de rectángulo solo viven dentro del modo de edición | keys.xml 2757–2793 (doc); node-tool.cpp 516–531, 734–765, 821–825 |
| Mover varios | Arrastrar uno mueve todos los elegidos; flechas: 2 px, Shift 20 px, Alt 1 px de pantalla | Una operación de geometría por tecla; un deshacer por arrastre | keys.xml 2971 (doc); control-point-selection.cpp 533–546 |
| Unir nodos (Shift+J) | Solo extremos, emparejados por cercanía; nodo en el punto medio; conserva el manejador de entrada de uno y el de salida del otro; queda de esquina; mismo subtrazado → se cierra; dos → se unen | Igual. Sin parejas: suelda nodos contiguos, conservando los manejadores exteriores; punto medio entre nodos extremos (decisión propia) | multi-path-manipulator.cpp 57–79, 386–426 |
| Unir con segmento (Alt+J) | Mismas parejas; recta entre ellos, que quedan de esquina | Igual | 457–475 |
| Romper (Shift+B) | Cada nodo interior elegido se parte en dos extremos coincidentes; uno se lleva el manejador de entrada; los dos de esquina; en un subtrazado cerrado, lo abre por ahí | Igual | path-manipulator.cpp 646–676 |
| Borrar segmento (botón) | Entre nodos elegidos contiguos: quita los segmentos, retrae los manejadores de los extremos (esquina); en un cerrado, lo abre | Igual | path-manipulator.cpp 915–980 |
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

### Contraste con SVG-Edit (editor web de SVG)

Fuente: código de [SVG-Edit](https://github.com/SVG-Edit/svgedit) en el commit `c44f061`, leído por Haiku (`packages/svgcanvas/core/path-actions.js`, `path-method.js`, `path.js`, `src/editor/Editor.js`), y sus issues de GitHub. Es otro editor web como el nuestro, así que su experiencia es directamente aplicable.

| Función | Inkscape | SVG-Edit | Coinciden / difieren | Más estable o más fácil |
| --- | --- | --- | --- | --- |
| Clic, Shift+clic, rectángulo | Sí | Sí (path-actions.js 508–524, 536–549, 676–684) | Coinciden | Los dos. Pocos issues en SVG-Edit: base segura |
| Mover varios | Sí, con flechas | Arrastre sí (path-method.js 1011–1017); flechas no (mueven el elemento) | SVG-Edit no mueve nodos con flechas | Inkscape: es el comportamiento que espera el usuario. Exige desviar las flechas en edición de nodos, como hicimos con Supr |
| Ctrl+A | Todos los nodos | Sale de la edición y selecciona la capa (Editor.js 280–290) | Difieren | Inkscape, para no salir del modo sin querer |
| Unir extremos | Real: punto medio, cierra o une subtrazados | No existe: «subtrazado» solo añade otro trazado al final (path-actions.js 443) | Difieren | Inkscape. SVG-Edit no ofrece una alternativa |
| Romper un nodo | Sí, dos extremos coincidentes | No; solo abrir o cerrar en un nodo (path-actions.js 985–1095) | Difieren | Inkscape. Las ediciones de la lista de SVG-Edit con índices y `Z` concentran sus fallos (#1093, #1100, #1107) |
| Borrar nodo | Conserva la forma (ya hecho aquí) | Quita el segmento sin reajustar (path-method.js 932–956) | Difieren | Lo nuestro (Inkscape) |
| Recta ↔ curva | Shift+L / Shift+U; curva a 1/3 | Doble clic en el nodo o desplegable; curva a 1/3 (path-method.js 1080–1083) | Misma regla del tercio | Los dos. Doble clic ya añade nodo aquí, así que atajos y botón |
| Tipos de nodo | Esquina, suave, simétrico | Solo «enlazar puntos de control»: simétrico o libre (path-method.js 707) | Inkscape más completo | Lo nuestro (ya hecho) |
| Añadir nodo | Doble clic en el contorno | Botón que divide por la mitad, con De Casteljau (path-method.js 891–930) | Mismo cálculo | Lo nuestro (ya hecho) |

**Lo que se puede deducir de sus issues** (corregido tras la revisión de GPT con Luna):
- No prueban un problema común de índices. #1100, #638 y #640 son correcciones de los reportes citados, con causas distintas: el cierre `Z`, la visibilidad de los tiradores y el trazado activo. #1107 sigue sin reproducción ni causa confirmada.
- Reconstruir cada subtrazado entero (`toSubs`/`fromSubs`) simplifica el trabajo, pero no evita estos fallos por diseño. Cierre, selección y nodos coincidentes hay que comprobarlos igual.
- Que SVG-Edit no tenga Ctrl+A de nodos, flechas para nodos, unir ni romper se dedujo de lo que Haiku leyó; esas citas no bastan para afirmarlo.
- Lo confirmado en los dos editores: clic, Shift+clic, rectángulo, arrastre múltiple, controles a un tercio y subdivisión con De Casteljau.

**Hecho (2026-10-11):** selección y atajos (`383e7be`), recta y curva (`46886fb`), unir (`4768d07`) y romper; detalle en el [historial 024](history/024-2026-10-W41.md). Hecho (2026-10-12): borrar segmento como botón (abiertos, cerrados, varios subtrazados, tipos y selección recalculada); fuente: [path-manipulator.cpp 915–991](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/path-manipulator.cpp#L915-991). Hecho (2026-10-12): soldar nodos contiguos con Shift+J cuando no hay parejas de extremos; Alt+J conserva su función. Fuente: [multi-path-manipulator.cpp 423–426](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/multi-path-manipulator.cpp#L423-426) y [weldNodes, path-manipulator.cpp 506–578](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/path-manipulator.cpp#L506-578). Los tramos que cruzan el cierre también se sueldan; un subtrazado totalmente elegido no se colapsa, como en las líneas 518–522.

**Decisiones propias (2026-10-12):** el nodo soldado queda en el punto medio entre el primer y último nodo del tramo. Inkscape calcula el punto medio entre las posiciones de los manejadores externos (543–556) y puede preservar el nodo bajo el ratón; aquí no se usa esa excepción. Los manejadores externos no retraídos conservan sus coordenadas, y los retraídos siguen sobre el nuevo nodo (como 560–565). Tras borrar, siguen elegidos los nodos seleccionados supervivientes; tras soldar, los nuevos nodos y los seleccionados que no se soldaron. Se calculan por orden, no por coincidencia de coordenadas. El inicio de los subtrazados intactos se conserva para no desplazar los guiones.

**Orden de los commits** (sustituye al anterior):
1. Selección y atajos.
2. Recta y curva.
3. Unir.
4. Romper.

En cada paso se comprueban el deshacer y que los índices elegidos se recalculan. Borrar segmento va después, como botón.

### Correcciones tras la revisión de GPT (2026-10-11)

GPT 6.1 contrastó cada fila con Inkscape en `21f4270`, y GPT 6 Luna revisó el código local. Las correcciones prevalecen sobre las filas de arriba:

- **Rectángulo de selección:** Shift añade, Ctrl selecciona lo que queda fuera del área, Ctrl+Shift resta ([node-tool.cpp 734–765](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tools/node-tool.cpp#L734-765)). «Ctrl añade» era incorrecto. Clic y Shift+clic sí están confirmados en el código.
- **Arrastrar varios:** al pulsar un nodo que ya está elegido se conserva el grupo para arrastrarlo; la selección solo se reduce a ese nodo si se suelta sin arrastrar.
- **Alt+Supr** en Inkscape borra nodos dejando un hueco, no «borrar segmento» ([multi-path-manipulator.cpp 771–781](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/multi-path-manipulator.cpp#L771-781)). Aquí borrar segmento será un botón; si además se le da un atajo, se dirá que es propio y no de Inkscape.
- **Recta y curva:** retraer manejadores puede convertir un nodo simétrico en suave o de esquina ([node.cpp 203–239](https://gitlab.com/inkscape/inkscape/-/blob/21f427000de1e19f5a262e75cfa83c3f82564f8b/src/ui/tool/node.cpp#L203-239)); los tipos se recalculan.
- **Prioridad de eventos:**
  - Shift+B, Shift+L y Shift+U también cambian de herramienta: en edición de nodos se consumen antes que el manejador global, porque `preventDefault` solo no basta.
  - Esc va en dos pasos: primero vacía la selección y después sale del modo.
  - Supr sin nodos elegidos se consume dentro del modo, nunca borra la forma ni la capa.
  - Ctrl+A y las flechas también se quedan dentro del modo.
- **Índices:** insertar, borrar, unir y romper rehacen los índices elegidos junto con la geometría y los tipos. No hacen falta identificadores persistentes por nodo.

**Orden:** se mantiene, pero el commit 1 resuelve por completo selección, prioridad de eventos, rehacer los índices y deshacer, antes que las operaciones que cambian la estructura del trazado.

### Commit 1 implementado: selección y atajos

Clic y Shift+clic, rectángulo con sus modificadores, arrastre del grupo desde la geometría inicial, Ctrl+A, flechas y Esc en dos pasos. Supr se consume aun sin nodos elegidos; los campos conservan sus teclas. Las flechas respetan el giro de la forma. Deshacer/rehacer conserva la selección en movimientos; si cambia el número de nodos, limpia los índices para evitar elegir otro nodo por accidente, también desde los botones de la barra. La selección es temporal, sin cambios al formato del documento. Pruebas: `tests/path-nodes.test.ts` y `tests-e2e/node-selection.spec.ts`. Recta/curva, unir y romper siguen pendientes.

# Pendientes del Designer, formas, brocha y render

Detalle de las filas D del [índice](pendientes.md). Prioridad, **origen** y evidencia como en [pendientes-agente](pendientes-agente.md). Los pendientes de rendimiento y guardado del render tienen una sola fuente, [render-estado](render-estado.md), sección «Pendiente (fuente única)»: no se duplican aquí (D14).

## Probar y medir

- **D1 · medio · 2026-10-09 · Probar en el navegador** (usuario y `npm run brush:check`): brocha sin lectura del canvas, zoom pixelado a 3200 %, modos de fusión nuevos, fusionar, rasterizar, Grow/Shrink y espejo. Fusionar, rasterizar y Grow/Shrink no tienen test propio (`flattenLayers` en `actions.ts`). Detalle: [022](history/022-2026-10-W41.md), «Pendiente al cierre de la segunda parte». Ya hechos y en [cerrados](pendientes-cerrados.md): niveles y curvas, reglas de trazo, margen del ajuste a pantalla.
- **D4 · medio · 2026-10-09 · Presión con un lápiz real.** Tamaño y densidad mínimos solo se probaron con tests y con ratón (presión total). Lo prueba el usuario.
- **D9 · medio · 2026-10-09 · Clics nativos en el menú FX.** En la auditoría del sandbox, algunos clics cerraron el menú sin añadir la capa; el comando compartido sí la añadió. Reproducir desde un perfil aislado y registrar eventos, selección y estado del menú antes de corregir (Astra, causa sin confirmar).
- **D10 · medio · 2026-10-11 · Prueba permanente con Inkscape** (propuesta del usuario): exportar un SVG con todos los casos de forma, rasterizarlo con el CLI de Inkscape y comparar píxeles y atributos; saltarse con aviso si no hay Inkscape. Hoy solo hay comprobaciones puntuales (GPT y Claude, 2026-10-11); los e2e mencionan Inkscape como fuente, no lo ejecutan.
- **D11 · bajo · 2026-10-11 · Nodos coincidentes y selección a zoom bajo:** corregido en `2949201` sin test propio (dos nodos a 0,45 px a 5 %; puntas de la flecha). Revisión de GPT pendiente sobre ese commit.
- **D12 · bajo · 2026-10-09 · Renderizador de líneas de trazos raster anteriores al motor de punta:** reconstruye 132 píxeles con más de 4 niveles de alfa de diferencia, máximo 72 (`npm run brush:check`). Solo afecta a trazos antiguos al reconstruirse; los nuevos coinciden.
- **D13 · medio · 2026-10-13 · Importar SVG de Inkscape con un archivo real del usuario** y revisar qué elementos siguen rasterizados (`6278ed4` solo se probó con un SVG construido a mano). [inkscape-importacion](inkscape-importacion.md).
- **D14 · alto · 2026-10-13 · Render y rendimiento del Designer:** 18 pendientes en [render-estado](render-estado.md) (digests de paridad, A/B final, PNG en worker, contradicción del oráculo de 200 operaciones, memoria de 2048² con CPU por encima del tope, cajas en memoria…) más 9 de «Lo que sigue abierto» (Shift+A, paradas de degradado, booleanas, snapping…). Alto porque el usuario ordena la velocidad antes que las funciones. Sigue sin existir la **sonda del guardado** (el dominio `raster` solo cubre restaurar y programar).
- **D15 · bajo · 2026-09-24 · Memoria del historial del Designer** (40 entradas, ~16 MB por copia de 2048×2048). Parcial desde el 2026-10-13: mosaicos de 64² en memoria (`79bf595`); falta medir el gesto (render-estado).
- **D16 · medio · 2026-10-08 · Capas FX (ADR 0011):** plan de pruebas completo en [fx-pruebas](fx-pruebas.md); `task/fx` ya está dentro de la línea principal.
- **D18 · medio · 2026-10-13 · Lineart que se deforma al encoger:** el usuario lo aprobó con reservas (90/100) y estima una deformación residual del 10 %; pedirle un caso concreto. [diagnostico-escala-lineart](diagnostico-escala-lineart.md).

## Trabajo propuesto (orden de Astra, 2026-10-09)

El usuario dijo que máscaras, ajustes, PSD y color son el próximo trabajo del Designer; el orden de ejecución es **propuesta** de Astra. Cada incorporación cierra vista, undo, guardado y entrega antes de añadir otra. Hecho de este plan: pasos 1 y 1b (en cerrados).

- **D5 · medio · 2026-10-09 · Paso 2: caché de FX con presupuesto de memoria.** Primer paso hecho (capas con FX «layer»; «Everything below» comparte presupuesto desde el 2026-10-13, `cacheBudget.ts`). Falta medir con el banco (`FX_BENCH=50 npm run fx:check -- -g bench` y `npm run trace:report`, antes y después, mismo documento y carga) y liberar al cerrar documentos. Clave por contenido, parámetros, alcance y resolución; separar vista y exportación. Cierre en [render-estado](render-estado.md).
- **D6 · medio · 2026-10-09 · Paso 3: recorrido completo de máscara** (crear, pintar, mover con y sin vínculo, desactivar, undo/redo, guardar, recargar, exportar). Antes se cierran dos contratos:
  - *Orden máscara/efectos:* máscara del contenido antes de los FX de la capa (como `drawMaskedVector`); especificar alfa parcial, halo y «Everything below» con píxeles esperados.
  - *Vida de los buffers:* identidad y propiedad de cada máscara en guardado, restauración y undo/redo; que borrar o deshacer no libere un buffer referenciado; sin segundo sistema de persistencia (`raster.ts`, historial, máscaras vectoriales).
- **D7 · medio · 2026-10-09 · Paso 4: ajustes, grupos que componen y color.** Contratos previos:
  - *Carpetas y grupos:* las carpetas actuales son organización sin aislamiento; un grupo que componga será explícito, con versión y alcance de FX definido, sin cambiar archivos guardados en silencio.
  - *Espacio de color explícito:* sRGB de 8 bits, alfa documentada y dónde ocurren mezcla y ajustes; conversión o rechazo visible fuera del contrato; ICC y gamut amplio quedan fuera.
- **D8 · medio · 2026-10-09 · Paso 5: PSD.** Subconjunto acordado, archivos externos y ida y vuelta; avisar de lo no representable. *Promesa PSD:* capas raster y máscaras alfa editables; texto, vectores, ajustes, FX y perfiles solo se anuncian como editables tras demostrarlo; no prometer un PSD idéntico. Compatibilidad con Photoshop/GIMP **sin verificar**.

## Funciones propuestas

- **D2 · medio · 2026-10-09 · Brocha, lo que falta de SAI** ([ADR 0013](decisions/0013-campos-y-brocha.md)): mezcla húmeda (Blending, Dilution, Persistence), calidad y multiplicador de tamaño. Medir antes el coste por movimiento con el [protocolo](depuracion.md#protocolo).
- **D3 · bajo · 2026-10-09 · Mismo campo fuera del Designer:** sliders de la galería, boceto, visor 3D y tarjeta de ajustes con estilo propio. Cambia la interfaz de otros espacios: preguntar antes.
- **D17 · medio · 2026-10-10 · Interfaz del Designer al estilo ibisPaint y Photoshop** ([propuesta](propuesta-gui-pintura.md)): lo que se toca cada segundo siempre visible, herramientas con nombre, capas con efectos dentro, girar el lienzo e histograma. Secuencia vigente de 8 pasos; el primero es el inventario con un test de alcance. Pedido por el usuario, sin decidir el orden.

## Auditoría del Designer (2026-10-22)

De la [auditoría del Designer](../../ogs-designer-audit-2026-10-22.md) (HEAD `64fd215`), comprobados en el código y ordenados por lo que sufre el usuario. Ninguno pide tarjetas ni paradas: se arreglan por debajo, con una prueba que reproduzca cada caso. Son 11 hallazgos en 10 entradas: D26 agrupa los dos pasos de deshacer vacíos.

- **D19 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D20 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D21 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D22 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D23 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D24 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D25 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D26 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D27 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D28 · cerrado 2026-10-23** · [050](history/050-2026-10-W43.md).
- **D29 · bajo · 2026-10-23 · Los PNG de capas borradas o fusionadas se quedan en el disco.** D19 ya las saca de memoria; borrar sus archivos es un borrado de datos y necesita aprobación explícita antes de tocar `deleteBuffers` (zona protegida).

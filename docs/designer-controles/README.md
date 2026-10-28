---
type: index
title: Controles del Designer: matriz de estado actual y propuesta
description: Índice de las notas que inventarían cada control del Designer leído del código, con su archivo y línea y su lugar en la reagrupación propuesta.
tags: [designer, controles, indice]
updated: 2026-10-28
related: [estado-compartido, hallazgos, huecos]
---
# Controles del Designer: estado actual y propuesta

Una nota por superficie. Cada fila es un control (botón, slider, select, interruptor, entrada de menú, atajo, gesto, clic derecho o ayuda que solo aparece al pasar el puntero). Los nombres son los de la interfaz (en inglés) y cada ubicación lleva `archivo:línea` calculado del código, nunca de memoria ni de las maquetas. Lo que no se pudo confirmar va marcado «sin confirmar». Estas notas sustituyen a los inventarios antiguos ([Inventario 1](../inventario-herramientas-designer.md), [Inventario 2](../inventario-herramientas-designer-2.md)), que son anteriores (2026-10-23) y hoy solo redirigen aquí.

Columnas del estado actual: **Control**, **Dónde está hoy** (superficie y contenedor, con archivo:línea), **Qué estado modifica**, **Cuándo aparece** (herramienta, tipo de selección o de capa, modo, bloqueo, vacío) y **Notas** (duplicados, solo al pasar el puntero, iconos compartidos). Columnas de la propuesta: **Dónde quedaría en la propuesta**, **Estado** (`se conserva`, `se mueve`, `nuevo`, `se elimina`) y **Mockup** (la maqueta de [docs/mockups/designer-ajustes](../mockups/designer-ajustes/index.html) que lo cubre, o «no dibujado»). Los enlaces `[[nombre]]` son de Obsidian (`check-docs` no los valida); los enlaces `[texto](archivo.md)` sí.

## Superficies y totales

| Superficie | Nota | Filas | Se conserva | Se mueve | Se elimina | Contenido |
| --- | --- | --- | --- | --- | --- | --- |
| Barra superior (DesignerWorkspace) | [[barra-superior]] · [barra-superior.md](barra-superior.md) | 16 | 16 | 0 | 0 | Botones de la barra de la app y la barra vertical de vista |
| Toolbox dock | [[toolbox-dock]] · [toolbox-dock.md](toolbox-dock.md) | 47 | 47 | 0 | 0 | Familias, variantes, tarjetas y motivos de bloqueo |
| Pincel: bloque principal | [[pincel]] · [pincel.md](pincel.md) | 16 | 9 | 7 | 0 | Brush, Pencil, Airbrush: modo, vista previa, tamaños, color, tamaño, opacidad, textura, compacto |
| Pincel: avanzado | [[pincel-avanzado]] · [pincel-avanzado.md](pincel-avanzado.md) | 23 | 2 | 20 | 1 | Punta, mezcla, estabilizador, presión, espejo, afilado y el resto del pincel |
| Selector de color | [[selector-de-color]] · [selector-de-color.md](selector-de-color.md) | 13 | 13 | 0 | 0 | InlineColor, muestras, plano y canales |
| Borrador | [[borrador]] · [borrador.md](borrador.md) | 12 | 8 | 4 | 0 | Eraser |
| Lineart | [[lineart]] · [lineart.md](lineart.md) | 23 | 23 | 0 | 0 | Modos Draw y Edit, estilo de trazo, textura |
| Curve y la familia Pen | [[curva]] · [curva.md](curva.md) | 6 | 6 | 0 | 0 | Curve y las variantes de Pen que aún no existen |
| Formas | [[formas]] · [formas.md](formas.md) | 24 | 24 | 0 | 0 | Rectangle, Ellipse (y sus tipos), Line con Arrow, Polygon, Star |
| Texto | [[texto]] · [texto.md](texto.md) | 15 | 15 | 0 | 0 | Herramienta Text y TextStyleFields |
| Relleno | [[relleno]] · [relleno.md](relleno.md) | 8 | 8 | 0 | 0 | Fill |
| Degradado | [[degradado]] · [degradado.md](degradado.md) | 12 | 12 | 0 | 0 | Gradient |
| Selección de píxeles | [[seleccion]] · [seleccion.md](seleccion.md) | 22 | 21 | 1 | 0 | Select pixels: rectángulo, lazo, varita y operaciones |
| Cuentagotas | [[cuentagotas]] · [cuentagotas.md](cuentagotas.md) | 5 | 5 | 0 | 0 | Eyedropper y Alt+clic |
| Regla del pincel | [[regla]] · [regla.md](regla.md) | 10 | 10 | 0 | 0 | Ruler |
| Guías y reglas de página | [[guias]] · [guias.md](guias.md) | 15 | 11 | 4 | 0 | Tarjeta Guides y reglas del lienzo |
| Tamaño de página | [[tamanos]] · [tamanos.md](tamanos.md) | 14 | 14 | 0 | 0 | Formulario Sizes y su popover |
| Edit, alinear y transformar | [[alinear-editar]] · [alinear-editar.md](alinear-editar.md) | 45 | 31 | 14 | 0 | Modo Object/Layer, snap, Transform, Align, Distribute |
| Tira contextual | [[tira-contextual]] · [tira-contextual.md](tira-contextual.md) | 32 | 32 | 0 | 0 | ContextStrip: nodos, forma seleccionada, texto |
| Panel de capas | [[capas]] · [capas.md](capas.md) | 50 | 44 | 6 | 0 | Pestañas, lista, filas, carpetas, acciones, menús |
| Propiedades de la capa | [[propiedades]] · [propiedades.md](propiedades.md) | 29 | 29 | 0 | 0 | Apariencia, geometría, texto, trazos, formas, avisos de pintura |
| FX | [[fx]] · [fx.md](fx.md) | 17 | 15 | 2 | 0 | Menú FX y editor de filtros y efectos |
| Navegación y zoom | [[navegacion-zoom]] · [navegacion-zoom.md](navegacion-zoom.md) | 14 | 14 | 0 | 0 | Zoom, encuadre, rueda, Pan |
| Documentos, importar y exportar | [[documentos]] · [documentos.md](documentos.md) | 23 | 23 | 0 | 0 | Nuevo, selector, importar, exportar, galería, portapapeles |
| Atajos | [[atajos]] · [atajos.md](atajos.md) | 42 | 42 | 0 | 0 | Todas las teclas |
| Menús contextuales y popovers | [[menus-contextuales]] · [menus-contextuales.md](menus-contextuales.md) | 20 | 20 | 0 | 0 | Los dos clics derechos y todos los popovers |
| Gestos del lienzo | [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md) | 30 | 30 | 0 | 0 | Stage: gestos, modificadores, asas, cursores |
| Designer embebido en Studio | [[estudio-embebido]] · [estudio-embebido.md](estudio-embebido.md) | 16 | 16 | 0 | 0 | Barra y menú reducidos del tablero |
| **Total** | | **599** | **540** | **58** | **1** | |

El único `se elimina` es el interruptor «Advanced settings» del panel del pincel, que sustituye el bloque plegable Advanced (misma función). Los controles `nuevo` no son filas de estas matrices (no existen hoy): están en la sección 2 de [[huecos]].

Notas de apoyo: [[estado-compartido]] · [estado-compartido.md](estado-compartido.md) (campos de `ui` y del documento con su línea en `store.ts`), [[hallazgos]] · [hallazgos.md](hallazgos.md) (duplicados, controles escondidos y textos desfasados, con los hallazgos del inventario antiguo recomprobados) y [[huecos]] · [huecos.md](huecos.md) (lo que las maquetas pierden o no dibujan, controles nuevos y decisiones abiertas).

## Antes de usar estos números

- Un mismo control puede salir en varias notas si vive en varios sitios (por ejemplo, el tamaño del pincel está en la tarjeta, en el panel Tool y en la tira compacta); la columna Notas dice «DUPLICADO».
- Las filas de [[pincel]] y [[pincel-avanzado]] cubren las tres ramas de `BrushSettings`: tarjeta del dock con pestañas, panel lateral y compacta. Las maquetas de A1 y C9 solo dibujan la rama del panel.
- Las herramientas «soon» del dock están en [[toolbox-dock]] y [[alinear-editar]] (Boolean y Form builder).
- «Se conserva» incluye los cambios de icono o de etiqueta (B6-B7, C13): la columna de propuesta dice cuál.

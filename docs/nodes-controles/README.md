---
type: indice
title: Controles de Nodes
description: Inventario exacto, derivado del código, de todo el espacio de trabajo Nodes (lienzo, nodos, puertos, ejecución, deshacer, agente, atajos), con dependencias, hallazgos y huecos.
tags: [nodes, controles, indice]
updated: 2026-10-28
related: [dependencias, hallazgos, huecos]
---
# Controles de Nodes

Inventario hecho **leyendo el código** (nada de memoria ni de documentos previos; nada se ejecutó). Mismo método y columnas que [Designer](../designer-controles/README.md) y [Studio](../studio-controles/README.md); lo compartido se enlaza, no se repite (selector de modelos, revisión de gasto, tablero embebido, Composer). Todo lo no confirmado va como «sin confirmar».

Las filas no son funciones únicas: un mismo control puede aparecer en varias superficies. Los números de línea se generan desde el código con un script y se comprueban que existen en el archivo citado.

| Nota | Contenido | Filas |
| --- | --- | --- |
| [lienzo](lienzo.md) | Grafo, tipos de nodo, selección, arrastre, menús contextuales, mapa | 36 |
| [navegacion](navegacion.md) | Zoom, desplazamiento, ajustar vista, minimapa | 17 |
| [biblioteca-nodos](biblioteca-nodos.md) | Biblioteca, añadir, quitar, conectar desde un nodo | 18 |
| [puertos-enlaces](puertos-enlaces.md) | Puertos, tipos, enlaces, soltar en el fondo | 20 |
| [tarjeta-nodo](tarjeta-nodo.md) | Tarjeta del nodo, barra de herramientas, resultados | 26 |
| [nodos-generacion](nodos-generacion.md) | Nodos de imagen, vídeo, audio, 3D, modelo y parámetros | 34 |
| [nodos-herramienta](nodos-herramienta.md) | Operaciones del catálogo, parámetros por operación | 65 |
| [nodos-texto-asset](nodos-texto-asset.md) | Nodos de texto y de asset | 6 |
| [agrupar-alinear](agrupar-alinear.md) | Alinear, agrupar, portapapeles, bloqueos de disposición | 18 |
| [ejecucion](ejecucion.md) | Run, estimación, aprobación, límite, progreso | 20 |
| [deshacer-bloqueos](deshacer-bloqueos.md) | Undo, Redo, bloqueos durante ejecución | 12 |
| [agente-nodes](agente-nodes.md) | Herramientas del agente sobre el grafo | 19 |
| [atajos-gestos](atajos-gestos.md) | Atajos de teclado y gestos | 26 |
| [estado-compartido](estado-compartido.md) | Estado que comparten los controles | 21 |
| [dependencias](dependencias.md) | Cruces entre controles y promesas P1/P2/P3 | 28 |
| [hallazgos](hallazgos.md) | 17 hallazgos con gravedad y divulgación | 17 |
| [huecos](huecos.md) | Lo no leído y la prueba que lo cierra | 10 |

Total: 393 filas de datos (contadas por script, sin cabeceras ni separadores).

Resumen de hallazgos: ver [hallazgos](hallazgos.md). Los de mayor peso son H1 (capacidad sin guarda: `edit_node` cambia el modelo sin tarjeta; sin decisión escrita para esta herramienta; requiere prueba con un agente real), H2 (modelo de las operaciones de imagen y `animate` invisible; solo 4 operaciones de vídeo lo muestran; decisión), H3 (Delete asset sin confirmar) y H11 (sin Stop ni Comprobar por nodo; reintento = Run otra vez).

Investigación de ComfyUI (código), Figma Weave, Magnific, Freepik y Krea sobre salidas, precio, límite y recuperación (2026-10-29): [[investigacion-nodos-pro]] · [investigacion-nodos-pro.md](investigacion-nodos-pro.md).

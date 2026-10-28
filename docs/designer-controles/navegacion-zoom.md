---
type: inventario
title: Navegación y zoom
description: Zoom, encuadre, desplazamiento y la ayuda de herramienta: botones, campo de porcentaje, rueda, Espacio, flechas y eventos.
tags: [designer, zoom, pan, navegacion]
updated: 2026-10-28
related: [barra-superior, lienzo-gestos, atajos, documentos]
---
# Navegación y zoom

La vista (zoom y posición) es estado local del `Stage` (`Stage.tsx:167`); el espacio de trabajo solo la refleja. Los botones hablan con el lienzo por eventos de ventana (`ogs:designer-zoom`, `ogs:designer-fit`, `ogs:designer-view`, `ogs:pan`). El zoom máximo es 32 (`MAX_ZOOM`, `viewCoordinates.ts:11`) y el mínimo del campo de porcentaje es 5 %.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Zoom in (botón) | Barra vertical «Canvas view» (`DesignerWorkspace.tsx:132`) | Evento `ogs:designer-zoom` ×1.25 al centro del lienzo | Hay documento | No tiene atajo | Barra vertical Canvas view, sin cambio; además fila Zoom del navegador (D14). Si la barra se retira queda por decidir | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Zoom percent (campo editable) | Barra vertical (`DesignerWorkspace.tsx:134`) | Evento `ogs:designer-zoom` con el factor para llegar al % tecleado (5 % a 3200 %) | Hay documento | Enter aplica, Esc cancela; se actualiza por `ogs:designer-view` | Se conserva el campo editable; el navegador dibuja un slider en %, no sustituye al campo | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Zoom out (botón) | Barra vertical (`DesignerWorkspace.tsx:144`) | Evento ×0,8 | Hay documento | — | Barra vertical Canvas view, sin cambio; además fila Zoom del navegador (D14). Si la barra se retira queda por decidir | se conserva | [d14-navegador](../mockups/designer-ajustes/d14-navegador.html) |
| Fit canvas (botón) | Barra vertical (`DesignerWorkspace.tsx:145`) | Evento `ogs:designer-fit` | Hay documento | Además el lienzo se ajusta solo al abrir un documento o cambiar su tamaño (`Stage.tsx:284`) | Se conserva; el mockup del navegador no lo dibuja | se conserva | no dibujado |
| Show/Hide tool help (botón ?) | Barra vertical (`ToolHelp.tsx:47`) | `ui.toolHelp` | Hay documento | Es lo único que contiene `ViewToggles` | Igual que hoy | se conserva | no dibujado |
| Hide tool help (X de la línea de ayuda) | Línea de ayuda (`ToolHelp.tsx:42`) | `ui.toolHelp = false` | Ayuda visible | Duplica el botón ? | Igual que hoy | se conserva | no dibujado |
| Rueda con Ctrl o Cmd: zoom | Lienzo (`wheelZoom.ts:75`) | Vista del Stage; zoom hacia el puntero con paradas en 25, 50, 100, 150 y 200 % (`wheelZoom.ts:12`) | Puntero sobre el lienzo | Gesto sin botón; el evento se captura para evitar el zoom del navegador (`Stage.tsx:1257`) | Igual que hoy | se conserva | no dibujado |
| Rueda sin modificador: desplazar | Lienzo (`Stage.tsx:1250`) | Vista del Stage (pan) | Puntero sobre el lienzo | Gesto sin botón | Igual que hoy | se conserva | no dibujado |
| Herramienta Pan (H) | Dock › familia Edit › variante Pan (`toolboxModel.ts:25`) | `ui.tool = 'hand'`; arrastrar mueve la vista | Siempre | Su tarjeta no tiene ajustes (`LayersPanel.tsx:265`) | Igual que hoy | se conserva | no dibujado |
| Mantener Espacio y arrastrar | Lienzo (`Stage.tsx:566`) | Vista del Stage | Fuera de campos de texto | Funciona con cualquier herramienta | Igual que hoy | se conserva | no dibujado |
| Botón central del ratón y arrastrar | Lienzo (`Stage.tsx:594`) | Vista del Stage | Siempre | Gesto sin botón | Igual que hoy | se conserva | no dibujado |
| Flechas sin nada elegido: desplazar | Teclado (`designerKeys.ts:86`) | Evento `ogs:pan` → `panOffset` (Shift = paso grande) | Sin objetos elegidos ni edición de nodos | Con objetos elegidos las flechas los mueven (1 px, Shift 10 px) | Igual que hoy | se conserva | no dibujado |
| Selector de documentos desplegable | Encima del lienzo (`DocumentPicker.tsx:42`) | Preferencia `ogs:canvas-picker-open` | Hay documento | Ver [[documentos]] | Igual que hoy | se conserva | no dibujado |

## Enlaces

- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[documentos]] · [documentos.md](documentos.md)
- [[README]] · [Índice](README.md)

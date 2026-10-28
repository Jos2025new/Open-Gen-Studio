---
type: inventario
title: Documentos, importar y exportar
description: Nuevo documento, selector de documentos, importar, exportar, guardar en galería, deshacer, portapapeles y arrastrar y soltar.
tags: [designer, documentos, import, export]
updated: 2026-10-28
related: [barra-superior, tamanos, capas, atajos, estudio-embebido]
---
# Documentos, importar y exportar

Las acciones de archivo del Designer están repartidas entre la barra superior (`DesignerWorkspace.tsx:84`), el selector de documentos, atajos de teclado y gestos sobre el lienzo. Los presets salen de `DOC_PRESETS` (`doc.ts:35`) y los formatos de exportación de `EXPORT_FORMATS` (`designerFile.ts:10`). El Studio embebido repite el menú de archivo en uno solo ([[estudio-embebido]]).

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| --- | --- | --- | --- | --- |
| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas |
| Pantalla vacía «Start a design» (6 presets) | Espacio de trabajo (`DesignerWorkspace.tsx:153`) | Crea documento (`newBlankDoc`) | Sesión sin documentos | Mismos presets que el menú New document |
| New document › Square 1:1 (1080×1080) | Menú New document (`doc.ts:36`) | `newBlankDoc` | Menú abierto | Los 6 presets son filas de un único menú |
| New document › Portrait 4:5 (1080×1350) | Menú New document (`doc.ts:37`) | `newBlankDoc` | Menú abierto | — |
| New document › Story 9:16 (1080×1920) | Menú New document (`doc.ts:38`) | `newBlankDoc` | Menú abierto | — |
| New document › Landscape 16:9 (1920×1080) | Menú New document (`doc.ts:39`) | `newBlankDoc` | Menú abierto | — |
| New document › Poster 2:3 (1200×1800) | Menú New document (`doc.ts:40`) | `newBlankDoc` | Menú abierto | — |
| New document › A4 portrait (1240×1754) | Menú New document (`doc.ts:41`) | `newBlankDoc` | Menú abierto | — |
| Choose canvas (botón + miniaturas) | Encima del lienzo (`DocumentPicker.tsx:42`) | Preferencia `ogs:canvas-picker-open`; despliega la lista | Hay documento | Muestra el nombre del documento activo |
| Canvases (lista de miniaturas) | Panel desplegable (`DocumentPicker.tsx:31`) | `selectDoc` | Selector abierto | Cada fila: miniatura, nombre y tamaño |
| Import image (botón) | Barra superior (`DesignerWorkspace.tsx:95`) | `importDesignFiles` | Hay documento | Acepta PNG, JPEG, WebP, GIF, SVG, HEIC/HEIF y EPS (`designerFile.ts:17`); varios archivos a la vez |
| Import from chat (botón + popover) | Barra superior izquierda (`ImportFromChat.tsx:64`) | `chatToDesigner` como capas de un diseño o un diseño por imagen | Imágenes del chat sin usar | Opciones «As layers of one» y «Each as a design» (`DesignerWorkspace.tsx:124`) |
| Save to gallery (botón + «Cancel / Save») | Barra superior (`DesignerWorkspace.tsx:103`) | `runDesignOutput(…, gallery = true)` | Hay documento | Confirma con un popover |
| Export (botón + menú) | Barra superior (`DesignerWorkspace.tsx:113`) | Abre el menú | Hay documento | Cuatro formatos, sin confirmación |
| Export › PNG | Menú Export (`designerFile.ts:11`) | `runDesignOutput(…, 'png')` | Menú abierto | «Image, keeps transparency» |
| Export › JPG | Menú Export (`designerFile.ts:12`) | `runDesignOutput(…, 'jpg')` | Menú abierto | «Image, white background» |
| Export › SVG | Menú Export (`designerFile.ts:13`) | `runDesignOutput(…, 'svg')` | Menú abierto | «Editable layers, text and shapes» |
| Export › PDF | Menú Export (`designerFile.ts:14`) | `runDesignOutput(…, 'pdf')` | Menú abierto | «Vector; text in standard fonts» |
| Ctrl+S | Teclado (`designerKeys.ts:32`) | `saveNow` (estado y píxeles pendientes) | Siempre | No exporta; guarda el estado de la app |
| Undo / Redo (botones) | Barra superior (`DesignerWorkspace.tsx:91`) | `undoDoc` / `redoDoc` | Hay documento | Atajos Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y |
| Copiar / cortar / pegar imagen (Ctrl+C, Ctrl+X, Ctrl+V) | Documento (`designerClipboard.ts:68`) | Con selección de píxeles copia solo esos píxeles (cortar los borra); pegar crea capa | Siempre en el Designer completo | Mensajes de error si el navegador no escribe imágenes en el portapapeles |
| Arrastrar un activo de la galería al lienzo | Lienzo (`Stage.tsx:1294`) | `placeAsset` (capa nueva, o base si no hay capas) | Sobre el lienzo | Gesto sin botón |
| Evento ogs:upload | Ventana (`DesignerWorkspace.tsx:78`) | Abre el selector de Import image | Designer completo | Lo disparan otras partes de la app |

## Enlaces

- [[barra-superior]] · [barra-superior.md](barra-superior.md)
- [[tamanos]] · [tamanos.md](tamanos.md)
- [[capas]] · [capas.md](capas.md)
- [[atajos]] · [atajos.md](atajos.md)
- [[estudio-embebido]] · [estudio-embebido.md](estudio-embebido.md)
- [[README]] · [Índice](README.md)

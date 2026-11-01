---
type: inventario
title: Texto (Text)
description: Controles del texto: ajustes del siguiente texto, estilo del texto elegido, Properties, edición en el lienzo.
tags: [designer, texto, text]
updated: 2026-11-01
related: [tira-contextual, propiedades, selector-de-color, estudio-embebido, lienzo-gestos]
---
# Texto (Text)

Hay dos destinos para los mismos campos de estilo: el **siguiente texto** (`ui.text`, `store.ts:178`) y el **texto elegido** (propiedades de su capa). Los campos comunes viven en `TextStyleFields` (`ToolSettings.tsx:198`); el llamador decide qué cambian. Fuentes (`FONT_NAMES`, `doc.ts:19`): Inter, Grotesk, Serif, Display, Condensed, Mono.

| Control | Dónde está hoy | Qué estado modifica | Cuándo aparece | Notas | Dónde quedaría en la propuesta | Estado | Mockup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Texto de ayuda «For the next text you add…» | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:253`) | Ninguno | Tool = text, no compacto | Aclara que el texto elegido se cambia en Properties; NO distingue en la propia fila si hay un texto elegido | Igual que hoy | se conserva | no dibujado |
| Font (select de 6) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:200`) | `ui.text.fontFamily` (`setUi`) | Tool = text | La tira de texto seleccionado tiene el mismo campo sobre la capa (`patchLayer`, `ContextStrip.tsx:79`), pero es código muerto por lectura (`f11a0dd`): requiere decisión (quitar o conectar) y prueba en sandbox | Tarjeta de Text, sin cambio; además en la fila de variantes de Text (F2, mismo `ui.text`) | se conserva | [f-variantes](../mockups/designer-ajustes/f-variantes.html) |
| Size (slider 1 a 500 px) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:201`) | `ui.text.fontSize` | Tool = text | En Properties es un número 4 a 1000 | Tarjeta de Text, sin cambio; además en la fila de variantes de Text (F2, mismo `ui.text`) | se conserva | [f-variantes](../mockups/designer-ajustes/f-variantes.html) |
| Weight (select 100 a 900) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:202`) | `ui.text.fontWeight` | Tool = text | Properties ofrece 300 a 900, no 100 ni 200 | Igual que hoy | se conserva | no dibujado |
| Color | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:203`) | `ui.text.color` | Tool = text | [[selector-de-color]]; sin alfa | Igual que hoy | se conserva | no dibujado |
| Align (select left, center, right) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:204`) | `ui.text.align` | Tool = text | — | Igual que hoy | se conserva | no dibujado |
| Line (slider 0.5 a 3) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:206`) | `ui.text.lineHeight` | Tool = text, no compacto | Sin lugar de edición para un texto ya creado | Igual que hoy | se conserva | no dibujado |
| Spacing (slider −10 a 40 px) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:207`) | `ui.text.letterSpacing` | Tool = text, no compacto | Sin lugar de edición para un texto ya creado | Igual que hoy | se conserva | no dibujado |
| Case (As typed, UPPER, lower, Title Case) | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:208`, `TextStyleFields` no compacto) | `ui.text.textCase` | Tool = text, no compacto | Se aplica al mostrar y en el editor en el lugar (`applyTextCase`, `textLayout.ts`); el texto escrito no cambia | Igual que hoy | se conserva | no dibujado |
| Underline / Strikethrough | Dock › tarjeta / Panel Tool (`ToolSettings.tsx:209`, `:210`) | `ui.text.underline`, `ui.text.strike` | Tool = text, no compacto | Barras calculadas por `decorationRects` (canvas y SVG). No hay espaciado de párrafo: queda pendiente (D38) | Igual que hoy | se conserva | no dibujado |
| Estilo del texto elegido (Font, Size, Weight, Color, Align) | Tira contextual (`ContextStrip.tsx:78`) | La capa de texto activa (`patchLayer`, solo si no está bloqueada) | Tool = text y la capa activa es de texto — Solo en la tira: «código muerto por lectura (`f11a0dd`; [rastreo 2.6](../rastreo/designer.md)) — requiere decisión y prueba en sandbox» | Reemplaza a los ajustes del siguiente texto. La etiqueta de la tira dice «Text → <capa> (selected)» o «new text» (`ContextStrip.tsx:37`) | Igual que hoy | se conserva | no dibujado |
| Text (área de texto, 3 filas) | Panel derecho › Properties, capa de texto (`LayersPanel.tsx:275`) | `layer.text` (`patch` → `patchLayer`) | Capa activa de texto y desbloqueada | — | Igual que hoy | se conserva | no dibujado |
| Font, Size, Weight, Text color, Alignment | Properties (`LayersPanel.tsx:276`) | `layer.fontFamily`, `fontSize`, `fontWeight`, `color`, `align` | Capa activa de texto | Weight: 300, 400, 500, 600, 700, 800, 900. Falta Line y Spacing | Igual que hoy | se conserva | no dibujado |
| Añadir texto (clic) | Lienzo (`Stage.tsx:890`) | Capa de texto nueva «Text» con `ui.text` y ancho automático | Tool = text, clic en zona sin texto | Abre el editor en el lugar. Si hay un texto bajo el puntero (no bloqueado) lo elige y lo edita | Igual que hoy | se conserva | no dibujado |
| Editor en el lugar (textarea sobre el lienzo) | Lienzo (`TextEditor.tsx:8`) | `layer.text` al salir (`patchLayer` en `Stage.tsx:1343`) | Editando un texto | Escape, Ctrl/Cmd+Enter o perder el foco confirman; las teclas escritas antes de enfocar se conservan | Igual que hoy | se conserva | no dibujado |
| Doble clic en un texto (Edit) | Lienzo (`Stage.tsx:1278`) | Entra en edición del texto | Tool = move; texto no bloqueado | — | Igual que hoy | se conserva | no dibujado |

## Cambios del 2026-11-01

- **Mayúsculas y subrayado.** Case, Underline y Strikethrough están en la tarjeta de Text (no en la tira compacta). El texto guardado es el escrito; Case solo cambia cómo se ve, en el lienzo, en el editor y en la exportación SVG (`export.ts`). Prueba: `tests/text-decoration-case.test.ts`. Prueba visual pendiente (el usuario, en el sandbox).
- **Sin espaciado de párrafo.** Es el siguiente hueco de la lista de pendientes ([pendientes-designer](../pendientes-designer.md), D38).

## Enlaces

- [[tira-contextual]] · [tira-contextual.md](tira-contextual.md)
- [[propiedades]] · [propiedades.md](propiedades.md)
- [[selector-de-color]] · [selector-de-color.md](selector-de-color.md)
- [[estudio-embebido]] · [estudio-embebido.md](estudio-embebido.md)
- [[lienzo-gestos]] · [lienzo-gestos.md](lienzo-gestos.md)
- [[README]] · [Índice](README.md)

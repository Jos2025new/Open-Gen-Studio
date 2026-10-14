# 0016 — Modo Dibujo y modo Diseño

## Estado

Aceptado

## Fecha

2026-10-13

## Contexto

Cada trazo raster se guarda como entrada editable hasta un límite (`paintStrokes`, contador de cupo, aviso y aplanado). Ese modelo sirve para diseño, pero para dibujar pesa: cada trazo es una entrada más que recomponer, y el límite interrumpe el trabajo. Krita, GIMP y Photoshop pintan directamente en los píxeles de la capa.

## Decisión

1. **Un ajuste de documento con dos valores.** `paintMode`: `drawing` (Dibujo) o `design` (Diseño).
2. **Dibujo es el valor por defecto en documentos nuevos** (`createDoc`). Los trazos raster van a los píxeles de la capa, sin entrada en `paintStrokes` y sin contador de cupo.
3. **Diseño es el comportamiento actual**: los trazos son editables hasta el límite, con contador, aviso y aplanado.
4. **Documentos existentes sin ajuste guardado** no se reescriben: se leen en Diseño si alguna capa raster tiene trazos editables, y en Dibujo si no (`paintModeOf`).
5. **Cambiar de Diseño a Dibujo no aplana nada.** Los trazos ya editables se quedan. Cambiar de Dibujo a Diseño solo afecta a los trazos nuevos.
6. **Pintar en Dibujo sobre una capa con trazos editables** (decisión del usuario, 2026-10-13, opción a). El trazo se rechaza y aparece un aviso con tres acciones, sin `confirm()`: «Flatten and paint» aplana los trazos de la capa en un solo paso de deshacer; «Paint in Design» cambia el documento a Diseño; «New layer» crea una capa raster encima, la selecciona y pinta en ella. Cerrar el aviso no hace nada. El trazo que disparó el aviso no se pinta: lo pinta el siguiente, como con el límite de cupo. «Don't show again» guarda la acción como preferencia (`ui.drawingChoice`, con los ajustes persistidos) y la aplica sin aviso, con un toast que dice qué se hizo. Ajustes → «Ask every time» la borra.
7. **Seleccionar y mover trazos sueltos** solo se ofrece en Diseño, o en capas raster que ya tienen trazos editables.

## Alternativas

- **Un solo modo (Diseño para todo).** Descartado: el límite de cupo interrumpe el dibujo, que es el uso habitual.
- **Dibujo como modo por capa.** Descartado: el usuario quiere un interruptor por documento; la excepción de capas con trazos editables se resuelve en la regla 6.
- **Migrar los documentos antiguos.** Descartado: no se reescribe nada; el valor se deduce al leer.

## Consecuencias

- Módulo nuevo `src/engine/design/paintMode.ts` (la lógica) y `src/components/designer/PaintModeToggle.tsx` (el interruptor). `raster.ts` y `Stage.tsx` solo enrutan. El aviso y sus acciones están en `drawingChoice.ts` y `DrawingChoice.tsx`.
- El píxel de un trazo de Dibujo sale del mismo camino de pintura (`beginEdit`, `paintLive`, `endBrushStroke`, `commitEdit`) que el de un trazo de Diseño aplanado. Los tests comprueban ese camino, no el píxel: el entorno de pruebas no tiene canvas real.

## Enmienda (2026-10-14): modo por defecto según el contenido

- **Sin elección guardada**, el documento abre en **Diseño** si no tiene píxeles pintados en ninguna capa raster (solo formas vectoriales, o capas vacías), y en **Dibujo** si alguna capa raster tiene píxeles pintados o una imagen importada. Trazos editables: Diseño, como antes.
- **Motivo:** el usuario quiere que los documentos de formas empiecen con las ayudas de diseño (ajuste, espaciado), y que los documentos de pintura empiecen en Dibujo, sin lag. Código: `src/engine/design/paintMode.ts` (`paintModeOf`, `hasPaintedPixels`); tests `tests/paint-mode-default.test.ts`.
- **No excluyentes:** el interruptor de ajuste se guarda por modo (`snapByMode`) y puede activar en Dibujo lo que Diseño tiene por defecto, o apagarlo en Diseño.
- **Opciones por modo:** el menú Snap permite activar por separado página, otras capas, guías, espaciado igual y nodos de trayecto. Los documentos con preferencias anteriores, sin los campos nuevos, conservan esos objetivos activados como antes; los valores de cada modo no se mezclan.
- **Defaults y comprobación:** Diseño activa el ajuste por defecto; Dibujo lo deja apagado, y cada modo conserva su preferencia. Los tests de modo/sesión verifican estos defaults y las opciones. La evidencia de gesto, E2E y límites actuales está en el [cierre del lote de snapping](../history/026-2026-10-W42.md#cierre-del-lote-de-snapping).
- **Límite conocido en esa versión, resuelto en la segunda enmienda:** el modo se calculaba al leer y podía cambiar al pintar el primer píxel; ahora se fija al crear o leer el documento por primera vez.

## Enmienda (2026-10-14, segunda): el modo se fija al crear o leer por primera vez

- Resuelve el «límite conocido» de la enmienda anterior. `pinPaintMode` (`paintMode.ts`) guarda en `paintMode` el modo deducido la primera vez que el documento se crea, se importa (SVG), se añade a una sesión, se selecciona o se modifica (`setDoc` lo fija antes de aplicar el cambio). Campo existente, sin migración: un documento antiguo sin campo se deduce como antes y se guarda en ese momento.
- Después solo lo cambia el interruptor Dibujo/Diseño (y la acción «Paint in Design» del aviso). Pintar el primer píxel o añadir una forma ya no lo cambia. Tests: `tests/paint-mode-pin.test.ts`.

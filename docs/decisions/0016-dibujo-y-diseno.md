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
6. **Una capa con trazos editables no recibe trazos de Dibujo** mientras los conserve: pintar sobre ella necesitaría aplanarla, y el aplanado la quita de la edición. El aviso lo dice. Esta regla es una decisión pendiente del usuario (ver «Consecuencias»).
7. **Seleccionar y mover trazos sueltos** solo se ofrece en Diseño, o en capas raster que ya tienen trazos editables.

## Alternativas

- **Un solo modo (Diseño para todo).** Descartado: el límite de cupo interrumpe el dibujo, que es el uso habitual.
- **Dibujo como modo por capa.** Descartado: el usuario quiere un interruptor por documento; la excepción de capas con trazos editables se resuelve en la regla 6.
- **Migrar los documentos antiguos.** Descartado: no se reescribe nada; el valor se deduce al leer.

## Consecuencias

- Módulo nuevo `src/engine/design/paintMode.ts` (la lógica) y `src/components/designer/PaintModeToggle.tsx` (el interruptor). `raster.ts` y `Stage.tsx` solo enrutan.
- El píxel de un trazo de Dibujo sale del mismo camino de pintura (`beginEdit`, `paintLive`, `endBrushStroke`, `commitEdit`) que el de un trazo de Diseño aplanado. Los tests comprueban ese camino, no el píxel: el entorno de pruebas no tiene canvas real.
- Pendiente del usuario: qué hacer con pintar en una capa que aún tiene trazos editables en Dibujo. Hoy se avisa y no se pinta. Las alternativas son aplanar esa capa (con deshacer) o pintar encima sin tocar sus trazos, y cada una cambia la regla 6.

---
type: investigacion
title: Comparación con Krita y estado de cada mejora
description: Resumen de las dos lecturas de código de Krita frente al Designer (2026-11-06), qué se hizo, qué se descartó, qué queda diferido y las dudas abiertas.
tags: [designer, krita, investigacion, pendientes]
updated: 2026-11-07
related: [README, seleccion, atajos, relleno, cuentagotas, selector-de-color, degradado, pincel, lienzo-gestos]
---
# Comparación con Krita y estado de cada mejora

Dos Sonnet leyeron el código de Krita (`~/Descargas/krita-master`) y el del Designer el 2026-11-06, en rama `task/plus-center`. Solo lectura de código: ni la app ni el navegador. Lo que dicen de Photoshop, GIMP, Figma o Inkscape es memoria del agente, no verificado. Los informes completos (30–42 KB cada uno) quedaron fuera del repo; este archivo conserva sus conclusiones.

Krita es una referencia entre varias: el usuario también mide con SAI 2, MediBang e ibisPaint.

## Selección, mover, recorte, vectores, zoom

| # | Mejora propuesta | Estado |
|---|---|---|
| 1 | Seleccionar desde el alfa de la capa; casilla Contiguous en la varita | Descartado por el usuario (así funcionan SAI 2, MediBang, ibisPaint) |
| 2 | Intersect (Shift+Alt), cursor +/−/∩, Shift cuadrado/círculo, Alt desde el centro, lectura W×H | Hecho (`ccf12ba4`); sin prueba visual |
| 3 | Familia Select propia tras Edit: rect, elipse, lazo, polígono, varita; `M` cicla | Hecho (`ccf12ba4`) |
| 4 | Feather y antialias | Descartado por el usuario (bordes duros, como las apps de pintura) |
| 5 | Mover el contorno con la herramienta de selección | Hecho (`ccf12ba4`); sin prueba visual |
| 6 | Atajos de zoom Ctrl+= / Ctrl+- / Ctrl+0 | Hecho (`ccf12ba4`) |
| 7 | Shift bloquea eje al mover; Alt escala desde el centro (y sin snap) | Hecho (`ccf12ba4`) |
| 8 | Recorte sobre el lienzo, recortar a selección, proporciones fijas | Diferido (grupo 4) |
| 9 | Pluma Bézier | Diferido (grupo 4) |
| 10 | Perspectiva de 4 asas, ángulo numérico | Diferido (grupo 4) |

Menores no tomados: reseleccionar (Ctrl+Shift+D), ocultar selección (Ctrl+H), Esc cancela el arrastre, zoom a rectángulo, rotar la vista, selección a trazado.

## Pincel, color, relleno, degradado, cuentagotas

| # | Mejora propuesta | Estado |
|---|---|---|
| 1 | `[` `]` con pasos proporcionales y aviso de tamaño | Hecho (`brushSizeStep.ts`, `ValueNotice.tsx`) |
| 2 | Shift+clic: recta desde el último punto | Hecho (`paintLastPoint.ts`) |
| 3 | Flow y Blend junto a Size/Opacity; Lock alpha con icono | Flow hecho; Blend y Lock alpha siguen solo en la tarjeta |
| 4 | Color primario y secundario, `X` intercambia, `D` repone | Hecho (`colorPair.ts`, `ColorPair.tsx`, `colorKeys.ts`) |
| 5 | Relleno: capa activa o todas, cerrar huecos | Hecho (`sampleSource.ts`, `fill.ts`, `FillSettings`) |
| 6 | Cuentagotas: radio, arrastre en vivo, fuente, lupa, Alt desde herramientas de color | Hecho (`StageSample`, `SampleLoupe`, `SamplerSettings`); sin prueba visual |
| 7 | Degradado con varias paradas y presets | Diferido (grupo 4) |
| 8 | Formas: Alt desde el centro, lectura W×H | Sin decidir |
| 9 | Texto en caja de ancho fijo | Sin decidir |
| 10 | Varias guías, regla paralela | Sin decidir |

Donde el Designer ya iguala o gana, según el informe: Fill y Gradient crean capa nueva; presets de tamaño; diagnóstico de presión; motivos de bloqueo visibles; formas vectoriales reeditables; recientes deduplicados; un solo popover de color.

## Dudas abiertas (no bloquean; se aplicó el valor por defecto)

- `M` en Select cicla la forma; Shift+M sigue en Shape Builder.
- Alt y Shift+Alt pueden chocar con el gestor de ventanas de Linux (mover ventana, cambio de teclado). Salida propuesta: Ctrl+Shift como alias de muestreo o una preferencia de tecla.
- `D` repone blanco y negro.
- Posición de Select justo tras Edit.
- Teclado español: `[` `]` se leen por `e.key` y admiten AltGr.

## Pendiente de comprobar

Prueba visual del usuario: insignia del cursor, W×H, polígono, mover contorno, lupa, fila del pincel con Flow, posición del aviso de valor. Las líneas de `ToolHelp` y la tabla de este índice no se actualizaron para los gestos nuevos.

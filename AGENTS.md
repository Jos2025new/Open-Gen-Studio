# AGENTS.md — Open Gen Studio

Guía para agentes. Estado general e historial: `PROGRESS.md`. Repo git desde 2026-09-24 (`main`).

## Reglas de trabajo
- Antes de operar, escribe aquí el plan paso a paso con su razón (breve). Marca `[x]` al terminar.
- Cambios mínimos: un detalle de 1–2 líneas (color, espaciado) no requiere leer todo el código.
- Verifica con `npx tsc --noEmit -p .`, `npm test` y navegador (`npm run dev`, puerto 5173).
- Un commit por tarea terminada.

## Tarea actual — correcciones Designer (2026-09-24)
1. [x] "Free" en la lista de modelos muy separado → pegarlo al nombre. *Razón: lectura rápida del precio junto al modelo.*
2. [x] Aviso "Creates a new vector layer" fijo (`Stage.tsx`, `.stage-hint subtle`): sale mientras haya herramienta de forma y la capa activa no sea vectorial (p. ej. tras colocar una imagen) → eliminarlo. *Razón: con el paso 4 toda forma crea su capa; el aviso ya no informa nada.*
3. [x] Tinte verdoso: lo aplica el modelo demo "Local Sketch" (`demo/ops.ts` `stylize`) al simular img2img con la imagen adjunta → bajar la intensidad. *Razón: la demo no debe alterar tanto la referencia.*
4. [x] Formas se fusionan: cada forma nueva se añadía a la capa vectorial activa → cada forma crea su propia capa (salvo capa vectorial activa vacía). *Razón: edición independiente.*
5. [x] Caja de texto enorme: se creaba con ancho fijo (60 % del lienzo) → ancho `0` = automático, la caja mide el texto y crece al escribir (`scaleLayer` conserva el 0). *Razón: selección precisa.*
6. [x] Pincel/borrador destructivos → `RasterLayer.allowPaint`; una imagen (`sourceAssetId`) está protegida salvo que se active "Allow painting" en Propiedades. El pincel sobre imagen/otra capa crea una capa "Paint N" encima (o reutiliza la de encima) y la deja activa, así los siguientes trazos van a ella. Borrador bloqueado en imágenes protegidas. *Razón: edición no destructiva sin una capa por trazo.*
7. [x] Panel derecho: ancho arrastrable (borde izquierdo, guardado en localStorage), botón para plegar, secciones "Layers" y "Properties" plegables; el composer se centra con la variable `--layers-w`. *Razón: más espacio de lienzo.*
8. [x] Typecheck, tests, navegador; commit.
9. [x] Extra hallado al verificar: el editor de texto se cerraba al crearse (el `mousedown` del lienzo le quitaba el foco) → foco en `requestAnimationFrame`. Separado el contador de grupo en la lista de modelos ("LOCAL DEMO 1").

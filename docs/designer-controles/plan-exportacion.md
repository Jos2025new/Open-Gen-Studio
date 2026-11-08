# Plan: exportación del Designer, fase 1 (2026-11-08)

Para quien implemente (GPT). Lo revisa Claude después. Base: rama `task/multi-pick`. Trabaja en una rama propia que salga de ella (`git worktree add ../ogs-export -b task/export task/multi-pick`). Lee [AGENTS.md](../../AGENTS.md) antes de empezar.

## Reglas de trabajo (léelas primero; son obligatorias)

- **Alcance cerrado.** Haz solo lo de «Fase 1». Lo de «Fuera de la fase 1» no se toca aunque parezca fácil.
- **Decide lo pequeño, pregunta lo grande.** Detalles internos (nombres de funciones, estructura de módulos): decide y anótalo en el informe. Pregunta antes de: borrar o migrar datos, tocar una zona de [persistencia protegida](../persistencia-protegida.md), cambiar el aspecto de controles fuera del panel Export, o añadir dependencias.
- **Subagentes: como mucho 3**, de un modelo barato, cada uno con un encargo completo y cerrado. Sin supervisarlos ni preguntarles a mitad; como mucho una pregunta breve si su informe no sirve. Verifica tú en el código lo que te digan.
- **Pruebas: solo las afectadas** mientras trabajas (`npx vitest run <archivos>` y `npx tsc -b --noEmit`). `npm test` completo **una sola vez**, al final, en segundo plano. Una ejecución a la vez; nada de bucles de espera.
- **Para cuando** todo lo de la lista «Pruebas» pase y el panel funcione en el sandbox. No pulas más allá.
- **Si algo falla dos veces igual**, para, escribe la causa que sospechas en el informe y sigue con lo demás.
- **Informe con nombre fijo:** `../ogs-export-report.md` (si existe, `-2`, `-3`). No le pongas el nombre de tu modelo.

## Qué queremos

Un panel **Export** de una pantalla, sencillo como Canva y sólido como VectorCraft:

1. **Para qué es** (presets de serie) arriba: elegir uno rellena el resto.
2. **Ajuste rápido** siempre visible: formato, qué exportar, tamaño, miniatura y botón Export.
3. **Más opciones** plegado, según el formato.

Investigación de origen (Inkscape, Graphite, VectorCraft, Canva y tipos de usuario): resumida en la conversación del 2026-11-08; lo esencial está en este plan.

## Lo que hay hoy (no reescribir sin motivo)

- Botón Export y menú de formatos: `src/components/designer/DesignerWorkspace.tsx` (~113-122). Studio: `src/components/studio/EmbeddedFileMenu.tsx` (~24-40).
- Formatos y entrada común: `src/components/designer/designerFile.ts` (`runDesignOutput`, con try/catch y aviso).
- Descarga: `exportDocFile` en `src/engine/design/actions.ts` (~457-469); galería `saveDocToGallery` (siempre PNG).
- Raster PNG/JPG: `src/engine/design/render.ts` (~469-483; JPG con fondo blanco y calidad fija 0.92). SVG: `src/engine/design/export.ts` (`docToSvg`). PDF: `export.ts` (~202-216, jsPDF + svg2pdf).
- Límites: `src/engine/design/exportLimits.ts` (8192 px por lado; 33.554.432 px con FX).
- Descarga del navegador: `src/lib/media.ts` (~305-313). ZIP: `fflate` ya es dependencia.
- Pruebas: `tests/design-export.test.ts` (solo SVG), `tests/fx-render.test.ts` (PNG/JPG y límites). Sin pruebas de PDF, `exportDocFile`, nombres ni galería.

## Diseño

### 1. Un solo motor: `exportPlan` → archivos

- Nuevo módulo puro en `src/engine/design/` (p. ej. `exportJob.ts`): recibe `{ doc, preset/ajustes, área }` y devuelve `[{ name, mime, bytes }]`, o un error con mensaje accionable. Sin DOM de descarga dentro.
- Reutiliza `exportDoc`, `docToSvg` y el PDF existentes; añade solo lo que falta: escala, área (lienzo / selección / capa), WebP (`canvas.toBlob('image/webp', q)`), transparencia o color de fondo, calidad JPG/WebP, límite de peso en KB (bajar calidad por pasos hasta caber; si no cabe, error que lo diga), texto en contornos para SVG/PDF si el motor ya lo permite (si no, déjalo fuera y dilo).
- `exportDocFile`, el Designer, Studio y el agente llaman a este motor: un comportamiento, una batería de pruebas.

### 2. Presets de serie (no se pueden borrar ni sobrescribir)

| Grupo | Preset | Salida |
|---|---|---|
| Compartir | WhatsApp | JPG calidad 85, lado largo 1600 px |
| | Instagram | JPG, 1080 px de ancho; si la proporción no es 4:5 ni 1:1, aviso en el panel y opción visible «Encajar en 4:5» (no automática; bandas del color de fondo, blanco si es transparente) |
| | Web ligera | WebP calidad 80 (JPG si el navegador no codifica WebP) |
| Imprimir | En casa | PDF A4, sin sangrado |
| | Imprenta | PDF a 300 ppp; sangrado 3 mm y marcas de corte si el motor PDF lo permite sin riesgo (si no, fase 2 y dilo) |
| Trabajo | Portafolio | PNG 2x |
| | Logo / marca | SVG + PNG 1x + PNG @2x, en **un ZIP** |
| | Personalizado | Lo que el usuario deje ajustado |

Los valores exactos (1600, 85, 80) son puntos de partida: déjalos en una tabla de datos, no repartidos por el código.

### 3. Panel

- Reemplaza el menú de formatos por el panel (popover o tarjeta con el estilo de la app; reutiliza componentes existentes: `InlineChoice`, `InlineSlider`, `Popover`, segmentados). Sin `confirm()` nativo.
- Ajuste rápido: Formato (PNG · JPG · WebP · SVG · PDF) · Qué exportar (Lienzo · Selección · Capa) · Tamaño (1x · 2x · 3x o ancho en px) con tamaño final y peso aproximado · miniatura generada con los mismos bytes que se guardan · Export.
- Más opciones (plegado): transparencia/fondo (PNG, WebP), calidad o límite KB (JPG, WebP), PDF pantalla/imprenta, «Guardar como preset».
- Studio (`EmbeddedFileMenu`) abre el mismo panel.

### 4. Recordar y presets propios

- El documento recuerda su última exportación válida (campo opcional en el doc; documentos viejos sin él siguen igual). Abrir el panel la recupera; Export repite en un clic.
- **Nunca cambiar en silencio lo que se exporta**: si la capa o selección recordada ya no existe, o el tamaño supera el límite, el panel lo indica y Export no actúa hasta elegir otra cosa.
- Presets propios: en la app (ajustes), no en el documento. Los de serie no se tocan.
- Antes de añadir campos persistidos, consulta [persistencia protegida](../persistencia-protegida.md); si toca una zona protegida, para y pregunta.

### 5. Solidez

- Nombres: `nombre-del-doc` + sufijo del preset (`@2x`) + extensión; nunca dos archivos con el mismo nombre en un ZIP; descargas sueltas añaden `-2`, `-3` solo dentro de la sesión si el navegador no lo hace.
- Varias salidas → **un ZIP**, creado solo si todas salieron bien (todo o nada). Una salida → archivo suelto.
- Todo error llega al usuario con un aviso que propone el arreglo («Demasiado grande: prueba con 2x», «La capa ya no existe»). Nada solo en consola.
- Exportaciones grandes o ZIP: indicador de progreso y Cancelar; cancelar no deja nada descargado.
- Respeta `exportLimits.ts`; la escala no puede saltárselo.

## Fuera de la fase 1

Varias versiones a la vez (escala × formato × sufijo), seguir en segundo plano, CMYK, PDF/X, presets iOS/Android.

## Pruebas (vitest; solo las afectadas mientras trabajas, `npm test` una vez al entregar)

- Motor: cada formato produce bytes válidos (firma PNG/JPEG/WebP/PDF, SVG parseable); escala y área dan las dimensiones esperadas; transparencia y fondo del JPG; límite KB; límites de tamaño dan error con «No file was created».
- Presets: cada preset de serie produce exactamente sus salidas; «Logo / marca» da un ZIP con 3 entradas y nombres distintos; si una salida falla, no hay ZIP.
- Recordar: la última exportación se recupera; capa/selección desaparecida bloquea Export con mensaje; documento viejo sin el campo funciona.
- Panel: elegir preset rellena los campos; Más opciones cambia según formato; Studio abre el mismo panel.
- PDF: al menos que genere un PDF válido de un documento con texto y forma.

## Entrega

- Commits pequeños en `task/export`; no fusionar ni hacer push.
- Actualiza `docs/designer-controles/` (la página que describa Export), el [índice](README.md) y los contratos de `scripts/map-contracts*.mjs` si cambian; `node scripts/map.mjs --write`.
- Prueba visual solo en el sandbox (`npm run dev:sandbox`, puerto 5183, `.sandbox/data`); nunca `data/`. Detenlo al acabar.
- Informe final: qué hiciste, qué quedó fuera y por qué, decisiones tomadas, resultados de pruebas exactos.

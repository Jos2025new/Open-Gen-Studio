# 078 · Brand Sync en vivo, flujo Canva-simple, endurecimiento y pulido visual (2026-11-27)

Base `8af59bde` → `main` en `db107465` (más este cierre documental), por avance rápido en `ogs-merge`. Guías y fichas: [guia-marca-y-tokens](../guia-marca-y-tokens.md) y [biblioteca-kits](../features/biblioteca-kits.md). Evidencia del cierre, no estado actual.

## Objetivo

Cerrar el ciclo completo de marca en Open Gen Studio: logos y componentes enlazados con propagación automática u *on-demand* y reversión quirúrgica, exportación SVG con `vigente/` para Inkscape, incorporación simplificada estilo Canva (arrastre único + **Link all** en 1 clic), auditorías adversariales y pruebas a ciegas de usuario nuevo.

## Qué quedó en `main`

- `795a63dc` y `bb5d6710` (`task/brand-sync`):
  - Logos de marca enlazados (`libraryAsset` en `RasterLayer`, `placeLinkedAsset`, `replaceSectionAsset`), sincronización de instancias de componentes (`group.from`) conservando posición y `tokenMode`, tokens de `radiusToken` y `widthToken`, aviso no bloqueante `BrandSyncNotice` con **Revert** / **On demand** / **Update now**, y exportación SVG con enlace a `vigente/<slug>.png` vía endpoint local `POST /x/brand-export/sync` (`server/brand-export.js`).
  - Cierre de los 8 hallazgos de la auditoría inicial de Hydrogen (reversión quirúrgica, snapshots de píxeles, carreras, CSRF, componentes).
- `d8263b22` y `ca57652b` (`task/brand-easy`):
  - Importación masiva todo-en-uno (`src/engine/brandBulkImport.ts`) que clasifica `tokens.json`, fuentes, logos y fotos automáticamente.
  - Enlace automático en 1 clic (`src/engine/brandAutoLink.ts`, comando `library.item.auto_link`) para colores (con alfa `#rrggbbaa`), fuentes, tamaños, radios, anchos y logos en un solo paso de deshacer.
  - Guía práctica [guia-marca-y-tokens.md](../guia-marca-y-tokens.md) y actualización de `CAPABILITIES` del agente.
- `1ab85010` y `99eb4738` (`task/brand-hardening`):
  - Cierre completo de las 2 rondas adversariales de **GPT 6.2 Sol** (15 hallazgos en R1 + 7 en R2): sync en dos fases sobre el documento vivo, reversión quirúrgica respetando ediciones posteriores sobre la misma propiedad, preservación 1-a-1 de textos homónimos en componentes, escritura atómica de `brand-exports/` con validación de magic bytes / `lstat` / `realpath` / 409 en `tokens.json` y directorios únicos por versión, verificación exacta por `(subjectId, nodeId)` en SVG con fallback embebido, slug estable de carpeta del kit, extensiones por MIME y dedupe en lotes repetidos.
- `338a3d65` (`task/brand-ux-doors`):
  - Cierre de las 3 puertas UX detectadas en la ronda 1 de **GPT 6 Luna**: abrir `KitPage` al crear un Brand Kit o desde el menú Brand, permitir `File → Import image / SVG` sin documento abierto, y avisar si se exporta SVG con `Link brand logos` en un diseño con 0 logos enlazados.
- `13238427` y `6ee62aaf` (`task/brand-polish` y `task/brand-polish-2`):
  - Pulido visual tras las pruebas a ciegas de Luna R2 y Hydrogen R1: `BrandSyncNotice` en la esquina superior derecha despejado de toasts y `LayersPanel`, panel expandido `.side-panel.is-expanded` (`z-index: 40`) por encima de `Properties`, cabecera compacta en una línea en el panel lateral estrecho, zonas de arrastre y estados vacíos en `KitPage`/`KitTokens`, auto-guardado inmediato al importar `tokens.json` y textos unificados en inglés coherente con la UI.
- `db107465` (`task/brand-fix-save`):
  - Cierre del único hallazgo bloqueante de **GPT 6.2 Sol (R3)** en `KitTokens.tsx`: si falla la persistencia al importar `tokens.json` (p. ej. `QuotaExceededError` en IndexedDB), se muestra toast de error explícito y nunca toast de éxito, conservando las filas en el editor para reintentar `Save`.

## Revisiones y pruebas independientes

- **GPT 6.2 Sol (R1, R2, R3 y R4):** 2 rondas adversariales en Chromium/Node/HTTP cerradas en `99eb4738`, revisión de los commits de pulido (1 bloqueante en `KitTokens.tsx`, `161/161` tests en 22 suites), y verificación final de cierre en `db107465` con veredicto **`APROBADO`**.
- **GPT 6 Luna (R1 y R2, a ciegas en sandbox):** detectó las puertas de entrada UX (cerradas en `338a3d65`) y la fricción visual / estados vacíos (cerrados en `13238427`).
- **Hydrogen (R1 y R2, `gemini-4-hydrogen-medium`, a ciegas en sandbox limpio):** en R2 (`db107465`) completó todo el recorrido de principio a fin sin errores en consola (Brand Kit todo-en-uno → importar SVG → `Link all` → cambio de color en vivo → `Revert` → exportar SVG con namespaces Inkscape/Sodipodi).

## Límites conocidos para trabajo futuro

- El importador de SVG rasteriza los elementos `<text>` en lugar de convertirlos en capas de texto editables.
- En Designer, un botón explícito de importar archivo/SVG en la barra principal mejoraría aún más la descubribilidad para usuarios nuevos.

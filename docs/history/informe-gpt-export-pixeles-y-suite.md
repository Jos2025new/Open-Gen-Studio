# Informe: píxeles y suite de exportación

**Fecha:** 2026-11-09. **Rama:** `task/export`; punto de partida `34b26ea4`. Sin commit, sandbox ni datos reales. Memoria antes de las pruebas: entre 2,4 y 2,7 GiB disponibles; un trabajador de Vitest. La referencia `2361e6cb` se extrajo a un directorio temporal aislado, sin crear ramas ni worktrees, y usó las mismas dependencias locales.

## Píxeles reales

Se empaquetó `tests/browser-export-pixels.ts` con Rolldown y se abrió un HTML local aislado con agent-browser. La prueba construye dos trazos en memoria, usa Multiply y compara el PNG producido por `exportPlan` con `drawDoc`. No se abrió la app ni se usó el almacenamiento del usuario.

- **Original:** PNG de 15 × 54; 684 píxeles opacos, cero diferencias; 48 parcialmente transparentes, sin diferencias de alfa detectadas. En el cruce, render y PNG: RGBA `[128, 64, 128, 255]`.
- **Cruce diagonal ampliado:** `tests/browser-export-overlap.ts` conserva la comparación original y además construye una huella independiente del trazo seleccionado. Dentro de la huella se compararon **1252 píxeles**, con **0 diferencias de color y 0 de alfa**. Fuera se examinaron **2798 píxeles**, incluidos **646** donde el otro trazo era visible: **0 filtraciones**. El PNG mide 75 × 54.
- La máscara actual convierte su cobertura no nula en alfa 255 antes de recortar; en estos casos el PNG conserva los bordes del render. No hubo discrepancia que exigiera cambiar el código de exportación.

**Límite:** no se arrastró el pincel mediante la interfaz; es canvas real en navegador con trazos construidos por código. No se probaron todas las texturas, escalas, modos de mezcla o formatos. La prueba de huella no establece separación semántica de las contribuciones cuando dos trazos se mezclan: verifica que se conservan los píxeles compuestos dentro de la forma elegida.

## Cuatro fallos preexistentes

Tanto en `2361e6cb` como en `34b26ea4`, `vitest run --maxWorkers=1` sobre los cuatro archivos dio **55 aprobadas y 4 fallidas**, las mismas cuatro. Se corrigieron las pruebas, no la apariencia ni el render:

1. `bubble-text.test.ts`: el test exigía que el compositor leyera directamente `--surface`; [historial 058](058-2026-11-W45.md) documenta la decisión posterior de compartir `--bar-bg`. Ahora comprueba ese token y su alias `--surface`; la burbuja mantiene su propio control.
2. `ui-single-slider.test.ts`: la tira usa `--bar-bg` por la misma decisión. El test también omitía `designer-connected-2.css`, donde vive la regla de la opción segmentada activa; ahora la incluye y sigue verificando `--field-on`.
3. `shape-kinds.test.ts`: la estructura esperada era anterior a la reorganización de Pan, Edit y Shapes documentada en [toolbox](../designer-controles/toolbox-dock.md). Ahora comprueba las tres familias actuales y conserva las verificaciones de herramientas, atajos y variantes de elipse.
4. `fx-render.test.ts`: el caso afirmaba que el fondo entraba en el efecto, pero construía un documento cuyo fondo es transparente por defecto. Ahora fija un fondo blanco en ese caso y conserva las comprobaciones del filtro y del orden. El cambio de fondo por defecto consta en [historial 058](058-2026-11-W45.md) y `tests/doc-background.test.ts`.

Después de los cambios: **59/59 pruebas relacionadas pasan** con un trabajador. No se alteraron estilos, tarjetas, temas ni caja de herramientas.

## Verificación final

- `npm test -- --maxWorkers=1`: **516 archivos y 3494 pruebas aprobados; 5 archivos y 5 pruebas omitidos** (805,21 s). Pasaron TypeScript, salvaguardas, documentación, límites de tamaño, estilos y mapa de 83 contratos. Vitest emitió avisos de `getContext` de jsdom; la suite terminó con código 0.
- No se ejecutó sandbox ni app real; ninguna ejecución de proveedor.
- Las pruebas de píxeles no son un preflight PDF/X ni prueban impresión o compatibilidad con otros editores.

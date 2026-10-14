export default [{
  id: 'designer-selection',
  what: 'Edit selecciona objetos en Objects y capas en Layers; marquee y redondeo actúan solo sobre el conjunto explícito, sin mezclar selección raster.',
  sides: [
    ['src/engine/design/marquee.ts', 'export function marqueeIds'],
    ['src/engine/design/objectSelection.ts', 'export function pickObject'],
    ['src/engine/design/selection.ts', 'export function setLayerPicks'],
    ['src/components/designer/StageEditMarquee.ts', "kind: 'editMarquee'"],
    ['src/engine/design/multiRectEdit.ts', 'export function multiLayerRectangles'],
    ['src/components/designer/ContextStrip.tsx', 'MultiRectangleRadii'],
    ['src/components/designer/ToolSettings.tsx', 'function EditOps'],
  ],
  tests: ['tests/marquee.test.ts', 'tests/layer-click-replaces.test.ts', 'tests/multi-layer-rect-rounding.test.ts', 'tests-e2e/multi-select.spec.ts'],
}];

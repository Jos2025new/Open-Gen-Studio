export default [{
  id: 'designer-selection',
  what: 'Edit selecciona y transforma objetos en Objects y capas visibles en Layers; el marquee normal comparte geometría y deja aparte el raster.',
  sides: [
    ['src/engine/design/marquee.ts', 'export function marqueeIds'],
    ['src/engine/design/objectSelection.ts', 'export function pickObject'],
    ['src/engine/design/selection.ts', 'export function setLayerPicks'],
    ['src/components/designer/StageEditMarquee.ts', "kind: 'editMarquee'"],
    ['src/components/designer/ToolSettings.tsx', 'function EditOps'],
  ],
  tests: ['tests/marquee.test.ts', 'tests/layer-click-replaces.test.ts'],
}];

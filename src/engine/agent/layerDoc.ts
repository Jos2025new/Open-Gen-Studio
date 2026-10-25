/** Layer step fields, described once: the propose_plan schema (tools.ts) and the agent's capability map (context.ts) both read these, so they cannot drift apart. */
export const LAYER_DOC = {
  target: '"base" (layer 1), "new", or an existing layer id of the same type.',
  source: 'image reference; "base" is layer 1: the main generated image always goes to base.',
  style: '{font_family: Inter|Grotesk|Serif|Display|Condensed|Mono, font_size, font_weight, color "#hex", align left|center|right, line_height, letter_spacing}.',
  box: '{x, y, width}: text position and wrap width in document pixels.',
  shapes:
    'vector layer shapes in document px: {type: rect|ellipse|line, x, y, w, h, fill "#hex"|null, stroke "#hex"|null, stroke_width, radius} or {type: "path", d, fill, stroke, stroke_width} with absolute commands only (M L C Q S T Z) for precise curves.',
  strokes:
    'freehand drawing in document px: [{points: [[x, y] or [x, y, pressure 0-1], …], color, size}]; enough points to follow each curve. vector layer → editable strokes; raster layer (target "new") → painted with the brush on a new layer.',
} as const;

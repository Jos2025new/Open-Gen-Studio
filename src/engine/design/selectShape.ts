/** The shapes of the Select family. Stored as `ui.selectShape`; an old build meeting a new value falls back to the rectangle. */
export const SELECT_SHAPES = ['rect', 'ellipse', 'lasso', 'polygon', 'wand'] as const;
export type SelectShape = (typeof SELECT_SHAPES)[number];

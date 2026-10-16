import type { Measure } from '../../engine/design/snap';
import type { AlignmentGuide } from '../../engine/design/snapSession';

/** The snap guides drawn over the stage while something moves. */
export type GuideLines = { x?: number; y?: number; m?: Measure[]; a?: AlignmentGuide[] };

const same = <T,>(a?: T[], b?: T[], equal: (x: T, y: T) => boolean = Object.is) => a === b || (!a && !b) || Boolean(a && b && a.length === b.length && a.every((x, i) => equal(x, b[i])));
const sameMeasure = (a: Measure, b: Measure) => a.label === b.label && a.a[0] === b.a[0] && a.a[1] === b.a[1] && a.b[0] === b.b[0] && a.b[1] === b.b[1];
const sameAlignment = (a: AlignmentGuide, b: AlignmentGuide) => a.a[0] === b.a[0] && a.a[1] === b.a[1] && a.b[0] === b.b[0] && a.b[1] === b.b[1];

/** Equal guides keep the old object, so a pointer move that changes nothing does not redraw. */
export const sameGuides = (cur: GuideLines, g: GuideLines): boolean => cur.x === g.x && cur.y === g.y && same(cur.m, g.m, sameMeasure) && same(cur.a, g.a, sameAlignment);

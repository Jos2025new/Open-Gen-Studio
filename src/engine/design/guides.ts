import { getDoc, mutateDoc } from './actions';

/* Ruler guides of a design: vertical lines (x) and horizontal lines (y) in page units, saved with the document. */

export type GuideAxis = 'x' | 'y';

/** Add a guide, or move guide `index` to `at`. One undo step. */
export function placeGuide(sessionId: string, docId: string, axis: GuideAxis, at: number, index?: number): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  const g = doc.guides ?? { x: [], y: [] };
  const list = [...g[axis]];
  const v = Math.round(at * 10) / 10;
  if (index == null) list.push(v);
  else list[index] = v;
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), guides: { ...g, [axis]: list } }));
}

export function removeGuide(sessionId: string, docId: string, axis: GuideAxis, index: number): void {
  const doc = getDoc(sessionId, docId);
  const g = doc?.guides;
  if (!g) return;
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), guides: { ...g, [axis]: g[axis].filter((_, i) => i !== index) } }));
}

export function clearGuides(sessionId: string, docId: string): void {
  if (!getDoc(sessionId, docId)?.guides) return;
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), guides: undefined }));
}

/** Tick spacing in page units for a zoom: about every 50–100 screen px, on 1/2/5 × 10ⁿ steps. */
export function rulerStep(zoom: number): number {
  const target = 70 / zoom;
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? 10 * pow;
}

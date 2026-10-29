/** Lift a toolbar above every overlapping dock element, including stacked elements. */
export function dockLift(panel: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, obstacles: DOMRect[]): number {
  let lift = 0;
  for (const r of obstacles.filter(r => panel.right > r.left && panel.left < r.right).sort((a, b) => b.top - a.top)) {
    if (panel.bottom - lift > r.top && panel.top - lift < r.bottom) lift = Math.max(lift, panel.bottom - r.top + 8);
  }
  return lift;
}

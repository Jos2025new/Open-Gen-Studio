/** The left actions (Import from Chat…) live in the session switcher, beside its search: the switcher hands its slot
 *  element here while it is open, and TopbarActions side="left" portals into it. */
let leftSlot: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
export function setLeftSlot(el: HTMLDivElement | null) {
  if (leftSlot === el) return;
  leftSlot = el;
  listeners.forEach((l) => l());
}
export const subscribeLeftSlot = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getLeftSlot = () => leftSlot;

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

/** Home's tabs (Home, Projects, Sessions, Library) sit in the top bar while Home is open: the bar hands its slot here
 *  and HomeView portals the tabs into it (inline when there is no bar, as in tests). */
let homeTabsSlot: HTMLDivElement | null = null;
const homeTabsListeners = new Set<() => void>();
export function setHomeTabsSlot(el: HTMLDivElement | null) {
  if (homeTabsSlot === el) return;
  homeTabsSlot = el;
  homeTabsListeners.forEach((l) => l());
}
export const subscribeHomeTabsSlot = (l: () => void) => { homeTabsListeners.add(l); return () => { homeTabsListeners.delete(l); }; };
export const getHomeTabsSlot = () => homeTabsSlot;

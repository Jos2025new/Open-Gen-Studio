// Appearance preference (base + highlight colour). UI preference only: kept in localStorage, never in the store or the
// persisted settings. The inline script in index.html applies the same mapping before first paint; tests/theme-appearance.test.ts keeps both in sync.
export const BASE_CHOICES = ['sistema', 'atlas', 'grafito', 'claro', 'blanco', 'original'] as const;
export const ACCENT_CHOICES = ['lima', 'azul', 'violeta', 'rosa', 'agua', 'aurora'] as const;
export type BaseChoice = (typeof BASE_CHOICES)[number];
export type AccentChoice = (typeof ACCENT_CHOICES)[number];
export type ResolvedBase = 'atlas' | 'grafito' | 'claro' | 'blanco' | 'original';

export const BASE_KEY = 'ogs-base';
export const ACCENT_KEY = 'ogs-accent';
const LIGHT = '(prefers-color-scheme: light)';

const isBase = (v: unknown): v is BaseChoice => (BASE_CHOICES as readonly unknown[]).includes(v);
const isAccent = (v: unknown): v is AccentChoice => (ACCENT_CHOICES as readonly unknown[]).includes(v);

function store(): Storage | undefined {
  try { return localStorage; } catch { return undefined; }
}

/** Stored choice (a missing, unknown or unreadable value is atlas / lima, as in the pre-paint script). */
export function readTheme(): { base: BaseChoice; accent: AccentChoice } {
  let base: BaseChoice = 'atlas';
  let accent: AccentChoice = 'lima';
  try {
    const b = localStorage.getItem(BASE_KEY);
    const a = localStorage.getItem(ACCENT_KEY);
    if (isAccent(a)) accent = a;
    if (isBase(b)) base = b;
  } catch { /* storage unavailable */ }
  return { base, accent };
}

/** The data-base value: sistema follows prefers-color-scheme (claro when light, otherwise atlas). */
export function resolveBase(base: BaseChoice): ResolvedBase {
  if (base !== 'sistema') return base;
  try { return matchMedia(LIGHT).matches ? 'claro' : 'atlas'; } catch { return 'atlas'; }
}

export function applyTheme(choice = readTheme()): void {
  const root = document.documentElement;
  root.setAttribute('data-base', resolveBase(choice.base));
  root.setAttribute('data-accent', choice.accent);
}

/** Preference subscription (useSyncExternalStore): fires after a change made here and after another tab's storage event, so a
 *  panel showing the preferences never keeps stale copies. */
const prefListeners = new Set<() => void>();
const notifyPrefs = () => prefListeners.forEach((l) => l());
export function subscribePrefs(listener: () => void): () => void {
  prefListeners.add(listener);
  watchStorage();
  return () => { prefListeners.delete(listener); };
}

function save(key: string, value: string): void {
  try { store()?.setItem(key, value); } catch { /* applied for this session only */ }
  notifyPrefs();
}

export function setBase(base: BaseChoice): void {
  save(BASE_KEY, base);
  applyTheme({ ...readTheme(), base });
}

export function setAccent(accent: AccentChoice): void {
  save(ACCENT_KEY, accent);
  applyTheme({ ...readTheme(), accent });
}

/** Contrast (Look → Accessibility): Soft / Normal / High, one attribute over every base (src/styles/soft-contrast.css,
 *  src/styles/high-contrast.css). Kept apart from base and accent; the pre-paint script applies it too. The key predates
 *  the choice: a stored 'soft' is still Soft, 'high' is new, anything else is Normal. */
export const CONTRAST_KEY = 'ogs-contrast';
export const CONTRAST_CHOICES = ['soft', 'normal', 'high'] as const;
export type ContrastChoice = (typeof CONTRAST_CHOICES)[number];
export function readContrast(): ContrastChoice {
  try { const v = localStorage.getItem(CONTRAST_KEY); return v === 'soft' || v === 'high' ? v : 'normal'; } catch { return 'normal'; }
}
export function applyContrast(choice: ContrastChoice = readContrast()): void {
  if (choice === 'normal') document.documentElement.removeAttribute('data-contrast');
  else document.documentElement.setAttribute('data-contrast', choice);
}
export function setContrast(choice: ContrastChoice): void {
  try { if (choice === 'normal') store()?.removeItem(CONTRAST_KEY); else store()?.setItem(CONTRAST_KEY, choice); } catch { /* applied for this session only */ }
  applyContrast(choice);
  notifyPrefs();
}
export const readSoftContrast = (): boolean => readContrast() === 'soft';
export const setSoftContrast = (soft: boolean): void => setContrast(soft ? 'soft' : 'normal');

/** Text size (Look → Accessibility): a multiplier on the root, in standard steps up to 200 % (WCAG 1.4.4). Applied as
 *  --text-scale on <html> (src/styles/accessibility.css multiplies the font-size tokens and the body size by it). */
export const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75, 2] as const;
export const TEXT_SCALE_KEY = 'ogs-text-scale';
// Last value known in this tab: stepping starts from it, so blocked or full storage can't make the buttons stick.
let memScale = 1;
let memApplied = false;
export function readTextScale(): number {
  try {
    const n = Number(localStorage.getItem(TEXT_SCALE_KEY));
    memScale = (TEXT_SCALES as readonly number[]).includes(n) ? n : 1;
  } catch { /* storage unavailable: the in-memory value stands */ }
  return memScale;
}

/** The size in effect in this tab (what the panel shows): the last applied one, so a full storage can't roll it back. */
export const currentTextScale = (): number => (memApplied ? memScale : readTextScale());

export function applyTextScale(scale = readTextScale()): void {
  memScale = scale;
  memApplied = true;
  const root = document.documentElement;
  if (scale === 1) { root.removeAttribute('data-text-scale'); root.style.removeProperty('--text-scale'); return; }
  root.setAttribute('data-text-scale', String(scale));
  root.style.setProperty('--text-scale', String(scale));
}
/** Moves one step (-1 smaller, +1 larger), clamped to the ends of TEXT_SCALES. Returns the new value. */
export function stepTextScale(dir: -1 | 1): number {
  const i = Math.max(0, (TEXT_SCALES as readonly number[]).indexOf(memApplied ? memScale : readTextScale()));
  const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, i + dir))];
  memScale = next;
  try { if (next === 1) store()?.removeItem(TEXT_SCALE_KEY); else store()?.setItem(TEXT_SCALE_KEY, String(next)); } catch { /* applied for this session only */ }
  applyTextScale(next);
  notifyPrefs();
  return next;
}

/** Reduce motion and stronger focus outline: root classes (src/styles/accessibility.css). Reduce motion follows
 *  prefers-reduced-motion until the user chooses ('on' / 'off' stored); an explicit off sets data-motion="full". */
export const MOTION_KEY = 'ogs-motion';
export const FOCUS_KEY = 'ogs-focus';
export function readReduceMotion(): boolean {
  let v: string | null = null;
  try { v = localStorage.getItem(MOTION_KEY); } catch { /* storage unavailable */ }
  if (v === 'on') return true;
  if (v === 'off') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
export function readStrongFocus(): boolean {
  try { return localStorage.getItem(FOCUS_KEY) === 'on'; } catch { return false; }
}
export function applyMotion(reduce = readReduceMotion()): void {
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', reduce);
  if (reduce) root.removeAttribute('data-motion'); else root.setAttribute('data-motion', 'full');
}
export function applyFocus(strong = readStrongFocus()): void {
  document.documentElement.classList.toggle('focus-strong', strong);
}
export function setReduceMotion(reduce: boolean): void { save(MOTION_KEY, reduce ? 'on' : 'off'); applyMotion(reduce); }
export function setStrongFocus(strong: boolean): void {
  try { if (strong) store()?.setItem(FOCUS_KEY, 'on'); else store()?.removeItem(FOCUS_KEY); } catch { /* applied for this session only */ }
  applyFocus(strong);
  notifyPrefs();
}
/** The effective Reduce motion setting, for animations driven from JS (requestAnimationFrame, WAAPI .animate()), which the
 *  CSS rule in accessibility.css can't slow down. Same answer as the root class: the stored choice, else the OS. */
export const prefersReducedMotion = (): boolean => readReduceMotion();
/** `behavior` for scrollTo / scrollBy / scrollIntoView: smooth unless Reduce motion is on. */
export const scrollBehavior = (): 'auto' | 'smooth' => (readReduceMotion() ? 'auto' : 'smooth');
export function applyAccessibility(): void { applyContrast(); applyTextScale(); applyMotion(); applyFocus(); }

/** Icon set (Look → Icons). Same localStorage pattern; a tiny subscription so every icon re-renders when it changes
 *  (src/components/ui/icon-core.tsx). Unknown or missing values are Lucide. */
export const ICON_SET_CHOICES = ['lucide', 'phosphor', 'obra'] as const;
export type IconSet = (typeof ICON_SET_CHOICES)[number];
export const ICON_SET_KEY = 'ogs-icon-set';
const isIconSet = (v: unknown): v is IconSet => (ICON_SET_CHOICES as readonly unknown[]).includes(v);
let iconSet: IconSet | undefined;
const iconListeners = new Set<() => void>();
export function readIconSet(): IconSet {
  if (iconSet) return iconSet;
  let v: unknown;
  try { v = localStorage.getItem(ICON_SET_KEY); } catch { /* storage unavailable */ }
  return (iconSet = isIconSet(v) ? v : 'lucide');
}
export function setIconSet(next: IconSet): void {
  iconSet = next;
  try { if (next === 'lucide') store()?.removeItem(ICON_SET_KEY); else store()?.setItem(ICON_SET_KEY, next); } catch { /* applied for this session only */ }
  iconListeners.forEach((l) => l());
  notifyPrefs();
}
export function subscribeIconSet(listener: () => void): () => void {
  iconListeners.add(listener);
  watchStorage();
  return () => { iconListeners.delete(listener); };
}

/** While Sistema is selected, re-apply when the OS switches between light and dark. Returns the stop function. */
export function watchSystemTheme(): () => void {
  try {
    const mq = matchMedia(LIGHT);
    const onChange = () => { if (readTheme().base === 'sistema') applyTheme(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch { return () => undefined; }
}

/** One window 'storage' listener for the whole app (installed once, however many icons subscribe): another tab changing a
 *  preference updates this one. A null key means the storage was cleared. */
let storageWatched = false;
function watchStorage(): void {
  if (storageWatched || typeof window === 'undefined') return;
  storageWatched = true;
  window.addEventListener('storage', (e) => {
    const k = e.key;
    if (k === null || k === BASE_KEY || k === ACCENT_KEY) applyTheme();
    if (k === null || k === CONTRAST_KEY) applyContrast();
    if (k === null || k === TEXT_SCALE_KEY) applyTextScale();
    if (k === null || k === MOTION_KEY) applyMotion();
    if (k === null || k === FOCUS_KEY) applyFocus();
    if (k === null || k === ICON_SET_KEY) { iconSet = undefined; readIconSet(); iconListeners.forEach((l) => l()); }
    notifyPrefs();
  });
}

/** Keeps Reduce motion live while the user hasn't chosen (follows prefers-reduced-motion changes) and listens for other
 *  tabs' changes. Call once at startup. Returns the stop function for the media listener. */
export function watchAccessibility(): () => void {
  watchStorage();
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { let v: string | null = null; try { v = localStorage.getItem(MOTION_KEY); } catch { /* storage unavailable */ } if (v !== 'on' && v !== 'off') applyMotion(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch { return () => undefined; }
}

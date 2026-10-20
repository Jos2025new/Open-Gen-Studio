// Appearance preference (base + highlight colour). UI preference only: kept in localStorage, never in the store or the
// persisted settings. The inline script in index.html applies the same mapping before first paint; tests/theme-appearance.test.ts keeps both in sync.
export const BASE_CHOICES = ['sistema', 'atlas', 'grafito', 'claro', 'original'] as const;
export const ACCENT_CHOICES = ['lima', 'azul', 'violeta', 'rosa', 'agua', 'aurora'] as const;
export type BaseChoice = (typeof BASE_CHOICES)[number];
export type AccentChoice = (typeof ACCENT_CHOICES)[number];
export type ResolvedBase = 'atlas' | 'grafito' | 'claro' | 'original';

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

function save(key: string, value: string): void {
  try { store()?.setItem(key, value); } catch { /* applied for this session only */ }
}

export function setBase(base: BaseChoice): void {
  save(BASE_KEY, base);
  applyTheme({ ...readTheme(), base });
}

export function setAccent(accent: AccentChoice): void {
  save(ACCENT_KEY, accent);
  applyTheme({ ...readTheme(), accent });
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

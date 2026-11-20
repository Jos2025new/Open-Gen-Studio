

export const RULER = 18;
/** A theme token for canvas drawing, so rulers and the page edge follow the base. */
export const tok = (n: string, f: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;
/** The selection colour (the highlight's --accent, a hex) at an alpha: handles and picks follow the chosen highlight. */
export const accentA = (a = 1) => { const n = parseInt(tok('--accent', '#d4f25a').slice(1, 7), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

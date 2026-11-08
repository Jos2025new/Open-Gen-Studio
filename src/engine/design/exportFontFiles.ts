/** The font files the app ships (only Inter has one; the other families are system fonts the page cannot read). */
const inter: Record<number, () => Promise<{ default: string }>> = {
  100: () => import('@fontsource/inter/files/inter-latin-100-normal.woff?url'),
  200: () => import('@fontsource/inter/files/inter-latin-200-normal.woff?url'),
  300: () => import('@fontsource/inter/files/inter-latin-300-normal.woff?url'),
  400: () => import('@fontsource/inter/files/inter-latin-400-normal.woff?url'),
  500: () => import('@fontsource/inter/files/inter-latin-500-normal.woff?url'),
  600: () => import('@fontsource/inter/files/inter-latin-600-normal.woff?url'),
  700: () => import('@fontsource/inter/files/inter-latin-700-normal.woff?url'),
  800: () => import('@fontsource/inter/files/inter-latin-800-normal.woff?url'),
  900: () => import('@fontsource/inter/files/inter-latin-900-normal.woff?url'),
};

/** WOFF bytes of the bundled font nearest to this weight, or null when the family has no bundled file. */
export async function loadBundledFont(family: string, weight: number): Promise<Uint8Array | null> {
  if (family !== 'Inter') return null;
  const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  try {
    const res = await fetch((await inter[w]()).default);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

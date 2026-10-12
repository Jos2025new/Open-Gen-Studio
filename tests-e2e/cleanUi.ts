import type { Page } from '@playwright/test';

/*
 * A clean Designer state, once per test. The sandbox keeps the `ui` part of the store between runs and specs
 * (store.ts partialize), so any test that does not fix what it measures can inherit a value left by an earlier
 * run (investigation 2026-10-11: a brush left at #202020 made designer-flows «retouch» see no white pixels).
 * Call it right after the Designer is open, before any other setUi of the test: the values a test sets itself
 * after it stay in charge. Swatches and workspace are left alone.
 */
export async function resetDesignerUi(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string);
    const snap = await import('/src/engine/design/snap.ts' as string);
    const d = st.DEFAULT_UI;
    st.setUi({
      tool: d.tool,
      // A new object replaces the whole brush, so the advanced fields (keepOpacity, mirror, blend, smoothing,
      // stabilization, minSize…) go back to "not set" = the engine defaults.
      brush: { ...d.brush },
      lineart: { ...d.lineart },
      shape: { ...d.shape },
      text: { ...d.text },
      // Not in the initial state: the app falls back to its defaults (ToolSettings.tsx, Stage.tsx).
      gradient: undefined,
      wand: undefined,
      rulers: false,
      selectShape: 'rect',
      strokeRuler: null,
      strokeRulerKind: 'line',
      toolHelp: true,
      snap: { ...snap.SNAP_DEFAULT },
      selectMode: 'objects',
    });
  });
}

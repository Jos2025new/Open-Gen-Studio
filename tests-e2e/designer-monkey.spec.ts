import { chromium, expect, test, type Page, type Request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const ORIGIN = 'http://localhost:5183';
test.use({ viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: chromium.executablePath() } });
test.setTimeout(180_000);
type State = { hydrated: boolean; sessionId: string; document: any; selection: { layers: string[]; objects: { layerId: string; ids: string[] } | null }; history: { undo: number; redo: number }; saving: { state: boolean; raster: string[] } };
const errors = new WeakMap<Page, string[]>();
const writes = new WeakMap<Page, Set<Request>>();
const readState = (page: Page): Promise<State> => page.evaluate(() => (window as any).__OGS_TEST__());
const summary = (state: State) => ({ document: state.document, selection: state.selection, history: state.history });
function assertSandbox(page: Page) {
  if (new URL(page.url()).origin !== ORIGIN) throw new Error(`Refusing non-sandbox URL: ${page.url()}`);
}
async function waitSaved(page: Page) {
  assertSandbox(page);
  await expect.poll(async () => {
    const state = await readState(page);
    if (state.saving.state || state.saving.raster.length || writes.get(page)?.size) return false;
    const response = await page.request.get(`${ORIGIN}/x/store/state`);
    if (!response.ok()) return false;
    const saved = (await response.json()).state?.sessions?.[state.sessionId]?.docs?.find((d: any) => d.id === state.document.id);
    if (!saved) return false;
    const { id, width, height, background, layers, groups = [], activeLayerId } = saved;
    return JSON.stringify({ id, width, height, background, layers, groups, activeLayerId }) === JSON.stringify(state.document);
  }, { timeout: 15_000, message: 'Sandbox state and raster writes must finish' }).toBe(true);
}
async function checkInvariants(state: State, page: Page): Promise<string[]> {
  assertSandbox(page);
  const problems: string[] = [], doc = state.document;
  const ids = doc.layers.map((l: any) => l.id), existing = new Set(ids);
  if (existing.size !== ids.length) problems.push('Duplicate layer IDs');
  for (const layer of doc.layers.filter((l: any) => l.type === 'raster')) {
    for (const id of [layer.id, layer.paintBaseId].filter(Boolean)) {
      const response = await page.request.get(`${ORIGIN}/x/store/blob/${encodeURIComponent(`raster:${id}`)}`);
      if (!response.ok()) problems.push(`Missing raster file raster:${id} (HTTP ${response.status()})`);
    }
  }
  for (const id of [...state.selection.layers, doc.activeLayerId].filter(Boolean)) if (!existing.has(id)) problems.push(`Selected layer does not exist: ${id}`);
  const pick = state.selection.objects;
  if (pick) {
    const layer = doc.layers.find((l: any) => l.id === pick.layerId);
    if (!layer) problems.push(`Object selection layer does not exist: ${pick.layerId}`);
    const objects = new Set([...(layer?.shapes ?? []), ...(layer?.strokes ?? []), ...(layer?.paintStrokes ?? [])].map((o: any) => o.id));
    for (const id of pick.ids) if (!objects.has(id)) problems.push(`Selected object does not exist: ${id}`);
  }
  // Groups are flat in the real model: layers point to groups; groups have no parent field.
  const parents = new Map<string, string | undefined>([...doc.layers.map((l: any) => [l.id, l.groupId]), ...doc.groups.map((g: any) => [g.id, undefined])]);
  const groups = new Set(doc.groups.map((g: any) => g.id));
  for (const layer of doc.layers) {
    if (layer.groupId && !groups.has(layer.groupId)) problems.push(`Missing group ${layer.groupId}`);
    let id: string | undefined = layer.id; const seen = new Set<string>();
    while (id) { if (seen.has(id)) { problems.push(`Parent cycle at ${id}`); break; } seen.add(id); id = parents.get(id); }
  }
  problems.push(...(errors.get(page)?.splice(0) ?? []));
  return problems;
}
async function roundTrip(page: Page, reload = false): Promise<string[]> {
  await waitSaved(page);
  const before = await readState(page);
  if (reload) {
    await page.reload();
    await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  } else if (before.history.undo) {
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
  }
  await waitSaved(page);
  const after = await readState(page);
  const changed = Object.keys(summary(before)).filter(k => JSON.stringify((summary(before) as any)[k]) !== JSON.stringify((summary(after) as any)[k]));
  return changed.length ? [`${reload ? 'Save/reload' : 'Undo/redo'} summary changed: ${changed.join(', ')}`] : [];
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    // Saving is enabled ONLY in this isolated sandbox; never disable the real app's automation guard.
    if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  errors.set(page, []); writes.set(page, new Set());
  page.on('console', msg => { if (msg.type() === 'error') errors.get(page)!.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => errors.get(page)!.push(`pageerror: ${error.message}`));
  page.on('request', request => { if (request.url().startsWith(`${ORIGIN}/x/store/`) && !['GET', 'HEAD'].includes(request.method())) writes.get(page)!.add(request); });
  for (const event of ['requestfinished', 'requestfailed'] as const) page.on(event, request => writes.get(page)!.delete(request));
  await page.goto(ORIGIN); assertSandbox(page);
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: 'Square 1:1 1080 × 1080', exact: true }).click();
  await page.getByRole('button', { name: 'Brush (B)', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Size value', exact: true }).fill('20');
  await page.getByRole('spinbutton', { name: 'Smoothing value', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: 'Stabilize value', exact: true }).fill('0');
  await page.locator('.stage-canvas').click({ position: { x: 450, y: 350 } });
  await waitSaved(page); errors.get(page)!.splice(0);
}

test('Designer invariants on real sandbox state', async ({ page }) => {
  await setup(page);
  const problems = await checkInvariants(await readState(page), page);
  problems.push(...await roundTrip(page));
  // No edits between these round trips: the new document has one saved brush mark.
  problems.push(...await roundTrip(page, true));
  console.log(`INVARIANTS ${JSON.stringify(problems)}`);
  expect(problems).toEqual([]);
});

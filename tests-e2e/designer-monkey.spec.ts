import { chromium, expect, test, type Page, type Request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const ORIGIN = 'http://localhost:5183';
test.use({ viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: chromium.executablePath() } });
// About 4 s per action (each one waits for the save), plus start-up.
test.setTimeout(60_000 + 4_000 * Number(process.env.STEPS ?? 300));
type State = { hydrated: boolean; sessionId: string; document: any; selection: { layers: string[]; objects: { layerId: string; ids: string[] } | null }; history: { undo: number; redo: number }; saving: { state: boolean; raster: string[] } };
const errors = new WeakMap<Page, string[]>();
const writes = new WeakMap<Page, Set<Request>>();
const readState = (page: Page): Promise<State> => page.evaluate(() => (window as any).__OGS_TEST__());
const summary = (state: State) => ({ document: state.document, selection: state.selection, history: state.history });
function assertSandbox(page: Page) {
  if (new URL(page.url()).origin !== ORIGIN) throw new Error(`Refusing non-sandbox URL: ${page.url()}`);
}
let lastMismatch = '';
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
    const a = JSON.stringify({ id, width, height, background, layers, groups, activeLayerId }), b = JSON.stringify(state.document);
    if (a !== b) { let i = 0; while (a[i] === b[i]) i++; lastMismatch = `disk …${a.slice(i - 60, i + 80)}… vs memory …${b.slice(i - 60, i + 80)}…`; }
    return a === b;
  }, { timeout: 15_000, message: `Sandbox state and raster writes must finish ${lastMismatch}` }).toBe(true);
}
async function checkInvariants(state: State, page: Page, checkRaster = false): Promise<string[]> {
  assertSandbox(page);
  const problems: string[] = [], doc = state.document;
  const ids = doc.layers.map((l: any) => l.id), existing = new Set(ids);
  if (existing.size !== ids.length) problems.push('Duplicate layer IDs');
  if (checkRaster) for (const layer of doc.layers.filter((l: any) => l.type === 'raster')) {
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
  if (reload) await waitSaved(page);
  const before = await readState(page);
  if (reload) {
    const problems = await checkInvariants(before, page, true);
    if (problems.length) return problems;
    await page.reload();
    await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  } else if (before.history.undo) {
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
  }
  if (reload) await waitSaved(page);
  const after = await readState(page);
  // Selection and undo history are never saved (by design): a reload compares only the document.
  const keys = reload ? ['document'] : Object.keys(summary(before));
  const changed = keys.filter(k => JSON.stringify((summary(before) as any)[k]) !== JSON.stringify((summary(after) as any)[k]));
  return changed.length ? [`${reload ? 'Save/reload' : 'Undo/redo'} summary changed: ${changed.join(', ')}`] : [];
}
/** Network noise from other sites (a provider's schema blocked by CORS on the sandbox port) is not a Designer bug. */
const external = (text: string, url: string) =>
  /Access to fetch at 'https?:\/\/(?!localhost:5183)/.test(text) || (/Failed to load resource/.test(text) && !!url && !url.startsWith(ORIGIN));
async function setup(page: Page) {
  await page.addInitScript(() => {
    // Saving is enabled ONLY in this isolated sandbox; never disable the real app's automation guard.
    if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  errors.set(page, []); writes.set(page, new Set());
  page.on('console', msg => { if (msg.type() === 'error' && !external(msg.text(), msg.location().url)) errors.get(page)!.push(`console: ${msg.text()}`); });
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

function random(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
type Params = { x: number; y: number; dx: number; dy: number; layer: number; choice: number };
const layerPanel = (page: Page) => page.getByRole('complementary', { name: 'Layers', exact: true });
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
}
async function point(page: Page, x: number, y: number) {
  const rect = (await page.locator('.stage-canvas').boundingBox())!;
  const doc = (await readState(page)).document;
  // Exact fit formula read from Stage.tsx; fixed desktop viewport, no zoom/pan actions.
  const z = Math.max(.05, Math.min((rect.width - 144) / doc.width, (rect.height - 222) / doc.height, 4));
  return { x: rect.x + (rect.width - doc.width * z) / 2 + x * z,
    y: rect.y + Math.max(36, (rect.height - 150 - doc.height * z) / 2) + y * z, z };
}
async function geometry(page: Page, objects: boolean) {
  return page.evaluate(async (objects) => {
    const doc = (window as any).__OGS_TEST__().document;
    const layer = doc.layers.find((l: any) => l.id === doc.activeLayerId);
    if (!layer) return null;
    // Read the app's actual geometry; no state mutation or copied hit-test implementation.
    const source = objects ? '/src/engine/design/objectOps.ts' : '/src/engine/design/render.ts';
    const module = await import(source);
    return objects ? module.layerObjects(layer)[0]?.box ?? null : module.layerBox(layer);
  }, objects);
}
const actions: Array<{ name: string; run: (page: Page, p: Params) => Promise<any> }> = [
  { name: 'paint', run: async (page, p) => {
    await page.getByRole('button', { name: 'Brush (B)', exact: true }).click();
    const doc = (await readState(page)).document, a = await point(page, p.x * doc.width, p.y * doc.height);
    await drag(page, a.x, a.y, p.dx, p.dy);
  } },
  { name: 'duplicate', run: async page => {
    const button = layerPanel(page).getByRole('button', { name: 'Duplicate layer', exact: true });
    if (await button.count() && await button.isEnabled()) await button.click(); else return 'no active layer';
  } },
  { name: 'move-object', run: async (page, p) => {
    if (!(await readState(page)).document.layers.length) return 'no layers';
    await page.getByRole('button', { name: 'Edit (V) · drag to move, double-click to edit', exact: true }).click();
    await page.getByRole('radio', { name: 'Objects', exact: true }).first().check();
    const box = await geometry(page, true); if (!box) return 'no selectable objects';
    const a = await point(page, box.x + box.w / 2, box.y + box.h / 2); await drag(page, a.x, a.y, p.dx, p.dy);
  } },
  { name: 'scale-handle', run: async (page, p) => {
    const rows = layerPanel(page).locator('.layer-select'); if (!await rows.count()) return 'no layers';
    await rows.nth(p.layer % await rows.count()).click();
    await page.getByRole('button', { name: 'Edit (V) · drag to move, double-click to edit', exact: true }).click();
    await page.getByRole('radio', { name: 'Layer', exact: true }).first().check();
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    const box = await geometry(page, false); if (!box) return 'empty layer has no handles';
    const a = await point(page, box.x + box.w, box.y + box.h); await drag(page, a.x, a.y, p.dx, p.dy);
  } },
  { name: 'add-layer', run: async (page, p) => {
    await layerPanel(page).getByRole('button', { name: 'New layer', exact: true }).click();
    await page.getByRole('dialog', { name: 'New layer', exact: true }).getByRole('button', { name: ['Raster Pixels: paint, images', 'Vector Shapes and lineart', 'Text'][p.choice % 3], exact: true }).click();
  } },
  { name: 'delete-selection', run: async page => { await page.keyboard.press('Delete'); } },
  { name: 'select-layers', run: async (page, p) => {
    const rows = layerPanel(page).locator('.layer-select'); if (!await rows.count()) return 'no layers';
    await rows.nth(p.layer % await rows.count()).click({ modifiers: [p.choice % 2 ? 'Control' : 'Shift'] });
  } },
  { name: 'group', run: async page => {
    const rows = layerPanel(page).locator('.layer-select'); if (await rows.count() < 2) return 'needs two layers';
    await rows.nth(0).click(); await rows.nth(1).click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
  } },
  { name: 'mode', run: async (page, p) => {
    if (!(await readState(page)).document.layers.length) return 'no layers';
    await page.getByRole('button', { name: 'Edit (V) · drag to move, double-click to edit', exact: true }).click();
    await page.getByRole('radio', { name: p.choice % 2 ? 'Objects' : 'Layer', exact: true }).first().check();
  } },
  { name: 'undo', run: async page => { await page.keyboard.press('Control+z'); } },
];

test('Designer seeded monkey with invariant monitor', async ({ page }) => {
  const seed = process.env.SEED === undefined ? Date.now() >>> 0 : Number(process.env.SEED);
  const count = Number(process.env.STEPS ?? 300), rng = random(seed);
  if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) throw new Error('SEED and STEPS must be integers; STEPS > 0');
  console.log(`SEED=${seed} STEPS=${count} URL=${ORIGIN}`);
  await setup(page);
  const steps: any[] = [];
  for (let step = 1; step <= count; step++) {
    assertSandbox(page);
    const action = actions[Math.floor(rng() * actions.length)];
    const params = { x: .25 + rng() * .5, y: .25 + rng() * .4, dx: Math.round(rng() * 60 - 30), dy: Math.round(rng() * 60 - 30), layer: Math.floor(rng() * 100), choice: Math.floor(rng() * 6) };
    const entry = { step, action: action.name, params, ms: 0, skipped: undefined as string | undefined };
    steps.push(entry); if (steps.length > 50) steps.shift();
    const started = Date.now(); let problems: string[] = [];
    try {
      entry.skipped = await action.run(page, params); entry.ms = Date.now() - started;
      if (step % 25 === 0) await waitSaved(page);
      problems = await checkInvariants(await readState(page), page, step % 25 === 0);
      if (!problems.length) problems.push(...await roundTrip(page));
      if (!problems.length && step % 25 === 0) problems.push(...await roundTrip(page, true));
      if (!problems.length) problems.push(...(errors.get(page)?.splice(0) ?? []));
    } catch (error) { entry.ms = Date.now() - started; problems.push(`Action/monitor error: ${String(error)}`); }
    if (problems.length) {
      const directory = `tests-e2e/failures/${seed}-${step}`;
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/steps.json`, JSON.stringify({ seed, step, requestedSteps: count, steps }, null, 2));
      await writeFile(`${directory}/state.json`, JSON.stringify(await readState(page), null, 2));
      await writeFile(`${directory}/problems.txt`, problems.join('\n') + '\n');
      await page.screenshot({ path: `${directory}/screenshot.png` });
      console.log(`FAIL SEED=${seed} ACTIONS=${step}/${count} ${problems.join('; ')} ARTIFACTS=${directory}`);
      throw new Error(problems.join('; '));
    }
  }
  console.log(`PASS SEED=${seed} ACTIONS=${count}/${count}`);
});

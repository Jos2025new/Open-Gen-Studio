// Download the live catalogs and input schemas of the priority model families (scripts/model-families.json)
// from Atlas Cloud, fal.ai and NanoGPT, trimmed to what the parser reads, into tests/fixtures/live/.
// Public endpoints only: no API key, no cost. Run: npm run snapshot:models
// Then `npx vitest run -u tests/live-snapshot.test.ts` refreshes the expected parse, and git diff shows what changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/fixtures/live');
const fam = JSON.parse(fs.readFileSync(path.join(root, 'scripts/model-families.json'), 'utf8'));
const VIDEO = new RegExp(fam.video, 'i');
const IMAGE = new RegExp(fam.image, 'i');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) return { __error: r.status };
    return r.json();
  }
  return { __error: 429 };
}

/** Keep one schema and every component it references, with long descriptions cut. */
function closure(schemas, start) {
  const keep = {};
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.$ref === 'string') {
      const name = node.$ref.split('/').pop();
      if (!keep[name] && schemas[name]) { keep[name] = schemas[name]; visit(schemas[name]); }
    }
    Object.values(node).forEach(visit);
  };
  keep[start] = schemas[start];
  visit(schemas[start]);
  // The parser reads some descriptions (sizes, limits, mention syntax): keep them nearly whole.
  return JSON.parse(JSON.stringify(keep, (k, v) => (k === 'description' && typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) : k === 'examples' ? undefined : v)));
}

const matches = (re, ...names) => names.some((n) => n && re.test(n));

// Atlas: catalog + OpenAPI schema per model.
const atlasAll = (await get('https://api.atlascloud.ai/api/v1/models')).data;
const atlas = [];
for (const m of atlasAll) {
  const re = m.type === 'Video' ? VIDEO : m.type === 'Image' ? IMAGE : null;
  if (!re || !matches(re, m.model, m.displayName)) continue;
  const doc = m.schema ? await get(m.schema) : null;
  const schemas = doc?.components?.schemas ?? {};
  const inputName = schemas.Input ? 'Input' : Object.keys(schemas).find((k) => /input/i.test(k));
  atlas.push({ ...m, schemaDoc: inputName ? { components: { schemas: closure(schemas, inputName) } } : doc });
}

// fal: every page of the five categories, then the queue OpenAPI of each match.
const fal = [];
for (const category of ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'video-to-video']) {
  const re = category.includes('video') ? VIDEO : IMAGE;
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await get(`https://api.fal.ai/v1/models?category=${category}&status=active&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (r.__error) throw new Error(`fal ${category}: ${r.__error}`);
    for (const m of r.models) if (matches(re, m.endpoint_id, m.metadata?.display_name) && !fal.some((x) => x.endpoint_id === m.endpoint_id)) fal.push({ ...m, category });
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
    await sleep(1200);
  }
}
for (const m of fal) {
  const doc = await get(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(m.endpoint_id)}`);
  const post = doc.paths?.[`/${m.endpoint_id}`]?.post;
  const ref = post?.requestBody?.content?.['application/json']?.schema?.$ref;
  const schemas = doc.components?.schemas ?? {};
  const name = ref ? ref.split('/').pop() : Object.keys(schemas).find((k) => /Input$/.test(k));
  m.schemaDoc = name && schemas[name]
    ? { paths: { [`/${m.endpoint_id}`]: { post: { requestBody: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } } } }, components: { schemas: closure(schemas, name) } }
    : doc;
  await sleep(700);
}

// NanoGPT: the catalogs carry the parameters.
const nanoVideo = (await get('https://nano-gpt.com/api/v1/video-models?detailed=true')).data.filter((m) => matches(VIDEO, m.id, m.name));
const nanoImage = (await get('https://nano-gpt.com/api/v1/images/models')).data.filter((m) => matches(IMAGE, m.id, m.name));
// Speech-to-text models (Transcribe operation): all of them, they are few.
const nanoAudio = (await get('https://nano-gpt.com/api/v1/audio-models?detailed=true')).data.filter((m) => m.capabilities?.speech_to_text);

fs.mkdirSync(out, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(out, 'atlas.json'), JSON.stringify({ date, models: atlas }));
fs.writeFileSync(path.join(out, 'fal.json'), JSON.stringify({ date, models: fal }));
fs.writeFileSync(path.join(out, 'nanogpt.json'), JSON.stringify({ date, video: nanoVideo, image: nanoImage, audio: nanoAudio }));
console.log(`atlas ${atlas.length} · fal ${fal.length} · nanogpt ${nanoVideo.length} video + ${nanoImage.length} image + ${nanoAudio.length} speech-to-text → tests/fixtures/live (${date})`);

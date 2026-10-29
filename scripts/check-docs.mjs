import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { checkDocs } from './check-safeguards.mjs';

const root = process.cwd();
const docs = join(root, 'docs');
const MAX_BYTES = 30_000;
const errors = [];
const files = [];
const links = (text) => [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
const label = (path) => relative(root, path);

async function collect(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) { errors.push(`${label(path)}: symbolic links are forbidden`); return; }
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await collect(join(path, name));
  } else if (info.isFile()) {
    files.push({ path, bytes: info.size });
    if (info.size > MAX_BYTES) errors.push(`${label(path)}: ${info.size} bytes exceeds ${MAX_BYTES}`);
  }
}

async function validateLinks(path, text) {
  for (const href of links(text)) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = resolve(dirname(path), decodeURIComponent(href.split('#')[0]));
    const rel = relative(root, target);
    if (rel.startsWith('..') || rel === 'data' || rel.startsWith('data/') || rel.startsWith('.sandbox/')) {
      errors.push(`${label(path)}: link outside documentation/source scope`);
      continue;
    }
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) errors.push(`${label(path)}: broken link ${href}`);
  }
}

const headings = (text) => [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].trim().toLowerCase());

/**
 * [[wikilinks]] in a folder-indexed note (Obsidian style: [[name]], [[name#Heading]], [[name|alias]]). A name resolves
 * to name.md in the note's own folder first, then to the one file with that name anywhere in docs/; none is broken,
 * several is ambiguous. A #Heading must match a heading of the target. Inline code is skipped.
 */
async function validateWikilinks(path, text) {
  for (const [, inner] of text.replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]]+)\]\]/g)) {
    const [target, section] = inner.split('|')[0].split('#').map((part) => part.trim());
    let dest = null;
    if (!target) dest = path;
    else {
      const name = target.endsWith('.md') ? target : `${target}.md`;
      const near = files.find((f) => f.path === join(dirname(path), name));
      const all = files.filter((f) => f.path.endsWith(`/${name}`));
      if (near) dest = near.path;
      else if (all.length === 1) dest = all[0].path;
      else { errors.push(`${label(path)}: ${all.length ? 'ambiguous' : 'broken'} wikilink [[${inner}]]`); continue; }
    }
    if (section && !headings(await readFile(dest, 'utf8')).includes(section.toLowerCase())) errors.push(`${label(path)}: wikilink [[${inner}]] names a missing heading`);
  }
}

async function main() {
  await collect(docs);
  const indexPath = join(docs, 'README.md');
  const index = await readFile(indexPath, 'utf8');
  const targets = (from, text) => links(text).filter((href) => !/^(https?:|mailto:|#)/.test(href))
    .map((href) => resolve(dirname(from), decodeURIComponent(href.split('#')[0])));
  const indexed = new Set(targets(indexPath, index));
  // A folder index (docs/<folder>/README.md) linked from docs/README.md indexes the files of its folder.
  const folderIndexes = files.filter(({ path }) => path !== indexPath && path.endsWith('/README.md')
    && dirname(dirname(path)) === docs && indexed.has(path));
  const folderOf = new Map();
  for (const { path } of folderIndexes) {
    const text = await readFile(path, 'utf8');
    folderOf.set(dirname(path), new Set(targets(path, text)));
    await validateLinks(path, text);
  }
  // Every note of a folder-indexed folder: its markdown links and its wikilinks must resolve.
  for (const { path } of files.filter((f) => f.path.endsWith('.md') && [...folderOf.keys()].some((dir) => f.path.startsWith(`${dir}/`)))) {
    const text = await readFile(path, 'utf8');
    if (!path.endsWith('/README.md')) await validateLinks(path, text);
    await validateWikilinks(path, text);
  }
  for (const file of files) {
    if (file.path === indexPath || indexed.has(file.path)) continue;
    const folder = [...folderOf.keys()].find((dir) => file.path.startsWith(`${dir}/`));
    if (folder) { if (!folderOf.get(folder).has(file.path)) errors.push(`${label(file.path)}: missing from ${label(join(folder, 'README.md'))}`); }
    else errors.push(`${label(file.path)}: missing from docs/README.md`);
  }
  await validateLinks(indexPath, index);
  const adrs = files.filter(({ path }) => relative(docs, path).startsWith('decisions/') && path.endsWith('.md'));
  for (const { path } of adrs) {
    const text = await readFile(path, 'utf8');
    for (const heading of ['Estado', 'Fecha', 'Contexto', 'Decisión', 'Alternativas', 'Consecuencias']) {
      const section = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text)?.[1]?.trim();
      if (!section) errors.push(`${label(path)}: missing ${heading}`);
    }
    const status = /^## Estado\s*\n\s*([^\n]+)/m.exec(text)?.[1]?.trim();
    if (!/^(Propuesto|Aceptado|Rechazado|Obsoleto|Sustituido por .+)$/.test(status ?? '')) errors.push(`${label(path)}: invalid Estado`);
    const date = /^## Fecha\s*\n\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(text)?.[1];
    if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) errors.push(`${label(path)}: invalid Fecha`);
    await validateLinks(path, text);
  }
  for (const { path } of files.filter(({ path }) => relative(docs, path).startsWith('features/') && path.endsWith('.md'))) {
    const text = await readFile(path, 'utf8');
    if (/\/home\/|\/Users\/|[A-Z]:\\Users\\/.test(text)) errors.push(`${label(path)}: personal path`);
    for (const row of text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith('| Comportamiento'))) {
      const cells = row.split('|');
      if (!/\]\(\.\.\/\.\.\/(src|server)\//.test(cells[2] ?? '')) errors.push(`${label(path)}: claim without source link`);
      if (!(cells[3] ?? '').includes('sin test') && !/\]\(\.\.\/\.\.\/tests\//.test(cells[3] ?? '')) errors.push(`${label(path)}: claim without test or sin test`);
    }
    await validateLinks(path, text);
  }
  const agentsBytes = (await lstat(join(root, 'AGENTS.md'))).size;
  if (agentsBytes > MAX_BYTES) errors.push(`AGENTS.md: exceeds ${MAX_BYTES} bytes`);
  await checkDocs(docs);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`check-docs: PASS (${files.length} files, max ${Math.max(...files.map((f) => f.bytes))} bytes; limit ${MAX_BYTES})`);
  console.log(`Index: complete (${files.length - 1} entries); ADRs: ${adrs.length} with valid status and date`);
  console.log('Feature links: valid; docs secrets: none detected');
}

main().catch((error) => { console.error(`check-docs: FAIL\n${error.message}`); process.exitCode = 1; });

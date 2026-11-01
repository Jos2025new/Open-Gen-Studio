#!/usr/bin/env node
// Functions never vanish (docs/metodo-trabajo.md): every control label (aria-label/title)
// in the baseline must still exist somewhere in src/. Moving a control keeps its label, so
// moves pass; a missing label is a function that may have disappeared.
// In «prueba»: it only warns. `--update` rewrites the baseline; run it only after the user
// approved the removal or the rename.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = join(root, 'scripts/functions-baseline.json');
const LABEL = /(?:aria-label|title)=(?:"([^"{}]+)"|\{'([^'$]+)'\}|\{"([^"$]+)"\})/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.tsx') && !/\.test\./.test(entry.name)) yield path;
  }
}

const labels = new Set();
for await (const path of walk(join(root, 'src'))) {
  for (const m of (await readFile(path, 'utf8')).matchAll(LABEL)) labels.add((m[1] ?? m[2] ?? m[3]).trim());
}
const current = [...labels].sort();

if (process.argv.includes('--update')) {
  await writeFile(baselinePath, JSON.stringify(current, null, 1) + '\n');
  console.log(`check-functions: línea base actualizada (${current.length} etiquetas).`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const missing = baseline.filter((l) => !labels.has(l));
const added = current.filter((l) => !baseline.includes(l));
for (const l of missing) console.log(`aviso F1 falta «${l}»: ¿se movió con otro nombre o desapareció?`);
console.log(`check-functions: ${missing.length} ausente(s), ${added.length} nueva(s) sin registrar (en prueba, no bloquea).`);

/**
 * The code map (docs/map.md): the contracts the compiler does not see (scripts/map-contracts.mjs) and, from the import
 * graph, how many test files reach each module. `node scripts/map.mjs` checks that the map is current and every
 * contract anchor exists; `--write` regenerates it. No dependencies: imports are read with a regular expression.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import contracts from './map-contracts.mjs';

const root = process.cwd();
const OUT = 'docs/map.md';
const CONTRACT_OUT = 'docs/map-contracts.md';
const CONTRACT_OUT_2 = 'docs/map-contracts-2.md';
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|vi\.mock\(\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

function walk(dir) {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('_') ? [] : walk(p);
    return SOURCE.test(e.name) && !e.name.endsWith('.d.ts') && !e.name.endsWith('.d.mts') ? [p] : [];
  });
}

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(root, dirname(from), spec.split('?')[0]);
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return relative(root, p);
  }
  return null;
}

const files = [...walk('src'), ...walk('tests'), ...walk('server'), ...walk('scripts')].sort();
const importers = new Map(files.map((f) => [f, new Set()]));
for (const f of files) {
  for (const m of readFileSync(join(root, f), 'utf8').matchAll(IMPORT)) {
    const target = resolveImport(f, m[1] ?? m[2] ?? m[3] ?? m[4]);
    if (target && importers.has(target) && target !== f) importers.get(target).add(f);
  }
}

/** Test files that reach a module through any chain of imports. */
function testsReaching(file) {
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length) for (const i of importers.get(queue.shift()) ?? []) if (!seen.has(i)) { seen.add(i); queue.push(i); }
  return [...seen].filter((f) => f.startsWith('tests/'));
}

const errors = [];
const link = (p) => `[${p.split('/').pop()}](../${p})`;

// Contracts: every file, anchor and test must exist.
const contractRows = contracts.map((c) => {
  for (const [file, anchor] of c.sides) {
    if (!existsSync(join(root, file))) errors.push(`contract ${c.id}: ${file} does not exist`);
    else if (!readFileSync(join(root, file), 'utf8').includes(anchor)) errors.push(`contract ${c.id}: anchor not found in ${file}: ${anchor}`);
  }
  for (const t of c.tests) if (!existsSync(join(root, t))) errors.push(`contract ${c.id}: test ${t} does not exist`);
  const places = [...new Set(c.sides.map(([f]) => f))].map(link).join(', ');
  return `| **${c.id}** — ${c.what} | ${places} | ${c.tests.map(link).join(', ')} |`;
});

const src = files.filter((f) => f.startsWith('src/'));
const isTest = (f) => /^tests\/.*\.test\.tsx?$/.test(f);
const direct = (f) => [...importers.get(f)].filter(isTest);
const fanIn = (f) => [...importers.get(f)].filter((i) => i.startsWith('src/')).length;
const hubs = [...src].sort((a, b) => fanIn(b) - fanIn(a) || a.localeCompare(b)).slice(0, 20);
const untested = src.filter((f) => !testsReaching(f).some(isTest) && !/types\.ts$/.test(f));
const noDirect = src.filter((f) => !direct(f).length).length;

const areas = new Map();
for (const f of src) {
  const parts = f.split('/');
  const area = parts.slice(0, Math.min(parts.length - 1, 3)).join('/');
  const a = areas.get(area) ?? { files: 0, tests: new Set() };
  a.files++;
  for (const t of direct(f)) a.tests.add(t);
  areas.set(area, a);
}

const contractPage = (rows, part) => `# Contratos del código (${part}/2)

Generado por \`node scripts/map.mjs --write\`; [índice y cobertura](map.md). Se comprueban todos los archivos, anclas y tests de cada contrato.

| Contrato | Lugares | Tests |
| --- | --- | --- |
${rows.join('\n')}
`;
const midpoint = Math.ceil(contractRows.length / 2);
const contractMap = contractPage(contractRows.slice(0, midpoint), 1);
const contractMap2 = contractPage(contractRows.slice(midpoint), 2);

const map = `# Mapa del código

Generado por \`node scripts/map.mjs --write\` desde [map-contracts.mjs](../scripts/map-contracts.mjs) e imports. \`npm test\` comprueba vigencia y anclas; no editar a mano.

## Antes de cambiar código

1. Busca archivo, **contratos** y **módulos centrales**.
2. Cada cambio: \`npm run test:related\`.
3. Actualiza juntos los lados del contrato; registra nuevos en \`scripts/map-contracts.mjs\`.
4. Al cerrar: \`npm test\`.
5. Para rendimiento, sigue el [protocolo](depuracion.md#protocolo); registra sondas en «Qué se mide hoy». \`tests/trace-domains.test.ts\` lo comprueba.

## Contratos que el compilador no ve

Las tablas de contratos [1](map-contracts.md) y [2](map-contracts-2.md) incluyen todos sus archivos, anclas y tests. Se generan y comprueban junto a este índice.

## Módulos centrales

Los más importados por el resto del código: un cambio aquí se propaga lejos. Casi todo pasa por el store, así que «tests que lo alcanzan» por imports no discrimina (la mayoría del motor alcanza casi todos los tests); la columna útil es **tests directos**, los que lo importan y lo prueban por su nombre.

| Módulo | Importado por (src) | Tests directos |
| --- | --- | --- |
${hubs.map((f) => `| ${link(f)} | ${fanIn(f)} | ${direct(f).length} |`).join('\n')}

## Por área

| Área | Archivos | Tests que la importan directamente |
| --- | --- | --- |
${[...areas].sort((a, b) => a[0].localeCompare(b[0])).map(([area, a]) => `| \`${area}\` | ${a.files} | ${a.tests.size} |`).join('\n')}

${noDirect} de ${src.length} módulos no tienen ningún test que los importe directamente.

## Sin ningún test que los alcance

${untested.length ? untested.map((f) => `- ${link(f)}`).join('\n') : 'Ninguno.'}
`;

if (process.argv.includes('--write')) {
  if (errors.length) { console.error(`map: FAIL\n${errors.join('\n')}`); process.exit(1); }
  writeFileSync(join(root, OUT), map);
  writeFileSync(join(root, CONTRACT_OUT), contractMap);
  writeFileSync(join(root, CONTRACT_OUT_2), contractMap2);
  console.log(`map: written ${OUT} (${Buffer.byteLength(map)} bytes, ${contracts.length} contracts)`);
} else {
  const current = existsSync(join(root, OUT)) ? readFileSync(join(root, OUT), 'utf8') : '';
  if (current !== map) errors.push(`${OUT} is out of date: run node scripts/map.mjs --write`);
  const currentContracts = existsSync(join(root, CONTRACT_OUT)) ? readFileSync(join(root, CONTRACT_OUT), 'utf8') : '';
  if (currentContracts !== contractMap) errors.push(`${CONTRACT_OUT} is out of date: run node scripts/map.mjs --write`);
  const currentContracts2 = existsSync(join(root, CONTRACT_OUT_2)) ? readFileSync(join(root, CONTRACT_OUT_2), 'utf8') : '';
  if (currentContracts2 !== contractMap2) errors.push(`${CONTRACT_OUT_2} is out of date: run node scripts/map.mjs --write`);
  if (errors.length) { console.error(`map: FAIL\n${errors.join('\n')}`); process.exit(1); }
  console.log(`map: PASS (${contracts.length} contracts, ${src.length} source files)`);
}

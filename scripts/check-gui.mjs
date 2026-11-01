#!/usr/bin/env node
// GUI consistency: controls must come from the shared components (docs/metodo-trabajo.md).
// Checks structure only, never pixels or colours, so a style change never breaks it.
// Rules in «prueba» only warn; a rule blocks (exit 1) once the user marks it «confirmada».
// Exceptions go in `allow` only when the user asks (experiments, radically new pieces).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const RULES = [
  {
    id: 'G1',
    estado: 'prueba',
    what: 'slider fuera de InlineSlider (primitives.tsx)',
    re: /type="range"/,
    allow: ['src/components/ui/primitives.tsx'],
  },
  {
    id: 'G2',
    estado: 'prueba',
    what: 'diálogo nativo confirm/alert/prompt (AGENTS.md: confirmaciones contextuales)',
    re: /(?<![\w.$])(?:window\.)?(?:confirm|alert|prompt)\(/,
    allow: [],
  },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) yield path;
  }
}

const hits = [];
for await (const path of walk(join(root, 'src'))) {
  const rel = relative(root, path);
  const lines = (await readFile(path, 'utf8')).split('\n');
  for (const rule of RULES) {
    if (rule.allow.includes(rel)) continue;
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (rule.re.test(line)) hits.push({ rule, at: `${rel}:${i + 1}` });
    });
  }
}

const blocking = hits.filter((h) => h.rule.estado === 'confirmada');
for (const h of hits) console.log(`${h.rule.estado === 'confirmada' ? 'ERROR' : 'aviso'} ${h.rule.id} ${h.at}: ${h.rule.what}`);
console.log(`check-gui: ${hits.length} hallazgo(s), ${blocking.length} bloqueante(s).`);
process.exit(blocking.length ? 1 : 0);

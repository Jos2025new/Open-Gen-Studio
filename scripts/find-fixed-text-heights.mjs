// Lists CSS rules whose fixed px (or rem) height / min-height / max-height does not follow Text size, and px width / min-width /
// flex-basis that stays fixed beside a scaled height (square and round controls would stretch). Fix: calc(Npx*var(--text-scale))
// (--text-scale defaults to 1 in tokens.css; the root font-size does not change, so rem needs it too; em already follows the
// element's font-size). A rule that must stay fixed (thumbnails, media, swatches, handles, tracks, checkbox, range, tiles,
// canvas) says so with a `/* text-scale: fixed */` comment in its selector or body: nothing else is skipped, so a new
// `.xyz-item { height: 40px }` is flagged. `--fix` converts; `--strict` exits 1 when anything is left (npm test).
// Widths are paired in a rule that has a scaled height (calc(..--text-scale), or an accessibility.css token such as
// --control-h), and in any rule with the same selector elsewhere in the file. `border-radius: 50%` needs no change.
import fs from 'node:fs'; import path from 'node:path';
const FIX = process.argv.includes('--fix');
const root = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'src';
const ACC = path.join(root, 'styles', 'accessibility.css');
const accSrc = fs.existsSync(ACC) ? fs.readFileSync(ACC, 'utf8') : '';
const scaledTokens = [...accSrc.matchAll(/(--[\w-]+)\s*:\s*calc\([^;]*--text-scale/g)].map((m) => m[1]);
const NUM = '(\\d+(?:\\.\\d+)?)(px|rem)';
const CALC = '(?:calc\\(\\s*\\d+(?:\\.\\d+)?px\\s*\\*\\s*var\\(--text-scale(?:,\\s*1)?\\)\\s*\\))';
const HEIGHT = new RegExp(`(^|[;\\s{])((?:min-|max-)?height)(\\s*:\\s*)${NUM}(?![\\w.%*]|\\s*\\*)`, 'g');
const WIDTH = new RegExp(`(^|[;\\s{])(width|min-width|flex-basis)(\\s*:\\s*)${NUM}(?![\\w.%*]|\\s*\\*)`, 'g');
const SCALED_H = new RegExp(`(?:^|[;\\s{])(?:min-|max-)?height\\s*:\\s*(?:${CALC}|var\\((?:${scaledTokens.join('|') || '--none'})\\b)`);
const OPT_OUT = /text-scale:\s*fixed/;
const px = (n, u) => (u === 'rem' ? +n * 16 : +n);
const scaled = (n, u) => `calc(${px(n, u)}px*var(--text-scale))`;
const normSel = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
const isStep = (s) => /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(s);
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const out = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
  if (f.isDirectory()) walk(p); else if (f.name.endsWith('.css') && path.resolve(p) !== path.resolve(ACC)) scan(p); } };
function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  // Selectors of rules that carry a scaled (or about to be scaled) height: their fixed widths are paired.
  const paired = new Set();
  for (const m of src.matchAll(RULE)) {
    const sel = normSel(m[1]); if (!sel || sel.startsWith('@') || isStep(sel) || OPT_OUT.test(m[1] + m[2])) continue;
    if (SCALED_H.test(m[2]) || [...m[2].matchAll(HEIGHT)].some((h) => px(h[4], h[5]) >= 6)) paired.add(sel);
  }
  const next = src.replace(RULE, (all, selRaw, body, offset) => {
    const sel = normSel(selRaw);
    if (!sel || sel.startsWith('@') || isStep(sel) || OPT_OUT.test(selRaw + body)) return all;
    const line = (n) => src.slice(0, offset + selRaw.length + 1 + n).split('\n').length;
    const fix = (re, nb, kind) => nb.replace(re, (d, pre, prop, colon, n, u, at) => {
      if (px(n, u) < 6) return d;
      out.push(`${file}:${line(at)}  ${sel.split(',').pop().trim()} { ${prop}: ${n}${u} }${kind}`);
      return `${pre}${prop}${colon}${scaled(n, u)}`;
    });
    let nb = fix(HEIGHT, body, '');
    if (paired.has(sel)) nb = fix(WIDTH, nb, '  (paired with a scaled height)');
    return nb === body ? all : `${selRaw}{${nb}}`;
  });
  if (FIX && next !== src) fs.writeFileSync(file, next);
}
walk(root);
console.log(out.join('\n')); console.error(`${out.length} fixed-px heights (or widths beside a scaled height) that do not scale with Text size; opt out with /* text-scale: fixed */`);
if (process.argv.includes('--strict') && out.length && !FIX) process.exit(1);

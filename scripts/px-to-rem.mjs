// Interface lengths in rem so Text size (root font-size) scales the whole UI at once; the canvas draws in px from JS.
// Usage: node scripts/px-to-rem.mjs [--write | --check]. --check lists each px length left in interface CSS and fails.
import fs from 'node:fs'; import path from 'node:path';
const KEEP_PROP = /^(border(-[a-z-]+)?|outline(-[a-z-]+)?|box-shadow|text-shadow|filter|backdrop-filter|-webkit-text-stroke(-width)?|stroke-width|text-underline-offset|text-decoration-thickness)$/;
export const CANVAS_SEL = /canvas|stage|ruler|knot|handle|snap|cursor|path-tools|marquee|brush-preview|tip-shape/i;
const rem = (n) => `${+(n / 16).toFixed(4)}rem`;
const write = process.argv.includes('--write'), check = process.argv.includes('--check');
const hits = [];
let changed = 0, files = 0;
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
  if (f.isDirectory()) walk(p); else if (f.name.endsWith('.css')) doFile(p); } };
function decl(body) {
  return body.replace(/(^|;|\{|\n)(\s*)([a-z0-9-]+)(\s*:\s*)([^;]*)/g, (all, lead, sp, prop, colon, value) => {
    if (prop.startsWith('--') ? /border|shadow|outline|line|radius|^--r-/.test(prop) : KEEP_PROP.test(prop)) return all;
    let v = value.replace(/calc\((-?[\d.]+)px ?\* ?var\(--text-scale(?:, ?1)?\)\)/g, (_m, n) => { changed++; return rem(+n); });
    v = v.replace(/(^|[^\w.#-])(-?\d*\.?\d+)px\b/g, (m, pre, n) => (Math.abs(+n) < 2 ? m : (changed++, hits.push(`${prop}: ${n}px`), `${pre}${rem(+n)}`)));
    return `${lead}${sp}${prop}${colon}${v}`;
  });
}
function doFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/([^{}]*)\{([^{}]*)\}/g, (all, sel, body) => { const s = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim(); return /^@/.test(s.split('\n').pop()) || s === 'html' || CANVAS_SEL.test(s) ? all : `${sel}{${decl(body)}}`; });
  if (out !== src) { files++; if (write) fs.writeFileSync(file, out); }
  if (check) for (const h of hits.splice(0)) {
    const [prop, val] = h.split(': '); const i = src.search(new RegExp(`${prop}\\s*:[^;{}]*\\b${val.replace('.', '\\.')}\\b`));
    console.log(`css/px-in-ui · ${file}:${src.slice(0, i).split('\n').length} · ${h} · fix: node scripts/px-to-rem.mjs --write, or add the rule's selector to CANVAS_SEL if it is canvas`);
  }
  hits.length = 0;
}
walk('src');
console.log(`${write ? 'converted' : 'would convert'} ${changed} values in ${files} files`);
if (check && changed) process.exit(1);

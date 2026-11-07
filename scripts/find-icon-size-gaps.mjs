// Lists CSS rules that size icons (svg, .lucide, icon classes) with fixed px, so Text size can't grow them.
import fs from 'node:fs'; import path from 'node:path';
// Only rules whose target is the icon itself (the LAST compound of the selector), not the button around it: an ancestor
// compound containing -btn does not exclude the rule. Parenthesised arguments (:not(.a-btn) ...) are dropped first.
const lastCompound = (s) => s.trim().replace(/\([^()]*\)/g, '').split(/[\s>+~]+/).pop() ?? '';
const isIconTarget = (s) => { const last = lastCompound(s);
  return /^svg\b|\.lucide\b|glyph\b|-icon\b|\.icon\b/i.test(last) && !/-btn\b|is-icon\b|::?(after|before)/.test(last); };
const out = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
  if (f.isDirectory()) walk(p); else if (f.name.endsWith('.css')) scan(p); } };
const FIX = process.argv.includes('--fix');
function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (FIX) {
    const next = src.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => !sel.trim().split(',').some(isIconTarget) ? all
      : `${sel}{${body.replace(/\b(width|height|min-width|min-height|inline-size|block-size)(\s*:\s*)(\d+(?:\.\d+)?)px/g,
        (d, k, c, n) => (+n < 6 ? d : `${k}${c}calc(${n}px * var(--text-scale, 1))`))}}`);
    if (next !== src) fs.writeFileSync(file, next);
    return;
  }
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(); if (!sel.split(',').some(isIconTarget)) continue;
    for (const d of m[2].matchAll(/\b(width|height|min-width|min-height|inline-size|block-size)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (+d[2] < 6) continue; // strokes and bars, not icon boxes
      const line = src.slice(0, m.index + m[0].indexOf(d[0])).split('\n').length;
      out.push(`${file}:${line}  ${sel.split('\n').pop().trim()} { ${d[1]}: ${d[2]}px }`);
    }
  }
}
walk(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'src');
if (FIX) process.exit(0);
// Icon-size tokens (custom properties whose name contains "icon") defined in px must be scaled in accessibility.css.
const ACC = 'src/styles/accessibility.css';
const acc = fs.existsSync(ACC) ? fs.readFileSync(ACC, 'utf8') : '';
const root = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'src';
const walkTokens = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
  if (f.isDirectory()) { walkTokens(p); continue; }
  if (!f.name.endsWith('.css') || path.resolve(p) === path.resolve(ACC)) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/(--[\w-]*icon[\w-]*)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    if (new RegExp(`${m[1]}\\s*:[^;]*--text-scale`).test(acc)) continue;
    out.push(`${p}:${src.slice(0, m.index).split('\n').length}  ${m[1]}: ${m[2]}px (token not scaled in ${ACC})`);
  } } };
walkTokens(root);
console.log(out.join('\n')); console.error(`${out.length} fixed icon sizes or unscaled icon tokens`);
if (process.argv.includes('--strict') && out.length) process.exit(1);

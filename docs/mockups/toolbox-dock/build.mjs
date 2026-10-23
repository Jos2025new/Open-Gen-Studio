// Empaqueta el HTML real capturado del sandbox (capture.js) y los iconos lucide de la app en real-*.js (≤ 28 KB cada uno).
// Uso: node docs/mockups/toolbox-dock/build.mjs <real.json>
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icons = join(here, '../../../node_modules/lucide-react/dist/esm/icons');
const real = JSON.parse(readFileSync(process.argv[2], 'utf8'));

// Mismo marcado que lucide-react en el rail (16 px, trazo 1.75).
const svg = (name) => {
  const src = readFileSync(join(icons, `${name}.mjs`), 'utf8');
  const start = src.indexOf('{', src.indexOf('__iconData'));
  const { node } = Function(`return ${src.slice(start, src.indexOf('};', start) + 1)}`)();
  const kids = node.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name}" aria-hidden="true">${kids}</svg>`;
};
const names = ['plus', 'mouse-pointer-2', 'hand', 'spline-pointer', 'align-center-vertical', 'squares-unite', 'blocks', 'layout-panel-top', 'crop', 'layout-template', 'grid-3x3',
  'ruler-dimension-line', 'shapes', 'square', 'circle', 'minus', 'move-up-right', 'pentagon', 'star', 'chart-pie', 'spline', 'pen-tool', 'brush', 'paint-bucket', 'blend',
  'square-dashed', 'eraser', 'type', 'drafting-compass', 'layers', 'settings-2', 'chevron-down', 'grip-horizontal'];
const entries = [['icons', Object.fromEntries(names.map((n) => [n, svg(n)]))], ...Object.entries(real)];

for (const f of readdirSync(here)) if (/^real-\d+\.js$/.test(f)) unlinkSync(join(here, f));
const files = [];
let cur = [];
let size = 0;
for (const [k, v] of entries) {
  const line = `R[${JSON.stringify(k)}]=${JSON.stringify(v)};\n`;
  if (size + line.length > 28000 && cur.length) { files.push(cur); cur = []; size = 0; }
  cur.push(line); size += line.length;
}
files.push(cur);
files.forEach((lines, i) => writeFileSync(join(here, `real-${i + 1}.js`), `// Generado por build.mjs; no editar.\nvar R=window.REAL=window.REAL||{};\n${lines.join('')}`));
console.log(`${files.length} archivos:`, files.map((l, i) => `real-${i + 1}.js ${l.join('').length} B`).join(', '));

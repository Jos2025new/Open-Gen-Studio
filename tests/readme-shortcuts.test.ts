import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shortcutGroups } from '../src/engine/shortcuts';
import { OPS } from '../src/engine/ops';
import { WORKFLOWS } from '../src/engine/skills';

/*
 * Three README sections come from the code, so the README never promises a key, a tool or a flow the app lacks:
 * shortcuts (shortcuts.ts, also shown in Settings → Shortcuts), tools on results (OPS) and ready-made flows (WORKFLOWS).
 * After changing any of them: UPDATE_README=1 npx vitest run tests/readme-shortcuts.test.ts
 */
const README = 'README.md';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The reader's sentence for each tool and flow. The lists come from the code: a new one fails here until it has its line. */
const TOOL_ES: Record<string, string> = {
  relight: 'Cambia la luz y conserva el sujeto.',
  angle: 'La misma escena vista desde otra cámara: de frente, de perfil, desde arriba…',
  upscale: 'Más resolución y más detalle (×2 o ×4).',
  remove_bg: 'Recorta el sujeto sobre fondo transparente.',
  reframe: 'Amplía la escena a otro formato: vertical, cuadrado, panorámico.',
  reference_sheet: 'Hoja de referencia de un personaje u objeto (vistas, expresiones o vestuario) para mantenerlo igual después.',
  variations: 'Otras versiones con el mismo sujeto y estilo.',
  edit: 'Describe el cambio y se aplica a la imagen.',
  animate: 'Convierte la imagen en un vídeo.',
  extract_frame: 'Guarda un fotograma del vídeo como imagen.',
  continue: 'Un clip nuevo que arranca donde terminó el anterior.',
  contact_sheet: 'Hoja de contacto: la misma escena desde 9 o 6 ángulos.',
  grid_split: 'Corta una imagen en cuadrícula en imágenes sueltas.',
  join_clips: 'Une clips en un solo vídeo, con música de fondo si quieres.',
  video_upscale: 'Más resolución y detalle para un clip.',
  video_edit: 'Describe un cambio y se aplica a todo el clip.',
  video_extend: 'Alarga el clip con acción nueva.',
  edit_region: 'Pinta una zona y cambia solo esa parte.',
  remove_object: 'Pinta un objeto y desaparece; el fondo se rellena.',
  create_voice: 'Crea una voz reutilizable a partir de 5–30 s de habla limpia.',
  transcribe: 'Convierte una grabación de voz en texto.',
};
const FLOW_ES: Record<string, string> = {
  'image-to-video': 'Diseña la imagen clave y después la anima.',
  'product-pack': 'Sesión de producto: principal, en uso, detalle y características; o un formato concreto (packshot, banner, carrusel, anuncios, try-on, CGI).',
  'character-sheet': 'Vistas de un personaje, sueltas o en una hoja.',
  storyboard: 'Cuatro fotogramas seguidos de una escena.',
  'social-set': 'Una imagen adaptada a 1:1, 4:5 y 9:16.',
  ugc: 'Vídeo vertical estilo creador: reseña, unboxing, prueba o tutorial.',
  'shot-sequence': 'Imagen clave, un primer clip y su continuación.',
  story: 'Una historia corta o un episodio con un personaje que se repite, unido en un vídeo.',
  'archviz-render': 'Renders de arquitectura: una vista principal o varias del mismo edificio.',
  'archviz-walkthrough': 'Un render convertido en recorrido de cámara.',
  'archviz-tour': 'Tour completo de una propiedad: un clip por vista, unidos con música opcional.',
  'archviz-sketch': 'De boceto, maqueta o plano a render fotorrealista que respeta el diseño.',
  poster: 'Póster por capas: fondo, titular y acentos editables.',
};
const MEDIA: Record<string, string> = { image: 'imagen', video: 'vídeo', audio: 'audio', text: 'texto' };
const es = (table: Record<string, string>, id: string, what: string) => {
  if (!table[id]) throw new Error(`README: add a Spanish line for ${what} "${id}" in tests/readme-shortcuts.test.ts`);
  return table[id];
};

const blocks: Record<string, string> = {
  shortcuts: shortcutGroups().map((g) => `**${g.title}**\n\n| Teclas | Acción |\n| --- | --- |\n${g.items.map((i) => `| ${cell(i.keys)} | ${cell(i.action)} |`).join('\n')}`).join('\n\n'),
  tools: `| Herramienta | De → a | Qué hace |\n| --- | --- | --- |\n${Object.entries(OPS).map(([id, o]) => `| ${o.label} | ${MEDIA[o.input] ?? o.input} → ${MEDIA[o.output] ?? o.output}${o.engine === 'local' ? ' · gratis, local' : ''} | ${es(TOOL_ES, id, 'tool')} |`).join('\n')}`,
  flows: `| Flujo | Qué produce |\n| --- | --- |\n${WORKFLOWS.map((w) => `| ${w.name} | ${es(FLOW_ES, w.id, 'flow')} |`).join('\n')}`,
};

function render(text: string): string {
  let out = text;
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
    if (!re.test(out)) throw new Error(`README.md lacks the <!-- ${name}:start --> … <!-- ${name}:end --> block`);
    out = out.replace(re, (_m, start: string, end: string) => `${start}\n${body}\n${end}`);
  }
  return out;
}

describe('README sections generated from the code', () => {
  it('shortcuts, tools and flows match the code', () => {
    const text = readFileSync(README, 'utf8');
    const expected = render(text);
    if (process.env.UPDATE_README === '1') writeFileSync(README, expected);
    else expect(text, 'README.md is out of date: UPDATE_README=1 npx vitest run tests/readme-shortcuts.test.ts').toBe(expected);
  });
});

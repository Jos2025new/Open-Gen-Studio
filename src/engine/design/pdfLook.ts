import type { jsPDF } from 'jspdf';

/*
 * The looks svg2pdf does not write, added as standard PDF transparency (PDF 1.4; ISO 32000-1 §11.6):
 *  - opacity and blend of a layer, a group or any element: it is drawn into a form XObject that is an isolated
 *    transparency group (/Group /S /Transparency) and painted once with an ExtGState (/ca /CA /BM);
 *  - <mask>: its content is a second group, set as the soft mask of that state (/SMask, luminosity or alpha);
 *  - a gradient whose stops have alpha: the opaque gradient under a luminosity mask of its alpha.
 * Paths, text, pictures, clips, opaque gradients and markers are still drawn by svg2pdf, a run of siblings at a time.
 * jsPDF writes forms without /Group and states with opacity only, so each group is a small form of ours that draws
 * the jsPDF form, and the states are ours too; both are written through jsPDF's own build events.
 */

interface Box { x: number; y: number; width: number; height: number }
type Svg2pdf = (el: Element, pdf: jsPDF, box: Box) => Promise<unknown>;
interface Look { opacity: number; blend: string | null; mask: string | null }
interface Internal {
  write(s: string): void;
  newObject(): number;
  putStream(o: { data: string; objectId: number; additionalKeyValues: { key: string; value: string }[] }): void;
  events: { subscribe(topic: string, fn: (payload: { id: string }) => void): void };
  pageSize: { getWidth(): number; getHeight(): number };
  scaleFactor: number;
}

const SVG = 'http://www.w3.org/2000/svg';
const BLEND: Record<string, string> = {
  multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn',
  'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};
/** Elements whose content is not drawn where it stands. */
const APART = new Set(['defs', 'mask', 'clipPath', 'marker', 'pattern', 'symbol']);
const LOOK_STYLE = /(?:^|;)\s*(?:opacity|mix-blend-mode|mask)\s*:[^;]*/g;

const all = (root: Element): Element[] => [...root.getElementsByTagName('*')];
const apart = (el: Element): boolean => { for (let p: Element | null = el; p; p = p.parentElement) if (APART.has(p.localName)) return true; return false; };
const css = (el: Element, name: string): string | null => {
  let result: string | null = null, important = false;
  for (const declaration of (el.getAttribute('style') ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== name) continue;
    const value = declaration.slice(colon + 1).trim(), priority = /\s*!important\s*$/i.test(value);
    if (!important || priority) { result = value.replace(/\s*!important\s*$/i, '').trim(); important = priority; }
  }
  return result;
};
const ref = (value: string | null): string | null => /^url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value ?? '')?.[1] ?? null;
const num = (v: number): string => String(Math.round(v * 10000) / 10000);

function lookOf(el: Element): Look | null {
  const raw = css(el, 'opacity') ?? el.getAttribute('opacity') ?? '1';
  const o = parseFloat(raw) / (raw.trim().endsWith('%') ? 100 : 1);
  const opacity = Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;
  const blend = BLEND[css(el, 'mix-blend-mode') ?? ''] ?? null, mask = ref(el.getAttribute('mask') ?? css(el, 'mask'));
  return opacity < 1 || blend || mask ? { opacity, blend, mask } : null;
}

function stripLook(el: Element): void {
  for (const a of ['opacity', 'mask', 'filter']) el.removeAttribute(a);
  const style = el.getAttribute('style');
  if (style) el.setAttribute('style', style.replace(LOOK_STYLE, '').replace(/^;/, ''));
}

/**
 * PDF shadings have no alpha. A shape painted with a gradient whose stops have alpha becomes: the same gradient made
 * opaque, under a luminosity mask that is the same shape painted with the alpha as grey. Fill and stroke are split,
 * since each has its own mask.
 */
function alphaGradients(root: Element): void {
  const withAlpha = new Set<string>();
  const alpha = (stop: Element) => { const a = parseFloat(stop.getAttribute('stop-opacity') ?? '1'); return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1; };
  for (const g of all(root)) {
    if ((g.localName !== 'linearGradient' && g.localName !== 'radialGradient') || !g.id) continue;
    const stops = [...g.children].filter((s) => s.localName === 'stop');
    if (!stops.some((s) => alpha(s) < 1)) continue;
    const grey = g.cloneNode(true) as Element;
    grey.id = `${g.id}-alpha`;
    for (const s of grey.children) if (s.localName === 'stop') { const v = Math.round(alpha(s) * 255); s.setAttribute('stop-color', `rgb(${v},${v},${v})`); s.removeAttribute('stop-opacity'); }
    stops.forEach((s) => s.removeAttribute('stop-opacity'));
    g.after(grey);
    withAlpha.add(g.id);
  }
  if (!withAlpha.size) return;
  let seq = 0;
  for (const el of all(root)) {
    const fill = ref(css(el, 'fill') ?? el.getAttribute('fill')), stroke = ref(css(el, 'stroke') ?? el.getAttribute('stroke'));
    const f = fill && withAlpha.has(fill) ? fill : null, s = stroke && withAlpha.has(stroke) ? stroke : null;
    if ((!f && !s) || apart(el)) continue;
    const g = document.createElementNS(SVG, 'g'), defs = g.appendChild(document.createElementNS(SVG, 'defs'));
    const transform = el.getAttribute('transform');
    if (transform) g.setAttribute('transform', transform);
    const piece = (paint: 'fill' | 'stroke', grad: string | null) => {
      const p = el.cloneNode(true) as Element, other = paint === 'fill' ? 'stroke' : 'fill';
      p.removeAttribute('transform');
      p.removeAttribute('mask');
      p.setAttribute(other, 'none');
      const value = css(el, paint);
      if (value) p.setAttribute(paint, value);
      if (paint === 'fill') for (const m of ['marker-start', 'marker-mid', 'marker-end']) p.removeAttribute(m);
      if (!grad) return p;
      const mask = defs.appendChild(document.createElementNS(SVG, 'mask')), shape = p.cloneNode(true) as Element;
      mask.id = `${grad}-mask-${seq++}`;
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      shape.setAttribute(paint, `url(#${grad}-alpha)`);
      for (const a of ['id', 'opacity', 'style', `${paint}-opacity`, 'marker-start', 'marker-mid', 'marker-end']) shape.removeAttribute(a);
      mask.appendChild(shape);
      p.setAttribute('mask', `url(#${mask.id})`);
      return p;
    };
    const hasFill = (css(el, 'fill') ?? el.getAttribute('fill') ?? 'black') !== 'none', hasStroke = (css(el, 'stroke') ?? el.getAttribute('stroke') ?? 'none') !== 'none';
    const parts = [hasFill ? piece('fill', f) : null, hasStroke ? piece('stroke', s) : null].filter((p): p is Element => !!p);
    if (el.getAttribute('paint-order') === 'stroke') parts.reverse();
    // The element's own look stays on the group; its pieces carry only their paint.
    const style = el.getAttribute('style'), opacity = el.getAttribute('opacity');
    if (style) g.setAttribute('style', style);
    if (opacity) g.setAttribute('opacity', opacity);
    const originalMask = el.getAttribute('mask');
    if (originalMask) g.setAttribute('mask', originalMask);
    parts.forEach((p, i) => { p.removeAttribute('opacity'); p.removeAttribute('style'); if (i) p.removeAttribute('id'); g.appendChild(p); });
    el.replaceWith(g);
  }
}

/** Draw an SVG (attached to the document) on the current page of `pdf`, inside `box`. */
export async function svgIntoPdf(pdf: jsPDF, GState: new (p: { opacity: number }) => unknown, svg2pdf: Svg2pdf, root: Element, box: Box): Promise<void> {
  alphaGradients(root);
  const looks = new Map<Element, Look>(), holds = new Set<Element>(), masks = new Map<string, Element>();
  for (const el of all(root)) {
    if (el.localName === 'mask') { if (el.id) masks.set(el.id, el); continue; }
    if (apart(el)) continue;
    const look = lookOf(el);
    if (!look) continue;
    looks.set(el, look);
    for (let p = el.parentElement; p && p !== root && !holds.has(p); p = p.parentElement) holds.add(p);
  }
  // Nothing svg2pdf cannot say: the whole file in one pass, as before.
  if (!looks.size) { await svg2pdf(root, pdf, box); return; }
  masks.forEach((m) => m.remove());

  const io = pdf.internal as unknown as Internal;
  // The page in points: a jsPDF form takes its box (and the height its content is flipped by) in points.
  const W = io.pageSize.getWidth() * io.scaleFactor, H = io.pageSize.getHeight() * io.scaleFactor;
  const forms: string[] = [], states: { body: string; mask?: number }[] = [], stateOf = new Map<string, number>();
  let lastForm = '', seq = 0;
  io.events.subscribe('addFormObject', (form) => { lastForm = form.id; });
  // The working copy svg2pdf reads: the root, the definitions in reach, and the piece being drawn.
  const work = root.cloneNode(false) as Element, shared = work.appendChild(document.createElementNS(SVG, 'defs'));
  for (const defs of all(root).filter((el) => el.localName === 'defs')) for (const child of [...defs.children]) shared.appendChild(child.cloneNode(true));
  root.after(work);

  /** One svg2pdf pass over `items`, placed under copies of their ancestors (transforms, clips, inherited paint). */
  const draw = async (chain: Element[], items: Element[]): Promise<void> => {
    if (!items.length) return;
    let at = work, top: Element | null = null;
    for (const c of chain) {
      const copy = c.cloneNode(false) as Element;
      stripLook(copy);
      at = at.appendChild(copy);
      top ??= copy;
    }
    items.forEach((it) => at.appendChild(it));
    await svg2pdf(work, pdf, box);
    if (top) top.remove(); else items.forEach((it) => it.remove());
  };
  /** What `body` draws, as an isolated transparency group; returns its number. */
  const group = async (body: () => Promise<void>): Promise<number> => {
    const key = `ogs-look-${seq++}`;
    pdf.beginFormObject(0, 0, W, H, pdf.unitMatrix);
    await body();
    pdf.endFormObject(key);
    return forms.push(lastForm) - 1;
  };
  const paint = async (el: Element, chain: Element[]): Promise<void> => {
    let run: Element[] = [];
    for (const child of [...el.children]) {
      const tag = child.localName;
      if (tag === 'style') { work.insertBefore(child, shared); continue; }
      if (tag === 'defs') continue;
      if (child.getAttribute('display') === 'none' || css(child, 'display') === 'none') continue;
      const look = looks.get(child);
      if (!look && !holds.has(child)) { run.push(child); continue; }
      await draw(chain, run);
      run = [];
      if (look) await drawLook(child, look, chain); else await paint(child, [...chain, child]);
    }
    await draw(chain, run);
  };
  const drawLook = async (el: Element, look: Look, chain: Element[]): Promise<void> => {
    const container = el.localName === 'g' || el.localName === 'svg' || el.localName === 'a';
    const mask = look.mask ? masks.get(look.mask) : undefined;
    stripLook(el);
    const g = await group(() => (container ? paint(el, [...chain, el]) : draw(chain, [el])));
    let m: number | undefined;
    if (mask) {
      // Mask content is in the user space of the masked element: its transform applies, its clip and look do not.
      const frame = document.createElementNS(SVG, 'g'), transform = el.getAttribute('transform');
      if (transform) frame.setAttribute('transform', transform);
      m = await group(() => draw([...chain, frame], [...mask.children].map((c) => c.cloneNode(true) as Element)));
    }
    const alpha = mask && (mask.getAttribute('mask-type') ?? css(mask, 'mask-type')) === 'alpha';
    const body = `${look.opacity < 1 ? `/ca ${num(look.opacity)} /CA ${num(look.opacity)} ` : ''}${look.blend ? `/BM /${look.blend} ` : ''}${m === undefined ? '' : `/SMask <</Type /Mask /S /${alpha ? 'Alpha' : 'Luminosity'} /G @ 0 R>> `}`;
    const key = `${body}${m ?? ''}`;
    if (!stateOf.has(key)) stateOf.set(key, states.push({ body, mask: m }) - 1);
    pdf.saveGraphicsState();
    io.write(`/OGs${stateOf.get(key)} gs /OGx${g} Do`);
    pdf.restoreGraphicsState();
  };

  // jsPDF lists its states only when it has one of its own; ours ride in the same dictionary.
  pdf.addGState('ogs-look', new GState({ opacity: 1 }) as never);
  await paint(root, []);
  work.remove();

  let formIds: number[] = [], stateIds: number[] = [];
  io.events.subscribe('putResources', () => {
    const bbox = `[0 0 ${num(W)} ${num(H)}]`;
    formIds = forms.map((name) => {
      const id = io.newObject();
      io.putStream({ data: `/${name} Do`, objectId: id, additionalKeyValues: [
        { key: 'Type', value: '/XObject' }, { key: 'Subtype', value: '/Form' }, { key: 'BBox', value: bbox },
        { key: 'Group', value: '<</S /Transparency /I true /CS /DeviceRGB>>' },
      ] });
      io.write('endobj');
      return id;
    });
    stateIds = states.map((s) => {
      const id = io.newObject();
      io.write(`<</Type /ExtGState ${s.body.replace('@', String(formIds[s.mask ?? 0]))}>>`);
      io.write('endobj');
      return id;
    });
  });
  io.events.subscribe('putGStateDict', () => stateIds.forEach((id, i) => io.write(`/OGs${i} ${id} 0 R`)));
  io.events.subscribe('putXobjectDict', () => formIds.forEach((id, i) => io.write(`/OGx${i} ${id} 0 R`)));
  // Blending happens in RGB whatever the viewer's working space, and the file says it needs PDF 1.4.
  io.events.subscribe('putPage', () => io.write('/Group <</S /Transparency /CS /DeviceRGB>>'));
  io.events.subscribe('putCatalog', () => io.write('/Version /1.4'));
}

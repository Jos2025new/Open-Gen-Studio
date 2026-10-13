/*
 * First step of an SVG import: parse (DOMParser, image/svg+xml, nothing is ever put in the page) and remove whatever
 * could run code or fetch from the network. Done before anything else reads the file. Kept: images embedded as
 * data:image/…, and references inside the document (#id).
 */

export const MAX_SVG_BYTES = 25 * 1024 * 1024;
export const MAX_SVG_ELEMENTS = 200_000;

/** Elements that run code, embed foreign documents or animate (an animation can set an href after the check). */
const DROP_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set', 'handler', 'listener', 'discard']);
const LOCAL_URL = /^\s*#/;
const DATA_IMAGE = /^\s*data:image\/[a-z0-9.+-]+\s*[;,]/i;

export type SanitizeStats = Record<string, number>;
export interface Sanitized { root: Element; document: Document; stats: SanitizeStats }

/** A reference that is safe to keep: inside the document, or an embedded image. */
const safeRef = (v: string) => LOCAL_URL.test(v) || DATA_IMAGE.test(v);
const withoutControls = (v: string) => v.replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();

/** CSS with every url() that leaves the document, @import and @font-face taken out. */
export function cleanCss(css: string, count: (k: string) => void = () => {}): string {
  let out = css.replace(/@import[^;{]*;?/gi, () => (count('css @import'), ''));
  out = out.replace(/@font-face\s*\{[^}]*\}/gi, () => (count('css @font-face'), ''));
  out = out.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gis, (m, _q, target: string) => (safeRef(target) ? m : (count('external url()'), 'none')));
  return out.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, () => (count('css script'), 'x('));
}

export function sanitizeSvg(text: string): Sanitized | { error: string } {
  if (text.length > MAX_SVG_BYTES) return { error: 'The SVG is larger than 25 MB.' };
  // Entities declared in the file can multiply into huge text (billion laughs): no DTD subset at all.
  if (/<!ENTITY/i.test(text)) return { error: 'The SVG declares entities, which are not imported.' };
  let document: Document;
  try { document = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch { return { error: 'The file is not valid SVG.' }; }
  const root = document.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg' || document.getElementsByTagName('parsererror').length) return { error: 'The file is not valid SVG.' };
  const stats: SanitizeStats = {};
  const count = (k: string) => { stats[k] = (stats[k] ?? 0) + 1; };
  const all = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (all.length > MAX_SVG_ELEMENTS) return { error: 'The SVG has too many elements.' };
  for (const el of all) {
    if (el !== root && !el.parentNode) continue; // already removed with its parent
    const name = el.localName.toLowerCase();
    if (DROP_ELEMENTS.has(name)) { count(name); el.remove(); continue; }
    for (const attr of Array.from(el.attributes)) {
      const aname = attr.name.toLowerCase(), local = attr.localName.toLowerCase(), v = attr.value;
      if (local.startsWith('on')) { count('on* attribute'); el.removeAttributeNode(attr); continue; }
      if (local === 'href') {
        if (!safeRef(v)) { count('external href'); el.removeAttributeNode(attr); }
        continue;
      }
      if (withoutControls(v).includes('javascript:') || withoutControls(v).startsWith('data:text/html')) { count('javascript: value'); el.removeAttributeNode(attr); continue; }
      if (aname === 'style') { const c = cleanCss(v, count); if (c !== v) attr.value = c; continue; }
      if (/url\(/i.test(v)) { const c = cleanCss(v, count); if (c !== v) attr.value = c; }
    }
    if (name === 'style' && el.textContent) { const c = cleanCss(el.textContent, count); if (c !== el.textContent) el.textContent = c; }
    // An image with nothing left to show.
    if (name === 'image' && !el.getAttribute('href') && !el.getAttribute('xlink:href')) { count('external href'); el.remove(); }
  }
  return { root, document, stats };
}

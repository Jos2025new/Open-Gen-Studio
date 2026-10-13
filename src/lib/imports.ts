/*
 * Files the Designer imports that browsers cannot show by themselves (SVG: the node area gets a PNG; the Designer imports layers, svgImport/). EPS goes to the local store (server/eps.js), which
 * uses the system Ghostscript; HEIC is decoded in the browser by heic2any, loaded only when a HEIC is imported (its
 * bundle is about 1.4 MB; it carries libheif, LGPL). Each returns a PNG File, or a message for the user.
 */

export const EPS_NEEDS_GHOSTSCRIPT = 'To import EPS, install Ghostscript on this computer (gs). OGS converts the file locally; nothing is sent elsewhere.';
export const EPS_PREVIEW_ONLY = 'This EPS only carries a low-resolution preview (TIFF), which the browser cannot show. ' + EPS_NEEDS_GHOSTSCRIPT;

export const isSvg = (f: File) => /\.svgz?$/i.test(f.name) || f.type === 'image/svg+xml';
const isEps = (f: File) => /\.eps$/i.test(f.name) || f.type === 'application/postscript' || f.type === 'application/eps';
const isHeic = (f: File) => /\.hei[cf]$/i.test(f.name) || f.type === 'image/heic' || f.type === 'image/heif';
const pngName = (name: string) => name.replace(/\.[^.]+$/, '') + '.png';

/** EPS through the local store. Null or a message when the store cannot convert it. */
export async function convertEps(file: File, fetcher: typeof fetch = fetch): Promise<File | string> {
  const res = await fetcher('/x/store/eps', { method: 'POST', headers: { 'X-OGS': '1', 'Content-Type': 'application/postscript' }, body: file }).catch(() => null);
  if (!res) return EPS_NEEDS_GHOSTSCRIPT;
  if (res.ok) return new File([await res.blob()], pngName(file.name), { type: 'image/png' });
  if (res.status === 501) {
    const info = await res.json().catch(() => ({ preview: null })) as { preview: string | null };
    return info.preview ? EPS_PREVIEW_ONLY : EPS_NEEDS_GHOSTSCRIPT;
  }
  return `Could not convert ${file.name}`;
}

/** HEIC decoded in the browser; the decoder is loaded on first use. */
export async function convertHeic(file: File): Promise<File | string> {
  try {
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/png' });
    const png = Array.isArray(out) ? out[0] : out;
    return new File([png], pngName(file.name), { type: 'image/png' });
  } catch {
    return `Could not decode ${file.name}`;
  }
}

/** An SVG as one PNG (sanitized first; the node area takes images). The Designer imports SVG as layers instead. */
export async function convertSvg(file: File): Promise<File | string> {
  const { flattenSvg } = await import('../engine/design/svgImport/flatten');
  const out = await flattenSvg(await file.text());
  return typeof out === 'string' ? out : new File([out], pngName(file.name), { type: 'image/png' });
}

/** The file as the importers take it: unchanged for images they show, converted for EPS, HEIC and SVG. */
export async function prepareImportFile(file: File, fetcher?: typeof fetch): Promise<File | string> {
  if (isEps(file)) return convertEps(file, fetcher);
  if (isHeic(file)) return convertHeic(file);
  if (isSvg(file)) return convertSvg(file);
  return file;
}

// EPS import for the local store (POST /x/store/eps). The app sends the EPS bytes; this module converts them to PNG with
// the system Ghostscript (`gs`, run by the user, not shipped with OGS), or reports what the file carries when there is none.
// Ghostscript runs with -dSAFER, a time limit, a size limit on the input, and only inside a temporary folder that is
// removed at the end. The file name the browser sends is never used: the input is always `in.eps` in that folder.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EPS_MAX_BYTES = 25 * 1024 * 1024;
export const EPS_TIMEOUT_MS = 30_000;
const DOS_MAGIC = Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]);

/** The preview a DOS EPS carries (TIFF at header bytes 20–27, or WMF at 12–19), or null. Browsers cannot show either. */
export function epsPreview(buf) {
  if (buf.length < 30 || !buf.subarray(0, 4).equals(DOS_MAGIC)) return null;
  const off = buf.readUInt32LE(20), len = buf.readUInt32LE(24);
  if (!len || off + len > buf.length) return null;
  return { kind: 'tiff', bytes: buf.subarray(off, off + len) };
}

/** Ghostscript present? `gs --version` answers within the time limit. */
export function hasGhostscript(exec = execFile) {
  return new Promise((resolve) => exec('gs', ['--version'], { timeout: 5000 }, (err) => resolve(!err)));
}

/** Runs gs on `input`, writing `output`. Rejects on failure or timeout. */
export function runGhostscript(input, output, exec = execFile) {
  const args = ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pngalpha', '-r150', '-dEPSCrop', `-sOutputFile=${output}`, input];
  return new Promise((resolve, reject) => exec('gs', args, { timeout: EPS_TIMEOUT_MS }, (err) => (err ? reject(err) : resolve())));
}

/** Converts EPS bytes to PNG bytes in a temporary folder that is always removed. */
export async function convertEps(buf, { exec = execFile, tmp = tmpdir() } = {}) {
  const dir = await mkdtemp(join(tmp, 'ogs-eps-'));
  try {
    const input = join(dir, 'in.eps'), output = join(dir, 'out.png');
    await writeFile(input, buf);
    await runGhostscript(input, output, exec);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The answer to POST /x/store/eps: PNG when Ghostscript converts it; otherwise 501 with what the file offers (a
 * preview the browser cannot show, or nothing), so the app can say to install Ghostscript.
 */
export async function handleEps(buf, deps = {}) {
  if (buf.length > EPS_MAX_BYTES) return { status: 413, type: 'text/plain', body: 'EPS file too large' };
  if (!buf.length) return { status: 400, type: 'text/plain', body: 'empty file' };
  if (!(await (deps.hasGs ?? (() => hasGhostscript(deps.exec)))())) {
    const preview = epsPreview(buf);
    return { status: 501, type: 'application/json', body: JSON.stringify({ preview: preview ? preview.kind : null }) };
  }
  try {
    return { status: 200, type: 'image/png', body: await (deps.convert ?? ((b) => convertEps(b, deps)))(buf) };
  } catch {
    return { status: 422, type: 'text/plain', body: 'Ghostscript could not convert this EPS file' };
  }
}

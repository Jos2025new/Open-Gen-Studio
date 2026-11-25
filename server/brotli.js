// WOFF2 fonts are Brotli inside (POST /x/store/unbrotli): the page has no Brotli decoder, Node does.
import { brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';

export const BROTLI_MAX_BYTES = 12 * 1024 * 1024;
/** What a font may grow to: a small file that inflates without end is refused. */
const OUT_MAX_BYTES = 60 * 1024 * 1024;
const inflate = promisify(brotliDecompress);

export async function handleUnbrotli(buf, outMax = OUT_MAX_BYTES) {
  if (buf.length > BROTLI_MAX_BYTES) return { status: 413, type: 'text/plain', body: 'font too large' };
  try { return { status: 200, type: 'application/octet-stream', body: await inflate(buf, { maxOutputLength: outMax }) }; }
  catch { return { status: 400, type: 'text/plain', body: 'not Brotli' }; }
}

import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const SANDBOX_PORT = 5183;
export function sandboxDirectory(root, dataDir) {
  const expected = resolve(root, '.sandbox/data');
  if (!dataDir || resolve(root, dataDir) !== expected) {
    throw new Error('Sandbox DATA_DIR must be .sandbox/data; real data is forbidden');
  }
  return expected;
}

export async function prepareSandbox(root, dataDir) {
  const destination = sandboxDirectory(root, dataDir);
  const canonicalRoot = await realpath(root);
  for (const path of [dirname(destination), destination]) {
    const info = await lstat(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Unsafe sandbox directory');
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  if (await realpath(destination) !== resolve(canonicalRoot, '.sandbox/data')) throw new Error('Sandbox escaped project');
  const source = resolve(root, 'data');
  await cp(source, destination, {
    recursive: true,
    filter: async (from, to) => {
      if ((await lstat(from)).isSymbolicLink()) throw new Error('Source data contains a symbolic link');
      const info = await lstat(to).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (info?.isSymbolicLink()) throw new Error('Sandbox contains a symbolic link');
      if (to !== destination && !to.startsWith(destination + sep)) throw new Error('Copy escaped sandbox');
      return true;
    },
  });
  return destination;
}

async function main() {
  const root = process.cwd();
  const destination = await prepareSandbox(root, process.env.DATA_DIR);
  console.log(`Sandbox DATA_DIR=${destination}`);
  const server = await createServer({
    server: { host: '127.0.0.1', port: SANDBOX_PORT, strictPort: true, open: false },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await server.close(); process.exit(0); });
  }
  await server.listen();
  server.printUrls();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

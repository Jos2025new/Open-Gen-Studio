import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build, preview } from 'vite';

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
  const sourceInfo = await lstat(source).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  // A worktree may have only sandbox data; never fall back to another checkout.
  if (!sourceInfo) return destination;
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

/** Build/preview output must never erase or expose the protected data directories. */
export async function sandboxBuildDirectory(root, outDir) {
  const target = resolve(root, outDir);
  const project = resolve(root);
  if (target === project || project.startsWith(target + sep) || /(?:^|\/)(?:data(?:\.bak-[^/]+)?|\.sandbox)(?:\/|$)/.test(target)) {
    throw new Error('Sandbox build directory cannot contain protected data');
  }
  for (let path = target; ; path = dirname(path)) {
    const info = await lstat(path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isSymbolicLink()) throw new Error('Sandbox build directory contains a symbolic link');
    if (dirname(path) === path) break;
  }
  return target;
}

export function sandboxOptions(production = false, outDir = 'dist') {
  return {
    define: { 'import.meta.env.VITE_OGS_SANDBOX': JSON.stringify('1') },
    ...(production ? { build: { outDir }, preview: { host: '127.0.0.1', port: SANDBOX_PORT, strictPort: true, open: false } } : {}),
    server: { host: '127.0.0.1', port: SANDBOX_PORT, strictPort: true, open: false },
  };
}

async function main() {
  const root = process.cwd();
  const destination = await prepareSandbox(root, process.env.DATA_DIR);
  console.log(`Sandbox DATA_DIR=${destination}`);
  const production = process.argv.includes('--production');
  const outDir = production ? await sandboxBuildDirectory(root, process.env.SANDBOX_BUILD_DIR || 'dist') : 'dist';
  const options = sandboxOptions(production, outDir);
  if (production && !process.argv.includes('--no-build')) await build(options);
  const server = production ? await preview(options) : await createServer(options);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { if (production) await new Promise((done) => server.httpServer.close(done));
      else await server.close();
      process.exit(0); });
  }
  if (!production) await server.listen();
  server.printUrls();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

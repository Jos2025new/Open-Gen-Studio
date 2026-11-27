import type { Plugin } from 'vite';

export function brandExport(dataDir?: string): Plugin;
export function syncBrandExportOnDisk(
  rootDir: string,
  payload: { kitSlug: string; versionId: string; tokensJson?: string; assets: Array<{ filename: string; dataUrl: string }> },
): Promise<{ dir: string; vigentePath: string; versionDir: string; files: string[] }>;

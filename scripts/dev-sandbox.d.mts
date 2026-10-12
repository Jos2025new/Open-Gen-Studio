export const SANDBOX_PORT: 5183;
export function sandboxDirectory(root: string, dataDir: string | undefined): string;
export function prepareSandbox(root: string, dataDir: string | undefined): Promise<string>;
export function sandboxOptions(production?: boolean, outDir?: string): {
  define: Record<string, string>;
  server: { host: string; port: 5183; strictPort: boolean; open: boolean };
  preview?: { host: string; port: 5183; strictPort: boolean; open: boolean };
  build?: { outDir: string };
};

export function sandboxBuildDirectory(root: string, outDir: string): Promise<string>;

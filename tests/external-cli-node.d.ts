declare module 'node:http' {
  export interface IncomingMessage {
    statusCode?: number;
    resume(): void;
  }
  export interface ServerResponse {
    statusCode: number;
    end(): void;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): {
    listen(port: number, host: string, ready: () => void): void;
    address(): { port: number } | string | null;
    close(done: () => void): void;
    closeAllConnections(): void;
  };
  export function request(url: string, options: { headers: Record<string, string> }, respond: (res: IncomingMessage) => void): {
    on(event: 'error', listener: (error: Error) => void): void;
    end(): void;
  };
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ mode: number }>;
  export function writeFile(path: string, value: string): Promise<void>;
}

declare module 'node:process' {
  export const execPath: string;
  export const pid: number;
}

declare module 'node:child_process' {
  export function execFile(file: string, args: string[], options: { timeout: number }, callback: (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void): {
    stdin: { end(input?: string): void } | null;
  };
}

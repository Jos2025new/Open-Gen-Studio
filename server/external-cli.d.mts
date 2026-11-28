import type { IncomingMessage, ServerResponse } from 'node:http';

export function createExternalCliBridge(options: { port: number; timeoutMs?: number }): {
  middleware(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void>;
  publish(root: string): void;
  close(): void;
};

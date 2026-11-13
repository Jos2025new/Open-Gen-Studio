export const KEYED_HOSTS: Record<string, string>;
export function authHeaders(provider: string, key: string): Record<string, string>;
export function handleProxy(req: unknown, res: unknown, keys: { get(provider: string): Promise<string | null> }): Promise<void>;

export const BROTLI_MAX_BYTES: number;
export function handleUnbrotli(buf: Uint8Array, outMax?: number): Promise<{ status: number; type: string; body: string | Uint8Array }>;

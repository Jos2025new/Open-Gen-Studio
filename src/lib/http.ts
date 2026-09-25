export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** The request never got an answer (offline, DNS, timeout). Says nothing about the remote job. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The provider confirmed that a remote job ended without a result (failed or canceled there). */
export class JobFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobFailedError';
  }
}

/** Worth asking again: no answer, rate limited, or a server-side hiccup. */
export function isTransient(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  return err instanceof HttpError && (err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500);
}

export class AbortedError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'AbortedError';
  }
}

export function isAbort(err: unknown): boolean {
  return (
    err instanceof AbortedError ||
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** Pull a human message out of the many error shapes providers return. */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 400) || fallback;
  if (typeof body !== 'object') return fallback;
  const b = body as Record<string, unknown>;
  const candidates: unknown[] = [
    b.userFriendlyError,
    (b.error as Record<string, unknown> | undefined)?.message,
    b.error,
    b.message,
    b.msg,
    b.detail,
    (b.data as Record<string, unknown> | undefined)?.error,
    (b.data as Record<string, unknown> | undefined)?.userFriendlyError,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 400);
    if (Array.isArray(c) && c.length) {
      const first = c[0] as Record<string, unknown>;
      if (typeof first?.msg === 'string') return first.msg;
    }
  }
  return fallback;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit & { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs, signal, ...rest } = init;
  const controller = timeoutMs ? new AbortController() : undefined;
  let timedOut = false;
  const timer = controller ? setTimeout(() => ((timedOut = true), controller.abort()), timeoutMs) : undefined;
  const forward = () => controller?.abort();
  if (controller && signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forward, { once: true });
  }
  let res: Response;
  let body: unknown;
  try {
    res = await fetch(url, { ...rest, signal: controller?.signal ?? signal });
    body = await readBody(res);
  } catch (err) {
    const host = new URL(url, location.href).host;
    if (timedOut) throw new NetworkError(`${host} did not answer within ${Math.round(timeoutMs! / 1000)}s.`);
    if (isAbort(err)) throw new AbortedError();
    throw new NetworkError(`Network error reaching ${host}. Check your connection.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
  if (!res.ok) {
    const msg = extractErrorMessage(body, `${res.status} ${res.statusText || 'Request failed'}`);
    throw new HttpError(res.status, friendlyStatus(res.status, msg), body);
  }
  return body as T;
}

function friendlyStatus(status: number, msg: string): string {
  if (status === 401 || status === 403) return `Authentication failed (${status}): ${msg}`;
  if (status === 402) return `Insufficient credits at the provider: ${msg}`;
  if (status === 429) return `Rate limited by the provider: ${msg}`;
  return msg;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Fetch a URL directly, falling back to a same-origin relay path if CORS blocks it. */
export async function fetchJsonWithRelay<T>(direct: string, relayed: string): Promise<T> {
  try {
    return await requestJson<T>(direct);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return requestJson<T>(relayed);
  }
}

/** Iterate `data:` payloads of a server-sent-events response body. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new AbortedError();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data:')) yield line.slice(5).trimStart();
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) yield tail.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

const headers = { 'Content-Type': 'application/json', 'X-OGS-External-Tab': '1' };

type TabEvent =
  | { type: 'ready'; binding: string }
  | { type: 'request'; id: string; operation: 'find' | 'run'; input: unknown; deadline: number }
  | { type: 'cancel'; id: string };

export async function connectExternalCliTab(options: {
  signal: AbortSignal;
  onReady: () => void;
  execute(operation: 'find' | 'run', input: unknown, signal: AbortSignal, deadline: number): unknown;
}): Promise<void> {
  const transport = new AbortController();
  const signal = AbortSignal.any([transport.signal, options.signal]);
  const stream = await fetch('/x/ext/tab', { method: 'POST', headers, signal });
  if (!stream.ok || !stream.body) {
    const result = await stream.json().catch(() => null);
    throw new Error(result?.error?.message ?? 'Could not link the sandbox CLI.');
  }
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  let binding: string | undefined;
  let active: { id: string; cancel: AbortController } | undefined;
  let buffer = '';
  let execution: Promise<void> | undefined;

  function receive(event: TabEvent) {
    if (event.type === 'ready' && !binding) {
      binding = event.binding;
      options.onReady();
    } else if (event.type === 'cancel' && active?.id === event.id) {
      active.cancel.abort();
    } else if (event.type === 'request' && binding && !active) {
      const { id, operation, input, deadline } = event;
      const cancel = new AbortController();
      active = { id, cancel };
      const expires = AbortSignal.timeout(Math.max(0, deadline - Date.now()));
      const requestSignal = AbortSignal.any([signal, cancel.signal, expires]);
      execution = (async () => {
        let result;
        try { result = await options.execute(operation, input, requestSignal, deadline); }
        catch { result = { ok: false, error: { code: 'failed', message: 'The linked tab could not complete this request.' } }; }
        active = undefined;
        if (signal.aborted) return;
        const reply = await fetch('/x/ext/result', {
          method: 'POST', headers, signal,
          body: JSON.stringify({ binding, id, result }),
        });
        if (!reply.ok) transport.abort();
      })().catch(() => transport.abort());
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith('data: ')) receive(JSON.parse(frame.slice(6)));
      }
    }
  } finally {
    transport.abort();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await execution;
  }
}

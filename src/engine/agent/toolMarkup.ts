/**
 * Tool calls a model wrote as plain text because the provider did not convert its native format: DeepSeek's DSML
 * (`<｜DSML｜ invoke name="…">` with `<｜DSML｜ parameter name="…" string="true|false">`) and the
 * `<tool_call>{"name", "arguments"}</tool_call>` style. Read back into ordinary tool calls.
 */

const START = /<[｜|]\s*DSML\s*[｜|]|<[｜|]tool[▁_ ]calls?|<tool_call>|<function_calls>/i;

/** Where tool-call markup starts in a reply, or -1. */
export function toolMarkupAt(text: string): number {
  const m = START.exec(text);
  return m ? m.index : -1;
}

/** The calls in the markup, or null when it cannot be read whole (then nothing should run). */
export function parseToolMarkup(text: string): Array<{ name: string; arguments: string }> | null {
  const calls: Array<{ name: string; arguments: string }> = [];
  const bar = '[｜|]\\s*DSML\\s*[｜|]';
  const invoke = new RegExp(`<${bar}\\s*invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)<\\/${bar}\\s*invoke\\s*>`, 'g');
  const param = new RegExp(`<${bar}\\s*parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)<\\/${bar}\\s*parameter\\s*>`, 'g');
  for (const m of text.matchAll(invoke)) {
    const args: Record<string, unknown> = {};
    for (const p of m[2].matchAll(param)) {
      if (p[2] === 'false') {
        try {
          args[p[1]] = JSON.parse(p[3]);
        } catch {
          return null;
        }
      } else args[p[1]] = p[3];
    }
    calls.push({ name: m[1], arguments: JSON.stringify(args) });
  }
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    try {
      const v = JSON.parse(m[1]) as { name?: string; arguments?: unknown };
      if (!v.name) return null;
      calls.push({ name: v.name, arguments: typeof v.arguments === 'string' ? v.arguments : JSON.stringify(v.arguments ?? {}) });
    } catch {
      return null;
    }
  }
  return calls.length ? calls : null;
}

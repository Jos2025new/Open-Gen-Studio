/** The top bar's «Connected» dot: green only when a provider is connected AND the local disk server is taking saves. */
export function connectedState(providers: number, saveReason: 'conflict' | 'possible-loss' | 'disk' | null): { on: boolean; title: string } {
  if (saveReason === 'disk') return { on: false, title: 'The local server is not reachable: your work is not being saved to disk.' };
  return { on: providers > 0, title: providers > 0 ? `${providers} provider(s) connected` : 'No provider connected' };
}

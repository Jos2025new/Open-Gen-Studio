/** Words that name a route or tier, not a model family ("image to video", "pro", "developer"). */
const ROUTE_WORDS = new Set(['video', 'image', 'text', 'to', 'edit', 'reference', 'references', 'developer', 'dev', 'pro', 'fast', 'lite', 'max', 'turbo', 'mini', 'standard', 'std', 'preview', 'ultra', 'plus', 'model', 'atlas', 'nanogpt', 'fal', 'ai', 'spicy']);
function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9.]+/).map((t) => t.replace(/\.0$/, '').replace(/\.$/, '')).filter((t) => t.length >= 2 && !ROUTE_WORDS.has(t));
}
/** Whether the user's words name this model's family ("wan", "seedance", "nano banana", "h3"). */
export function userNamed(names: string[], said: string): boolean {
  const words = new Set(nameTokens(said));
  const flat = said.toLowerCase().replace(/[^a-z0-9]/g, '');
  return names.some((n) => nameTokens(n).some((t) => words.has(t) || (t.length >= 4 && flat.includes(t.replace(/[^a-z0-9]/g, '')))));
}

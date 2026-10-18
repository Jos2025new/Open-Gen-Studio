/** What one candidate of a step with variations sends: the shared prompt, then the variation on its own line. One source for the request and the plan card. */
export function variantPrompt(base: string, variation: string): string {
  return `${base}\n${variation}`;
}

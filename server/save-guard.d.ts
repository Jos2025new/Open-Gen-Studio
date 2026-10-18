export function sha256(text: string): string;
/** True when `nextText` looks like a loss of the session whose previous text is `prevText` (user content only). */
export function looksLost(prevText: string, nextText: string): boolean;

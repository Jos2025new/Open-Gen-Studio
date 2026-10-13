export function colorRgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function rgbHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
export function colorHsl(hex: string): number[] {
  const [r, g, b] = colorRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, l = (max + min) / 2;
  const h = delta === 0 ? 0 : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return [h, delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)) * 100, l * 100];
}
export function hslHex([h, s, l]: number[]): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex(rgb.map((v) => (v + m) * 255));
}
/** A typed #RRGGBB (the # optional, any case) as #rrggbb, or null when it is not a 6-digit hex color. */
export function parseHexInput(text: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? '#' + m[1].toLowerCase() : null;
}
/** One channel (0–255) replaced in a hex color; null when the value is not a whole number in range. */
export function setRgbChannel(hex: string, index: 0 | 1 | 2, text: string): string | null {
  const v = Number(text.trim());
  if (!/^\d{1,3}$/.test(text.trim()) || !Number.isInteger(v) || v < 0 || v > 255) return null;
  const rgb = colorRgb(hex);
  rgb[index] = v;
  return rgbHex(rgb);
}

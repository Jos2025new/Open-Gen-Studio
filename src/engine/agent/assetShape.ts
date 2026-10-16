/** "image 1024×768", "video 1280×720 5.0s", "audio 12.4s". */
export function assetShape(a: { kind: string; width: number; height: number; duration?: number }): string {
  const secs = a.duration ? ` ${a.duration.toFixed(1)}s` : '';
  return a.kind === 'audio' ? `audio${secs}` : `${a.kind} ${a.width}×${a.height}${secs}`;
}

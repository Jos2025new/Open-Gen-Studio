export {};

type PngRequest = { id: number; width: number; height: number; bitmap: ImageBitmap };
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<PngRequest>) => void) => void;
  postMessage: (message: unknown) => void;
};

scope.addEventListener('message', (event: MessageEvent<PngRequest>) => {
  const { id, width, height, bitmap } = event.data;
  void encode(id, width, height, bitmap);
});

async function encode(id: number, width: number, height: number, bitmap: ImageBitmap): Promise<void> {
  try {
    if (typeof OffscreenCanvas === 'undefined') {
      scope.postMessage({ id, unsupported: true, error: 'OffscreenCanvas is unavailable' });
      return;
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Offscreen 2D context is unavailable');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    scope.postMessage({ id, blob });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : 'PNG encoding failed' });
  } finally {
    try { bitmap.close(); } catch { /* Transfer already released the resource. */ }
  }
}

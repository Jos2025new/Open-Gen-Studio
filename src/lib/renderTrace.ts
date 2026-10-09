import { span, tracing } from './trace';

export type RenderOrigin = 'editor' | 'export' | 'fill' | 'agent-view' | 'thumbnail' | 'selection' | 'color-sample' | 'asset-fx' | 'offscreen';
export type RenderTrace = { renderId: number; origin: RenderOrigin };
let nextRenderId = 0;

/** Pass this context through the compositor; offscreen work must not count against an editor frame. */
export function beginRender(origin: RenderOrigin, data: Record<string, unknown> = {}) {
  const context: RenderTrace | undefined = tracing('render') || tracing('fx') ? { renderId: ++nextRenderId, origin } : undefined;
  const end = !tracing('render') ? null : origin === 'editor'
    ? span('render', 'frame', { ...data, ...context })
    : span('render', 'offscreen', { ...data, ...context });
  return { context, end };
}

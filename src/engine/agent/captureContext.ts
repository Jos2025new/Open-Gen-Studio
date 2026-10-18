import { ctltOf, presetById } from '../captureStyles';
import type { GenSettings, Subject } from '../types';

/** Context lines: the user's saved capture styles and the style selected in the composer. */
export function captureLines(library: Subject[], composer: { image: { settings: GenSettings }; video: { settings: GenSettings } }): string[] {
  const mine = library.filter((s) => s.kind === 'style' && s.capture);
  const out: string[] = [];
  if (mine.length) out.push(`saved capture styles (capture.style = the name): ${mine.map((s) => `${s.name} (${s.capture!.camera}; ${s.capture!.tone})`).join(' | ')}`);
  for (const k of ['image', 'video'] as const) {
    const c = composer[k].settings.capture;
    if (!c) continue;
    const base = ctltOf(c);
    out.push(`selected ${k} capture style: ${c.style && presetById(c.style) ? c.style : base ? (c.style ? `saved style "${c.style}"` : 'a custom style') : 'none'}${c.tone ? `, tone "${c.tone}"` : ''}${c.directives?.length ? `, directives ${c.directives.join('+')}` : ''}${c.imperfect?.length ? `, imperfections ${c.imperfect.join('+')}` : ''} (put it in the step's capture)`);
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import baseline from './fixtures/realism-clean-baseline.json';
import { withRealism, REALISM_MODES, SHOTS } from '../src/engine/realism';

/** Salida de withRealism antes de los estilos de captura (2026-10-17): los estilos limpios no cambian ni una palabra. */
describe('realism: estilos limpios sin cambios', () => {
  const prompts = ['A woman reading a book by a window', 'A dog running on a beach'];
  it('coincide con la salida anterior a los estilos de captura', () => {
    const out: Record<string, string> = {};
    for (const p of prompts) for (const mode of REALISM_MODES) {
      for (const kind of ['image', 'video'] as const) {
        const k = `${kind}|${mode}|-|${p}`;
        out[k] = withRealism(p, mode, '', undefined, { kind });
        if (kind === 'video') out[`${k}|anchored`] = withRealism(p, mode, '', undefined, { kind, anchored: true });
        out[`${k}|refs`] = withRealism(p, mode, '', undefined, { kind, refs: true });
      }
      for (const shot of Object.keys(SHOTS)) out[`image|${mode}|${shot}|${p}`] = withRealism(p, mode, '', shot, { kind: 'image' });
    }
    expect(out).toEqual(baseline);
  });
});

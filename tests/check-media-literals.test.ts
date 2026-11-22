import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../scripts/check-media-literals.mjs';

function withTempRepo(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-media-literals-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      writeFileSync(full, text);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-media-literals', () => {
  it('passes on the real repository', () => {
    expect(check('.')).toEqual([]);
  });

  it('flags literal media arrays, z.enum, sets, z.literal unions, and agent/llm/text variants outside types.ts', () => {
    withTempRepo({
      'src/engine/types.ts': "export const MEDIA_KINDS = ['image', 'video', 'audio', 'model3d'] as const; export const VISUAL = ['image', 'video'] as const;",
      'src/engine/graphTypes.ts': "export const BASE_NODE_KINDS = ['text', 'image', 'video', 'audio', 'model3d', 'tool', 'asset', 'ref'] as const;",
      'src/engine/badArray.ts': "export const x = ['image', 'video'];",
      'src/engine/badEnum.ts': "import { z } from 'zod'; export const s = z.enum(['llm', 'image', 'video', 'audio', 'model3d']);",
      'src/engine/badAgent.ts': "export const m = ['agent', 'image'] as const;",
      'src/engine/badUnion.ts': "import { z } from 'zod'; export const u = z.union([z.literal('image'), z.literal('video')]);",
      'src/engine/goodSpread.ts': "import { MEDIA_KINDS } from './types'; export const m = ['agent', ...MEDIA_KINDS]; export const f = ['all', ...MEDIA_KINDS, 'text'];",
      'src/engine/goodSingle.ts': "export const one = ['image']; export const nonMedia = ['agent', 'llm', 'text'];",
    }, (root) => {
      const errors = check(root);
      expect(errors).toHaveLength(4);
      expect(errors.some((e) => /^src\/engine\/badArray\.ts:1:.*MEDIA_KINDS/.test(e))).toBe(true);
      expect(errors.some((e) => /^src\/engine\/badEnum\.ts:1:.*MEDIA_KINDS/.test(e))).toBe(true);
      expect(errors.some((e) => /^src\/engine\/badAgent\.ts:1:.*MEDIA_KINDS/.test(e))).toBe(true);
      expect(errors.some((e) => /^src\/engine\/badUnion\.ts:1:.*MEDIA_KINDS/.test(e))).toBe(true);
      expect(errors.some((e) => e.startsWith('src/engine/types.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('src/engine/graphTypes.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('src/engine/goodSpread.ts:'))).toBe(false);
      expect(errors.some((e) => e.startsWith('src/engine/goodSingle.ts:'))).toBe(false);
    });
  });

  it('exempts only the named text-parsing/tag sets, not other media literals in the same files', () => {
    withTempRepo({
      'src/engine/variants.ts': "const ROUTE_WORDS = new Set(['text', 'image', 'video']);\nexport const bad = ['image', 'video'];\n",
      'src/engine/agent/userChoice.ts': "const TIER = new Set(['image', 'video', 'text']);\n",
      'src/engine/agent/modelIndex.ts': "const GENERIC = new Set(['video', 'image', 'audio', 'text']);\n",
      'src/engine/design/svgImport/sanitize.ts': "const DROP_ELEMENTS = new Set(['script', 'audio', 'video']);\n",
      'src/engine/graphTypes.ts': "export const BASE_NODE_KINDS = ['text', 'image', 'video', 'audio', 'model3d'] as const;\nexport const extraBad = ['image', 'audio'];\n",
    }, (root) => {
      const errors = check(root);
      expect(errors).toHaveLength(2);
      expect(errors).toContainEqual(expect.stringMatching(/^src\/engine\/variants\.ts:2:/));
      expect(errors).toContainEqual(expect.stringMatching(/^src\/engine\/graphTypes\.ts:2:/));
    });
  });
});

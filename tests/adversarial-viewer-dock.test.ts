import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCK_GROUP_LABEL, DOCK_GROUP_ORDER, OP_GROUPS } from '../src/components/assets/opGroups';
import { OPS } from '../src/engine/ops';

describe('adversarial viewer dock contract', () => {
  it('keeps each restored dock name connected to an icon and preserves every existing operation group', () => {
    expect(DOCK_GROUP_ORDER.map((id) => DOCK_GROUP_LABEL[id])).toEqual(['Editar', 'Variaciones', 'Convertir', 'Mejorar']);
    const source = readFileSync('src/components/assets/AssetActions.tsx', 'utf8');
    expect(source).toMatch(/const DOCK_GROUP_ICON: Record<OpGroupId, LucideIcon> = \{ edit: Pencil, explore: Shuffle, reuse: Clapperboard, finalize: Sparkles \}/);
    expect(source).toMatch(/icon=\{DOCK_GROUP_ICON\[g\.id\]\}/);
    const opIds = Object.values(OPS).filter((op) => !op.multiInput).map((op) => op.id);
    expect(Object.keys(OP_GROUPS).sort()).toEqual(opIds.sort());
  });
});

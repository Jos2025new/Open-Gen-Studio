import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../scripts/check-node-drag.mjs';

function fixture(file: string, code: string) {
  const root = mkdtempSync(join(tmpdir(), 'ogs-nd-'));
  mkdirSync(join(root, 'src', 'components', 'node'), { recursive: true });
  writeFileSync(join(root, 'src', 'components', 'node', file), code);
  return check(root) as string[];
}

describe('check-node-drag AST guard', () => {
  it('passes on the real src/ tree and is wired into npm test via check-all', () => {
    expect(check('.')).toEqual([]);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const checkAll = readFileSync('scripts/check-all.mjs', 'utf8');
    expect(pkg.scripts.test).toContain('node scripts/check-all.mjs');
    expect(checkAll).toContain('scripts/check-node-drag.mjs');
  });

  it('rejects editPresentation or helper calls inside dragging: true branch of onNodesChange', () => {
    const errors = fixture('NodeWorkspace.tsx', `
      const commit = (id: string) => editPresentation(id, (g) => g);
      const onNodesChange = (changes: any[]) => {
        for (const c of changes) {
          if (c.type === 'position' && c.dragging === true) {
            commit('s1');
          }
        }
      };
    `);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/NodeWorkspace\.tsx:\d+ — /);
  });

  it('rejects imported aliases and calls in else / early-return dragging branches', () => {
    const aliased = fixture('NodeWorkspace.tsx', `
      import { editPresentation as commit } from './edit';
      const onNodesChange = (changes: any[]) => {
        for (const c of changes) {
          if (c.type === 'position' && c.dragging) {
            commit('s1', (g) => g);
          }
        }
      };
    `);
    expect(aliased).toHaveLength(1);

    const elseBranch = fixture('NodeWorkspace.tsx', `
      import { editPresentation as commit } from './edit';
      const onNodesChange = (changes: any[]) => {
        for (const c of changes) {
          if (c.type !== 'position') continue;
          if (!c.dragging) {
            // drop
          } else {
            commit('s1', (g) => g);
          }
        }
      };
    `);
    expect(elseBranch).toHaveLength(1);

    const afterEarlyReturn = fixture('NodeWorkspace.tsx', `
      import { editPresentation as commit } from './edit';
      const onNodesChange = (changes: any[]) => {
        for (const c of changes) {
          if (!c.dragging) continue;
          commit('s1', (g) => g);
        }
      };
    `);
    expect(afterEarlyReturn).toHaveLength(1);
  });

  it('rejects unconditional position commit in onNodesChange without checking dragging', () => {
    const errors = fixture('NodeWorkspace.tsx', `
      const onNodesChange = (changes: any[]) => {
        for (const c of changes) {
          if (c.type === 'position' && c.position) editPresentation('s1', (g) => g);
        }
      };
    `);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/NodeWorkspace\.tsx:\d+ — /);
  });

  it('rejects unconditional NodeToolbar mounting on a card', () => {
    const errors = fixture('nodes.tsx', `
      function Card({ selected }: { selected: boolean }) {
        return <><NodeToolbar isVisible={selected}><div /></NodeToolbar></>;
      }
    `);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/nodes\.tsx:\d+ — /);
  });

  it('allows conditional NodeToolbar mounting', () => {
    const errors = fixture('nodes.tsx', `
      function Card({ selected }: { selected: boolean }) {
        return <>{selected ? <NodeToolbar isVisible><div /></NodeToolbar> : null}</>;
      }
    `);
    expect(errors).toEqual([]);
  });

  it('rejects CutTool move handlers that rescan the whole trail per pointermove', () => {
    const callsTrailCuts = fixture('CutTool.tsx', `
      function useCutTool() {
        const move = (e: any) => {
          const next = [...trail, e];
          mark(trailCuts(next, lines.current));
        };
        return { move };
      }
    `);
    expect(callsTrailCuts).toHaveLength(1);

    const loopsTrail = fixture('CutTool.tsx', `
      function useCutTool() {
        const move = (e: any) => {
          for (let i = 1; i < trail.length; i++) {
            segmentsCross(trail[i - 1], trail[i], e, e);
          }
        };
        return { move };
      }
    `);
    expect(loopsTrail).toHaveLength(1);
  });

  it('rejects an unconditional editPresentation call at the start of applyDragChanges even when later branches check dragging', () => {
    const errors = fixture('useNodeDrag.ts', `
      import { editPresentation } from '../../engine/nodecore/edit';
      export function useNodeDrag(sessionId: string) {
        const applyDragChanges = (changes: any[]) => {
          editPresentation(sessionId, (g: any) => g);
          for (const c of changes) {
            if (c.type !== 'position') continue;
            if (c.dragging === true) {
              // preview only
            } else {
              editPresentation(sessionId, (g: any) => g);
            }
          }
        };
        return { applyDragChanges };
      }
    `);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/useNodeDrag\.ts:\d+ — .*editPresentation/);
  });

  it('resolves calls in inner blocks with their lexical scope (no false positive on shadowed alias, catches inner-block alias)', () => {
    const shadowedInBlock = fixture('useNodeDrag.ts', `
      import { editPresentation as commit } from '../../engine/nodecore/edit';
      export function useNodeDrag(sessionId: string) {
        const applyDragChanges = (changes: any[]) => {
          for (const c of changes) {
            if (c.type === 'position' && c.dragging === true) {
              const commit = (id: string) => id;
              commit(c.id);
            }
          }
        };
        return { applyDragChanges, commit };
      }
    `);
    expect(shadowedInBlock).toEqual([]);

    const shadowedInHelperBlock = fixture('useNodeDrag.ts', `
      import { editPresentation as commit } from '../../engine/nodecore/edit';
      function touch(id: string) {
        {
          const commit = (x: string) => x;
          commit(id);
        }
      }
      export function useNodeDrag() {
        const applyDragChanges = (changes: any[]) => {
          for (const c of changes) {
            if (c.type === 'position' && c.dragging === true) touch(c.id);
          }
        };
        return { applyDragChanges };
      }
    `);
    expect(shadowedInHelperBlock).toEqual([]);

    const innerBlockAlias = fixture('useNodeDrag.ts', `
      import { editPresentation } from '../../engine/nodecore/edit';
      export function useNodeDrag(sessionId: string) {
        const applyDragChanges = (changes: any[]) => {
          for (const c of changes) {
            if (c.type === 'position' && c.dragging === true) {
              const localWrite = editPresentation;
              localWrite(sessionId, (g: any) => g);
            }
          }
        };
        return { applyDragChanges };
      }
    `);
    expect(innerBlockAlias).toHaveLength(1);
  });
});

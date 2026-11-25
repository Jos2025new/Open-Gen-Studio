import { beforeEach, describe, expect, it } from 'vitest';
import { getDoc, resetStore, text } from './library-groups-fixtures';
import { createEmptyGroup, groupNodes, moveGroup, wholeGroup } from '../src/engine/flow/arrange';
import { libraryToNodes, nodesToLibrary } from '../src/engine/flow/fromLibrary';
import { createItem, libraryToDesigner, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { editCompound } from '../src/engine/nodecore/edit';
import { run } from '../src/engine/commands';
import type { GraphGroup } from '../src/engine/types';
import { createSession, useStore } from '../src/store/store';

/** The tree by titles: each group with its parent and its texts. */
const tree = (groups: readonly GraphGroup[] | undefined, nodes: ReadonlyArray<{ id: string; data: { kind: string; text?: string } }>) =>
  Object.fromEntries((groups ?? []).map((g) => [g.title, [groups!.find((p) => p.id === g.parentId)?.title ?? '', ...g.nodeIds.map((id) => nodes.find((n) => n.id === id)?.data.text ?? '?')].join('/')]));
const graphOf = (sid: string) => useStore.getState().sessions[sid].graph;
const another = (title: string) => { const s = createSession(title); useStore.setState((st) => ({ sessions: { ...st.sessions, [s.id]: s } })); return s.id; };
const entry = (id: string) => useStore.getState().library.find((s) => s.id === id)!;
const EXPECTED = { Board: '/One', Inner: 'Board/Two', Deep: 'Inner/Three/Four', Empty: 'Board' };
let sid: string, root: string;

beforeEach(() => {
  sid = resetStore().id;
  editCompound(sid, 'test', (g) => ({ ...g, nodes: [text('a', 'One', 0, 0), text('b', 'Two', 400, 0), text('c', 'Three', 800, 0), text('d', 'Four', 800, 300)] as never }));
  const deep = groupNodes(sid, ['c', 'd'], 'Deep')!;
  const inner = groupNodes(sid, ['b', deep], 'Inner')!;
  const empty = createEmptyGroup(sid, { x: 0, y: 500 }, 'Empty')!;
  root = groupNodes(sid, ['a', inner, empty], 'Board')!;
});
const save = (mode: 'new' | 'overwrite', groupId = root, session = sid, subjectId?: string) =>
  nodesToLibrary({ sessionId: session, mode, subjectId, kind: 'moodboard', groupId, name: mode === 'new' ? 'Board' : undefined });

describe('a group with groups inside, through the Library', () => {
  it('is saved whole and opens the same in another session', async () => {
    const kit = await save('new');
    expect(tree(kit.graph!.groups, kit.graph!.nodes as never)).toEqual(EXPECTED);
    const other = another('Other');
    const { groupId, added } = libraryToNodes(other, kit.id);
    expect(added).toHaveLength(4);
    expect(tree(graphOf(other).groups, graphOf(other).nodes as never)).toEqual(EXPECTED);
    expect(graphOf(other).groups!.filter((g) => g.library)).toHaveLength(1);
    // The empty frame keeps its place beside the rest.
    const at = (s: string) => { const g = graphOf(s), n = g.nodes.find((x) => x.data.kind === 'text' && x.data.text === 'One')!, e = g.groups!.find((x) => x.title === 'Empty')!; return [Math.round(e.bounds!.x - n.position.x), Math.round(e.bounds!.y - n.position.y)].map((v) => v + 0); };
    expect(at(other)).toEqual(at(sid));
    // Moved and saved again from there: same elements and groups, nothing lost or added.
    moveGroup(other, groupId!, 300, 200);
    const again = await save('overwrite', groupId!, other, kit.id);
    expect(again.graph!.nodes.map((n) => n.id).sort()).toEqual(kit.graph!.nodes.map((n) => n.id).sort());
    expect(again.graph!.groups!.map((g) => g.id).sort()).toEqual(kit.graph!.groups!.map((g) => g.id).sort());
    expect(tree(again.graph!.groups, again.graph!.nodes as never)).toEqual(EXPECTED);
    expect(again.graph!.groups!.find((g) => g.title === 'Empty')!.bounds).toEqual(kit.graph!.groups!.find((g) => g.title === 'Empty')!.bounds);
  });

  it('keeps the tree through the Designer, a copy and a restored version', async () => {
    const kit = await save('new'), first = kit.versionId!;
    const { doc } = await libraryToDesigner(sid, kit.id) as { doc?: { id: string } };
    const docId = doc?.id ?? useStore.getState().sessions[sid].activeDocId!;
    expect(getDoc(sid, docId)!.library?.subjectId).toBe(kit.id);
    const fromDesigner = await saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid, docId });
    expect(tree(fromDesigner.graph!.groups, fromDesigner.graph!.nodes as never)).toEqual(EXPECTED);
    const copy = await saveItem({ subjectId: kit.id, mode: 'copy', space: 'library', by: 'user' });
    expect(tree(copy.graph!.groups, copy.graph!.nodes as never)).toEqual(EXPECTED);
    await saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user', graph: { nodes: [], edges: [] } });
    const back = await restoreItemVersion({ subjectId: kit.id, versionId: first, space: 'library', by: 'user' });
    expect(tree(back.graph!.groups, back.graph!.nodes as never)).toEqual(EXPECTED);
  });

  it('the agent writes back the graph it reads, with its groups', async () => {
    const kit = await save('new');
    const graph = structuredClone(entry(kit.id).graph!);
    const res = await run({ cmd: 'library.item.save', on: { session: sid }, args: { id: kit.id, mode: 'overwrite', graph } }, { caller: 'agent' });
    expect(res.ok).toBe(true);
    expect(tree(entry(kit.id).graph!.groups, entry(kit.id).graph!.nodes as never)).toEqual(EXPECTED);
  });

  it('selecting everything in the outer group is the outer group', () => {
    expect(wholeGroup(graphOf(sid), ['a', 'b', 'c', 'd'])?.title).toBe('Board');
    expect(wholeGroup(graphOf(sid), ['b', 'c', 'd'])?.title).toBe('Inner');
    expect(wholeGroup(graphOf(sid), ['a', 'b'])).toBeUndefined();
  });

  it('loose groups of an entry open inside one frame with its name; an unknown parent or a cycle hangs nothing', async () => {
    const nodes = [text('x', 'X', 0, 0), text('y', 'Y', 400, 0)] as never;
    const { subject } = await createItem({ name: 'Loose', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes, edges: [], groups: [{ id: 'g1', title: 'G1', nodeIds: ['x'], parentId: 'gone' }, { id: 'g2', title: 'G2', nodeIds: ['y'] }] } });
    const other = another('Other');
    libraryToNodes(other, subject.id);
    expect(tree(graphOf(other).groups, graphOf(other).nodes as never)).toEqual({ Loose: '', G1: 'Loose/X', G2: 'Loose/Y' });
    const { subject: odd } = await createItem({ name: 'Odd', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes, edges: [], groups: [{ id: 'g1', title: 'G1', nodeIds: ['x'], parentId: 'g2' }, { id: 'g2', title: 'G2', nodeIds: ['y'], parentId: 'g1' }] } });
    const third = another('Third');
    expect(libraryToNodes(third, odd.id).added).toHaveLength(2);
  });
});

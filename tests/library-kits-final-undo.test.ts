import { expect, it } from 'vitest';
import { graphOf, notesOf, resetStore, text, tool } from './library-kits-final-fixtures';
import { undoDoc } from '../src/engine/design/actions';
import { canUndo } from '../src/engine/design/history';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { useStore } from '../src/store/store';

it('creates and populates a new document without an initial undo step', async () => {
  const s = resetStore();
  const result = await tool(s.id, [{ cmd: 'library.item.create', args: {
    name: 'Board', kind: 'moodboard', space: 'designer', graph: graphOf(text('t', 'Hi', 100, 100)),
  } }]);
  expect(result.done).toBe(true);
  expect(result.text).toContain('Saved in Library');
  const doc = useStore.getState().sessions[s.id].docs[0];
  expect(notesOf(s.id, doc.id)).toEqual(['Hi']);
  expect({ canUndo: canUndo(doc.id), advertisesUndo: result.text.includes('One Ctrl+Z') }).toEqual({ canUndo: false, advertisesUndo: false });
});

it('omits the one-undo promise when a reopen and a text edit need two undos', async () => {
  const s = resetStore();
  const a = text('a', 'A', 100, 100);
  const { subject } = await createItem({ name: 'Board', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(a) });
  const doc = await libraryToDesigner(s.id, subject.id);
  await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user', graph: graphOf(a, text('b', 'B', 400, 400)) });
  const result = await tool(s.id, [
    { cmd: 'library.item.open', args: { id: subject.id, space: 'designer' } },
    { cmd: 'designer.layer.add_text', args: { text: 'Own', x: 30, y: 30, width: 200 } },
  ]);
  expect(result.done, result.text).toBe(true);
  expect(notesOf(s.id, doc.id)).toEqual(['A', 'B', 'Own']);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual(['A', 'B']);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual(['A']);
  expect(result.text).not.toContain('One Ctrl+Z');
});

it('promises one undo when a single reopen records one step in the existing document', async () => {
  const s = resetStore();
  const a = text('a', 'A', 100, 100);
  const { subject } = await createItem({ name: 'Board', kind: 'moodboard', space: 'library', by: 'user', graph: graphOf(a) });
  const doc = await libraryToDesigner(s.id, subject.id);
  await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'library', by: 'user', graph: graphOf(a, text('b', 'B', 400, 400)) });
  const result = await tool(s.id, [{ cmd: 'library.item.open', args: { id: subject.id, space: 'designer' } }]);
  expect(result.done).toBe(true);
  expect(result.text).toContain('One Ctrl+Z per document undoes it all.');
  expect(notesOf(s.id, doc.id)).toEqual(['A', 'B']);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual(['A']);
  expect(canUndo(doc.id)).toBe(false);
});

it('omits the one-undo promise when a rename survives undoing the next edit', async () => {
  const s = resetStore();
  const { subject } = await createItem({ name: 'Board', kind: 'moodboard', space: 'library', by: 'user' });
  const doc = await libraryToDesigner(s.id, subject.id);
  const result = await tool(s.id, [
    { cmd: 'designer.doc.rename', args: { name: 'Renamed' } },
    { cmd: 'designer.layer.add_text', args: { text: 'Own', x: 30, y: 30, width: 200 } },
  ]);
  expect(result.done, result.text).toBe(true);
  undoDoc(s.id, doc.id);
  expect(notesOf(s.id, doc.id)).toEqual([]);
  expect(useStore.getState().sessions[s.id].docs[0].name).toBe('Renamed');
  expect(result.text).not.toContain('One Ctrl+Z');
});

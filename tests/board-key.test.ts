// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { boardKey, offBoard } from '../src/components/designer/boardKey';

afterEach(() => { document.body.innerHTML = ''; });
const press = (el: Element) => { let ev!: Event; el.addEventListener('keydown', (e) => { ev = e; }); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return ev; };

it('a key with focus in the conversation, the thread or the chat column never reaches the board', () => {
  document.body.innerHTML = `<div class="designer"><canvas></canvas></div>
    <section class="node-side designer-corner"><button id="a">msg</button></section>
    <div class="thread-peek"><button id="b">msg</button></div><div class="chat-column"><button id="c">msg</button></div>
    <textarea id="t"></textarea>`;
  expect(boardKey(press(document.querySelector('canvas')!))).toBe(true);
  expect(boardKey(press(document.body))).toBe(true);
  for (const id of ['a', 'b', 'c', 't']) expect(boardKey(press(document.getElementById(id)!))).toBe(false);
  document.body.insertAdjacentHTML('beforeend', '<div class="popover"></div>');
  expect(boardKey(press(document.querySelector('canvas')!))).toBe(false);
  expect(offBoard(press(document.querySelector('canvas')!))).toBe(false);
});

it('every board listener uses it: node editing, shape knots, the Designer keys and its clipboard', () => {
  for (const f of ['PathNodes.tsx', 'MultiPathNodes.tsx', 'designerKeys.ts']) expect(readFileSync(`src/components/designer/${f}`, 'utf8')).toMatch(/if \(!(doc \|\| !)?boardKey\(e\)\) return;/);
  expect(readFileSync('src/components/designer/ShapeKnots.tsx', 'utf8')).toContain("e.key === 'Escape' && boardKey(e)");
  expect(readFileSync('src/components/designer/designerClipboard.ts', 'utf8')).toContain('const inField = (e: Event) => offBoard(e) ||');
});

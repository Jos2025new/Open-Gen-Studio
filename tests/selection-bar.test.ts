// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SelectionBar } from '../src/components/designer/SelectionActions';
import { createDoc } from '../src/engine/design/doc';
import { setSelection } from '../src/engine/design/pixelSelection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const doc = createDoc('Bar', 100, 100);
afterEach(() => { act(() => setSelection(doc.id, null)); });

it('floats only while something is selected, with what acts on the selection', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(SelectionBar, { sessionId: 'test', doc })));
  expect(host.querySelector('.selection-bar')).toBeNull();
  act(() => setSelection(doc.id, { points: [[0, 0], [10, 0], [10, 10]] }));
  expect([...host.querySelectorAll('.selection-bar button')].map((b) => b.textContent)).toEqual(['Deselect', 'Invert', 'Shrink', 'Grow', 'Fill', 'Delete', 'To layer']);
  act(() => setSelection(doc.id, null));
  expect(host.querySelector('.selection-bar')).toBeNull();
  act(() => root.unmount());
});

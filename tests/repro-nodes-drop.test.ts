// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { OnConnectEnd } from '@xyflow/react';
import { connectionDrop } from '../src/components/node/connectionDrop';

// Repro (case 1, drop a cable): a cable dragged from output port "2" and released on empty canvas must remember
// which port it left from, otherwise addConnected cannot give the new node that result (ConnectedNodeMenu.tsx:55 promises it).
describe('repro 1: dropping a cable from port 2', () => {
  // Cause: connectionDrop.ts:13 returns only {x, y, from}; the handle id is lost (addConnected.ts:38-40 has no handle either).
  it.fails('the drop result still carries the port the cable left from', () => {
    const canvas = document.createElement('div');
    const pane = document.createElement('div');
    pane.className = 'react-flow__pane'; canvas.append(pane);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const event = new MouseEvent('mouseup', { clientX: 10, clientY: 10 });
    pane.dispatchEvent(event);
    const state = { isValid: false, toNode: null, fromNode: { id: 'source' }, fromHandle: { type: 'source', id: 'out-2' } } as unknown as Parameters<OnConnectEnd>[1];
    expect(JSON.stringify(connectionDrop(event, state, canvas))).toContain('out-2');
  });
});

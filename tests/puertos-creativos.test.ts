import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkHandles } from '../src/components/node/SystemNode';
import { inputPorts, outputPort } from '../src/engine/flow/graph';
import { allNodePorts } from '../src/engine/nodes/spec';
import type { GraphNodeData } from '../src/engine/types';

describe('creative link ports', () => {
  it('exposes the five link ports on an image node in connection resolution order', () => {
    const image: GraphNodeData = {
      kind: 'image',
      title: 'Image',
      prompt: '',
      modelRef: 'local::studio-image',
      settings: { count: 1, advanced: {} },
      outputIndex: 0,
    };
    const ports = allNodePorts(image, {}, inputPorts(image), outputPort(image, {}));

    expect(ports.filter(({ kind }) => kind !== 'data')).toEqual([
      { id: 'sys_ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'out_ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Reference' },
      { id: 'model', direction: 'in', kind: 'control', type: 'model', multi: false, label: 'Model' },
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'out_control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
    ]);
  });

  it('renders the handle IDs, sides and top positions in visual order', () => {
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(LinkHandles)));
    const handles = [...html.matchAll(/<div\b[^>]*\bdata-handleid="[^"]+"[^>]*>/g)].map(([tag]) => ({
      id: tag.match(/\bdata-handleid="([^"]+)"/)?.[1],
      side: tag.match(/\bdata-handlepos="([^"]+)"/)?.[1],
      top: tag.match(/\bstyle="top:([^;"]+)/)?.[1],
    }));

    expect(handles).toEqual([
      { id: 'sys_ref', side: 'left', top: '74%' },
      { id: 'model', side: 'left', top: '81%' },
      { id: 'control', side: 'left', top: '88%' },
      { id: 'out_ref', side: 'right', top: '81%' },
      { id: 'out_control', side: 'right', top: '88%' },
    ]);
  });
});

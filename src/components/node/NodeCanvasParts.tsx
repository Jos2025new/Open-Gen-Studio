import { memo, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { Play, Plus } from '../ui/icons';
import { setUi, useStore } from '../../store/store';
import { usePreviewDeps } from './usePreviewDeps';
import { prepareNodeRun, previewRun } from '../../engine/flow/actions';
import { runApproved } from '../../engine/nodecore/action';
import { uid } from '../../lib/id';
import type { Generation, Graph, GraphNodeData } from '../../engine/types';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { NodeLibrary, type OmniEntries } from './AddNodeItems';
import { chatToNodes, chatWorkNotInNodes } from '../../engine/flow/fromChat';
import { ImportFromChat } from '../ui/ImportFromChat';
import { chatItem } from './nodeToolStorage';

/** Running jobs only enter the import menu when they finish. */
export const CanvasChatImport = memo(function CanvasChatImport({ sessionId, content }: { sessionId: string; content: Graph['nodes'] }) {
  const rf = useReactFlow();
  const feed = useStore(s => s.sessions[sessionId].feed);
  const selectFinished = useMemo(() => {
    let inventory: Record<string, Generation> | undefined;
    let finished: Generation[] = [];
    return ({ generations }: { generations: Record<string, Generation> }) => {
      if (inventory !== generations) {
        inventory = generations;
        finished = Object.values(generations).filter(g => g.sessionId === sessionId && g.status === 'done');
      }
      return finished;
    };
  }, [sessionId]);
  const finished = useStore(useShallow(selectFinished));
  const items = useMemo(() => chatWorkNotInNodes(sessionId).map(chatItem), [sessionId, content, feed, finished]);
  return <ImportFromChat
    sessionId={sessionId}
    canvas="node"
    items={items}
    noun="result"
    onImport={ids => {
      chatToNodes(sessionId, ids);
      window.setTimeout(() => void rf.fitView({ padding: 0.2, duration: 300 }), 50);
    }}
  />;
});

/** Add node: the first tool of the canvas toolbox; its list opens to the right. */
export function AddNodeMenu({ onAdd, onImport, omni }: { onAdd: (data: GraphNodeData) => void; onImport: () => void; omni?: OmniEntries }) {
  const pop = usePopover();
  return (
    <>
      <IconButton ref={pop.ref} icon={Plus} label="Add node…" aria-haspopup="menu" aria-expanded={pop.open} active={pop.open} onClick={pop.toggle} />
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" width={340} label="Add node" className="node-lib-pop">
        <NodeLibrary
          // The omnicanvas entries add a node too: the same one click (or Enter) closes the menu.
          omni={omni && { spaces: omni.spaces, has: omni.has, onSpace: (space) => { omni.onSpace(space); pop.close(); }, onSystem: (type) => { omni.onSystem(type); pop.close(); } }}
          onPick={(data) => {
            onAdd(data);
            pop.close();
          }}
          onAsset={() => {
            pop.close();
            setUi({ panel: 'gallery' });
          }}
          onImport={() => {
            pop.close();
            onImport();
          }}
        />
      </Popover>
    </>
  );
}

export function RunAll({ sessionId, ids }: { sessionId: string; ids: string[] }) {
  const pop = usePopover();
  const confirmId = useRef('');
  usePreviewDeps(sessionId, pop.open); // Keeps the reviewed request and price current.
  const preview = pop.open ? previewRun(sessionId, ids, false) : null;
  return (
    <>
      <Button ref={pop.ref} size="sm" variant="primary" icon={Play} disabled={!ids.length} onClick={() => { confirmId.current = uid('run'); void prepareNodeRun(sessionId, ids, false).then(pop.toggle); }}>
        Run all
      </Button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Run all nodes">
        {preview ? (
          <SpendConfirm
            title={`Run ${preview.count} node${preview.count === 1 ? '' : 's'}`}
            lines={preview.runIds.map(id => `${id} · ${useStore.getState().sessions[sessionId].graph.nodes.find(n => n.id === id)?.data.title}`)}
            estimate={preview.estimate}
            blocked={preview.errors[0] ?? null}
            sessionId={sessionId}
            onCancel={pop.close}
            onConfirm={() => {
              if (previewRun(sessionId, ids, false).signature !== preview.signature) return;
              return runApproved(sessionId, ids, false, preview, confirmId.current).then(() => pop.close());
            }}
          />
        ) : null}
      </Popover>
    </>
  );
}

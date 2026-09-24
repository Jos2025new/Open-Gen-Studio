import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { Copy, Film, Image as ImageIcon, LayoutGrid, Maximize, Play, Plus, Trash, Type } from 'lucide-react';
import { setGraph, setUi, useStore } from '../../store/store';
import { addNode, deleteNodes, duplicateNode, layoutAll, newNodeData, previewRun, runNodes, runnableIds, tryConnect } from '../../engine/flow/actions';
import { connectionError, outputPort, NODE_WIDTH } from '../../engine/flow/graph';
import type { GraphNodeData } from '../../engine/types';
import { TopbarActions } from '../shell/TopBar';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { AddNodeItems, StudioNode, type FlowNode } from './nodes';

const nodeTypes = { studio: StudioNode };

function AddNodeMenu({ onAdd }: { onAdd: (data: GraphNodeData) => void }) {
  const pop = usePopover();
  return (
    <>
      <Button ref={pop.ref} size="sm" icon={Plus} variant="secondary" onClick={pop.toggle}>
        Add node
      </Button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={260} label="Add node">
        <AddNodeItems
          onPick={(data) => {
            onAdd(data);
            pop.close();
          }}
          onAsset={() => {
            pop.close();
            setUi({ panel: 'gallery' });
          }}
        />
      </Popover>
    </>
  );
}

function RunAll({ sessionId, ids }: { sessionId: string; ids: string[] }) {
  const pop = usePopover();
  const preview = pop.open ? previewRun(sessionId, ids) : null;
  return (
    <>
      <Button ref={pop.ref} size="sm" variant="primary" icon={Play} disabled={!ids.length} onClick={pop.toggle}>
        Run all
      </Button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Run all nodes">
        {preview ? (
          <SpendConfirm
            title={`Run ${preview.count} node${preview.count === 1 ? '' : 's'}`}
            lines={['Every generation and tool node, in dependency order']}
            estimate={preview.estimate}
            blocked={preview.errors[0] ?? null}
            onCancel={pop.close}
            onConfirm={() => {
              pop.close();
              void runNodes(sessionId, ids);
            }}
          />
        ) : null}
      </Popover>
    </>
  );
}

function Canvas() {
  const sessionId = useStore((s) => s.activeSessionId);
  const graph = useStore((s) => s.sessions[s.activeSessionId].graph);
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const rf = useReactFlow();
  // Controlled flow: React Flow reports measured sizes as changes; nodes passed back without them stay hidden.
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());

  const nodes: FlowNode[] = useMemo(() => {
    // Count only live nodes: ids of deleted nodes must not keep the toolbar hidden.
    const solo = graph.nodes.filter((n) => selected.has(n.id)).length === 1;
    return graph.nodes.map((n) => ({
        id: n.id,
        type: 'studio',
        position: n.position,
        data: { node: n, solo },
        selected: selected.has(n.id),
        width: NODE_WIDTH,
        measured: measured.get(n.id),
      }));
  }, [graph.nodes, selected, measured]);

  const running = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      const d = n.data;
      if ((d.kind === 'image' || d.kind === 'video' || d.kind === 'tool') && d.generationId) {
        const st = generations[d.generationId]?.status;
        if (st === 'running' || st === 'queued') set.add(n.id);
      }
    }
    return set;
  }, [graph.nodes, generations]);

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.source);
        const type = src ? outputPort(src.data, assets) : null;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          className: `edge-${type ?? 'none'}`,
          animated: running.has(e.target),
          selected: selectedEdges.has(e.id),
        };
      }),
    [graph.edges, graph.nodes, assets, running, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moves = new Map<string, { x: number; y: number }>();
      const removed: string[] = [];
      let sel: Set<string> | null = null;
      let sizes: Map<string, { width: number; height: number }> | null = null;
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions) (sizes ??= new Map(measured)).set(c.id, c.dimensions);
        else if (c.type === 'position' && c.position) moves.set(c.id, c.position);
        else if (c.type === 'remove') removed.push(c.id);
        else if (c.type === 'select') {
          sel = sel ?? new Set(selected);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      }
      if (moves.size) setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)) }));
      if (removed.length) {
        deleteNodes(sessionId, removed);
        sel = sel ?? new Set(selected);
        for (const id of removed) sel.delete(id);
      }
      if (sel) setSelected(sel);
      if (sizes) setMeasured(sizes);
    },
    [sessionId, selected, measured],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removed = new Set<string>();
      let sel: Set<string> | null = null;
      for (const c of changes) {
        if (c.type === 'remove') removed.add(c.id);
        else if (c.type === 'select') {
          sel = sel ?? new Set(selectedEdges);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      }
      if (removed.size) setGraph(sessionId, (g) => ({ ...g, edges: g.edges.filter((e) => !removed.has(e.id)) }));
      if (sel) setSelectedEdges(sel);
    },
    [sessionId, selectedEdges],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const st = useStore.getState();
      return connectionError(st.sessions[sessionId].graph, st.assets, { source: c.source, target: c.target, targetHandle: c.targetHandle ?? null }) === null;
    },
    [sessionId],
  );

  const addAtCenter = (data: GraphNodeData) => {
    const el = document.querySelector('.node-canvas');
    const r = el?.getBoundingClientRect();
    const center = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2.6 }) : { x: 0, y: 0 };
    const id = addNode(sessionId, data, { x: center.x - NODE_WIDTH / 2 + (Math.random() - 0.5) * 40, y: center.y + (Math.random() - 0.5) * 40 });
    setSelected(new Set([id]));
  };

  const runIds = runnableIds(graph.nodes);

  // Right-click menu, anchored to an invisible point at the cursor.
  const menuAnchor = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const openMenu = (e: React.MouseEvent | MouseEvent, nodeId?: string) => {
    e.preventDefault();
    const r = document.querySelector('.node-canvas')?.getBoundingClientRect();
    setMenu({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), nodeId });
  };
  const menuNode = menu?.nodeId ? graph.nodes.find((n) => n.id === menu.nodeId) : undefined;

  return (
    <div
      className="node-canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-ogs-asset')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const assetId = e.dataTransfer.getData('application/x-ogs-asset');
        if (!assetId) return;
        e.preventDefault();
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(sessionId, { kind: 'asset', title: 'Asset', assetId }, { x: pos.x - NODE_WIDTH / 2, y: pos.y - 40 });
      }}
    >
      <TopbarActions>
        <AddNodeMenu onAdd={addAtCenter} />
        <IconButton icon={LayoutGrid} label="Auto layout" size="sm" disabled={!graph.nodes.length} onClick={() => {
          layoutAll(sessionId);
          window.setTimeout(() => void rf.fitView({ padding: 0.2, duration: 300 }), 30);
        }} />
        <IconButton icon={Maximize} label="Fit view" size="sm" disabled={!graph.nodes.length} onClick={() => void rf.fitView({ padding: 0.2, duration: 300 })} />
        <RunAll sessionId={sessionId} ids={runIds} />
      </TopbarActions>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneContextMenu={(e) => openMenu(e)}
        onNodeContextMenu={(e, n) => {
          setSelected(new Set([n.id]));
          openMenu(e, n.id);
        }}
        onConnect={(c) => void tryConnect(sessionId, { source: c.source, target: c.target, targetHandle: c.targetHandle ?? null })}
        isValidConnection={isValidConnection}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#26262b" />
        <Controls showInteractive={false} position="bottom-right" />
        {graph.nodes.length > 6 ? <MiniMap pannable zoomable position="top-right" maskColor="rgba(10,10,11,0.7)" nodeColor="#2a2a30" /> : null}
      </ReactFlow>
      <div ref={menuAnchor} className="ctx-anchor" style={menu ? { left: menu.x, top: menu.y } : undefined} />
      <Popover open={Boolean(menu)} anchor={menuAnchor} onClose={() => setMenu(null)} width={240} label={menuNode ? 'Node' : 'Add node'}>
        {menuNode ? (
          <div className="menu">
            <MenuItem icon={Copy} label="Duplicate" onClick={() => (duplicateNode(sessionId, menuNode), setMenu(null))} />
            <MenuItem
              icon={Trash}
              label="Delete"
              detail="Del"
              danger
              onClick={() => {
                deleteNodes(sessionId, [menuNode.id]);
                setSelected(new Set());
                setMenu(null);
              }}
            />
          </div>
        ) : menu ? (
          <AddNodeItems
            onPick={(data) => {
              const r = document.querySelector('.node-canvas')?.getBoundingClientRect();
              const pos = rf.screenToFlowPosition({ x: menu.x + (r?.left ?? 0), y: menu.y + (r?.top ?? 0) });
              setSelected(new Set([addNode(sessionId, data, pos)]));
              setMenu(null);
            }}
            onAsset={() => {
              setMenu(null);
              setUi({ panel: 'gallery' });
            }}
          />
        ) : null}
      </Popover>
      {!graph.nodes.length ? (
        <div className="node-empty">
          <h2>Build a flow</h2>
          <p className="faint">Ask the agent in the composer — it creates, connects and lays out the nodes — or add them yourself.</p>
          <div className="node-empty-actions">
            <Button size="sm" icon={Type} onClick={() => addAtCenter(newNodeData('text'))}>
              Text
            </Button>
            <Button size="sm" icon={ImageIcon} onClick={() => addAtCenter(newNodeData('image'))}>
              Image
            </Button>
            <Button size="sm" icon={Film} onClick={() => addAtCenter(newNodeData('video'))}>
              Video
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NodeWorkspace() {
  const sessionId = useStore((s) => s.activeSessionId);
  return (
    <ReactFlowProvider key={sessionId}>
      <Canvas />
    </ReactFlowProvider>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  SelectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { setUi, toast, useStore } from '../../store/store';
import { editPresentation } from '../../engine/nodecore/edit';
import { ensureOmniNodes } from '../../engine/nodes/omni';
import { addAssetAsNode, addConnected, addNode, deleteNodes, disconnectEdges, duplicateNode, layoutAll, newNodeData, runnableIds, tryConnect } from '../../engine/flow/actions';
import { connectionError, estimatedHeight, findFreePosition, nodeRect, nodeWidth, outputPort, NODE_WIDTH } from '../../engine/flow/graph';
import { uploadFiles } from '../../engine/actions';
import { prepareImportFile } from '../../lib/imports';
import { focusNodes, setNodeSelection, useNodeFocus } from '../../engine/flow/selection';
import type { GraphNodeData } from '../../engine/types';
import { TopbarActions } from '../shell/TopBar';
import { Popover } from '../ui/Popover';
import { StudioNode, type FlowNode } from './nodes';
import { AddNodeItems } from './AddNodeItems';
import { AddNodeMenu, CanvasChatImport, RunAll } from './NodeCanvasParts';
import { omniWidth } from '../omni/RefNode';
import { useOmniFraming } from '../omni/useOmniFraming';
import { revealRect } from '../omni/revealNode';
import { useOmniEntries } from '../omni/useOmniEntries';
import { settleNewNodes } from '../../engine/flow/settle';
import { ConnectionPreview } from './ConnectedNodeMenu';
import { connectionDrop, reportRefusedDrop, usePortZoom } from './connectionDrop';
import { CanvasPanels } from './SelectionPanel';
import { CanvasNavigation, NODE_MAX_ZOOM, NODE_MIN_ZOOM, type NodeTool } from './CanvasNavigation';
import { useCutTool } from './CutTool';
import { GroupNode, Operations } from './Operations';
import { LinkBar, useDeleteRequest } from './LinkBar';
import { copyNodes, cutNodes, groupBounds, groupNodes, hasNodeClipboard, moveGroup, pasteNodes, ungroup, wholeGroup } from '../../engine/flow/arrange';
import { EmbeddedControls } from '../studio/EmbeddedControls';
import { loadNodeTool } from './nodeToolStorage';
import { BoxSelectRect, NodeContextMenu } from './NodeCanvasMenus';
import { NodeEmptyState } from './NodeEmptyState';
import { useBoardFocus } from '../studio/useBoardFocus';
import { closedGroupNotices, useCanvasElements, useCanvasGroups } from './CanvasElements';
import { CanvasProblems, noticeEdgeTypes } from './CanvasNotices';
import { useCanvasGraphs, useCanvasNotices } from './useCanvasNotices';

const nodeTypes = { studio: StudioNode, group: GroupNode };

/** `embedded`: Studio's board. A smaller canvas: no Add node, Operations, import from chat or top bar; shortcuts only while focus is inside it. */
function Canvas({ embedded = false, omni = false }: { embedded?: boolean; omni?: boolean }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const insideRef = useBoardFocus(embedded ? canvasRef : undefined);
  const sessionId = useStore((s) => s.activeSessionId);
  const fullGraph = useStore((s) => s.sessions[s.activeSessionId].graph);
  // The ordinary canvas draws what it always drew: the omnicanvas-only nodes (system parts, Spaces) stay out of it.
  const { graph, revision, fullRevision, ordinaryRevision } = useCanvasGraphs(fullGraph, omni);
  // Opening the omnicanvas brings the session's parts in as nodes (idempotent; no undo step).
  useEffect(() => { if (omni) ensureOmniNodes(sessionId); }, [omni, sessionId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const del = useDeleteRequest(sessionId, (removedNodes, removedEdges) => {
    if (removedNodes.length) setSelected((prev) => { const next = new Set(prev); removedNodes.forEach((id) => next.delete(id)); return next; });
    if (removedEdges.length) setSelectedEdges((prev) => { const next = new Set(prev); removedEdges.forEach((id) => next.delete(id)); return next; });
  });
  const selectNodes = useCallback((ids: Iterable<string>) => { setSelected(new Set(ids)); setSelectedEdges(new Set()); }, []);
  // Default (pan): drag moves the canvas, wheel/touchpad scrolls it, double-press-and-drag draws a selection box.
  // Select: a plain drag draws the box (the previous behaviour). New key so everyone starts on the new default.
  // Cut (scissors, X) is a passing tool: it is not remembered, and X or Escape returns to the last one.
  const [tool, setTool] = useState<NodeTool>(loadNodeTool);
  const lastTool = useRef<'select' | 'pan'>(tool === 'select' ? 'select' : 'pan');
  const pickTool = (t: NodeTool) => { setTool(t); if (t === 'cut') return; lastTool.current = t; try { localStorage.setItem('ogs.nodeTool.v2', t); } catch { /* storage blocked */ } };
  const cut = useCutTool({ active: tool === 'cut', canvasRef, onCut: (ids) => void disconnectEdges(sessionId, ids) });
  // Double-press on the empty canvas and hold: a selection box (screen coordinates inside .node-canvas).
  const lastPress = useRef<{ t: number; x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // d3-zoom pans on mousedown, which follows pointerdown: block it too while a box is being drawn.
  const boxing = useRef(false);
  const onBoxDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'pan' || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.react-flow__pane') || target.closest('.react-flow__node, .react-flow__panel, .react-flow__edge')) { lastPress.current = null; return; }
    const prev = lastPress.current;
    const now = performance.now();
    lastPress.current = { t: now, x: e.clientX, y: e.clientY };
    if (!prev || now - prev.t > 350 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 12) return;
    // Second press: take the pointer away from React Flow's pan for this gesture.
    e.stopPropagation();
    e.preventDefault();
    lastPress.current = null;
    boxing.current = true;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBox({ x0: x, y0: y, x1: x, y1: y });
  };
  const onBoxMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!box) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setBox({ ...box, x1: e.clientX - r.left, y1: e.clientY - r.top });
  };
  const onBoxUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!box) return;
    e.stopPropagation();
    boxing.current = false;
    const r = e.currentTarget.getBoundingClientRect();
    const a = rf.screenToFlowPosition({ x: r.left + Math.min(box.x0, box.x1), y: r.top + Math.min(box.y0, box.y1) });
    const b = rf.screenToFlowPosition({ x: r.left + Math.max(box.x0, box.x1), y: r.top + Math.max(box.y0, box.y1) });
    setBox(null);
    if (b.x - a.x < 2 && b.y - a.y < 2) return;
    // Partial overlap counts, as with the Select tool.
    const hit = graph.nodes.filter((n) => {
      const m = measuredRef.current.get(n.id) ?? { width: NODE_WIDTH, height: 120 };
      return n.position.x < b.x && n.position.x + m.width > a.x && n.position.y < b.y && n.position.y + m.height > a.y;
    }).map((n) => n.id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) setSelected(new Set([...selected, ...hit]));
    else selectNodes(hit);
  };
  // Shared with the agent (not persisted): what "this" means in a request.
  useEffect(() => setNodeSelection(sessionId, selected), [sessionId, selected]);
  const rf = useReactFlow();
  useOmniFraming(omni, sessionId, rf);
  usePortZoom(omni, canvasRef);
  // Nodes the agent just added: frame them once they are measured.
  const focus = useNodeFocus();
  useEffect(() => {
    if (!focus.tick || focus.sessionId !== sessionId) return;
    const t = window.setTimeout(() => void rf.fitView({ nodes: focus.ids.map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 450 }), 150);
    return () => window.clearTimeout(t);
  }, [focus.tick]);
  // Controlled flow: React Flow reports measured sizes as changes; nodes passed back without them stay hidden.
  const [measured, setMeasured] = useState<Map<string, { width: number; height: number }>>(new Map());
  const measuredRef = useRef(measured);
  measuredRef.current = measured;

  const { notices, byPort, byCable, spaceProblems } = useCanvasNotices(fullRevision, ordinaryRevision, omni, sessionId);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((id: string) => {
    setClosed(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setSelected(new Set());
    setSelectedEdges(new Set());
  }, []);
  const groupNotices = useMemo(() => closedGroupNotices(revision.groups, closed, notices), [revision.groups, closed, notices]);
  const { frames, hidden } = useCanvasGroups(graph, measured, sessionId, closed, groupNotices, toggleGroup);
  const jumpToNode = useCallback((id: string) => {
    const groups = revision.groups?.filter(g => g.nodeIds.includes(id)) ?? [];
    if (groups.some(g => closed.has(g.id))) {
      setClosed(prev => new Set([...prev].filter(gid => !groups.some(g => g.id === gid))));
    }
    selectNodes([id]);
    focusNodes(sessionId, [id]);
  }, [revision.groups, closed, selectNodes, sessionId]);

  const { nodes, edges } = useCanvasElements({
    graph, revision, selected, selectedEdges, measured, frames, hidden,
    byPort, byCable, spaceProblems, sessionId, omni, embedded,
  });

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moves = new Map<string, { x: number; y: number }>();
      const removed: string[] = [];
      const picks: Array<[string, boolean]> = [];
      const sizes: Array<[string, { width: number; height: number }]> = [];
      const frameMoves: Array<[import('../../engine/types').GraphGroup, { x: number; y: number }]> = [];
      const frames = new Map((useStore.getState().sessions[sessionId]?.graph.groups ?? []).map((g) => [g.id, g]));
      for (const c of changes) {
        // A group frame: dragging it moves its nodes; selecting it selects them; deleting it ungroups.
        if ('id' in c && frames.has(c.id)) {
          const g = frames.get(c.id)!;
          if (c.type === 'position' && c.position) frameMoves.push([g, c.position]);
          else if (c.type === 'select' && c.selected) picks.push(...g.nodeIds.map((id) => [id, true] as [string, boolean]));
          else if (c.type === 'remove') ungroup(sessionId, g.id);
          continue;
        }
        if (c.type === 'dimensions' && c.dimensions) sizes.push([c.id, c.dimensions]);
        else if (c.type === 'position' && c.position) moves.set(c.id, c.position);
        else if (c.type === 'remove') removed.push(c.id);
        else if (c.type === 'select') picks.push([c.id, c.selected]);
      }
      if (moves.size) editPresentation(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)) }));
      // A dragged frame moves its nodes — unless they are selected too, then they already moved with it.
      for (const [g, p] of frameMoves) {
        if (g.nodeIds.some((id) => moves.has(id))) continue;
        const ids = new Set(g.nodeIds);
        const members = useStore.getState().sessions[sessionId].graph.nodes.filter(n => ids.has(n.id));
        const b = groupBounds(members, measuredRef.current);
        if (b) moveGroup(sessionId, g.id, p.x - b.x, p.y - b.y);
      }
      if (removed.length) deleteNodes(sessionId, removed);
      // Functional updates: several reports can arrive before a re-render; none may be lost.
      if (picks.length || removed.length) {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const [id, on] of picks) (on ? next.add(id) : next.delete(id));
          for (const id of removed) next.delete(id);
          return next;
        });
      }
      if (sizes.length) setMeasured((prev) => new Map([...prev, ...sizes]));
      // First sizes of nodes (new, imported, or opened): settle them off their neighbours (no undo step of its own).
      const fresh = new Set(sizes.filter(([id]) => !measuredRef.current.has(id)).map(([id]) => id));
      if (fresh.size) settleNewNodes(sessionId, fresh, new Map([...measuredRef.current, ...sizes]));
    },
    [sessionId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removed = new Set<string>();
      const picks: Array<[string, boolean]> = [];
      for (const c of changes) {
        if (c.type === 'remove') removed.add(c.id);
        else if (c.type === 'select') picks.push([c.id, c.selected]);
      }
      if (removed.size) disconnectEdges(sessionId, [...removed]);
      if (picks.length || removed.size) {
        setSelectedEdges((prev) => {
          const next = new Set(prev);
          for (const [id, on] of picks) (on ? next.add(id) : next.delete(id));
          for (const id of removed) next.delete(id);
          return next;
        });
      }
    },
    [sessionId],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const st = useStore.getState();
      return connectionError(st.sessions[sessionId].graph, st.assets, { source: c.source, target: c.target, targetHandle: c.targetHandle ?? null, sourceHandle: c.sourceHandle }) === null;
    },
    [sessionId],
  );

  const liveOccupied = useCallback(() => {
    const g = useStore.getState().sessions[sessionId]?.graph;
    return (g?.nodes ?? []).map((n) => nodeRect(n, measuredRef.current));
  }, [sessionId]);

  const freePos = useCallback((desired: { x: number; y: number }, data: GraphNodeData) => {
    const width = omni ? omniWidth(data, NODE_WIDTH) : nodeWidth(data);
    return findFreePosition(desired, { width, height: estimatedHeight(data) }, liveOccupied(), { gapX: 48, gapY: 56 });
  }, [omni, liveOccupied]);

  const addAtCenter = (data: GraphNodeData) => {
    const el = canvasRef.current;
    const r = el?.getBoundingClientRect();
    const center = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2.6 }) : { x: 0, y: 0 };
    const pos = freePos({ x: center.x - NODE_WIDTH / 2, y: center.y }, data);
    const id = addNode(sessionId, data, pos);
    if (!id) return;
    selectNodes([id]);
    revealRect(rf, canvasRef.current, { ...pos, width: omni ? omniWidth(data, NODE_WIDTH) : nodeWidth(data), height: Math.min(estimatedHeight(data), 160) });
  };

  const omniEntries = useOmniEntries({ omni, sessionId, rf, canvasRef, freePos, selectNodes });

  const fileInput = useRef<HTMLInputElement>(null);
  const importPosition = useRef<{ x: number; y: number } | undefined>(undefined);
  // Import from the toolbox's library: the images land at the visible centre, like Add node.
  const importAtCenter = () => {
    const r = canvasRef.current?.getBoundingClientRect();
    importPosition.current = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2.6 }) : undefined;
    fileInput.current?.click();
  };
  const importImages = useCallback(async (files: File[], position?: { x: number; y: number }) => {
    // EPS and HEIC/HEIF become PNG first (the same conversion as the Designer); unreadable files say why.
    const ready: File[] = [];
    for (const f of files) {
      const r = await prepareImportFile(f);
      if (typeof r === 'string') toast(r, 'error'); else ready.push(r);
    }
    const images = ready.filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    const r = canvasRef.current?.getBoundingClientRect();
    const pos = position ?? (r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2.6 }) : { x: 0, y: 0 });
    const ids = await uploadFiles(images);
    const occ = liveOccupied();
    const added = ids.map((assetId, i) => {
      const data: GraphNodeData = { kind: 'asset', title: 'Image', assetId };
      const h = estimatedHeight(data);
      const p = findFreePosition({ x: pos.x - NODE_WIDTH / 2 + i * (NODE_WIDTH + 30), y: pos.y }, { width: NODE_WIDTH, height: h }, occ, { gapX: 48, gapY: 56 });
      occ.push({ x: p.x, y: p.y, width: NODE_WIDTH, height: h });
      return addNode(sessionId, data, p);
    });
    if (added.length) selectNodes(added);
  }, [sessionId, rf, liveOccupied]);

  useEffect(() => {
    if (embedded) return;
    const open = () => fileInput.current?.click();
    window.addEventListener('ogs:upload', open);
    return () => window.removeEventListener('ogs:upload', open);
  }, []);

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (!insideRef.current || e.defaultPrevented || (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) {
        // Nodes copied in the app (Ctrl+C / Cut): pasted with their links.
        if (!hasNodeClipboard()) return;
        e.preventDefault();
        const ids = pasteNodes(sessionId);
        if (ids.length) selectNodes(ids);
        return;
      }
      e.preventDefault();
      void importImages(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [importImages, sessionId]);

  // X (no modifier) takes the scissors and gives them back; Escape also leaves them. Not inside text fields.
  useEffect(() => {
    if (embedded) return;
    const key = (e: KeyboardEvent) => {
      if (!insideRef.current || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const k = e.key.toLowerCase();
      if (k === 'x') { e.preventDefault(); pickTool(tool === 'cut' ? lastTool.current : 'cut'); }
      else if (k === 'escape' && tool === 'cut') pickTool(lastTool.current);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Ctrl+C / Ctrl+X copy or cut the selected nodes; Ctrl+G groups them, Ctrl+Shift+G ungroups. Not inside text fields.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!insideRef.current || !(e.ctrlKey || e.metaKey) || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const ids = useStore.getState().sessions[sessionId]?.graph.nodes.filter((n) => selected.has(n.id)).map((n) => n.id) ?? [];
      const k = e.key.toLowerCase();
      if (!ids.length || window.getSelection()?.toString()) return;
      if (k === 'c') { copyNodes(sessionId, ids); toast(`Copied ${ids.length} node${ids.length === 1 ? '' : 's'}`, 'success'); }
      else if (k === 'x') { cutNodes(sessionId, ids); setSelected(new Set()); }
      else if (k === 'g' && e.shiftKey) { const g = wholeGroup(useStore.getState().sessions[sessionId].graph, ids); if (g) ungroup(sessionId, g.id); }
      else if (k === 'g' && ids.length > 1) groupNodes(sessionId, ids);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sessionId, selected]);

  const runIds = useMemo(() => runnableIds(revision.nodes), [revision]);

  const selectedNodes = useMemo(() => selected.size ? revision.nodes.filter(n => selected.has(n.id)) : [], [revision.nodes, selected]);
  const liveSelected = useMemo(() => selectedNodes.map(n => n.id), [selectedNodes]);
  const liveSelectedEdgeSet = useMemo(() => {
    const ids = new Set(graph.edges.map((e) => e.id));
    return new Set([...selectedEdges].filter((id) => ids.has(id)));
  }, [graph.edges, selectedEdges]);

  // Right-click menu, anchored to an invisible point at the cursor.
  const menuAnchor = useRef<HTMLDivElement>(null);
  const connectionMenu = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; from?: string; handle?: string | null } | null>(null);
  const openMenu = (e: React.MouseEvent | MouseEvent, nodeId?: string) => {
    e.preventDefault();
    const r = canvasRef.current?.getBoundingClientRect();
    setMenu({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), nodeId });
  };
  useEffect(() => { setMenu(null); }, [sessionId]);
  const menuSource = menu?.from ? revision.nodes.find((n) => n.id === menu.from) : undefined;
  const menuOutput = useStore(s => menuSource ? outputPort(menuSource.data, s.assets) : null);
  const menuOpen = Boolean(menu) && (!menu?.from || Boolean(menuOutput));
  const menuNode = menu?.nodeId ? graph.nodes.find((n) => n.id === menu.nodeId) : undefined;

  return (
    <div
      ref={canvasRef}
      className={`node-canvas ${omni ? 'is-omni' : ''} ${embedded ? 'is-embedded' : ''}${tool === 'cut' ? ' is-cut-tool' : ''}`}
      onPointerDownCapture={(e) => { cut.down(e); onBoxDown(e); }}
      onMouseDownCapture={(e) => { if (boxing.current || cut.cutting) e.stopPropagation(); }}
      onPointerMoveCapture={(e) => { cut.move(e); onBoxMove(e); }}
      onPointerUpCapture={(e) => { cut.up(e); onBoxUp(e); }}
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
        const data: GraphNodeData = { kind: 'asset', title: 'Asset', assetId };
        addAssetAsNode(sessionId, assetId, freePos({ x: pos.x - NODE_WIDTH / 2, y: pos.y - 40 }, data));
      }}
    >
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg,image/heic,image/heif,.heic,.heif,.eps,application/postscript" multiple hidden onChange={e => {
        const files = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = '';
        void importImages(files, importPosition.current);
      }} />
      {embedded ? null : <TopbarActions>
        <RunAll sessionId={sessionId} ids={runIds} />
      </TopbarActions>}
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        edgeTypes={noticeEdgeTypes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneContextMenu={embedded ? undefined : (e) => openMenu(e)}
        onNodeContextMenu={embedded ? undefined : (e, n) => {
          selectNodes([n.id]);
          openMenu(e, n.id);
        }}
        onConnect={(c) => void tryConnect(sessionId, { source: c.source, target: c.target, targetHandle: c.targetHandle ?? null, sourceHandle: c.sourceHandle })}
        onConnectEnd={(e, state) => {
          if (embedded) return;
          const g = useStore.getState();
          if (reportRefusedDrop(state, g.sessions[sessionId].graph, g.assets, toast)) return;
          const dropped = connectionDrop(e, state, canvasRef.current);
          if (dropped) setMenu(dropped);
        }}
        connectOnClick={false}
        connectionLineStyle={{ stroke: 'var(--text-2)', strokeWidth: 2, strokeDasharray: '6 6' }}
        isValidConnection={isValidConnection}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={NODE_MIN_ZOOM}
        maxZoom={NODE_MAX_ZOOM}
        onBeforeDelete={del.before}
        deleteKeyCode={insideRef.current ? ['Backspace', 'Delete'] : null}
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        panOnScroll
        zoomOnDoubleClick={false}
        selectionMode={SelectionMode.Partial}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: false }}
      >
        {box ? <BoxSelectRect box={box} /> : null}
        {cut.overlay}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--text-4)" />
        {embedded ? null : <CanvasPanels sessionId={sessionId} nodes={selectedNodes} />}
        {embedded ? <EmbeddedControls /> : <><Operations sessionId={sessionId} graph={revision} ids={liveSelected} sizes={measured} onSelect={selectNodes} />
        <CanvasNavigation
          sessionId={sessionId}
          add={<AddNodeMenu onAdd={addAtCenter} onImport={importAtCenter} omni={omniEntries} />}
          onAutoLayout={() => {
            layoutAll(sessionId);
            window.setTimeout(() => void rf.fitView({ padding: 0.2, duration: 300 }), 30);
          }}
          onSelect={id => hidden.has(id) ? jumpToNode(id) : selectNodes([id])}
          tool={tool}
          onTool={pickTool}
          selectedCount={liveSelected.length + liveSelectedEdgeSet.size}
          onDelete={() => del.request(liveSelected, [...liveSelectedEdgeSet])}
          omni={omni}
        /></>}
        <CanvasProblems notices={notices} onJump={jumpToNode} />
        <LinkBar sessionId={sessionId} graph={graph} selected={liveSelectedEdgeSet} />
        {del.card}
      </ReactFlow>
      <div ref={menuAnchor} className="ctx-anchor" style={menu ? { left: menu.x, top: menu.y } : undefined} />
      <Popover open={menuOpen} placement={menu?.from ? 'right-start' : 'top-start'} anchor={menuAnchor} onClose={() => setMenu(null)} width={240} label={menuNode ? 'Node' : 'Add node'}>
        <div ref={connectionMenu}>
        {menu?.from ? <div className="menu-sep-label">Add connected node</div> : null}
        {menuNode ? (
          <NodeContextMenu onDuplicate={() => (duplicateNode(sessionId, menuNode), setMenu(null))} onDelete={() => { del.request([menuNode.id]); setMenu(null); }} />
        ) : menu ? (
          <>
          <AddNodeItems
            searchable={Boolean(menu.from)}
            accepts={menuOutput ?? undefined}
            onImport={menu.from ? undefined : () => {
              const r = canvasRef.current?.getBoundingClientRect();
              importPosition.current = rf.screenToFlowPosition({ x: menu.x + (r?.left ?? 0), y: menu.y + (r?.top ?? 0) });
              fileInput.current?.click();
              setMenu(null);
            }}
            onPick={(data) => {
              const r = canvasRef.current?.getBoundingClientRect();
              const pos = rf.screenToFlowPosition({ x: menu.x + (r?.left ?? 0), y: menu.y + (r?.top ?? 0) });
              // From a dropped connection: the new node lands there, wired to the port that takes the source.
              const id = menu.from ? addConnected(sessionId, menu.from, data, freePos({ x: pos.x, y: pos.y - 40 }, data), menu.handle) : addNode(sessionId, data, freePos(pos, data));
              if (id) selectNodes([id]);
              setMenu(null);
            }}
            onAsset={() => {
              setMenu(null);
              setUi({ panel: 'gallery' });
            }}
          />
          </>
        ) : null}
        </div>
      </Popover>
      {menuOpen && menu?.from ? <ConnectionPreview from={menu.from} menu={connectionMenu} /> : null}
      {embedded || omni ? null : <CanvasChatImport sessionId={sessionId} content={fullRevision.nodes} />}
      {!graph.nodes.length && omni ? null : !graph.nodes.length && embedded ? <p className="node-empty faint">No nodes yet. Ask the agent to build a flow.</p> : !graph.nodes.length ? (
        <NodeEmptyState onAdd={(kind) => addAtCenter(newNodeData(kind))} />
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

/** The node canvas inside Studio's board (the workspace itself is not mounted: no double mounting). */
export function EmbeddedNodeCanvas() {
  const sessionId = useStore((s) => s.activeSessionId);
  return (
    <ReactFlowProvider key={sessionId}>
      <Canvas embedded />
    </ReactFlowProvider>
  );
}

/** The omnicanvas: the same node canvas (select, edit, add from the library), showing the session's parts as nodes. */
export function OmniCanvas() {
  const sessionId = useStore((s) => s.activeSessionId);
  return (
    <ReactFlowProvider key={sessionId}>
      <Canvas omni />
    </ReactFlowProvider>
  );
}

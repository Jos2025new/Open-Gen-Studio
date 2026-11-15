import { useStore } from '../../store/store';
import { canvasIndex } from '../canvas';
import { nodeOutputAsset } from '../flow/graph';
import type { Asset, RefNodeData } from '../types';
import { OMNI_SPACE_TITLES, isOmniSpace, omniOnly } from './omniSpaces';
import type { LiveSystemSummary } from './spec';

/* What a Studio, Nodes or Designer node shows: a snapshot of its Space and its parameters, read where they live. */

const COMPOSER_MODES = ['agent', 'image', 'video', 'audio', 'model3d'];
const STYLES = ['auto', 'guided', 'direct'];
const option = (v: string) => ({ value: v, label: v });
const visual = (a: Asset | undefined): a is Asset => Boolean(a) && (a!.kind === 'image' || a!.kind === 'video');
/** Sketches, masks and 3D view captures are working copies, never a Space's face. */
const listed = (a: Asset) => a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d';

export function omniSpaceLive(sessionId: string, d: RefNodeData): LiveSystemSummary {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  const space = isOmniSpace(d.ref) ? d.ref : 'studio';
  const mine = Object.values(st.assets).filter((a) => a.sessionId === sessionId && listed(a)).sort((a, b) => b.createdAt - a.createdAt);
  const base = { type: 'space' as const, ref: space, title: d.title || OMNI_SPACE_TITLES[space], view: d.view ?? 'thumb' };
  const open = st.ui.workspace === (space === 'studio' ? 'chat' : space === 'nodes' ? 'node' : 'designer');

  if (space === 'studio') {
    const feed = session?.feed ?? [];
    const turns = feed.filter((f) => f.type === 'user').length;
    const results = feed.filter((f) => f.type === 'generation').length;
    const index = session ? canvasIndex(session, st.generations) : undefined;
    const cover = mine.find((a) => visual(a) && index?.asset(a) === 'chat')?.id;
    return {
      ...base,
      subtitle: `${turns} messages · ${results} results`,
      badge: open ? 'Open' : 'Space',
      chips: [`${turns} messages`, `${results} results`],
      details: [],
      cover,
      params: [
        { id: 'mode', label: 'Mode', value: st.composer.mode, options: COMPOSER_MODES.map(option) },
        { id: 'style', label: 'Agent style', value: st.composer.agentStyle, options: STYLES.map(option) },
      ],
    };
  }

  if (space === 'nodes') {
    const graph = session?.graph;
    const own = (graph?.nodes ?? []).filter((n) => !omniOnly(n));
    const ids = new Set(own.map((n) => n.id));
    const links = (graph?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)).length;
    const shown = own
      .map((n) => nodeOutputAsset(n, st.generations))
      .filter((id): id is string => Boolean(id) && visual(st.assets[id as string]))
      .sort((a, b) => st.assets[b].createdAt - st.assets[a].createdAt);
    const xs = own.map((n) => n.position.x), ys = own.map((n) => n.position.y);
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
    const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
    return {
      ...base,
      subtitle: `${own.length} nodes · ${links} links`,
      badge: open ? 'Open' : 'Space',
      chips: [`${own.length} nodes`, `${links} links`],
      details: [],
      cover: shown[0],
      // Without a picture the face is the layout of the nodes, normalized: at most 40 of them.
      map: own.slice(0, 40).map((n) => ({ x: (n.position.x - x0) / w, y: (n.position.y - y0) / h })),
      params: [
        { id: 'nodes', label: 'Nodes', value: String(own.length) },
        { id: 'links', label: 'Links', value: String(links) },
      ],
    };
  }

  const docs = session?.docs ?? [];
  const doc = docs.find((x) => x.id === session?.activeDocId) ?? docs[0];
  return {
    ...base,
    subtitle: doc ? `${doc.name} · ${doc.layers.length} layers` : 'No document yet',
    badge: open ? 'Open' : 'Space',
    chips: doc ? [`${doc.layers.length} layers`, `${doc.width}×${doc.height}`] : ['Empty'],
    details: [],
    cover: mine.find((a) => visual(a) && a.origin === 'design')?.id,
    docName: doc?.name,
    params: [
      { id: 'doc', label: 'Document', value: docs.length > 1 ? doc?.id ?? '' : doc?.name ?? '–', ...(docs.length > 1 ? { options: docs.map((x) => ({ value: x.id, label: x.name || 'Untitled' })) } : {}) },
      { id: 'size', label: 'Size', value: doc ? `${doc.width} × ${doc.height} px` : '–' },
      { id: 'layers', label: 'Layers', value: String(doc?.layers.length ?? 0) },
    ],
  };
}

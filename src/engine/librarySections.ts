import { uid } from '../lib/id';
import { useStore } from '../store/store';
import type { KitKind, KitTokenType } from './libraryTypes';
import { saveItem } from './libraryVersions';
import type { Graph, GraphNode, Subject } from './types';

/* The sections of a brand kit or design system. A section is a label on the elements the entry already keeps:
   images and texts carry `section`; colors, fonts and sizes are its tokens; components its groups; the rest, the entries it contains. */
export type SectionType = 'items' | 'text' | 'tokens' | 'components' | 'kits';
export interface KitSection { title: string; type: SectionType; tokens?: readonly KitTokenType[]; kit?: KitKind; custom?: boolean; }

const COLORS: KitSection = { title: 'Colors', type: 'tokens', tokens: ['color'] };
const FONTS: KitSection = { title: 'Fonts', type: 'tokens', tokens: ['fontFamily'] };
const SIZES: KitSection = { title: 'Sizes', type: 'tokens', tokens: ['dimension', 'number', 'string'] };
const COMPONENTS: KitSection = { title: 'Components', type: 'components' };
const MOODBOARDS: KitSection = { title: 'Moodboards', type: 'kits', kit: 'moodboard' };
const items = (title: string): KitSection => ({ title, type: 'items' });
const text = (title: string): KitSection => ({ title, type: 'text' });
const SECTIONS: Partial<Record<KitKind, readonly KitSection[]>> = {
  'brand-kit': [items('Logos'), COLORS, FONTS, text('Guidelines'), text('Voice'), items('Photos'), COMPONENTS, items('Graphics'), items('Icons'), items('Charts'), SIZES, MOODBOARDS, { title: 'Design systems', type: 'kits', kit: 'design-system' }],
  'design-system': [COMPONENTS, COLORS, FONTS, SIZES, items('Styles'), items('Icons'), items('References'), text('Guidelines'), MOODBOARDS],
};
/** Where elements without a section show. */
const HOME = { 'brand-kit': 'Photos', 'design-system': 'References' } as Record<string, string | undefined>;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const hasSections = (s: Pick<Subject, 'kind'>): boolean => Boolean(SECTIONS[s.kind as KitKind]);

/** Its sections: the usual ones, the categories the user made and any an element names. */
export function kitSections(s: Subject): KitSection[] {
  const out = [...(SECTIONS[s.kind as KitKind] ?? [])];
  for (const title of [...(s.sections ?? []), ...(s.graph?.nodes ?? []).flatMap((n) => n.data.section ?? [])]) {
    if (!out.some((x) => same(x.title, title))) out.push({ title, type: 'items', custom: true });
  }
  return out;
}

const isItem = (n: GraphNode) => n.data.kind === 'asset' || n.data.kind === 'text';
/** The images and texts of a section. */
export function sectionNodes(s: Pick<Subject, 'kind' | 'graph'>, section: Pick<KitSection, 'title'>): GraphNode[] {
  const home = (n: GraphNode) => (n.data.kind === 'text' ? 'Guidelines' : HOME[s.kind ?? ''] ?? '');
  return (s.graph?.nodes ?? []).filter((n) => isItem(n) && same(n.data.section ?? home(n), section.title));
}

const edit = (subjectId: string, graph: (g: Graph) => Graph) =>
  saveItem({ subjectId, mode: 'overwrite', space: 'library', by: 'user', graph: (g) => graph(g ?? { nodes: [], edges: [] }) });
const sectionOf = (subjectId: string, title: string): string => {
  const s = useStore.getState().library.find((x) => x.id === subjectId);
  if (!s || !hasSections(s)) throw new Error(`No brand kit or design system "${subjectId}".`);
  const name = title.trim(), found = kitSections(s).find((x) => same(x.title, name));
  if (!name) throw new Error('The category needs a name.');
  if (found && found.type !== 'items' && found.type !== 'text') throw new Error(`"${found.title}" holds no images or texts.`);
  return found?.title ?? name;
};

/** Adds images and texts to a section; a new name makes a new category. Shared by the page and the agent. */
export async function addToSection(subjectId: string, title: string, add: { assetIds?: readonly string[]; texts?: readonly string[] }, by: 'user' | 'agent' = 'user'): Promise<Subject> {
  const section = sectionOf(subjectId, title), { assets, library } = useStore.getState(), entry = library.find((x) => x.id === subjectId)!;
  const texts = (add.texts ?? []).map((t) => t.trim()).filter(Boolean);
  if (!add.assetIds?.length && !texts.length) throw new Error('Nothing to add.');
  return saveItem({
    subjectId, mode: 'overwrite', space: 'library', by,
    graph: (g) => {
      const has = new Set(sectionNodes({ kind: entry.kind, graph: g }, { title: section }).flatMap((n) => (n.data.kind === 'asset' && n.data.assetId ? [n.data.assetId] : [])));
      const node = (data: GraphNode['data']): GraphNode => ({ id: uid('nd'), position: { x: 0, y: 0 }, data });
      return { ...(g ?? { edges: [] }), nodes: [
        ...(g?.nodes ?? []),
        ...[...new Set(add.assetIds)].filter((id) => !has.has(id)).map((assetId) => node({ kind: 'asset', title: assets[assetId]?.name || 'Image', assetId, section })),
        ...texts.map((t) => node({ kind: 'text', title: section, text: t, section })),
      ] } as Graph;
    },
  });
}

export const moveToSection = (subjectId: string, nodeId: string, title: string) => {
  const section = sectionOf(subjectId, title);
  return edit(subjectId, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, section } } : n)) }));
};
export const setSectionText = (subjectId: string, nodeId: string, value: string) =>
  edit(subjectId, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId && n.data.kind === 'text' ? { ...n, data: { ...n.data, text: value } } : n)) }));
export const removeFromSection = (subjectId: string, nodeId: string) => edit(subjectId, (g) => ({
  ...g, nodes: g.nodes.filter((n) => n.id !== nodeId), edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  ...(g.groups ? { groups: g.groups.map((gr) => ({ ...gr, nodeIds: gr.nodeIds.filter((id) => id !== nodeId) })) } : {}),
}));

/** An empty category: only its name is kept. */
export function addCategory(subjectId: string, title: string): string {
  const name = title.trim(), s = useStore.getState().library.find((x) => x.id === subjectId);
  if (!s || !name) throw new Error('The category needs a name.');
  const found = kitSections(s).find((x) => same(x.title, name));
  if (!found) useStore.setState((st) => ({ library: st.library.map((x) => (x.id === subjectId ? { ...x, sections: [...(x.sections ?? []), name] } : x)) }));
  return found?.title ?? name;
}
/** Removes a category that holds nothing. */
export function removeCategory(subjectId: string, title: string): void {
  useStore.setState((st) => ({ library: st.library.map((x) => (x.id === subjectId ? { ...x, sections: (x.sections ?? []).filter((t) => !same(t, title)) } : x)) }));
}

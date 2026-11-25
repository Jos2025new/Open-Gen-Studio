import { selectSession, setUi, useStore } from '../store/store';
import { getDoc, selectDoc, setActiveLayer } from './design/actions';
import type { Session } from './types';

/* Where each font is used: the Designer documents, of every session, with text in it. */

export interface FontUse { sessionId: string; session: string; docId: string; doc: string; texts: number; layerId: string }

/** The designs of every font, by family; the Studio boards of kits are not designs. */
export function fontUses(sessions: Record<string, Session>): Map<string, FontUse[]> {
  const out = new Map<string, FontUse[]>();
  for (const s of Object.values(sessions)) for (const d of s.docs) {
    if (d.view === 'studio' || d.library?.view === 'studio') continue;
    for (const l of d.layers) {
      if (l.type !== 'text') continue;
      const list = out.get(l.fontFamily) ?? [], last = list.at(-1);
      if (last?.docId === d.id && last.sessionId === s.id) last.texts++;
      else list.push({ sessionId: s.id, session: s.title, docId: d.id, doc: d.name, texts: 1, layerId: l.id });
      out.set(l.fontFamily, list);
    }
  }
  return out;
}

/** Opens that design on its first text in the font. */
export function goToFontUse(use: FontUse): void {
  if (!getDoc(use.sessionId, use.docId)) return;
  if (useStore.getState().activeSessionId !== use.sessionId) selectSession(use.sessionId);
  selectDoc(use.sessionId, use.docId);
  setActiveLayer(use.sessionId, use.docId, use.layerId);
  setUi({ workspace: 'designer', home: false, space: undefined, omni: false, panel: null, lightbox: null });
}

/** The fonts the agent reads: those in Library and those of any design, most used first. */
export function fontList(family?: string) {
  const st = useStore.getState(), uses = fontUses(st.sessions), owned = new Set(st.library.flatMap((s) => (s.fonts ?? []).map((f) => f.family)));
  const fonts = [...new Set([...uses.keys(), ...owned])].filter((f) => !family || f === family)
    .map((f) => ({ f, list: uses.get(f) ?? [] })).sort((a, b) => b.list.length - a.list.length || a.f.localeCompare(b.f));
  const max = family ? 100 : 10;
  return {
    total: fonts.length,
    fonts: fonts.slice(0, 40).map(({ f, list }) => ({
      family: f, inLibrary: owned.has(f), designs: list.length, texts: list.reduce((n, u) => n + u.texts, 0),
      usedIn: list.slice(0, max).map((u) => ({ session: u.sessionId, sessionTitle: u.session.slice(0, 80), doc: u.docId, name: u.doc.slice(0, 80), texts: u.texts })),
    })),
  };
}

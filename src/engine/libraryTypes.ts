import type { Graph } from './graphTypes';

/* Library item kinds (moodboard, design-system, brand-kit) and shared helpers. */
export const KIT_KINDS = {
  moodboard: { tokens: false, kits: false },
  'design-system': { tokens: true, kits: true },
  'brand-kit': { tokens: true, kits: true },
} as const;
export type KitKind = keyof typeof KIT_KINDS;
export const KIT_KIND_LIST = Object.keys(KIT_KINDS) as [KitKind, ...KitKind[]];
export type LibrarySpace = 'studio' | 'designer' | 'nodes' | 'library';
export type KitActor = 'user' | 'agent';

export const TOKEN_TYPES = ['color', 'dimension', 'fontFamily', 'number', 'string'] as const;
export type KitTokenType = (typeof TOKEN_TYPES)[number];
/** `modes`: its value in the modes where it changes (Dark). */
export interface KitToken { type: KitTokenType; value: string | number; description?: string; modes?: Record<string, string | number>; }
export type KitTokens = Record<string, KitToken>;
/** A value taken from a token of an entry. It holds while the value is the one it gave (design/tokenBind.ts). */
export interface TokenRef { kit: string; token: string; value: string | number; }
export interface KitFont { id: string; family: string; weight: number; italic?: boolean; variable?: boolean; name: string; }
export interface KitOrigin { space: LibrarySpace; sessionId?: string; sessionTitle?: string; by: KitActor; from?: string[]; at: number; }
export interface KitVersionRef { id: string; at: number; by: KitActor; space: LibrarySpace; label?: string; assetIds: string[]; docRev?: string; groupIds?: string[]; }

export interface LibraryKitFields {
  graph?: Graph; kits?: string[]; tokens?: KitTokens;
  /** The categories the user made in its page; elements name theirs in `section`. */
  sections?: string[];
  /** Font files of the entry (engine/ownFonts.ts); their bytes are kept apart. */
  fonts?: KitFont[];
  /** Immutable after creation. */
  origin?: KitOrigin; copiedFrom?: string; draft?: boolean;
  versionId?: string; docRev?: string; groupIds?: string[]; versions?: KitVersionRef[];
}

/** Where a document shows its entry's elements: page pixels per graph unit, where graph (0, 0) falls, and per element
    its layer plus the position and text both sides last agreed on. Kept across undo. */
export interface KitBoard { k: number; x: number; y: number; at: Record<string, { layer: string; x: number; y: number; text?: string }>; }
/** The entry version a Nodes group shows, the corner of its elements in the entry, and which element each node is. */
export interface KitGroupLink { subjectId: string; versionId?: string; corner?: { x: number; y: number }; ids?: Record<string, string>; }

export const isKit = <T extends { kind?: string }>(subject: T | null | undefined): boolean =>
  Boolean(subject?.kind && Object.prototype.hasOwnProperty.call(KIT_KINDS, subject.kind));

/** Subjects that can be mentioned as @Name or sent as provider references (never kits or fonts). */
export const mentionableSubjects = <T extends { kind?: string }>(library: readonly T[]): T[] => library.filter((s) => !isKit(s) && s.kind !== 'font');

import type { Graph } from './graphTypes';

/* Library item kinds (moodboard, design-system, brand-kit) and shared helpers. */
export const KIT_KINDS = {
  moodboard: { tokens: false, kits: false, parts: ['color'] },
  'design-system': { tokens: true, kits: false, parts: ['color', 'component', 'style'] },
  'brand-kit': { tokens: true, kits: true, parts: ['color', 'component', 'style'] },
} as const;
export type KitKind = keyof typeof KIT_KINDS;
export const KIT_KIND_LIST = Object.keys(KIT_KINDS) as [KitKind, ...KitKind[]];
export type LibrarySpace = 'studio' | 'designer' | 'nodes' | 'library';
export type KitActor = 'user' | 'agent';

export const TOKEN_TYPES = ['color', 'dimension', 'fontFamily', 'number', 'string'] as const;
export type KitTokenType = (typeof TOKEN_TYPES)[number];
export interface KitToken { type: KitTokenType; value: string | number; description?: string; }
export type KitTokens = Record<string, KitToken>;
export interface KitOrigin { space: LibrarySpace; sessionId?: string; sessionTitle?: string; by: KitActor; from?: string[]; at: number; }
export interface KitVersionRef { id: string; at: number; by: KitActor; space: LibrarySpace; label?: string; assetIds: string[]; docRev?: string; groupIds?: string[]; }

export interface LibraryKitFields {
  graph?: Graph; kits?: string[]; tokens?: KitTokens;
  /** Immutable after creation. */
  origin?: KitOrigin; copiedFrom?: string; draft?: boolean;
  versionId?: string; docRev?: string; groupIds?: string[]; versions?: KitVersionRef[];
}

/** Where a document shows its entry's elements: page pixels per graph unit, where graph (0, 0) falls, and per element
    its layer plus the position and text both sides last agreed on. Kept across undo. */
export interface KitBoard { k: number; x: number; y: number; at: Record<string, { layer: string; x: number; y: number; text?: string }>; }
/** The same for a Nodes group: the element each node is, and what both sides last agreed on. */
export interface KitGroupLink { subjectId: string; origin?: { x: number; y: number }; at?: Record<string, { id: string; x: number; y: number; content: string }>; edges?: string[]; }

export const isKit = <T extends { kind?: string }>(subject: T | null | undefined): boolean =>
  Boolean(subject?.kind && Object.prototype.hasOwnProperty.call(KIT_KINDS, subject.kind));

/** Subjects that can be mentioned as @Name or sent as provider references (never kits). */
export const mentionableSubjects = <T extends { kind?: string }>(library: readonly T[]): T[] => library.filter((s) => !isKit(s));

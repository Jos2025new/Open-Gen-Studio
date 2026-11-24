/* Library kit kinds (moodboard, design-system, brand-kit) and shared helpers. */

export const KIT_KINDS = ['moodboard', 'design-system', 'brand-kit'] as const;
export type KitKind = (typeof KIT_KINDS)[number];
export type LibrarySpace = 'studio' | 'designer' | 'nodes' | 'library';
export type KitActor = 'user' | 'agent';
export type KitPieceKind = 'asset' | 'text' | 'color' | 'kit' | 'component' | 'style';
export type KitStyleType = 'text' | 'color';

export interface KitPiece {
  id: string; kind: KitPieceKind; role?: string; name?: string; description?: string;
  assetId?: string; text?: string; color?: string; kitId?: string;
  groupId?: string; styleType?: KitStyleType; values?: Record<string, string | number>;
}
export interface KitLink { id: string; from: string; to: string; label?: string; }
export const TOKEN_TYPES = ['color', 'dimension', 'fontFamily', 'number', 'string'] as const;
export type KitTokenType = (typeof TOKEN_TYPES)[number];
export interface KitToken { type: KitTokenType; value: string | number; description?: string; }
export type KitTokens = Record<string, KitToken>;
export interface KitOrigin { space: LibrarySpace; sessionId?: string; sessionTitle?: string; by: KitActor; from?: string[]; at: number; }
export interface KitVersionRef { id: string; at: number; by: KitActor; space: LibrarySpace; label?: string; assetIds: string[]; docRev?: string; groupIds?: string[]; }

export interface LibraryKitFields {
  pieces?: KitPiece[];
  links?: KitLink[];
  tokens?: KitTokens;
  /** Immutable after creation. */
  origin?: KitOrigin;
  copiedFrom?: string;
  draft?: boolean;
  versionId?: string;
  docRev?: string;
  groupIds?: string[];
  versions?: KitVersionRef[];
}

export function isKit<T extends { kind?: string }>(subject: T | null | undefined): boolean {
  return Boolean(subject?.kind && (KIT_KINDS as readonly string[]).includes(subject.kind));
}

/** Subjects that can be mentioned as @Name or sent as provider references (never kits). */
export function mentionableSubjects<T extends { kind?: string }>(library: readonly T[]): T[] {
  return library.filter((s) => !isKit(s));
}

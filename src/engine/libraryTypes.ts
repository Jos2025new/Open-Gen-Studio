/* Library kit kinds (moodboard, design-system, brand-kit) and shared helpers. */

export const KIT_KINDS = ['moodboard', 'design-system', 'brand-kit'] as const;
export type KitKind = (typeof KIT_KINDS)[number];
export type LibrarySpace = 'studio' | 'designer' | 'nodes' | 'library';
export type KitActor = 'user' | 'agent';
export type KitPieceKind = 'asset' | 'text' | 'color' | 'kit';

export interface KitPiece { id: string; kind: KitPieceKind; role?: string; assetId?: string; text?: string; color?: string; kitId?: string; }
export interface KitLink { id: string; from: string; to: string; label?: string; }
export interface KitTokens {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, number | string>;
  radii?: Record<string, number | string>;
}
export interface KitOrigin { space: LibrarySpace; sessionId?: string; sessionTitle?: string; by: KitActor; from?: string[]; at: number; }
export interface KitVersionRef { id: string; at: number; by: KitActor; space: LibrarySpace; label?: string; assetIds: string[]; docRev?: string; }

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
  versions?: KitVersionRef[];
}

export function isKit<T extends { kind?: string }>(subject: T | null | undefined): boolean {
  return Boolean(subject?.kind && (KIT_KINDS as readonly string[]).includes(subject.kind));
}

/** Subjects that can be mentioned as @Name or sent as provider references (never kits). */
export function mentionableSubjects<T extends { kind?: string }>(library: readonly T[]): T[] {
  return library.filter((s) => !isKit(s));
}

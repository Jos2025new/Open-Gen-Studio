import { Box, FileText, Film, Image as ImageIcon, Music } from 'lucide-react';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import type { Generation } from '../../engine/types';
import { generationTitle } from '../assets/GenerationInfo';

/** Filter, sort and status vocabulary shared by the Generations drawer and the Create space's board. */
export type Sort = 'newest' | 'oldest' | 'cost';
export type Kind = 'all' | Generation['kind'];
export type Status = 'all' | 'done' | 'error' | 'running';

export const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'model3d', label: '3D' },
  { id: 'text', label: 'Text' },
];
export const STATUSES: Array<{ id: Status; label: string }> = [
  { id: 'all', label: 'Any status' },
  { id: 'done', label: 'Done' },
  { id: 'error', label: 'Failed' },
  { id: 'running', label: 'Running' },
];
export const KIND_ICON = { image: ImageIcon, video: Film, audio: Music, model3d: Box, text: FileText } as const;
export const STATUS_LABEL: Record<Generation['status'], string> = { done: 'Done', running: 'Generating', queued: 'Queued', error: 'Failed', canceled: 'Canceled', review: 'Needs review' };
export const statusOf = (g: Generation): Status => (g.status === 'done' ? 'done' : g.status === 'error' || g.status === 'canceled' ? 'error' : 'running');

export interface GenerationQuery { kind: Kind; status: Status; q: string; sort: Sort }

/** Filter by type, status and text, then order by date or cost. */
export function filterGenerations(list: Generation[], { kind, status, q, sort }: GenerationQuery): Generation[] {
  const needle = q.trim().toLowerCase();
  const cost = (g: Generation) => g.actualUsd ?? g.estimate.usd;
  return list
    .filter((g) => kind === 'all' || g.kind === kind)
    .filter((g) => status === 'all' || statusOf(g) === status)
    .filter((g) => !needle || `${generationTitle(g)} ${g.modelName} ${PROVIDER_LABELS[g.provider]}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'cost') {
        const ac = cost(a), bc = cost(b);
        if (ac == null && bc != null) return 1;
        if (bc == null && ac != null) return -1;
        if (ac != null && bc != null && ac !== bc) return bc - ac;
      }
      return sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });
}

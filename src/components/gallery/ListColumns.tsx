import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Asset, Generation } from '../../engine/types';
import { formatDuration } from '../../lib/format';
import type { SortKey } from '../ui/PanelControls';

/** The list view's columns beyond the name: each one sorts from its header. */
export type ColumnKey = 'model' | 'aspect' | 'resolution' | 'duration';
export type ListSortKey = SortKey | ColumnKey;
export interface ListSort { by: ListSortKey; asc: boolean }

export interface ColumnValues { model: string; aspect: string; resolution: string; duration: string; ratio: number; seconds: number }

/** What a result shows in each column: the model and the parameters its generation recorded. */
export function columnValues(asset: Asset | undefined, g: Generation | undefined): ColumnValues {
  const seconds = g?.settings.duration ?? asset?.duration ?? 0;
  const size = asset && asset.width > 0 && asset.height > 0 ? `${asset.width} × ${asset.height}` : '';
  const aspect = g?.settings.aspect ?? '';
  const [w, h] = aspect.split(':').map(Number);
  return {
    model: g?.modelName ?? '',
    aspect,
    resolution: g?.settings.resolution ?? size,
    duration: seconds ? formatDuration(seconds * 1000) : '',
    ratio: w > 0 && h > 0 ? w / h : asset && asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 0,
    seconds,
  };
}

/** Orders two results by a column; empty values always go last, whatever the direction. */
export function compareColumn(by: ColumnKey, asc: boolean, a: ColumnValues, b: ColumnValues): number {
  const dir = asc ? 1 : -1;
  if (by === 'duration' || by === 'aspect') {
    const x = by === 'duration' ? a.seconds : a.ratio;
    const y = by === 'duration' ? b.seconds : b.ratio;
    return !x !== !y ? (x ? -1 : 1) : dir * (x - y);
  }
  const x = a[by];
  const y = b[by];
  return !x !== !y ? (x ? -1 : 1) : dir * x.localeCompare(y, undefined, { numeric: true });
}

export const ColumnCells = ({ v }: { v: ColumnValues }) => <>
  <span className="pc-col pc-col-model" title={v.model}>{v.model || '—'}</span>
  <span className="pc-col pc-col-aspect num">{v.aspect || '—'}</span>
  <span className="pc-col pc-col-resolution num">{v.resolution || '—'}</span>
  <span className="pc-col pc-col-duration num">{v.duration || '—'}</span>
</>;

const HEADS: Array<{ by: ListSortKey; label: string; className: string }> = [
  { by: 'name', label: 'Name', className: 'pc-col-name' },
  { by: 'model', label: 'Model', className: 'pc-col pc-col-model' },
  { by: 'aspect', label: 'Aspect', className: 'pc-col pc-col-aspect' },
  { by: 'resolution', label: 'Resolution', className: 'pc-col pc-col-resolution' },
  { by: 'duration', label: 'Duration', className: 'pc-col pc-col-duration' },
  { by: 'date', label: 'Date', className: 'pc-col pc-col-date' },
];

/** The list header: pressing a column sorts by it; pressing it again flips the direction. Dates start newest first. */
export function ListHeader({ sort, onSort }: { sort: ListSort; onSort: (s: ListSort) => void }) {
  return <div className="pc-list-head" role="group" aria-label="Sort by column">
    {HEADS.map((h) => {
      const on = sort.by === h.by;
      const Arrow = sort.asc ? ArrowUp : ArrowDown;
      return <button key={h.by} type="button" className={`${h.className}${on ? ' is-on' : ''}`} aria-pressed={on}
        aria-label={`Sort by ${h.label}${on ? (sort.asc ? ', ascending' : ', descending') : ''}`}
        onClick={() => onSort(on ? { by: h.by, asc: !sort.asc } : { by: h.by, asc: h.by !== 'date' })}>
        {h.label}{on ? <Arrow size={11} /> : null}
      </button>;
    })}
    <span className="pc-col-tools" aria-hidden="true" />
  </div>;
}

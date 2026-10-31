import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
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

/** A column of the sort row: `width` columns can be resized from their header edge; the first one (Name) takes what is left. */
export interface HeadDef<K extends string = string> { by: K; label: string; width?: boolean }
/** Widths by column key, stored as CSS variables `--pc-w-<key>` on the list's scroll container (`data-col-scope`). */
export type ColumnWidths = Partial<Record<string, number>>;
const MIN_W = 44;
const MAX_W = 420;
const clampW = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
const widthVar = (k: string) => `--pc-w-${k}`;
/** The stored widths as CSS variables for the list container (defaults live in the panel's CSS). */
export const widthVars = (w: ColumnWidths): CSSProperties => Object.fromEntries(Object.keys(w).filter((k) => w[k]).map((k) => [widthVar(k), `${w[k]}px`])) as CSSProperties;

/** Library's columns. */
export const LIBRARY_HEADS: HeadDef<ListSortKey>[] = [
  { by: 'name', label: 'Name' },
  { by: 'model', label: 'Model', width: true },
  { by: 'aspect', label: 'Aspect', width: true },
  { by: 'resolution', label: 'Resolution', width: true },
  { by: 'duration', label: 'Duration', width: true },
  { by: 'date', label: 'Date', width: true },
];

/** The handle on a column's left edge: drag it (or use ←/→) to resize; double-click restores the default. While
 *  dragging only the CSS variable on the list changes, so rows do not re-render; the width is stored on release. */
function ResizeHandle({ k, label, widths, onResize }: { k: string; label: string; widths: ColumnWidths; onResize: (w: ColumnWidths) => void }) {
  const cellWidth = (el: Element) => el.parentElement?.getBoundingClientRect().width ?? MIN_W;
  const apply = (el: Element, w: number) => (el.closest('[data-col-scope]') as HTMLElement | null)?.style.setProperty(widthVar(k), `${w}px`);
  const down = (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const w0 = cellWidth(el);
    let w = w0;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev: globalThis.PointerEvent) => { w = clampW(w0 + x0 - ev.clientX); apply(el, w); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      if (w !== w0) onResize({ ...widths, [k]: w });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const key = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.key === 'ArrowLeft' ? 8 : e.key === 'ArrowRight' ? -8 : 0;
    if (!step) return;
    e.preventDefault();
    onResize({ ...widths, [k]: clampW((widths[k] ?? cellWidth(e.currentTarget)) + step) });
  };
  const reset = () => { const next = { ...widths }; delete next[k]; onResize(next); };
  return <span className="pc-col-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${label} column`} tabIndex={0}
    aria-valuemin={MIN_W} aria-valuemax={MAX_W} aria-valuenow={widths[k]} onPointerDown={down} onKeyDown={key} onDoubleClick={reset} />;
}

/** The list header: pressing a column sorts by it; pressing it again flips the direction. Dates start newest first.
 *  `strip` is the same set for the card grid: one compact row of sort labels, without column widths.
 *  `end` sits at the opposite end of the row (the show-hidden and show-archived toggles). */
export function ListHeader<K extends string>({ heads, sort, onSort, widths, onResize, strip, end }: { heads: HeadDef<K>[]; sort: { by: K; asc: boolean }; onSort: (s: { by: K; asc: boolean }) => void; widths?: ColumnWidths; onResize?: (w: ColumnWidths) => void; strip?: boolean; end?: ReactNode }) {
  return <div className={strip ? 'pc-sort-strip' : 'pc-list-head'} role="group" aria-label="Sort by column">
    {heads.map((h, i) => {
      const on = sort.by === h.by;
      const Arrow = sort.asc ? ArrowUp : ArrowDown;
      const cls = i === 0 ? 'pc-col-name' : `pc-col pc-col-${h.by}`;
      return <span key={h.by} className={strip ? 'pc-head-cell' : `pc-head-cell ${cls}`}>
        {h.width && widths && onResize && !strip ? <ResizeHandle k={h.by} label={h.label} widths={widths} onResize={onResize} /> : null}
        <button type="button" className={on ? 'is-on' : undefined} aria-pressed={on}
          aria-label={`Sort by ${h.label}${on ? (sort.asc ? ', ascending' : ', descending') : ''}`}
          onClick={() => onSort(on ? { by: h.by, asc: !sort.asc } : { by: h.by, asc: h.by !== 'date' })}>
          {h.label}{on ? <Arrow size={11} /> : null}
        </button>
      </span>;
    })}
    <span className="pc-col-tools pc-strip-end">{end}</span>
  </div>;
}

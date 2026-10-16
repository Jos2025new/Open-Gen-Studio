import { KIND_ICON } from '../shell/generationsView';
import type { AssetKind } from '../../engine/types';

/** A tinted icon of the asset's kind behind its picture: what shows while the file is loading or missing. The parent must be positioned. */
export function KindBackdrop({ kind = 'image', size = 26 }: { kind?: AssetKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <span className={`kind-backdrop is-${kind}`} aria-hidden><Icon size={size} strokeWidth={1.5} /></span>;
}

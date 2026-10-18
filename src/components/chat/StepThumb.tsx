import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';

const MAX_SHOWN = 3;

/**
 * The thumbnails of one plan step: the app's own pending placeholder (the shimmer tile of a running generation) for every
 * result still to come, and the real media as soon as the generation stores it. One slot per result the step asks for
 * (up to four, then "+n"), so the count beside the step is the number of thumbnails.
 */
export function StepThumb({ genId, count }: { genId?: string; count: number }) {
  const assetIds = useStore((s) => (genId ? s.generations[genId]?.assetIds : undefined));
  const failed = useStore((s) => (genId ? s.generations[genId]?.status === 'error' : false));
  const total = Math.max(1, count, assetIds?.length ?? 0);
  const shown = Math.min(MAX_SHOWN, total);
  return (
    <span className="cc-thumbs" data-slots={shown}>
      {Array.from({ length: shown }, (_, i) => {
        const id = assetIds?.[i];
        const size = shown === 1 ? 40 : 30;
        const style = { zIndex: shown - i, width: size, height: size, left: shown === 1 ? 0 : (i * (40 - size)) / (shown - 1), top: shown === 1 ? 0 : (i * (40 - size)) / (shown - 1) } as const;
        return id ? (
          <button key={`a${id}`} type="button" className="cc-thumb" data-thumb={id} style={style} aria-label="Open result" onClick={() => setUi({ lightbox: { assetIds: assetIds ?? [], index: i } })}>
            <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
          </button>
        ) : (
          <span key={`p${i}`} className={`cc-thumb tile-pending${failed ? ' is-failed' : ''}`} data-pending="" style={style}><span className="shimmer" /></span>
        );
      })}
      {total > shown ? <span className="cc-thumb-more num">+{total - shown}</span> : null}
    </span>
  );
}

/** One result's thumbnail (running rows): the pending placeholder until that result exists, then the real media, live. */
export function ResultThumb({ genId, index }: { genId?: string; index: number }) {
  const id = useStore((s) => (genId ? s.generations[genId]?.assetIds[index] : undefined));
  const failed = useStore((s) => (genId ? s.generations[genId]?.status === 'error' : false));
  return id ? (
    <button type="button" className="cc-rthumb" data-thumb={id} aria-label="Open result" onClick={() => setUi({ lightbox: { assetIds: useStore.getState().generations[genId!]?.assetIds ?? [id], index } })}>
      <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
    </button>
  ) : (
    <span className={`cc-rthumb tile-pending${failed ? ' is-failed' : ''}`} data-pending=""><span className="shimmer" /></span>
  );
}

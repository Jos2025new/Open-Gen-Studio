import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';

const MAX_SHOWN = 4;

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
        const style = { zIndex: shown - i, marginLeft: i === 0 ? 0 : -14 } as const;
        return id ? (
          <button key={`a${id}`} type="button" className="cc-thumb" data-thumb={id} style={style} aria-label="Open result" onClick={() => setUi({ lightbox: { assetIds: assetIds ?? [], index: i } })}>
            <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
          </button>
        ) : (
          <span key={`p${i}`} className={`cc-thumb tile-pending${failed ? ' is-failed' : ''}`} data-pending="" style={style}><span className="shimmer" /></span>
        );
      })}
      {total > shown ? <span className="cc-thumb-more num faint">+{total - shown}</span> : null}
    </span>
  );
}

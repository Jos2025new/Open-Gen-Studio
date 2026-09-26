import { useRef, useState } from 'react';
import { AudioLines, ImageOff, Box } from 'lucide-react';
import { useStore } from '../../store/store';
import { formatDuration } from '../../lib/format';
import { useAssetUrl } from './hooks';

/** Renders an asset (image or video) from local storage or its remote URL. */
export function AssetMedia({
  assetId,
  fit = 'cover',
  controls = false,
  hoverPlay = true,
  className,
  draggable = true,
}: {
  assetId: string;
  fit?: 'cover' | 'contain';
  controls?: boolean;
  hoverPlay?: boolean;
  className?: string;
  draggable?: boolean;
}) {
  const asset = useStore((s) => s.assets[assetId]);
  const url = useAssetUrl(asset?.kind === 'model3d' ? null : assetId);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  if (!asset) {
    return (
      <div className={`media media-missing ${className ?? ''}`}>
        <ImageOff size={18} />
        <span>Deleted</span>
      </div>
    );
  }
  if (asset.kind === 'model3d') return <div className={`media media-audio ${className ?? ''}`} draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData('application/x-ogs-asset', assetId); e.dataTransfer.effectAllowed = 'copy'; }}>
    {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="3D preview" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} /> : <Box size={32} />}<span>3D</span>
  </div>;
  if (!url || failed) {
    return (
      <div className={`media media-loading ${failed ? 'is-failed' : ''} ${className ?? ''}`} style={{ aspectRatio: asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1' }}>
        {failed ? <ImageOff size={18} /> : null}
      </div>
    );
  }
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-ogs-asset', assetId);
    e.dataTransfer.effectAllowed = 'copy';
  };
  if (asset.kind === 'audio') {
    // Audio has no picture: an icon tile with its length, and the player where controls are wanted.
    return (
      <div className={`media media-audio ${className ?? ''}`} draggable={draggable} onDragStart={onDragStart}>
        <AudioLines size={controls ? 28 : 18} />
        {asset.duration ? <span className="num">{formatDuration(asset.duration * 1000)}</span> : null}
        {controls ? <audio src={url} controls autoPlay onError={() => setFailed(true)} /> : null}
      </div>
    );
  }
  if (asset.kind === 'video') {
    return (
      <video
        ref={videoRef}
        className={`media media-${fit} ${className ?? ''}`}
        src={url}
        muted={!controls}
        loop
        playsInline
        preload="metadata"
        controls={controls}
        autoPlay={controls}
        draggable={draggable}
        onDragStart={onDragStart}
        onError={() => setFailed(true)}
        onMouseEnter={hoverPlay && !controls ? () => void videoRef.current?.play().catch(() => undefined) : undefined}
        onMouseLeave={
          hoverPlay && !controls
            ? () => {
                const v = videoRef.current;
                if (v) {
                  v.pause();
                  v.currentTime = 0;
                }
              }
            : undefined
        }
      />
    );
  }
  return (
    <img
      className={`media media-${fit} ${className ?? ''}`}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={draggable}
      onDragStart={onDragStart}
      onError={() => setFailed(true)}
    />
  );
}

import { Film, Image as ImageIcon, Type } from '../ui/icons';
import { Button } from '../ui/primitives';

/** Empty node canvas: a hint and three quick starters. */
export function NodeEmptyState({ onAdd }: { onAdd: (kind: 'text' | 'image' | 'video') => void }) {
  return (
    <div className="node-empty">
      <h2>Build a flow</h2>
      <p className="faint">Ask the agent in the composer — it creates, connects and lays out the nodes — or add them yourself.</p>
      <div className="node-empty-actions">
        <Button size="sm" icon={Type} onClick={() => onAdd('text')}>
          Text
        </Button>
        <Button size="sm" icon={ImageIcon} onClick={() => onAdd('image')}>
          Image
        </Button>
        <Button size="sm" icon={Film} onClick={() => onAdd('video')}>
          Video
        </Button>
      </div>
    </div>
  );
}

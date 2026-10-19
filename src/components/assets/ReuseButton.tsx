import type { Generation } from '../../engine/types';
import { canReuse, reuseGeneration } from '../../store/reuse';
import { useStore } from '../../store/store';
import './reuse-button.css';
import { Button } from '../ui/primitives';

export function ReuseButton({ g }: { g?: Generation }) {
  useStore((s) => s.assets);
  useStore((s) => s.catalog.models);
  return g && canReuse(g) ? <Button className="reuse-button" size="sm" variant="ghost" onClick={() => void reuseGeneration(g)}>Reusar</Button> : null;
}

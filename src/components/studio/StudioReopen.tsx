import { PanelRight } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { setStudioBoard, useStudioBoard } from '../../lib/studioBoard';

/** Composer toggle for Studio's generations board: opens it when closed, closes it when open. */
export function StudioReopen() {
  const { open } = useStudioBoard();
  const label = open ? 'Hide generations' : 'Show generations';
  return <IconButton icon={PanelRight} label={label} size="sm" active={open} aria-pressed={open} className="studio-reopen-btn" onClick={() => setStudioBoard({ open: !open })} />;
}

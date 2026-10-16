import { PanelRight } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { setStudioBoard } from '../../lib/studioBoard';

/** Composer control that reopens Studio's closed generations board. */
export function StudioReopen() {
  return <IconButton icon={PanelRight} label="Show generations" size="sm" className="studio-reopen-btn" onClick={() => setStudioBoard({ open: true })} />;
}

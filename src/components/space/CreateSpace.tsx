import { useStore } from '../../store/store';
import { SpaceFrame } from './SpaceFrame';
import { SpacePanel } from './SpacePanel';
import { SpaceBoard } from './SpaceBoard';

/** Create Media: the Space Panel (controls) on the left, the Space Board (results) on the right. */
export function CreateSpace() {
  const mode = useStore((s) => s.composer.mode);
  return <SpaceFrame label="Create Media" panel={<SpacePanel />} board={<SpaceBoard kind={mode === 'agent' ? 'image' : mode} empty="Nothing generated yet. Describe something and press Generate." />} />;
}

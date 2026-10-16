import type { Generation } from '../../engine/types';
import { cancelGeneration } from '../../engine/jobs';
import { formatUsd } from '../../lib/format';
import { Popover, usePopover } from '../ui/Popover';
import { Button } from '../ui/primitives';

/** "Dejar de seguir" for a submitted job: the provider keeps going and charges it, so this only stops following it here. Shared by the full card and Studio's compact row. */
export function StopFollowingPopover({ g, pop }: { g: Generation; pop: ReturnType<typeof usePopover> }) {
  return (
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Dejar de seguir">
      <div className="confirm">
        <p>
          {`${g.remoteJob?.provider ?? 'The provider'} keeps generating this and will charge the estimate (${formatUsd(g.estimate.usd)}). Stopping only stops following it here; Check status can pick it up again.`}
        </p>
        <div className="spend-actions">
          <Button variant="ghost" onClick={pop.close}>
            Keep following
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              pop.close();
              cancelGeneration(g.id);
            }}
          >
            Dejar de seguir
          </Button>
        </div>
      </div>
    </Popover>
  );
}

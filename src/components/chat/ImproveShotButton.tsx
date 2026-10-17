import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { improveEstimate, improvePlan, improveShot } from '../../engine/improveShot';
import type { Estimate, Generation } from '../../engine/types';
import { Popover, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';

/** «Mejorar esta toma» en un borrador de video: mismo prompt y semilla en 1080p, o el reescalador; coste confirmado con cancelación. */
export function ImproveShotButton({ g }: { g: Generation }) {
  const plan = improvePlan(g);
  const pop = usePopover();
  const [estimate, setEstimate] = useState<Estimate>({ usd: null, approximate: true });
  useEffect(() => {
    if (!pop.open || !plan) return;
    let alive = true;
    void improveEstimate(g, plan).then((e) => alive && setEstimate(e), () => alive && setEstimate({ usd: null, approximate: true, note: 'Sin precio disponible' }));
    return () => { alive = false; };
  }, [pop.open, g.id, plan?.mode]);
  if (!plan) return null;
  return (
    <>
      <IconButton ref={pop.ref} icon={Sparkles} label="Mejorar esta toma" size="sm" active={pop.open} onClick={pop.toggle} />
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Mejorar esta toma">
        <SpendConfirm
          title="Mejorar esta toma"
          lines={[plan.mode === 'rerender' ? `Mismo prompt y semilla en ${plan.resolution}.` : 'Este modelo no llega a 1080p: el clip pasa por el reescalador de video.']}
          estimate={estimate}
          confirmLabel="Mejorar"
          onConfirm={() => { pop.close(); void improveShot(g.id); }}
          onCancel={pop.close}
        />
      </Popover>
    </>
  );
}

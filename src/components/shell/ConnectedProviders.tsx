import { Check, ChevronDown, KeyRound, Plus } from 'lucide-react';
import type { RemoteProviderId } from '../../engine/types';
import { REMOTE_PROVIDERS } from '../../engine/providers/registry';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { Button, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { ProviderRow } from './SettingsPanel';
import './ConnectedProviders.css';

/** Connect one provider here using the same key field and save path as Settings. */
export function ConnectedProviders({ providers, onAdd }: { providers: RemoteProviderId[]; onAdd: (provider: RemoteProviderId) => void }) {
  const chooser = usePopover();
  return <div className="pool-details provider-connections">
      <Button ref={chooser.ref} size="sm" variant="ghost" className="provider-add" aria-haspopup="menu" aria-expanded={chooser.open} onClick={chooser.toggle}>
        <span className="provider-add-mark"><Plus size={12} /></span> Add provider <KeyRound size={13} /><ChevronDown size={12} />
      </Button>
      <Popover open={chooser.open} anchor={chooser.ref} onClose={chooser.close} width={140} label="Choose providers" placement="bottom-start" className="provider-chooser-popover">
        <div className="menu" role="menu">
          {REMOTE_PROVIDERS.map((p) => <MenuItem key={p} label={PROVIDER_LABELS[p]} disabled={providers.includes(p)} right={providers.includes(p) ? <Check size={13} /> : undefined} onClick={() => { onAdd(p); chooser.close(); }} />)}
        </div>
      </Popover>
      {!!providers.length && <div className="settings">
        <section className="set-section">{providers.map((p) => <ProviderRow key={p} id={p} autoFocus />)}</section>
      </div>}
  </div>;
}

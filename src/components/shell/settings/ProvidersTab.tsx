import { useEffect, useState } from 'react';
import { Bell, BellRing, Eye, EyeOff, ExternalLink, KeyRound, PanelTop } from 'lucide-react';
import { askNotifyPermission } from '../../../lib/doneNotice';
import { loadCatalogs, loadLlmCatalog } from '../../../engine/catalog';
import { PROVIDER_SITES, REMOTE_PROVIDERS } from '../../../engine/providers/registry';
import { PROVIDER_LABELS } from '../../../engine/providers/types';
import type { RemoteProviderId } from '../../../engine/types';
import { setCatalog, setSettings, toast, useStore } from '../../../store/store';
import { Segmented, Toggle } from '../../ui/primitives';
import { SetGroup, SetRow } from './SettingsRows';

export function ProviderRow({ id, autoFocus = false }: { id: RemoteProviderId; autoFocus?: boolean }) {
  const saved = useStore((s) => s.settings.keys[id]);
  const status = useStore((s) => s.catalog.status[id]);
  const error = useStore((s) => s.catalog.errors[id]);
  const count = useStore((s) => Object.values(s.catalog.models).filter((m) => m.provider === id).length);
  const [value, setValue] = useState(saved);
  const [show, setShow] = useState(false);
  useEffect(() => setValue(saved), [saved]);

  const commit = () => {
    const v = value.trim();
    if (v === saved) return;
    const wasConnected = Boolean(saved);
    setSettings((s) => ({ keys: { ...s.keys, [id]: v } }));
    // Schemas may include prices that depend on the key.
    setCatalog((c) => ({ schemas: Object.fromEntries(Object.entries(c.schemas).filter(([ref]) => !ref.startsWith(`${id}::`))) }));
    void loadCatalogs({ force: true, preferRemote: Boolean(v) && !wasConnected });
    if (v && (id === 'openrouter' || id === 'nanogpt' || id === 'atlas')) void loadLlmCatalog(id);
    toast(v ? `${PROVIDER_LABELS[id]} key saved` : `${PROVIDER_LABELS[id]} disconnected`, 'success');
  };

  const dot = !saved ? 'off' : status === 'ready' ? 'ready' : status === 'error' ? 'error' : 'busy';
  return (
    <div className="prov-row">
      <div className="prov-head">
        <span className={`dot dot-${dot}`} />
        <span className="prov-name">{PROVIDER_LABELS[id]}</span>
        <span className="prov-status faint">
          {!saved ? 'Not connected' : status === 'ready' ? `Connected · ${count} models` : status === 'error' ? 'Catalog error' : 'Loading models…'}
        </span>
        <a className="prov-link" href={PROVIDER_SITES[id].keys} target="_blank" rel="noreferrer" data-tip="Get an API key">
          <ExternalLink size={13} />
        </a>
      </div>
      <div className="key-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder="API key"
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label={`${PROVIDER_LABELS[id]} API key`}
        />
        <button type="button" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {saved && status === 'error' ? <div className="prov-error">{error}</div> : null}
    </div>
  );
}

/** Settings → Providers: notices when a run finishes, then one key field per provider. */
export function ProvidersTab() {
  const settings = useStore((s) => s.settings);
  return <>
    <SetGroup icon={Bell} title="Notifications">
      <SetRow icon={BellRing} label="Notify when done" tip="When a generation finishes while this tab is in the background, show a browser notification.">
        <Segmented
          value={settings.notify ? 'on' : 'off'}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(v) => {
            if (v === 'off') return setSettings({ notify: false });
            void askNotifyPermission().then((granted) => setSettings({ notify: granted }));
          }}
          size="sm"
        />
      </SetRow>
      <SetRow icon={PanelTop} label="Notice when a generation finishes" tip="When a generation finishes, show a short notice. While this tab is in the background, its title also shows the result and how many finished until you come back.">
        <Toggle checked={settings.notifications.tabTitle} onChange={(v) => setSettings({ notifications: { ...settings.notifications, tabTitle: v } })} label="Notice when a generation finishes" />
      </SetRow>
    </SetGroup>
    <SetGroup icon={KeyRound} title="API keys">
      {REMOTE_PROVIDERS.map((p) => <ProviderRow key={p} id={p} />)}
    </SetGroup>
  </>;
}

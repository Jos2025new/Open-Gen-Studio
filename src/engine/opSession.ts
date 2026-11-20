import { sendSessionId, ensureSendSession } from '../store/spaceSession';
import { useStore } from '../store/store';

/** Resolve without creating a Space session until the user starts an operation. */
export function opSessionId(assetId: string, create = false): string {
  const st = useStore.getState();
  const asset = st.assets[assetId];
  if (st.ui.space) return create ? ensureSendSession() : sendSessionId(st);
  return asset?.sessionId && st.sessions[asset.sessionId] ? asset.sessionId : st.activeSessionId;
}

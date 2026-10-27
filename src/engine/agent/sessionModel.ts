import type { SettingsChoice } from '../types';
import { lineRoutes, pickComposerModel } from '../catalog';
import { patchSession, useStore } from '../../store/store';

type Kind = 'image' | 'video';

/** Remember an explicit model choice for one session; optionally make it the composer's next default. */
export function rememberSessionModel(sessionId: string, kind: Kind, choice: SettingsChoice, explicit = false): void {
  if (!useStore.getState().sessions[sessionId]) return;
  choice = { ...choice, modelRef: lineRoutes(choice.modelRef).text ?? choice.modelRef };
  patchSession(sessionId, (session) => ({
    ...session,
    agent: { ...session.agent, settings: { ...session.agent.settings, [kind]: choice } },
  }));

  if (explicit && useStore.getState().settings.agent.updateComposerDefaults) void applyComposerChoice(kind, choice);
}

/** Make the model remembered by a session the next composer defaults. */
export async function setSessionModelAsDefault(sessionId: string, kind: Kind): Promise<void> {
  const choice = useStore.getState().sessions[sessionId]?.agent.settings?.[kind];
  if (!choice) return;
  await applyComposerChoice(kind, choice);
}

function applyComposerChoice(kind: Kind, choice: SettingsChoice): Promise<void> {
  return pickComposerModel(kind, choice.modelRef, false);
}

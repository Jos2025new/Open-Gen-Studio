import type { Estimate, GenSettings, StepAuthorization } from './types';

export function costAuthorization(modelRef: string, settings: GenSettings, estimate: Estimate): StepAuthorization {
  return {
    modelRef,
    parameters: {
      count: settings.count, aspect: settings.aspect, resolution: settings.resolution,
      duration: settings.duration, audio: settings.audio,
      advanced: { ...settings.advanced },
      ...(settings.shots?.length ? { shotDurations: settings.shots.map(s => s.duration) } : {}),
    },
    estimate: { ...estimate },
  };
}

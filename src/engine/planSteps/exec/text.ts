import { costAuthorization } from '../../priceAuthorization';
import type { EstimateStep, RunStep } from './env';

export const runText: RunStep<'text'> = async (s) => ({ assetIds: [], text: s.text });

export const estimateText: EstimateStep<'text'> = (s) => {
  const estimate = { usd: 0, approximate: false };
  return { estimate, authorization: costAuthorization(`local::${s.kind}`, { count: 1, advanced: {} }, estimate) };
};

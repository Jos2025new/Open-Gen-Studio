import { applyLayerStep } from '../../design/actions';
import { costAuthorization } from '../../priceAuthorization';
import type { EstimateStep, RunStep } from './env';

export const runLayer: RunStep<'layer'> = async (s, { ctx, resolveAsset }) => {
  if (!ctx.docId) throw new Error('No design document to place layers in.');
  const source = s.layerType === 'raster' ? await resolveAsset(s.source) : null;
  const layerId = await applyLayerStep(ctx.sessionId, ctx.docId, s, source);
  return { assetIds: [], layerId };
};

export const estimateLayer: EstimateStep<'layer'> = (s) => {
  const estimate = { usd: 0, approximate: false };
  return { estimate, authorization: costAuthorization(`local::${s.kind}`, { count: 1, advanced: {} }, estimate) };
};

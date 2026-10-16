import { ensureSchema, lineRoutes, opModelFromRef } from '../../engine/catalog';
import { ALL_TOOLS } from '../shell/navModel';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import type { MediaKind, OpId } from '../../engine/types';
import { OPS } from '../../engine/ops';
import { attachProblem, nounOf, routeFor, toolTakes } from './actionRoute';

/** A text-only variant still takes images when its line has an image route: attaching switches to it (the composer does the switch). */
export function hasImageTwin(mode: MediaKind, ref: string): boolean {
  if ((mode !== 'image' && mode !== 'video') || !ref) return false;
  const routes = lineRoutes(ref);
  const twin = mode === 'image' ? routes.edit ?? routes.reference ?? opModelFromRef(ref, 'image') : routes.image ?? routes.reference;
  return Boolean(twin && twin !== ref);
}

const MODE_NAME: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D' };

/**
 * "Go": take the chosen action to where it belongs with the selected asset. An operation opens Tools with that
 * tool and the asset as input; a creation opens Create in its mode with the asset attached as reference, only when
 * the composer would accept it (otherwise it still navigates and says why it was not attached).
 */
export async function goWithAction(op: OpId, assetId: string): Promise<void> {
  const asset = useStore.getState().assets[assetId];
  if (!asset) return;
  const route = routeFor(op);
  if (route.to === 'tools') {
    if (!ALL_TOOLS.some((t) => t.id === route.op) || !toolTakes(route.op, asset.kind)) {
      toast(`${OPS[route.op].label} needs ${nounOf(OPS[route.op].input)}.`, 'info');
      return;
    }
    setUi({ workspace: 'chat', home: false, panel: null, space: 'tools', toolOp: route.op, toolAsset: assetId });
    return;
  }
  setComposer({ mode: route.mode });
  setUi({ workspace: 'chat', home: false, panel: null, space: 'create', toolAsset: undefined });
  const ref = useStore.getState().composer[route.mode].modelRef;
  await ensureSchema(ref);
  const slots = useStore.getState().catalog.schemas[ref]?.slots;
  const problem = attachProblem(asset.kind, route.mode, slots, hasImageTwin(route.mode, ref));
  if (problem) {
    toast(`Opened Create · ${MODE_NAME[route.mode]}, but the ${asset.kind} was not attached: ${problem}.`, 'info');
    return;
  }
  setComposer((c) => ({ attachments: c.attachments.includes(assetId) ? c.attachments : [...c.attachments, assetId] }));
}

import type { Graph } from '../engine/types';

/** Startup wiring for graph hydration. Standalone store consumers can load without registering descriptors. */
export const sessionLoadHooks = {
  migrateGraph: (graph: Graph): Graph => graph,
};

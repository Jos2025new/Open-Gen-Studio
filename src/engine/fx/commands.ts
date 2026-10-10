import { uid } from '../../lib/id';
import type { BlendMode, DesignDoc, Layer } from '../types';
import { BLEND_MODES } from '../design/render';
import { removeLayer } from '../design/doc';
import { FX_DEFS, fxParams, isFxKind } from './defs';
import type { FxGroup, FxKind, FxLayer, FxOp, FxScope } from './types';

/*
 * Every change to FX layers, as commands on a document: the layers panel and the agent's designer_fx tool run the
 * same ones (ADR 0011, D6). A list runs in order and applies only if all of it is valid; the caller records one undo.
 */

const BLENDS: BlendMode[] = BLEND_MODES;

export type FxOpInput = { kind: string; params?: Record<string, unknown>; enabled?: boolean };

export type FxCommand =
  /** A new FX layer above `above` (a layer id or "last"; default: the active layer), with `ops` in order (or none). */
  | { do: 'add'; group: FxGroup; scope?: FxScope; ops?: FxOpInput[]; name?: string; above?: string; simple?: boolean }
  | { do: 'set'; layer: string; name?: string; scope?: FxScope; opacity?: number; blend?: string; visible?: boolean; simple?: boolean }
  | { do: 'add_op'; layer: string; kind: string; params?: Record<string, unknown>; index?: number }
  | { do: 'set_op'; layer: string; op: string; params?: Record<string, unknown>; enabled?: boolean }
  | { do: 'move_op'; layer: string; op: string; to: number }
  | { do: 'remove_op'; layer: string; op: string }
  | { do: 'delete'; layer: string };

export interface FxRun { doc: DesignDoc; results: string[]; error?: string; added: string[] }

export function newFxOp(kind: FxKind, params: Record<string, unknown> = {}, enabled = true): FxOp {
  return { id: uid('fxo'), kind, enabled, params: fxParams(kind, params) };
}

/** A new FX layer: one op for a filter or effect "on its own" (simple), a stack otherwise. */
export function newFxLayer(group: FxGroup, opts: { name?: string; scope?: FxScope; ops?: FxOp[]; simple?: boolean } = {}): FxLayer {
  const ops = opts.ops ?? [];
  const name = opts.name ?? (opts.simple && ops[0] ? FX_DEFS[ops[0].kind].label : group === 'filter' ? 'Filters' : 'Effects');
  return { id: uid('lyr'), name, type: 'fx', group, scope: opts.scope ?? 'below', ops, visible: true, locked: false, opacity: 1, blend: 'normal', ...(opts.simple ? { simple: true } : {}) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function runFxCommands(doc: DesignDoc, commands: FxCommand[]): FxRun {
  let d = doc;
  const results: string[] = [], added: string[] = [];
  const fail = (i: number, msg: string): FxRun => ({ doc, results, added: [], error: `Command ${i + 1}: ${msg} Nothing was changed.` });
  const find = (ref: string): FxLayer | string => {
    const id = ref === 'last' ? added[added.length - 1] : ref;
    const l = d.layers.find((x) => x.id === id);
    if (!l) return `no layer "${ref}".`;
    if (l.type !== 'fx') return `"${l.name}" is a ${l.type} layer, not an FX layer.`;
    if (l.locked) return `"${l.name}" is locked.`;
    return l;
  };
  const kindFor = (layer: FxLayer, kind: string): FxKind | string => {
    if (!isFxKind(kind)) return `unknown filter or effect "${kind}".`;
    if (FX_DEFS[kind].group !== layer.group) return `${FX_DEFS[kind].label} is ${FX_DEFS[kind].group === 'filter' ? 'a filter' : 'an effect'}; "${layer.name}" is a ${layer.group} layer.`;
    return kind;
  };
  const put = (next: FxLayer) => { d = { ...d, layers: d.layers.map((l) => (l.id === next.id ? next : l)), updatedAt: Date.now() }; };
  for (const [i, c] of commands.entries()) {
    if (c.do === 'add') {
      const ops: FxOp[] = [];
      for (const o of c.ops ?? []) {
        if (!isFxKind(o.kind)) return fail(i, `unknown filter or effect "${o.kind}".`);
        if (FX_DEFS[o.kind].group !== c.group) return fail(i, `${FX_DEFS[o.kind].label} does not belong in a ${c.group} layer.`);
        ops.push(newFxOp(o.kind, o.params, o.enabled ?? true));
      }
      const anchorId = c.above === 'last' ? added[added.length - 1] : c.above ?? d.activeLayerId;
      const at = anchorId ? d.layers.findIndex((l) => l.id === anchorId) : -1;
      if (c.above && at < 0) return fail(i, `no layer "${c.above}" to place it above.`);
      const anchor: Layer | undefined = d.layers[at];
      const layer = { ...newFxLayer(c.group, { name: c.name, scope: c.scope, ops, simple: c.simple && ops.length === 1 }), ...(anchor?.groupId ? { groupId: anchor.groupId } : {}) };
      const layers = [...d.layers];
      layers.splice(at >= 0 ? at + 1 : layers.length, 0, layer);
      d = { ...d, layers, activeLayerId: layer.id, updatedAt: Date.now() };
      added.push(layer.id);
      results.push(`Added ${layer.group} layer ${layer.id} "${layer.name}" (${layer.scope === 'layer' ? `applies to ${anchor ? `"${anchor.name}"` : 'the layer under it'}` : 'applies to everything below'}).`);
      continue;
    }
    const l = find(c.layer);
    if (typeof l === 'string') return fail(i, l);
    if (c.do === 'delete') {
      d = removeLayer(d, l.id);
      results.push(`Deleted "${l.name}".`);
    } else if (c.do === 'set') {
      if (c.blend !== undefined && !BLENDS.includes(c.blend as BlendMode)) return fail(i, `unknown blend "${c.blend}".`);
      if (c.scope !== undefined && c.scope !== 'below' && c.scope !== 'layer') return fail(i, `scope is "below" or "layer".`);
      put({ ...l, ...(c.name?.trim() ? { name: c.name.trim() } : {}), ...(c.scope ? { scope: c.scope } : {}), ...(c.opacity !== undefined ? { opacity: clamp01(c.opacity) } : {}), ...(c.blend ? { blend: c.blend as BlendMode } : {}), ...(c.visible !== undefined ? { visible: c.visible } : {}), ...(c.simple === false ? { simple: undefined } : {}) });
      results.push(`Updated "${l.name}".`);
    } else if (c.do === 'add_op') {
      const kind = kindFor(l, c.kind);
      if (!isFxKind(kind)) return fail(i, kind);
      const ops = [...l.ops], op = newFxOp(kind, c.params);
      ops.splice(c.index === undefined ? ops.length : Math.max(0, Math.min(ops.length, c.index)), 0, op);
      // Two or more ops: it is no longer a single filter, it is shown as the full layer.
      put({ ...l, ops, simple: undefined });
      results.push(`Added ${FX_DEFS[kind].label} (${op.id}) to "${l.name}".`);
    } else {
      const op = l.ops.find((o) => o.id === c.op) ?? (c.op === 'first' ? l.ops[0] : undefined);
      if (!op) return fail(i, `"${l.name}" has no op "${c.op}".`);
      if (c.do === 'set_op') {
        put({ ...l, ops: l.ops.map((o) => (o.id === op.id ? { ...o, ...(c.params ? { params: fxParams(o.kind, { ...o.params, ...c.params }) } : {}), ...(c.enabled !== undefined ? { enabled: c.enabled } : {}) } : o)) });
        results.push(`Updated ${FX_DEFS[op.kind].label} in "${l.name}".`);
      } else if (c.do === 'move_op') {
        const ops = l.ops.filter((o) => o.id !== op.id);
        ops.splice(Math.max(0, Math.min(ops.length, c.to)), 0, op);
        put({ ...l, ops });
        results.push(`Moved ${FX_DEFS[op.kind].label} to position ${ops.indexOf(op) + 1} in "${l.name}".`);
      } else {
        put({ ...l, ops: l.ops.filter((o) => o.id !== op.id) });
        results.push(`Removed ${FX_DEFS[op.kind].label} from "${l.name}".`);
      }
    }
  }
  return { doc: d, results, added };
}

/** For the agent's layer list: an FX layer's kind, scope and ops with their values (" [...]"); '' for other layers. */
export function fxSummary(l: Layer): string {
  if (l.type !== 'fx') return '';
  const ops = l.ops.map((o) => `${o.id} ${o.kind}${o.enabled ? '' : ' (off)'} ${JSON.stringify(o.params)}`).join('; ');
  return ` [${l.group}, scope ${l.scope}${l.opacity < 1 ? `, opacity ${l.opacity}` : ''}${l.blend !== 'normal' ? `, blend ${l.blend}` : ''}: ${ops || 'no ops'}]`;
}

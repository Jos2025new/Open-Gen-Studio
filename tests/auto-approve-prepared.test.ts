import { describe, expect, it } from 'vitest';
vi_hoist();
function vi_hoist() { Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }); }
import { autoApproves } from '../src/engine/agent/runtimeShared';

describe('Auto style approves by the price that will be charged', () => {
  const free = { usd: 0, approximate: false };
  const paid = { usd: 0.4, approximate: false };
  it('a free plan is approved by itself', () => expect(autoApproves('auto', free)).toBe(true));
  it('a Nodes plan whose own steps are free but whose prepared run updates paid upstream nodes is NOT approved by itself', () => expect(autoApproves('auto', free, paid)).toBe(false));
  it('other styles never auto-approve', () => expect(autoApproves('guided', free)).toBe(false));
});

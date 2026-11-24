import { defineNode } from '../descriptor';
import { NOTHING } from '../deliver';

export type PartKind = 'color' | 'component' | 'style';
export type StyleKind = 'text' | 'color';

export interface PartNodeData {
  kind: 'part';
  partKind: PartKind;
  title: string;
  role?: string;
  description?: string;
  color?: string;
  groupId?: string;
  styleType?: StyleKind;
  values?: Record<string, string | number>;
}

declare module '../../graphTypes' {
  interface ExtraNodeKinds {
    part: PartNodeData;
  }
}

export default defineNode({
  kind: 'part',
  version: 1,
  params: ['title', 'partKind', 'role', 'description', 'color', 'groupId', 'styleType', 'values'],
  inputs: () => [],
  output: () => null,
  required: [],
  affects: {},
  evaluate: () => NOTHING,
  defaults: () => ({ kind: 'part', partKind: 'color', title: 'Part' }),
});

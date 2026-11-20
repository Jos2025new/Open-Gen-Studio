import { ShapeBuilder } from '../ShapeBuilder';
import { ShapeSettings } from './shape';
import type { ToolDescriptor } from './types';

export const shapeBuilder = {
  overlay: ShapeBuilder,
  settings: ShapeSettings,
} satisfies ToolDescriptor;

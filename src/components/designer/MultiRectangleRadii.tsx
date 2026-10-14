import { useId } from 'react';
import type { DesignDoc, ShapeSpec, VectorShape } from '../../engine/types';
import { cornerRadii, SHARP } from '../../engine/design/shapeLook';
import { convertMultiRectanglesToPaths, mixedRectangleRadii, patchMultiLayerRectangles, type RectangleTarget } from '../../engine/design/multiRectEdit';
import { mutateDoc, getDoc } from '../../engine/design/actions';
import { setShapeEdit } from '../../engine/design/objectSelection';
import { InlineSlider } from './InlineControls';

export function MultiRectangleRadii({ sessionId, doc, targets }: { sessionId: string; doc: DesignDoc; targets: RectangleTarget[] }) {
  if (targets.length < 2) return null;
  const shapes = targets.map((target) => {
    const layer = doc.layers.find((item) => item.id === target.layerId);
    return layer?.type === 'vector' ? layer.shapes.find((shape) => shape.id === target.shapeId && shape.type === 'rect') : undefined;
  }).filter((shape): shape is VectorShape => Boolean(shape));
  if (shapes.length < 2) return null;
  const value = shapes[shapes.length - 1], radii = cornerRadii(value);
  const mixed = mixedRectangleRadii(doc, targets);
  const apply = (patch: Partial<Pick<ShapeSpec, 'rx' | 'ry' | 'radius'>>) => {
    const current = getDoc(sessionId, doc.id);
    if (current) mutateDoc(sessionId, doc.id, (latest) => patchMultiLayerRectangles(latest, targets, patch));
  };
  const convertForNodes = () => {
    const current = getDoc(sessionId, doc.id);
    if (!current) return;
    mutateDoc(sessionId, doc.id, (latest) => convertMultiRectanglesToPaths(latest, targets));
    setShapeEdit(doc.id, { layerId: targets[0].layerId, shapeId: targets[0].shapeId, paths: targets.map((target) => ({ ...target, nodes: [] })) });
  };
  const maxRx = Math.max(1, ...shapes.map((shape) => Math.ceil(Math.abs(shape.w) / 2)));
  const maxRy = Math.max(1, ...shapes.map((shape) => Math.ceil(Math.abs(shape.h) / 2)));
  const helpId = `rounding-selection-help-${useId()}`;
  const scope = mixed
    ? 'Values differ; changing Rx or Ry applies it to every selected visible, unlocked rectangle.'
    : 'Applies to selected visible, unlocked rectangles; other shapes and layers stay unchanged.';
  return <fieldset className="shape-properties rounding-selection" data-rounding-selection="" aria-label="Round selected rectangles" aria-describedby={helpId}>
    <legend title={scope} data-tip={scope}>Rounding · {shapes.length} rectangles{mixed ? ' · Mixed' : ''}</legend>
    <span id={helpId} className="sr-only">{scope}</span>
    <div className="rounding-controls">
      <InlineSlider label="Rx" unit="px" min={0} max={maxRx} allowManualOverflow value={radii.rx} step={0.5} onChange={(rx) => apply({ rx })} />
      <InlineSlider label="Ry" unit="px" min={0} max={maxRy} allowManualOverflow value={radii.ry} step={0.5} onChange={(ry) => apply({ ry })} />
      <button type="button" className="opt" disabled={!shapes.some((shape) => cornerRadii(shape).rx || cornerRadii(shape).ry)} onClick={() => apply(SHARP)} data-tip="Make every selected rectangle sharp">Sharp corners</button>
      <button type="button" className="opt" onClick={convertForNodes} aria-label={`Convert ${shapes.length} selected rectangles to paths for node editing`} data-tip="Convert selected rectangles to editable paths for node editing" data-multi-rectangle-convert="">Convert to paths</button>
    </div>
  </fieldset>;
}

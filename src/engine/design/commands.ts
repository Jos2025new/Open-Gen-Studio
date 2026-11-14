import { z } from 'zod';
import { defineCommand } from '../commands/types';
import { useStore } from '../../store/store';
import type { Layer } from '../types';
import * as A from './actions';
import { docCommand, docOf } from './commandKit';
import { EXPORT_FORMATS } from './exportSettings';
import { canRedo, canUndo } from './history';

/* The Designer's documents as commands (ADR 0030). Each wraps the action the interface already calls. */

const none = z.object({}).strict();
const side = z.number().int().min(1).max(16384);
const brief = (l: Layer) => ({ id: l.id, name: l.name, type: l.type, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend });

export const commands = [
  defineCommand({
    id: 'designer.doc.list',
    title: 'List documents',
    description: 'The documents of the session, with which one is on screen (active).',
    args: none,
    effect: 'read',
    needs: ['session'],
    run: ({ on }) => {
      const active = A.activeDoc(on.session!)?.id;
      return A.sessionDocs(on.session!).map((d) => ({ id: d.id, name: d.name, width: d.width, height: d.height, layers: d.layers.length, active: d.id === active }));
    },
  }),
  docCommand({
    id: 'designer.doc.read',
    title: 'Read document',
    description: 'Size, active layer and layers (bottom first) of a document.',
    args: none,
    effect: 'read',
    undo: false,
    run: (on) => {
      const d = docOf(on);
      return { id: d.id, name: d.name, width: d.width, height: d.height, active_layer: d.activeLayerId ?? null, layers: d.layers.map(brief) };
    },
  }),
  defineCommand({
    id: 'designer.doc.new',
    title: 'New document',
    description: 'A blank document; it becomes the one on screen. Returns {doc}.',
    args: z.object({ width: side, height: side, name: z.string().min(1).max(80).optional() }).strict(),
    effect: 'write',
    needs: ['session'],
    run: ({ on }, args) => {
      const doc = A.newBlankDoc(on.session!, { label: args.name ?? 'Design', width: args.width, height: args.height });
      if (args.name) A.renameDoc(on.session!, doc.id, args.name);
      return { doc: doc.id };
    },
  }),
  defineCommand({
    id: 'designer.doc.ensure',
    title: 'Document to work on',
    description: 'The document on screen, or a new one (default 1080x1080) when there is none. Returns {doc}.',
    args: z.object({ width: side.optional(), height: side.optional() }).strict(),
    effect: 'write',
    needs: ['session'],
    debt: 'Reads the active document of the session (ensureDoc -> activeDoc).',
    run: ({ on }, args) => ({ doc: A.ensureDoc(on.session!, args.width && args.height ? { width: args.width, height: args.height } : undefined).id }),
  }),
  defineCommand({
    id: 'designer.doc.from_asset',
    title: 'Open image as document',
    description: 'A new document whose first layer is this image; the app moves to the Designer. Returns {doc}.',
    args: z.object({ asset: z.string().min(1) }).strict(),
    effect: 'write',
    needs: ['session'],
    debt: 'Changes the workspace on screen (openAssetInDesigner sets ui.workspace).',
    available: (_ctx, args) => {
      const asset = args?.asset ? useStore.getState().assets[args.asset] : undefined;
      if (args?.asset && !asset) return `No asset "${args.asset}".`;
      return asset && asset.kind !== 'image' ? 'Only an image can be opened as a document.' : true;
    },
    run: async ({ on }, args) => {
      const before = new Set(A.sessionDocs(on.session!).map((d) => d.id));
      await A.openAssetInDesigner(on.session!, args.asset);
      const made = A.sessionDocs(on.session!).find((d) => !before.has(d.id));
      if (!made) throw new Error('The image could not be opened.');
      return { doc: made.id };
    },
  }),
  docCommand({
    id: 'designer.doc.select',
    title: 'Show document',
    description: 'Puts this document on screen and loads its pixels.',
    args: none,
    effect: 'write',
    undo: false,
    run: (on) => A.selectDoc(on.session, on.doc),
  }),
  docCommand({
    id: 'designer.doc.rename',
    title: 'Rename document',
    args: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
    effect: 'write',
    undo: false,
    run: (on, args) => A.renameDoc(on.session, on.doc, args.name),
  }),
  docCommand({
    id: 'designer.doc.delete',
    title: 'Delete document',
    description: 'Deletes the document, its pixels and its undo history. It cannot be undone.',
    args: none,
    effect: 'delete',
    undo: false,
    run: (on) => A.deleteDoc(on.session, on.doc),
  }),
  docCommand({
    id: 'designer.doc.undo',
    title: 'Undo',
    description: 'Takes back the last change of the document.',
    args: none,
    effect: 'write',
    undo: false,
    available: (ctx) => (canUndo(ctx.on.doc ?? '') ? true : 'Nothing to undo.'),
    run: (on) => A.undoDoc(on.session, on.doc),
  }),
  docCommand({
    id: 'designer.doc.redo',
    title: 'Redo',
    args: none,
    effect: 'write',
    undo: false,
    available: (ctx) => (canRedo(ctx.on.doc ?? '') ? true : 'Nothing to redo.'),
    run: (on) => A.redoDoc(on.session, on.doc),
  }),
  docCommand({
    id: 'designer.doc.export',
    title: 'Export document',
    description: 'Asks the browser to download the page in this format (default png). Only when the user asks for a file.',
    args: z.object({ format: z.enum(EXPORT_FORMATS).optional() }).strict(),
    effect: 'write',
    undo: false,
    run: (on, args) => A.exportDocFile(on.session, on.doc, args.format),
  }),
  docCommand({
    id: 'designer.doc.save_to_gallery',
    title: 'Save to gallery',
    description: 'The page as a new image in the gallery. Returns {asset}.',
    args: none,
    effect: 'write',
    undo: false,
    run: async (on) => {
      const asset = await A.saveDocToGallery(on.session, on.doc);
      if (!asset) throw new Error('The document could not be saved.');
      return { asset: asset.id };
    },
  }),
];

/**
 * Every exported action of `actions.ts`: the command that runs it, or (after "-") why it is not one. A test keeps
 * this list complete, so a new action cannot be added without deciding.
 */
export const DESIGNER_ACTIONS: Record<string, string> = {
  sessionDocs: 'designer.doc.list',
  activeDoc: 'designer.doc.list',
  getDoc: 'designer.doc.read',
  mutateDoc: '- takes a function: the plumbing under every write',
  addDoc: '- takes a whole document object; designer.doc.new and designer.doc.from_asset go through it',
  selectDoc: 'designer.doc.select',
  newBlankDoc: 'designer.doc.new',
  ensureDoc: 'designer.doc.ensure',
  renameDoc: 'designer.doc.rename',
  deleteDoc: 'designer.doc.delete',
  assetCanvas: '- returns a canvas, not data',
  placeAsset: 'designer.layer.place_asset',
  openAssetInDesigner: 'designer.doc.from_asset',
  addTextLayer: 'designer.layer.add_text',
  rebasePaintLayer: 'designer.layer.rebase_paint',
  addVectorLayer: 'designer.layer.add_shapes',
  addEmptyLayer: 'designer.layer.add',
  noticeSkippedLayer: '- a notice for the person drawing, with a button',
  ensurePaintLayer: 'designer.layer.ensure_paint',
  setActiveLayer: 'designer.layer.select',
  patchLayer: 'designer.layer.set',
  deleteLayer: 'designer.layer.delete',
  deleteLayers: 'designer.layer.delete',
  flattenLayers: 'designer.layer.flatten',
  mergeDown: 'designer.layer.merge_down',
  rasterizeLayer: 'designer.layer.rasterize',
  duplicateLayer: 'designer.layer.duplicate',
  moveLayer: 'designer.layer.move',
  reorderLayer: 'designer.layer.reorder',
  undoDoc: 'designer.doc.undo',
  redoDoc: 'designer.doc.redo',
  prunePicks: '- keeps picks consistent after a change; every write already runs it',
  canvasToAsset: '- takes a canvas, not data; designer.layer.to_asset and designer.doc.save_to_gallery cover it',
  layerToAsset: 'designer.layer.to_asset',
  replaceLayerPixels: 'designer.layer.replace_pixels',
  placeAboveLayer: 'designer.layer.place_above',
  exportDocFile: 'designer.doc.export',
  saveDocToGallery: 'designer.doc.save_to_gallery',
  applyLayerStep: '- runs one step of a plan; it ends in place_asset, add_text or add_shapes, which are commands',
};

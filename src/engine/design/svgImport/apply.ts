import { setUi, toast } from '../../../store/store';
import { addDoc } from '../actions';
import { setBuffer } from '../raster';
import { describeReport, importSvg } from './index';

/** Import an SVG file as a new design in the session: folders, editable shapes and raster layers; says what was kept. */
export async function importSvgFile(sessionId: string, file: File): Promise<boolean> {
  const res = await importSvg(await file.text(), file.name.replace(/\.[^.]+$/, '') || 'SVG');
  if ('error' in res) { toast(res.error, 'error'); return false; }
  addDoc(sessionId, res.doc);
  for (const [layerId, canvas] of res.buffers) setBuffer(layerId, canvas);
  setUi({ workspace: 'designer' });
  toast(`SVG imported: ${describeReport(res.report)}`, 'info', 9000);
  return true;
}

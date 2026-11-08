import type { ExportFile } from './exportJob';

/** The slice of the File System Access API the export uses (Chromium only). */
export interface FolderHandle {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

type Picker = (options?: { mode?: 'readwrite' }) => Promise<FolderHandle>;
const picker = (): Picker | undefined => (globalThis as { showDirectoryPicker?: Picker }).showDirectoryPicker?.bind(globalThis);

export const canChooseFolder = () => !!picker();

/** Ask for a folder; undefined when the browser has no picker or the user closed it. */
export async function chooseFolder(): Promise<FolderHandle | undefined> {
  try {
    return await picker()?.({ mode: 'readwrite' });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return undefined;
    throw error;
  }
}

async function exists(dir: FolderHandle, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/** Write each file into the folder (optionally in a subfolder per format). Existing files are never overwritten: the name gets -2, -3 … */
export async function writeFilesToFolder(dir: FolderHandle, files: ExportFile[], subfolders: boolean): Promise<string[]> {
  const written: string[] = [];
  for (const file of files) {
    const dot = file.name.lastIndexOf('.');
    const target = subfolders ? await dir.getDirectoryHandle(file.name.slice(dot + 1), { create: true }) : dir;
    let name = file.name;
    for (let i = 2; await exists(target, name); i++) name = `${file.name.slice(0, dot)}-${i}${file.name.slice(dot)}`;
    const writable = await (await target.getFileHandle(name, { create: true })).createWritable();
    await writable.write(file.bytes);
    await writable.close();
    written.push(subfolders ? `${file.name.slice(dot + 1)}/${name}` : name);
  }
  return written;
}

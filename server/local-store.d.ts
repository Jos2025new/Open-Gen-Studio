import type { Plugin } from 'vite';

/** Vite plugin serving /x/store: a disk copy of the app's saved state and media under `<root>/data`. */
export function localStore(root?: string): Plugin;

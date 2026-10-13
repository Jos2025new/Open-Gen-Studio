import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { panOffset } from '../../engine/design/nudge';

/** Arrow keys with nothing picked pan the view (DesignerWorkspace dispatches ogs:pan). */
export function usePanRequest<V extends { x: number; y: number }>(setView: Dispatch<SetStateAction<V>>): void {
  useEffect(() => {
    const onPan = (e: Event) => {
      const d = (e as CustomEvent<{ ux: number; uy: number; shift: boolean }>).detail;
      setView((v) => ({ ...v, ...panOffset(v, d.ux, d.uy, d.shift) }));
    };
    window.addEventListener('ogs:pan', onPan);
    return () => window.removeEventListener('ogs:pan', onPan);
  }, [setView]);
}

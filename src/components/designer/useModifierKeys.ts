import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Mods } from '../../engine/design/modifierGate';

/**
 * Shift, Alt and Ctrl held right now. `shift` re-renders (the layer picks follow it); `held` is always current and does not.
 * Everything is released when the window loses focus, so a key let go elsewhere is not left pressed.
 */
export function useModifierKeys(insideRef: RefObject<boolean>): { shift: boolean; held: RefObject<Mods> } {
  const [shift, setShift] = useState(false);
  const held = useRef<Mods>({ shift: false, alt: false, ctrl: false });
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      if (e.key === 'Shift') { held.current = { ...held.current, shift: on }; setShift(on); }
      else if (e.key === 'Alt') held.current = { ...held.current, alt: on };
      else if (e.key === 'Control' || e.key === 'Meta') held.current = { ...held.current, ctrl: on };
    };
    const onDown = (e: KeyboardEvent) => { if (insideRef.current) set(e, true); };
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => { held.current = { shift: false, alt: false, ctrl: false }; setShift(false); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [insideRef]);
  return { shift, held };
}

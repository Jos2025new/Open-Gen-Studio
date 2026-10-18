import { useLayoutEffect, useRef, useState } from 'react';

/** A prompt clamped to three lines; "Show more" appears only when the text is really cut. */
export function ClampedText({ text, lines = 3 }: { text: string; lines?: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className="cc-prompt">
      <p ref={ref} className={`cc-prompt-text${open ? '' : ' is-clamped'}`} style={{ ['--lines' as string]: lines }}>{text}</p>
      {cut || open ? <button type="button" className="cc-prompt-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show more'}</button> : null}
    </div>
  );
}

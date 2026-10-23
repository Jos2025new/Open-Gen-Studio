import { CircleAlert, Info } from 'lucide-react';
import type { Generation } from '../../engine/types';

/** What came back differs from what was asked, and what the app did on its own: shown wherever a result is shown. */
export function GenerationNotices({ g }: { g: Generation }) {
  return <>
    {g.status === 'done' && g.delivery?.length ? (
      <div className="gen-delivery" data-tip="What came back differs from what was asked">
        <CircleAlert size={12} />
        <span>{g.delivery.join(' · ')}</span>
      </div>
    ) : null}
    {g.notes?.length ? (
      <div className="gen-delivery faint" data-tip="What the app did about this request on its own">
        <Info size={12} />
        <span>{g.notes.join(' · ')}</span>
      </div>
    ) : null}
  </>;
}

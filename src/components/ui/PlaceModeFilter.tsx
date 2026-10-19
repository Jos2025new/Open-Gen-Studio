import { MODE_LABEL, PLACE_LABEL, type Mode, type Place } from '../../engine/placeTypes';

export type PlaceFilter = 'all' | 'none' | Place;
export type ModeFilter = 'all' | 'none' | Mode;

const PLACES: PlaceFilter[] = ['all', 'space-create', 'space-tools', 'studio', 'canvas', 'designer', 'none'];
const MODES: ModeFilter[] = ['all', 'image', 'video', 'audio', 'model3d', 'agent', 'none'];
const label = (v: string) => (v === 'all' ? 'All' : v === 'none' ? 'None' : v);

export const matchesPlace = (p: Place | undefined, f: PlaceFilter): boolean => f === 'all' || (f === 'none' ? !p : p === f);
export const matchesMode = (m: Mode | undefined, f: ModeFilter): boolean => f === 'all' || (f === 'none' ? !m : m === f);

/** Place and mode chips with counts, the way Library and Generations filter what Spaces and workspaces made. */
export function PlaceModeFilter({ place, mode, placeCounts, modeCounts, onPlace, onMode }: {
  place: PlaceFilter;
  mode: ModeFilter;
  placeCounts: Record<string, number>;
  modeCounts: Record<string, number>;
  onPlace: (v: PlaceFilter) => void;
  onMode: (v: ModeFilter) => void;
}) {
  const row = (values: string[], value: string, counts: Record<string, number>, set: (v: string) => void, names: Record<string, string>, none: string) => (
    <div className="sv-canvas">
      {values.map((v) => (
        <button key={v} type="button" className={`canvas-tab ${value === v ? 'is-on' : ''}`} onClick={() => set(v as never)} disabled={v !== 'all' && !counts[v]}>
          {v === 'all' ? 'All' : v === 'none' ? none : (names[v] ?? label(v))}
          <span className="num faint">{counts[v] ?? 0}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div className="sv-row"><span className="sv-label">Place</span>{row(PLACES, place, placeCounts, (v) => onPlace(v as PlaceFilter), PLACE_LABEL, 'No place')}</div>
      <div className="sv-row"><span className="sv-label">Mode</span>{row(MODES, mode, modeCounts, (v) => onMode(v as ModeFilter), MODE_LABEL, 'No mode')}</div>
    </>
  );
}

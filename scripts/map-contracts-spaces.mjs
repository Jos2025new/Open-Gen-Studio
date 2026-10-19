/** Checked by map.mjs: stage 1 of ADR 0023. */
export default [
  {
    id: 'space-place',
    what: 'Etapa 1 (ADR 0023): place y mode se fijan al lanzar, los derivados los copian, y Library, Generations, los tableros y el visor leen el mismo dato.',
    sides: [
      ['src/engine/place.ts', 'export function placeFor'],
      ['src/engine/actions.ts', 'place: placeFor(st.ui, workspace)'],
      ['src/engine/retryPartial.ts', 'place: g.place, mode: g.mode'],
      ['src/components/space/boardModel.ts', "place?: Place | 'workspace'"],
      ['src/components/gallery/GalleryPanel.tsx', 'matchesPlace(a.place, place)'],
      ['src/components/shell/GenerationsPanel.tsx', 'matchesPlace(g.place, place)'],
      ['src/engine/goTo.ts', "g.place === 'space-create'"],
    ],
    tests: ['tests/space-place.test.ts', 'tests/create-space.test.ts'],
  },
  {
    id: 'space-container',
    what: 'Etapa 1 (ADR 0023): Create y Tools escriben en la sesión marcada hidden, que no cambia la activa ni aparece en listas, Home ni contadores.',
    sides: [
      ['src/store/spaceSession.ts', 'export function ensureSpaceSession'],
      ['src/engine/actions.ts', 'const sessionId = st.ui.space ? ensureSpaceSession()'],
      ['src/store/spaceSession.ts', 'export function visibleSessions'],
      ['src/components/shell/SessionSwitcher.tsx', 'visibleSessions(sessions)'],
      ['src/components/shell/SessionsPanel.tsx', 'visibleSessions(sessions)'],
      ['src/components/shell/HomeView.tsx', 'visibleSessions(sessions)'],
    ],
    tests: ['tests/space-place.test.ts', 'tests/create-space.test.ts'],
  },
];

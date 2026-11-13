# Export and Designer bug fixes
Branch: task/export. Delivery: reviewable commits; no full suite at user request.
Runner: focused Vitest and npm run test:related, sequentially.

## Specs
- S1: «Repara los bugs en la misma rama» — D62–D70, as described in docs/pendientes-designer.md and the agreed proposal.
- S2: «dejarlo claro en commits entendibles».
- S3: «Sin correr la suit, despues lo revisara mi agente.»

## Tasks
- [x] T1 S1–S3: SVG import D67–D69; inline; focused tests passed; final repair commit.
- [x] T2 S1–S3: PDF D70; inline; focused and external-render probes passed; final repair commit.
- [x] T3 S1–S3: selection and ordering D62–D64, D66; inline; selection in 00839765; ordering in final repair commit.
- [x] T4 S1–S3: raster D65; inline; 00839765; focused tests and independent recheck passed.
- [x] T5 S1–S3: documentation, TypeScript, map, check-docs and focused checks; inline; final repair commit.

## Log
- L1: «¿Puedes hacer esas reparaciones y dejarlo claro en commits entendibles? Sin correr la suit, despues lo revisara mi agente.»
- L2: «Repara los bugs en la misma rama».
- Baseline 63e80bc7; no full suite. Sequential focused tests, protected real data.

- Focused single-worker tests: adv-seleccion 23, adv-grupos 22, adv-pdf 14, adv-svg 34, stack-order 7, pdf-look 29, svg-import 18, svg-import-apps 4, object-ops 6. TypeScript, map and check-docs passed after final source changes.
- Independent verification exposed selection and raster transform regressions; both corrected and rechecked. Further checks exposed stacking and PDF mask/opacity regressions; corrected and rechecked with PDF pixels. SVG budget false positive and namespace gaps corrected and rechecked.
- `test:related` was interrupted due to CPU load; full suite explicitly deferred by user. Sandbox and real application interchange unverified.
- Review consent declined for candidate 00839765 and tracking commit 1ecd13d8; future candidates remain subject to native review.
- The browser rasterizer budget is conservative and can reject oversized or cyclic reachable references; coverage is bounded, not proof against every SVG.

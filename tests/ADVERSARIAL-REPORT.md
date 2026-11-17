# Adversarial review — `claude/frentes-visibles-c21c45`

Compared with `task/sqlite-adopt` (four commits). Only the four new `tests/adversarial-*.test.ts` files were executed, with one Vitest fork worker. No app, browser, sandbox, or `data/` was used.

## Results

| Test | Result | Interpretation |
| --- | --- | --- |
| `adversarial-viewer-dock.test.ts` — names, icon wiring, and operation grouping | PASS | The four requested dock names are in order, each is mapped to a dock icon used by the tab, and all single-input operations remain grouped. This is a code-contract check; it does not prove visual appearance in a browser. |
| `adversarial-omnicanvas-frame.test.ts` — agent present with small viewport, tall node, and extreme zoom fixtures | PASS | Each fixture with an agent includes its complete node ID in the `fitView` request and retains the 0.35 minimum zoom. |
| `adversarial-omnicanvas-frame.test.ts` — no agent | PASS | Without an agent node, the fit request excludes the synthetic agent ID. |
| `adversarial-disk-pagehide.test.ts` — real HTTP 500 after `pagehide`, no reload | FAIL — real bug | The write returns `fail`, but no warning is emitted. `unloading` suppresses every failure after `pagehide`, including a resolved server-side HTTP 500. This is not an aborted request: the server returned an explicit error and the page remains alive. The changed behavior hides a real persistence failure. |
| `adversarial-export-preview-parity.test.ts` — huge empty transparent canvas | PASS | Preview dimensions stay bounded at 512×256 for a 20,000×10,000 document, preserve its aspect ratio, and request no background fill. |
| `adversarial-export-preview-parity.test.ts` — selection crop | PASS | A 60×60 selection at scale 3 yields a 180×180 frame and retains the selection clip callback. |

## Evidence and limits

Command: `npx vitest run --pool=forks --maxWorkers=1 tests/adversarial-viewer-dock.test.ts tests/adversarial-omnicanvas-frame.test.ts tests/adversarial-disk-pagehide.test.ts tests/adversarial-export-preview-parity.test.ts`

Final result: 3 files passed, 1 failed; 7 tests passed, 1 failed. The initial run exposed test-harness setup errors in the new Omni and dock tests; those were corrected before the final run. No production code was changed.

The Omni test verifies membership in React Flow's fit request, but does not run React Flow's actual geometry/zoom algorithm. Export tests check the produced frame contract and crop arguments; they do not compare rendered pixels against the parent revision. Browser-based visual comparison was explicitly out of scope.

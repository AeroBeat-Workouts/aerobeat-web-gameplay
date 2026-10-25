# Live shoulder-relative Boxing target heights — gameplay owner

Status: Derrick-approved owner slice, verified; owner commit/push pending.
Parent: assembly `.plans/2026-10-25-live-boxing-height-offsets.md`. Current base `b71a791`.
Decision: runtime-only validated setter on the coordinator; leave immutable authored events and run-locked score settings unchanged. Existing reach rows remain the fallback until setter is called.
Next acceptance check: focused live retarget regression, `npm test`, `npm run test:browser`.
Owner: gameplay. Assembly handles input baseline, renderer, UI, pinning and genuine Play.
Beads: owner database unavailable to installed `bd` (`no beads database found`); no Beads writes or initialization.

- [x] Implement five-family runtime target Y for pending Boxer collider punch/paired guard/knee, preserving X and Flow.
- [x] Test active-event retarget and guard/knee, validation/fallback and Flow; `npm test`, `npm run test:browser`, `git diff --check` passed. Flow's existing deterministic and browser checks passed. Genuine assembly Play remains parent-owned.
- [x] Document exact API in README; commit/push gameplay owner only.

No assembly, contracts, input, renderer, or public resolved-event changes. The parent will perform configured genuine Play after integration.

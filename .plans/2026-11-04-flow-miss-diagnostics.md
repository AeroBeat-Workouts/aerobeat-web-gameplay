# Report only observed Flow direction rejections

Approved repair under assembly .plans/2026-11-04-playtest-bug-batch.md, Bead cqs7; owner Pico. No scoring/timing/geometry changes.

## Diagnostic report

Exact failure: colliderMissDiagnostics currently returns wrong_direction for every fresh directional note expiry with direction enforcement, even if the saber never contacted the target. The recent signed no-contact fixture reproduces this output; it is not evidence that direction caused the miss.

Expected: wrong_direction requires an actual rejected geometric contact. Otherwise keep the existing wrong_collider diagnostic. Preserve no_input/calibration_mismatch/stale_input and near precedence.

Execution: evaluateColliderNotes -> joint geometry/direction sweep (returns null for both no contact and wrong-way-only contact) -> note deadline -> colliderMissDiagnostics uses authored-direction presence instead of observed rejection.

Root cause: the distinction is discarded, then the fallback infers a direction rejection from settings alone. Not caused by renderer or expanded collision shape. No earlier fix attempted for this diagnostic issue; the existing nrrv scoring fix is correct and must remain unchanged.

Minimal reproduction/verification: existing real coordinator reversal regression, wrong-way-only and no-contact controls. Add exact diagnostic assertions: no contact wrong_collider, actual rejected contact wrong_direction, valid reversal still same hit/timing. Test observer callback only at real rejected contacts; lifecycle clears cannot leak evidence to a new run.

Recommended smallest fix: optional observation callback on the existing sweep's first real direction-rejected contact, not on speculative qualifier-only prechecks. Coordinator retains event IDs for diagnostics only, clears them with existing continuity/run/reset state, deletes on judgement, and uses that fact at expiry. Do not rerun geometry, return a new hit result, change sampling or add a diagnostic enum/schema.

Results: the same coordinator regression first failed RED with actual wrong_direction versus required wrong_collider for no contact. After the observation-only fix, focused reversal/spline checks PASS, including exact hit/timing and contact-only callback assertions. Full npm test PASS (bash90). All diagnostic evidence clears alongside existing near/continuity/run state and deletes on judgement. Parent signed integration remains next; no physical accuracy claim is involved.

Problem: generic wrong_direction fallback. Symptom: no-contact directional miss mislabeled. Root cause: settings inference replaces discarded contact fact. Evidence: current sweep/finalizer path and signed negative control. Failed approaches: none. Corrective action: observe existing rejection, retain/reset diagnostic-only bit. Verification: same actual coordinator controls. Files: equipment-pose-collision.js, session-coordinator.js and existing normal regression. Remaining uncertainty: post-change tests.

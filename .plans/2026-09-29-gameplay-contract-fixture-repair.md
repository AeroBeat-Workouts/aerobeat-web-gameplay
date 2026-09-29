# Repair gameplay collider fixture

Status: in progress
Bead: aerobeat-web-gameplay-asz

## Goal
Repair the gameplay-local `npm test` fixture rejected by the current shared collider settings schema; keep all changes inside gameplay. Reconfirm Flow bomb isolation and Boxing shared wrist scale before committing. No push/version change.

## Diagnosis
Observed `npm test` fails in `scripts/validate-equipment-pose-collision.js:75` with `TypeError: collider_bounds_input_invalid` from `resolveColliderBounds`; this direct shared-contract test provides only four volume keys while the shared schema now requires the wrist-bomb scale field. The Flow bomb function and coordinator were inspected and already use fixed 0.12 WU wrist radius, 0.5 target half-size, and unscaled ±timingWindowMs, with no equipment collider scale/depth/radius; Boxing now validates `wristBombColliderScale` through 0..2. No additional production change is warranted without a failing regression.

## Tasks
1. Complete the fixture settings shape under current shared contracts without changing geometry expectations.
2. Run focused Flow/Boxing regressions and full `npm test`, fix any gameplay-local failures, then syntax/diff checks.
3. Commit scoped change locally; report any remaining external-contract blockers.

## Result
The shared collider volume validator requires its complete six-field flow settings shape, including `visibleWristObstacleRadius` and `wristBombColliderScale`. The direct gameplay fixture supplied four fields; spread `colliderSettingsDefaults.flow` before overriding volume scale/depth, retaining the old bounds assertion. Production bomb and Boxing fixes already landed in commits `5e4fb6e` and `3b3479a`; verified source and focused regressions, so no redundant production edits. `node --check scripts/validate-equipment-pose-collision.js`, each of the equipment/Flow/Boxing focused scripts, and full `npm test` all pass. No contracts repo changes or version bump.

# Wrist-only Flow bomb collision

Status: in progress
Bead: aerobeat-web-gameplay-6hf

## Goal
Keep note contact on resolved equipment, but test Flow bombs only against two measured wrist-centered spheres. A bounded `wristBombColliderScale` controls their radius (0 disables contact; 1 default; 2 maximum). No other repository, version, or remote changes.

## Diagnosis
Observed: `evaluateColliderBombs` calls `resolvedSaberCapsuleContactsFlowTarget`, so a saber tip may detonate a bomb even when both wrists are outside its target. Intended: bomb contact requires either measured wrist sphere to overlap the bomb footprint within the existing depth/time window. Path: `advance` validates measured evidence and resolved poses; `evaluateFlowColliders` extracts wrist samples; `evaluateColliderBombs` currently uses equipment pose geometry. Root cause: bomb handler shares note equipment collision function. Alternative causes (pose validity and sample continuity) do not explain saber-tip contact; these remain existing upstream checks. No previous fix attempts known. Confirmed renderer's sphere base radius is 0.12 WU (0.24 WU diameter), with independent wrist-only scale; an integration follow-up removes all equipment scale/radius/depth influence on bombs. Minimal reproduction: wrist at (1, 0.35) below placement-5 box (bottom edge 0.5), saber capsule extending up into the box; existing handler contacts despite wrist sphere missing. Verify a strict equipment-only miss, a wrist contact, scale zero disable, and setting identity/validation.

## Tasks
1. Implement isolated wrist bomb sphere geometry and settings validation/identity in gameplay only.
2. Add coordinator regression for equipment-only miss, wrist hit, bounded scale and coverage behavior.
3. Run node syntax checks and npm test, inspect diff, close Bead, commit locally without push or version bump.

## Result
Implemented wrist-only bomb sphere tests against measured left/right wrist coordinates. The optional bounded scale defaults to 1 without changing legacy Flow settings shape or hash; explicit nondefault values alter run identity. Notes still use equipment poses, walls still use nose. Focused `node scripts/validate-flow-collider-collision.js`, changed JS `node --check`, `npm run test:integration`, and `git diff --check` pass. Full `npm test` is blocked by a pre-existing failure in `scripts/validate-equipment-pose-collision.js:75`: `resolveColliderBounds` rejects the test's incomplete settings record (`collider_bounds_input_invalid`). It fails before the focused Flow collision script runs; no prohibited contracts repository was modified. No browser tests requested. Integration clarification (Bead aerobeat-web-gameplay-ci9): wrist sphere radius is fixed at 0.12 WU independent of the equipment `colliderRadius`; bomb geometry and timeline coverage ignore equipment scale and forward/backward depth. Node tests do not exercise scene renderer placement.

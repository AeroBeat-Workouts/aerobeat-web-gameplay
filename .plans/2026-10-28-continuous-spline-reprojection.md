# Continuous spline collider reprojection — next public release

Status: approved by Derrick; inspection in progress.
Owner: Pico. Gameplay owns judgement; assembly owns projection integration, Test simulation and release. UI changes only as needed for the approved Test webcam-FPS variable.
Bead: aerobeat-web-assembly-3xji (assembly ledger).
Release target: 0.0.150, subject to checking current version before cutting.
Goal: goal-ba61dc6f-9a19-4ca0-8daa-2be43cf38205. Round cap: Maximum safe integer.

## Current decision and next check

Extend the existing equipment projection and collision evaluation rather than create another scorer. Inspect measured-pose history, swept interpolation, rotation projection and Test input generation first. The next acceptance check is a focused production-coordinator regression in which sparse pose updates miss a traversed beat today and reconstructed equipment samples score it using the unchanged evaluator.

Derrick approved execution and the next public release. No new approval is needed for bounded implementation choices. His phone Play test remains the final human usability check after release.

## Goal and requirements

Slow webcam updates make sabers jump across the grid. Reconstruct a timestamped spline between webcam updates and reproject equipment colliders at its sampled positions using the existing grid-position-to-equipment-rotation logic. Feed those samples into the current hit detection, timing, grading and already-hit state.

- Continuous reconstruction does not depend on a tracking-lost event.
- Approximation is explicitly accepted; no additional confidence penalties or stricter tiers.
- Equal endpoint positions are valid. Do not add a movement prerequisite.
- Flow and Boxing, in Play and Test, use the same rules.
- Add simulated webcam FPS to Test by controlling input update cadence, not rendering cadence.
- A visible cosmetic trail is not required for continuous reconstruction.
- Preserve lifecycle resets and timing semantics; inspect current history/late judgement handling before changing them.

## Scope and gate review

Keep current package/provenance, lifecycle and public release gates. Add focused regression coverage for the observed sparse-input failure and one actual built-browser check spanning Flow/Boxing and the Test variable. No new security, custody or provenance layer. No approved visual mockup applies; ui_fidelity is not declared. Preserve existing layouts except the approved Test variable.

## Tasks

1. In progress: inspect and diagnose current scoring/projection; record exact path and bounded implementation choice. Read repo READMEs and protect unrelated dirty work.
2. Pending: repair installed Beads CLI/database compatibility, verify reads/writes and claim the feature. Avoid treating schema-skew bypass as a permanent repair.
3. Pending: implement continuous timestamped spline samples and equipment reprojection through current scoring. Choose curve/sampling bounds from existing code and measured runtime cost.
4. Pending: add Test simulated webcam-FPS input with normal rendering independent of pose sampling.
5. Pending: test sparse updates, tracking gaps, equal endpoints, timing boundaries, existing consumed beats and reset/seek behavior. Run relevant existing gates and exercise the affected build. One focused independent review is appropriate for this cross-mode scoring change.
6. Pending: document affected gameplay/assembly/UI behavior, commit and push intentional changes, repin changed dependencies and cut the signed public release. Verify public direct/iframe and affected flow; retain 0.0.149 rollback. Close bead on delivered implementation, explicitly noting phone human acceptance is pending.

## References

- Existing plan: .plans/2026-10-26-latency-tolerant-collider-scoring.md.
- Existing implementation: src/flow-collider-collision.js, src/boxing-collider-collision.js, src/session-coordinator.js.
- Assembly release README describes 0.0.149 serving on loopback 4212.
- Related ledger issues: lojm, mtht, uexs, tm4m under aerobeat-web-assembly.

## Inspection, results and resume point

Initial state: gameplay README read; assembly README confirms live 0.0.149. Assembly has unrelated modified .beads/interactions.jsonl and untracked calibration screenshots: do not stage them. Installed bd 1.2.2 understands schema 53; assembly database is schema 66. Previous compatibility-flag writes were verified but do not repair the installation.

## Initial diagnosis (before product edits)

Observed failure: Derrick reports phone sabers jumping across the grid and missed swings despite 0.0.147 late-measurement scoring. This is physical-device feedback; the exact device trace is not yet available.
Expected: reconstruct samples between updates, reproject equipment at those positions, and use unchanged grading/consumption.
Execution path: assembly frame loop -> resolveEquipmentPoses -> gameplayEquipmentRecords; Flow orientation comes from computeFlowQuaternionTargets / squareRadialSaberTarget. Coordinator advance validates current poses -> evaluateFlowColliderNotesAndBombs / evaluateBoxingColliderEvents -> pushPoseHistoryForRole -> sweptSaberContactsFlowTarget / sweptGloveObbContactsBoxingTarget -> shared committed judgements.
Confirmed limitation: equipment-pose-collision.js resolvePoseAt linearly interpolates resolved anchors and slerps endpoint orientations. It does not reconstruct a wrist spline or rerun the position-dependent rotation projection at intermediate nodes. Both sweeps use 24 samples per whole segment; window boundaries may fall between them. pushPoseHistory drops every point before its cutoff, including a predecessor that could bracket the next sparse segment.
Leading hypothesis: interpolating endpoint rotations is not equivalent to projecting equipment at intermediate grid positions. This is a demonstrated implementation difference from the requested behavior, not yet an exclusive explanation of the phone's misses. Alternatives include timing finalization before a delayed endpoint arrives and frozen/recovery baseline resets. Inspect these during integration.
Previous change: measurement-time judgement admits delayed frames but cannot recreate position-dependent equipment geometry between frames.
Minimal regression: a sparse segment whose midpoint grid projection intersects a timed beat while endpoint orientation interpolation does not; also test a narrow timing window inside a long sample span. Then verify through the built Test FPS control.
Recommended seam: optional trusted constructor callback reprojectEquipmentPose(pose, context) for assembly's existing projection, applied to spline-resolved intermediate poses. Keep evaluator/consumed ids unchanged; standalone gameplay retains its existing resolved-pose orientation fallback when no projection owner is supplied.
Remaining uncertainty: actual phone cadence and curve fit quality require Derrick's physical Play test.

Delegation: coder/ops a3bc8fbf-2917-4c4c-a418-8e653a61bd62 verified running, repairing Beads CLI compatibility independently. No product ownership.

Next: implement shared spline sampling in gameplay and wire assembly's projection plus simulated Test cadence. Preserve exact measured endpoints, existing lifecycle resets, and normal grading.

### Gameplay implementation result (delegated coder)

Implemented bounded causal cubic Hermite reconstruction in the shared pose resolver. Each coordinate uses the previous/current timestamped secants to estimate its starting velocity, capped to 0..3 times the current signed secant; its ending velocity is the current secant. The curve stays within component endpoint bounds, uses no future point, preserves exact measured poses, keeps equal endpoints stationary, and is linear with only two points. Position is continuous; velocity at measured joints is not promised continuous. Trimming retains one predecessor at/before the cutoff, and existing clear/reset paths remain unchanged.

The backwards-compatible constructor option is `reprojectEquipmentPose(pose, context)`. Interior `pose` records have spline WU anchors, interpolated scale, and shortest-slerped orientation; `context` has exactly `{timestampMs, tangent:{x,y,z}}` with song milliseconds and WU/ms derivatives. The trusted projection owner returns a contract-valid resolved pose retaining anchor/identity. Exact endpoints bypass the callback. Both sweeps, guard sweeps, Flow near detection and Flow slice diagnostics consistently receive it. Standalone callers without it retain interpolated orientation.

Sampling now divides each segment's eligible overlap into 24 subdivisions and explicitly includes overlap endpoints and beat center. This fixes narrow-window holes in the full-gap lattice without widening eligibility. Three frozen-path fixtures had exact contact offsets tied to the previous lattice/linear curve; their expected sampled offsets were updated without altering tiers or committed times.

Focused normal-unit regressions cover nonlinear spline positions and derivatives, component bounds, exact/equal endpoints, two-point fallback, scale/orientation fallback, trusted-return validation, rotation reprojection changing a Flow verdict and slice, tiny timing slabs in both modes, trim predecessor and null clearing. Production coordinator regressions prove Flow projector-dependent scoring, Boxing spline-anchor-dependent scoring, exactly-once updates, and seek removing history/judgement truth. Boxing's scored cylinder remains world-Z/wrist anchored by its existing contract; art rotation alone cannot alter its contacts.

Finalization inspected: notes/punches commit Miss on strict playhead > max(center+window, center+1000ms), while guards use their existing windows. An endpoint arriving after an earlier tick already finalized the event cannot recover that Miss. Existing Play sweep eligibility is left untouched, including its optional later deadline; no timing expansion was introduced. Arbitrarily brief spatial contacts may still fall between the bounded probes. Actual phone cadence/fit and assembled Play/Test remain parent-owned acceptance checks.

Validation: full `npm test` passed (checks, complete unit gate including new spline suite, public integration). Existing `npm run test:browser` passed. Gameplay source/browser smoke is not assembled-product or physical-phone acceptance. Commit/push follows this result.

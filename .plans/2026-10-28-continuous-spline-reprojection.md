# Continuous spline collider reprojection — next public release

Status: gameplay implementation and source validation complete. The release owner records assembled acceptance and publication in ../aerobeat-web-assembly/.plans/2026-10-28-r150-spline-reprojection.md.
Owner: Pico. Gameplay owns judgement; assembly owns projection integration, Test simulation and release. UI changes only as needed for the approved Test webcam-FPS variable.
Bead: aerobeat-web-assembly-3xji (assembly ledger).
Release target: 0.0.150, subject to checking current version before cutting.
Goal: goal-ba61dc6f-9a19-4ca0-8daa-2be43cf38205. Round cap: Maximum safe integer.

## Current decision and next check

Gameplay spline/reprojection and focused production-coordinator regressions are pushed. The approved one-FPS held/no-frame follow-up now passes: idle ticks preserve the measurement bracket and advance clock/finalizers without admitting stale new evidence. Assembly owns projection integration, Test cadence control and built acceptance. Next: pin the gameplay follow-up and exercise the assembled Flow/Boxing Test FPS control with rendering independent of sampling.

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

1. Completed: inspected and diagnosed current scoring/projection; recorded exact path and bounded implementation choice. Read repo READMEs and protected unrelated dirty work.
2. Completed: repaired default bd to the already-approved AOM 1.3.1 pin, verified normal schema-66 reads without overrides and claimed the feature. No fleet policy or database migration changed.
3. Completed: continuous bounded spline samples and trusted equipment reprojection feed the existing shared scorer. Both measured idle ticks and frozen publications preserve the real measurement bracket. Source, seek, calibration and run resets remain boundaries.
4. Completed in assembly: Test simulated webcam FPS controls sampled evidence/visible equipment independently of rendering and preserves synthetic-feedback authority.
5. Source checks completed: sparse updates, frozen gaps, equal endpoints, timing, consumed beats and reset/seek regressions; full gameplay npm test and browser smoke pass. Focused assembly QA found the default-automatic-feedback sampling issue, now corrected. Actual signed/built acceptance is tracked by the assembly release plan.
6. Gameplay README, tests and implementation committed/pushed. Assembly owns final repin, signed public cutover, release documentation, bead closure and retained 0.0.149 rollback. Follow that release plan for current publication status; physical phone usability remains Derrick's human check.

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

Validation: full `npm test` passed (checks, complete unit gate including new spline suite, public integration). Existing `npm run test:browser` passed. Gameplay source/browser smoke is not assembled-product or physical-phone acceptance. Gameplay implementation committed and pushed as `f87266aeaca78422059b2379990513fa15de397e` on main.

### Parent integration checkpoint

Verified gameplay coder child: `eb19a375-fdfe-4fa0-ac31-a09da47fb992` (parent-provided verified identity). Parent reports assembly now supplies the constructor callback: Flow uses the existing `squareRadialSaberTarget`, base configuration and shoulder pivot (Test center); Boxing retains interpolated resolved orientation because its scored cylinder ignores art rotation. The Test control accepts 0 for native cadence or 1..60 FPS and sample-and-holds strict input plus preview while wall-clock advancement and rendering remain live. These are parent-reported implementation results; assembled acceptance is not yet claimed here.

Integration follow-up found by gameplay inspection: ordinary held measured publications older than 750ms fail active equipment-pose validation before duplicate recognition. Exact already-accepted duplicates should be handled as idle ticks before age admission, preserving history without pushing poses or scoring held geometry; clock advancement and existing finalization must continue. New evidence must retain the existing judgement-age bound. Do not relabel ordinary sparse holds as incrementing frozen ticks, which retime held positions and flatten the measurement gap. This follow-up remains unimplemented in the gameplay commit above.

### One-FPS held-publication diagnosis (approved follow-up)

Observed reproduction: the normal coordinator regression accepts a measurement at song/wall 700ms and republishes that exact evidence/pose every 100ms. At 1500ms the first held tick older than 750ms throws `equipment_poses_invalid: Equipment pose requires a current valid measured wrist` in `validateEquipmentPoseFrame`, before timeline advancement and evaluator duplicate recognition. Thus ordinary valid public calls do not reach the suspected history wipe; they fail earlier transactionally. The evaluator's null-sample branch would clear history if reached.

Expected: already-accepted unchanged publications and temporary no-frame input are idle ticks. They advance the clock/finalizers without adding, retiming or scoring evidence, and retain a bracket for the next fresh endpoint in the same run/source/calibration. New/stale/malformed observations still use the existing admission checks. Frozen ticks are not an alternative: they score held geometry at current time and would fill the gap with fabricated held nodes.

Root cause: age admission precedes duplicate/no-new-observation classification in pose validation and both evaluators. Previous spline work only reconstructed stored endpoints; it did not repair idle render ticks between them. The minimal fix is to recognize exact accepted evidence/poses (or temporary absent evidence with the accepted source/calibration) as idle before age admission. Cache only the most recently accepted publication and clear it with existing history reset boundaries. Regression first fails on the precise stale-publication error above; rerun it after the fix in Flow and Boxing, with held and null-evidence gaps, and verify no intermediate scores and unchanged deadlines/reset behavior. Actual assembled Test and phone fit remain parent-owned checks.

Follow-up implemented: exact accepted measured-evidence republications and explicit temporary null-evidence publications in the same source/calibration are idle ticks before age admission. Held equipment still passes the resolved contract and must match the accepted wrist anchors, mode and config identity. Valid render-time orientation/scale updates are ignored as evidence, matching the existing duplicate-frame semantics. Null-evidence ticks may omit equipment poses. No idle tick adds/retimes/scores a sample; all continue the authoritative clock and existing finalizers. The accepted-publication cache clears through the existing collider-history reset helper.

Regression results: before the fix, the one-FPS test failed at the first stale held render tick with the exact validation error above. After the fix, Flow and Boxing fresh endpoints one second apart reconstruct their original bracket despite intervening exact held or null-evidence ticks. Changed stale same-ID evidence still rejects; held render-time rotation/scale changes cannot score; strict late Miss commits at 2201ms for a 1200ms note, not at inclusive 2200ms; later endpoints cannot recover finalized truth; source switches cannot bridge old history/cache. Existing full lifecycle/configuration/seek/tracking reset regressions also pass. Full `npm test`, existing `npm run test:browser`, and `git diff --check` passed. This is gameplay/source-browser validation, not assembled Test or physical-phone acceptance.

### Frozen-to-measured reconstruction diagnosis (approved follow-up)

Observed reproduction: extending the production one-FPS regression with incrementing frozen ticks between measured endpoints at 700/1700ms fails the unchanged-window contact assertion for Flow. Every frozen tick is stamped at current song time by `measuredColliderSample`, then persisted by `pushPoseHistoryForRole`. Recovery therefore starts from the last synthetic held node at 1600ms rather than the real measurement at 700ms. This flattens the requested lost-to-found measured curve and shifts reconstructed contact later; the existing optional Play deadline can hide it as a late Flow hit. Boxing has the same shared history path.

Expected: F4 frozen evidence continues held-position point scoring at current song time, while only real measurements become persistent spline control points. Preserve all existing freshness, direction, finalization and lifecycle/source/calibration reset rules. The minimal fix is a transient one-point evaluation history for frozen frames and no insertion of synthetic held nodes into persistent measured-pose history. The next fresh measurement then brackets the last real measurement. This addresses history authority rather than widening timing or admitting stale measured evidence. Verify the same production gap regression in both modes, F4 current-point scoring, exactly once and unchanged reset boundaries.

Implemented: persistent resolved-pose histories now accept measured frames only. Frozen Flow/Boxing notes and guards use a transient one-point history at current song time, which also feeds Flow near/slice diagnostics. On recovery the real endpoint reconstructs against the retained real predecessor. The accepted-measurement idle cache survives frozen ticks so a temporary explicit no-frame publication during the same freeze can remain idle. Actual reset helpers still clear all persistent measured history/cache. A source change first seen on a frozen tick now explicitly takes the same reset path as a new freeze episode, preventing old-source reconstruction.

Validation: production frozen ticks between measured 700/1700ms endpoints now reconstruct contact inside the original note window in Flow and Boxing, including a temporary null-evidence tick during the freeze. Before the fix, the same Flow assertion failed because contact shifted outside that window. A source switch first seen on frozen evidence cannot reuse the prior source's measurement. Existing F4 point-hit/duplicate-tick/freeze-episode/reset tests remain gated; three exact-offset fixtures now assert frozen contacts at the actual current point time (850ms) and recovered sweep from the real 600ms predecessor (not the synthetic 900ms node). Scoring formulas, admission, direction gates, finalizers and lifecycle resets were not widened. Full `npm test`, `npm run test:browser` and `git diff --check` passed. Assembled/phone acceptance remains parent-owned.

### Default direction enforcement diagnosis (assembled blocker)

Parent's built browser check found valid sparse Boxing hook overlap with no judgement. Source confirms that after `sweptGloveObbContactsBoxingTarget` finds contact, the coordinator passes the original measured pair to `matchesBoxingAuthoredDirection`; its shared continuity predicate rejects measurement gaps over 150ms. Flow authored arrows use the same original-pair predicate after swept contact. The new normal production regression fails before the fix with `flow 540ms rightward direction: reconstructed default-rule contact scores` (0 judgements instead of 1), using the default enforcement and measured endpoints 5750/6290ms. This corroborates the reported path; geometry already reconstructs but direction does not.

Approved minimal fix: resolve a private local pair around the actual swept contact on the same bounded spline, within the existing 150ms segment bound and measured-history extent, and feed it into the unchanged direction predicate. Retain measured admission, authored direction/tolerance/minimum-travel checks, frozen point-only behavior, judgement/consumption and timing finalizers. Reconstructed pair identities are private direction inputs only, never independent evidence or consumed actions. Test default rightward hooks and Flow arrows at roughly 1/2 FPS, reverse-direction rejection, valid same-frame controls and exactly-once state; keep parent task-status edits intact.

Implemented a private `directionSamplesAtContact` helper for both production evaluators and Flow near qualification. It resolves the same spline at contact ±75ms, clipped to retained measured history, and gives the unchanged direction predicates a bounded local pair. Frozen one-point histories supply no invented motion. Local direction IDs/timestamps never enter evidence histories, public records, judged IDs or action consumption. The original 150ms continuity predicate remains unchanged for every other caller, including bomb coverage; enforcement, tolerance, minimum travel, timing and tiers are unchanged.

Production regressions now pass with default enforcement for rightward `hook_left` and Flow right arrows across 5750→6290ms and 5750→6850ms measurements. Reverse motion never scores the authored rightward event: a valid opposite-arrow Flow note or straight Boxing same-frame control can still score exactly once, proving rejection did not consume the frame or mutate the wrong event; the rejected event remains pending until its unchanged strict Miss deadline and then reports `wrong_direction`. The reverse control is centered on its traversed timing slab so the test isolates direction rather than unrelated spatial/timing noncontact. Full `npm test`, existing `npm run test:browser` and `git diff --check` passed. Parent task/status edits are preserved and included in the coherent gameplay follow-up; assembled browser rerun and release pin remain parent-owned.

# Latency-tolerant collider scoring for Flow and Boxing

Status: awaiting Derrick's approval (2026-10-26).
Owner repo: `aerobeat-web-gameplay` (judgement). Release path: `aerobeat-web-assembly`.

## Why this exists

Derrick played Flow while map generation saturated the CPU and clearly-correct swings
registered as misses. The same reported class of failure affects permanently slow webcam
pipelines, such as his phone.

Two earlier diagnoses were proposed and both are wrong for this symptom. The bsgen session
proposed collider substeps between samples; that sweep already exists (24 interpolated
substeps per stored-pose gap, `7ff628a`) and sparse sampling already scores. My own
intermediate proposal, neutralizing beats that arrived during a tracking outage, was rejected
correctly: it would punish every low-framerate device permanently.

## What I measured

I drove the real `AeroGameplaySessionCoordinator` with a geometrically correct Boxing swing at
centre 1000 ms and varied one variable at a time.

**Pose cadence (straight swing through the beat cell):** `great`/`good` score at 60, 30, 24,
20, 15, 12, 10, 8, 6 and 5 poses per second. Cadence is not the problem.

**Curvature (a 240 ms hook arc across the cell):** chord error between stored samples is
0.002 WU at 60 Hz and 0.293 WU at 5 Hz, against a collider tolerance of 0.34 WU glove radius
plus 0.5 WU cell half-width. Every cadence down to 5 Hz still scores. Curvature loss through
interpolation is not the problem either.

**Pipeline latency:** the frame is measured at `m` and reaches gameplay at `m + L`.

| Pipeline latency | Result |
| --- | --- |
| 0, 50, 100, 140 ms | `good` |
| **150 ms** | **nothing scores; `advance()` throws `equipment_poses_invalid` every frame** |
| 160, 200, 300, 500 ms | same throw, no score |

The cliff is exactly at `maximumColliderSampleFreshnessMs = 150`.

## Root cause

Two coupled defects, both about *when* a frame is allowed to be scored:

1. **A hard rejection on wall-clock age.** `measuredColliderSample` returns `null` when
   `now - measurementTimestampMs >= 150 ms`. The pose-frame validator then throws
   `equipment_poses_invalid` ("Equipment pose requires a current valid measured wrist"), the
   assembly surfaces it through `handleError` (last error, `error` event, presenter render) on
   every display frame, and no judgement is ever recorded. A pipeline whose end-to-end latency
   exceeds 150 ms therefore cannot score a single note, and raises errors while it fails. That
   is the reported experience: correct swings, no credit.
2. **Poses are placed on the wrong moment of the timeline.** Even below the cliff,
   `pushPoseHistoryForRole` stamps the swept pose history with the current playhead
   (`timelinePositionMs`) instead of the frame's measured song time, so every pose is displaced
   forward by the pipeline latency. The swept judge then tests the swing against the wrong
   part of the beat's window, which shaves margin off every contact and grows with latency.

The 150 ms gate made sense when judgement was a single snapshot scored "now". The judge is now
time-based: every sample already carries `songTimeMs = timelinePositionMs - ageMs`, so a late
frame does not need to be treated as a stale current pose. It needs to be placed at the moment
it was measured, and judged there.

## Fix

- Accept a measured frame for collider judgement on its own measurement time, regardless of
  wall-clock age, up to a bounded maximum of 750 ms. Beyond that the beat's Play deadline
  (centre + 1000 ms) can genuinely pass before its data arrives, so the bound is honest rather
  than arbitrary.
- Stamp the swept pose history (per hand, both modes) with the sample's measured song time
  rather than the playhead, and ignore a frame whose measured song time is not newer than the
  last stored node, so out-of-order frames stay idempotent.
- Make the pose-frame validator consistent with that: a pose is valid when it matches the
  anchors of the frame it was derived from, not when that frame is wall-clock fresh.
- Apply the same sample-age change to measured knee samples, which share the gate, and verify
  the existing knee tests.

Unchanged: collider geometry, the swept test, tier points, grading bands, hit/miss semantics,
score identity, and the tracking-freeze/safety-pause path. No new settings, so no Game Setup UI
change and no content re-import (collider settings come from Game Setup, not from chart
packages).

## Tasks

- [ ] **A. Regression test first.** Add a latency matrix to the collider tests: latency
  0/100/149/150/200/500 ms crossed with cadence 60/15/5 poses per second and both straight and
  curved swings. Before the fix, assert the current failure (throw / no judgement) so the test
  proves the defect; after the fix, assert every cell scores at tier `great` or `good` with no
  thrown error.
- [ ] **B. Implement measurement-time placement** in `measuredColliderSample` usage, the
  per-hand pose history push, and the pose-frame validator. Bounded age, monotonic history.
- [ ] **C. Keep healthy-tracking behavior identical.** Existing collider suites must pass
  unchanged except where they encode the 150 ms rejection itself; any such assertion is
  rewritten deliberately and called out in the commit message.
- [ ] **D. Prove it at the coordinator boundary.** With 500 ms latency, a correct swing scores
  and the run records no `equipment_poses_invalid` error; a wrong-cell swing still misses; a
  no-input run still misses with honest diagnostics; combo and score accounting unchanged.
- [ ] **E. Docs.** Update the gameplay README judgement notes for measurement-time placement and
  the 750 ms bound.
- [ ] **F. Release candidate.** Bump the assembly package version, build the signed friend-game
  snapshot, verify a Play run in the managed browser with the slow path exercised, then ask
  before re-pointing the public link.
- [ ] **G. Commit and push** gameplay then assembly, with this plan's status updated.

## Acceptance

- A correct swing scores `great` or `good` at every latency/cadence cell in the matrix, with no
  error emitted by the assembly.
- Healthy-tracking runs score exactly as they do today, including existing boundary assertions.
- A genuine miss under latency still misses, with diagnostics that name the real reason.
- `npm test` passes in `aerobeat-web-gameplay`, and the assembly build carries the fix into a
  browser-run Play session.

## Non-goals and deferred work

- **No spline or proximity grading.** Measured chord error (≤0.293 WU at 5 Hz) sits well inside
  the existing collider tolerance, so it would add grading machinery, a ruleset identity bump
  and re-baselined tests without fixing any miss I can reproduce. Worth revisiting only if a
  real device shows misses that the latency fix does not recover.
- **No outage neutralization.** Rejected, and unnecessary for the low-framerate case.
- Residual, unfixed here: a swing that happens entirely inside a tracking outage (>370 ms with
  no frames) is still lost, because no evidence exists. Also unchanged: a frozen held pose can
  still score a hit if the glove was resting on a target when the pipeline stalled.

## Risks

- Accepting older frames means a frame can be judged after its wall-clock moment. The 750 ms
  bound plus the existing Play deadline keep that window tight, and beats still finalize on
  their own deadline.
- A pipeline that produces wildly delayed frames interleaved with fresh ones could reorder
  history. The monotonic guard keeps stored nodes ordered; out-of-order frames are ignored.
- The real proof is Derrick's phone. I can simulate latency and cadence deterministically but not
  a specific device's jitter; his playtest remains the acceptance signal.
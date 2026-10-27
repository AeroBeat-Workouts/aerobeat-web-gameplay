# Latency-tolerant collider scoring for Flow and Boxing

Status: done. Landed in gameplay `ec30921`, assembly `0321e1d`, and cut over to the public link as live 0.0.147 on 2026-10-26 after Derrick authorised it.
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

- [x] **A. Regression test first.** Add a latency matrix to the collider tests: latency
  0/100/149/150/200/500 ms crossed with cadence 60/15/5 poses per second and both straight and
  curved swings. Before the fix, assert the current failure (throw / no judgement) so the test
  proves the defect; after the fix, assert every cell scores at tier `great` or `good` with no
  thrown error.
- [x] **B. Implement measurement-time placement** in `measuredColliderSample` usage, the
  per-hand pose history push, and the pose-frame validator. Bounded age, monotonic history.
- [x] **C. Keep healthy-tracking behavior identical.** Existing collider suites must pass
  unchanged except where they encode the 150 ms rejection itself; any such assertion is
  rewritten deliberately and called out in the commit message.
- [x] **D. Prove it at the coordinator boundary.** With 500 ms latency, a correct swing scores
  and the run records no `equipment_poses_invalid` error; a wrong-cell swing still misses; a
  no-input run still misses with honest diagnostics; combo and score accounting unchanged.
- [x] **E. Docs.** Update the gameplay README judgement notes for measurement-time placement and
  the 750 ms bound.
- [x] **F. Release candidate.** Bump the assembly package version, build the signed friend-game
  snapshot, verify a Play run in the managed browser with the slow path exercised, then ask
  before re-pointing the public link.
- [x] **G. Commit and push** gameplay then assembly, with this plan's status updated.

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
## Result (2026-10-26)

Gameplay commit `ec30921` (tree `baf71de3`), pushed to `main`. Assembly commit
`0321e1d` bumps to 0.0.147 and pins that gameplay commit.

What changed:

- `maximumColliderJudgementAgeMs = 750` bounds a measured collider frame; inside the bound the
  frame is accepted and scored at `timelinePositionMs - ageMs`.
- The swept pose history is stamped with each pose's measured song time, so latency no longer
  shifts the whole swing forward on the timeline. Out-of-order entries are inserted in place.
- Knee samples share the bound; both miss diagnostics report `stale_input` only past it.
- Frozen frames keep their age exemption and current-position scoring.

Test evidence:

- `scripts/validate-latency-tolerant-scoring.js` (new, wired into `test:unit`): both modes score
  `great`/`good` at latency 0/140/150/300/500/700 ms crossed with cadence 16/66/200 ms; a
  wrong-cell swing still misses with `wrong_collider`; zero-latency behaviour and an idle-hold
  hit are unchanged; an out-of-order frame neither throws nor double-judges.
- Full `npm test` green in gameplay and in the assembly.
- Four existing assertions encoded the 150 ms rejection; each now uses a frame past the 750 ms
  bound instead, so the rejection invariant stays covered. Listed in the gameplay commit message.

Signed candidate, not public: `aerobeat-web-assembly-private-heights-candidate/.tmp/boxing-r147-0321e1d`
(59 signed assets, manifest SHA-256 `901f2fd89814ee862abbfca9db4766621f77a85f6c6610a0f0aaa9715274089d`,
HTML `8d6f210e0074c3ec36298c9d8a9039f8ecd295a41e328684feaaa6c82f3d4932`, entry
`assets/index-DG7k5hs4.js` `5deeb1e26010ea97919ba333b60618e9a52ab0533e78d2b1c50b07177c89f68d`).
The shipped bundle passed real Play in Chromium, direct and cross-origin iframe (knee scoring:
correct hits score, wrong side / missing leg / frozen frame stay pending, Test stays visual-only).

Public cutover (2026-10-26, authorised by Derrick): a new systemd user unit `aerobeat-r147` serves
the frozen snapshot on loopback 4210 and the Funnel target moved from 4209 to 4210. Public HTTPS
HTML and entry JS match the frozen hashes exactly and report `0.0.147`. Public Chromium loaded it
directly and in a true cross-origin iframe with ready renderer/environment, `cpu-wasm` provider and
nonzero framebuffers, no unexpected page errors. Rollback: `systemctl --user stop aerobeat-r147`
then `tailscale funnel --bg --https=443 --yes http://127.0.0.1:4209` (0.0.146 still served there).

Accepted gap: the browser run proves the shipped bundle still plays and scores; it does not by
itself replay a delayed pipeline. The latency behaviour is proven at the coordinator boundary in
the owning repo. The field check is Derrick's phone and a CPU-saturated desktop session.

Follow-ups filed as non-blocking notes in the assembly README:

- `scripts/validate-friend-game-browser.js` still asserts gameplay asset paths under
  `assets/gameplay/0.0.12/` while the build ships `0.0.13`, so that QA script cannot pass. It is
  not wired into `npm test`; the knee-scored signed Play check is the path in use.

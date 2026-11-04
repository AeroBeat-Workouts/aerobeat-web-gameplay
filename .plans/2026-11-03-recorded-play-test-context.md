# Reproduce recorded Play rules in non-ranked Test

Status: approved supporting slice of Derrick's recording-first request. Owner: Pico; source coder delegated under assembly Bead kit4. Assembly plan: ../aerobeat-web-assembly/.plans/2026-11-03-human-movement-recording-replay.md.

Current status: source implementation, focused coordinator checks and full normal source suite complete; local commit pending parent review, no push. Next check: parent repins/builds Assembly and verifies a genuine exported recording loaded into the non-ranked Test environment with matching pending-event/deadline semantics. Public A/B artifacts remain unchanged.

## Required behavior

A recording played in Test must use the recorded Play note deadline and event eligibility, not ordinary pointer Test's different defaults. Play already allows the 1000 ms late note deadline; ordinary Test sweeps clip to the base window and deliberately exclude notes at/before a newly activated pointer epoch. Real capture has valid hits beyond the base 180 ms. Beat-zero and paused/resumed pending notes must also remain eligible in a full recorded Play replay.

Add the narrow configure option `{purpose:"visual_test", recordedPlayReplay:true}`. It is not a tuning control or live input authority. Strictly reject this option for Play and prevent a configured replay from being started as Play without normal reconfiguration/reset. Actual session/judgements stay visual_test and non-ranked. Existing Test interaction, epoch, evidence, equipment, identity, lease and geometry/direction checks remain unchanged.

## Source diagnosis and verification

Observed source path: `configureContent` accepts only purpose; ordinary Test epoch activation adds all already-centered events to its exclusions, and `productionEventEligible` also requires center strictly after activation. Flow/Boxing sweep after-windows use the existing Play deadline only for actual Play. This produces a rules mismatch for a full recording, not a geometry or evidence-admission failure.

Expected: only the exact recorded replay configuration retains pending recorded Play events and the existing Play after-window, while still requiring active strict Test interaction. Verify against actual Play and ordinary Test on identical measured late-contact frames, then test zero/post-center activation, epoch transitions, negative geometry/direction and lifecycle/admission boundaries. No prior attempted fix in this lane; source-supported temporal mismatch is the scoped root cause. Built recording-to-replay parity remains parent's integration check.

## Implementation and acceptance

- Extend exact configuration-option validation without accepting unknown keys or malformed flags. Configuration remains transactional.
- In this explicit Test context only, use the existing Play note after-window in Flow/Boxing sweeps and Play's temporal event eligibility (including center zero and already-centered pending notes). Do not add past-event exclusions when activating a replay epoch. Normal pointer Test keeps its existing exclusions/window.
- Preserve the context through a Test restart of the same configuration; clear it on normal reconfiguration/reset. Reject live/ranked start from the replay configuration. Do not change calibration, media leases, tracking policy, hazards, collision sizes, sampling or predicates.
- Add focused source tests using the actual coordinator: Play versus recorded-Test late valid hit; normal Test non-hit; zero/post-center activation; reverse-only/no-contact; non-ranked results and rejected Play escalation; reconfiguration/reset. Wire into normal npm test and run focused/full source suites.
- Update README and this owning plan, commit coherent source/tests/docs on current main, do not push until parent review. Parent owns assembly pin, recorded Test namespace/pacing/UI and actual export-load-replay acceptance.

## Source results

- Added private configuration context, installed only by exact `{purpose:"visual_test",recordedPlayReplay:true}`. Omit the flag for normal behavior; supplied false/string/undefined values, unknown fields, accessors and Play combinations reject transactionally. No public session/judgement schema or input authority changed.
- Context survives explicit Test restarts of the same configuration. Ordinary configure/reset clears it. Default and explicit Play starts from replay throw `recorded_play_replay_start_invalid` before advancing time or clearing run truth; normal reconfiguration/reset restores ordinary start gates.
- Only temporal selection changed: replay skips pointer-epoch past exclusions and permits pending zero/already-centered events while an interaction is active; replay Flow/Boxing note sweeps use the existing Play after-window. Normal pointer Test and live Play remain unchanged. Epoch transitions still clear history and require a fresh baseline. Geometry, direction, continuity, freshness, tracking/media/calibration, hazard predicates and explicit seek exclusions are untouched.
- Added `scripts/validate-recorded-play-test-context.js` to the normal source unit command. Actual coordinator checks compare all judgement fields except truthful `sessionPurpose` between Play and recorded Test for legal contacts later than +180 ms in both Flow and Boxing. Ordinary Test still misses. Boxing uses an existing legal rear-depth setting for its genuine later geometric contact; no volume/window setting is widened by the implementation.
- Focused controls pass: center zero and post-center activation, epoch reactivation of pending notes with baseline-only first frame, reverse-only/no-contact misses, no outcomes without interaction, missing input/poses rejection, authoritative epoch-position and monotonic epoch checks, unchanged audio-only Test lease ownership, non-ranked/local-only partitions, no Play escalation, restart/reconfigure/reset and descriptor/unknown-field transactional validation.
- `node scripts/validate-recorded-play-test-context.js` exited 0. `npm test` exited 0: four static checks, all 17 unit scripts and public integration. During fixture authoring, a reverse-only path ran off-grid with invalid cell metadata and a restart test rolled wall time backward; the strict existing gates rejected those fixtures, which were corrected without changing production gates.
- README now documents the exact opt-in/context lifecycle and distinguishes ordinary Test's base window from Play's already-existing late after-window. JSDoc documents the configuration-only boundary. No new scoring path, timing knob or provenance layer.
- Limits: source/coordinator evidence only. Parent owns Assembly namespace/admission/pacing/UI, recorded Play timing integration, pin/build and real export-load-replay checks. New source commit is intentionally unpushed pending review; no Assembly/deployment/service changes or human-playability claim.

This slice does not decode files, restore private calibration, implement a second scorer, change public A/B builds or claim physical recovery.

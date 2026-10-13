# Flow contact and close-pass grading

Status: owner implementation verified; awaiting parent QA/integration and Bead closure. Bead: `aerobeat-web-assembly-g2ny` (ledger owned by assembly). Owner: gameplay coder on current `main`.

Decision: Keep the existing Flow swept capsule geometry, eligible timing window, narrow quarter-window near area, evidence/telemetry boundaries, and all Boxing grading. Map a real Flow contact to Great regardless of early/late half; map `near_timing` noncontact to Good while preserving judgement `result: "miss"`; far misses remain Miss.

Next acceptance check: run `node scripts/validate-equipment-pose-collision.js` and `node scripts/validate-gameplay-session.js` with explicit blade hilt/tip early/late and behind-hilt near/far assertions, then demonstrate fix-only RED and restored GREEN with tests untouched.

Tasks:
1. Diagnose the existing Flow contact/near scoring path and baseline owner tests. Owner gameplay coder.
2. Add tight geometry and production-coordinator regression assertions; implement Flow-only tier mapping. Owner gameplay coder.
3. Run unit/check/browser gates, fix-only RED/restored GREEN, and document any limitations. Owner gameplay coder.
4. Update README and this plan, commit/push clean owner `main`; parent pins exact commit and handles visual GLB/iframe QA. Owner gameplay coder.

Gate review: preserve `npm test`, `npm run check`, and `npm run test:browser`; add assertions inside existing normal-gate scripts. No CI or runtime gate reduction. Assembly browser visuals, private previews, contracts and renderer are parent/other-owner responsibility. No public release.

Reference: approved assembly `.plans/2026-10-13-flow-center-swaps-three-tier-feedback.md`, accepted behavior items 2–3. Bead stays open for parent QA/audit/closure.

## Diagnostic record

Problem: Late real Flow blade contact scores Good, while a near noncontact scores Almost.
Observed symptom: Current `resolveScoringTier` maps Flow `hitDepthHalf:"back"` to `good` and `miss` with `near_timing` to `almost`; existing regression asserts Almost. This is source-observed, not physical-phone reproduction.
Root cause: The common tier resolver treats Flow swept contact's temporal half as reward depth and reuses a historical four-tier near mapping; the authoritative geometry already separates a real capsule intersection from narrow near noncontact.
Evidence: `equipment-pose-collision.js` returns contact or `nearMiss` using the canonical projected capsule and bounded quarter subwindow; `session-coordinator.js` calls the common resolver with the contact half and near diagnostic. Boxing shares the resolver.
Failed approaches: None attempted in this slice.
Corrective action: Branch Flow-only in tier resolution, leaving Boxing's existing temporal mapping intact and leaving collision/near thresholds unchanged.
Verification test: Assert real early/late hilt/tip Flow contacts score hit/Great/100; near behind hilt scores miss+near_timing/Good/50 with live combo; far miss scores miss/Miss/0 with broken combo. Keep independent geometry contact truth assertions; remove only Flow production branch in an isolated counterfactual run to show bug-specific RED, restore GREEN.
Related files/components: `src/session-coordinator.js`, `src/equipment-pose-collision.js`, `scripts/validate-gameplay-session.js`, `scripts/validate-equipment-pose-collision.js`.
Remaining uncertainty: Parent-owned browser GLB appearance cannot be proven by owner unit gate; parent will validate rendered blue Good and direct/iframe states.

## Results

- Geometry assertions cover hilt/tip at 900/1100 ms against center 1000, behind-hilt near at 1000, near timing exclusion at 1100, and far noncontact. Production coordinator assertions cover those four real hits (`hit`/`great`, score 100, combo 1) plus `miss`/`near_timing`/`good` (score 50, combo held) and `miss`/`wrong_collider`/`miss` (score 0, combo broken).
- `npm test`, `npm run test:browser`, `npm pack --dry-run --json`, `git diff --check`: passed. `npm test` includes `npm run check`, unit scripts, and public integration.
- Counterfactual: copied owner source/tests and installed dependencies to a temporary sibling fixture; removed only the Flow tier branch in copied production `session-coordinator.js`, leaving copied tests intact. `node scripts/validate-gameplay-session.js` exited 1 for expected near assertion (`'almost' !== 'good'`); restored production branch and same command exited 0. Two initial temporary fixture attempts failed import setup because the repo's audio import is sibling-relative; these are not claimed as RED evidence. Fixture removed.
- Browser test exercises package session/browser boundary, not rendered GLB visual assertions; parent assembly owns scored Play direct/iframe pixel proof.
- No eligibility, geometry, timing, source evidence, telemetry, contract, renderer, or Boxing behavior changed. Bead intentionally remains in progress for parent closure.


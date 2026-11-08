# Bomb circular-core collision

Status: owner source slice complete; Assembly built integration remains parent-owned. Owner: gameplay delegated coder. Bead: aerobeat-web-gameplay-689. Parent: assembly23yk; assembly owns pins, browser, version158 and publication.

## Decision / next check

Use optional `bombScale` (default1, finite .1..2) in both strict collider settings. Preserve legacy accepted shapes and default identities. Contact is measured wrist XY distance <= .22*bombScale + .12*wristBombColliderScale; wrist scale0 disables. No note equipment or timing changes.

Next acceptance: pure core center/tangent, corner/spike negatives, actual coordinator regression, existing normal owner checks. Assembly owns genuine built Flow/Boxing checks. No UI or mockup changes; ui_fidelity not applicable.

## Diagnosis before edits

Observed failure: wristBombSphereContactsFlowTarget subtracts .5 from absolute center distances and clamps to zero, testing a 1x1 square. Empty corners within that square therefore contact although the approved asset central sphere radius is .22WU. Expected: circle-circle contact including tangency, excluding spikes/ring. Execution: advance Flow branch -> evaluateFlowColliderNotesAndBombs -> evaluateColliderBombs -> helper. Boxing branch -> evaluateBoxingColliderNotes; current validateEventForVariant rejects bomb types. Parent notified to inspect assembly's Boxing hazard dispatch before claiming both-mode acceptance.

Root cause: wrong target geometry, not wrist/equipment size. Evidence: helper lines196-201 versus approved assembly asset geometry. Alternative hypotheses: equipment inflation contradicted by isolated helper; visual scaling currently absent from settings and needs explicit bombScale. No failed fixes attempted. Unknown: assembly Boxing bomb dispatch; parent inspection resolves it. Minimal reproduction: bomb placement5, wrist at(1.49,1.49) at center1000 contacts the square but not the .22core+.12wrist. Verification: pure helper and real coordinator cases for this point, .34 tangent and .34+epsilon miss, independently varied scales. Recommended correction changes only target distance/radius; preserve timing, coverage, freshness, lease, penalties and authored direction gates.

Debugging record: Problem wrong bomb silhouette; symptom empty square contacts; root cause box distance; evidence helper and approved asset radius; failed approaches none; corrective action circular core; verification focused geometry/coordinator plus existing suites; related flow-collider-collision.js and mode settings; uncertainty assembly Boxing dispatch.

## Tasks

1. [complete] Read source/plan/status; claim gameplay Bead and diagnose.
2. [complete] Replace square with scaled core; strict optional field and compatible identities in both validators; focused regressions.
3. [complete] Owner checks, normal tests/browser and README updated. Commit/push wrap-up follows below.

## Scope / gates

Retain all existing authorization, measured evidence, freshness, timing, continuity, coverage, lease, penalties and normal direction checks. No new framework, asset regeneration, CV or generalized physics. Do not add a new Boxing bomb contract without confirming actual dispatch with parent.

## Results

Implemented scaled circular core in flow-collider-collision.js and strict optional bombScale in Flow/Boxing validators. Default identities and all historical accepted settings shapes remain compatible. Nondefault bombScale is tagged in the identity tuple so it cannot alias the independently tuned wrist scale. Explicit undefined/null/nonfinite/out-of-bounds/new accessor fields reject.

Pure geometry and actual Flow coordinator cover bomb .1/1/2 × wrist0/1/2, core center/tangency/outside, old square corner/spike-only negatives, large rotated equipment independence and unchanged timing. Existing wrist-scale test moved its old box-specific reach sample from1.7 to1.4 intentionally. No coordinator gates changed. Native Boxing rejects bombs; the regression now records this existing contract and tests both validators/settings identities. Parent was notified repeatedly: actual Boxing bomb acceptance cannot be claimed from this source. Do not add native Boxing hazard penalties/admission speculatively.

PASS: focused Flow/Boxing scripts; npm test (all unit/public integration including direction reversal and wrong-direction negatives); npm run test:browser; npm pack --dry-run --json; git diff --check. Full tests/browser repeated after identity disambiguation and passed. These are owner-source/browser checks, not built Assembly acceptance. Parent maps bombScalePercent/100 and verifies the actual rendered Flow path in version158. Parent subsequently confirmed Assembly has one coordinator and no separate Boxing hazard route; preserve Boxing bomb rejection and unchanged glove geometry. Parent owns the pre-existing Boxing-support follow-up, with no positive Boxing bomb-contact claim.

Beads init restored remote-backed ledger missing from checkout; CLI auto-created init commit5ffdcf4. Owner product changes committed/pushed on clean main at1a9ef38059c3369693b34e4cfdeeeedd46838fa7 (tree34a49da6ec30b4df9e96a77a8ae4692c4f2a8206). A documentation-only clarification follows that commit. Remaining risk: legacy erroneous bomb contacts legitimately change; original recordings must remain untouched. No other physics/CV/UI changes.

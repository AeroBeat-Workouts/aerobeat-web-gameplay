# Select a Flow contact that also satisfies authored direction

Status: approved-scope local fix under Derrick's active goal to diagnose and fix confirmed pre/post-spline differences. Do not deploy or replace public A/B snapshots during this source work.
Owner: Pico; delegated coder implementation complete, pending parent integration review. Integration Bead: aerobeat-web-assembly-nrrv (assembly owns the ledger; gameplay has no Beads database).

Current decision: keep the source-only fix local and unpushed for parent review. Next acceptance check: parent repins/builds the affected Assembly locally and runs a genuinely scored reversal plus negative controls and runtime-cost comparison. No deployment is authorized.

## Observed defect and next passing test

Assembly `.tmp/reproduce-direction-reversal.mjs` feeds the real old/current coordinators identical valid measured evidence and equipment poses at 50 ms gaps. An up-note centered at 1000 ms first contacts the volume at 868.75 ms moving down, then contacts it at 1050 ms moving up. The existing geometry, 180 ms timing window and 45-degree direction predicate pass at the later time. Old 6f5d6a6 commits a great hit at 1050; current 20a1697 misses at 2050.

Current sweep returns only the earliest geometric contact. The coordinator rejects its local direction and skips the whole event, so the retained earlier contact masks the later valid stroke. The first regression must reproduce the current miss before the change and recover the later valid hit after it. Reverse-only/no-contact controls must remain misses.

## Diagnosis (before implementation)

- Exact observed failure: supplied real-coordinator reproduction returns current `wrong_direction` Miss committed at 2050 ms; old commits Hit at 1050 ms. Its witness reports first geometry at 868.75 ms failing up, and geometry plus up passing at 1050 ms.
- Expected behavior: select the earliest sampled contact satisfying both existing predicates.
- Execution path: measured evidence → bounded pose history → `sweptSaberContactsFlowTarget` returns first geometry → coordinator `directionSamplesAtContact` → rejected direction skips the event on every later tick.
- Root cause: retained wrong-way geometry masks all later valid contacts. Volume/window failure is contradicted by the later legal witness. Evidence rejection is contradicted by valid 50 ms samples reaching the evaluator. No previous fix was attempted in this lane.
- Verification: add a real-coordinator reversal assertion plus reverse-only/no-contact controls; run red before changing source. Existing lifecycle/direction/chord tests guard adjacent paths.
- Recommended correction: optional hit-time qualifier on the Flow sweep, defaulting to existing direct-caller behavior. Continue the unchanged lattice after rejected geometry. If geometry exists but never qualifies, return no hit, not a near fallback; preserve existing real-contact priority.
- Unknowns: extent of this trigger in human recordings and affected built-assembly cost; parent owns integration and physical acceptance.

Debugging record: Problem: masked valid reversal. Observed symptom: Miss2050 instead of Hit1050. Root cause: first geometry returned before direction qualification. Evidence: real coordinator differential and legal later witness. Failed approaches: none. Corrective action: joint qualification on existing samples. Verification test: focused reversal with negative controls. Components: Flow sweep and coordinator. Remaining uncertainty: human prevalence and built runtime cost.

## Scope

1. Add focused real-coordinator reversal and negative controls in existing project test style; wire into the normal test command.
2. Select the earliest sampled contact that satisfies BOTH geometry and the unchanged authored-direction predicate. Keep exact endpoint behavior, sample schedule, volume, timing windows, minimum movement, tolerance, evidence identity/freshness/continuity, near-miss precedence, hand/chord consumption and exactly-once rules.
3. Preserve direct callers that do not request direction qualification. Do not generic-cache callbacks or add public tuning switches. Avoid changing Boxing unless an actual shared-path requirement makes it necessary; report any separate Boxing defect as follow-up.
4. Cover reset/seek/source/calibration boundaries as relevant using existing tests; run focused and normal source suites.
5. Update the owning README and this plan with actual results. Commit coherent source/tests/docs on the current branch; parent handles assembly integration and public deployment decisions.
6. Parent builds the affected assembly locally, runs a genuine scored reversal/negative-control fixture with the corrected owning code, then compares runtime cost. Physical acceptance remains Derrick's.

## Evidence and limits

Fresh real runs share all 830 event IDs/times and matching Flow scale/depth/timing/direction settings: old 828 hits/2 misses, new 573/257. Source-verified upward notes miss 176/346 in new versus 2/346 old; downward notes 50/340 versus 0/340. This supports the reversal case as a plausible real trigger, not proof that every human miss has the same cause. Raw movement/calibration were not recorded. Generic wrong_direction labels cannot establish the failed predicate.

The separate assembly orientation-cache candidate 309b5a6 improves measured workload cost without changing scoring, but does not fix this contact-selection bug. It remains local and must not be confused with either live A/B artifact.

## Source implementation results

- Completed: focused coordinator regression, minimal Flow-only selection fix, normal test wiring, README update, source validation. Parent's originally untracked plan is intentionally included with these coherent changes.
- Red: `node scripts/validate-flow-direction-qualified-contact.js` exited 1 before the production edit: `earlier wrong-way contact must not mask later valid upward contact`, actual `miss`, expected `hit`. Reverse-only, no-contact and direction-opt-out assertions preceding it passed.
- Green: the identical focused test passed after the fix. It verifies one Great committed at 1050 ms with a positive qualifying timing offset, plus the negative controls and exactly-once behavior through 2100 ms.
- Supplied old/current reproduction rerun: old still hits at commitment 1050 ms with historical timing offset -131.25 ms; fixed current hits at commitment 1050 ms with qualifying timing offset +35.41666666666674 ms. Earliest geometry remains 868.75 ms for direct callers. The difference in timing offset is intentional: current now reports the earliest joint-qualified sample, not rejected earlier geometry.
- `npm test` exited 0: all four static checks, all 16 unit scripts (including the new regression), and public audio/content/input integration passed. Existing Flow lifecycle/source/calibration/continuity/chord/hazard tests and Boxing/Knee suites remain green; no Boxing source change was needed.
- Geometry, timing gates, endpoints, lattice and direction predicate are unchanged. Only geometric contacts invoke the optional qualifier. Wrong-way contacts can now require scanning more existing samples and reconstructing two local direction anchors per contact. No cache/infrastructure was introduced; bounded but potentially higher work remains for parent's built-Assembly cost check.
- Limits: source coordinator/public-boundary tests only. No browser/physical acceptance, public artifact update, deployment or service restart. No claim that all human misses or playability are fixed. Boxing still uses its existing first-geometry-then-direction path; no separate Boxing defect was reproduced in this lane.
- Resume: parent reviews gameplay diff/commit, then owns Assembly repin/build/QA, push decision and Bead closure. Gameplay commit is intentionally not pushed.

## Documentation and gates

Use existing API and contract boundaries. Keep all existing safety/provenance checks. Do not weaken a test/gate to obtain green results; report concrete incompatibility if encountered. Record source-only versus built-assembly proof separately. No public release/version change or service restart is part of the delegated gameplay slice.

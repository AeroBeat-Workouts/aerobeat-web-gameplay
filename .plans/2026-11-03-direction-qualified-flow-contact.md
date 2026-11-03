# Select a Flow contact that also satisfies authored direction

Status: approved-scope local fix under Derrick's active goal to diagnose and fix confirmed pre/post-spline differences. Do not deploy or replace public A/B snapshots during this source work.
Owner: Pico; delegated coder implementation complete, pending parent integration review. Integration Bead: aerobeat-web-assembly-nrrv (assembly owns the ledger; gameplay has no Beads database).

Current decision: parent reviewed/pushed 011c860 and verified corrected signed Assembly behavior, but observed a contact-heavy CPU regression. Continue this same approved source slice with a small mitigation; do not push the new commit before parent review. Next acceptance check: exact anchor parity, focused scoring/call-order tests and `npm test`, then parent's signed rebuild and same stress comparison. No deployment is authorized.

## Observed performance defect: diagnosis and mitigation

Parent reports signed Assembly ed68ea6 (stamp 475b…) passes genuine calibrated raw-landmark Play reversal/negative controls, full Assembly tests and Flow/Boxing 1/2 FPS cache OFF/ON matrix; QA qhrv GO. Human-phone acceptance remains pending.

- Exact observed failure: Assembly `.tmp/direction-stress-original.json` records maximum `advanceElapsedMs` 2.5; `.tmp/direction-stress-fixed.json` records 102.5. Both use twelve up notes 100 ms apart at placement 9 and fresh 50 ms down-then-held samples, all misses. Read-back confirms the supplied measurements.
- Expected behavior: retain identical scoring while avoiding full equipment reconstruction for direction-only XY reads and already direction-disqualified samples.
- Execution path: each pending Flow event rescans its existing lattice; each wrong-way geometric contact invokes direction sampling, which currently resolves two complete validated poses including quaternion interpolation just to read their anchors. Later samples still construct/project/collide complete equipment even after near fallback is permanently suppressed by first geometry.
- Most likely cause: necessary additional contact search from 011c860 repeats these expensive operations. The observed workload triggers precisely the retained wrong-way path. This is source-supported diagnosis, not an isolated profiler attribution; parent owns the same signed workload recheck.
- Alternatives: GC/JIT/scheduler noise can affect maximum time but does not justify repeated pose construction. Assembly projection overhead can also contribute; skipping projection only when direction is already false targets that path without changing its authority. No evidence of a scoring failure in the signed fixture.
- Previous approach: 011c860 correctly repaired selection but did not mitigate repeated expensive work; no optimization attempt has yet failed in this lane.
- Minimal reproduction: parent's existing `validate-flow-direction-reversal-browser.js` with `STRESS_NOTE_COUNT=12`, unchanged reverse-only fixture. No old-tree rerun is needed.
- Verification: exact anchor-vs-full-pose equality across interiors, endpoints, clamps, slope bounds and reversals; unchanged reversal/negative controls; test skipped projection after rejected real contact and continued geometry requirement for any qualified hit; existing full suite. Runtime improvement remains unclaimed until parent's signed comparison.
- Recommended fix: extract the same causal anchor/tangent arithmetic into one shared helper, use anchor-only resolution for local direction, and after the first real contact evaluate the pure time qualifier before later geometry. Keep the lattice and all scoring gates unchanged; no cache or public tuning.

Debugging record: Problem: contact-heavy CPU regression. Symptom: max advance 2.5→102.5 ms in parent's signed fixture. Root cause: repeated full equipment work on direction-only/rejected samples. Evidence: supplied timings and call path. Failed approaches: none. Corrective action: shared anchor interpolation plus safe direction-first short circuit after real contact. Verification: exact parity/scoring/call-order tests and parent's same signed workload. Components: equipment reconstruction and direction sampling. Remaining uncertainty: signed-build cost after mitigation.

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

## Initial source implementation results (011c860; subsequently pushed by parent)

- Completed: focused coordinator regression, minimal Flow-only selection fix, normal test wiring, README update, source validation. Parent's originally untracked plan is intentionally included with these coherent changes.
- Red: `node scripts/validate-flow-direction-qualified-contact.js` exited 1 before the production edit: `earlier wrong-way contact must not mask later valid upward contact`, actual `miss`, expected `hit`. Reverse-only, no-contact and direction-opt-out assertions preceding it passed.
- Green: the identical focused test passed after the fix. It verifies one Great committed at 1050 ms with a positive qualifying timing offset, plus the negative controls and exactly-once behavior through 2100 ms.
- Supplied old/current reproduction rerun: old still hits at commitment 1050 ms with historical timing offset -131.25 ms; fixed current hits at commitment 1050 ms with qualifying timing offset +35.41666666666674 ms. Earliest geometry remains 868.75 ms for direct callers. The difference in timing offset is intentional: current now reports the earliest joint-qualified sample, not rejected earlier geometry.
- `npm test` exited 0: all four static checks, all 16 unit scripts (including the new regression), and public audio/content/input integration passed. Existing Flow lifecycle/source/calibration/continuity/chord/hazard tests and Boxing/Knee suites remain green; no Boxing source change was needed.
- Geometry, timing gates, endpoints, lattice and direction predicate are unchanged. Only geometric contacts invoke the optional qualifier. Wrong-way contacts can now require scanning more existing samples and reconstructing two local direction anchors per contact. No cache/infrastructure was introduced; bounded but potentially higher work remains for parent's built-Assembly cost check.
- Limits: source coordinator/public-boundary tests only. No browser/physical acceptance, public artifact update, deployment or service restart. No claim that all human misses or playability are fixed. Boxing still uses its existing first-geometry-then-direction path; no separate Boxing defect was reproduced in this lane.
- Resume: parent reviews gameplay diff/commit, then owns Assembly repin/build/QA, push decision and Bead closure. Gameplay commit is intentionally not pushed.

## Performance mitigation results (same nrrv slice)

- Factored the existing causal anchor/tangent arithmetic into `interpolatePoseAnchor`. Full pose reconstruction uses the same operation order, orientation interpolation, validation and endpoint returns as before. `resolvePoseAnchorAt` shares that arithmetic but returns only the anchor; measured endpoint/clamp anchor identity is preserved.
- Local direction sampling now uses the anchor-only resolver. This shared read path also serves existing Boxing direction samples without changing Boxing contact selection or its predicate.
- Flow retains the original sample lattice. Before first real contact it performs geometry first, preserving initial noncontact/near behavior. Once real contact has suppressed near fallback, a failed pure time qualifier skips later full reconstruction/projection/collision. A passing qualifier still requires actual geometry. Existing geometry-only direct callers are unchanged. Qualifier call order is documented in source and README; no callback cache, hashes, public settings or arbitrary memoization were added.
- Extended the already-normal `validate-spline-reprojection.js`: exact three-coordinate anchor-vs-full-pose equality over fractional interiors, slope clamps, reversals, stationary components, single/two-point histories, endpoints and out-of-range clamps; exact endpoint identity; projection-call trace proving no later projection after wrong-way rejection; later qualifying noncontact cannot hit; later endpoint contact can hit; genuine no-contact near result remains unchanged and does not call the hit qualifier.
- Focused command `node scripts/validate-spline-reprojection.js && node scripts/validate-flow-direction-qualified-contact.js` exited 0. Reversal retains Great committed at 1050 ms with exact +35.41666666666674 ms offset; reverse-only/no-contact/direction opt-out/exactly-once controls pass. Initial scoring red/green was already established and was not repeated in an old tree.
- `npm test` exited 0: four static checks, all 16 unit scripts, public integration. No source scoring/gate regressions observed. `git diff --check` is the final whitespace gate before commit.
- Performance evidence is structural/source-only in this lane: skipped reconstruction is asserted, but no replacement signed Assembly was built here. Parent owns unchanged signed stress rerun and comparison against the recorded 102.5 ms maximum, plus reversal/negative controls before phone acceptance. This is a bounded CPU mitigation, not a claim of solved phone performance or human playability.
- New coherent source/docs/test commit remains unpushed pending parent review. No Assembly files, fixtures, services, deployed/public artifacts or tuning changed.

## Documentation and gates

Use existing API and contract boundaries. Keep all existing safety/provenance checks. Do not weaken a test/gate to obtain green results; report concrete incompatibility if encountered. Record source-only versus built-assembly proof separately. No public release/version change or service restart is part of the delegated gameplay slice.

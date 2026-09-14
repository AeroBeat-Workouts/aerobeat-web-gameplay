# aerobeat-web-gameplay

Deterministic browser gameplay-session and rules runtime for AeroBeat Web.

## Responsibility

`@aerobeat/web-gameplay` owns one `AeroGameplaySessionCoordinator` per connected game. It consumes immutable content-runtime events, authoritative audio-clock snapshots, calibrated measured body-grid evidence, and assembly-owned media-lease snapshots. It owns gameplay lifecycle, safety pauses, frozen countdowns, event judgement, evidence consumption, local score partitions, future-only paused swaps, and diagnostic shadow evaluation.

It does **not** own camera/CV, calibration math, audio playback, content loading/conversion, renderer/UI state, iframe transport, or process-wide media arbitration. It never accepts raw frames, media tracks, ZIP/audio bytes, pixels, provider objects, or leaderboard writes.

## Public API

```js
import { createAeroGameplaySessionCoordinator } from "@aerobeat/web-gameplay";

const gameplay = createAeroGameplaySessionCoordinator({
  sessionId: "game-1-session",
  instanceId: "game-1"
});

gameplay.configureContent({
  packageId: content.packageId,
  selectedVariant: content.selectedVariant,
  resolvedEvents: content.resolvedEvents,
  profileIdentity
});

gameplay.advance({
  timestampMs: performance.now(),
  clock: audio.getClockSnapshot(),
  input: bodyGrid.getSnapshot(),
  lease: mediaLease.getSnapshot()
});
```

Exports:

- `createAeroGameplaySessionCoordinator(options)`
- `createAeroPrototypeProfileRegistry(options)`
- `createFlowColliderSettings(value?)`, `defaultFlowColliderSettings`, `flowColliderSettingsBounds`, `flowColliderSettingsIdentity(value)`, `authoredDirectionCone(direction, toleranceDegrees)`
- `maximumColliderSampleFreshnessMs` / `maximumColliderSampleGapMs`
- `canonicalPrototypeProfileJson(value)` / synchronous `sha256PrototypeProfileHex(text)` (backed by shared incremental `@aerobeat/web-hash` `Sha256`)
- `aeroGameplaySessionCapabilities`
- `aeroGameplayPackageId`
- `aeroGameplaySessionServiceId`
- `aeroGameplayModeIds`

Coordinator operations:

- `configureContent(configuration, options?)`
- `requestStart(timestampMs, request?)` / `pause(timestampMs, reason?)` / `resume(timestampMs)`
- `advance({ timestampMs, clock, input?, lease? })`
- `synchronizePausedClock({ timestampMs, clock })`
- `applyFutureContent(configuration)`
- `setActiveEventIds(ids)` / `setLeaseSnapshot(snapshot)`
- `stop(timestampMs)` / `reset(timestampMs?)` / `destroy()`
- `getSnapshot()` / `getJudgements()` / `getObstacleOutcomes()` / `getHazardOutcomes()` / `getScorePartitions()` / `subscribe(listener)`

Calling `configureContent(configuration)` preserves the legacy Play configuration and publishes `play/calibrating`. Passing the exact optional `{ purpose: "visual_test" }` configuration options instead publishes configured `idle/visual_test`, or preserves an already active `playing/visual_test` / `paused_manual/visual_test` state and timeline while atomically replacing its exact content; it never introduces calibration truth. Calling `requestStart(timestampMs)` preserves the legacy normal-Play calibration/countdown path. An exact `aerobeat/gameplay_session_start` v1 request selects either `play` or `visual_test`. Visual Test starts at song time zero without calibration/input matching, remains unranked with no calibration identity, advances only from the authoritative audio clock, resumes directly from manual pause, and emits no real/shadow judgements or score partitions. Explicit starts are restarts: they increment the coordinator generation and clear prior run truth. Completion is terminal between-run truth: ordinary `pause()` cannot convert it to a resumable manual pause, while an explicit stopped-clock `synchronizePausedClock()` seek establishes a precise `paused_manual` timeline with `explicit_seek`. Normal Play judgements are exact v2 records with `sessionPurpose: "play"` and the authoritative `committedTimelinePositionMs`; synthetic demonstration feedback remains outside gameplay and scoring.

## Prototype profiles

`createAeroPrototypeProfileRegistry()` owns bounded, deterministic experimental profiles without selecting a production winner. Its API is `list`, `getActive`, `select`, `importProfiles`, `exportProfiles`, `reset`, `getSnapshot`, `subscribe`, and `destroy`.

Profiles use exactly three ownership classes:

- `live_visual`: applies live and is consumed by renderer adapters;
- `between_run_ruleset`: selection requires an explicit idle/paused/between-run session state and supplies immutable scoring settings plus its full tuning identity to score partitions;
- `converter_regeneration`: selecting a profile never mutates current chart truth. The registry reports a pending hash and `regenerationRequired` until `select` receives an explicitly matching `regeneratedPackageProfileHash` from newly generated package provenance. The active identity and outer telemetry carry the same derived regeneration value.

Exports are exact `aerobeat/prototype_profile_bundle` v1 records. Profile `contentHash` is bare lowercase SHA-256 over canonical schema/version/ID/version/class/settings; `bundleHash` is `sha256:`-prefixed over the canonical bundle body. The shared incremental `Sha256` owner preserves registry construction and the public helper as synchronous operations. Imports require the registry's exact bundle version and atomically replace only the validated profile set; incompatible versions reject without mutation and reset restores constructor defaults. Every public profile string and bundle version is individually capped at 256 characters. Imports reject missing or extra fields, accessors, classes, bytes, malformed settings, duplicate IDs, and hash mismatches. Defaults include visual default/compact, scoring locked/prototype-wide, and converter canonical/prototype-reach; all are labeled experimental.

`configureContent` and `applyFutureContent` accept optional exact `{comboBonusPerHit, hitPoints, missPenalty}` scoring settings. Locked defaults preserve one point per hit and zero miss penalty. Finite fractional prototype scores remain JSON-safe. Every partition includes the complete profile hash, immutable settings, and deterministic settings identity. Paused swaps retain each preserved event's original profile and settings; replacements use the selected profile.

## Lifecycle and Safety

The state machine follows the public session states: `idle -> calibrating -> countdown -> playing`, with manual/tracking pauses, completion, and destruction. Initial play requires a valid calibration. The input service's calibrated `countdown` readiness (and the additive `ready` state) are both accepted as safe-to-count-down. Sustained tracking/no-frame loss is reported as `gameplayPaused`/`freshCalibrationRequired`; gameplay immediately clears current evidence, cancels the countdown, freezes progress, latches the invalidated calibration ID, and enters `paused_tracking`. The invalidated ID cannot resume gameplay even if a later caller clears its upstream flag; a different fresh calibrated generation automatically starts a tracking-resume countdown.

Countdown is a wall-timestamp-driven frozen `3..2..1`. Each numeral remains active for at least one configured countdown step measured from that numeral's actual transition; one sparse or delayed `advance()` can move at most one step, so ordinary exact one-second calls still complete in three seconds while long main-thread gaps cannot skip a numeral. Both the authoritative audio clock's `playing` flag and position must remain frozen. Playback, paused-position drift, a stopped running clock, tracking loss, or lease loss fails closed without moving gameplay time. Ordinary `advance()` calls cannot move a manually paused timeline; assembly uses the explicit stopped-clock-only `synchronizePausedClock()` seam after an intentional audio seek. During play, only the supplied audio clock's `positionSeconds` establishes event timing, and timeline rollback fails closed without rewriting judgement truth. Current public audio snapshots are consumed directly, including an optional own `durationSeconds: undefined` field.

The assembly may inject a media-lease snapshot. Normal Play verifies that its `instanceId` owns camera and audio; Visual Test requires audio ownership only. Gameplay pauses when the purpose-specific lease is unavailable and never acquires, releases, or arbitrates the lease.

## Judgement Rules

- Timing windows are inclusive `[-180ms, +180ms]` by default. Flow Colliders accepts a bounded symmetric run setting and keeps a note pending through the inclusive late bound; miss commits only when timeline position is strict `>`.
- Measured evidence uses the active calibration. Existing rules retain their `<=150ms` boundary; Flow Colliders uses the stricter `<150ms` sample freshness contract documented below.
- Predicted data is not part of the gameplay evidence contract.
- Straight punches require continuous semantic or accepted-spatial qualification for at least `100ms`, measured from the input service's start timestamp.
- Positive evidence is consumed only after a complete match. Wrong/no/stale evidence cannot consume an action.
- One measured frame/action can score once. A guard and punch cannot both consume the same frame only when their inclusive windows overlap; different-category windows that do not overlap are not globally frame-blocked. Squat/weave checkpoints may score concurrently with a disjoint punch.
- `flow_colliders_v1` is the sole Flow ruleset (the visible `Flow` mode). It clips bounded previous/current measured calibrated wrist segments against a placement-derived logical 0.75 × 0.75 target footprint inflated by the run's private wrist radius in canonical athlete-grid XY. The authored wrist owns left/right notes, either wrist owns bombs, and only the nose owns walls. The complete inclusive timing slab is the green goal area; renderer projection, viewport/DPR, parallax, marker CSS size, PlayCanvas/GLB bounds, raw/provider coordinates, and visual depth never score. The retired Flow Grid ruleset no longer exists; its ID remains accepted only as a flow-mode variant input for historical reads and is never a new default.
- Flow Colliders enforces the authored direction by default: run-locked authored-direction enforcement uses the measured wrist vector and the existing mirrored athlete-coordinate convention for all eight directions. Runs that need the prior overlap-only behavior opt out with an explicit `enforceAuthoredDirection: false`. Directionless notes never require motion, so a stationary wrist can be struck by an approaching target.
- Flow Collider evidence is measured/current-generation only. A measured sample is fresh only while age is strict `<150ms`; a previous/current segment may span inclusive `<=150ms`. Samples reject stale/future evidence, duplicate or rollback frames, invalid bounds/confidence, source or calibration changes, and larger gaps; a rejected sample cannot bridge history. Each wrist is independent: one fresh valid wrist can score its owned notes and detonate bombs even when the other wrist is invalid. One sweep can resolve every genuinely intersected exact-same-center chord member, but a staggered member requires a later measured contact. Candidate ordering is deterministic and independent of source array order. Manual, tracking, lease, stopped-clock, countdown-clock, and audio-rollback pauses sever private wrist/nose continuity before recovery; each anchor's first later fresh valid frame independently seeds new history without point or swept contact; only its next continuous sample may evaluate.
- Semantic Track matches calibrated semantic actions.
- Spatial Grid additionally matches hand wrist target cells/subcells, cardinal source/destination entries, guard wrist targets, and nose-safe checkpoint cells.
- Actual content-runtime v2 envelopes are consumed directly: identity/timing stay on the resolved envelope while target, action, checkpoint, geometry, and lineage come from immutable `authoredBeat`. Interval events require exact positive `intervalStartTimestampMs` / `intervalEndTimestampMs`; authored beats cannot shadow resolved fields. Legacy resolved-event v1/`flow_grid_v1` input is rejected rather than reinterpreted. Flow (colliders) obstacles validate exact source geometry plus derived mask and use only measured calibrated nose points: top-left normalized nose coordinates map to lane/layer space, and analytical time+space segment clipping catches short walls between samples. Wrists never collide with walls.
- Every scoring event receives one exact immutable v2 hit/miss record with bounded semantic diagnostics, interpolated timing offset, authoritative commitment timeline, and recipe/ruleset identity. In Flow (colliders), arcs/bursts remain `ignored`, while bombs and walls produce separate `aerobeat/flow_hazard_outcome` v1 `contact`, `avoided`, or `unevaluated_tracking` records and never synthetic Great/Miss judgements. A simultaneous note/hazard batch commits note scores first and then one deduplicated combo break; overlapping walls do not repeat the consequence. Source lineage, map/score identity, active profile truth, and opaque Flow Collider settings identity remain in event/content generation and the local score partition rather than the exact v2 judgement record.

The four supported Boxing candidates are Semantic Track and Spatial Grid crossed with Row Family and Cut Family. Mode/ruleset/recipe pairings are exact. Variant, mode, ruleset, recipe, sorted modifier identity, ranked state, score hash, and complete profile identity form separate local-only score partitions. Runtime composites remain unranked. This package exposes no public leaderboard path.

## Flow Colliders assembly/content contract

This gameplay package intentionally does not derive or select Flow Colliders from old package bytes. The successor content/runtime integration must supply a selected variant with exact identity `{mode:"flow", rulesetId:"flow_colliders_v1", recipeId:null, ranked:true, localOnly:false}` and existing resolved-event v3 envelopes. Notes require authored `{type:"note", hand:"left"|"right", placement:0..11, direction?}`; bombs require `{type:"bomb", placement:0..11}`; walls retain the exact normalized source/gameplay/mask interval contract. Arc and burst shapes remain unsupported scoring objects. The logical note/bomb footprint is derived only from authored placement in canonical 4 × 3 athlete space; content and assembly must not provide renderer, GLB, screen, parallax, or camera geometry as scoring authority.

Assembly passes optional exact run configuration as `configureContent({..., flowColliderSettings})`:

```js
{
  schema: "aerobeat/flow_collider_settings",
  version: 1,
  algorithm: "swept_athlete_plane_v1",
  colliderRadius: 0.12,             // finite 0..0.5 logical units
  enforceAuthoredDirection: true,   // enforced by default (overlap-only is an explicit opt-out)
  directionToleranceDegrees: 45,    // finite 0..90
  timingWindowMs: 180               // finite 50..300, symmetric/inclusive
}
```

`createFlowColliderSettings()` supplies the frozen defaults; explicit values require every exact own enumerable data field, no extras/accessors, and the exported `flowColliderSettingsBounds`. Those values are cloned, validated, and locked for the run; a paused future-content swap cannot change them. Assembly must use the same settings when constructing its between-run profile identity. Gameplay additionally puts only an opaque `sha256:` `flowColliderSettingsIdentity` in the local score partition/key; it never republishes the tuning values. Omission selects the defaults above. Supplying this object for another ruleset rejects transactionally.

`authoredDirectionCone(direction, toleranceDegrees)` is the pure geometry for the "Visible tolerance range" debug overlay: it returns the target `center` (combine with `targetCenterForPlacement`), the authored `direction` unit vector in the same canonical up-positive athlete-grid space as the matcher, and the half-angle `toleranceDegrees`. The accepted-entry sector is every wrist-velocity direction within `±toleranceDegrees` of `direction` (full cone opens 2×`toleranceDegrees`); the renderer draws the sector arc itself. Unknown direction names return `null`.

The input boundary remains the current body-grid snapshot. Flow Colliders additionally requires the snapshot's bounded `sourceIdentity` plus measured `latestEvidence` with current-calibration `left_wrist`, `right_wrist`, and `nose` anchors. Anchor `x/y` are the input service's calibrated athlete-bounds-normalized canonical coordinates (`x` right-positive, `y` down-positive), not provider or screen coordinates; gameplay converts once to grid-world `sx=4*x-0.5`, `sy=2.5-3*y`. Thus canonical `sy` is up-positive and authored `up` uses positive `dy`, exactly matching the input service's semantic eight-way labels without a second mirror. Confidence, measurement timestamp, and measured source-frame identity remain required. These fields are private evaluation inputs only. Assembly must forward the connection-owned snapshot unchanged and must not cache, log, persist, project, or message collision history.

`getHazardOutcomes()` and snapshot `hazardOutcomes` expose only immutable semantic records `{schema:"aerobeat/flow_hazard_outcome",version:1,eventId,rulesetId:"flow_colliders_v1",kind:"bomb"|"wall",result:"contact"|"avoided"|"unevaluated_tracking",committedTimelinePositionMs,consequenceApplied}`. Score partitions add `bombContacts` and opaque `flowColliderSettingsIdentity`. No public collider output contains coordinates, bounds, radii, distances, vectors, confidence, calibration/source/frame IDs, or contact-episode IDs. `getObstacleOutcomes()` remains for compatibility; Flow Collider wall entries use the same privacy-safe semantic shape.

## Future Swaps and Shadows

`applyFutureContent()` is accepted only while paused. Judged, past, and assembly-declared active events remain authoritative; only non-duplicate future lineage is replaced. Each accepted event object captures immutable package/content-generation, chart, variant, recipe/ruleset, map/score hash, tuning-profile, and scoring-settings truth. Preserved events retain that exact generation even when a swap reuses the same variant ID, while replacements use the new generation. A preserved exact event ID owns collisions deterministically; stale replacements and duplicate preserved lineage are skipped. Existing judgement and score truth is never rewritten.

Optional shadow variants evaluate the same calibration-matched measured evidence within the same 150ms freshness limit without consuming actions or changing live judgements/scores. Shadow output is explicitly marked `shadow: true` and is diagnostic only.

## Boundary Policy

All public domain records are descriptor-cloned before field access; transport envelopes select exact own data fields without traversing irrelevant optional values. Accessors, classes, symbols, hidden fields, cycles, non-finite numbers, excessive depth/items/strings, duplicate event/lineage/action/anchor identities, bytes, and media objects fail closed. Content configuration and frame validation are transactional: rejected calls cannot leave unpublished timestamp, package, input, lease, or timeline mutation. Variant map/score hashes satisfy the public content-hash contract, lifecycle commands are state-gated, and configured leases gate start/resume immediately. Snapshots are deeply immutable JSON-like data. Listener exceptions are isolated. Every service instance has independent lifecycle, evidence-consumption, score, and subscriber state.

Runtime source imports only the documented package root of `@aerobeat/web-contracts`; audio/content/input services are injected through public snapshots rather than imported privately.

## Validation

```bash
npm run check
npm test
npm run test:browser
npm pack --dry-run --json
git diff --check
```

The content-hashed `fixtures/task11-prototype-profiles-v1.json` and `fixtures/task11-prototype-replay-v1.json` are validated in Node and the registry is smoke-tested in Chromium. Deterministic replay coverage includes unchanged Flow Grid and all four Boxing candidates, real content-runtime envelopes, Flow Grid direction/cell matching, exact valid/malformed bomb/obstacle/arc/burst geometry and intervals, ignored non-note scoring, transactional rejection, inclusive timing/freshness/qualification boundaries, standard/crossed guards, overlap-aware guard/punch exclusivity, disjoint checkpoint concurrency, positive-only evidence, one-action consumption, latched tracking recalibration, countdown/unsafe-clock timeline freeze, clock rollback, immediate lease gates, strict identity/hash bounds, future swaps, exact local score partitions, current-only shadows, listener isolation, record/array descriptor attacks, destroy, and multi-instance isolation. Flow Colliders adds exact inside/outside/tangent footprints, stationary and swept contacts, 150ms continuity, stale/duplicate/rollback/source/calibration rejection, all eight authored vectors, run locks/settings identity, same-time and staggered chord semantics, bomb/wall ownership and coverage, simultaneous note/hazard ordering, permutation independence, privacy scans, and lifecycle history clearing. A public-boundary integration test instantiates the actual current audio clock, content runtime, and input body-grid service and passes canonical interval envelopes across that boundary. Chromium additionally proves malformed Flow geometry rejection is transactional and valid non-notes remain ignored while retaining immutable serializable snapshots. Flow wall collision consumes only mode-neutral downward `aerobeat_top_left_grid` gameplay geometry and analytically samples the measured nose across every occupied row; provider-coordinate evidence remains immutable provenance, never collision authority and zero warning/error noise. Boxing squat/weave events retain and validate the same exact interval/source/gameplay/mask contract, but remain instantaneous mode-specific checkpoints: Semantic Track scores the action only, while Spatial Grid additionally requires the calibrated nose to occupy the exact derived safe-cell complement. Boxing never receives Flow continuous collision or obstacle outcomes.

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
- `canonicalPrototypeProfileJson(value)` / synchronous `sha256PrototypeProfileHex(text)` (backed by shared incremental `@aerobeat/web-hash` `Sha256`)
- `aeroGameplaySessionCapabilities`
- `aeroGameplayPackageId`
- `aeroGameplaySessionServiceId`
- `aeroGameplayModeIds`

Coordinator operations:

- `configureContent(configuration)`
- `requestStart(timestampMs, request?)` / `pause(timestampMs, reason?)` / `resume(timestampMs)`
- `advance({ timestampMs, clock, input?, lease? })`
- `synchronizePausedClock({ timestampMs, clock })`
- `applyFutureContent(configuration)`
- `setActiveEventIds(ids)` / `setLeaseSnapshot(snapshot)`
- `stop(timestampMs)` / `reset(timestampMs?)` / `destroy()`
- `getSnapshot()` / `getJudgements()` / `getScorePartitions()` / `subscribe(listener)`

Calling `requestStart(timestampMs)` preserves the legacy normal-Play calibration/countdown path. An exact `aerobeat/gameplay_session_start` v1 request selects either `play` or `visual_test`. Visual Test starts at song time zero without calibration/input matching, remains unranked with no calibration identity, advances only from the authoritative audio clock, resumes directly from manual pause, and emits no real/shadow judgements or score partitions. Explicit starts are restarts: they increment the coordinator generation and clear prior run truth. Completion is terminal between-run truth: ordinary `pause()` cannot convert it to a resumable manual pause, while an explicit stopped-clock `synchronizePausedClock()` seek establishes a precise `paused_manual` timeline with `explicit_seek`. Normal Play judgements are exact v2 records with `sessionPurpose: "play"` and the authoritative `committedTimelinePositionMs`; synthetic demonstration feedback remains outside gameplay and scoring.

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

- Timing windows are inclusive `[-180ms, +180ms]`.
- Measured evidence must be no more than `150ms` old and use the active calibration.
- Predicted data is not part of the gameplay evidence contract.
- Straight punches require continuous semantic or accepted-spatial qualification for at least `100ms`, measured from the input service's start timestamp.
- Positive evidence is consumed only after a complete match. Wrong/no/stale evidence cannot consume an action.
- One measured frame/action can score once. A guard and punch cannot both consume the same frame only when their inclusive windows overlap; different-category windows that do not overlap are not globally frame-blocked. Squat/weave checkpoints may score concurrently with a disjoint punch.
- Flow v2 matches note wrist evidence as before. Bombs, arcs, and bursts remain non-scoring `ignored` events. Obstacles instead validate exact source geometry plus derived mask and use only measured calibrated nose points: top-left normalized nose coordinates map to lane/layer space, and analytical time+space segment clipping catches short walls between samples. Wrists never collide.
- Semantic Track matches calibrated semantic actions.
- Spatial Grid additionally matches hand wrist target cells/subcells, cardinal source/destination entries, guard wrist targets, and nose-safe checkpoint cells.
- Actual content-runtime v2 envelopes are consumed directly: identity/timing stay on the resolved envelope while target, action, checkpoint, geometry, and lineage come from immutable `authoredBeat`. Interval events require exact positive `intervalStartTimestampMs` / `intervalEndTimestampMs`; authored beats cannot shadow resolved fields. Legacy resolved-event v1/`flow_grid_v1` input is rejected rather than reinterpreted.
- Every scoring event receives one exact immutable v2 hit/miss record with diagnostics, timing offset, authoritative commitment timeline, and recipe/ruleset identity; non-scoring bombs/arcs/bursts receive `ignored`. Obstacles produce separate bounded outcomes (`contact`, `avoided`, or `unevaluated_tracking`). Aggregate wall entry resets combo once, adds no direct points, and increments `obstacleContacts`; overlapping walls do not repeat the consequence. Source lineage, map/score identity, and active profile truth remain in the event/content generation and local score partition rather than the exact v2 judgement record.

The four supported Boxing candidates are Semantic Track and Spatial Grid crossed with Row Family and Cut Family. Mode/ruleset/recipe pairings are exact. Variant, mode, ruleset, recipe, sorted modifier identity, ranked state, score hash, and complete profile identity form separate local-only score partitions. Runtime composites remain unranked. This package exposes no public leaderboard path.

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

The content-hashed `fixtures/task11-prototype-profiles-v1.json` and `fixtures/task11-prototype-replay-v1.json` are validated in Node and the registry is smoke-tested in Chromium. Deterministic replay coverage includes Flow and all four Boxing candidates, real content-runtime envelopes, Flow direction/cell matching, exact valid/malformed bomb/obstacle/arc/burst geometry and intervals, ignored non-note scoring, transactional rejection, inclusive timing/freshness/qualification boundaries, standard/crossed guards, overlap-aware guard/punch exclusivity, disjoint checkpoint concurrency, positive-only evidence, one-action consumption, latched tracking recalibration, countdown/unsafe-clock timeline freeze, clock rollback, immediate lease gates, strict identity/hash bounds, future swaps, exact local score partitions, current-only shadows, listener isolation, record/array descriptor attacks, destroy, and multi-instance isolation. A public-boundary integration test instantiates the actual current audio clock, content runtime, and input body-grid service and passes canonical interval envelopes across that boundary. Chromium additionally proves malformed Flow geometry rejection is transactional and valid non-notes remain ignored while retaining immutable serializable snapshots. Flow wall collision consumes only mode-neutral downward `aerobeat_top_left_grid` gameplay geometry and analytically samples the measured nose across every occupied row; provider-coordinate evidence remains immutable provenance, never collision authority and zero warning/error noise. Boxing squat/weave events retain and validate the same exact interval/source/gameplay/mask contract, but remain instantaneous mode-specific checkpoints: Semantic Track scores the action only, while Spatial Grid additionally requires the calibrated nose to occupy the exact derived safe-cell complement. Boxing never receives Flow continuous collision or obstacle outcomes.

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
- `aeroGameplaySessionCapabilities`
- `aeroGameplayPackageId`
- `aeroGameplaySessionServiceId`
- `aeroGameplayModeIds`

Coordinator operations:

- `configureContent(configuration)`
- `requestStart(timestampMs)` / `pause(timestampMs, reason?)` / `resume(timestampMs)`
- `advance({ timestampMs, clock, input?, lease? })`
- `applyFutureContent(configuration)`
- `setActiveEventIds(ids)` / `setLeaseSnapshot(snapshot)`
- `stop(timestampMs)` / `reset(timestampMs?)` / `destroy()`
- `getSnapshot()` / `getJudgements()` / `getScorePartitions()` / `subscribe(listener)`

## Lifecycle and Safety

The state machine follows the public session states: `idle -> calibrating -> countdown -> playing`, with manual/tracking pauses, completion, and destruction. Initial play requires a valid calibration. Sustained tracking/no-frame loss is reported by the input service as `gameplayPaused`/`freshCalibrationRequired`; gameplay immediately clears current evidence, cancels the countdown, freezes progress, latches the invalidated calibration ID, and enters `paused_tracking`. The invalidated ID cannot resume gameplay even if a later caller clears its upstream flag; a different fresh ready calibration automatically starts a tracking-resume countdown.

Countdown is a wall-timestamp-driven frozen `3..2..1`; both the authoritative audio clock's `playing` flag and position must remain frozen. Playback or paused-position drift fails closed without moving gameplay time. During play, only the supplied audio clock's `positionSeconds` establishes event timing, and timeline rollback fails closed without rewriting judgement truth.

The assembly may inject a media-lease snapshot. Gameplay verifies that its `instanceId` owns camera and audio and pauses when it does not; it never acquires, releases, or arbitrates the lease.

## Judgement Rules

- Timing windows are inclusive `[-180ms, +180ms]`.
- Measured evidence must be no more than `150ms` old and use the active calibration.
- Predicted data is not part of the gameplay evidence contract.
- Straight punches require continuous semantic or accepted-spatial qualification for at least `100ms`, measured from the input service's start timestamp.
- Positive evidence is consumed only after a complete match. Wrong/no/stale evidence cannot consume an action.
- One measured frame/action can score once. A guard and punch cannot both consume the same frame while their windows overlap; squat/weave checkpoints may score concurrently with a disjoint punch.
- Flow matches athlete-space wrist cell and cardinal entry direction; non-note Flow source events are explicitly recorded as non-scoring `ignored` events.
- Semantic Track matches calibrated semantic actions.
- Spatial Grid additionally matches hand wrist target cells/subcells, cardinal source/destination entries, guard wrist targets, and nose-safe checkpoint cells.
- Actual content-runtime envelopes are consumed directly: identity/timing stay on the resolved envelope while target, action, checkpoint, and lineage fields come from its immutable `authoredBeat`.
- Every scoring event receives one immutable binary hit/miss record with diagnostics, timeline offset, source lineage, recipe/ruleset, map/score identity, and active profile hashes; non-scoring Flow source events receive an immutable `ignored` record.

The four supported Boxing candidates are Semantic Track and Spatial Grid crossed with Row Family and Cut Family. Mode/ruleset/recipe pairings are exact. Variant, mode, ruleset, recipe, sorted modifier identity, ranked state, score hash, and complete profile identity form separate local-only score partitions. Runtime composites remain unranked. This package exposes no public leaderboard path.

## Future Swaps and Shadows

`applyFutureContent()` is accepted only while paused. Judged, past, and assembly-declared active events remain authoritative; only non-duplicate future lineage is replaced. Existing judgement and score truth is never rewritten.

Optional shadow variants evaluate the same calibration-matched measured evidence within the same 150ms freshness limit without consuming actions or changing live judgements/scores. Shadow output is explicitly marked `shadow: true` and is diagnostic only.

## Boundary Policy

All public records are descriptor-cloned before field access. Accessors, classes, symbols, hidden fields, cycles, non-finite numbers, excessive depth/items/strings, bytes, and media objects fail closed. Snapshots are deeply immutable JSON-like data. Listener exceptions are isolated. Every service instance has independent lifecycle, evidence-consumption, score, and subscriber state.

Runtime source imports only the documented package root of `@aerobeat/web-contracts`; audio/content/input services are injected through public snapshots rather than imported privately.

## Validation

```bash
npm run check
npm test
npm run test:browser
npm pack --dry-run --json
git diff --check
```

Deterministic replay coverage includes all four Boxing candidates, real content-runtime envelopes, Flow direction/cell matching and ignored source events, inclusive timing/freshness/qualification boundaries, standard/crossed guards, guard/punch exclusivity, disjoint checkpoint concurrency, positive-only evidence, one-action consumption, latched tracking recalibration, countdown position freeze, clock rollback, lease pauses, future swaps, exact local score partitions, current-only shadows, listener isolation, record/array descriptor attacks, destroy, and multi-instance isolation. Chromium drives `idle -> calibrating -> countdown -> playing -> paused_tracking -> countdown` through the public package with immutable serializable snapshots and zero warning/error noise.

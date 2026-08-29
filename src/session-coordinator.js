// @ts-check

import {
  conversionRecipeIds,
  isContentHash,
  isGameplayEvidenceSnapshot,
  isMediaLeaseSnapshot,
  isPrototypeTuningIdentity,
  prototypeJudgementDefaults,
  readinessStates,
  rulesetIds
} from "@aerobeat/web-contracts";
import {
  cloneGameplayData,
  compareCodePoints,
  gameplayError,
  isPlainRecord,
  requireDataRecordFields,
  requireNonNegativeNumber,
  requireRecord,
  requireString,
  requireStringArray
} from "./data.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {import("@aerobeat/web-contracts").AeroGameplayEvidenceSnapshot} AeroGameplayEvidenceSnapshot */
/** @typedef {import("@aerobeat/web-contracts").AeroGameplayJudgement} AeroGameplayJudgement */
/** @typedef {import("@aerobeat/web-contracts").AeroGameplaySessionState} AeroGameplaySessionState */
/** @typedef {import("@aerobeat/web-contracts").AeroCountdownReason} AeroCountdownReason */

/** @type {readonly string[]} */
const CHECKPOINT_ACTIONS = Object.freeze(["guard", "crossed_guard", "squat", "weave_left", "weave_right"]);
/** @type {readonly string[]} */
const PUNCH_ACTIONS = Object.freeze(["straight_left", "straight_right", "hook_left", "hook_right", "uppercut_left", "uppercut_right"]);
/** @type {readonly string[]} */
const SUPPORTED_MODIFIERS = Object.freeze(["any_punch", "cross_body", "crossed_guard", "no_squats", "no_weaves"]);

/**
 * @typedef {Object} GameplayCoordinatorOptions
 * @property {string} [sessionId]
 * @property {string} [instanceId]
 * @property {number} [countdownStepMs]
 * @property {(error: unknown) => void} [onListenerError]
 */

/**
 * @typedef {Object} GameplayContentConfiguration
 * @property {string} packageId
 * @property {DataRecord} selectedVariant
 * @property {readonly DataRecord[]} resolvedEvents
 * @property {DataRecord} [profileIdentity]
 * @property {DataRecord} [scoringSettings]
 * @property {readonly DataRecord[]} [shadowVariants]
 */

/**
 * Create a deterministic per-game session coordinator. Wall timestamps drive safety/countdown;
 * the injected audio clock is the sole gameplay timeline authority.
 *
 * @param {GameplayCoordinatorOptions} [options]
 */
export function createAeroGameplaySessionCoordinator(options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const sessionId = normalizedOptions.sessionId;
  const instanceId = normalizedOptions.instanceId;
  const countdownStepMs = normalizedOptions.countdownStepMs;
  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let state = /** @type {AeroGameplaySessionState} */ ("idle");
  let timestampMs = 0;
  let timelinePositionMs = 0;
  let packageId = null;
  let variant = /** @type {DataRecord | null} */ (null);
  let profileIdentity = /** @type {DataRecord} */ (defaultProfileIdentity());
  let scoringSettings = /** @type {DataRecord} */ (defaultScoringSettings());
  let events = /** @type {readonly DataRecord[]} */ (Object.freeze([]));
  let contentGeneration = 0;
  let eventTruth = new WeakMap();
  let shadowVariants = /** @type {readonly DataRecord[]} */ (Object.freeze([]));
  let calibrationId = null;
  let safetyReady = false;
  let freshCalibrationRequired = true;
  let pauseReason = /** @type {string | null} */ (null);
  let countdown = /** @type {DataRecord} */ (inactiveCountdown(0));
  let countdownStartedAtMs = 0;
  let countdownTimelinePositionMs = 0;
  let countdownReason = /** @type {AeroCountdownReason | null} */ (null);
  let invalidatedCalibrationId = /** @type {string | null} */ (null);
  let lastInput = /** @type {DataRecord | null} */ (null);
  let latestEvidence = /** @type {AeroGameplayEvidenceSnapshot | null} */ (null);
  let latestEvidenceTimelineMs = 0;
  let lastEvidenceFrameId = null;
  let leaseSnapshot = /** @type {DataRecord | null} */ (null);
  const judgedIds = new Set();
  let activeIds = new Set();
  const judgements = /** @type {AeroGameplayJudgement[]} */ ([]);
  const shadowJudgements = /** @type {AeroGameplayJudgement[]} */ ([]);
  const shadowConsumed = new Set();
  const consumedActions = new Set();
  const consumedGuardPunchWindows = new Map();
  const partitions = new Map();
  let snapshot = makeSnapshot(null);

  const service = Object.freeze({
    configureContent,
    requestStart,
    pause,
    resume,
    advance,
    synchronizePausedClock,
    applyFutureContent,
    setActiveEventIds,
    setLeaseSnapshot,
    stop,
    reset,
    getSnapshot: () => snapshot,
    getJudgements: () => Object.freeze([...judgements]),
    getScorePartitions: () => Object.freeze([...partitions.values()].map((entry) => Object.freeze({ ...entry }))),
    subscribe,
    destroy
  });
  return service;

  /** @param {GameplayContentConfiguration} configuration */
  function configureContent(configuration) {
    assertOpen();
    const source = requireRecord(configuration, "content_configuration_invalid", 1500000);
    const nextPackageId = requireString(source.packageId, "content_package_invalid");
    const nextVariant = normalizeVariant(source.selectedVariant);
    const nextEvents = normalizeEvents(source.resolvedEvents, nextVariant);
    const nextProfileIdentity = source.profileIdentity === undefined ? defaultProfileIdentity() : normalizeProfile(source.profileIdentity);
    const nextScoringSettings = source.scoringSettings === undefined ? defaultScoringSettings() : normalizeScoringSettings(source.scoringSettings);
    const nextShadowVariants = source.shadowVariants === undefined ? Object.freeze([]) : normalizeShadowVariants(source.shadowVariants);
    const nextContentGeneration = contentGeneration + 1;
    const nextEventTruth = bindEventTruth(nextEvents, nextPackageId, nextContentGeneration, nextVariant, nextProfileIdentity, nextScoringSettings);
    packageId = nextPackageId;
    variant = nextVariant;
    contentGeneration = nextContentGeneration;
    eventTruth = nextEventTruth;
    events = nextEvents;
    profileIdentity = nextProfileIdentity;
    scoringSettings = nextScoringSettings;
    shadowVariants = nextShadowVariants;
    clearRunTruth();
    state = "calibrating";
    pauseReason = "calibration_required";
    generation += 1;
    publish(null);
    return snapshot;
  }

  /** @param {number} atTimestampMs */
  function requestStart(atTimestampMs) {
    assertConfigured();
    if (state !== "calibrating") throw gameplayError("session_state_invalid", "Initial start requires the calibrating state");
    advanceTimestamp(atTimestampMs);
    if (!hasRequiredLease()) {
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
      publish(null);
      return Object.freeze({ accepted: false, reason: "media_lease_unavailable" });
    }
    if (!safetyReady || freshCalibrationRequired || calibrationId === null) {
      state = "calibrating";
      pauseReason = "calibration_required";
      publish(null);
      return Object.freeze({ accepted: false, reason: "calibration_required" });
    }
    beginCountdown("initial_start");
    return Object.freeze({ accepted: true, reason: null });
  }

  /** @param {number} atTimestampMs @param {string} [reason] */
  function pause(atTimestampMs, reason = "manual") {
    assertOpen();
    advanceTimestamp(atTimestampMs);
    if (state === "destroyed") return snapshot;
    cancelCountdown();
    state = "paused_manual";
    pauseReason = boundedReason(reason);
    publish(null);
    return snapshot;
  }

  /** @param {number} atTimestampMs */
  function resume(atTimestampMs) {
    assertConfigured();
    if (state !== "paused_manual" && state !== "paused_tracking") throw gameplayError("session_state_invalid", "Resume requires a paused session");
    advanceTimestamp(atTimestampMs);
    if (!hasRequiredLease()) {
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
      publish(null);
      return Object.freeze({ accepted: false, reason: "media_lease_unavailable" });
    }
    if (!safetyReady || freshCalibrationRequired || calibrationId === null) {
      state = freshCalibrationRequired ? "paused_tracking" : "calibrating";
      pauseReason = "calibration_required";
      publish(null);
      return Object.freeze({ accepted: false, reason: "calibration_required" });
    }
    beginCountdown(state === "paused_tracking" ? "tracking_resume" : "manual_resume");
    return Object.freeze({ accepted: true, reason: null });
  }

  /**
   * Advance deterministic state using one audio-clock and optional input sample.
   *
   * @param {{timestampMs: number, clock: unknown, input?: unknown, lease?: unknown}} frame
   */
  function advance(frame) {
    assertOpen();
    const safeFrame = requireDataRecordFields(frame, "advance_frame_invalid", ["timestampMs", "clock", "input", "lease"]);
    const nextTimestampMs = requireNonNegativeNumber(safeFrame.timestampMs, "timestamp_invalid");
    if (nextTimestampMs < timestampMs) throw gameplayError("timestamp_rollback", "Gameplay timestamps must not roll back");
    const clock = normalizeClock(safeFrame.clock);
    const nextLease = safeFrame.lease === undefined ? null : normalizeLeaseSnapshot(safeFrame.lease);
    const nextInput = safeFrame.input === undefined ? null : normalizeInputSnapshot(safeFrame.input);
    const enteredState = state;
    const enteredAsCountdown = enteredState === "countdown";
    const previousTimelinePositionMs = timelinePositionMs;
    timestampMs = nextTimestampMs;
    if (nextLease !== null) leaseSnapshot = nextLease;
    if (nextInput !== null) commitInput(nextInput);
    enforceLease();
    enforceSafety();
    if (enteredAsCountdown && state === "countdown") advanceCountdown(clock);
    if (enteredState === "playing" && state === "playing") {
      if (!clock.playing) {
        state = "paused_manual";
        pauseReason = "audio_clock_not_playing";
      } else if (clock.positionMs < previousTimelinePositionMs) {
        state = "paused_manual";
        pauseReason = "audio_clock_rollback";
      } else {
        timelinePositionMs = clock.positionMs;
        captureEvidenceForTimeline();
        judgeLiveEvents();
        judgeShadowEvents();
        if (events.length > 0 && judgedIds.size >= events.length) {
          state = "completed";
          pauseReason = null;
        }
      }
    } else if (enteredState !== "playing" && enteredState !== "countdown" && enteredState !== "paused_manual" && enteredState !== "paused_tracking" && state !== "paused_tracking") {
      timelinePositionMs = clock.positionMs;
    }
    publish(null);
    return snapshot;
  }

  /**
   * Synchronize an explicit paused seek from the authoritative audio clock.
   * Ordinary advance frames cannot move a manually paused timeline.
   *
   * @param {{timestampMs: number, clock: unknown}} frame
   */
  function synchronizePausedClock(frame) {
    assertConfigured();
    if (state !== "paused_manual") throw gameplayError("session_state_invalid", "Paused clock synchronization requires a manual pause");
    const safeFrame = requireDataRecordFields(frame, "paused_clock_frame_invalid", ["timestampMs", "clock"]);
    const nextTimestampMs = requireNonNegativeNumber(safeFrame.timestampMs, "timestamp_invalid");
    if (nextTimestampMs < timestampMs) throw gameplayError("timestamp_rollback", "Gameplay timestamps must not roll back");
    const clock = normalizeClock(safeFrame.clock);
    if (clock.playing) throw gameplayError("paused_clock_not_frozen", "Paused clock synchronization requires a stopped audio clock");
    timestampMs = nextTimestampMs;
    timelinePositionMs = clock.positionMs;
    publish(null);
    return snapshot;
  }

  /** @param {GameplayContentConfiguration} configuration */
  function applyFutureContent(configuration) {
    assertConfigured();
    if (state === "playing" || state === "countdown") throw gameplayError("variant_swap_requires_pause", "Future variant swaps require a paused session");
    const source = requireRecord(configuration, "content_configuration_invalid", 1500000);
    const nextPackageId = requireString(source.packageId, "content_package_invalid");
    if (nextPackageId !== packageId) throw gameplayError("variant_swap_package_mismatch", "Future variant swaps must remain in the loaded package");
    const nextVariant = normalizeVariant(source.selectedVariant);
    const nextEvents = normalizeEvents(source.resolvedEvents, nextVariant);
    const nextProfileIdentity = source.profileIdentity === undefined ? profileIdentity : normalizeProfile(source.profileIdentity);
    const nextScoringSettings = source.scoringSettings === undefined ? scoringSettings : normalizeScoringSettings(source.scoringSettings);
    const nextShadowVariants = source.shadowVariants === undefined ? shadowVariants : normalizeShadowVariants(source.shadowVariants);
    const preserve = new Map(events.filter((event) => shouldPreserveEvent(event)).map((event) => [String(event.eventId), event]));
    const lineage = new Set([...preserve.values()].flatMap((event) => lineageIds(event)));
    const merged = [...preserve.values()];
    const acceptedNextEvents = [];
    for (const event of nextEvents) {
      if (preserve.has(String(event.eventId))) continue;
      if (Number(event.centerTimestampMs) <= timelinePositionMs) continue;
      const eventLineage = lineageIds(event);
      if (eventLineage.some((id) => lineage.has(id))) continue;
      merged.push(event);
      acceptedNextEvents.push(event);
    }
    if (merged.length > 100000) throw gameplayError("content_events_invalid", "Future content merge exceeds the event limit");
    merged.sort(eventOrder);
    const nextContentGeneration = contentGeneration + 1;
    const nextEventTruth = new WeakMap();
    for (const event of preserve.values()) {
      const truth = eventTruth.get(event);
      if (!truth) throw gameplayError("event_truth_missing", "Preserved events require immutable content-generation truth");
      nextEventTruth.set(event, truth);
    }
    for (const event of acceptedNextEvents) nextEventTruth.set(event, makeEventTruth(nextPackageId, nextContentGeneration, nextVariant, nextProfileIdentity, nextScoringSettings));
    events = Object.freeze(merged);
    variant = nextVariant;
    contentGeneration = nextContentGeneration;
    eventTruth = nextEventTruth;
    profileIdentity = nextProfileIdentity;
    scoringSettings = nextScoringSettings;
    shadowVariants = nextShadowVariants;
    generation += 1;
    publish(null);
    return snapshot;
  }

  /** @param {readonly string[]} ids */
  function setActiveEventIds(ids) {
    assertConfigured();
    const normalizedIds = requireStringArray(ids, "active_event_ids_invalid", 2048);
    if (new Set(normalizedIds).size !== normalizedIds.length) throw gameplayError("active_event_ids_invalid", "Active event IDs must be unique");
    const knownIds = new Set(events.map((event) => String(event.eventId)));
    if (normalizedIds.some((id) => !knownIds.has(id))) throw gameplayError("active_event_ids_invalid", "Active event IDs must belong to current content");
    activeIds = new Set(normalizedIds);
    publish(null);
    return snapshot;
  }

  /** @param {unknown} value */
  function setLeaseSnapshot(value) {
    assertOpen();
    setLeaseSnapshotInternal(value);
    enforceLease();
    publish(null);
    return snapshot;
  }

  /** @param {number} atTimestampMs */
  function stop(atTimestampMs) {
    assertOpen();
    advanceTimestamp(atTimestampMs);
    cancelCountdown();
    state = "completed";
    pauseReason = null;
    publish(null);
    return snapshot;
  }

  /** @param {number} [atTimestampMs] */
  function reset(atTimestampMs = timestampMs) {
    assertOpen();
    advanceTimestamp(atTimestampMs);
    generation += 1;
    clearRunTruth();
    state = packageId === null ? "idle" : "calibrating";
    pauseReason = packageId === null ? null : "calibration_required";
    calibrationId = null;
    invalidatedCalibrationId = null;
    safetyReady = false;
    freshCalibrationRequired = true;
    publish(null);
    return snapshot;
  }

  /** @param {(value: DataRecord) => void} listener */
  function subscribe(listener) {
    assertOpen();
    if (typeof listener !== "function") throw gameplayError("listener_invalid", "Gameplay listener must be a function");
    listeners.add(listener);
    notify(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    generation += 1;
    destroyed = true;
    state = "destroyed";
    cancelCountdown();
    latestEvidence = null;
    lastInput = null;
    pauseReason = null;
    publish(null);
    listeners.clear();
  }

  /** @param {unknown} value @returns {DataRecord} */
  function normalizeInputSnapshot(value) {
    const input = requireRecord(value, "input_snapshot_invalid");
    const calibration = requireRecord(input.calibration, "input_calibration_invalid");
    const tracking = requireRecord(input.tracking, "input_tracking_invalid");
    const nextCalibrationId = calibration.calibrationId === null ? null : requireString(calibration.calibrationId, "calibration_id_invalid");
    const readiness = requireString(calibration.readiness, "input_calibration_invalid");
    if (!readinessStates.includes(/** @type {never} */ (readiness))) throw gameplayError("input_calibration_invalid", "Input readiness state is unsupported");
    if (typeof tracking.gameplayPaused !== "boolean" || typeof tracking.freshCalibrationRequired !== "boolean" || typeof input.countdownFrozen !== "boolean") throw gameplayError("input_tracking_invalid", "Input tracking safety fields must be boolean");
    const qualifications = normalizeStraightQualifications(input.straightQualifications ?? []);
    const candidate = input.latestEvidence;
    if (candidate !== null && candidate !== undefined) {
      if (!isGameplayEvidenceSnapshot(candidate)) throw gameplayError("input_evidence_invalid", "Input evidence does not satisfy the public contract");
      validateEvidenceIdentity(candidate);
      if (nextCalibrationId === null || candidate.calibrationId !== nextCalibrationId) throw gameplayError("input_evidence_invalid", "Input evidence must belong to the snapshot calibration");
    }
    return Object.freeze({ input: Object.freeze({ ...input, straightQualifications: qualifications }), nextCalibrationId, readiness, trackingPaused: tracking.gameplayPaused || input.countdownFrozen, upstreamFreshRequired: tracking.freshCalibrationRequired, candidate: candidate ?? null });
  }

  /** @param {DataRecord} normalized */
  function commitInput(normalized) {
    const input = /** @type {DataRecord} */ (normalized.input);
    const nextCalibrationId = /** @type {string | null} */ (normalized.nextCalibrationId);
    const readiness = /** @type {string} */ (normalized.readiness);
    const trackingPaused = normalized.trackingPaused === true;
    lastInput = input;
    const recoveryIdMatches = invalidatedCalibrationId !== null && nextCalibrationId === invalidatedCalibrationId;
    freshCalibrationRequired = normalized.upstreamFreshRequired === true || nextCalibrationId === null || recoveryIdMatches;
    safetyReady = (readiness === "ready" || readiness === "countdown") && !trackingPaused && !freshCalibrationRequired;
    if (nextCalibrationId !== calibrationId) {
      calibrationId = nextCalibrationId;
      latestEvidence = null;
      lastEvidenceFrameId = null;
    }
    if (safetyReady && invalidatedCalibrationId !== null && nextCalibrationId !== invalidatedCalibrationId) invalidatedCalibrationId = null;
    if (normalized.candidate !== null) latestEvidence = /** @type {AeroGameplayEvidenceSnapshot} */ (normalized.candidate);
  }

  function captureEvidenceForTimeline() {
    if (!latestEvidence || latestEvidence.measuredSourceFrameId === lastEvidenceFrameId) return;
    lastEvidenceFrameId = latestEvidence.measuredSourceFrameId;
    latestEvidenceTimelineMs = timelinePositionMs;
  }

  function enforceSafety() {
    if (state === "playing" || state === "countdown" || state === "paused_manual") {
      if (!safetyReady || freshCalibrationRequired) enterTrackingPause();
    } else if (state === "paused_tracking" && safetyReady && !freshCalibrationRequired && calibrationId !== null) {
      beginCountdown("tracking_resume");
    } else if (state === "calibrating" && safetyReady && calibrationId !== null) {
      pauseReason = null;
    }
  }

  function enterTrackingPause() {
    if (invalidatedCalibrationId === null && calibrationId !== null) invalidatedCalibrationId = calibrationId;
    cancelCountdown();
    state = "paused_tracking";
    pauseReason = "tracking_lost_recalibration_required";
    latestEvidence = null;
    lastEvidenceFrameId = null;
    freshCalibrationRequired = true;
    safetyReady = false;
  }

  function hasRequiredLease() {
    if (!leaseSnapshot || !instanceId) return true;
    return leaseSnapshot.ownerInstanceId === instanceId && leaseSnapshot.state === "owned" && Array.isArray(leaseSnapshot.resources) && leaseSnapshot.resources.includes("audio") && leaseSnapshot.resources.includes("camera");
  }

  function enforceLease() {
    if (hasRequiredLease()) return;
    if (state === "playing" || state === "countdown") {
      cancelCountdown();
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
    }
  }

  /** @param {unknown} value */
  function setLeaseSnapshotInternal(value) {
    leaseSnapshot = normalizeLeaseSnapshot(value);
  }

  /** @param {AeroCountdownReason} reason */
  function beginCountdown(reason) {
    state = "countdown";
    pauseReason = null;
    countdownReason = reason;
    countdownStartedAtMs = timestampMs;
    countdownTimelinePositionMs = timelinePositionMs;
    countdown = countdownSnapshot("three", reason, 3, timestampMs, calibrationId);
    publish(null);
  }

  /** @param {{positionMs: number, playing: boolean}} clock */
  function advanceCountdown(clock) {
    if (clock.playing || clock.positionMs !== countdownTimelinePositionMs) {
      timelinePositionMs = countdownTimelinePositionMs;
      cancelCountdown();
      state = "paused_manual";
      pauseReason = "countdown_audio_not_frozen";
      return;
    }
    const elapsed = timestampMs - countdownStartedAtMs;
    if (elapsed < countdownStepMs) countdown = countdownSnapshot("three", countdownReason, 3, timestampMs, calibrationId);
    else if (elapsed < countdownStepMs * 2) countdown = countdownSnapshot("two", countdownReason, 2, timestampMs, calibrationId);
    else if (elapsed < countdownStepMs * 3) countdown = countdownSnapshot("one", countdownReason, 1, timestampMs, calibrationId);
    else {
      countdown = countdownSnapshot("complete", countdownReason, null, timestampMs, calibrationId);
      state = "playing";
      pauseReason = null;
    }
  }

  function cancelCountdown() {
    if (countdown.state !== "inactive" && countdown.state !== "complete") {
      countdown = countdownSnapshot("cancelled", countdownReason, null, timestampMs, calibrationId);
    } else countdown = inactiveCountdown(timestampMs);
    countdownReason = null;
  }

  function judgeLiveEvents() {
    for (const event of events) {
      const eventId = String(event.eventId);
      if (judgedIds.has(eventId)) continue;
      const center = Number(event.centerTimestampMs);
      const eventVariant = variantForEvent(event);
      if (eventVariant.mode === "flow" && event.type !== "note") {
        if (timelinePositionMs >= center) recordJudgement(event, "ignored", Object.freeze([]), null, false);
        continue;
      }
      if (timelinePositionMs < center - prototypeJudgementDefaults.timingWindowBeforeMs) continue;
      if (tryHit(event, false)) continue;
      if (timelinePositionMs > center + prototypeJudgementDefaults.timingWindowAfterMs) {
        recordJudgement(event, "miss", missDiagnostics(event), null, false);
      }
    }
  }

  function judgeShadowEvents() {
    if (!latestEvidence || !lastInput || latestEvidence.calibrationId !== calibrationId) return;
    const evidenceAge = timestampMs - latestEvidence.measurementTimestampMs;
    if (evidenceAge < 0 || evidenceAge > prototypeJudgementDefaults.checkpointFreshnessMs) return;
    for (const shadow of shadowVariants) {
      const shadowEvents = Array.isArray(shadow.resolvedEvents) ? shadow.resolvedEvents : [];
      for (const eventValue of shadowEvents) {
        if (!isPlainRecord(eventValue)) continue;
        const event = /** @type {DataRecord} */ (eventValue);
        const key = `${String(shadow.variantId)}:${String(event.eventId)}:${latestEvidence.measuredSourceFrameId}`;
        if (shadowConsumed.has(key)) continue;
        const center = Number(event.centerTimestampMs);
        if (Math.abs(latestEvidenceTimelineMs - center) > prototypeJudgementDefaults.timingWindowAfterMs) continue;
        const match = matchEvent(event, shadow, latestEvidence, lastInput);
        if (match.hit) {
          shadowConsumed.add(key);
          shadowJudgements.push(makeJudgement(event, shadow, "hit", match.diagnostics, latestEvidence, latestEvidenceTimelineMs, profileIdentity, true));
        }
      }
    }
  }

  /** @param {DataRecord} event @param {boolean} shadow */
  function tryHit(event, shadow) {
    if (!latestEvidence || !lastInput) return false;
    if (latestEvidence.calibrationId !== calibrationId) return false;
    const evidenceAge = timestampMs - latestEvidence.measurementTimestampMs;
    if (evidenceAge < 0 || evidenceAge > prototypeJudgementDefaults.checkpointFreshnessMs) return false;
    const center = Number(event.centerTimestampMs);
    const offset = latestEvidenceTimelineMs - center;
    if (offset < -prototypeJudgementDefaults.timingWindowBeforeMs || offset > prototypeJudgementDefaults.timingWindowAfterMs) return false;
    const match = matchEvent(event, variantForEvent(event), latestEvidence, lastInput);
    if (!match.hit) return false;
    const action = expectedAction(event);
    const actionKey = `${latestEvidence.measuredSourceFrameId}|${action}`;
    if (consumedActions.has(actionKey)) {
      recordJudgement(event, "miss", Object.freeze(["action_consumed"]), latestEvidence, shadow);
      return true;
    }
    const category = eventCategory(event);
    const frameId = latestEvidence.measuredSourceFrameId;
    const consumedWindows = consumedGuardPunchWindows.get(frameId) ?? [];
    const oppositeOverlap = (category === "guard" || category === "punch") && consumedWindows.some((entry) => entry.category !== category && Math.abs(entry.centerTimestampMs - center) <= prototypeJudgementDefaults.timingWindowBeforeMs + prototypeJudgementDefaults.timingWindowAfterMs);
    if (oppositeOverlap) {
      recordJudgement(event, "miss", Object.freeze(["blocked_overlap"]), latestEvidence, shadow);
      return true;
    }
    consumedActions.add(actionKey);
    if (category === "guard" || category === "punch") consumedGuardPunchWindows.set(frameId, Object.freeze([...consumedWindows, Object.freeze({ category, centerTimestampMs: center })]));
    recordJudgement(event, "hit", match.diagnostics, latestEvidence, shadow);
    return true;
  }

  /** @param {DataRecord} event @param {"hit" | "miss" | "ignored"} result @param {readonly string[]} diagnostics @param {AeroGameplayEvidenceSnapshot | null} evidence @param {boolean} shadow */
  function recordJudgement(event, result, diagnostics, evidence, shadow) {
    const eventVariant = variantForEvent(event);
    const eventProfile = profileForEvent(event);
    const judgement = makeJudgement(event, eventVariant, result, diagnostics, evidence, evidence ? latestEvidenceTimelineMs : null, eventProfile, shadow);
    if (shadow) shadowJudgements.push(judgement);
    else {
      judgements.push(judgement);
      judgedIds.add(String(event.eventId));
      updateScore(result, eventVariant, eventProfile, scoringSettingsForEvent(event));
    }
  }

  /** @param {"hit" | "miss" | "ignored"} result @param {DataRecord} scoreVariant @param {DataRecord} scoreProfile @param {DataRecord} settings */
  function updateScore(result, scoreVariant, scoreProfile, settings) {
    const key = scorePartitionKey(scoreVariant, scoreProfile, settings);
    const current = partitions.get(key) ?? { partitionId: key, variantId: scoreVariant.variantId, chartId: scoreVariant.chartId, rulesetId: scoreVariant.rulesetId, recipeId: scoreVariant.recipeId, modifierIds: scoreVariant.modifierIds, mapHash: scoreVariant.mapHash, scoreIdentityHash: scoreVariant.scoreIdentityHash, profileId: scoreProfile.profileId, profileVersion: scoreProfile.profileVersion, profileHash: scoreProfile.contentHash, profileClass: scoreProfile.class, regenerationRequired: scoreProfile.regenerationRequired, scoringSettings: settings, scoringSettingsIdentity: scoreSettingsIdentity(settings), ranked: scoreVariant.ranked === true, localOnly: true, hits: 0, misses: 0, ignored: 0, score: 0, maxCombo: 0, combo: 0 };
    const next = { ...current };
    if (result === "hit") { next.hits += 1; next.combo += 1; next.score = finiteScore(next.score + Number(settings.hitPoints) + Math.max(0, next.combo - 1) * Number(settings.comboBonusPerHit)); next.maxCombo = Math.max(next.maxCombo, next.combo); }
    else if (result === "miss") { next.misses += 1; next.score = finiteScore(Math.max(0, next.score - Number(settings.missPenalty))); next.combo = 0; }
    else next.ignored += 1;
    partitions.set(key, Object.freeze(next));
  }

  /** @param {DataRecord} event @returns {readonly string[]} */
  function missDiagnostics(event) {
    if (!latestEvidence) return Object.freeze(["no_input"]);
    if (latestEvidence.calibrationId !== calibrationId) return Object.freeze(["calibration_mismatch"]);
    const age = timestampMs - latestEvidence.measurementTimestampMs;
    if (age < 0 || age > prototypeJudgementDefaults.checkpointFreshnessMs) return Object.freeze(["stale_input"]);
    const match = matchEvent(event, variantForEvent(event), latestEvidence, lastInput);
    return match.diagnostics.length > 0 ? match.diagnostics : Object.freeze(["timing_miss"]);
  }

  /** @param {Readonly<{code: string, message: string}> | null} error */
  function publish(error) {
    snapshot = makeSnapshot(error);
    for (const listener of listeners) notify(listener);
  }

  /** @param {(value: DataRecord) => void} listener */
  function notify(listener) {
    try { listener(snapshot); } catch (error) { try { normalizedOptions.onListenerError?.(error); } catch { /* diagnostics cannot break gameplay */ } }
  }

  /** @param {Readonly<{code: string, message: string}> | null} error */
  function makeSnapshot(error) {
    return Object.freeze({
      schema: "aerobeat/gameplay_coordinator_snapshot", version: 1, serviceId: "aero.gameplay.session", generation,
      session: Object.freeze({ schema: "aerobeat/gameplay_session_snapshot", version: 1, sessionId, state, timestampMs, timelinePositionMs, packageId, chartId: variant?.chartId ?? null, calibrationId, rulesetId: variant?.rulesetId ?? null, recipeId: variant?.recipeId ?? null, ranked: variant?.ranked === true, pauseReason }),
      countdown, safety: Object.freeze({ ready: safetyReady, freshCalibrationRequired }), lease: leaseSnapshot,
      selectedVariant: variant ? publicVariant(variant) : null, profileIdentity, scoringSettings,
      activeEventIds: Object.freeze([...activeIds].sort(compareCodePoints)), judgedEventIds: Object.freeze([...judgedIds].sort(compareCodePoints)),
      judgements: Object.freeze([...judgements]), shadowJudgements: Object.freeze([...shadowJudgements]),
      scorePartitions: Object.freeze([...partitions.values()].map((entry) => Object.freeze({ ...entry }))), error
    });
  }

  function clearRunTruth() {
    judgedIds.clear(); activeIds.clear(); judgements.length = 0; shadowJudgements.length = 0; shadowConsumed.clear(); consumedActions.clear(); consumedGuardPunchWindows.clear(); partitions.clear(); timelinePositionMs = 0; countdownTimelinePositionMs = 0; latestEvidence = null; lastEvidenceFrameId = null; lastInput = null; countdown = inactiveCountdown(timestampMs);
  }

  /** @param {DataRecord} event */
  function shouldPreserveEvent(event) { return Number(event.centerTimestampMs) <= timelinePositionMs || judgedIds.has(String(event.eventId)) || activeIds.has(String(event.eventId)); }
  /** @param {DataRecord} event @returns {DataRecord} */
  function truthForEvent(event) {
    const truth = eventTruth.get(event);
    if (!truth) throw gameplayError("event_truth_missing", "Gameplay events require immutable content-generation truth");
    return /** @type {DataRecord} */ (truth);
  }
  /** @param {DataRecord} event @returns {DataRecord} */
  function variantForEvent(event) { return /** @type {DataRecord} */ (truthForEvent(event).variant); }
  /** @param {DataRecord} event @returns {DataRecord} */
  function profileForEvent(event) { return /** @type {DataRecord} */ (truthForEvent(event).profileIdentity); }
  /** @param {DataRecord} event @returns {DataRecord} */
  function scoringSettingsForEvent(event) { return /** @type {DataRecord} */ (truthForEvent(event).scoringSettings); }
  function assertOpen() { if (destroyed) throw gameplayError("service_destroyed", "Gameplay coordinator is destroyed"); }
  function assertConfigured() { assertOpen(); if (!variant || packageId === null) throw gameplayError("content_not_configured", "Gameplay content is not configured"); }
  /** @param {number} value */
  function advanceTimestamp(value) { const next = requireNonNegativeNumber(value, "timestamp_invalid"); if (next < timestampMs) throw gameplayError("timestamp_rollback", "Gameplay timestamps must not roll back"); timestampMs = next; }
}

/** @param {readonly DataRecord[]} sourceEvents @param {string} contentPackageId @param {number} generation @param {DataRecord} sourceVariant @param {DataRecord} sourceProfile @param {DataRecord} sourceScoringSettings */
function bindEventTruth(sourceEvents, contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings) {
  const result = new WeakMap();
  const truth = makeEventTruth(contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings);
  for (const event of sourceEvents) result.set(event, truth);
  return result;
}
/** @param {string} contentPackageId @param {number} generation @param {DataRecord} sourceVariant @param {DataRecord} sourceProfile @param {DataRecord} sourceScoringSettings */
function makeEventTruth(contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings) { return Object.freeze({ contentPackageId, contentGeneration: generation, variant: sourceVariant, profileIdentity: sourceProfile, scoringSettings: sourceScoringSettings }); }

/** @param {GameplayCoordinatorOptions} options */
function normalizeOptions(options) {
  if (!isPlainRecord(options)) throw gameplayError("gameplay_options_invalid", "Gameplay options must be a plain record");
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => typeof key !== "string" || !["sessionId", "instanceId", "countdownStepMs", "onListenerError"].includes(key))) throw gameplayError("gameplay_options_invalid", "Gameplay options contain unknown or symbolic fields");
  /** @type {Record<string, unknown>} */
  const values = {};
  for (const keyValue of keys) {
    const key = /** @type {string} */ (keyValue);
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw gameplayError("gameplay_options_invalid", "Gameplay options cannot contain accessors or hidden fields");
    values[key] = descriptor.value;
  }
  const callback = values.onListenerError;
  if (callback !== undefined && typeof callback !== "function") throw gameplayError("gameplay_options_invalid", "Listener error hook must be a function");
  return Object.freeze({ sessionId: values.sessionId === undefined ? `session-${randomToken()}` : requireString(values.sessionId, "session_id_invalid"), instanceId: values.instanceId === undefined ? null : requireString(values.instanceId, "instance_id_invalid"), countdownStepMs: values.countdownStepMs === undefined ? 1000 : positiveNumber(values.countdownStepMs, "countdown_step_invalid"), onListenerError: /** @type {((error: unknown) => void) | undefined} */ (callback) });
}

/** @param {unknown} value @returns {{positionMs: number, playing: boolean}} */
function normalizeClock(value) {
  const record = requireDataRecordFields(value, "audio_clock_invalid", ["contextTimeSeconds", "positionSeconds", "durationSeconds", "progress", "playing"]);
  const positionSeconds = requireNonNegativeNumber(record.positionSeconds, "audio_clock_invalid");
  if (record.contextTimeSeconds !== undefined) requireNonNegativeNumber(record.contextTimeSeconds, "audio_clock_invalid");
  if (record.durationSeconds !== undefined) requireNonNegativeNumber(record.durationSeconds, "audio_clock_invalid");
  if (record.progress !== undefined && (typeof record.progress !== "number" || !Number.isFinite(record.progress) || record.progress < 0 || record.progress > 1)) throw gameplayError("audio_clock_invalid", "Audio clock progress must be normalized");
  if (typeof record.playing !== "boolean") throw gameplayError("audio_clock_invalid", "Audio clock playing must be boolean");
  const positionMs = positionSeconds * 1000;
  if (!Number.isSafeInteger(positionMs) && (!Number.isFinite(positionMs) || positionMs > Number.MAX_SAFE_INTEGER)) throw gameplayError("audio_clock_invalid", "Audio clock position exceeds safe gameplay range");
  return Object.freeze({ positionMs, playing: record.playing });
}

/** @param {unknown} value @returns {DataRecord} */
function normalizeLeaseSnapshot(value) {
  const copy = cloneGameplayData(value, "media_lease_invalid");
  if (!isMediaLeaseSnapshot(copy)) throw gameplayError("media_lease_invalid", "Media lease snapshot does not satisfy the public contract");
  return /** @type {DataRecord} */ (copy);
}

/** @param {unknown} value @returns {DataRecord} */
function normalizeVariant(value) {
  const record = requireRecord(value, "variant_invalid");
  const rulesetId = requireString(record.rulesetId, "ruleset_invalid");
  if (!rulesetIds.includes(/** @type {never} */ (rulesetId))) throw gameplayError("ruleset_invalid", "Variant ruleset is unsupported");
  const mode = record.mode === "flow" ? "flow" : record.mode === "boxing" ? "boxing" : (() => { throw gameplayError("mode_invalid", "Variant mode is unsupported"); })();
  const recipeId = record.recipeId === null ? null : requireString(record.recipeId, "recipe_invalid");
  if (mode === "flow" && (rulesetId !== "flow_grid_v1" || recipeId !== null)) throw gameplayError("variant_identity_invalid", "Flow variants require the Flow ruleset and no conversion recipe");
  if (mode === "boxing" && (rulesetId === "flow_grid_v1" || recipeId === null || !conversionRecipeIds.includes(/** @type {never} */ (recipeId)))) throw gameplayError("variant_identity_invalid", "Boxing variants require a supported Boxing ruleset and conversion recipe");
  const modifierIds = requireStringArray(record.modifierIds ?? [], "modifier_ids_invalid", 32);
  if (new Set(modifierIds).size !== modifierIds.length || [...modifierIds].sort(compareCodePoints).some((entry, index) => entry !== modifierIds[index]) || modifierIds.some((entry) => !SUPPORTED_MODIFIERS.includes(entry))) throw gameplayError("modifier_ids_invalid", "Modifier identity must be supported, sorted and unique");
  if (typeof record.ranked !== "boolean") throw gameplayError("variant_rank_invalid", "Variant ranked identity must be boolean");
  const provenance = record.provenance === undefined ? null : cloneGameplayData(record.provenance);
  if (isPlainRecord(provenance) && provenance.kind === "composite" && record.ranked) throw gameplayError("variant_rank_invalid", "Runtime composite variants must be unranked");
  const mapHash = cloneGameplayData(record.mapHash, "map_hash_invalid");
  const scoreIdentityHash = cloneGameplayData(record.scoreIdentityHash, "score_identity_hash_invalid");
  if (!isContentHash(mapHash) || !isContentHash(scoreIdentityHash)) throw gameplayError("variant_hash_invalid", "Variant map and score identity hashes must satisfy the public content contract");
  return Object.freeze({ variantId: requireString(record.variantId, "variant_id_invalid"), chartId: requireString(record.chartId, "chart_id_invalid"), mode, rulesetId, recipeId, modifierIds, ranked: record.ranked === true, mapHash, scoreIdentityHash, provenance });
}

/** @param {unknown} value @param {DataRecord} selectedVariant @returns {readonly DataRecord[]} */
function normalizeEvents(value, selectedVariant) {
  if (!Array.isArray(value) || value.length > 100000) throw gameplayError("content_events_invalid", "Resolved events must be a bounded array");
  const ids = new Set();
  const lineageOwners = new Set();
  const result = value.map((entry) => {
    const envelope = requireRecord(entry, "content_event_invalid");
    const authoredBeat = envelope.authoredBeat === undefined ? null : requireRecord(envelope.authoredBeat, "authored_beat_invalid");
    const eventId = requireString(envelope.eventId, "event_id_invalid");
    if (ids.has(eventId)) throw gameplayError("event_id_duplicate", "Resolved event IDs must be unique");
    ids.add(eventId);
    if (authoredBeat?.eventId !== undefined && authoredBeat.eventId !== eventId) throw gameplayError("event_id_mismatch", "Resolved and authored event IDs must agree");
    const centerTimestampMs = requireNonNegativeNumber(envelope.centerTimestampMs, "event_timestamp_invalid");
    const variantId = envelope.variantId === undefined ? selectedVariant.variantId : requireString(envelope.variantId, "variant_id_invalid");
    const chartId = envelope.chartId === undefined ? selectedVariant.chartId : requireString(envelope.chartId, "chart_id_invalid");
    if (variantId !== selectedVariant.variantId || chartId !== selectedVariant.chartId) throw gameplayError("event_variant_mismatch", "Resolved events must belong to the selected variant and chart");
    const event = Object.freeze({ ...envelope, ...(authoredBeat ?? {}), authoredBeat, eventId, centerTimestampMs, variantId, chartId });
    validateEventForVariant(event, selectedVariant);
    for (const sourceId of lineageIds(event)) {
      if (lineageOwners.has(sourceId)) throw gameplayError("event_lineage_invalid", "Source lineage IDs must have one event owner");
      lineageOwners.add(sourceId);
    }
    return event;
  });
  result.sort(eventOrder);
  return Object.freeze(result);
}

/** @param {DataRecord} event @param {DataRecord} selectedVariant */
function validateEventForVariant(event, selectedVariant) {
  const type = requireString(event.type, "event_type_invalid");
  if (selectedVariant.mode === "flow") {
    if (!["note", "bomb", "obstacle", "arc", "burst"].includes(type)) throw gameplayError("event_type_invalid", "Flow event type is unsupported");
    if (type === "note") {
      if (event.hand !== "left" && event.hand !== "right") throw gameplayError("event_hand_invalid", "Flow notes require a hand");
      requireGridCell(event.placement, "event_placement_invalid");
      if (event.direction !== undefined && directionName(event.direction) === null) throw gameplayError("event_direction_invalid", "Flow note direction is unsupported");
    }
  } else {
    const action = expectedAction(event);
    if (![...PUNCH_ACTIONS, ...CHECKPOINT_ACTIONS].includes(action)) throw gameplayError("event_type_invalid", "Boxing event type is unsupported");
    if (selectedVariant.rulesetId === "boxing_spatial_grid_v1") {
      if (PUNCH_ACTIONS.includes(action)) {
        const target = requireRecord(event.spatialTarget, "spatial_target_invalid");
        requireGridCell(target.targetCell, "spatial_target_invalid");
        if (!Array.isArray(target.acceptedSubcells) || target.acceptedSubcells.length > 48 || target.acceptedSubcells.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 47)) throw gameplayError("spatial_target_invalid", "Spatial accepted subcells are invalid");
        if (target.sourceCell !== undefined) requireGridCell(target.sourceCell, "spatial_target_invalid");
        if (target.entryDirection !== undefined && directionName(target.entryDirection) === null) throw gameplayError("spatial_target_invalid", "Spatial entry direction is invalid");
      } else if (action === "guard" || action === "crossed_guard") {
        const target = requireRecord(event.guardTarget, "guard_target_invalid");
        requireGridCell(target.leftCell, "guard_target_invalid");
        requireGridCell(target.rightCell, "guard_target_invalid");
      } else {
        const checkpoint = requireRecord(event.checkpoint, "checkpoint_invalid");
        if (!Array.isArray(checkpoint.noseSafeCells) || checkpoint.noseSafeCells.length > 12 || checkpoint.noseSafeCells.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 11)) throw gameplayError("checkpoint_invalid", "Checkpoint nose-safe cells are invalid");
      }
    }
  }
  if (event.sourceEventIds !== undefined) {
    const sourceIds = requireStringArray(event.sourceEventIds, "event_lineage_invalid", 256);
    if (new Set(sourceIds).size !== sourceIds.length) throw gameplayError("event_lineage_invalid", "Event lineage IDs must be unique");
  }
}

/** @param {unknown} value @returns {DataRecord} */
function normalizeProfile(value) {
  const record = requireRecord(value, "profile_identity_invalid");
  if (!isPrototypeTuningIdentity(record) || record.class !== "between_run_ruleset") throw gameplayError("profile_identity_invalid", "Profile identity does not satisfy the gameplay tuning contract for a between-run ruleset");
  return record;
}

/** @param {unknown} value @returns {DataRecord} */
function normalizeScoringSettings(value) {
  const record = requireDataRecordFields(value, "scoring_settings_invalid", ["comboBonusPerHit", "hitPoints", "missPenalty"]);
  if (Reflect.ownKeys(record).length !== 3) throw gameplayError("scoring_settings_invalid", "Scoring settings require every exact field");
  return Object.freeze({ comboBonusPerHit: boundedScoreNumber(record.comboBonusPerHit), hitPoints: boundedScoreNumber(record.hitPoints), missPenalty: boundedScoreNumber(record.missPenalty) });
}
/** @param {unknown} value */
function boundedScoreNumber(value) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw gameplayError("scoring_settings_invalid", "Scoring settings must be finite values from 0 through 100"); return Object.is(value, -0) ? 0 : value; }

/** @param {unknown} value @returns {readonly DataRecord[]} */
function normalizeShadowVariants(value) {
  if (!Array.isArray(value) || value.length > 4) throw gameplayError("shadow_variants_invalid", "Shadow variants must be a bounded array");
  return Object.freeze(value.map((entry) => { const record = requireRecord(entry, "shadow_variant_invalid"); const normalized = normalizeVariant(record); const resolvedEvents = normalizeEvents(record.resolvedEvents ?? [], normalized); return Object.freeze({ ...normalized, resolvedEvents }); }));
}

/** @param {unknown} value @returns {readonly DataRecord[]} */
function normalizeStraightQualifications(value) {
  const entries = cloneGameplayData(value, "straight_qualifications_invalid", 64);
  if (!Array.isArray(entries) || entries.length > 2) throw gameplayError("straight_qualifications_invalid", "Straight qualifications must be a bounded array");
  const hands = new Set();
  return Object.freeze(entries.map((entryValue) => {
    const entry = requireRecord(entryValue, "straight_qualification_invalid");
    const hand = entry.hand === "left" || entry.hand === "right" ? entry.hand : (() => { throw gameplayError("straight_qualification_invalid", "Straight qualification hand is invalid"); })();
    if (hands.has(hand)) throw gameplayError("straight_qualification_invalid", "Straight qualification hands must be unique");
    hands.add(hand);
    if (typeof entry.semanticQualified !== "boolean" || typeof entry.spatialQualified !== "boolean") throw gameplayError("straight_qualification_invalid", "Straight qualification flags must be boolean");
    const semanticStartTimestampMs = entry.semanticStartTimestampMs === null ? null : requireNonNegativeNumber(entry.semanticStartTimestampMs, "straight_qualification_invalid");
    const spatialStartTimestampMs = entry.spatialStartTimestampMs === null ? null : requireNonNegativeNumber(entry.spatialStartTimestampMs, "straight_qualification_invalid");
    const semanticDurationMs = requireNonNegativeNumber(entry.semanticDurationMs, "straight_qualification_invalid");
    const spatialDurationMs = requireNonNegativeNumber(entry.spatialDurationMs, "straight_qualification_invalid");
    if ((entry.semanticQualified && semanticStartTimestampMs === null) || (entry.spatialQualified && spatialStartTimestampMs === null)) throw gameplayError("straight_qualification_invalid", "Qualified straight evidence requires a measured start timestamp");
    if (!Array.isArray(entry.acceptedSubcellColumns) || entry.acceptedSubcellColumns.length > 8 || entry.acceptedSubcellColumns.some((column) => !Number.isInteger(column) || column < 0 || column > 7) || new Set(entry.acceptedSubcellColumns).size !== entry.acceptedSubcellColumns.length) throw gameplayError("straight_qualification_invalid", "Accepted subcell columns are invalid");
    return Object.freeze({ hand, semanticStartTimestampMs, semanticDurationMs, semanticQualified: entry.semanticQualified, spatialStartTimestampMs, spatialDurationMs, spatialQualified: entry.spatialQualified, acceptedSubcellColumns: Object.freeze([...entry.acceptedSubcellColumns]) });
  }));
}

/** @param {AeroGameplayEvidenceSnapshot} evidence */
function validateEvidenceIdentity(evidence) {
  if (new Set(evidence.activeBoxingActions).size !== evidence.activeBoxingActions.length) throw gameplayError("input_evidence_invalid", "Active Boxing action IDs must be unique");
  const anchorIds = evidence.anchors.map((anchor) => anchor.anchor);
  if (new Set(anchorIds).size !== anchorIds.length) throw gameplayError("input_evidence_invalid", "Measured anchor IDs must be unique");
  const entryIds = evidence.entries.map((entry) => entry.anchor);
  if (new Set(entryIds).size !== entryIds.length) throw gameplayError("input_evidence_invalid", "Measured entry anchor IDs must be unique");
}

/** @param {DataRecord} event @param {DataRecord | null} selectedVariant @param {AeroGameplayEvidenceSnapshot} evidence @param {DataRecord | null} input */
function matchEvent(event, selectedVariant, evidence, input) {
  const diagnostics = [];
  const rulesetId = String(selectedVariant?.rulesetId ?? "flow_grid_v1");
  if (rulesetId === "flow_grid_v1") return matchFlow(event, evidence);
  const action = expectedAction(event);
  if (!evidence.activeBoxingActions.includes(/** @type {never} */ (action))) diagnostics.push("no_input");
  if (action.startsWith("straight_") && rulesetId === "boxing_semantic_track_v1") {
    const hand = action.endsWith("_right") ? "right" : "left";
    const qualifications = Array.isArray(input?.straightQualifications) ? input.straightQualifications : [];
    const qualification = qualifications.find((entry) => isPlainRecord(entry) && entry.hand === hand);
    const start = isPlainRecord(qualification) && typeof qualification.semanticStartTimestampMs === "number" ? qualification.semanticStartTimestampMs : null;
    const qualified = isPlainRecord(qualification) && qualification.semanticQualified === true && start !== null && evidence.measurementTimestampMs - start >= prototypeJudgementDefaults.straightQualificationMs;
    if (!qualified) diagnostics.push("qualification_too_short");
  }
  if (rulesetId === "boxing_spatial_grid_v1") matchSpatial(event, action, evidence, input, diagnostics);
  return Object.freeze({ hit: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

/** @param {DataRecord} event @param {AeroGameplayEvidenceSnapshot} evidence */
function matchFlow(event, evidence) {
  const hand = event.hand === "right" ? "right" : "left";
  const anchorName = `${hand}_wrist`;
  const anchor = evidence.anchors.find((entry) => entry.anchor === anchorName);
  const diagnostics = [];
  const placement = requireGridCell(event.placement, "event_placement_invalid");
  if (!anchor || anchor.cell !== placement) diagnostics.push("wrong_cell");
  if (event.direction !== undefined) {
    const direction = directionName(event.direction);
    const entry = evidence.entries.find((candidate) => candidate.anchor === anchorName && candidate.toCell === placement);
    if (!entry || direction === null || entry.direction !== direction) diagnostics.push("wrong_direction");
  }
  return Object.freeze({ hit: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}

/** @param {DataRecord} event @param {string} action @param {AeroGameplayEvidenceSnapshot} evidence @param {DataRecord | null} input @param {string[]} diagnostics */
function matchSpatial(event, action, evidence, input, diagnostics) {
  if (PUNCH_ACTIONS.includes(action)) {
    const hand = action.endsWith("_right") ? "right" : "left";
    const anchor = evidence.anchors.find((entry) => entry.anchor === `${hand}_wrist`);
    const target = isPlainRecord(event.spatialTarget) ? event.spatialTarget : null;
    if (!anchor || !target) { diagnostics.push("wrong_cell"); return; }
    const accepted = Array.isArray(target.acceptedSubcells) ? target.acceptedSubcells : [];
    const targetCell = requireGridCell(target.targetCell, "spatial_target_invalid");
    if (accepted.length > 0 && !accepted.includes(anchor.subcell)) diagnostics.push("wrong_subcell");
    else if (anchor.cell !== targetCell) diagnostics.push("wrong_cell");
    if (target.entryDirection !== undefined) {
      const sourceCell = target.sourceCell === undefined ? null : requireGridCell(target.sourceCell, "spatial_target_invalid");
      const direction = directionName(target.entryDirection);
      if (!evidence.entries.some((entry) => entry.anchor === `${hand}_wrist` && entry.toCell === targetCell && (sourceCell === null || entry.fromCell === sourceCell) && entry.direction === direction)) diagnostics.push("wrong_direction");
    }
    if (action.startsWith("straight_")) {
      const qualifications = Array.isArray(input?.straightQualifications) ? input.straightQualifications : [];
      const qualification = qualifications.find((entry) => isPlainRecord(entry) && entry.hand === hand);
      const start = isPlainRecord(qualification) && typeof qualification.spatialStartTimestampMs === "number" ? qualification.spatialStartTimestampMs : null;
      const qualified = isPlainRecord(qualification) && qualification.spatialQualified === true && start !== null && evidence.measurementTimestampMs - start >= prototypeJudgementDefaults.straightQualificationMs;
      if (!qualified) diagnostics.push("qualification_too_short");
    }
  } else if (action === "guard" || action === "crossed_guard") {
    const target = isPlainRecord(event.guardTarget) ? event.guardTarget : null;
    const left = evidence.anchors.find((entry) => entry.anchor === "left_wrist");
    const right = evidence.anchors.find((entry) => entry.anchor === "right_wrist");
    if (!target || !left || !right || left.cell !== target.leftCell || right.cell !== target.rightCell) diagnostics.push("wrong_cell");
    if (target?.crossed === true && !evidence.activeBoxingActions.includes("crossed_guard")) diagnostics.push("no_input");
  } else if (CHECKPOINT_ACTIONS.includes(action) && isPlainRecord(event.checkpoint) && Array.isArray(event.checkpoint.noseSafeCells)) {
    const nose = evidence.anchors.find((entry) => entry.anchor === "nose");
    if (!nose || !event.checkpoint.noseSafeCells.includes(nose.cell)) diagnostics.push("wrong_cell");
  }
}

/** @param {DataRecord} event @param {DataRecord | null} selectedVariant @param {"hit" | "miss" | "ignored"} result @param {readonly string[]} diagnostics @param {AeroGameplayEvidenceSnapshot | null} evidence @param {number | null} evidenceTimelineMs @param {DataRecord} profile @param {boolean} shadow @returns {AeroGameplayJudgement} */
function makeJudgement(event, selectedVariant, result, diagnostics, evidence, evidenceTimelineMs, profile, shadow) {
  const rulesetId = /** @type {import("@aerobeat/web-contracts").AeroRulesetId} */ (selectedVariant?.rulesetId ?? "flow_grid_v1");
  const recipeId = /** @type {import("@aerobeat/web-contracts").AeroConversionRecipeId | null} */ (selectedVariant?.recipeId ?? null);
  const center = Number(event.centerTimestampMs);
  return Object.freeze({ schema: "aerobeat/gameplay_judgement", version: 1, eventId: String(event.eventId), rulesetId, recipeId, result, beatCenterTimestampMs: center, evidenceTimestampMs: evidence ? evidence.measurementTimestampMs : null, timingOffsetMs: evidenceTimelineMs === null ? null : evidenceTimelineMs - center, diagnostics: Object.freeze(/** @type {import("@aerobeat/web-contracts").AeroJudgementDiagnosticCode[]} */ ([...diagnostics])), shadow, variantId: selectedVariant?.variantId ?? null, chartId: selectedVariant?.chartId ?? null, sourceEventIds: Object.freeze([...lineageIds(event)]), mapHash: selectedVariant?.mapHash ?? null, scoreIdentityHash: selectedVariant?.scoreIdentityHash ?? null, profileId: profile.profileId, profileVersion: profile.profileVersion, profileHash: profile.contentHash });
}

/** @param {DataRecord} event */
function expectedAction(event) { if (event.type === "guard" && isPlainRecord(event.guardTarget) && event.guardTarget.crossed === true) return "crossed_guard"; return typeof event.type === "string" ? event.type : "note"; }
/** @param {DataRecord} event */
function eventCategory(event) { const action = expectedAction(event); return PUNCH_ACTIONS.includes(action) ? "punch" : action === "guard" || action === "crossed_guard" ? "guard" : "checkpoint"; }
/** @param {DataRecord} event */
function lineageIds(event) { return Array.isArray(event.sourceEventIds) ? event.sourceEventIds.filter((entry) => typeof entry === "string") : []; }
/** @param {DataRecord} left @param {DataRecord} right */
function eventOrder(left, right) { return Number(left.centerTimestampMs) - Number(right.centerTimestampMs) || compareCodePoints(String(left.eventId), String(right.eventId)); }
/** @param {unknown} value @param {string} code */
function positiveNumber(value, code) { const number = requireNonNegativeNumber(value, code); if (number <= 0) throw gameplayError(code, "Expected a positive number"); return number; }
function defaultProfileIdentity() { return Object.freeze({ schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "aero.gameplay.prototype.default", profileVersion: "1", contentHash: "0".repeat(64), class: "between_run_ruleset", regenerationRequired: false }); }
function defaultScoringSettings() { return Object.freeze({ comboBonusPerHit: 0, hitPoints: 1, missPenalty: 0 }); }
/** @param {DataRecord} settings */
function scoreSettingsIdentity(settings) { return `scoring-v1:${JSON.stringify(settings.hitPoints)},${JSON.stringify(settings.missPenalty)},${JSON.stringify(settings.comboBonusPerHit)}`; }
/** @param {number} value */
function finiteScore(value) { if (!Number.isFinite(value) || value < 0) throw gameplayError("score_value_invalid", "Score arithmetic must remain finite and non-negative"); return Object.is(value, -0) ? 0 : value; }
/** @param {DataRecord} variant @param {DataRecord} profile @param {DataRecord} settings */
function scorePartitionKey(variant, profile, settings) { const mapHash = isPlainRecord(variant.mapHash) && typeof variant.mapHash.value === "string" ? variant.mapHash.value : "unhashed"; const scoreHash = isPlainRecord(variant.scoreIdentityHash) && typeof variant.scoreIdentityHash.value === "string" ? variant.scoreIdentityHash.value : "unhashed"; return [variant.variantId, variant.chartId, variant.mode, variant.rulesetId, variant.recipeId ?? "none", [...variant.modifierIds].join(","), variant.ranked ? "ranked" : "unranked", mapHash, scoreHash, profile.profileId, profile.profileVersion, profile.contentHash, profile.class, profile.regenerationRequired ? "regenerate" : "live", scoreSettingsIdentity(settings)].join("|"); }
/** @param {DataRecord} variant */
function publicVariant(variant) { return Object.freeze({ variantId: variant.variantId, chartId: variant.chartId, mode: variant.mode, rulesetId: variant.rulesetId, recipeId: variant.recipeId, modifierIds: variant.modifierIds, ranked: variant.ranked, mapHash: variant.mapHash, scoreIdentityHash: variant.scoreIdentityHash, provenance: variant.provenance }); }
/** @param {"three" | "two" | "one" | "complete" | "cancelled"} state @param {AeroCountdownReason | null} reason @param {number | null} value @param {number} timestampMs @param {string | null} calibrationId */
function countdownSnapshot(state, reason, value, timestampMs, calibrationId) { return Object.freeze({ schema: "aerobeat/countdown_snapshot", version: 1, state, reason, value, timestampMs, gameplayTimeFrozen: state !== "complete", calibrationId }); }
/** @param {number} timestampMs */
function inactiveCountdown(timestampMs) { return Object.freeze({ schema: "aerobeat/countdown_snapshot", version: 1, state: "inactive", reason: null, value: null, timestampMs, gameplayTimeFrozen: true, calibrationId: null }); }
/** @param {unknown} value */
function boundedReason(value) { return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : "manual"; }
/** @param {unknown} value */
function directionName(value) { return value === 0 ? "up" : value === 1 ? "down" : value === 2 ? "left" : value === 3 ? "right" : typeof value === "string" && ["up", "down", "left", "right"].includes(value) ? value : null; }
/** @param {unknown} value @param {string} code */
function requireGridCell(value, code) { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 11) throw gameplayError(code, "Expected a 4x3 grid cell"); return Number(value); }
function randomToken() { const bytes = new Uint32Array(2); if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes); else { bytes[0] = Math.floor(Math.random() * 0xffffffff); bytes[1] = Math.floor(Math.random() * 0xffffffff); } return `${bytes[0].toString(16)}${bytes[1].toString(16)}`; }

// @ts-check

import {
  bodyGridDirections,
  conversionRecipeIds,
  isContentHash,
  isGameplayEvidenceSnapshot,
  isGameplaySessionStartRequest,
  isMediaLeaseSnapshot,
  isPrototypeTuningIdentity,
  prototypeJudgementDefaults,
  readinessStates,
  rulesetIds
} from "@aerobeat/web-contracts";
import { isObstacleGameplayGeometry, isObstacleGridMask, isObstacleSourceGeometry, maximumObstaclesPerChart } from "@aerobeat/web-contracts/obstacle-contracts";
import { addInterval, clipNoseSegment, coversInterval, measuredNoseSample, pointContactsObstacle, maximumObstacleSampleGapMs } from "./flow-obstacle-collision.js";
import { clipWristSegmentToTarget, createFlowColliderSettings, defaultFlowColliderSettings, flowColliderSettingsIdentity, isContinuousColliderSegment, maximumColliderSampleFreshnessMs, matchesAuthoredDirection, measuredColliderSample, pointContactsFlowTarget } from "./flow-collider-collision.js";
import { boxingColliderSettingsIdentity, clipWristSegmentToBoxingTarget, createBoxingColliderSettings, defaultBoxingColliderSettings, guardGestureFromEvidence, matchesBoxingAuthoredDirection, pointContactsBoxingTarget, boxingColliderTargetCenter } from "./boxing-collider-collision.js";
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
/** @typedef {import("@aerobeat/web-contracts").AeroGameplayJudgementV2} AeroGameplayJudgement */
/** @typedef {import("@aerobeat/web-contracts").AeroGameplaySessionState} AeroGameplaySessionState */
/** @typedef {import("@aerobeat/web-contracts").AeroGameplaySessionPurpose} AeroGameplaySessionPurpose */
/** @typedef {import("@aerobeat/web-contracts").AeroCountdownReason} AeroCountdownReason */
/** @typedef {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,calibrationId:string,sx:number,sy:number}>} NoseSample */
/** @typedef {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} ColliderSample */
/** @typedef {{coverage: readonly Readonly<{startMs:number,endMs:number}>[], contact: readonly Readonly<{startMs:number,endMs:number}>[], firstContactTimelinePositionMs:number|null, contactEpisodeId:string|null, evidenceFrameId:string|null, calibrationId:string|null, consequenceApplied:boolean}} ObstacleState */
/** @typedef {{leftCoverage: readonly Readonly<{startMs:number,endMs:number}>[],rightCoverage:readonly Readonly<{startMs:number,endMs:number}>[],contactTimelinePositionMs:number|null,consequenceApplied:boolean}} BombState */

const FLOW_COLLIDER_RULESET = "flow_colliders_v1";
/** Retired Flow Grid ruleset, still accepted as a flow-mode variant input for historical reads. */
const FLOW_GRID_RULESET = "flow_grid_v2";
/** The 0.0.52 collider-scored boxing ruleset; beats are swept 2.5D contacts at reach rows. */
const BOXING_COLLIDER_RULESET = "boxing_collider_v1";

/** @type {readonly string[]} */
const CHECKPOINT_ACTIONS = Object.freeze(["guard", "crossed_guard", "squat", "weave_left", "weave_right"]);
/** @type {readonly string[]} */
const PUNCH_ACTIONS = Object.freeze(["straight_left", "straight_right", "hook_left", "hook_right", "uppercut_left", "uppercut_right"]);
/** @type {readonly string[]} */
const SUPPORTED_MODIFIERS = Object.freeze(["any_punch", "cross_body", "crossed_guard", "no_obstacles", "no_squats", "no_weaves", "obstacle_visual_only"]);

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
 * @property {DataRecord} [flowColliderSettings]
 * @property {DataRecord} [boxingColliderSettings]
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
  let sessionPurpose = /** @type {AeroGameplaySessionPurpose} */ ("play");
  let timestampMs = 0;
  let timelinePositionMs = 0;
  let packageId = null;
  let variant = /** @type {DataRecord | null} */ (null);
  let profileIdentity = /** @type {DataRecord} */ (defaultProfileIdentity());
  let scoringSettings = /** @type {DataRecord} */ (defaultScoringSettings());
  let flowColliderSettings = /** @type {DataRecord} */ (defaultFlowColliderSettings);
  let boxingColliderSettings = /** @type {DataRecord} */ (defaultBoxingColliderSettings);
  let events = /** @type {readonly DataRecord[]} */ (Object.freeze([]));
  let contentGeneration = 0;
  let eventTruth = new WeakMap();
  let shadowVariants = /** @type {readonly DataRecord[]} */ (Object.freeze([]));
  let calibrationId = null;
  let safetyReady = false;
  let freshCalibrationRequired = true;
  let pauseReason = /** @type {string | null} */ (null);
  let countdown = /** @type {DataRecord} */ (inactiveCountdown(0));
  let countdownStepStartedAtMs = 0;
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
  const obstacleStates = /** @type {Map<string, ObstacleState>} */ (new Map());
  const obstacleOutcomes = /** @type {DataRecord[]} */ ([]);
  const occupiedObstacleIds = new Set();
  /** Presentation-only hazard contact episode state (flow_colliders_v1 play purpose only). */
  let hazardContactSinceMs = null;
  let hazardContactReleasedAtMs = null;
  let previousNoseSample = /** @type {NoseSample | null} */ (null);
  let lastObstacleSourceIdentity = /** @type {string | null} */ (null);
  let obstacleEpisodeOrdinal = 0;
  const bombStates = /** @type {Map<string, BombState>} */ (new Map());
  const hazardOutcomes = /** @type {DataRecord[]} */ ([]);
  let previousLeftWristSample = /** @type {ColliderSample | null} */ (null);
  let previousRightWristSample = /** @type {ColliderSample | null} */ (null);
  let lastColliderFrame = /** @type {Readonly<{frameId:string,measurementTimestampMs:number,calibrationId:string,sourceIdentity:string}> | null} */ (null);
  let leftWristBaselineRequired = false;
  let rightWristBaselineRequired = false;
  let noseBaselineRequired = false;
  let pendingHazardBreak = false;
  let pendingBombContacts = 0;
  let pendingObstacleContacts = 0;
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
    getObstacleOutcomes: () => Object.freeze([...obstacleOutcomes]),
    getHazardOutcomes: () => Object.freeze([...hazardOutcomes]),
    getScorePartitions: () => Object.freeze([...partitions.values()].map((entry) => Object.freeze({ ...entry }))),
    subscribe,
    destroy
  });
  return service;

  /** @param {GameplayContentConfiguration} configuration @param {unknown} [options] */
  function configureContent(configuration, options) {
    assertOpen();
    const nextPurpose = normalizeContentConfigurationPurpose(options);
    const preserveVisualTest = nextPurpose === "visual_test" && sessionPurpose === "visual_test" && (state === "playing" || state === "paused_manual");
    const preservedVisualTestState = state;
    const preservedVisualTestPauseReason = pauseReason;
    const preservedVisualTestTimelinePositionMs = timelinePositionMs;
    const source = requireRecord(configuration, "content_configuration_invalid", 1500000);
    const nextPackageId = requireString(source.packageId, "content_package_invalid");
    const nextVariant = normalizeVariant(source.selectedVariant);
    const nextEvents = normalizeEvents(source.resolvedEvents, nextVariant);
    const nextProfileIdentity = source.profileIdentity === undefined ? defaultProfileIdentity() : normalizeProfile(source.profileIdentity);
    const nextScoringSettings = source.scoringSettings === undefined ? defaultScoringSettings() : normalizeScoringSettings(source.scoringSettings);
    const nextFlowColliderSettings = normalizeFlowColliderSettings(source.flowColliderSettings, nextVariant);
    const nextBoxingColliderSettings = normalizeBoxingColliderSettings(source.boxingColliderSettings, nextVariant);
    const nextShadowVariants = source.shadowVariants === undefined ? Object.freeze([]) : normalizeShadowVariants(source.shadowVariants);
    const nextContentGeneration = contentGeneration + 1;
    const nextEventTruth = bindEventTruth(nextEvents, nextPackageId, nextContentGeneration, nextVariant, nextProfileIdentity, nextScoringSettings, nextFlowColliderSettings, nextBoxingColliderSettings);
    packageId = nextPackageId;
    variant = nextVariant;
    contentGeneration = nextContentGeneration;
    eventTruth = nextEventTruth;
    events = nextEvents;
    profileIdentity = nextProfileIdentity;
    scoringSettings = nextScoringSettings;
    flowColliderSettings = nextFlowColliderSettings;
    boxingColliderSettings = nextBoxingColliderSettings;
    shadowVariants = nextShadowVariants;
    clearRunTruth();
    sessionPurpose = nextPurpose;
    if (nextPurpose === "visual_test") {
      state = preserveVisualTest ? preservedVisualTestState : "idle";
      pauseReason = preserveVisualTest ? preservedVisualTestPauseReason : null;
      if (preserveVisualTest) timelinePositionMs = preservedVisualTestTimelinePositionMs;
      calibrationId = null;
      invalidatedCalibrationId = null;
      safetyReady = false;
      freshCalibrationRequired = true;
    } else {
      state = "calibrating";
      pauseReason = "calibration_required";
    }
    generation += 1;
    publish(null);
    return snapshot;
  }

  /**
   * Start or explicitly restart the configured session.
   * A missing request preserves the legacy normal-Play calibrating-state API.
   *
   * @param {number} atTimestampMs
   * @param {unknown} [request]
   */
  function requestStart(atTimestampMs, request) {
    assertConfigured();
    const explicit = request !== undefined;
    const nextPurpose = normalizeStartPurpose(request);
    if (!explicit && state !== "calibrating") throw gameplayError("session_state_invalid", "Initial start requires the calibrating state");
    advanceTimestamp(atTimestampMs);
    if (explicit) {
      generation += 1;
      clearRunTruth();
      sessionPurpose = nextPurpose;
      pauseReason = null;
      if (nextPurpose === "visual_test") {
        calibrationId = null;
        invalidatedCalibrationId = null;
        safetyReady = false;
        freshCalibrationRequired = true;
      } else {
        state = "calibrating";
        pauseReason = "calibration_required";
      }
    } else sessionPurpose = "play";
    if (!hasRequiredLease()) {
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
      publish(null);
      return Object.freeze({ accepted: false, reason: "media_lease_unavailable" });
    }
    if (sessionPurpose === "visual_test") {
      state = "playing";
      pauseReason = null;
      publish(null);
      return Object.freeze({ accepted: true, reason: null });
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
    if (state === "destroyed" || state === "completed") return snapshot;
    cancelCountdown();
    state = "paused_manual";
    pauseReason = boundedReason(reason);
    clearContinuousCollisionHistory();
    publish(null);
    return snapshot;
  }

  /** @param {number} atTimestampMs */
  function resume(atTimestampMs) {
    assertConfigured();
    if (state !== "paused_manual" && state !== "paused_tracking") throw gameplayError("session_state_invalid", "Resume requires a paused session");
    advanceTimestamp(atTimestampMs);
    clearContinuousCollisionHistory();
    if (!hasRequiredLease()) {
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
      publish(null);
      return Object.freeze({ accepted: false, reason: "media_lease_unavailable" });
    }
    if (sessionPurpose === "visual_test") {
      state = "playing";
      pauseReason = null;
      publish(null);
      return Object.freeze({ accepted: true, reason: null });
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
    if (nextInput !== null && sessionPurpose === "play") commitInput(nextInput);
    enforceLease();
    enforceSafety();
    if (enteredAsCountdown && state === "countdown") advanceCountdown(clock);
    if (enteredState === "playing" && state === "playing") {
      if (!clock.playing) {
        if (sessionPurpose === "visual_test" && clock.ended) {
          timelinePositionMs = clock.positionMs;
          state = "completed";
          pauseReason = null;
        } else {
          state = "paused_manual";
          pauseReason = "audio_clock_not_playing";
          clearContinuousCollisionHistory();
        }
      } else if (clock.positionMs < previousTimelinePositionMs) {
        state = "paused_manual";
        pauseReason = "audio_clock_rollback";
        clearContinuousCollisionHistory();
      } else {
        timelinePositionMs = clock.positionMs;
        if (sessionPurpose === "play") {
          captureEvidenceForTimeline();
          if (variant?.rulesetId === FLOW_COLLIDER_RULESET) {
            evaluateFlowColliderNotesAndBombs();
            evaluateFlowObstacles();
            applyPendingColliderHazards();
          } else if (variant?.rulesetId === BOXING_COLLIDER_RULESET) {
            evaluateBoxingColliderNotes();
          } else {
            evaluateFlowObstacles();
            judgeLiveEvents();
          }
          judgeShadowEvents();
          if (events.length > 0 && judgedIds.size + obstacleOutcomes.length + hazardOutcomes.filter((outcome) => outcome.kind === "bomb").length + suppressedObstacleCount() >= events.length) {
            state = "completed";
            pauseReason = null;
          }
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
    if (state !== "paused_manual" && state !== "completed") throw gameplayError("session_state_invalid", "Paused clock synchronization requires a manual pause or completed session");
    const enteredCompleted = state === "completed";
    const safeFrame = requireDataRecordFields(frame, "paused_clock_frame_invalid", ["timestampMs", "clock"]);
    const nextTimestampMs = requireNonNegativeNumber(safeFrame.timestampMs, "timestamp_invalid");
    if (nextTimestampMs < timestampMs) throw gameplayError("timestamp_rollback", "Gameplay timestamps must not roll back");
    const clock = normalizeClock(safeFrame.clock);
    if (clock.playing) throw gameplayError("paused_clock_not_frozen", "Paused clock synchronization requires a stopped audio clock");
    timestampMs = nextTimestampMs;
    timelinePositionMs = clock.positionMs;
    if (enteredCompleted) { state = "paused_manual"; pauseReason = "explicit_seek"; }
    clearContinuousCollisionHistory();
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
    const nextFlowColliderSettings = source.flowColliderSettings === undefined && nextVariant.rulesetId === FLOW_COLLIDER_RULESET ? flowColliderSettings : normalizeFlowColliderSettings(source.flowColliderSettings, nextVariant);
    if (nextVariant.rulesetId === FLOW_COLLIDER_RULESET && flowColliderSettingsIdentity(nextFlowColliderSettings) !== flowColliderSettingsIdentity(flowColliderSettings)) throw gameplayError("flow_collider_settings_locked", "Flow Collider settings are locked for the complete run");
    const nextBoxingColliderSettings = source.boxingColliderSettings === undefined && nextVariant.rulesetId === BOXING_COLLIDER_RULESET ? boxingColliderSettings : normalizeBoxingColliderSettings(source.boxingColliderSettings, nextVariant);
    if (nextVariant.rulesetId === BOXING_COLLIDER_RULESET && boxingColliderSettingsIdentity(nextBoxingColliderSettings) !== boxingColliderSettingsIdentity(boxingColliderSettings)) throw gameplayError("boxing_collider_settings_locked", "Boxing Collider reach and guard settings are locked for the complete run");
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
    for (const event of acceptedNextEvents) nextEventTruth.set(event, makeEventTruth(nextPackageId, nextContentGeneration, nextVariant, nextProfileIdentity, nextScoringSettings, nextFlowColliderSettings, nextBoxingColliderSettings));
    events = Object.freeze(merged);
    variant = nextVariant;
    contentGeneration = nextContentGeneration;
    eventTruth = nextEventTruth;
    profileIdentity = nextProfileIdentity;
    scoringSettings = nextScoringSettings;
    flowColliderSettings = nextFlowColliderSettings;
    boxingColliderSettings = nextBoxingColliderSettings;
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
    clearContinuousCollisionHistory();
    publish(null);
    return snapshot;
  }

  /** @param {number} [atTimestampMs] */
  function reset(atTimestampMs = timestampMs) {
    assertOpen();
    advanceTimestamp(atTimestampMs);
    generation += 1;
    clearRunTruth();
    sessionPurpose = "play";
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
    clearColliderSamples(); previousNoseSample = null; lastObstacleSourceIdentity = null; occupiedObstacleIds.clear(); hazardContactSinceMs = null; hazardContactReleasedAtMs = null; bombStates.clear();
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
    // The input service is the authoritative source for whether recalibration
    // is required. It distinguishes tracking losses (recoverable via partial
    // auto-recovery, same calibrationId) from source changes (full T-pose,
    // new calibrationId). The coordinator trusts the upstream signal rather
    // than re-deriving it from the calibrationId.
    freshCalibrationRequired = normalized.upstreamFreshRequired === true || nextCalibrationId === null;
    safetyReady = (readiness === "ready" || readiness === "countdown") && !trackingPaused && !freshCalibrationRequired;
    if (nextCalibrationId !== calibrationId) {
      const priorCalibrationId = calibrationId;
      calibrationId = nextCalibrationId;
      latestEvidence = null;
      lastEvidenceFrameId = null;
      clearContinuousCollisionHistory(priorCalibrationId !== null);
    }
    if (safetyReady && invalidatedCalibrationId !== null && nextCalibrationId !== invalidatedCalibrationId) invalidatedCalibrationId = null;
    if (normalized.candidate !== null) latestEvidence = /** @type {AeroGameplayEvidenceSnapshot} */ (normalized.candidate);
  }

  function captureEvidenceForTimeline() {
    if (!latestEvidence || latestEvidence.measuredSourceFrameId === lastEvidenceFrameId) return;
    latestEvidenceTimelineMs = timelinePositionMs;
  }

  function enforceSafety() {
    if (sessionPurpose === "visual_test") return;
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
    clearContinuousCollisionHistory();
  }

  function hasRequiredLease() {
    if (!leaseSnapshot || !instanceId) return true;
    return leaseSnapshot.ownerInstanceId === instanceId && leaseSnapshot.state === "owned" && Array.isArray(leaseSnapshot.resources) && leaseSnapshot.resources.includes("audio") && (sessionPurpose === "visual_test" || leaseSnapshot.resources.includes("camera"));
  }

  function enforceLease() {
    if (hasRequiredLease()) return;
    if (state === "playing" || state === "countdown") {
      cancelCountdown();
      state = "paused_manual";
      pauseReason = "media_lease_unavailable";
      clearContinuousCollisionHistory();
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
    countdownStepStartedAtMs = timestampMs;
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
      clearContinuousCollisionHistory();
      return;
    }
    if (timestampMs - countdownStepStartedAtMs < countdownStepMs) {
      countdown = countdownSnapshot(countdown.state, countdownReason, countdown.value, timestampMs, calibrationId);
      return;
    }
    countdownStepStartedAtMs = timestampMs;
    if (countdown.state === "three") countdown = countdownSnapshot("two", countdownReason, 2, timestampMs, calibrationId);
    else if (countdown.state === "two") countdown = countdownSnapshot("one", countdownReason, 1, timestampMs, calibrationId);
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

  function suppressedObstacleCount() { return variant?.mode === "flow" && (variant.modifierIds.includes("no_obstacles") || variant.modifierIds.includes("obstacle_visual_only")) ? events.filter((event) => event.type === "obstacle").length : 0; }

  function evaluateFlowObstacles() {
    if (!variant || variant.mode !== "flow" || sessionPurpose !== "play" || variant.modifierIds.includes("no_obstacles") || variant.modifierIds.includes("obstacle_visual_only")) return;
    const obstacles = events.filter((event) => event.type === "obstacle" && !obstacleOutcomes.some((outcome) => outcome.eventId === event.eventId));
    if (obstacles.length === 0) return;
    /** @type {NoseSample | null} */
    const sample = latestEvidence ? measuredNoseSample(/** @type {DataRecord} */ (latestEvidence), timelinePositionMs, timestampMs) : null;
    if (!sample || sample.calibrationId !== calibrationId || !lastInput || (variant.rulesetId === FLOW_COLLIDER_RULESET && (typeof lastInput.sourceIdentity !== "string" || timestampMs - sample.measurementTimestampMs >= maximumColliderSampleFreshnessMs))) { previousNoseSample = null; lastObstacleSourceIdentity = null; occupiedObstacleIds.clear(); finalizeObstacles(obstacles); return; }
    if (variant.rulesetId === FLOW_COLLIDER_RULESET && lastObstacleSourceIdentity !== null && lastObstacleSourceIdentity !== lastInput.sourceIdentity) { previousNoseSample = null; occupiedObstacleIds.clear(); lastObstacleSourceIdentity = String(lastInput.sourceIdentity); finalizeObstacles(obstacles); return; }
    if (variant.rulesetId === FLOW_COLLIDER_RULESET) lastObstacleSourceIdentity = String(lastInput.sourceIdentity);
    const prior = previousNoseSample;
    if (sample.sourceFrameId === lastEvidenceFrameId) {
      const identicalRepeat = prior !== null && prior.sourceFrameId === sample.sourceFrameId && prior.calibrationId === sample.calibrationId && prior.measurementTimestampMs === sample.measurementTimestampMs && prior.sx === sample.sx && prior.sy === sample.sy;
      if (identicalRepeat) return;
      previousNoseSample = null;
      occupiedObstacleIds.clear();
      finalizeObstacles(obstacles);
      return;
    }
    lastEvidenceFrameId = sample.sourceFrameId;
    latestEvidenceTimelineMs = sample.songTimeMs;
    if (variant.rulesetId === FLOW_COLLIDER_RULESET && noseBaselineRequired) { noseBaselineRequired = false; previousNoseSample = sample; finalizeObstacles(obstacles); return; }
    if (prior !== null && (sample.measurementTimestampMs <= prior.measurementTimestampMs || sample.songTimeMs <= prior.songTimeMs)) {
      previousNoseSample = null;
      occupiedObstacleIds.clear();
      finalizeObstacles(obstacles);
      return;
    }
    const continuous = prior !== null && prior.calibrationId === sample.calibrationId && sample.measurementTimestampMs - prior.measurementTimestampMs <= maximumObstacleSampleGapMs && sample.songTimeMs - prior.songTimeMs <= maximumObstacleSampleGapMs;
    if (prior !== null && !continuous) occupiedObstacleIds.clear();
    /** @type {{timelineMs:number,kind:"enter"|"exit",eventId:string}[]} */ const boundaries = [];
    for (const obstacle of obstacles) {
      const eventId = String(obstacle.eventId);
      let tracker = obstacleStates.get(eventId) ?? { coverage: Object.freeze([]), contact: Object.freeze([]), firstContactTimelinePositionMs: null, contactEpisodeId: null, evidenceFrameId: null, calibrationId: null, consequenceApplied: false };
      if (continuous && prior) {
        const coverageStart = Math.max(prior.songTimeMs, Number(obstacle.intervalStartTimestampMs));
        const coverageEnd = Math.min(sample.songTimeMs, Number(obstacle.intervalEndTimestampMs));
        if (coverageStart <= coverageEnd) tracker = { ...tracker, coverage: addInterval(tracker.coverage, coverageStart, coverageEnd) };
        const contact = clipNoseSegment(obstacle, prior, sample);
        if (contact) {
          tracker = { ...tracker, contact: addInterval(tracker.contact, contact.startMs, contact.endMs), firstContactTimelinePositionMs: tracker.firstContactTimelinePositionMs ?? contact.startMs, evidenceFrameId: tracker.evidenceFrameId ?? sample.sourceFrameId, calibrationId: tracker.calibrationId ?? sample.calibrationId };
          const beganInside = pointContactsObstacle(obstacle, prior);
          const endedInside = pointContactsObstacle(obstacle, sample);
          if (!occupiedObstacleIds.has(eventId) && (!beganInside || contact.startMs >= prior.songTimeMs)) boundaries.push({ timelineMs: contact.startMs, kind: "enter", eventId });
          if (!endedInside) boundaries.push({ timelineMs: contact.endMs, kind: "exit", eventId });
        } else if (occupiedObstacleIds.has(eventId)) boundaries.push({ timelineMs: prior.songTimeMs, kind: "exit", eventId });
      } else if (pointContactsObstacle(obstacle, sample)) {
        tracker = { ...tracker, contact: addInterval(tracker.contact, sample.songTimeMs, sample.songTimeMs), firstContactTimelinePositionMs: tracker.firstContactTimelinePositionMs ?? sample.songTimeMs, evidenceFrameId: tracker.evidenceFrameId ?? sample.sourceFrameId, calibrationId: tracker.calibrationId ?? sample.calibrationId };
        boundaries.push({ timelineMs: sample.songTimeMs, kind: "enter", eventId }, { timelineMs: sample.songTimeMs, kind: "exit", eventId });
      }
      obstacleStates.set(eventId, tracker);
    }
    processObstacleBoundaries(boundaries);
    previousNoseSample = sample;
    finalizeObstacles(obstacles);
  }

  /** @param {readonly {timelineMs:number,kind:"enter"|"exit",eventId:string}[]} boundaries */
  function processObstacleBoundaries(boundaries) {
    const ordered = [...boundaries].sort((left, right) => left.timelineMs - right.timelineMs || (left.kind === right.kind ? compareCodePoints(left.eventId, right.eventId) : left.kind === "enter" ? -1 : 1));
    let index = 0;
    while (index < ordered.length) {
      const timelineMs = ordered[index].timelineMs; const group = [];
      while (index < ordered.length && ordered[index].timelineMs === timelineMs) group.push(ordered[index++]);
      const entrants = group.filter((entry) => entry.kind === "enter" && !occupiedObstacleIds.has(entry.eventId));
      if (occupiedObstacleIds.size === 0 && entrants.length > 0) {
        if (variant?.rulesetId === FLOW_COLLIDER_RULESET && sessionPurpose === "play") hazardContactSinceMs = timelineMs;
        obstacleEpisodeOrdinal += 1; const episodeId = `${sessionId}:g${generation}:obstacle:${obstacleEpisodeOrdinal}`;
        const winner = [...entrants].sort((left, right) => compareCodePoints(left.eventId, right.eventId))[0];
        for (const entry of entrants) { const tracker = obstacleStates.get(entry.eventId); if (tracker && tracker.contactEpisodeId === null) tracker.contactEpisodeId = episodeId; }
        const tracker = obstacleStates.get(winner.eventId); if (tracker) tracker.consequenceApplied = true;
        applyObstacleConsequence();
      }
      for (const entry of entrants) occupiedObstacleIds.add(entry.eventId);
      for (const entry of group) if (entry.kind === "exit") occupiedObstacleIds.delete(entry.eventId);
      if (occupiedObstacleIds.size === 0 && hazardContactSinceMs !== null && variant?.rulesetId === FLOW_COLLIDER_RULESET && sessionPurpose === "play") { hazardContactReleasedAtMs = timelineMs; hazardContactSinceMs = null; }
    }
  }

  function applyObstacleConsequence() {
    if (!variant) return;
    if (variant.rulesetId === FLOW_COLLIDER_RULESET) { pendingHazardBreak = true; pendingObstacleContacts += 1; return; }
    const current = scorePartition(variant, profileIdentity, scoringSettings); const next = { ...current, combo: 0, obstacleContacts: Number(current.obstacleContacts ?? 0) + 1 };
    partitions.set(String(current.partitionId), Object.freeze(next));
  }

  /** @param {readonly DataRecord[]} obstacles */
  function finalizeObstacles(obstacles) {
    for (const obstacle of obstacles) {
      if (timelinePositionMs < Number(obstacle.intervalEndTimestampMs)) continue;
      const eventId = String(obstacle.eventId); const tracker = obstacleStates.get(eventId) ?? { coverage: [], contact: [], firstContactTimelinePositionMs: null, contactEpisodeId: null, evidenceFrameId: null, calibrationId: null, consequenceApplied: false };
      const result = tracker.contact.length > 0 ? "contact" : coversInterval(tracker.coverage, Number(obstacle.intervalStartTimestampMs), Number(obstacle.intervalEndTimestampMs)) ? "avoided" : "unevaluated_tracking";
      const contactDurationMs = tracker.contact.reduce((total, interval) => total + interval.endMs - interval.startMs, 0);
      if (variant?.rulesetId === FLOW_COLLIDER_RULESET) {
        const outcome = Object.freeze({ schema: "aerobeat/flow_hazard_outcome", version: 1, eventId, rulesetId: FLOW_COLLIDER_RULESET, kind: "wall", result, committedTimelinePositionMs: timelinePositionMs, consequenceApplied: tracker.consequenceApplied });
        hazardOutcomes.push(outcome);
      } else obstacleOutcomes.push(Object.freeze({ schema: "aerobeat/obstacle_outcome", version: 1, eventId, rulesetId: String(variant?.rulesetId ?? FLOW_COLLIDER_RULESET), result, intervalStartTimestampMs: Number(obstacle.intervalStartTimestampMs), intervalEndTimestampMs: Number(obstacle.intervalEndTimestampMs), committedTimelinePositionMs: timelinePositionMs, firstContactTimelinePositionMs: tracker.firstContactTimelinePositionMs, contactDurationMs, contactEpisodeId: tracker.contactEpisodeId, evidenceFrameId: result === "contact" ? tracker.evidenceFrameId : null, calibrationId: result === "contact" ? tracker.calibrationId : null, consequenceApplied: tracker.consequenceApplied }));
      occupiedObstacleIds.delete(eventId); obstacleStates.delete(eventId);
      if (occupiedObstacleIds.size === 0 && hazardContactSinceMs !== null && variant?.rulesetId === FLOW_COLLIDER_RULESET && sessionPurpose === "play") { hazardContactReleasedAtMs = timelinePositionMs; hazardContactSinceMs = null; }
    }
    obstacleOutcomes.sort((left, right) => compareCodePoints(String(left.eventId), String(right.eventId)));
  }

  function evaluateFlowColliderNotesAndBombs() {
    if (!variant || variant.rulesetId !== FLOW_COLLIDER_RULESET || !latestEvidence || !lastInput) { finalizeColliderEvents(); return; }
    const left = measuredColliderSample(/** @type {DataRecord} */ (latestEvidence), lastInput, "left_wrist", timelinePositionMs, timestampMs);
    const right = measuredColliderSample(/** @type {DataRecord} */ (latestEvidence), lastInput, "right_wrist", timelinePositionMs, timestampMs);
    const validSample = left ?? right;
    if (!validSample || validSample.calibrationId !== calibrationId) { clearColliderSamples(); finalizeColliderEvents(); return; }
    const frame = Object.freeze({ frameId: validSample.sourceFrameId, measurementTimestampMs: validSample.measurementTimestampMs, calibrationId: validSample.calibrationId, sourceIdentity: validSample.sourceIdentity });
    if (lastColliderFrame?.frameId === frame.frameId) {
      if (lastColliderFrame.measurementTimestampMs === frame.measurementTimestampMs && lastColliderFrame.calibrationId === frame.calibrationId && lastColliderFrame.sourceIdentity === frame.sourceIdentity) { finalizeColliderEvents(); return; }
      clearColliderSamples(); finalizeColliderEvents(); return;
    }
    if (lastColliderFrame && (frame.measurementTimestampMs <= lastColliderFrame.measurementTimestampMs || frame.sourceIdentity !== lastColliderFrame.sourceIdentity || frame.calibrationId !== lastColliderFrame.calibrationId)) {
      clearColliderSamples(); lastColliderFrame = frame; previousLeftWristSample = left; previousRightWristSample = right; satisfyWristRecoveryBaselines(left, right); finalizeColliderEvents(); return;
    }
    const seedLeftOnly = left !== null && leftWristBaselineRequired; const seedRightOnly = right !== null && rightWristBaselineRequired;
    const priorLeft = left === null || seedLeftOnly ? null : previousLeftWristSample; const priorRight = right === null || seedRightOnly ? null : previousRightWristSample;
    /** @type {{event:DataRecord,evidence:ColliderSample,contactMs:number,hand:"left"|"right"}[]} */ const candidates = [];
    for (const event of events) {
      if (judgedIds.has(String(event.eventId)) || event.type !== "note") continue;
      const eventSettings = flowColliderSettingsForEvent(event);
      const hand = event.hand === "right" ? "right" : "left";
      const current = hand === "right" ? right : left; const prior = hand === "right" ? priorRight : priorLeft;
      if (current === null || (hand === "left" ? seedLeftOnly : seedRightOnly)) continue;
      const segmentContact = clipWristSegmentToTarget(event, prior, current, Number(eventSettings.colliderRadius), Number(eventSettings.timingWindowMs));
      const pointContact = segmentContact === null && pointContactsFlowTarget(event, current, Number(eventSettings.colliderRadius), Number(eventSettings.timingWindowMs));
      if (!segmentContact && !pointContact) continue;
      const direction = event.direction === undefined ? undefined : flowDirectionName(event.direction) ?? undefined;
      if (eventSettings.enforceAuthoredDirection === true && event.direction !== undefined && !matchesAuthoredDirection(direction, prior, current, Number(eventSettings.directionToleranceDegrees))) continue;
      candidates.push({ event, evidence: current, contactMs: segmentContact?.startMs ?? current.songTimeMs, hand });
    }
    /** @type {typeof candidates} */ const accepted = [];
    for (const hand of /** @type {const} */ (["left", "right"])) {
      const ordered = candidates.filter((candidate) => candidate.hand === hand).sort((a, b) => a.contactMs - b.contactMs || Number(a.event.centerTimestampMs) - Number(b.event.centerTimestampMs) || compareCodePoints(String(a.event.eventId), String(b.event.eventId)));
      if (ordered.length === 0) continue;
      const chordCenter = Number(ordered[0].event.centerTimestampMs);
      accepted.push(...ordered.filter((candidate) => Number(candidate.event.centerTimestampMs) === chordCenter));
    }
    accepted.sort((a, b) => Number(a.event.centerTimestampMs) - Number(b.event.centerTimestampMs) || compareCodePoints(String(a.event.eventId), String(b.event.eventId)));
    for (const candidate of accepted) recordJudgementAt(candidate.event, "hit", Object.freeze([]), /** @type {AeroGameplayEvidenceSnapshot} */ (latestEvidence), false, candidate.contactMs);
    evaluateColliderBombs(left, right, priorLeft, priorRight, !seedLeftOnly, !seedRightOnly);
    previousLeftWristSample = left; previousRightWristSample = right; lastColliderFrame = frame; satisfyWristRecoveryBaselines(left, right);
    finalizeColliderEvents();
  }

  /** @param {ColliderSample | null} left @param {ColliderSample | null} right @param {ColliderSample | null} priorLeft @param {ColliderSample | null} priorRight @param {boolean} evaluateLeft @param {boolean} evaluateRight */
  function evaluateColliderBombs(left, right, priorLeft, priorRight, evaluateLeft, evaluateRight) {
    for (const bomb of events.filter((event) => event.type === "bomb" && !hazardOutcomes.some((outcome) => outcome.kind === "bomb" && outcome.eventId === event.eventId))) {
      const eventId = String(bomb.eventId); const settings = flowColliderSettingsForEvent(bomb); const radius = Number(settings.colliderRadius); const windowMs = Number(settings.timingWindowMs); const start = Number(bomb.centerTimestampMs) - windowMs; const end = Number(bomb.centerTimestampMs) + windowMs;
      let tracker = bombStates.get(eventId) ?? { leftCoverage: Object.freeze([]), rightCoverage: Object.freeze([]), contactTimelinePositionMs: null, consequenceApplied: false };
      const leftContinuous = evaluateLeft && left !== null && isContinuousColliderSegment(priorLeft, left); const rightContinuous = evaluateRight && right !== null && isContinuousColliderSegment(priorRight, right);
      if (leftContinuous && priorLeft && left) { const coverageStart = Math.max(start, priorLeft.songTimeMs); const coverageEnd = Math.min(end, left.songTimeMs); if (coverageStart <= coverageEnd) tracker = { ...tracker, leftCoverage: addInterval(tracker.leftCoverage, coverageStart, coverageEnd) }; }
      if (rightContinuous && priorRight && right) { const coverageStart = Math.max(start, priorRight.songTimeMs); const coverageEnd = Math.min(end, right.songTimeMs); if (coverageStart <= coverageEnd) tracker = { ...tracker, rightCoverage: addInterval(tracker.rightCoverage, coverageStart, coverageEnd) }; }
      const leftContact = !evaluateLeft || left === null ? null : clipWristSegmentToTarget(bomb, priorLeft, left, radius, windowMs)?.startMs ?? (pointContactsFlowTarget(bomb, left, radius, windowMs) ? left.songTimeMs : null);
      const rightContact = !evaluateRight || right === null ? null : clipWristSegmentToTarget(bomb, priorRight, right, radius, windowMs)?.startMs ?? (pointContactsFlowTarget(bomb, right, radius, windowMs) ? right.songTimeMs : null);
      const contact = [leftContact, rightContact].filter((value) => value !== null).sort((a, b) => Number(a) - Number(b))[0];
      if (contact !== undefined && tracker.contactTimelinePositionMs === null) {
        tracker = { ...tracker, contactTimelinePositionMs: Number(contact), consequenceApplied: true };
        hazardOutcomes.push(Object.freeze({ schema: "aerobeat/flow_hazard_outcome", version: 1, eventId, rulesetId: FLOW_COLLIDER_RULESET, kind: "bomb", result: "contact", committedTimelinePositionMs: timelinePositionMs, consequenceApplied: true }));
        pendingHazardBreak = true; pendingBombContacts += 1;
      }
      bombStates.set(eventId, tracker);
    }
  }

  function finalizeColliderEvents() {
    if (!variant || variant.rulesetId !== FLOW_COLLIDER_RULESET) return;
    for (const event of events) {
      const eventId = String(event.eventId); const settings = flowColliderSettingsForEvent(event); const late = Number(event.centerTimestampMs) + Number(settings.timingWindowMs);
      if (event.type === "note" && !judgedIds.has(eventId) && timelinePositionMs > late) recordJudgementAt(event, "miss", colliderMissDiagnostics(event), null, false, null);
      else if ((event.type === "arc" || event.type === "burst") && !judgedIds.has(eventId) && timelinePositionMs >= Number(event.centerTimestampMs)) recordJudgement(event, "ignored", Object.freeze([]), null, false);
      else if (event.type === "bomb" && timelinePositionMs > late && !hazardOutcomes.some((outcome) => outcome.kind === "bomb" && outcome.eventId === eventId)) {
        const tracker = bombStates.get(eventId) ?? { leftCoverage: [], rightCoverage: [], contactTimelinePositionMs: null, consequenceApplied: false };
        const result = coversInterval(tracker.leftCoverage, Number(event.centerTimestampMs) - Number(settings.timingWindowMs), late) && coversInterval(tracker.rightCoverage, Number(event.centerTimestampMs) - Number(settings.timingWindowMs), late) ? "avoided" : "unevaluated_tracking";
        hazardOutcomes.push(Object.freeze({ schema: "aerobeat/flow_hazard_outcome", version: 1, eventId, rulesetId: FLOW_COLLIDER_RULESET, kind: "bomb", result, committedTimelinePositionMs: timelinePositionMs, consequenceApplied: false }));
        bombStates.delete(eventId);
      }
    }
    hazardOutcomes.sort((a, b) => Number(a.committedTimelinePositionMs) - Number(b.committedTimelinePositionMs) || compareCodePoints(String(a.eventId), String(b.eventId)));
  }

  /** @param {DataRecord} event */
  function colliderMissDiagnostics(event) {
    if (!latestEvidence || !lastInput) return Object.freeze(["no_input"]);
    if (latestEvidence.calibrationId !== calibrationId) return Object.freeze(["calibration_mismatch"]);
    const age = timestampMs - latestEvidence.measurementTimestampMs;
    if (age < 0 || age >= maximumColliderSampleFreshnessMs) return Object.freeze(["stale_input"]);
    return Object.freeze([flowColliderSettingsForEvent(event).enforceAuthoredDirection === true && event.direction !== undefined ? "wrong_direction" : "wrong_collider"]);
  }

  function clearColliderSamples() { previousLeftWristSample = null; previousRightWristSample = null; lastColliderFrame = null; }
  /** @param {boolean} [requireRecoveryBaselines] */
  function clearContinuousCollisionHistory(requireRecoveryBaselines = true) {
    clearColliderSamples(); previousNoseSample = null; lastObstacleSourceIdentity = null; occupiedObstacleIds.clear(); hazardContactSinceMs = null; hazardContactReleasedAtMs = null;
    if (requireRecoveryBaselines && (variant?.rulesetId === FLOW_COLLIDER_RULESET || variant?.rulesetId === BOXING_COLLIDER_RULESET)) { leftWristBaselineRequired = true; rightWristBaselineRequired = true; noseBaselineRequired = true; }
  }
  /** @param {ColliderSample | null} left @param {ColliderSample | null} right */
  function satisfyWristRecoveryBaselines(left, right) { if (left !== null) leftWristBaselineRequired = false; if (right !== null) rightWristBaselineRequired = false; }

  function applyPendingColliderHazards() {
    if (!pendingHazardBreak || !variant) return;
    const current = scorePartition(variant, profileIdentity, scoringSettings);
    partitions.set(String(current.partitionId), Object.freeze({ ...current, combo: 0, bombContacts: Number(current.bombContacts ?? 0) + pendingBombContacts, obstacleContacts: Number(current.obstacleContacts ?? 0) + pendingObstacleContacts }));
    pendingHazardBreak = false; pendingBombContacts = 0; pendingObstacleContacts = 0;
  }

  /**
   * Boxing Collider (boxing_collider_v1) scoring: swept 2.5D wrist contacts at
   * reach-row targets (shared contracts row mapping), straight/hook/uppercut
   * hand-attributed, straight ALWAYS overlap-only, uppercut/hook optionally
   * direction-enforced. Guards run in collision or gesture mode; neither lets
   * the nose guard; straight 100ms hold semantics do not apply.
   */
  function evaluateBoxingColliderNotes() {
    if (!variant || variant.rulesetId !== BOXING_COLLIDER_RULESET || !latestEvidence || !lastInput) { finalizeBoxingColliderEvents(); return; }
    // Gesture mode evaluates pure normalized landmarks on every fresh
    // evidence frame; the collider-sample/recovery plumbing below is
    // collision-mode only and must not veto a pose Count. Late-window misses
    // still finalize through the shared path in both modes.
    if (boxingColliderSettings.guardCountMode === "gesture") { evaluateBoxingColliderGestureFrames(); finalizeBoxingColliderEvents(); return; }
    const left = measuredColliderSample(/** @type {DataRecord} */ (latestEvidence), lastInput, "left_wrist", timelinePositionMs, timestampMs);
    const right = measuredColliderSample(/** @type {DataRecord} */ (latestEvidence), lastInput, "right_wrist", timelinePositionMs, timestampMs);
    const validSample = left ?? right;
    if (!validSample || validSample.calibrationId !== calibrationId) { clearColliderSamples(); finalizeBoxingColliderEvents(); return; }
    const frame = Object.freeze({ frameId: validSample.sourceFrameId, measurementTimestampMs: validSample.measurementTimestampMs, calibrationId: validSample.calibrationId, sourceIdentity: validSample.sourceIdentity });
    if (lastColliderFrame?.frameId === frame.frameId) {
      if (lastColliderFrame.measurementTimestampMs === frame.measurementTimestampMs && lastColliderFrame.calibrationId === frame.calibrationId && lastColliderFrame.sourceIdentity === frame.sourceIdentity) { finalizeBoxingColliderEvents(); return; }
      clearColliderSamples(); finalizeBoxingColliderEvents(); return;
    }
    if (lastColliderFrame && (frame.measurementTimestampMs <= lastColliderFrame.measurementTimestampMs || frame.sourceIdentity !== lastColliderFrame.sourceIdentity || frame.calibrationId !== lastColliderFrame.calibrationId)) {
      clearColliderSamples(); lastColliderFrame = frame; previousLeftWristSample = left; previousRightWristSample = right; satisfyWristRecoveryBaselines(left, right); finalizeBoxingColliderEvents(); return;
    }
    const seedLeftOnly = left !== null && leftWristBaselineRequired; const seedRightOnly = right !== null && rightWristBaselineRequired;
    const priorLeft = left === null || seedLeftOnly ? null : previousLeftWristSample; const priorRight = right === null || seedRightOnly ? null : previousRightWristSample;
    const reach = Object.freeze({ topRowReachWU: Number(boxingColliderSettings.topRowReachWU), bottomRowReachWU: Number(boxingColliderSettings.bottomRowReachWU) });
    /** @type {{event:DataRecord,evidence:ColliderSample,contactMs:number,hand:"left"|"right"}[]} */ const candidates = [];
    /** @type {{event:DataRecord,evidence:ColliderSample,contactMs:number,leftContact:boolean,rightContact:boolean}[]} */ const guardCandidates = [];
    for (const event of events) {
      if (judgedIds.has(String(event.eventId))) continue;
      const action = expectedAction(event);
      if (PUNCH_ACTIONS.includes(action)) {
        const hand = action.endsWith("_right") ? "right" : "left";
        const current = hand === "right" ? right : left; const prior = hand === "right" ? priorRight : priorLeft;
        if (current === null || (hand === "left" ? seedLeftOnly : seedRightOnly)) continue;
        const placement = Number(event.spatialTarget.targetCell);
        const target = Object.freeze({ centerTimestampMs: Number(event.centerTimestampMs), ...boxingColliderTargetCenter(placement, reach) });
        const contact = clipWristSegmentToBoxingTarget(event, target, prior, current, Number(boxingColliderSettings.colliderRadius), Number(boxingColliderSettings.timingWindowMs));
        const point = contact === null && pointContactsBoxingTarget(target, current, Number(boxingColliderSettings.colliderRadius), Number(boxingColliderSettings.timingWindowMs));
        if (!contact && !point) continue;
        if (!matchesBoxingAuthoredDirection(action, prior, current, boxingColliderSettings.enforceAuthoredDirection === true, Number(boxingColliderSettings.directionToleranceDegrees))) continue;
        candidates.push({ event, evidence: current, contactMs: contact?.startMs ?? current.songTimeMs, hand });
      } else if (action === "guard" || action === "crossed_guard") {
        const target = /** @type {DataRecord | undefined} */ (event.guardTarget);
        if (!target) continue;
        const leftCell = Number(target.leftCell); const rightCell = Number(target.rightCell);
        const leftTarget = Object.freeze({ centerTimestampMs: Number(event.centerTimestampMs), ...boxingColliderTargetCenter(leftCell, reach) });
        const rightTarget = Object.freeze({ centerTimestampMs: Number(event.centerTimestampMs), ...boxingColliderTargetCenter(rightCell, reach) });
        const radius = Number(boxingColliderSettings.colliderRadius); const windowMs = Number(boxingColliderSettings.timingWindowMs);
        const leftContact = left !== null && !seedLeftOnly && (clipWristSegmentToBoxingTarget(event, leftTarget, priorLeft, left, radius, windowMs) !== null || pointContactsBoxingTarget(leftTarget, left, radius, windowMs));
        const rightContact = right !== null && !seedRightOnly && (clipWristSegmentToBoxingTarget(event, rightTarget, priorRight, right, radius, windowMs) !== null || pointContactsBoxingTarget(rightTarget, right, radius, windowMs));
        if (!leftContact || !rightContact) continue;
        guardCandidates.push({ event, evidence: validSample, contactMs: Math.max(left?.songTimeMs ?? 0, right?.songTimeMs ?? 0), leftContact: true, rightContact: true });
      }
    }
    /** @type {typeof candidates} */ const accepted = [];
    for (const hand of /** @type {const} */ (["left", "right"])) {
      const ordered = candidates.filter((candidate) => candidate.hand === hand).sort((a, b) => a.contactMs - b.contactMs || Number(a.event.centerTimestampMs) - Number(b.event.centerTimestampMs) || compareCodePoints(String(a.event.eventId), String(b.event.eventId)));
      if (ordered.length === 0) continue;
      const chordCenter = Number(ordered[0].event.centerTimestampMs);
      accepted.push(...ordered.filter((candidate) => Number(candidate.event.centerTimestampMs) === chordCenter));
    }
    accepted.sort((a, b) => Number(a.event.centerTimestampMs) - Number(b.event.centerTimestampMs) || compareCodePoints(String(a.event.eventId), String(b.event.eventId)));
    for (const candidate of accepted) recordJudgementAt(candidate.event, "hit", Object.freeze([]), /** @type {AeroGameplayEvidenceSnapshot} */ (latestEvidence), false, candidate.contactMs);
    for (const candidate of guardCandidates) recordJudgementAt(candidate.event, "hit", Object.freeze([]), /** @type {AeroGameplayEvidenceSnapshot} */ (latestEvidence), false, candidate.contactMs);
    previousLeftWristSample = left; previousRightWristSample = right; lastColliderFrame = frame; satisfyWristRecoveryBaselines(left, right);
    finalizeBoxingColliderEvents();
  }

  /**
   * Gesture-mode guard evaluation on one fresh evidence frame: the Godot
   * guard-gesture port over normalized landmarks, windowed by each guard's
   * instantaneous-checkpoint timing window. One Count per guard.
   */
  function evaluateBoxingColliderGestureFrames() {
    if (latestEvidence === null || lastInput === null) return;
    const gesture = guardGestureFromEvidence(/** @type {DataRecord} */ (latestEvidence));
    if (gesture !== true) return;
    for (const event of events) {
      if (judgedIds.has(String(event.eventId))) continue;
      const action = expectedAction(event);
      if (action !== "guard" && action !== "crossed_guard") continue;
      const checkpoint = /** @type {DataRecord | undefined} */ (event.checkpoint);
      const windowMs = checkpoint !== undefined && typeof checkpoint.timingWindowMs === "number" ? Number(checkpoint.timingWindowMs) : Number(boxingColliderSettings.timingWindowMs);
      if (latestEvidenceTimelineMs < Number(event.centerTimestampMs) - windowMs || latestEvidenceTimelineMs > Number(event.centerTimestampMs) + windowMs) continue;
      recordJudgementAt(event, "hit", Object.freeze([]), /** @type {AeroGameplayEvidenceSnapshot} */ (latestEvidence), false, latestEvidenceTimelineMs);
    }
  }

  /** @param {DataRecord} event */
  function boxingColliderMissDiagnostics(event) {
    if (!latestEvidence || !lastInput) return Object.freeze(["no_input"]);
    if (latestEvidence.calibrationId !== calibrationId) return Object.freeze(["calibration_mismatch"]);
    const age = timestampMs - latestEvidence.measurementTimestampMs;
    if (age < 0 || age >= maximumColliderSampleFreshnessMs) return Object.freeze(["stale_input"]);
    const settings = boxingColliderSettingsForEvent(event);
    const action = expectedAction(event);
    if (settings.enforceAuthoredDirection === true && (action === "uppercut_left" || action === "uppercut_right" || action === "hook_left" || action === "hook_right")) return Object.freeze(["wrong_direction"]);
    return Object.freeze(["wrong_collider"]);
  }

  function finalizeBoxingColliderEvents() {
    if (!variant || variant.rulesetId !== BOXING_COLLIDER_RULESET) return;
    for (const event of events) {
      const eventId = String(event.eventId);
      if (judgedIds.has(eventId)) continue;
      const settings = boxingColliderSettingsForEvent(event);
      const action = expectedAction(event);
      const late = Number(event.centerTimestampMs) + Number(settings.timingWindowMs);
      if ((action === "guard" || action === "crossed_guard") && typeof event.checkpoint?.timingWindowMs === "number" && Number(event.checkpoint.timingWindowMs) > 0) {
        const guardWindowMs = Number(event.checkpoint.timingWindowMs);
        if (timelinePositionMs > Number(event.centerTimestampMs) + guardWindowMs) recordJudgementAt(event, "miss", boxingColliderMissDiagnostics(event), null, false, null);
        continue;
      }
      if (timelinePositionMs > late) recordJudgementAt(event, "miss", boxingColliderMissDiagnostics(event), null, false, null);
    }
  }

  function judgeLiveEvents() {
    for (const event of events) {
      const eventId = String(event.eventId);
      if (judgedIds.has(eventId)) continue;
      const center = Number(event.centerTimestampMs);
      const eventVariant = variantForEvent(event);
      if (eventVariant.mode === "flow" && event.type !== "note") {
        if (event.type === "obstacle") continue;
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
          shadowJudgements.push(makeJudgement(event, shadow, "hit", match.diagnostics, latestEvidence, latestEvidenceTimelineMs, timelinePositionMs, true));
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
  function recordJudgement(event, result, diagnostics, evidence, shadow) { recordJudgementAt(event, result, diagnostics, evidence, shadow, evidence ? latestEvidenceTimelineMs : null); }

  /** @param {DataRecord} event @param {"hit" | "miss" | "ignored"} result @param {readonly string[]} diagnostics @param {AeroGameplayEvidenceSnapshot | null} evidence @param {boolean} shadow @param {number | null} evidenceTimelineMs */
  function recordJudgementAt(event, result, diagnostics, evidence, shadow, evidenceTimelineMs) {
    const eventVariant = variantForEvent(event);
    const eventProfile = profileForEvent(event);
    const judgement = makeJudgement(event, eventVariant, result, diagnostics, evidence, evidenceTimelineMs, timelinePositionMs, shadow);
    if (shadow) shadowJudgements.push(judgement);
    else {
      judgements.push(judgement);
      judgedIds.add(String(event.eventId));
      if (eventVariant.rulesetId === BOXING_COLLIDER_RULESET) updateScore(result, eventVariant, eventProfile, scoringSettingsForEvent(event));
      else updateScore(result, eventVariant, eventProfile, scoringSettingsForEvent(event), flowColliderSettingsForEvent(event));
    }
  }

  /** @param {"hit" | "miss" | "ignored"} result @param {DataRecord} scoreVariant @param {DataRecord} scoreProfile @param {DataRecord} settings @param {DataRecord} [colliderSettings] */
  function updateScore(result, scoreVariant, scoreProfile, settings, colliderSettings) {
    const resolvedColliderSettings = scoreVariant.rulesetId === BOXING_COLLIDER_RULESET ? boxingColliderSettings : colliderSettings;
    const key = scorePartitionKey(scoreVariant, scoreProfile, settings, resolvedColliderSettings);
    const current = scorePartition(scoreVariant, scoreProfile, settings, resolvedColliderSettings);
    const next = { ...current };
    if (result === "hit") { next.hits += 1; next.combo += 1; next.score = finiteScore(next.score + Number(settings.hitPoints) + Math.max(0, next.combo - 1) * Number(settings.comboBonusPerHit)); next.maxCombo = Math.max(next.maxCombo, next.combo); }
    else if (result === "miss") { next.misses += 1; next.score = finiteScore(Math.max(0, next.score - Number(settings.missPenalty))); next.combo = 0; }
    else next.ignored += 1;
    partitions.set(key, Object.freeze(next));
  }

  /** @param {DataRecord} scoreVariant @param {DataRecord} scoreProfile @param {DataRecord} settings @param {DataRecord} [colliderSettings] */
  function scorePartition(scoreVariant, scoreProfile, settings, colliderSettings = flowColliderSettings) {
    const resolvedColliderSettings = scoreVariant.rulesetId === BOXING_COLLIDER_RULESET ? boxingColliderSettings : colliderSettings;
    const key = scorePartitionKey(scoreVariant, scoreProfile, settings, resolvedColliderSettings);
    const colliderIdentity = scoreVariant.rulesetId === FLOW_COLLIDER_RULESET ? flowColliderSettingsIdentity(resolvedColliderSettings) : null;
    const boxingIdentity = scoreVariant.rulesetId === BOXING_COLLIDER_RULESET ? boxingColliderSettingsIdentity(resolvedColliderSettings) : null;
    return partitions.get(key) ?? Object.freeze({ partitionId: key, variantId: scoreVariant.variantId, chartId: scoreVariant.chartId, rulesetId: scoreVariant.rulesetId, recipeId: scoreVariant.recipeId, modifierIds: scoreVariant.modifierIds, mapHash: scoreVariant.mapHash, scoreIdentityHash: scoreVariant.scoreIdentityHash, profileId: scoreProfile.profileId, profileVersion: scoreProfile.profileVersion, profileHash: scoreProfile.contentHash, profileClass: scoreProfile.class, regenerationRequired: scoreProfile.regenerationRequired, scoringSettings: settings, scoringSettingsIdentity: scoreSettingsIdentity(settings), ...(colliderIdentity === null ? {} : { flowColliderSettingsIdentity: colliderIdentity, bombContacts: 0 }), ...(boxingIdentity === null ? {} : { boxingColliderSettingsIdentity: boxingIdentity }), ranked: scoreVariant.rulesetId === FLOW_COLLIDER_RULESET || scoreVariant.rulesetId === BOXING_COLLIDER_RULESET ? false : scoreVariant.ranked === true, localOnly: true, hits: 0, misses: 0, ignored: 0, obstacleContacts: 0, score: 0, maxCombo: 0, combo: 0 });
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
      schema: "aerobeat/gameplay_coordinator_snapshot", version: 2, serviceId: "aero.gameplay.session", generation,
      session: Object.freeze({ schema: "aerobeat/gameplay_session_snapshot", version: 2, sessionId, state, purpose: sessionPurpose, timestampMs, timelinePositionMs, packageId, chartId: variant?.chartId ?? null, calibrationId: sessionPurpose === "visual_test" ? null : calibrationId, rulesetId: variant?.rulesetId ?? null, recipeId: variant?.recipeId ?? null, ranked: sessionPurpose === "play" && variant?.ranked === true, pauseReason }),
      countdown, safety: Object.freeze({ ready: safetyReady, freshCalibrationRequired }), lease: leaseSnapshot,
      selectedVariant: variant ? publicVariant(variant) : null, profileIdentity, scoringSettings,
      activeEventIds: Object.freeze([...activeIds].sort(compareCodePoints)), judgedEventIds: Object.freeze([...judgedIds].sort(compareCodePoints)),
      judgements: Object.freeze([...judgements]), shadowJudgements: Object.freeze([...shadowJudgements]), obstacleOutcomes: Object.freeze([...obstacleOutcomes]), hazardOutcomes: Object.freeze([...hazardOutcomes]),
      hazardContact: Object.freeze({ active: occupiedObstacleIds.size > 0, sinceMs: hazardContactSinceMs, releasedAtMs: hazardContactReleasedAtMs }),
      scorePartitions: Object.freeze([...partitions.values()].map((entry) => Object.freeze({ ...entry }))), error
    });
  }

  function clearRunTruth() {
    judgedIds.clear(); activeIds.clear(); judgements.length = 0; shadowJudgements.length = 0; shadowConsumed.clear(); consumedActions.clear(); consumedGuardPunchWindows.clear(); partitions.clear(); obstacleStates.clear(); obstacleOutcomes.length = 0; occupiedObstacleIds.clear(); hazardContactSinceMs = null; hazardContactReleasedAtMs = null; previousNoseSample = null; lastObstacleSourceIdentity = null; obstacleEpisodeOrdinal = 0; bombStates.clear(); hazardOutcomes.length = 0; clearColliderSamples(); leftWristBaselineRequired = false; rightWristBaselineRequired = false; noseBaselineRequired = false; pendingHazardBreak = false; pendingBombContacts = 0; pendingObstacleContacts = 0; timelinePositionMs = 0; countdownTimelinePositionMs = 0; latestEvidence = null; lastEvidenceFrameId = null; lastInput = null; countdown = inactiveCountdown(timestampMs);
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
  /** @param {DataRecord} event @returns {DataRecord} */
  function flowColliderSettingsForEvent(event) { return /** @type {DataRecord} */ (truthForEvent(event).flowColliderSettings ?? defaultFlowColliderSettings); }
  function boxingColliderSettingsForEvent(event) { return /** @type {DataRecord} */ (truthForEvent(event).boxingColliderSettings ?? defaultBoxingColliderSettings); }
  /** @param {unknown} value @returns {AeroGameplaySessionPurpose} */
  function normalizeContentConfigurationPurpose(value) {
    if (value === undefined) return "play";
    const source = requireDataRecordFields(value, "content_configuration_options_invalid", ["purpose"]);
    if (source.purpose !== "play" && source.purpose !== "visual_test") throw gameplayError("content_configuration_purpose_invalid", "Content configuration purpose is invalid");
    return source.purpose;
  }
  /** @param {unknown} value @returns {AeroGameplaySessionPurpose} */
  function normalizeStartPurpose(value) {
    if (value === undefined) return "play";
    if (!isGameplaySessionStartRequest(value)) throw gameplayError("session_start_request_invalid", "Session start request must satisfy the exact public contract");
    return value.purpose;
  }
  function assertOpen() { if (destroyed) throw gameplayError("service_destroyed", "Gameplay coordinator is destroyed"); }
  function assertConfigured() { assertOpen(); if (!variant || packageId === null) throw gameplayError("content_not_configured", "Gameplay content is not configured"); }
  /** @param {number} value */
  function advanceTimestamp(value) { const next = requireNonNegativeNumber(value, "timestamp_invalid"); if (next < timestampMs) throw gameplayError("timestamp_rollback", "Gameplay timestamps must not roll back"); timestampMs = next; }
}

/** @param {readonly DataRecord[]} sourceEvents @param {string} contentPackageId @param {number} generation @param {DataRecord} sourceVariant @param {DataRecord} sourceProfile @param {DataRecord} sourceScoringSettings @param {DataRecord} sourceFlowColliderSettings @param {DataRecord} [sourceBoxingColliderSettings] */
function bindEventTruth(sourceEvents, contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings, sourceFlowColliderSettings, sourceBoxingColliderSettings) {
  const result = new WeakMap();
  const truth = makeEventTruth(contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings, sourceFlowColliderSettings, sourceBoxingColliderSettings);
  for (const event of sourceEvents) result.set(event, truth);
  return result;
}
/** @param {string} contentPackageId @param {number} generation @param {DataRecord} sourceVariant @param {DataRecord} sourceProfile @param {DataRecord} sourceScoringSettings @param {DataRecord} sourceFlowColliderSettings @param {DataRecord} [sourceBoxingColliderSettings] */
function makeEventTruth(contentPackageId, generation, sourceVariant, sourceProfile, sourceScoringSettings, sourceFlowColliderSettings, sourceBoxingColliderSettings) { return Object.freeze({ contentPackageId, contentGeneration: generation, variant: sourceVariant, profileIdentity: sourceProfile, scoringSettings: sourceScoringSettings, flowColliderSettings: sourceFlowColliderSettings, boxingColliderSettings: sourceBoxingColliderSettings }); }

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

/** @param {unknown} value @returns {{positionMs: number, playing: boolean, ended: boolean}} */
function normalizeClock(value) {
  const record = requireDataRecordFields(value, "audio_clock_invalid", ["contextTimeSeconds", "positionSeconds", "durationSeconds", "progress", "playing"]);
  const positionSeconds = requireNonNegativeNumber(record.positionSeconds, "audio_clock_invalid");
  if (record.contextTimeSeconds !== undefined) requireNonNegativeNumber(record.contextTimeSeconds, "audio_clock_invalid");
  const durationSeconds = record.durationSeconds === undefined ? null : requireNonNegativeNumber(record.durationSeconds, "audio_clock_invalid");
  if (record.progress !== undefined && (typeof record.progress !== "number" || !Number.isFinite(record.progress) || record.progress < 0 || record.progress > 1)) throw gameplayError("audio_clock_invalid", "Audio clock progress must be normalized");
  if (typeof record.playing !== "boolean") throw gameplayError("audio_clock_invalid", "Audio clock playing must be boolean");
  const positionMs = positionSeconds * 1000;
  if (!Number.isSafeInteger(positionMs) && (!Number.isFinite(positionMs) || positionMs > Number.MAX_SAFE_INTEGER)) throw gameplayError("audio_clock_invalid", "Audio clock position exceeds safe gameplay range");
  const ended = record.playing === false && ((durationSeconds !== null && durationSeconds > 0 && positionSeconds >= durationSeconds) || record.progress === 1);
  return Object.freeze({ positionMs, playing: record.playing, ended });
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
  if (!rulesetIds.includes(/** @type {never} */ (rulesetId)) && rulesetId !== FLOW_COLLIDER_RULESET) throw gameplayError("ruleset_invalid", "Variant ruleset is unsupported");
  const mode = record.mode === "flow" ? "flow" : record.mode === "boxing" ? "boxing" : (() => { throw gameplayError("mode_invalid", "Variant mode is unsupported"); })();
  const recipeId = record.recipeId === null ? null : requireString(record.recipeId, "recipe_invalid");
  if (mode === "flow" && (![FLOW_COLLIDER_RULESET, FLOW_GRID_RULESET].includes(rulesetId) || recipeId !== null)) throw gameplayError("variant_identity_invalid", "Flow variants require a supported Flow ruleset and no conversion recipe");
  if (mode === "boxing" && rulesetId !== BOXING_COLLIDER_RULESET && ((rulesetId.startsWith("flow_grid_") || rulesetId === FLOW_COLLIDER_RULESET) || recipeId === null || !conversionRecipeIds.includes(/** @type {never} */ (recipeId)))) throw gameplayError("variant_identity_invalid", "Boxing variants require a supported Boxing ruleset and conversion recipe");
  const modifierIds = requireStringArray(record.modifierIds ?? [], "modifier_ids_invalid", 32);
  if (modifierIds.includes("no_obstacles") && modifierIds.includes("obstacle_visual_only")) throw gameplayError("modifier_ids_invalid", "Obstacle accessibility modes conflict");
  if (new Set(modifierIds).size !== modifierIds.length || [...modifierIds].sort(compareCodePoints).some((entry, index) => entry !== modifierIds[index]) || modifierIds.some((entry) => !SUPPORTED_MODIFIERS.includes(entry))) throw gameplayError("modifier_ids_invalid", "Modifier identity must be supported, sorted and unique");
  if (typeof record.ranked !== "boolean") throw gameplayError("variant_rank_invalid", "Variant ranked identity must be boolean");
  const obstacleAssist = modifierIds.includes("no_obstacles") || modifierIds.includes("obstacle_visual_only");
  if (obstacleAssist && (record.ranked !== false || record.localOnly !== true)) throw gameplayError("variant_rank_invalid", "Obstacle accessibility variants must be unranked and local-only");
  const provenance = record.provenance === undefined ? null : cloneGameplayData(record.provenance);
  if (isPlainRecord(provenance) && provenance.kind === "composite" && record.ranked) throw gameplayError("variant_rank_invalid", "Runtime composite variants must be unranked");
  const mapHash = cloneGameplayData(record.mapHash, "map_hash_invalid");
  const scoreIdentityHash = cloneGameplayData(record.scoreIdentityHash, "score_identity_hash_invalid");
  if (!isContentHash(mapHash) || !isContentHash(scoreIdentityHash)) throw gameplayError("variant_hash_invalid", "Variant map and score identity hashes must satisfy the public content contract");
  return Object.freeze({ variantId: requireString(record.variantId, "variant_id_invalid"), chartId: requireString(record.chartId, "chart_id_invalid"), mode, rulesetId, recipeId, modifierIds, ranked: record.ranked === true, localOnly: record.localOnly === true, mapHash, scoreIdentityHash, provenance });
}

/** @param {unknown} value @param {DataRecord} selectedVariant @returns {readonly DataRecord[]} */
function normalizeEvents(value, selectedVariant) {
  if (!Array.isArray(value) || value.length > 100000) throw gameplayError("content_events_invalid", "Resolved events must be a bounded array");
  const ids = new Set();
  const lineageOwners = new Set();
  const result = value.map((entry) => {
    const envelope = requireRecord(entry, "content_event_invalid");
    if (envelope.schema !== "aerobeat/resolved_content_event" || envelope.version !== 3) throw gameplayError("content_event_invalid", "Resolved content events must use version 3");
    const authoredBeat = envelope.authoredBeat === undefined ? null : requireRecord(envelope.authoredBeat, "authored_beat_invalid");
    if (authoredBeat !== null && ["centerTimestampMs", "intervalStartTimestampMs", "intervalEndTimestampMs", "endTimestampMs"].some((key) => Object.hasOwn(authoredBeat, key))) throw gameplayError("authored_beat_invalid", "Authored beats cannot own resolved timestamps");
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
  if (result.filter((event) => event.type === "obstacle" || event.type === "squat" || event.type === "weave_left" || event.type === "weave_right").length > maximumObstaclesPerChart) throw gameplayError("event_obstacle_limit_exceeded", "Obstacle count exceeds the gameplay limit");
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
      if (event.direction !== undefined && flowDirectionName(event.direction) === null) throw gameplayError("event_direction_invalid", "Flow note direction is unsupported");
    } else validateFlowNonNote(event, type);
  } else {
    const action = expectedAction(event);
    if (![...PUNCH_ACTIONS, ...CHECKPOINT_ACTIONS].includes(action)) throw gameplayError("event_type_invalid", "Boxing event type is unsupported");
    if (action === "squat" || action === "weave_left" || action === "weave_right") validateBoxingObstacle(event);
    if (selectedVariant.rulesetId === BOXING_COLLIDER_RULESET) {
      if (PUNCH_ACTIONS.includes(action)) { const target = requireRecord(event.spatialTarget, "spatial_target_invalid"); requireGridCell(target.targetCell, "spatial_target_invalid"); }
    else if (action === "guard" || action === "crossed_guard") {
        const target = requireRecord(event.guardTarget, "guard_target_invalid");
        requireGridCell(target.leftCell, "guard_target_invalid");
        requireGridCell(target.rightCell, "guard_target_invalid");
        if (action === "crossed_guard" && target.crossed !== true) throw gameplayError("guard_target_invalid", "Crossed guards must set the crossed flag on their guard target");
      } else if (event.checkpoint !== undefined) {
        const checkpoint = requireRecord(event.checkpoint, "checkpoint_invalid");
        if (checkpoint.kind !== "instantaneous" || typeof checkpoint.timingWindowMs !== "number") throw gameplayError("checkpoint_invalid", "Boxing Collider checkpoints must be instantaneous with a timing window");
      }
    } else if (selectedVariant.rulesetId === "boxing_spatial_grid_v1") {
      if (PUNCH_ACTIONS.includes(action)) {
        const target = requireRecord(event.spatialTarget, "spatial_target_invalid");
        requireGridCell(target.targetCell, "spatial_target_invalid");
        if (!Array.isArray(target.acceptedSubcells) || target.acceptedSubcells.length > 48 || target.acceptedSubcells.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 47)) throw gameplayError("spatial_target_invalid", "Spatial accepted subcells are invalid");
        if (target.sourceCell !== undefined && (!Number.isInteger(target.sourceCell) || Number(target.sourceCell) < -1 || Number(target.sourceCell) > 11)) throw gameplayError("spatial_target_invalid", "Spatial source cell must be the explicit -1 sentinel or a 4x3 grid cell");
        if (target.entryDirection !== undefined && cardinalDirectionName(target.entryDirection) === null) throw gameplayError("spatial_target_invalid", "Spatial entry direction is invalid");
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

/** @param {DataRecord} event */
function validateBoxingObstacle(event) {
  validateFlowInterval(event, "event_boxing_obstacle_invalid");
  if (!isObstacleSourceGeometry(event.sourceGeometry) || !isObstacleGameplayGeometry(event.gameplayGeometry) || !isObstacleGridMask(event.gridMask, /** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (event.gameplayGeometry))) throw gameplayError("event_boxing_obstacle_invalid", "Boxing obstacle source evidence, normalized gameplay geometry, and derived mask must agree");
  if (!sameNumberArray(event.blockedCells, event.gridMask) || obstacleActionForCells(/** @type {readonly number[]} */ (event.gridMask)) !== event.type) throw gameplayError("event_boxing_obstacle_invalid", "Boxing action and blocked cells must exactly match the normalized derived mask");
  const checkpoint = requireRecord(event.checkpoint, "event_boxing_obstacle_invalid");
  const blocked = /** @type {readonly number[]} */ (event.gridMask);
  const expectedSafeCells = Array.from({ length: 12 }, (_, cell) => cell).filter((cell) => !blocked.includes(cell));
  if (checkpoint.kind !== "instantaneous" || !sameNumberArray(checkpoint.noseSafeCells, expectedSafeCells)) throw gameplayError("event_boxing_obstacle_invalid", "Boxing checkpoint must retain the exact instantaneous normalized safe-cell complement");
}

/** @param {readonly number[]} cells */
function obstacleActionForCells(cells) { let left=0,right=0; for(const cell of cells) cell%4<=1?left+=1:right+=1; return left>right?"weave_right":right>left?"weave_left":"squat"; }
/** @param {unknown} left @param {unknown} right */
function sameNumberArray(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Number.isInteger(value) && value === right[index]); }

/** @param {DataRecord} event @param {string} type */
function validateFlowNonNote(event, type) {
  if (type === "bomb") { requireGridCell(event.placement, "event_placement_invalid"); return; }
  if (type === "obstacle") {
    validateFlowInterval(event, "event_obstacle_invalid");
    if (!isObstacleSourceGeometry(event.sourceGeometry) || !isObstacleGameplayGeometry(event.gameplayGeometry) || !isObstacleGridMask(event.gridMask, /** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (event.gameplayGeometry))) throw gameplayError("event_obstacle_invalid", "Obstacle source evidence, normalized gameplay geometry, and derived mask must agree");
    return;
  }
  if (type === "arc") {
    validateFlowInterval(event, "event_arc_invalid");
    requireGridCell(event.startPlacement, "event_arc_invalid");
    requireGridCell(event.endPlacement, "event_arc_invalid");
    if (event.startDirection !== undefined) requireFlowSourceDirection(event.startDirection, "event_arc_invalid");
    if (event.endDirection !== undefined) requireFlowSourceDirection(event.endDirection, "event_arc_invalid");
    return;
  }
  validateFlowInterval(event, "event_burst_invalid");
  requireGridCell(event.placement, "event_burst_invalid");
  requireGridCell(event.tailPlacement, "event_burst_invalid");
  if (event.direction !== undefined) requireFlowSourceDirection(event.direction, "event_burst_invalid");
  if (!Number.isInteger(event.checkpointCount) || Number(event.checkpointCount) < 1 || Number(event.checkpointCount) > 4096) throw gameplayError("event_burst_invalid", "Flow burst checkpoint count must be a positive bounded integer");
}

/**
 * Canonical content-runtime interval envelopes own `endTimestampMs`. Legacy direct
 * flattened events without `authoredBeat` remain compatible as instantaneous ignored
 * checkpoints when that field is absent; if direct callers provide it, it is validated.
 * @param {DataRecord} event @param {string} code
 */
function validateFlowInterval(event, code) {
  const canonicalEnvelope = event.authoredBeat !== null;
  if (event.intervalStartTimestampMs === undefined || event.intervalEndTimestampMs === undefined) {
    if (canonicalEnvelope) throw gameplayError(code, "Canonical Flow interval events require start/end timestamps");
    return;
  }
  const startTimestampMs = requireNonNegativeNumber(event.intervalStartTimestampMs, code);
  const endTimestampMs = requireNonNegativeNumber(event.intervalEndTimestampMs, code);
  if (endTimestampMs > 86_400_000) throw gameplayError(code, "Flow interval end timestamp cannot exceed 24 hours");
  if (startTimestampMs !== Number(event.centerTimestampMs) || endTimestampMs <= startTimestampMs) throw gameplayError(code, "Flow interval timestamps must have positive duration and start at center");
  if (!canonicalEnvelope) return;
  const authoredBeat = requireRecord(event.authoredBeat, code);
  const startBeat = requireNonNegativeNumber(authoredBeat.start, code);
  const endBeat = requireNonNegativeNumber(authoredBeat.end, code);
  if (endBeat <= startBeat) throw gameplayError(code, "Flow authored interval requires positive duration");
}

/** @param {unknown} value @param {string} code */
function requireFlowSourceDirection(value, code) {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 8) return;
  if (typeof value === "string" && bodyGridDirections.includes(/** @type {import("@aerobeat/web-contracts").AeroBodyGridDirection} */ (value))) return;
  throw gameplayError(code, "Flow source direction is unsupported");
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

/** @param {unknown} value @param {DataRecord} selectedVariant @returns {DataRecord} */
function normalizeFlowColliderSettings(value, selectedVariant) {
  if (selectedVariant.rulesetId !== FLOW_COLLIDER_RULESET) {
    if (value !== undefined) throw gameplayError("flow_collider_settings_invalid", "Flow Collider settings require the Flow Colliders ruleset");
    return defaultFlowColliderSettings;
  }
  try { return createFlowColliderSettings(value); }
  catch (error) { throw gameplayError("flow_collider_settings_invalid", error instanceof Error ? error.message : "Flow Collider settings are invalid"); }
}

/** @param {unknown} value @param {DataRecord} selectedVariant @returns {DataRecord} */
function normalizeBoxingColliderSettings(value, selectedVariant) {
  if (selectedVariant.rulesetId !== BOXING_COLLIDER_RULESET) {
    if (value !== undefined) throw gameplayError("boxing_collider_settings_invalid", "Boxing Collider settings require the Boxing Colliders ruleset");
    return defaultBoxingColliderSettings;
  }
  try { return createBoxingColliderSettings(value); }
  catch (error) { throw gameplayError("boxing_collider_settings_invalid", error instanceof Error ? error.message : "Boxing Collider settings are invalid"); }
}

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
  const rulesetId = String(selectedVariant?.rulesetId ?? FLOW_COLLIDER_RULESET);
  if (rulesetId.startsWith("flow_grid_")) return matchFlow(event, evidence);
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
  const entry = evidence.entries.find((candidate) => candidate.anchor === anchorName && candidate.toCell === placement);
  if (event.direction === undefined) {
    if (!entry) diagnostics.push("no_input");
  } else {
    const direction = flowDirectionName(event.direction);
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
      const direction = cardinalDirectionName(target.entryDirection);
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

/** @param {DataRecord} event @param {DataRecord | null} selectedVariant @param {"hit" | "miss" | "ignored"} result @param {readonly string[]} diagnostics @param {AeroGameplayEvidenceSnapshot | null} evidence @param {number | null} evidenceTimelineMs @param {number} committedTimelinePositionMs @param {boolean} shadow @returns {AeroGameplayJudgement} */
function makeJudgement(event, selectedVariant, result, diagnostics, evidence, evidenceTimelineMs, committedTimelinePositionMs, shadow) {
  const rulesetId = /** @type {import("@aerobeat/web-contracts").AeroRulesetId} */ (selectedVariant?.rulesetId ?? FLOW_COLLIDER_RULESET);
  const recipeId = /** @type {import("@aerobeat/web-contracts").AeroConversionRecipeId | null} */ (selectedVariant?.recipeId ?? null);
  const center = Number(event.centerTimestampMs);
  return Object.freeze({ schema: "aerobeat/gameplay_judgement", version: 2, sessionPurpose: "play", eventId: String(event.eventId), rulesetId, recipeId, result, beatCenterTimestampMs: center, committedTimelinePositionMs, evidenceTimestampMs: evidence ? evidence.measurementTimestampMs : null, timingOffsetMs: evidenceTimelineMs === null ? null : evidenceTimelineMs - center, diagnostics: Object.freeze(/** @type {import("@aerobeat/web-contracts").AeroJudgementDiagnosticCode[]} */ ([...diagnostics])), shadow });
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
/** @param {DataRecord} variant @param {DataRecord} profile @param {DataRecord} settings @param {DataRecord} [colliderSettings] */
function scorePartitionKey(variant, profile, settings, colliderSettings = defaultFlowColliderSettings) { const mapHash = isPlainRecord(variant.mapHash) && typeof variant.mapHash.value === "string" ? variant.mapHash.value : "unhashed"; const scoreHash = isPlainRecord(variant.scoreIdentityHash) && typeof variant.scoreIdentityHash.value === "string" ? variant.scoreIdentityHash.value : "unhashed"; return [variant.variantId, variant.chartId, variant.mode, variant.rulesetId, variant.recipeId ?? "none", [...variant.modifierIds].join(","), variant.ranked ? "ranked" : "unranked", mapHash, scoreHash, profile.profileId, profile.profileVersion, profile.contentHash, profile.class, profile.regenerationRequired ? "regenerate" : "live", scoreSettingsIdentity(settings), ...(variant.rulesetId === FLOW_COLLIDER_RULESET ? [flowColliderSettingsIdentity(colliderSettings)] : variant.rulesetId === BOXING_COLLIDER_RULESET ? [boxingColliderSettingsIdentity(colliderSettings)] : [])].join("|"); }
/** @param {DataRecord} variant */
function publicVariant(variant) { return Object.freeze({ variantId: variant.variantId, chartId: variant.chartId, mode: variant.mode, rulesetId: variant.rulesetId, recipeId: variant.recipeId, modifierIds: variant.modifierIds, ranked: variant.ranked, localOnly: variant.localOnly, mapHash: variant.mapHash, scoreIdentityHash: variant.scoreIdentityHash, provenance: variant.provenance }); }
/** @param {"three" | "two" | "one" | "complete" | "cancelled"} state @param {AeroCountdownReason | null} reason @param {number | null} value @param {number} timestampMs @param {string | null} calibrationId */
function countdownSnapshot(state, reason, value, timestampMs, calibrationId) { return Object.freeze({ schema: "aerobeat/countdown_snapshot", version: 1, state, reason, value, timestampMs, gameplayTimeFrozen: state !== "complete", calibrationId }); }
/** @param {number} timestampMs */
function inactiveCountdown(timestampMs) { return Object.freeze({ schema: "aerobeat/countdown_snapshot", version: 1, state: "inactive", reason: null, value: null, timestampMs, gameplayTimeFrozen: true, calibrationId: null }); }
/** @param {unknown} value */
function boundedReason(value) { return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : "manual"; }
/** @type {readonly import("@aerobeat/web-contracts").AeroBodyGridDirection[]} */
const BEAT_SABER_FLOW_DIRECTIONS = Object.freeze(["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"]);
/** @type {readonly ("up" | "down" | "left" | "right")[]} */
const CARDINAL_DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);
/** @param {unknown} value @returns {import("@aerobeat/web-contracts").AeroBodyGridDirection | null} */
function flowDirectionName(value) {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) < BEAT_SABER_FLOW_DIRECTIONS.length) return BEAT_SABER_FLOW_DIRECTIONS[Number(value)] ?? null;
  return typeof value === "string" && bodyGridDirections.includes(/** @type {import("@aerobeat/web-contracts").AeroBodyGridDirection} */ (value)) ? /** @type {import("@aerobeat/web-contracts").AeroBodyGridDirection} */ (value) : null;
}
/** @param {unknown} value @returns {"up" | "down" | "left" | "right" | null} */
function cardinalDirectionName(value) {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) < CARDINAL_DIRECTIONS.length) return CARDINAL_DIRECTIONS[Number(value)] ?? null;
  return typeof value === "string" && CARDINAL_DIRECTIONS.includes(/** @type {"up" | "down" | "left" | "right"} */ (value)) ? /** @type {"up" | "down" | "left" | "right"} */ (value) : null;
}
/** @param {unknown} value @param {string} code */
function requireGridCell(value, code) { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 11) throw gameplayError(code, "Expected a 4x3 grid cell"); return Number(value); }
function randomToken() { const bytes = new Uint32Array(2); if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes); else { bytes[0] = Math.floor(Math.random() * 0xffffffff); bytes[1] = Math.floor(Math.random() * 0xffffffff); } return `${bytes[0].toString(16)}${bytes[1].toString(16)}`; }

// @ts-check

import { serviceIds } from "@aerobeat/web-contracts";

export { createAeroGameplaySessionCoordinator } from "./session-coordinator.js";
export { createFlowColliderSettings, defaultFlowColliderSettings, flowColliderSettingsBounds, flowColliderSettingsIdentity, maximumColliderSampleFreshnessMs, maximumColliderSampleGapMs } from "./flow-collider-collision.js";
export { boxingAuthoredDirection, boxingColliderReachRowForPlacement, boxingColliderReachBounds, boxingColliderSettingsIdentity, boxingColliderTargetCenter, boxerRowForPlacement, boxingGuardCountModes, BOXING_COLLIDER_SETUP_KEYS, clipWristSegmentToBoxingTarget, createBoxingColliderSettings, defaultBoxingColliderSettings, defaultGuardGestureConfig, GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE, GUARD_DEFAULT_MAX_WRIST_SEPARATION_X, GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y, guardGestureFromEvidence, guardGestureSatisfied, isBoxingColliderSetup, measuredGuardAnchor, matchesBoxingAuthoredDirection, normalizeReachAndGuardMode, pointContactsBoxingTarget } from "./boxing-collider-collision.js";
export { canonicalPrototypeProfileJson, createAeroPrototypeProfileRegistry, sha256PrototypeProfileHex } from "./prototype-profile-registry.js";

/** @type {"aero.gameplay"} */
export const aeroGameplayPackageId = "aero.gameplay";

/** @type {"aero.gameplay.session"} */
export const aeroGameplaySessionServiceId = serviceIds.gameplaySession;

/** @type {readonly ["flow", "boxing"]} */
export const aeroGameplayModeIds = Object.freeze(["flow", "boxing"]);

export const aeroGameplaySessionCapabilities = Object.freeze({
  authoritativeAudioClock: true,
  calibratedInputOnly: true,
  trackingSafetyPause: true,
  frozenCountdown: true,
  explicitPausedClockSynchronization: true,
  flowGrid: true,
  flowColliders: true,
  semanticTrackBoxing: true,
  spatialGridBoxing: true,
  colliderBoxing: true,
  futureVariantSwap: true,
  diagnosticShadows: true,
  prototypeProfileRegistry: true,
  deterministicProfileBundles: true,
  visualTestSession: true,
  commitmentTimedJudgements: true,
  localPrototypeScoresOnly: true,
  publicLeaderboards: false
});

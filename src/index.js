// @ts-check

import { serviceIds } from "@aerobeat/web-contracts";

export { createAeroGameplaySessionCoordinator } from "./session-coordinator.js";
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
  semanticTrackBoxing: true,
  spatialGridBoxing: true,
  futureVariantSwap: true,
  diagnosticShadows: true,
  prototypeProfileRegistry: true,
  deterministicProfileBundles: true,
  localPrototypeScoresOnly: true,
  publicLeaderboards: false
});

// @ts-check

/**
 * Stable package marker for the browser gameplay domain.
 *
 * @type {"aero.gameplay"}
 */
export const aeroGameplayPackageId = "aero.gameplay";

/**
 * Stable service identifier reserved for the per-game gameplay-session coordinator.
 *
 * @type {"aero.gameplay.session"}
 */
export const aeroGameplaySessionServiceId = "aero.gameplay.session";

/**
 * Gameplay modes owned by the future gameplay-session implementation.
 *
 * @type {readonly ["flow", "boxing"]}
 */
export const aeroGameplayModeIds = Object.freeze(["flow", "boxing"]);

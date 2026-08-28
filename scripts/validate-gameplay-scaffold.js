// @ts-check

import assert from "node:assert/strict";
import {
  aeroGameplayModeIds,
  aeroGameplayPackageId,
  aeroGameplaySessionServiceId
} from "../src/index.js";

assert.equal(aeroGameplayPackageId, "aero.gameplay");
assert.equal(aeroGameplaySessionServiceId, "aero.gameplay.session");
assert.deepEqual(aeroGameplayModeIds, ["flow", "boxing"]);
assert.equal(Object.isFrozen(aeroGameplayModeIds), true);
assert.throws(() => {
  // @ts-expect-error Runtime immutability is part of the public marker contract.
  aeroGameplayModeIds.push("other");
}, TypeError);

console.log("Gameplay package scaffold unit check passed.");

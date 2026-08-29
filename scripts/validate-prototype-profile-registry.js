// @ts-check

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import { canonicalPrototypeProfileJson, createAeroPrototypeProfileRegistry, sha256PrototypeProfileHex } from "../src/index.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/task11-prototype-profiles-v1.json", import.meta.url), "utf8"));
const registry = createAeroPrototypeProfileRegistry();
assert.deepEqual(registry.exportProfiles(), fixture);
assert.equal(Object.isFrozen(registry.getSnapshot()), true);
assert.equal(registry.list().length, 6);
assert.equal(registry.getActive("live_visual").profile.profileId, "aero.visual.default");
assert.equal(registry.getActive("between_run_ruleset").settings.hitPoints, 1);
assert.equal(registry.getSnapshot().regenerationRequired, false);
assert.equal(registry.getActive("converter_regeneration").identity.regenerationRequired, false);

let listenerCalls = 0;
const unsubscribe = registry.subscribe(() => { listenerCalls += 1; });
registry.subscribe(() => { throw new Error("isolated listener"); });
registry.select("aero.visual.compact");
assert.equal(registry.getActive("live_visual").profile.profileId, "aero.visual.compact");
assert.throws(() => registry.select("aero.scoring.prototype-wide", { sessionState: "playing" }), (error) => error?.code === "profile_change_requires_pause");
assert.equal(registry.getActive("between_run_ruleset").profile.profileId, "aero.scoring.locked");
registry.select("aero.scoring.prototype-wide", { sessionState: "paused_manual" });
assert.equal(registry.getActive("between_run_ruleset").settings.hitPoints, 1.25);
registry.select("aero.converter.prototype-reach");
assert.equal(registry.getSnapshot().regenerationRequired, true);
assert.equal(registry.getActive("converter_regeneration").identity.regenerationRequired, true);
assert.equal(registry.getSnapshot().pendingConverterHash, "e37f8b527ed5ce86738ce22007fc963f83bccd737893fb4728d3b83eaa044eea");
assert.throws(() => registry.select("aero.converter.prototype-reach", { regeneratedPackageProfileHash: "0".repeat(64) }), (error) => error?.code === "profile_provenance_hash_mismatch");
registry.select("aero.converter.prototype-reach", { regeneratedPackageProfileHash: "e37f8b527ed5ce86738ce22007fc963f83bccd737893fb4728d3b83eaa044eea" });
assert.equal(registry.getSnapshot().regenerationRequired, false);
assert.equal(registry.getActive("converter_regeneration").identity.regenerationRequired, false);
assert.equal(registry.getSnapshot().pendingConverterHash, null);

const exported = registry.exportProfiles();
registry.importProfiles(exported);
assert.deepEqual(registry.exportProfiles(), fixture);
const versioned = structuredClone(fixture);
versioned.bundleVersion = "2.0.0";
delete versioned.bundleHash;
versioned.bundleHash = `sha256:${sha256PrototypeProfileHex(canonicalPrototypeProfileJson(versioned))}`;
registry.importProfiles(versioned);
assert.equal(registry.getSnapshot().bundleVersion, "2.0.0");
assert.deepEqual(registry.exportProfiles(), versioned, "imports atomically adopt the validated bundle version");
const hostile = structuredClone(fixture);
hostile.profiles[0].contentHash = "0".repeat(64);
const before = registry.getSnapshot();
assert.throws(() => registry.importProfiles(hostile), (error) => error?.code === "profile_hash_mismatch");
assert.equal(registry.getSnapshot(), before, "failed imports are atomic");
let getterCalled = false;
const accessor = structuredClone(fixture);
Object.defineProperty(accessor, "profiles", { enumerable: true, get() { getterCalled = true; return []; } });
assert.throws(() => registry.importProfiles(accessor));
assert.equal(getterCalled, false);
const byteSettings = structuredClone(fixture);
byteSettings.profiles[0].settings = new Uint8Array([1]);
assert.throws(() => registry.importProfiles(byteSettings));

registry.reset();
assert.deepEqual(registry.exportProfiles(), fixture);
assert.equal(registry.getSnapshot().regenerationRequired, false);
assert.ok(listenerCalls >= 5);
unsubscribe();
registry.destroy(); registry.destroy();
assert.equal(registry.getSnapshot().destroyed, true);
assert.throws(() => registry.list(), (error) => error?.code === "profile_registry_destroyed");

const vectors = Object.freeze([
  Object.freeze({ text: "", hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }),
  Object.freeze({ text: "abc", hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }),
  Object.freeze({ text: "AeroBeat 🥊 café", hash: createHash("sha256").update("AeroBeat 🥊 café", "utf8").digest("hex") })
]);
for (const vector of vectors) {
  const synchronous = sha256PrototypeProfileHex(vector.text);
  const nodeHash = createHash("sha256").update(vector.text, "utf8").digest("hex");
  const webHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(vector.text))).toString("hex");
  assert.equal(synchronous, vector.hash);
  assert.equal(synchronous, nodeHash);
  assert.equal(synchronous, webHash);
}
assert.equal(canonicalPrototypeProfileJson({ z: -0, a: [2, 1] }), '{"a":[2,1],"z":0}');
assert.equal(canonicalPrototypeProfileJson({ "𐀀": 2, "": 1 }), '{"":1,"𐀀":2}');

console.log("Prototype profile registry validation passed.");

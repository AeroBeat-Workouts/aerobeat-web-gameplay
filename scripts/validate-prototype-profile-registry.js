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
assert.deepEqual(registry.getActive("converter_regeneration").settings, { guardRelocationRadius: 1, reachAllowanceSubcells: 0, uppercutOppositeLane: false, anyOppositeLane: true, guardSpacing: 1 });
assert.deepEqual(registry.list().find((profile) => profile.profileId === "aero.converter.prototype-reach")?.settings, { guardRelocationRadius: 2, reachAllowanceSubcells: 1, uppercutOppositeLane: false, anyOppositeLane: true, guardSpacing: 1 });

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
assert.equal(registry.getSnapshot().pendingConverterHash, "152e8d9a5c208605dcd36521d4befbc8c7868cdaac66ed4d552025feb560c56c");
assert.throws(() => registry.select("aero.converter.prototype-reach", { regeneratedPackageProfileHash: "0".repeat(64) }), (error) => error?.code === "profile_provenance_hash_mismatch");
registry.select("aero.converter.prototype-reach", { regeneratedPackageProfileHash: registry.getSnapshot().pendingConverterHash ?? "" });
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
const beforeVersionMismatch = registry.getSnapshot();
assert.throws(() => registry.importProfiles(versioned), (error) => error?.code === "profile_bundle_version_incompatible");
assert.equal(registry.getSnapshot(), beforeVersionMismatch, "incompatible bundle versions reject atomically");
assert.deepEqual(registry.exportProfiles(), fixture);
function rehashBundle(candidate) {
  delete candidate.bundleHash;
  candidate.bundleHash = `sha256:${sha256PrototypeProfileHex(canonicalPrototypeProfileJson(candidate))}`;
  return candidate;
}
function rejectAtomically(candidate, predicate) {
  const before = registry.getSnapshot();
  assert.throws(() => registry.importProfiles(candidate), predicate);
  assert.equal(registry.getSnapshot(), before, "failed imports are atomic");
}
const hostile = structuredClone(fixture);
hostile.profiles[0].contentHash = "0".repeat(64);
rejectAtomically(hostile, (error) => error?.code === "profile_hash_mismatch");
// Preserve the original exported bundleHash exactly: permissive normalization used to
// reconstruct omitted metadata and make this stale hash validate against normalized data.
for (const missingField of ["schema", "version", "contentHash", "experimental", "label", "settings"]) {
  const missing = structuredClone(fixture);
  delete missing.profiles[0][missingField];
  rejectAtomically(missing, (error) => error?.code === "prototype_profile_fields_missing");
}
const extra = structuredClone(fixture);
extra.profiles[0].winner = true;
rejectAtomically(rehashBundle(extra));
for (const missingBundleField of ["schema", "version", "bundleVersion", "profiles", "bundleHash"]) {
  const missingBundle = structuredClone(fixture);
  delete missingBundle[missingBundleField];
  rejectAtomically(missingBundle);
}
const extraBundle = structuredClone(fixture);
extraBundle.winner = true;
rejectAtomically(extraBundle);
let getterCalled = false;
const accessor = structuredClone(fixture);
Object.defineProperty(accessor, "profiles", { enumerable: true, get() { getterCalled = true; return []; } });
rejectAtomically(accessor);
assert.equal(getterCalled, false);
const nestedAccessor = structuredClone(fixture);
Object.defineProperty(nestedAccessor.profiles[0], "label", { enumerable: true, get() { getterCalled = true; return "unsafe"; } });
rejectAtomically(nestedAccessor);
assert.equal(getterCalled, false);
const deep = structuredClone(fixture);
let nested = { value: 1 };
for (let index = 0; index < 14; index += 1) nested = { value: nested };
deep.profiles[0].settings.motionIntensity = nested;
rejectAtomically(deep);
const excessiveCount = structuredClone(fixture);
excessiveCount.profiles = Array.from({ length: 65 }, () => structuredClone(fixture.profiles[0]));
rejectAtomically(excessiveCount);
const excessiveString = structuredClone(fixture);
excessiveString.profiles[0].label = "x".repeat(9000);
rejectAtomically(excessiveString);
for (const boundedProfileString of ["profileId", "profileVersion", "label"]) {
  const overMaximum = structuredClone(fixture);
  overMaximum.profiles[0][boundedProfileString] = "x".repeat(257);
  rejectAtomically(rehashBundle(overMaximum), (error) => ["profile_id_invalid", "profile_version_invalid", "profile_label_invalid"].includes(error?.code));
}
const overBundleVersionMaximum = structuredClone(fixture);
overBundleVersionMaximum.bundleVersion = "x".repeat(257);
rejectAtomically(rehashBundle(overBundleVersionMaximum), (error) => error?.code === "profile_bundle_version_invalid");
const classSettings = structuredClone(fixture);
class ClassSettings { constructor() { this.motionIntensity = 1; this.roleScale = 1; } }
classSettings.profiles[4].settings = new ClassSettings();
rejectAtomically(classSettings);
const byteSettings = structuredClone(fixture);
byteSettings.profiles[0].settings = new Uint8Array([1]);
rejectAtomically(byteSettings);

// Optional converter fields are strictly typed, while older profiles can omit them.
function converterDefaults(settings) {
  return fixture.profiles.map((profile) => ({
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    class: profile.class,
    label: profile.label,
    ...(profile.class === "converter_regeneration" ? { settings: { guardRelocationRadius: profile.settings.guardRelocationRadius, reachAllowanceSubcells: profile.settings.reachAllowanceSubcells, ...settings } } : { settings: profile.settings })
  }));
}
const compatible = createAeroPrototypeProfileRegistry({ defaults: converterDefaults({}) });
assert.deepEqual(compatible.getActive("converter_regeneration").settings, { guardRelocationRadius: 1, reachAllowanceSubcells: 0 });
compatible.importProfiles(compatible.exportProfiles());
assert.deepEqual(compatible.getActive("converter_regeneration").settings, { guardRelocationRadius: 1, reachAllowanceSubcells: 0 });
compatible.destroy();
for (const settings of [
  { uppercutOppositeLane: true }, { uppercutOppositeLane: false },
  { anyOppositeLane: true }, { anyOppositeLane: false },
  { guardSpacing: 0 }, { guardSpacing: 2 },
  { uppercutOppositeLane: true, anyOppositeLane: false, guardSpacing: 2 }
]) {
  const candidate = createAeroPrototypeProfileRegistry({ defaults: converterDefaults(settings) });
  assert.deepEqual(candidate.getActive("converter_regeneration").settings, { guardRelocationRadius: 1, reachAllowanceSubcells: 0, ...settings });
  candidate.importProfiles(candidate.exportProfiles());
  candidate.destroy();
}
for (const settings of [
  { uppercutOppositeLane: 1 }, { uppercutOppositeLane: "false" }, { uppercutOppositeLane: null },
  { anyOppositeLane: 0 }, { anyOppositeLane: "true" }, { anyOppositeLane: null },
  { guardSpacing: -1 }, { guardSpacing: 3 }, { guardSpacing: 0.5 }, { guardSpacing: "1" },
  { uppercutOppositeLane: undefined }, { anyOppositeLane: undefined }, { guardSpacing: undefined },
  { unexpected: true }, { guardRelocationRadius: undefined }
]) {
  assert.throws(() => createAeroPrototypeProfileRegistry({ defaults: converterDefaults(settings) }),
    (error) => ["profile_setting_invalid", "profile_settings_invalid", "profile_defaults_invalid"].includes(error?.code));
}
for (const settings of [{ uppercutOppositeLane: 1 }, { anyOppositeLane: "true" }, { guardSpacing: 3 }, { unexpected: true }]) {
  const invalid = structuredClone(fixture);
  Object.assign(invalid.profiles[0].settings, settings);
  rejectAtomically(rehashBundle(invalid));
}
const missingRequired = structuredClone(fixture);
delete missingRequired.profiles[0].settings.guardRelocationRadius;
rejectAtomically(rehashBundle(missingRequired), (error) => error?.code === "profile_settings_invalid");

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
  Object.freeze({ text: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", hash: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1" }),
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

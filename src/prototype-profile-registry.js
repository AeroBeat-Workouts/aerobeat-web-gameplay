// @ts-check

import { cloneGameplayData, gameplayError, isPlainRecord, requireDataRecordFields, requireString } from "./data.js";

const PROFILE_SCHEMA = "aerobeat/prototype_profile";
const BUNDLE_SCHEMA = "aerobeat/prototype_profile_bundle";
const SNAPSHOT_SCHEMA = "aerobeat/prototype_profile_registry_snapshot";
const PROFILE_CLASSES = Object.freeze(["live_visual", "between_run_ruleset", "converter_regeneration"]);
const DEFAULT_IDS = Object.freeze({ live_visual: "aero.visual.default", between_run_ruleset: "aero.scoring.locked", converter_regeneration: "aero.converter.canonical" });
const SCORING_SAFE_STATES = Object.freeze(["idle", "calibrating", "paused_manual", "paused_tracking", "completed", "stopped"]);

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */

const DEFAULT_DEFINITIONS = Object.freeze([
  Object.freeze({ profileId: "aero.visual.default", profileVersion: "1.0.0", class: "live_visual", label: "Default Visual (Experimental)", settings: Object.freeze({ motionIntensity: 1, roleScale: 1 }) }),
  Object.freeze({ profileId: "aero.visual.compact", profileVersion: "1.0.0", class: "live_visual", label: "Compact Visual (Experimental)", settings: Object.freeze({ motionIntensity: 0.8, roleScale: 0.86 }) }),
  Object.freeze({ profileId: "aero.scoring.locked", profileVersion: "1.0.0", class: "between_run_ruleset", label: "Locked Scoring (Experimental)", settings: Object.freeze({ comboBonusPerHit: 0, hitPoints: 1, missPenalty: 0 }) }),
  Object.freeze({ profileId: "aero.scoring.prototype-wide", profileVersion: "1.0.0", class: "between_run_ruleset", label: "Prototype Wide Scoring (Experimental)", settings: Object.freeze({ comboBonusPerHit: 0.05, hitPoints: 1.25, missPenalty: 0 }) }),
  Object.freeze({ profileId: "aero.converter.canonical", profileVersion: "1.0.0", class: "converter_regeneration", label: "Canonical Converter (Experimental)", settings: Object.freeze({ guardRelocationRadius: 1, reachAllowanceSubcells: 0 }) }),
  Object.freeze({ profileId: "aero.converter.prototype-reach", profileVersion: "1.0.0", class: "converter_regeneration", label: "Prototype Reach Converter (Experimental)", settings: Object.freeze({ guardRelocationRadius: 2, reachAllowanceSubcells: 1 }) })
]);

/**
 * Per-game prototype profile authority. Profiles are experimental identities,
 * never a production winner selection.
 *
 * @param {{defaults?:readonly unknown[],bundleVersion?:string,onListenerError?:(error:unknown)=>void}} [options]
 */
export function createAeroPrototypeProfileRegistry(options = {}) {
  const safeOptions = requireDataRecordFields(options, "profile_registry_options_invalid", ["defaults", "bundleVersion", "onListenerError"]);
  const listenerError = safeOptions.onListenerError;
  if (listenerError !== undefined && typeof listenerError !== "function") throw gameplayError("profile_registry_options_invalid", "Listener error handler must be a function");
  const initialBundleVersion = safeOptions.bundleVersion === undefined ? "1.0.0" : requireString(safeOptions.bundleVersion, "profile_bundle_version_invalid");
  let bundleVersion = initialBundleVersion;
  const defaults = normalizeProfileList(safeOptions.defaults ?? DEFAULT_DEFINITIONS, "profile_defaults_invalid");
  assertRequiredDefaults(defaults);
  let profiles = mapProfiles(defaults);
  let activeIds = Object.freeze({ ...DEFAULT_IDS });
  let appliedConverterHash = String(profiles.get(DEFAULT_IDS.converter_regeneration)?.contentHash ?? "");
  let generation = 0;
  let destroyed = false;
  const listeners = new Set();
  let snapshot = makeSnapshot();

  return Object.freeze({ list, getActive, select, importProfiles, exportProfiles, reset, getSnapshot: () => snapshot, subscribe, destroy });

  function list() { assertOpen(); return Object.freeze([...profiles.values()].sort(profileOrder)); }

  /** @param {"live_visual"|"between_run_ruleset"|"converter_regeneration"} profileClass */
  function getActive(profileClass) {
    assertOpen();
    const normalizedClass = requireProfileClass(profileClass);
    return activeState(normalizedClass);
  }

  /**
   * @param {string} profileId
   * @param {{sessionState?:string,regeneratedPackageProfileHash?:string}} [context]
   */
  function select(profileId, context = {}) {
    assertOpen();
    const id = requireString(profileId, "profile_id_invalid");
    const profile = profiles.get(id);
    if (!profile) throw gameplayError("profile_not_found", "Prototype profile is not registered");
    const safeContext = requireDataRecordFields(context, "profile_selection_context_invalid", ["sessionState", "regeneratedPackageProfileHash"]);
    if (profile.class === "between_run_ruleset") {
      const sessionState = requireString(safeContext.sessionState, "profile_session_state_required");
      if (!SCORING_SAFE_STATES.includes(sessionState)) throw gameplayError("profile_change_requires_pause", "Scoring profiles change only while idle, paused, or between runs");
    }
    const regeneratedHash = safeContext.regeneratedPackageProfileHash;
    if (regeneratedHash !== undefined) {
      const normalizedHash = requireHash(regeneratedHash, "profile_provenance_hash_invalid");
      if (profile.class !== "converter_regeneration" || normalizedHash !== profile.contentHash) throw gameplayError("profile_provenance_hash_mismatch", "Regenerated package provenance must match the selected converter profile");
      appliedConverterHash = normalizedHash;
    }
    activeIds = Object.freeze({ ...activeIds, [profile.class]: id });
    generation += 1; publish();
    return activeState(/** @type {"live_visual"|"between_run_ruleset"|"converter_regeneration"} */ (profile.class));
  }

  /** @param {unknown} bundle @param {{sessionState?:string}} [context] */
  function importProfiles(bundle, context = {}) {
    assertOpen();
    const safeContext = requireDataRecordFields(context, "profile_import_context_invalid", ["sessionState"]);
    const normalized = normalizeBundle(bundle);
    const nextProfiles = mapProfiles(normalized.profiles);
    assertRequiredDefaults(nextProfiles.values());
    for (const activeId of Object.values(activeIds)) if (!nextProfiles.has(activeId)) throw gameplayError("profile_bundle_active_missing", "Imported bundle must contain every active profile");
    const currentScoring = profiles.get(activeIds.between_run_ruleset);
    const nextScoring = nextProfiles.get(activeIds.between_run_ruleset);
    if (currentScoring?.contentHash !== nextScoring?.contentHash) {
      const sessionState = requireString(safeContext.sessionState, "profile_session_state_required");
      if (!SCORING_SAFE_STATES.includes(sessionState)) throw gameplayError("profile_change_requires_pause", "An imported active scoring profile changes only while idle, paused, or between runs");
    }
    profiles = nextProfiles;
    bundleVersion = normalized.bundleVersion;
    generation += 1; publish();
    return snapshot;
  }

  function exportProfiles() {
    assertOpen();
    const exportedProfiles = Object.freeze([...profiles.values()].sort(profileOrder));
    const body = Object.freeze({ schema: BUNDLE_SCHEMA, version: 1, bundleVersion, profiles: exportedProfiles });
    return Object.freeze({ ...body, bundleHash: `sha256:${sha256Hex(canonicalJson(body))}` });
  }

  function reset() {
    assertOpen();
    profiles = mapProfiles(defaults);
    bundleVersion = initialBundleVersion;
    activeIds = Object.freeze({ ...DEFAULT_IDS });
    appliedConverterHash = String(profiles.get(DEFAULT_IDS.converter_regeneration)?.contentHash ?? "");
    generation += 1; publish();
    return snapshot;
  }

  /** @param {(value:DataRecord)=>void} listener */
  function subscribe(listener) {
    assertOpen();
    if (typeof listener !== "function") throw gameplayError("profile_listener_invalid", "Profile listener must be a function");
    listeners.add(listener); notify(listener);
    return () => listeners.delete(listener);
  }

  function destroy() { if (destroyed) return; destroyed = true; generation += 1; snapshot = makeSnapshot(); listeners.clear(); }
  function assertOpen() { if (destroyed) throw gameplayError("profile_registry_destroyed", "Prototype profile registry is destroyed"); }
  function publish() { snapshot = makeSnapshot(); for (const listener of listeners) notify(listener); }
  /** @param {(value:DataRecord)=>void} listener */
  function notify(listener) { try { listener(snapshot); } catch (error) { try { if (typeof listenerError === "function") listenerError(error); } catch { /* isolated */ } } }
  function makeSnapshot() {
    const converter = profiles.get(activeIds.converter_regeneration);
    const selectedConverterHash = String(converter?.contentHash ?? "");
    return Object.freeze({ schema: SNAPSHOT_SCHEMA, version: 1, generation, destroyed, bundleVersion, profiles: Object.freeze([...profiles.values()].sort(profileOrder)), active: Object.freeze({ visual: activeState("live_visual"), scoring: activeState("between_run_ruleset"), converter: activeState("converter_regeneration") }), appliedConverterHash, pendingConverterHash: selectedConverterHash === appliedConverterHash ? null : selectedConverterHash, regenerationRequired: selectedConverterHash !== appliedConverterHash, experimental: true });
  }
  /** @param {"live_visual"|"between_run_ruleset"|"converter_regeneration"} profileClass */
  function activeState(profileClass) {
    const profile = profiles.get(activeIds[profileClass]);
    if (!profile) throw gameplayError("profile_active_missing", "Active profile is not registered");
    const regenerationRequired = profileClass === "converter_regeneration" && profile.contentHash !== appliedConverterHash;
    return Object.freeze({ profile, identity: tuningIdentity(profile, regenerationRequired), settings: profile.settings, regenerationRequired, appliedContentHash: profileClass === "converter_regeneration" ? appliedConverterHash : profile.contentHash });
  }
}

/** @param {Iterable<DataRecord>} entries */
function mapProfiles(entries) { const result = new Map(); for (const profile of entries) { if (result.has(String(profile.profileId))) throw gameplayError("profile_id_duplicate", "Profile IDs must be unique"); result.set(String(profile.profileId), profile); } return result; }
/** @param {Iterable<DataRecord>} entries */
function assertRequiredDefaults(entries) { const profiles = [...entries]; const byClass = new Set(profiles.map((entry) => entry.class)); for (const profileClass of PROFILE_CLASSES) if (!byClass.has(profileClass)) throw gameplayError("profile_default_missing", `Profile class ${profileClass} requires at least one profile`); for (const id of Object.values(DEFAULT_IDS)) if (!profiles.some((entry) => entry.profileId === id)) throw gameplayError("profile_default_missing", `Required default profile ${id} is missing`); }

/** @param {unknown} value @param {string} code @returns {readonly DataRecord[]} */
function normalizeProfileList(value, code) {
  const cloned = cloneGameplayData(value, code, 4096);
  if (!Array.isArray(cloned) || cloned.length < 3 || cloned.length > 64) throw gameplayError(code, "Profile list must contain 3..64 profiles");
  const ids = new Set();
  const profiles = cloned.map((entry) => normalizeProfile(entry));
  for (const profile of profiles) { if (ids.has(profile.profileId)) throw gameplayError("profile_id_duplicate", "Profile IDs must be unique"); ids.add(profile.profileId); }
  return Object.freeze(profiles.sort(profileOrder));
}

/** @param {unknown} value @returns {DataRecord} */
function normalizeProfile(value) {
  const record = requireDataRecordFields(value, "prototype_profile_invalid", ["schema", "version", "profileId", "profileVersion", "class", "label", "experimental", "settings", "contentHash"]);
  if (record.schema !== undefined && record.schema !== PROFILE_SCHEMA || record.version !== undefined && record.version !== 1) throw gameplayError("prototype_profile_invalid", "Prototype profile schema/version is invalid");
  const profileId = requireString(record.profileId, "profile_id_invalid");
  const profileVersion = requireString(record.profileVersion, "profile_version_invalid");
  const profileClass = requireProfileClass(record.class);
  const label = requireString(record.label, "profile_label_invalid");
  if (record.experimental !== undefined && record.experimental !== true) throw gameplayError("profile_not_experimental", "Prototype profiles must remain experimental");
  const settings = normalizeSettings(profileClass, record.settings);
  const hashBody = Object.freeze({ schema: PROFILE_SCHEMA, version: 1, profileId, profileVersion, class: profileClass, settings });
  const contentHash = sha256Hex(canonicalJson(hashBody));
  if (record.contentHash !== undefined && requireHash(record.contentHash, "profile_hash_invalid") !== contentHash) throw gameplayError("profile_hash_mismatch", "Profile content hash does not match canonical settings");
  return Object.freeze({ ...hashBody, label, experimental: true, contentHash });
}

/** @param {unknown} value */
function normalizeBundle(value) {
  const record = requireDataRecordFields(value, "profile_bundle_invalid", ["schema", "version", "bundleVersion", "profiles", "bundleHash"]);
  if (record.schema !== BUNDLE_SCHEMA || record.version !== 1) throw gameplayError("profile_bundle_invalid", "Profile bundle schema/version is invalid");
  const bundleVersion = requireString(record.bundleVersion, "profile_bundle_version_invalid");
  const profiles = normalizeProfileList(record.profiles, "profile_bundle_profiles_invalid");
  const body = Object.freeze({ schema: BUNDLE_SCHEMA, version: 1, bundleVersion, profiles });
  const expected = `sha256:${sha256Hex(canonicalJson(body))}`;
  if (record.bundleHash !== expected) throw gameplayError("profile_bundle_hash_mismatch", "Profile bundle hash does not match canonical content");
  return Object.freeze({ ...body, bundleHash: expected });
}

/** @param {unknown} value @returns {"live_visual"|"between_run_ruleset"|"converter_regeneration"} */
function requireProfileClass(value) { if (!PROFILE_CLASSES.includes(/** @type {never} */ (value))) throw gameplayError("profile_class_invalid", "Prototype profile class is invalid"); return /** @type {"live_visual"|"between_run_ruleset"|"converter_regeneration"} */ (value); }
/** @param {string} profileClass @param {unknown} value */
function normalizeSettings(profileClass, value) {
  if (profileClass === "live_visual") { const record = exactSettings(value, ["motionIntensity", "roleScale"]); return Object.freeze({ motionIntensity: boundedNumber(record.motionIntensity, 0, 2), roleScale: boundedNumber(record.roleScale, 0.5, 1.5) }); }
  if (profileClass === "between_run_ruleset") { const record = exactSettings(value, ["comboBonusPerHit", "hitPoints", "missPenalty"]); return Object.freeze({ comboBonusPerHit: boundedNumber(record.comboBonusPerHit, 0, 10), hitPoints: boundedNumber(record.hitPoints, 0, 100), missPenalty: boundedNumber(record.missPenalty, 0, 100) }); }
  const record = exactSettings(value, ["guardRelocationRadius", "reachAllowanceSubcells"]); return Object.freeze({ guardRelocationRadius: boundedInteger(record.guardRelocationRadius, 0, 8), reachAllowanceSubcells: boundedInteger(record.reachAllowanceSubcells, 0, 8) });
}
/** @param {unknown} value @param {readonly string[]} keys */
function exactSettings(value, keys) { const record = requireDataRecordFields(value, "profile_settings_invalid", keys); if (Reflect.ownKeys(record).length !== keys.length) throw gameplayError("profile_settings_invalid", "Profile settings must contain every exact field"); return record; }
/** @param {unknown} value @param {number} minimum @param {number} maximum */
function boundedNumber(value, minimum, maximum) { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw gameplayError("profile_setting_invalid", "Profile numeric setting is outside its bounds"); return Object.is(value, -0) ? 0 : value; }
/** @param {unknown} value @param {number} minimum @param {number} maximum */
function boundedInteger(value, minimum, maximum) { const result = boundedNumber(value, minimum, maximum); if (!Number.isInteger(result)) throw gameplayError("profile_setting_invalid", "Profile integer setting is invalid"); return result; }
/** @param {unknown} value @param {string} code */
function requireHash(value, code) { if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw gameplayError(code, "Expected a lowercase SHA-256 hex value"); return value; }
/** @param {DataRecord} profile @param {boolean} regenerationRequired */
function tuningIdentity(profile, regenerationRequired) { return Object.freeze({ schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: profile.profileId, profileVersion: profile.profileVersion, contentHash: profile.contentHash, class: profile.class, regenerationRequired }); }
/** @param {DataRecord} left @param {DataRecord} right */
function profileOrder(left, right) { return compareUnicodeCodePoints(String(left.profileId), String(right.profileId)); }

/** Canonical JSON for bounded profile records. @param {unknown} value */
export function canonicalPrototypeProfileJson(value) {
  const cloned = cloneGameplayData(value, "profile_canonical_json_invalid", 4096);
  return stringify(cloned);
  /** @param {unknown} entry @returns {string} */
  function stringify(entry) {
    if (entry === null || typeof entry === "boolean" || typeof entry === "number" || typeof entry === "string") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(stringify).join(",")}]`;
    if (!isPlainRecord(entry)) throw gameplayError("profile_canonical_json_invalid", "Canonical profile data must be plain");
    return `{${Object.keys(entry).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${stringify(entry[key])}`).join(",")}}`;
  }
}

/** Pure deterministic SHA-256 over UTF-8 text. @param {string} text */
export function sha256PrototypeProfileHex(text) { return sha256Hex(text); }
/** @param {string} text */
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text); const words = []; const bitLength = bytes.length * 8;
  for (const byte of bytes) words.push(byte); words.push(0x80); while ((words.length % 64) !== 56) words.push(0);
  const high = Math.floor(bitLength / 0x100000000); const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) words.push((high >>> shift) & 255); for (let shift = 24; shift >= 0; shift -= 8) words.push((low >>> shift) & 255);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < words.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = ((words[offset+i*4]<<24)|(words[offset+i*4+1]<<16)|(words[offset+i*4+2]<<8)|words[offset+i*4+3]) >>> 0;
    for (let i = 16; i < 64; i += 1) { const x=w[i-15],y=w[i-2]; const s0=(ror(x,7)^ror(x,18)^(x>>>3))>>>0,s1=(ror(y,17)^ror(y,19)^(y>>>10))>>>0; w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0; }
    let [a,b,c,d,e,f,g,hh]=h;
    for (let i=0;i<64;i+=1) { const s1=(ror(e,6)^ror(e,11)^ror(e,25))>>>0; const ch=((e&f)^((~e)&g))>>>0; const t1=(hh+s1+ch+k[i]+w[i])>>>0; const s0=(ror(a,2)^ror(a,13)^ror(a,22))>>>0; const maj=((a&b)^(a&c)^(b&c))>>>0; const t2=(s0+maj)>>>0; hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
    h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
  }
  return h.map((value)=>value.toString(16).padStart(8,"0")).join("");
}
/** @param {string} left @param {string} right */
function compareUnicodeCodePoints(left, right) { const leftPoints = Array.from(left, (entry) => entry.codePointAt(0) ?? 0); const rightPoints = Array.from(right, (entry) => entry.codePointAt(0) ?? 0); const length = Math.min(leftPoints.length, rightPoints.length); for (let index = 0; index < length; index += 1) { if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]; } return leftPoints.length - rightPoints.length; }
/** @param {number} value @param {number} bits */
function ror(value,bits){return ((value>>>bits)|(value<<(32-bits)))>>>0;}
/** @param {unknown} value */
function canonicalJson(value) { return canonicalPrototypeProfileJson(value); }

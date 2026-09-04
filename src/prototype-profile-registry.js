// @ts-check

import { Sha256 } from "@aerobeat/web-hash";
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
  const bundleVersion = safeOptions.bundleVersion === undefined ? "1.0.0" : requireString(safeOptions.bundleVersion, "profile_bundle_version_invalid");
  const defaults = materializeDefaultProfileList(safeOptions.defaults ?? DEFAULT_DEFINITIONS, "profile_defaults_invalid");
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
    if (normalized.bundleVersion !== bundleVersion) throw gameplayError("profile_bundle_version_incompatible", "Imported profile bundle version must match the registry bundle version");
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
function materializeDefaultProfileList(value, code) { return normalizeProfileList(value, code, materializeDefaultProfile); }
/** @param {unknown} value @param {string} code @returns {readonly DataRecord[]} */
function normalizeImportedProfileList(value, code) { return normalizeProfileList(value, code, normalizeImportedProfile); }
/** @param {unknown} value @param {string} code @param {(entry:unknown)=>DataRecord} normalizeEntry @returns {readonly DataRecord[]} */
function normalizeProfileList(value, code, normalizeEntry) {
  const cloned = cloneGameplayData(value, code, 4096);
  if (!Array.isArray(cloned) || cloned.length < 3 || cloned.length > 64) throw gameplayError(code, "Profile list must contain 3..64 profiles");
  const ids = new Set();
  const profiles = cloned.map(normalizeEntry);
  for (const profile of profiles) { if (ids.has(profile.profileId)) throw gameplayError("profile_id_duplicate", "Profile IDs must be unique"); ids.add(profile.profileId); }
  return Object.freeze(profiles.sort(profileOrder));
}
/** @param {unknown} value @returns {DataRecord} */
function materializeDefaultProfile(value) { return normalizeProfile(value, false); }
/** @param {unknown} value @returns {DataRecord} */
function normalizeImportedProfile(value) { return normalizeProfile(value, true); }
/** @param {unknown} value @param {boolean} strictImport @returns {DataRecord} */
function normalizeProfile(value, strictImport) {
  const fields = ["schema", "version", "profileId", "profileVersion", "class", "label", "experimental", "settings", "contentHash"];
  const record = requireDataRecordFields(value, "prototype_profile_invalid", fields);
  if (strictImport && Reflect.ownKeys(record).length !== fields.length) throw gameplayError("prototype_profile_fields_missing", "Imported prototype profiles require every exact field");
  if (((strictImport || record.schema !== undefined) && record.schema !== PROFILE_SCHEMA) || ((strictImport || record.version !== undefined) && record.version !== 1)) throw gameplayError("prototype_profile_invalid", "Prototype profile schema/version is invalid");
  const profileId = requireString(record.profileId, "profile_id_invalid");
  const profileVersion = requireString(record.profileVersion, "profile_version_invalid");
  const profileClass = requireProfileClass(record.class);
  const label = requireString(record.label, "profile_label_invalid");
  if ((strictImport || record.experimental !== undefined) && record.experimental !== true) throw gameplayError("profile_not_experimental", "Prototype profiles must remain experimental");
  const settings = normalizeSettings(profileClass, record.settings);
  const hashBody = Object.freeze({ schema: PROFILE_SCHEMA, version: 1, profileId, profileVersion, class: profileClass, settings });
  const contentHash = sha256Hex(canonicalJson(hashBody));
  if (strictImport || record.contentHash !== undefined) {
    if (requireHash(record.contentHash, "profile_hash_invalid") !== contentHash) throw gameplayError("profile_hash_mismatch", "Profile content hash does not match canonical settings");
  }
  return Object.freeze({ ...hashBody, label, experimental: true, contentHash });
}

/** @param {unknown} value */
function normalizeBundle(value) {
  const record = requireDataRecordFields(value, "profile_bundle_invalid", ["schema", "version", "bundleVersion", "profiles", "bundleHash"]);
  if (record.schema !== BUNDLE_SCHEMA || record.version !== 1) throw gameplayError("profile_bundle_invalid", "Profile bundle schema/version is invalid");
  const bundleVersion = requireString(record.bundleVersion, "profile_bundle_version_invalid");
  const profiles = normalizeImportedProfileList(record.profiles, "profile_bundle_profiles_invalid");
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

/** Shared synchronous SHA-256 over UTF-8 text. @param {string} text */
export function sha256PrototypeProfileHex(text) { return sha256Hex(text); }
/** @param {string} text */
function sha256Hex(text) { return new Sha256().update(text).digestHex(); }
/** @param {string} left @param {string} right */
function compareUnicodeCodePoints(left, right) { const leftPoints = Array.from(left, (entry) => entry.codePointAt(0) ?? 0); const rightPoints = Array.from(right, (entry) => entry.codePointAt(0) ?? 0); const length = Math.min(leftPoints.length, rightPoints.length); for (let index = 0; index < length; index += 1) { if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]; } return leftPoints.length - rightPoints.length; }
/** @param {unknown} value */
function canonicalJson(value) { return canonicalPrototypeProfileJson(value); }

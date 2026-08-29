// @ts-check

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */

const MAX_DEPTH = 12;
const MAX_ITEMS = 4096;
const MAX_KEYS = 256;
const MAX_STRING = 8192;

/**
 * Clone untrusted JSON-like data without invoking getters or coercion hooks.
 *
 * @param {unknown} value
 * @param {string} [code]
 * @param {number} [maximumItems]
 * @returns {unknown}
 */
export function cloneGameplayData(value, code = "gameplay_data_invalid", maximumItems = MAX_ITEMS) {
  if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0 || maximumItems > 1500000) throw gameplayError(code, "Gameplay item limit is invalid");
  let items = 0;
  return clone(value, 0);

  /** @param {unknown} entry @param {number} depth @returns {unknown} */
  function clone(entry, depth) {
    if (depth > MAX_DEPTH || items > maximumItems) {
      throw gameplayError(code, "Gameplay data exceeds structural limits");
    }
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw gameplayError(code, "Gameplay numbers must be finite");
      return Object.is(entry, -0) ? 0 : entry;
    }
    if (typeof entry === "string") {
      if (entry.length > MAX_STRING) throw gameplayError(code, "Gameplay strings exceed the length limit");
      return entry;
    }
    if (Array.isArray(entry)) {
      const keys = Reflect.ownKeys(entry);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)))) throw gameplayError(code, "Gameplay arrays cannot contain symbolic or named properties");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > maximumItems) throw gameplayError(code, "Gameplay arrays exceed the item limit");
      const length = lengthDescriptor.value;
      items += length;
      if (items > maximumItems) throw gameplayError(code, "Gameplay data exceeds structural limits");
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw gameplayError(code, "Gameplay arrays cannot contain accessors or holes");
        result.push(clone(descriptor.value, depth + 1));
      }
      return Object.freeze(result);
    }
    if (!isPlainRecord(entry)) throw gameplayError(code, "Gameplay data must contain plain records only");
    const keys = Reflect.ownKeys(entry);
    if (keys.length > MAX_KEYS || keys.some((key) => typeof key !== "string")) {
      throw gameplayError(code, "Gameplay records exceed key limits or contain symbols");
    }
    items += keys.length;
    if (items > maximumItems) throw gameplayError(code, "Gameplay data exceeds structural limits");
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const keyValue of keys) {
      const key = /** @type {string} */ (keyValue);
      if (key.length > 256) throw gameplayError(code, "Gameplay record keys exceed the length limit");
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw gameplayError(code, "Gameplay records cannot contain accessors or hidden properties");
      }
      result[key] = clone(descriptor.value, depth + 1);
    }
    return Object.freeze(result);
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Read only an exact set of top-level own data fields without traversing values.
 * This is used for transport envelopes whose documented optional values may be undefined.
 *
 * @param {unknown} value
 * @param {string} code
 * @param {readonly string[]} allowedKeys
 * @returns {DataRecord}
 */
export function requireDataRecordFields(value, code, allowedKeys) {
  if (!isPlainRecord(value)) throw gameplayError(code, "Expected a plain record");
  const allowed = new Set(allowedKeys);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw gameplayError(code, "Record contains unknown or symbolic fields");
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const keyValue of keys) {
    const key = /** @type {string} */ (keyValue);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw gameplayError(code, "Record cannot contain accessors or hidden fields");
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

/** @param {unknown} value @param {string} code @param {number} [maximumItems] @returns {DataRecord} */
export function requireRecord(value, code, maximumItems) {
  if (!isPlainRecord(value)) throw gameplayError(code, "Expected a plain record");
  return /** @type {DataRecord} */ (cloneGameplayData(value, code, maximumItems));
}

/** @param {unknown} value @param {string} code @returns {string} */
export function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw gameplayError(code, "Expected a bounded non-empty string");
  }
  return value;
}

/** @param {unknown} value @param {string} code @returns {number} */
export function requireNonNegativeNumber(value, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw gameplayError(code, "Expected a non-negative finite number");
  }
  return Object.is(value, -0) ? 0 : value;
}

/** @param {unknown} value @param {string} code @param {number} [limit] @returns {readonly string[]} */
export function requireStringArray(value, code, limit = 2048) {
  const copy = cloneGameplayData(value, code, limit);
  if (!Array.isArray(copy) || copy.length > limit) throw gameplayError(code, "Expected a bounded string array");
  const result = [];
  for (const entry of copy) result.push(requireString(entry, code));
  return Object.freeze(result);
}

/** @param {string} code @param {string} message @returns {Error & {code: string}} */
export function gameplayError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** @param {string} left @param {string} right @returns {number} */
export function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

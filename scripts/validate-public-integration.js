// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlaybackClock } from "../../aerobeat-web-audio/src/index.js";
import { createAeroContentRuntime } from "../../aerobeat-web-content/src/index.js";
import { createAeroBodyGridService } from "../../aerobeat-web-input/src/index.js";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";

const HASH = "a".repeat(64);
const audioBytes = new TextEncoder().encode("gameplay-public-integration-audio");
const runtime = createAeroContentRuntime();
await runtime.loadPackage({ package: await makePackage(hashBytes(audioBytes)), assets: [{ path: "song.ogg", bytes: audioBytes }] });
let content = runtime.getSnapshot();
assert.equal(content.state, "ready");
assert.equal(content.variants.length, 5);
const boxingVariant = content.variants.find((entry) => entry.rulesetId === "boxing_spatial_grid_v1" && entry.recipeId === "cut_family_source_height_v1");
assert.ok(boxingVariant);
runtime.selectVariant(boxingVariant.variantId, { modifierIds: [] });
content = runtime.getSnapshot();

const gameplay = createAeroGameplaySessionCoordinator({ sessionId: "public-integration" });
gameplay.configureContent({
  packageId: content.packageId,
  selectedVariant: content.selectedVariant,
  resolvedEvents: content.resolvedEvents,
  profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "public-integration", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false }
});
const bodyGrid = createAeroBodyGridService({ calibrationIdPrefix: "public-integration" });
const initialInput = bodyGrid.getSnapshot();
const clock = createPlaybackClock();
gameplay.advance({ timestampMs: 0, clock: clock.snapshot(0), input: initialInput });
assert.equal(gameplay.getSnapshot().session.state, "calibrating");
assert.equal(gameplay.getSnapshot().session.packageId, content.packageId);
assert.equal(gameplay.getSnapshot().selectedVariant.variantId, content.selectedVariant.variantId);
assert.equal(Object.isFrozen(gameplay.getSnapshot()), true);
assert.doesNotThrow(() => JSON.parse(JSON.stringify(gameplay.getSnapshot())));

bodyGrid.destroy();
gameplay.destroy();
runtime.destroy();
console.log("Gameplay public audio/content/input integration passed.");

/** @param {Uint8Array} bytes */
function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
/** @param {unknown} value */
function hashJson(value) { return hashBytes(new TextEncoder().encode(JSON.stringify(sort(value)))); }
/** @param {unknown} value @returns {unknown} */
function sort(value) { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === "object") { const result = {}; for (const key of Object.keys(value).sort()) result[key] = sort(value[key]); return result; } return value; }
/** @param {string} audioHash */
async function makePackage(audioHash) {
  const sourceHash = `sha256:${hashBytes(new TextEncoder().encode("gameplay-public-source"))}`;
  const charts = [];
  for (const recipeId of ["row_family_balanced_height_v1", "cut_family_source_height_v1"]) for (const rulesetId of ["boxing_semantic_track_v1", "boxing_spatial_grid_v1"]) {
    const token = `${recipeId.startsWith("row") ? "row" : "cut"}-${rulesetId.includes("semantic") ? "semantic" : "spatial"}`;
    const beats = [{ start: 1, type: "hook_left", eventId: `${token}-hook`, sourceEventIds: [`${token}-source`], spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up" } }];
    const contentHash = hashJson({ beats, recipeId, rulesetId, sourceHash });
    charts.push({ schemaId: "aerobeat.chart.boxing.v1", schemaVersion: 1, recordVersion: 1, chartId: `chart-${token}`, chartName: token, mode: "boxing", difficulty: "Expert", prototype: { contractId: "aerobeat.boxing.prototype.v1", recipeId, recipeVersion: "1.0.0", rulesetId, rulesetVersion: "1.0.0", sourceHash, recipeHash: `sha256:${"1".repeat(64)}`, rulesetHash: `sha256:${"2".repeat(64)}`, contentHash: `sha256:${contentHash}`, modifiers: [], regenerationRequiredFor: [] }, beats });
  }
  charts.push({ schemaId: "aerobeat.chart.v1", schemaVersion: 1, recordVersion: 1, chartId: "chart-flow", chartName: "Flow", mode: "flow", difficulty: "Expert", beats: [{ start: 1, type: "note", hand: "left", placement: 4, direction: 1 }] });
  return {
    schemaId: "aerobeat.song-package.v1", schemaVersion: 1, packageVersion: "1.0.0", packageId: "gameplay-public-package", songId: "gameplay-public-song", songName: "Gameplay Public Integration",
    source: { provider: "local", sourceId: "gameplay-public", sourceVersionHash: "public-version", difficulty: "Expert", sourceDifficultyPath: "Expert.dat", sourceHash },
    song: { schemaId: "aerobeat.song.v1", schemaVersion: 1, recordVersion: 1, songId: "gameplay-public-song", songName: "Gameplay Public Integration", durationSec: 10, audio: { filePath: "song.ogg", contentHash: `sha256:${audioHash}` }, timing: { anchorMs: 0, tempoSegments: [{ startBeat: 0, bpm: 120 }], stopSegments: [], timeSignatureSegments: [{ startBeat: 0, numerator: 4, denominator: 4 }] } },
    charts,
    sets: charts.map((chart, index) => ({ schemaId: "aerobeat.set.v1", schemaVersion: 1, recordVersion: 1, setId: `set-${index}`, setName: chart.chartName, songId: "gameplay-public-song", chartId: chart.chartId })),
    recipeDefinitions: [], rulesetDefinitions: [], conversionTrace: {}, presentationSuggestion: null
  };
}

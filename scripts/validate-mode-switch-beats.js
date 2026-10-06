// @ts-check
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";

const HASH = "a".repeat(64);

const flowVariant = Object.freeze({
  variantId: "flow-v1",
  chartId: "chart-flow",
  mode: "flow",
  rulesetId: "flow_colliders_v1",
  recipeId: null,
  modifierIds: [],
  ranked: false,
  localOnly: true,
  mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH },
  scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH },
  provenance: { kind: "imported" }
});

const boxingVariant = Object.freeze({
  variantId: "boxing-v1",
  chartId: "chart-boxing",
  mode: "boxing",
  rulesetId: "boxing_collider_v1",
  recipeId: null,
  modifierIds: [],
  ranked: false,
  localOnly: true,
  mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH },
  scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH },
  provenance: { kind: "imported" }
});

const flowNote = (eventId, centerTimestampMs, hand = "left", placement = 0) => Object.freeze({
  schema: "aerobeat/resolved_content_event",
  version: 3,
  eventId,
  variantId: "flow-v1",
  chartId: "chart-flow",
  centerTimestampMs,
  sourceEventIds: [`flow-source-${eventId}`],
  type: "note",
  hand,
  placement
});

const boxingPunch = (eventId, centerTimestampMs, type = "straight_left", targetCell = 0) => Object.freeze({
  schema: "aerobeat/resolved_content_event",
  version: 3,
  eventId,
  variantId: "boxing-v1",
  chartId: "chart-boxing",
  centerTimestampMs,
  sourceEventIds: [`boxing-source-${eventId}`],
  type,
  spatialTarget: { targetCell, acceptedSubcells: [], sourceCell: -1 }
});

const profileIdentity = Object.freeze({
  schema: "aerobeat/prototype_tuning_identity",
  version: 1,
  profileId: "profile",
  profileVersion: "1",
  contentHash: HASH,
  class: "between_run_ruleset",
  regenerationRequired: false
});

/**
 * Test 1: Mode switch (flow → boxing) via applyFutureContent in calibrating state.
 * The variant must switch to boxing and all events must be re-resolved for boxing.
 * We verify via setActiveEventIds: old flow event IDs must be rejected (not in content),
 * new boxing event IDs must be accepted.
 */
function testModeSwitchReResolvesBeats() {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "mode-switch-test", countdownStepMs: 1 });

  const flowEvents = [
    flowNote("fn-1", 1000),
    flowNote("fn-2", 2000),
    flowNote("fn-3", 3000),
    flowNote("fn-4", 4000)
  ];
  coordinator.configureContent({
    packageId: "package",
    selectedVariant: flowVariant,
    resolvedEvents: flowEvents,
    profileIdentity
  });
  assert.equal(coordinator.getSnapshot().session.state, "calibrating");
  assert.equal(coordinator.getSnapshot().session.rulesetId, "flow_colliders_v1");

  // Verify flow event IDs are valid before the switch.
  coordinator.setActiveEventIds(["fn-1", "fn-2"]);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["fn-1", "fn-2"]);

  // Switch to boxing via applyFutureContent.
  const boxingFutureEvents = [
    boxingPunch("bp-1", 2000, "straight_left", 0),
    boxingPunch("bp-2", 3000, "hook_right", 4),
    boxingPunch("bp-3", 4000, "uppercut_left", 8)
  ];
  coordinator.applyFutureContent({
    packageId: "package",
    selectedVariant: boxingVariant,
    resolvedEvents: boxingFutureEvents,
    profileIdentity
  });

  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.session.rulesetId, "boxing_collider_v1", "ruleset switched to boxing");
  assert.equal(snapshot.selectedVariant.mode, "boxing", "variant mode is boxing");

  // Old flow event IDs must NOT be valid content anymore.
  assert.throws(
    () => coordinator.setActiveEventIds(["fn-1"]),
    /Active event IDs must belong to current content/u,
    "old flow event ID fn-1 is rejected after mode switch"
  );

  // New boxing event IDs must be valid.
  coordinator.setActiveEventIds(["bp-1", "bp-2", "bp-3"]);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["bp-1", "bp-2", "bp-3"]);

  console.log("✓ mode switch re-resolves beats: flow → boxing replaces all beats");
}

/**
 * Test 2: Same-mode variant swap (flow A → flow B) preserves past events.
 * Events at or before the timeline position keep their old variant ID.
 */
function testSameModeSwapPreservesPastEvents() {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "same-mode-swap-test", countdownStepMs: 1 });

  const flowVariantA = Object.freeze({ ...flowVariant, variantId: "flow-a", chartId: "chart-flow-a" });
  const flowVariantB = Object.freeze({ ...flowVariant, variantId: "flow-b", chartId: "chart-flow-b" });

  const noteA = (id, ms) => Object.freeze({ ...flowNote(id, ms), variantId: "flow-a", chartId: "chart-flow-a" });
  const noteB = (id, ms) => Object.freeze({ ...flowNote(id, ms), variantId: "flow-b", chartId: "chart-flow-b" });

  coordinator.configureContent({
    packageId: "package",
    selectedVariant: flowVariantA,
    resolvedEvents: [noteA("fa-1", 1000), noteA("fa-2", 2000)],
    profileIdentity
  });

  // Seek to 1500 ms so fa-1 (at 1000ms) is "past".
  coordinator.seekTo(1500);

  // Same-mode swap: variant A → variant B.
  coordinator.applyFutureContent({
    packageId: "package",
    selectedVariant: flowVariantB,
    resolvedEvents: [noteB("fb-1", 2000)],
    profileIdentity
  });

  // fa-1 (past, same mode) should still be valid content.
  coordinator.setActiveEventIds(["fa-1"]);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["fa-1"], "past same-mode event fa-1 preserved");

  // fb-1 (new future) should also be valid.
  coordinator.setActiveEventIds(["fb-1"]);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["fb-1"], "new future event fb-1 present");

  console.log("✓ same-mode variant swap preserves past events");
}

/**
 * Test 3: Mode switch with timeline past some events drops ALL old-mode events,
 * including past ones. Only new-mode events remain.
 */
function testModeSwitchDropsOldModePastEvents() {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "mode-switch-past-test", countdownStepMs: 1 });

  coordinator.configureContent({
    packageId: "package",
    selectedVariant: flowVariant,
    resolvedEvents: [
      flowNote("fn-past", 500),
      flowNote("fn-future", 3000)
    ],
    profileIdentity
  });

  // Advance timeline past the first flow note.
  coordinator.seekTo(1000);

  // Switch to boxing.
  coordinator.applyFutureContent({
    packageId: "package",
    selectedVariant: boxingVariant,
    resolvedEvents: [
      boxingPunch("bp-new", 2000, "straight_left", 0)
    ],
    profileIdentity
  });

  // Old flow events (past AND future) must be gone.
  assert.throws(
    () => coordinator.setActiveEventIds(["fn-past"]),
    /Active event IDs must belong to current content/u,
    "old-mode past event fn-past rejected after mode switch"
  );
  assert.throws(
    () => coordinator.setActiveEventIds(["fn-future"]),
    /Active event IDs must belong to current content/u,
    "old-mode future event fn-future rejected after mode switch"
  );

  // New boxing event must be valid.
  coordinator.setActiveEventIds(["bp-new"]);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["bp-new"]);

  console.log("✓ mode switch drops all old-mode events including past ones");
}

testModeSwitchReResolvesBeats();
testSameModeSwapPreservesPastEvents();
testModeSwitchDropsOldModePastEvents();
console.log("validate-mode-switch-beats: all tests passed");

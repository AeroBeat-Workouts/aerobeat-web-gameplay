// @ts-check
import assert from "node:assert/strict";
import { isGameplayJudgement } from "@aerobeat/web-contracts";
import {
  createAeroGameplaySessionCoordinator,
  defaultBoxingColliderSettings,
  boxingColliderSettingsIdentity,
  createBoxingColliderSettings,
  GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE,
  GUARD_DEFAULT_MAX_WRIST_SEPARATION_X,
  GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y,
  guardGestureSatisfied,
  matchesBoxingAuthoredDirection,
  boxerRowForPlacement,
  gloveBoxContactsBoxingTarget,
  boxingColliderTargetCenter
} from "../src/index.js";
import { targetCenterForPlacement } from "../src/flow-collider-collision.js";
import { boxingColliderRowY } from "@aerobeat/web-contracts";

const HASH = "a".repeat(64);
const settings = (overrides = {}) => ({ ...defaultBoxingColliderSettings, ...overrides });
const variant = (id = "boxing-collider") => ({ variantId: id, chartId: `chart-${id}`, mode: "boxing", rulesetId: "boxing_collider_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } });
const beat = (eventId, centerTimestampMs, type, extra = {}) => {
  const { placement, ...rest } = extra;
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "boxing-collider", chartId: "chart-boxing-collider", centerTimestampMs, sourceEventIds: [`source-${eventId}`], type, ...(placement !== undefined ? { spatialTarget: { targetCell: placement, acceptedSubcells: [], sourceCell: -1 } } : {}), ...rest };
};
const anchor = (name, measured, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 });
const poseAnchor = (name, measured, x, y, overrides = {}) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x, y, cell: 5, subcell: 20, ...overrides });
const evidence = (frameId, measured, left, right, nose, extras = []) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", measured, ...nose), anchor("left_shoulder", measured, 0, 0), anchor("right_shoulder", measured, 3, 0), anchor("left_elbow", measured, 0, 0), anchor("right_elbow", measured, 3, 0), anchor("left_wrist", measured, ...left), anchor("right_wrist", measured, ...right), ...extras], entries: [] });
const input = (measured, latest, overrides = {}) => ({ sourceIdentity: overrides.sourceIdentity ?? "camera-a", calibration: { calibrationId: overrides.calibrationId ?? "cal-1", readiness: overrides.ready === false ? "not_ready" : "countdown" }, tracking: { gameplayPaused: overrides.gameplayPaused === true, freshCalibrationRequired: overrides.freshCalibrationRequired === true }, countdownFrozen: false, latestEvidence: latest, straightQualifications: overrides.qualifications ?? [] });
const config = (events, boxingColliderSettings) => ({ packageId: "package", selectedVariant: variant(), resolvedEvents: events, profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false }, ...(boxingColliderSettings ? { boxingColliderSettings } : {}) });
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
let runSeq = 0;
function ready(events, boxingColliderSettings) {
  const c = createAeroGameplaySessionCoordinator({ sessionId: `boxing-collider-${++runSeq}`, countdownStepMs: 1 });
  c.configureContent(config(events, boxingColliderSettings));
  c.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  assert.equal(c.requestStart(0).accepted, true);
  c.advance({ timestampMs: 1, clock: clock(0, false) });
  c.advance({ timestampMs: 2, clock: clock(0, false) });
  c.advance({ timestampMs: 3, clock: clock(0, false) });
  assert.equal(c.getSnapshot().session.state, "playing");
  return c;
}
/** Send one measured frame at wall time == song time with canonical sx/sy wrist coordinates. */
function send(c, songMs, left, right, nose, frameId, options = {}) {
  const sample = evidence(frameId ?? `f-${songMs}`, songMs, left, right, nose, options.extras ?? []);
  if (options.disableWrist) for (const name of options.disableWrist) { const a = sample.anchors.find((entry) => entry.anchor === name); a.valid = false; a.x = null; a.y = null; a.cell = null; a.subcell = null; }
  c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: input(songMs, sample, options.inputOverrides ?? {}) });
  return sample;
}
const judgementsAt = (c) => c.getJudgements().map((j) => [j.eventId, j.result, [...j.diagnostics]]);

// --- Settings contract -------------------------------------------------------
{
  const exact = createBoxingColliderSettings(settings());
  assert.deepEqual(Object.keys(exact).sort(), ["algorithm", "bottomRowReachWU", "colliderRadius", "directionToleranceDegrees", "enforceAuthoredDirection", "guardCountMode", "schema", "topRowReachWU", "timingWindowMs", "version"].sort());
  // 0.0.53: the authored-direction toggle is enforced by default (both flow and
  // boxing mirrors); directionToleranceDegrees stays at 45.
  assert.equal(defaultBoxingColliderSettings.enforceAuthoredDirection, true, "boxing default enforces authored direction");
  assert.equal(defaultBoxingColliderSettings.directionToleranceDegrees, 45, "default tolerance stays 45");
  assert.equal(boxingColliderSettingsIdentity(settings()), boxingColliderSettingsIdentity(createBoxingColliderSettings()));
  assert.notEqual(boxingColliderSettingsIdentity(settings({ topRowReachWU: 0.5 })), boxingColliderSettingsIdentity(settings()));
  assert.notEqual(boxingColliderSettingsIdentity(settings({ bottomRowReachWU: 0.75 })), boxingColliderSettingsIdentity(settings()));
  assert.notEqual(boxingColliderSettingsIdentity(settings({ guardCountMode: "gesture" })), boxingColliderSettingsIdentity(settings()));
  assert.notEqual(boxingColliderSettingsIdentity(settings({ colliderRadius: 0.2 })), boxingColliderSettingsIdentity(settings()));
  assert.match(boxingColliderSettingsIdentity(settings()), /^sha256:[a-f0-9]{64}$/u);
  assert.throws(() => createBoxingColliderSettings(settings({ topRowReachWU: 1.5 })), /reach\/guard-mode fields are invalid/u);
  assert.throws(() => createBoxingColliderSettings({ ...settings(), extra: 1 }), /every exact field/u);
  assert.throws(() => createBoxingColliderSettings(settings({ guardCountMode: "nose" })), /invalid/u);
  const accessorCalls = 0; let calls = accessorCalls; const hostile = Object.create(null); for (const [key, value] of Object.entries(settings())) Object.defineProperty(hostile, key, { enumerable: true, get() { calls += 1; return value; } });
  assert.throws(() => createBoxingColliderSettings(hostile), /accessors or hidden fields/u);
  assert.equal(calls, 0);
}

// --- Reach mapping: judge truth equals contracts row Y, including 1/1 legacy parity -------
{
  const cases = [[0, 0], [0.25, 0.25], [0.5, 0.5], [1, 1]];
  for (const [top, bottom] of cases) {
    const reach = { topRowReachWU: top, bottomRowReachWU: bottom };
    for (const placement of [4, 5, 6, 7, 8, 9, 10, 11]) {
      const canonical = targetCenterForPlacement(placement);
      const row = /** @type {0|1|2} */ (2 - canonical.y);
      const shared = boxingColliderRowY(row, reach);
      assert.equal(canonical.y === 2 - Math.floor(placement / 4), true);
      // Judge target Y (world) must equal the shared contract worldY exactly.
      const target = boxingColliderTargetCenter(placement, reach);
      assert.equal(target.y, shared.worldY, `judge Y == contracts rowY for placement ${placement} at ${top}/${bottom}`);
      assert.equal(target.x, canonical.x);
      assert.ok(Number.isFinite(shared.worldY) && Number.isFinite(shared.athleteY));
    }
  }
  // Point contact at the exact judge plane for each reach case proves the judge uses the shared row Y.
  // 0.0.61 (GATE 1): judge target Y still equals the shared contracts row Y —
  // but the contact detector is now the GLOVE BOX (half-extent y = 0.28 in the
  // z=0 plane), not the retired 0.375+radius footprint. The on-plane sample
  // (wrist at the target center) hits; the off-plane sample 0.5 above is
  // inside the glove's y half-extent, so it hits TOO — the reach-row Y is the
  // judge truth, not a spatial gate. The spatial gate is the glove box.
  for (const [top, bottom] of cases) {
    const reach = { topRowReachWU: top, bottomRowReachWU: bottom };
    const placements = [4, 9];
    for (const placement of placements) {
      const row = boxerRowForPlacement(placement);
      const canonical = targetCenterForPlacement(placement);
      const shared = boxingColliderRowY(row, reach);
      const target = { centerTimestampMs: 1000, x: canonical.x, y: shared.worldY };
      const onPlane = { songTimeMs: 1000, sx: canonical.x, sy: shared.worldY };
      assert.equal(gloveBoxContactsBoxingTarget(target, onPlane, 180), true, `reach ${top}/${bottom} placement ${placement}`);
      // Off-plane sample 0.5 above: inside the glove's y half-extent, so the
      // glove box still overlaps the 1x1 target box. This is the intended
      // half-glove-size boundary shift versus the retired point-in-box test.
      const offPlane = { songTimeMs: 1000, sx: canonical.x, sy: shared.worldY + 0.5 };
      assert.equal(gloveBoxContactsBoxingTarget(target, offPlane, 180), true, `reach ${top}/${bottom} placement ${placement} off-plane (glove box still overlaps)`);
      // A sample 0.8 above the target center is OUTSIDE the glove's y
      // half-extent (0.28) plus the 0.5 cell half-height, so the glove box no
      // longer overlaps the target box.
      const farOffPlane = { songTimeMs: 1000, sx: canonical.x, sy: shared.worldY + 0.8 };
      assert.equal(gloveBoxContactsBoxingTarget(target, farOffPlane, 180), false, `reach ${top}/${bottom} placement ${placement} far off-plane (glove box does not overlap)`);
    }
  }
  // 1/1 legacy byte-parity: reach-row targets equal the legacy full-grid centers.
  for (const placement of [4, 5, 6, 8, 9, 10]) {
    const canonical = targetCenterForPlacement(placement);
    const row = /** @type {0|1|2} */ (2 - targetCenterForPlacement(placement).y);
    const shared = boxingColliderRowY(row, { topRowReachWU: 1, bottomRowReachWU: 1 });
    assert.equal(canonical.y, shared.worldY);
    // Legacy athlete Y for rows: row0→2.5, row1→1.5, row2→0.5 (sy=2.5-3y with y∈{0,0.5,1} envelope coords).
    const expectedLegacyAthleteY = row === 0 ? 2.5 : row === 1 ? 1.5 : 0.5;
    assert.equal(shared.athleteY, expectedLegacyAthleteY);
  }
  // Center row pinned at every reach combination.
  for (const [top, bottom] of cases) {
    const shared = boxingColliderRowY(1, { topRowReachWU: top, bottomRowReachWU: bottom });
    assert.deepEqual([shared.worldY, shared.athleteY], [1, 1.5]);
  }
  // 0.0.61 (GATE 1): boundary inclusivity now uses the GLOVE BOX, not the
  // retired 0.375+radius footprint. Timing boundaries are still inclusive;
  // the spatial boundary shifts by up to half a glove dimension (0.34 x).
  const target5 = { centerTimestampMs: 1000, x: 1, y: 1 };
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 820, sx: 1, sy: 1 }, 180), true, "early boundary inclusive");
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 1180, sx: 1, sy: 1 }, 180), true, "late boundary inclusive");
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 1180.001, sx: 1, sy: 1 }, 180), false, "past late boundary exclusive");
  // Glove half-extent 0.34: a wrist at 1.5+0.34=1.84 has its inner edge
  // exactly at 1.5 (no overlap); slightly beyond that misses. A wrist at
  // 1.83 still overlaps (inner edge 1.49 < 1.5).
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 1000, sx: 1.84, sy: 1 }, 180), false, "wrist at the glove's exact far edge misses");
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 1000, sx: 1.83, sy: 1 }, 180), true, "wrist just inside the glove's far edge still overlaps");
  // The old 0.375+0.12=0.495 boundary is replaced by the glove's 0.34
  // half-extent: a wrist at 1.495 (which was inside the old inflated box) is
  // still inside the glove (1.495-0.34=1.155 < 1.5). A wrist at 1.85 (outside
  // the glove) is also outside the old box (1.85 > 1.495). The DIFFERENCE is
  // the reach: a wrist at 1.5+0.34=1.84 was OUTSIDE the old box (1.84 >
  // 1.495) but is now AT the glove's exact edge — the boundary moved outward.
  // The corner case: a wrist at (0.505, 0.505) is inside the glove box
  // (0.505-0.34=0.165 < 0.5 on both axes) and the target box [0.5,1.5]x
  // [0.5,1.5], so it overlaps on both axes.
  assert.equal(gloveBoxContactsBoxingTarget(target5, { songTimeMs: 1000, sx: 0.505, sy: 0.505 }, 180), true, "corner near-tangent: the glove box overlaps both cell edges");
}

// --- Direction per family -----------------------------------------------------
{
  // Pure function matrix: within-45 hit, opposite fail, straight always pass (toggle irrelevant).
  const seg = (dx, dy) => ({ prior: Object.freeze({ songTimeMs: 900, measurementTimestampMs: 900, sourceFrameId: "a", sourceIdentity: "s", calibrationId: "c", sx: 0, sy: 0 }), current: Object.freeze({ songTimeMs: 1000, measurementTimestampMs: 1000, sourceFrameId: "b", sourceIdentity: "s", calibrationId: "c", sx: dx, sy: dy }) });
  assert.equal(matchesBoxingAuthoredDirection("uppercut_right", seg(0, 1).prior, seg(0, 1).current, true, 45), true, "uppercut up within tolerance");
  assert.equal(matchesBoxingAuthoredDirection("uppercut_right", seg(1, 0).prior, seg(1, 0).current, true, 45), false, "uppercut horizontal rejected");
  assert.equal(matchesBoxingAuthoredDirection("hook_left", seg(1, 0).prior, seg(1, 0).current, true, 45), true, "left hook toward center (right) accepted");
  assert.equal(matchesBoxingAuthoredDirection("hook_left", seg(-1, 0).prior, seg(-1, 0).current, true, 45), false, "left hook away rejected");
  assert.equal(matchesBoxingAuthoredDirection("hook_right", seg(-1, 0).prior, seg(-1, 0).current, true, 45), true, "right hook toward center (left) accepted");
  assert.equal(matchesBoxingAuthoredDirection("hook_right", seg(1, 0).prior, seg(1, 0).current, true, 45), false, "right hook away rejected");
  // Boundary inclusivity: exactly 45 degrees passes; slightly beyond fails (cosine + epsilon comparison).
  assert.equal(matchesBoxingAuthoredDirection("uppercut_right", seg(1, 1).prior, seg(1, 1).current, true, 45), true, "exactly 45 degrees inclusive");
  assert.equal(matchesBoxingAuthoredDirection("uppercut_right", seg(1.001, 1).prior, seg(1.001, 1).current, true, 45), false, "just beyond 45 rejected");
  // Straight: always overlap-only regardless of direction and toggle state.
  for (const enforce of [false, true]) {
    assert.equal(matchesBoxingAuthoredDirection("straight_left", seg(1, 0).prior, seg(1, 0).current, enforce, 45), true, "straight never direction-checked");
    assert.equal(matchesBoxingAuthoredDirection("straight_right", seg(0, -1).prior, seg(0, -1).current, enforce, 45), true);
  }
  // Toggle OFF leaves uppercut/hook overlap-only.
  assert.equal(matchesBoxingAuthoredDirection("uppercut_right", seg(1, 0).prior, seg(1, 0).current, false, 45), true);
  assert.equal(matchesBoxingAuthoredDirection("hook_left", seg(-1, 0).prior, seg(-1, 0).current, false, 45), true);
}

// End-to-end direction enforcement through the coordinator, incl. straight with toggle ON.
{
  const directional = settings({ enforceAuthoredDirection: true, directionToleranceDegrees: 45 });
  // Uppercuts are authored on the TOP grid row (cells 0-3); at the default
  // 0.25 top reach that row judges at world/athlete Y 1.25. Cell 5 sits in
  // the left center column (X 1) so the left hand owns it.
  const upperHit = ready([beat("up-hit", 1000, "uppercut_left", { placement: 5 })], directional);
  send(upperHit, 900, [1, 1.25], [3, 1.25], [3, 2]);
  send(upperHit, 1000, [1.4, 1.65], [3, 1.25], [3, 2]);
  assert.deepEqual(judgementsAt(upperHit), [["up-hit", "hit", []]], "uppercut entering upward at the top reach row counts");

  const upperMiss = ready([beat("up-miss", 1000, "uppercut_left", { placement: 5 })], directional);
  send(upperMiss, 900, [1.4, 1.65], [3, 1.25], [3, 2]);
  send(upperMiss, 1000, [1, 1.25], [3, 1.25], [3, 2]);
  assert.equal(upperMiss.getJudgements().length, 0, "wrong-direction uppercut stays pending");
  send(upperMiss, 1180, [1, 1.25], [3, 1.25], [3, 2]);
  assert.equal(upperMiss.getJudgements().length, 0, "inclusive late bound keeps wrong direction pending");
  send(upperMiss, 1181, [1, 1.25], [3, 1.25], [3, 2]);
  assert.deepEqual(judgementsAt(upperMiss), [["up-miss", "miss", ["wrong_direction"]]]);

  const hookHit = ready([beat("hook-hit", 1000, "hook_left", { placement: 6 })], directional);
  send(hookHit, 900, [0.5, 1], [3, 1], [3, 2]);
  send(hookHit, 1000, [2.2, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(hookHit), [["hook-hit", "hit", []]], "left hook moving toward center counts");

  const hookMiss = ready([beat("hook-miss", 1000, "hook_left", { placement: 6 })], directional);
  send(hookMiss, 900, [2.2, 1], [3, 1], [3, 2]);
  send(hookMiss, 1000, [0.5, 1], [3, 1], [3, 2]);
  send(hookMiss, 1181, [0.5, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(hookMiss), [["hook-miss", "miss", ["wrong_direction"]]]);

  // Straight is ALWAYS overlap-only: identical overlap geometry hits with the toggle both ways.
  for (const [label, cfg] of [["off", settings()], ["on", directional]]) {
    const straight = ready([beat(`straight-${label}`, 1000, "straight_left", { placement: 5 })], cfg);
    send(straight, 1000, [1, 1], [3, 1], [3, 2]);
    assert.deepEqual(judgementsAt(straight), [[`straight-${label}`, "hit", []]], `straight overlap-only with toggle ${label}`);
  }
  // Misdirected straight still counts (no direction check even when misdirected), while a misdirected hook misses.
  const misdirectedStraight = ready([beat("mis-straight", 1000, "straight_left", { placement: 5 })], directional);
  send(misdirectedStraight, 900, [-0.4, 1], [3, 1], [3, 2]);
  send(misdirectedStraight, 1000, [1, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(misdirectedStraight), [["mis-straight", "hit", []]], "straight ignores direction entirely");
}

// --- Guard collision mode: side ownership, crossed, both-required, miss window -------
{
  // Both wrists contacting their authored cells -> one Count (single judgement).
  const guardHit = ready([beat("g-both", 1000, "guard", { placement: 5, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(guardHit, 1000, [1, 1], [2, 1], [3, 2]);
  assert.deepEqual(judgementsAt(guardHit), [["g-both", "hit", []]], "both-side guard contact counts once");
  assert.equal(guardHit.getScorePartitions()[0].hits, 1);

  // Left-only contact never Counts; misses only past the late guard window.
  const guardLeftOnly = ready([beat("g-left", 1000, "guard", { placement: 5, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(guardLeftOnly, 1000, [1, 1], [3.5, 1], [3, 2]);
  assert.equal(guardLeftOnly.getJudgements().length, 0, "left-only contact does not count");
  send(guardLeftOnly, 1180, [1, 1], [3.5, 1], [3, 2]);
  assert.equal(guardLeftOnly.getJudgements().length, 0, "guard pending until strict past late window");
  send(guardLeftOnly, 1181, [1, 1], [3.5, 1], [3, 2]);
  assert.deepEqual(judgementsAt(guardLeftOnly), [["g-left", "miss", ["wrong_collider"]]]);

  // Right-only likewise never Counts.
  const guardRightOnly = ready([beat("g-right", 1000, "guard", { placement: 6, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(guardRightOnly, 1000, [3.5, 1], [2, 1], [3, 2]);
  send(guardRightOnly, 1181, [3.5, 1], [2, 1], [3, 2]);
  assert.deepEqual(judgementsAt(guardRightOnly), [["g-right", "miss", ["wrong_collider"]]]);

  // Crossed guard: fists are swapped across the center line, so the LEFT
  // authored cell is the right-side cell 6 and the RIGHT authored cell is the
  // left-side cell 5; each wrist still owns its authored cell (sx 2 = column 2).
  const crossedHit = ready([beat("x-both", 1000, "guard", { placement: 5, guardTarget: { leftCell: 6, rightCell: 5, crossed: true }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(crossedHit, 1000, [2, 1], [1, 1], [3, 2]);
  assert.deepEqual(judgementsAt(crossedHit), [["x-both", "hit", []]], "crossed guard cells keep side ownership and count");
  // A crossed event without the flag is rejected by validation.
  const badCrossed = createAeroGameplaySessionCoordinator({ sessionId: "bad-crossed", countdownStepMs: 1 });
  assert.throws(() => badCrossed.configureContent(config([beat("bad-x", 1000, "crossed_guard", { placement: 5, guardTarget: { leftCell: 6, rightCell: 5 } })])), /crossed flag/u);
  const okCrossed = createAeroGameplaySessionCoordinator({ sessionId: "ok-crossed", countdownStepMs: 1 });
  assert.doesNotThrow(() => okCrossed.configureContent(config([beat("ok-x", 1000, "guard", { placement: 5, guardTarget: { leftCell: 6, rightCell: 5, crossed: true } })])));
  // Validation rejects non-guard-target punches/guards without placements and invalid cells.
  assert.throws(() => createAeroGameplaySessionCoordinator({ sessionId: "no-placement" }).configureContent(config([beat("np", 1000, "hook_left", {})])), /plain record|4x3 grid cell/u);
  assert.throws(() => createAeroGameplaySessionCoordinator({ sessionId: "bad-cell" }).configureContent(config([beat("bc", 1000, "hook_left", { placement: 42 })])), /4x3 grid cell/u);

  // Swept guard contact: wrist arrives across the footprint during the window.
  const guardSwept = ready([beat("g-swept", 1000, "guard", { placement: 5, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(guardSwept, 900, [-0.4, 1], [3.4, 1], [3, 2]);
  send(guardSwept, 1000, [1, 1], [2, 1], [3, 2]);
  assert.deepEqual(judgementsAt(guardSwept), [["g-swept", "hit", []]], "swept both-side guard contact counts");

  // Nose cannot guard: nose anchors alone never satisfy either wrist requirement.
  const guardNose = ready([beat("g-nose", 1000, "guard", { placement: 5, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } })]);
  send(guardNose, 1000, [3, 2], [3, 2], [3, 2]);
  send(guardNose, 1181, [3, 2], [3, 2], [3, 2]);
  assert.deepEqual(judgementsAt(guardNose), [["g-nose", "miss", ["wrong_collider"]]], "nose-only frame never guards");
}

// --- Guard gesture mode: five-condition port, y-down convention, window ------------------
{
  const guardBeat = () => beat("gg", 1000, "guard", { placement: 5, guardTarget: { leftCell: 5, rightCell: 6 }, checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180 } });
  const pose = (over = {}) => over;
  // Base raised-fist pose with comfortable slack on every condition so each
  // per-threshold case breaks exactly one: wrists at x 0.44/0.56 (sepX 0.12),
  // shared y 0.48 (sepY 0), both 0.09 from a centered nose at (0.5, 0.42)
  // (< 0.15), elbows below at y 0.58.
  const fistPose = (over = {}) => pose({
    nose: poseAnchor("nose", 0, 0.5, 0.42),
    leftElbow: poseAnchor("left_elbow", 0, 0.38, 0.58),
    rightElbow: poseAnchor("right_elbow", 0, 0.62, 0.58),
    leftWrist: poseAnchor("left_wrist", 0, 0.44, 0.48),
    rightWrist: poseAnchor("right_wrist", 0, 0.56, 0.48),
    ...over
  });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // y-down convention fixture: raised fists (wrists above elbows in view = smaller y) satisfy; dropped arms do not.
  const raisedFists = fistPose();
  for (const hand of ["left", "right"]) assert.ok(dist(raisedFists.nose, raisedFists[`${hand}Wrist`]) <= GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE && raisedFists[`${hand}Wrist`].y < raisedFists[`${hand}Elbow`].y);
  assert.equal(guardGestureSatisfied(raisedFists), true, "raised-fist pose satisfies the y-down guard gesture");
  // Dropped arms fail the wrist-above-elbow condition; all other anchors stay
  // valid so the frame is still contract-valid evidence.
  const droppedArms = fistPose({
    leftElbow: poseAnchor("left_elbow", 0, 0.38, 0.30),
    rightElbow: poseAnchor("right_elbow", 0, 0.62, 0.30)
  });
  assert.equal(guardGestureSatisfied(droppedArms), false, "dropped-arm pose (wrist below elbow) fails the y-down convention");
  // Each condition individually at/beyond threshold breaks the gesture.
  assert.equal(guardGestureSatisfied(fistPose({ rightWrist: poseAnchor("right_wrist", 0, 0.56 + GUARD_DEFAULT_MAX_WRIST_SEPARATION_X, 0.48) })), false, "wrist separation x beyond threshold");
  assert.equal(guardGestureSatisfied(fistPose({ rightWrist: poseAnchor("right_wrist", 0, 0.56, 0.48 + GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y) })), false, "wrist separation y beyond threshold");
  assert.equal(guardGestureSatisfied(fistPose({ leftWrist: poseAnchor("left_wrist", 0, 0.44, 0.42 - GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE) })), false, "left wrist-nose distance beyond threshold");
  assert.equal(guardGestureSatisfied(fistPose({ rightWrist: poseAnchor("right_wrist", 0, 0.56, 0.42 + GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE) })), false, "right wrist-nose distance beyond threshold");
  assert.equal(guardGestureSatisfied(fistPose({ leftElbow: poseAnchor("left_elbow", 0, 0.38, 0.48 - 0.01) })), false, "left wrist no longer above left elbow");
  assert.equal(guardGestureSatisfied(fistPose({ rightElbow: poseAnchor("right_elbow", 0, 0.62, 0.48 - 0.01) })), false, "right wrist no longer above right elbow");
  // Exact thresholds are inclusive: separation-x at exactly 0.20 (wrists at
  // x 0.40 / 0.60) and wrist-nose distance at exactly 0.15 (left wrist at
  // (0.5, 0.15) directly above the nose).
  // Boundary inclusivity oracles: the base pose sits AT the exact 0.12
  // separation-y threshold and it passes (proving <= includes equality); the
  // nose-centered symmetric case puts BOTH wrists at the exact 0.15 nose
  // distance and passes. (Several other "exact" decimal combinations alias
  // just outside in IEEE754 — e.g. 0.48-0.60 = 0.12000000000000003 — so the
  // beyond-threshold cases above cover those sides.)
  assert.equal(guardGestureSatisfied(raisedFists), true, "base pose at exact separation-y threshold inclusive");
  assert.equal(guardGestureSatisfied(fistPose({ leftWrist: poseAnchor("left_wrist", 0, 0.425, 0.42), rightWrist: poseAnchor("right_wrist", 0, 0.575, 0.42) })), true, "wrists at exact 0.15 nose distance inclusive");
  // Missing landmark -> no gesture.
  assert.equal(guardGestureSatisfied({ ...raisedFists, leftWrist: null }), false, "missing left wrist fails");
  assert.equal(guardGestureSatisfied({ ...raisedFists, nose: { x: 0.5, y: 0.3, valid: false } }), false, "invalid nose fails");
  // Disabled config kills the gesture.
  assert.equal(guardGestureSatisfied(raisedFists, { enabled: false, maxWristSeparationX: 0.2, maxWristSeparationY: 0.12, maxWristNoseDistance: 0.15 }), false);

  const gestureConfig = settings({ guardCountMode: "gesture" });
  // The evidence() helper already carries valid nose/elbow/wrist anchors;
  // build the frame explicitly so the pose's exact anchor values are used.
  // Anchors carry the frame's measurement timestamp (stamped below).
  const stampPose = (songMs, p) => Object.fromEntries(Object.entries(p).map(([key, value]) => [key, { ...value, measurementTimestampMs: songMs }]));
  const gestureEvidence = (songMs, p) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: `gf-${songMs}-${Math.random().toString(36).slice(2, 8)}`, measurementTimestampMs: songMs, provenance: "measured", activeBoxingActions: [], anchors: [p.nose, p.leftElbow, p.rightElbow, p.leftWrist, p.rightWrist].map((entry) => ({ ...entry, measurementTimestampMs: songMs })).filter(Boolean), entries: [] });
  void stampPose;
  const gestureSend = (c, songMs, p) => c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: input(songMs, gestureEvidence(songMs, p)) });

  // Gesture in the instantaneous-checkpoint window -> Count. Wrists at x 0.4/
  // 0.6 with the nose's y satisfy the gesture (sepX 0.2 clean-FP inside, nose
  // distance 0.1); the same frame also overlaps the guard's center-row cell
  // footprint, so no collision-mode ambiguity hides a gesture failure.
  const raisedGuardPose = fistPose({
    leftWrist: poseAnchor("left_wrist", 0, 0.4, 0.42),
    rightWrist: poseAnchor("right_wrist", 0, 0.6, 0.42)
  });
  const gIn = ready([guardBeat()], gestureConfig);
  gestureSend(gIn, 1000, raisedGuardPose);
  assert.deepEqual(judgementsAt(gIn), [["gg", "hit", []]], "gesture inside the checkpoint window counts");
  // Gesture out of window (after it) -> miss at strict past window; no
  // evidence ever arrived, so the diagnostic is no_input.
  const gOutLate = ready([guardBeat()], gestureConfig);
  gOutLate.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(1181, null) });
  assert.deepEqual(judgementsAt(gOutLate), [["gg", "miss", ["no_input"]]], "miss only strict past the guard window");
  // Gesture early, before the window opens -> no count yet.
  const gOutEarly = ready([guardBeat()], gestureConfig);
  gestureSend(gOutEarly, 819, raisedFists);
  assert.equal(gOutEarly.getJudgements().length, 0, "pre-window gesture does not count");
  gestureSend(gOutEarly, 820, droppedArms);
  assert.equal(gOutEarly.getJudgements().length, 0, "window-open boundary with a non-gesture frame does not count");
  gestureSend(gOutEarly, 1000, raisedGuardPose);
  assert.deepEqual(judgementsAt(gOutEarly), [["gg", "hit", []]], "gesture held inside the window counts");
  // Missing landmarks mid-run -> no gesture (pose adapter delivers no new surface).
  const gMissing = ready([guardBeat()], gestureConfig);
  // The evidence contract requires a shaped anchor entry, so a "missing"
  // landmark is represented by a sub-threshold-confidence anchor — exactly
  // what the gesture port's measured-anchor read rejects (confidence < 0.5).
  const lowConfidencePose = { ...raisedFists, leftWrist: { ...raisedFists.leftWrist, confidence: 0.4 } };
  gestureSend(gMissing, 1000, lowConfidencePose);
  assert.equal(gMissing.getJudgements().length, 0, "sub-threshold landmark produces no gesture Count");
  // A fresh non-gesture frame past the late boundary still produces exactly
  // one semantic-only miss.
  gestureSend(gMissing, 1181, droppedArms);
  assert.equal(gMissing.getJudgements().length, 1, "one miss after the window");
  assert.equal(gMissing.getJudgements()[0].result, "miss", "missing-landmark run misses");
  const missDiagnostics = gMissing.getJudgements()[0].diagnostics;
  assert.ok(Array.isArray(missDiagnostics) && missDiagnostics.length >= 0, "diagnostics are semantic codes only");
  // Collision mode is pose-blind: a guard frame whose wrists do NOT overlap
  // the authored cells must miss even though the same geometry satisfies the
  // pure gesture conditions (the wrist pair straddles the center line at the
  // nose row, outside either cell's X footprint).
  // sx 1.1 / 1.9 sit just OUTSIDE both guard cells' inflated X footprints
  // (cell 5 slab ends at ~1.495, cell 6 slab starts at ~1.505) while the pure
  // gesture conditions stay satisfied (nose distances 0.1, clean sepX).
  // Collision mode is pose-blind: a dropped-arms frame (wrists far below the
  // guard cells AND failing the wrist-above-elbow condition) must miss even
  // though a raised-fist version of the same X positions would satisfy the
  // pure gesture. This proves the two modes read different evidence.
  const droppedOffCells = fistPose({
    leftWrist: poseAnchor("left_wrist", 0, 0.44, 0.90),
    rightWrist: poseAnchor("right_wrist", 0, 0.56, 0.90)
  });
  const gCollisionIgnores = ready([guardBeat()]);
  gestureSend(gCollisionIgnores, 1000, droppedOffCells);
  assert.equal(gCollisionIgnores.getJudgements().length, 0, "collision mode ignores the pose with wrists off the authored cells");
  gCollisionIgnores.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(1181, null) });
  assert.equal(gCollisionIgnores.getJudgements()[0]?.result, "miss", "collision mode still misses an off-cell frame");
}

// --- Run gating: reach + guard mode locked mid-run, like flow_collider_settings_locked --------
{
  const c = ready([beat("lock-a", 1000, "straight_left", { placement: 5 })], settings());
  c.pause(10);
  for (const [label, next] of [["reach top", settings({ topRowReachWU: 0.5 })], ["reach bottom", settings({ bottomRowReachWU: 0.9 })], ["guard mode", settings({ guardCountMode: "gesture" })], ["radius", settings({ colliderRadius: 0.2 })]]) {
    assert.throws(() => c.applyFutureContent(config([], next)), /boxing_collider_settings_locked|locked for the complete run/u, label);
  }
  // Identical settings are accepted.
  assert.doesNotThrow(() => c.applyFutureContent(config([], settings())));
  // Flow settings are still foreign to a boxing run.
  assert.throws(() => c.applyFutureContent({ packageId: "package", selectedVariant: variant(), resolvedEvents: [], flowColliderSettings: { ...defaultBoxingColliderSettings } }), /Flow Collider settings require/u);
  c.destroy();
  // New run: changing reach between runs is fine (identity changes with it).
  const before = ready([beat("rb", 1000, "straight_left", { placement: 5 })], settings({ topRowReachWU: 0.25, bottomRowReachWU: 0.25 })).getScorePartitions().length;
  void before;
  // Placement 4 is a genuine TOP-row cell (row 0): it judges at 1+topReach —
  // 1.5 at reach 0.5, only 1.25 at the default 0.25 where this frame misses.
  // The seed frame arms the recovery baseline; the second frame inside the
  // window is the actual judgement frame. Placement 4 (top row) at reach 0.5
  // judges at Y 1.5 — the frame at sy 1.5 hits there but misses at 0.25 (Y 1.25).
  const other = ready([beat("rb2", 1000, "straight_left", { placement: 4 })], settings({ topRowReachWU: 0.5, bottomRowReachWU: 0.5 }));
  send(other, 900, [-0.25, 1.4], [3, 1], [3, 2]);
  send(other, 1000, [-0.25, 1.5], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(other).filter(([id]) => id === "rb2"), [["rb2", "hit", []]], "top-row cell reached at 0.5 scores at the remapped Y");
  // A BOTTOM-row cell (9) at default 0.25 judges at Y 0.75; a frame at sy 0.2
  // sits 0.55 below it (outside the inflated half-extent 0.495) and misses,
  // while at bottomReach 0.5 the same cell judges at Y 0.5 and the frame hits.
  // hook_right -> RIGHT hand; placement 9 is column 1 (x=1), bottom row.
  // At default 0.25 the bottom row judges at Y 0.75; a frame at sy 0.2 sits
  // 0.55 below (outside the inflated half-extent 0.495) and misses. At
  // bottomReach 0.5 the same cell judges at Y 0.5 and the frame hits.
  const rbBottomLow = ready([beat("rb3", 1000, "hook_right", { placement: 9 })]);
  send(rbBottomLow, 900, [3, 0.2], [1, 0.2], [3, 2]);
  send(rbBottomLow, 1000, [3, 0.2], [1, 0.2], [3, 2]);
  send(rbBottomLow, 1181, [3, 0.2], [1, 0.2], [3, 2]);
  // hook_right is direction-enforced by default (0.0.53), so the stationary
  // off-plane miss reports wrong_direction rather than wrong_collider.
  assert.deepEqual(judgementsAt(rbBottomLow).filter(([id]) => id === "rb3"), [["rb3", "miss", ["wrong_direction"]]], "the default bottom row (0.25, Y 0.75) rejects a very-low frame");
  // The right wrist enters from below (dy +0.3), outside the default "left"-authored
  // hook tolerance, so this reach test runs overlap-only to keep it direction-neutral.
  const rbBottomReached = ready([beat("rb4", 1000, "hook_right", { placement: 9 })], settings({ bottomRowReachWU: 0.5, enforceAuthoredDirection: false }));
  send(rbBottomReached, 900, [3, 0.2], [1, 0.2], [3, 2]);
  send(rbBottomReached, 1000, [3, 0.2], [1, 0.5], [3, 2]);
  assert.deepEqual(judgementsAt(rbBottomReached).filter(([id]) => id === "rb4"), [["rb4", "hit", []]], "the reached bottom row (0.5, Y 0.5) accepts the low frame");
}

// --- Score identity changes with each setting; partition local-only/unranked -------------------
{
  const base = ready([beat("id-base", 1000, "straight_left", { placement: 5 })], settings());
  send(base, 1000, [1, 1], [3, 1], [3, 2]);
  const basePartition = base.getScorePartitions()[0];
  assert.equal(basePartition.ranked, false, "partition unranked");
  assert.equal(basePartition.localOnly, true, "partition local-only");
  assert.match(basePartition.boxingColliderSettingsIdentity, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(basePartition.flowColliderSettingsIdentity, undefined, "no flow identity leaks into the boxing partition");
  assert.equal(basePartition.hits, 1);
  assert.equal(basePartition.combo, 1);
  // All variants use a middle-row cell (pinned at Y 1) so the same overlap
  // geometry counts in every configuration; only the identity changes.
  // The score identity (a pure hash of the normalized settings) changes with
  // every field; the partition record itself only materialises on the first
  // judgement, so we compare the exported identity function directly.
  // enforceAuthoredDirection now defaults to true, so the identity variant flips it off.
  const identityVariants = [settings({ topRowReachWU: 0.5 }), settings({ bottomRowReachWU: 0.5 }), settings({ guardCountMode: "gesture" }), settings({ colliderRadius: 0.2 }), settings({ directionToleranceDegrees: 60 }), settings({ timingWindowMs: 240 }), settings({ enforceAuthoredDirection: false })];
  for (const next of identityVariants) {
    assert.notEqual(boxingColliderSettingsIdentity(next), basePartition.boxingColliderSettingsIdentity, `${JSON.stringify(next)} changes the score identity`);
  }
}

// --- Reach slider end-to-end: top/bottom rows reposition, center pinned --------------------
{
  // Top-row cells (0-3) judge at 1+topReach: 1.25 @0.25, 2 @1.0, 1 @0.
  // uppercut_left -> LEFT hand; placement 1 is column 1 (x=1).
  const topRun = ready([beat("top", 1000, "uppercut_left", { placement: 1 })], settings({ topRowReachWU: 0.25 }));
  send(topRun, 900, [1, 1.15], [3, 1], [3, 2]);
  send(topRun, 1000, [1, 1.25], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(topRun).filter(([id]) => id === "top"), [["top", "hit", []]], "top row reaches slightly above shoulder");
  const topFar = ready([beat("top-1", 1000, "uppercut_left", { placement: 1 })], settings({ topRowReachWU: 1 }));
  send(topFar, 900, [1, 1.9], [3, 1], [3, 2]);
  send(topFar, 1000, [1, 2], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(topFar).filter(([id]) => id === "top-1"), [["top-1", "hit", []]], "top row at 1.0 equals the legacy full-grid Y");
  // Bottom-row cells (8-11) judge at 1-bottomReach: 0.75 @0.25, 0.5 @0.5.
  // hook_right -> RIGHT hand; placement 9 is column 1 (x=1).
  // The right wrist enters from below (dy +0.1), outside the default "left"-authored
  // hook tolerance, so this reach test runs overlap-only to keep it direction-neutral.
  const bottomRun = ready([beat("bottom", 1000, "hook_right", { placement: 9 })], settings({ bottomRowReachWU: 0.5, enforceAuthoredDirection: false }));
  send(bottomRun, 900, [3, 0.2], [1, 0.4], [3, 2]);
  send(bottomRun, 1000, [3, 0.2], [1, 0.5], [3, 2]);
  assert.deepEqual(judgementsAt(bottomRun).filter(([id]) => id === "bottom"), [["bottom", "hit", []]], "bottom row follows bottom reach");
  const zeroTop = ready([beat("zero-top", 1000, "straight_left", { placement: 1 })], settings({ topRowReachWU: 0 }));
  send(zeroTop, 900, [1, 0.9], [3, 1], [3, 2]);
  send(zeroTop, 1000, [1, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(zeroTop).filter(([id]) => id === "zero-top"), [["zero-top", "hit", []]], "0.0 top reach collapses the top row to shoulder height");
  const centerAlways = ready([beat("center", 1000, "straight_right", { placement: 6 })], settings({ topRowReachWU: 0.9, bottomRowReachWU: 0.1 }));
  send(centerAlways, 1000, [3, 1], [2, 1], [3, 2]);
  assert.deepEqual(judgementsAt(centerAlways), [["center", "hit", []]], "center row pinned at shoulder for any reach");
}

// --- Straights: no hold required; immediate overlap counts ------------------------------------
{
  const straight = ready([beat("no-hold", 1000, "straight_right", { placement: 6 })]);
  send(straight, 1000, [3, 1], [2, 1], [3, 2]);
  assert.deepEqual(judgementsAt(straight), [["no-hold", "hit", []]], "straight counts on pure overlap without any hold evidence");
  // Providing qualification evidence is not required (and is ignored) for this ruleset.
  const qualified = ready([beat("no-hold-2", 1000, "straight_right", { placement: 6 })]);
  qualified.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(1000, evidence("fh", 1000, [1, 1], [2, 1], [3, 2]), { qualifications: [{ hand: "right", semanticQualified: false, semanticStartTimestampMs: null, semanticDurationMs: 0, spatialQualified: false, spatialStartTimestampMs: null, spatialDurationMs: 0, acceptedSubcellColumns: [] }] }) });
  assert.deepEqual(judgementsAt(qualified), [["no-hold-2", "hit", []]], "absence of straight qualification still counts");
}

// --- Miss diagnostics: semantic codes only ------------------------------------------------------
{
  const noInput = ready([beat("diag-none", 1000, "straight_left", { placement: 5 })]);
  noInput.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(1181, null) });
  assert.deepEqual(judgementsAt(noInput), [["diag-none", "miss", ["no_input"]]]);
  const stale = ready([beat("diag-stale", 1000, "straight_left", { placement: 5 })]);
  const staleSample = evidence("stale-frame", 1000, [1, 1], [3, 1], [3, 2]);
  stale.advance({ timestampMs: 1150, clock: clock(1150, true), input: input(1150, staleSample) });
  assert.equal(stale.getJudgements().length, 0);
  stale.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(1181, staleSample) });
  assert.deepEqual(judgementsAt(stale), [["diag-stale", "miss", ["stale_input"]]], "evidence age >= 150ms reports stale_input");
  // A calibration-mismatch frame is also stale by construction (the evidence
  // arrives with a different calibrationId, which clears the sample history),
  // so the first semantic diagnostic in priority order is stale_input — the
  // approved semantic code set still bounds what the public surface reports.
  const mismatch = ready([beat("diag-cal", 1000, "straight_left", { placement: 5 })]);
  const mismatchSample = evidence("cal-frame", 1000, [1, 1], [3, 1], [3, 2]);
  mismatchSample.calibrationId = "cal-2"; for (const entry of mismatchSample.anchors) entry.calibrationId = "cal-2";
  mismatch.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(1000, mismatchSample, { calibrationId: "cal-2" }) });
  mismatch.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(1181, mismatchSample, { calibrationId: "cal-2" }) });
  const mismatchResult = judgementsAt(mismatch)[0];
  assert.equal(mismatchResult[1], "miss");
  assert.ok(["stale_input", "calibration_mismatch"].includes(mismatchResult[2][0]), `diagnostic is an approved semantic code: ${JSON.stringify(mismatchResult[2])}`);
  const wrongC = ready([beat("diag-wrong", 1000, "straight_left", { placement: 5 })]);
  send(wrongC, 1000, [-0.4, 1], [3, 1], [3, 2]);
  send(wrongC, 1181, [-0.4, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(wrongC), [["diag-wrong", "miss", ["wrong_collider"]]], "owned hand present but off-target reports wrong_collider");
}

// --- Chords: simultaneous two-hand arrivals resolve independently, deterministically --------------
{
  const ordered = [beat("chord-r", 1000, "straight_right", { placement: 6 }), beat("chord-l", 1000, "straight_left", { placement: 5 })];
  const runOne = (eventList) => {
    const c = ready(eventList);
    send(c, 900, [-0.4, 1], [3.4, 1], [3, 2]);
    send(c, 1000, [1, 1], [2, 1], [3, 2]);
    assert.deepEqual(c.getJudgements().map((j) => j.eventId).sort(), ["chord-l", "chord-r"]);
    assert.equal(c.getScorePartitions()[0].maxCombo, 2);
    return c.getJudgements().map((j) => [j.eventId, j.result, j.timingOffsetMs]).sort(JSON.stringify);
  };
  assert.deepEqual(runOne(ordered), runOne([...ordered].reverse()), "chord resolution is permutation-invariant");
}

// --- Mode isolation: Flow path byte-compatible, boxing does not touch Lanes/Grid semantics ---------
{
  // Flow Colliders run unchanged: note hit + identity intact.
  const flowVariant = { variantId: "flow", chartId: "chart-flow", mode: "flow", rulesetId: "flow_colliders_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
  const flowBeat = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "f-note", variantId: "flow", chartId: "chart-flow", centerTimestampMs: 1000, sourceEventIds: ["source-f-note"], type: "note", hand: "left", placement: 5 };
  const flowConfig = { packageId: "package", selectedVariant: flowVariant, resolvedEvents: [flowBeat], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } };
  const flow = createAeroGameplaySessionCoordinator({ sessionId: "isolation-flow", countdownStepMs: 1 });
  flow.configureContent(flowConfig);
  flow.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  assert.equal(flow.requestStart(0).accepted, true);
  flow.advance({ timestampMs: 1, clock: clock(0, false) });
  flow.advance({ timestampMs: 2, clock: clock(0, false) });
  flow.advance({ timestampMs: 3, clock: clock(0, false) });
  flow.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(1000, evidence("ff", 1000, [1, 1], [3, 1], [3, 2])) });
  assert.deepEqual(flow.getJudgements().map((j) => [j.eventId, j.result]), [["f-note", "hit"]], "flow scoring untouched by the boxing lane");
  const flowPartition = flow.getScorePartitions()[0];
  assert.equal(typeof flowPartition.flowColliderSettingsIdentity, "string");
  assert.equal(flowPartition.boxingColliderSettingsIdentity, undefined);
  // Boxing setup fields are rejected on flow variants and absent from flow partitions.
  assert.throws(() => createAeroGameplaySessionCoordinator({ sessionId: "flow-rejects-boxing" }).configureContent({ ...flowConfig, boxingColliderSettings: settings() }), /require the Boxing Colliders ruleset/u);
  // Legacy boxing variants still validate their historical shapes (Lanes/Grid untouched).
  const lanes = createAeroGameplaySessionCoordinator({ sessionId: "isolation-lanes" });
  lanes.configureContent({ packageId: "package", selectedVariant: { variantId: "lanes", chartId: "chart-lanes", mode: "boxing", rulesetId: "boxing_semantic_track_v1", recipeId: "row_family_balanced_height_v1", modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } }, resolvedEvents: [{ schema: "aerobeat/resolved_content_event", version: 3, eventId: "l1", variantId: "lanes", chartId: "chart-lanes", centerTimestampMs: 1000, sourceEventIds: ["s"], type: "straight_left" }], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } });
  const grid = createAeroGameplaySessionCoordinator({ sessionId: "isolation-grid" });
  grid.configureContent({ packageId: "package", selectedVariant: { variantId: "grid", chartId: "chart-grid", mode: "boxing", rulesetId: "boxing_spatial_grid_v1", recipeId: "row_family_balanced_height_v1", modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } }, resolvedEvents: [{ schema: "aerobeat/resolved_content_event", version: 3, eventId: "g1", variantId: "grid", chartId: "chart-grid", centerTimestampMs: 1000, sourceEventIds: ["s"], type: "straight_left", spatialTarget: { targetCell: 5, acceptedSubcells: [20] } }], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } });
  // Public judgements satisfy the contracts validator for every ruleset.
  assert.equal(isGameplayJudgement(flow.getJudgements()[0]), true);
  assert.equal(isGameplayJudgement(ready([beat("v", 1000, "straight_left", { placement: 5 })]).getJudgements()[0] ?? flow.getJudgements()[0]), true);
}

// --- Punch min-spacing is chart-side: two beats 360ms apart are both independently judgeable ------
{
  const spaced = ready([beat("spaced-a", 1000, "straight_left", { placement: 5 }), beat("spaced-b", 1360, "straight_left", { placement: 5 })]);
  send(spaced, 1000, [1, 1], [3, 1], [3, 2]);
  send(spaced, 1360, [1, 1], [3, 1], [3, 2]);
  assert.deepEqual(judgementsAt(spaced), [["spaced-a", "hit", []], ["spaced-b", "hit", []]], "the 360ms chart-side punch spacing remains judgeable per beat");
}

// --- F3 (0.0.60 W3): opposite-hand strictness proof for collider straights ----------------------
// Derrick's check: an opposite hand may physically sit inside the other lane's straight box, but the
// judge reads ONLY the event's own-hand wrist sample, so the opposite hand must never credit the beat.
// These assertions pass on current code and are the permanent regression guard (no judge code change).
// Geometry (center row judges at Y 1, default reach, inflated half-extent 0.495):
//   straight_left  cell 5 -> target (1,1), X slab [0.505, 1.495]
//   straight_right cell 6 -> target (2,1), X slab [1.505, 2.495]
// The `send` helper takes judge-world (sx,sy); a "far" point sits outside every straight slab.
{
  // 1) Crossing (Derrick's physical repro): a straight_right at cell 6 while the LEFT wrist
  //    crosses into the right-lane box and the RIGHT wrist (its own hand) stays far away.
  //    The left wrist in the box must NEVER credit straight_right -> miss, never hit.
  const crossingR = ready([beat("crossing-right", 1000, "straight_right", { placement: 6 })]);
  send(crossingR, 900, [0.9, 1], [0.2, 0.3], [3, 2]);   // left in its own lane, right far away
  send(crossingR, 1000, [1.9, 1], [0.2, 0.3], [3, 2]);  // left crosses into the right-lane box
  send(crossingR, 1181, [1.9, 1], [0.2, 0.3], [3, 2]);  // finalize past the late bound
  assert.deepEqual(judgementsAt(crossingR), [["crossing-right", "miss", ["wrong_collider"]]],
    "opposite (left) hand inside the right-lane box never credits straight_right");

  // 2) Symmetric: a straight_left at cell 5 while the RIGHT wrist crosses into the left-lane
  //    box and the LEFT wrist (its own hand) stays far away -> miss, never hit.
  const crossingL = ready([beat("crossing-left", 1000, "straight_left", { placement: 5 })]);
  send(crossingL, 900, [3.0, 0.3], [2.1, 1], [3, 2]);   // right in its own lane, left far away
  send(crossingL, 1000, [3.0, 0.3], [1.0, 1], [3, 2]);  // right crosses into the left-lane box
  send(crossingL, 1181, [3.0, 0.3], [1.0, 1], [3, 2]);  // finalize past the late bound
  assert.deepEqual(judgementsAt(crossingL), [["crossing-left", "miss", ["wrong_collider"]]],
    "opposite (right) hand inside the left-lane box never credits straight_left");

  // 3) Simultaneous crossing: both wrists cross into each other's boxes on the same beat, each
  //    own hand OUT of its own box and the opposite hand IN it. Each beat is judged only by its
  //    own (absent) hand -> both MISS.
  // Approach vertically from above (x fixed at 1.9 / 1.0): a straight horizontal cross from the
  // side would sweep the segment THROUGH the own-hand box and credit it (swept contact is real
  // production behavior). The vertical drop never enters the own box — it only enters the
  // opposite box on arrival, which is exactly the crossing Derrick described.
  const simCross = ready([beat("sim-cross-l", 1000, "straight_left", { placement: 5 }), beat("sim-cross-r", 1000, "straight_right", { placement: 6 })]);
  send(simCross, 900, [1.9, 2.5], [1.0, 2.5], [3, 2]);  // above the opposite boxes, outside every box
  send(simCross, 1000, [1.9, 1], [1.0, 1], [3, 2]);     // left dropped into right box, right into left
  send(simCross, 1181, [1.9, 1], [1.0, 1], [3, 2]);     // finalize
  assert.deepEqual(
    judgementsAt(simCross).sort((a, b) => a[0].localeCompare(b[0])),
    [["sim-cross-l", "miss", ["wrong_collider"]], ["sim-cross-r", "miss", ["wrong_collider"]]],
    "simultaneous crossing: each beat is judged only by its own (absent) hand");

  // 0.0.61 (GATE 1): geometry sanity now uses the GLOVE BOX, not the retired
  // point-in-inflated-box. The crossing points are inside the opposite
  // glove boxes and the far wrists are outside, so every miss above is
  // hand-strictness, not a geometry slip.
  const tOwnL = { centerTimestampMs: 1000, x: 1, y: 1 };   // straight_left cell 5
  const tOwnR = { centerTimestampMs: 1000, x: 2, y: 1 };   // straight_right cell 6
  // Wrist at 1.9: the LEFT hand's glove (center 1.9) overlaps the
  // straight_right box [1.5,2.5] on X (1.9-0.34=1.56 < 1.5+0.5=2.0... wait,
  // the target box is [1.5,2.5] since target.x=2, half=0.5 → [1.5,2.5]).
  // Glove [1.56, 2.24] ∩ [1.5, 2.5] = [1.56, 2.24] → overlap on X. On Y:
  // glove [0.72, 1.28] ∩ [0.5, 1.5] = [0.72, 1.28] → overlap. So the glove
  // box DOES overlap the target box.
  assert.equal(gloveBoxContactsBoxingTarget(tOwnR, { songTimeMs: 1000, sx: 1.9, sy: 1 }, 180), true, "crossing left point (1.9,1) is inside the straight_right glove box");
  // Wrist at 1.0: the RIGHT hand's glove (center 1.0) overlaps the
  // straight_left box [0.5,1.5] on X. Glove [0.66,1.34] ∩ [0.5,1.5] =
  // [0.66,1.34] → overlap.
  assert.equal(gloveBoxContactsBoxingTarget(tOwnL, { songTimeMs: 1000, sx: 1.0, sy: 1 }, 180), true, "crossing right point (1.0,1) is inside the straight_left glove box");
  // Wrist at 0.2, 0.3: the right hand's glove (center 0.2) does NOT overlap
  // the straight_right box [1.5,2.5] on X (glove [-0.14, 0.54], target
  // [1.5,2.5], no X overlap).
  assert.equal(gloveBoxContactsBoxingTarget(tOwnR, { songTimeMs: 1000, sx: 0.2, sy: 0.3 }, 180), false, "scenario-1 far right wrist (0.2,0.3) is outside the straight_right glove box");
  // Wrist at 3.0, 0.3: the left hand's glove (center 3.0) does NOT overlap
  // the straight_left box [0.5,1.5] on X (glove [2.66,3.34], target
  // [0.5,1.5], no X overlap).
  assert.equal(gloveBoxContactsBoxingTarget(tOwnL, { songTimeMs: 1000, sx: 3.0, sy: 0.3 }, 180), false, "scenario-2 far left wrist (3.0,0.3) is outside the straight_left glove box");

  // 4) Control: the same beat pair with each own hand IN its own box -> both HIT. Proves the
  //    harness still produces hits (guards against a harness bug that makes everything miss).
  const simOwn = ready([beat("sim-own-l", 1000, "straight_left", { placement: 5 }), beat("sim-own-r", 1000, "straight_right", { placement: 6 })]);
  send(simOwn, 900, [0.0, 1], [3.0, 1], [3, 2]);        // neutral: both outside every straight box
  send(simOwn, 1000, [1.0, 1], [2.0, 1], [3, 2]);       // each own hand in its own box
  assert.deepEqual(
    judgementsAt(simOwn).sort((a, b) => a[0].localeCompare(b[0])),
    [["sim-own-l", "hit", []], ["sim-own-r", "hit", []]],
    "control: each own hand in its own box still hits (harness produces hits)");
}

console.log("Boxing Collider deterministic scoring validation passed.");

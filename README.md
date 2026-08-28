# aerobeat-web-gameplay

Browser gameplay-session and mode-rules runtime for AeroBeat Web.

## Responsibility

This package owns deterministic browser gameplay-session state, audio-clock consumption, chart-event dispatch, Flow and Boxing ruleset coordination, input-evidence consumption, judgement diagnostics, score/result aggregation, pause/resume/countdown safety, and local prototype telemetry.

It does not own camera permissions, media capture, pose inference, body-grid calibration, raw input routing, audio playback, content import/conversion, package acquisition, WebGL drawing, UI components, theme tokens, iframe messaging, or product assembly wiring.

This initial repository slice establishes the package boundary and validation foundation only. Gameplay session and ruleset behavior is intentionally deferred to the implementation Bead linked from this repo.

## Public API Surface

- `src/index.js` exports the package marker, gameplay-session service ID, and supported gameplay mode IDs.
- Future runtime factories and JSDoc shapes must be exported through the package root only after their contracts and behavior are implemented and tested.
- No gameplay coordinator, scorer, clock adapter, or ruleset engine is implemented by this scaffold.

## Adjacent Repositories

- `aerobeat-web-contracts` owns shared service IDs, event names, and cross-repo data shapes.
- `aerobeat-web-input` owns calibrated input interpretation and gameplay-facing evidence/events.
- `aerobeat-web-content` owns browser package loading, hashes, variants, and immutable chart snapshots.
- `aerobeat-web-audio` owns playback and authoritative browser audio-clock snapshots.
- `aerobeat-web-renderer` owns durable gameplay rendering.
- `aerobeat-web-ui` owns visible `aero-*` components and screens.
- `aerobeat-web-assembly` creates one gameplay-session service per connected `aero-game` and wires public package surfaces together.

## Allowed Imports

Runtime code may consume declared public exports from `@aerobeat/web-contracts`, `@aerobeat/web-input`, `@aerobeat/web-content`, and `@aerobeat/web-audio`. Do not import sibling `src/`, `internal/`, testbed files, vendor-native objects, DOM component internals, renderer internals, or assembly code.

Gameplay remains DOM-free and renderer-free. It consumes immutable data/evidence snapshots and emits immutable session/judgement/result snapshots. UI renders those snapshots and emits intent; it does not host scoring or session state.

## Testbed Shape

- `.testbed/fixtures/` owns deterministic gameplay inputs, charts, and clock samples.
- `.testbed/test/` owns browser tests when real browser behavior exists.
- `.testbed/scenes/` owns component-composed proving scenes; visible UI must be named `aero-*` Web Components.
- `.testbed/debug-data/` owns representative immutable snapshots.
- `.testbed/demo/` is the local static/demo entry point.

Tests and scenes import this package through generated `.testbed/node_modules/@aerobeat/web-this-repo`:

```bash
npm run testbed:link-self
```

Do not commit installed `node_modules` folders or generated testbed symlinks.

## Development Posture

- JavaScript native ES modules with `// @ts-check` and strict JSDoc.
- No `any`, star-shaped JSDoc escapes, undocumented external values, or sibling private imports.
- Deterministic gameplay tests use explicit clocks and fixtures; wall-clock timing is never judgement authority.
- Browser-visible test paths fail on unexpected console warnings or errors.
- Every visible testbed control/widget/screen is a named `aero-*` component owned by `aerobeat-web-ui`.

## Validation

Run before handoff:

```bash
npm run check
npm test
npm run test:browser
```

The current checks validate the package marker/service surface, strict JSDoc/no-escape posture, public import boundaries, component-only scene posture, deterministic placeholder fixtures, and browser console-noise policy. They do not claim gameplay-domain implementation.

## Documentation Handoff

Keep repo-local accepted decisions under `docs/decisions/`. Public contributor or product documentation belongs in `aerobeat-web-docs` after contracts and behavior are accepted.

# Gameplay Testbed

This hidden testbed owns deterministic gameplay fixtures, clock/session tests, browser tests, component-composed proving scenes, representative debug snapshots, demos, and generated local dependency symlinks.

Create `.testbed/node_modules/@aerobeat/web-this-repo` as a local symlink to `../../../src` with `npm run testbed:link-self`. Add sibling `@aerobeat/web-*` links only for declared public package dependencies.

Visible scenes must use named `aero-*` Web Components. Do not implement gameplay rules, scoring, or session state in testbed UI.

Do not commit installed `node_modules` folders or generated testbed symlinks.

# Fixed-Z Boxing contact oracle

Status: approved gameplay-owner test-only follow-up; verification complete.
Parent: assembly `.plans/2026-10-25-boxing-heights-fixed-colliders-knee-calibration.md`, task B. Contracts `ccf030b70ff4d86e3ff3556618d536eeee59fe46` now resolves fixed-Z glove geometry; renderer `5401f992ac31a5c266bf47b2f87e72df02067229` displays the same fixed Show cylinder.

Goal: update the gameplay-owned collision oracle to expect glove art rotation without scored-cylinder rotation. No gameplay production logic, assembly pins, heights, or calibration changes.

Tasks:
- [x] Replace old X/Y tilted-glove reach assertions with fixed-axis XY edge and front/back cap contact parity across identity, cardinal, and combined wearable orientations.
- [x] Correct the gameplay README's stale rotating-cylinder description.
- [x] Run `node scripts/validate-equipment-pose-collision.js`, `npm test` (unit and public integration), and `npm run test:browser`; all passed. Commit and push only this owner revision.

Previous failure: `node scripts/validate-equipment-pose-collision.js` expected false at the old tilted-world-Z cap test (line 81), but fixed-axis scoring correctly returned true. The gameplay implementation already calls the shared resolver; no runtime code change is required.

The assembly Beads DB is schema v66 and the installed CLI is v53; do not write Beads with incompatible tooling.

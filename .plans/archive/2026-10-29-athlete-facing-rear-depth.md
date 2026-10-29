# Athlete-facing rear depth — gameplay

Status: complete; approved coordination slice implemented. Owner: delegated coder; umbrella Bead aerobeat-web-assembly-qrtp remains parent-owned.
Coordination: ../aerobeat-web-assembly/.plans/2026-10-29-athlete-facing-rear-depth.md
Dependency: contracts union-part helpers land first.

1. Consume shared parts in point/sweep/guard/near/slice paths; preserve timing/direction/consumption.
2. Normalize strict mode-default toggle and distinguish nondefault score identities, preserving default identities. Add normal regressions and update README.
3. Update recorded contract pin after contracts push, run check/unit/integration/browser, commit/push main.

Results: shared parts now drive point, spline, guard, near and slice paths. Strict boolean defaults are Flow false / Boxing true; accepted older record shapes receive mode defaults. Nondefault toggles participate in scoring hashes while default identities are preserved. New normal regressions cover rotated front invariance, rear-only point/sweep contacts, no diagonal bridge, near/slice parity, boolean rejection, hashes and exactly-once coordinator scoring for both modes/toggles. README updated. No knee settings, timing, direction, target-size, assembly or renderer edits.

Dependency pin: contracts a1c1fbc2a51bdc2eb0c63dc3a2b46ae2dd4f2296 (pushed before gameplay).

Validation passed: npm test (check, all normal unit suites, actual public integration), npm run test:browser (Chromium), targeted checkJs TypeScript on changed geometry/settings modules, npm pack --dry-run --json and git diff --check. Final focused geometry suite passed after pin and near/slice regression additions. Initial expected-error/surface assertions were updated for the shared contract owner and added field. Existing Boxing settings type omitted prior volume properties; corrected alongside the new boolean and checked. Installed assembly UI/render/phone acceptance remains parent-owned, not claimed by these source checks. No remaining source blockers.

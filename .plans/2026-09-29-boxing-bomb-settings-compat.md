# Boxing wrist bomb settings compatibility

Status: in progress
Bead: aerobeat-web-gameplay-u7a

## Goal
Accept optional `wristBombColliderScale` in exact Boxing settings for assembly compatibility, bounded 0..2 with effective default 1. Preserve existing Boxing scoring and prior identity at scale 1; bombs remain Flow-only.

## Diagnosis
Assembly now forwards the shared setting into Boxing settings. The strict `createBoxingColliderSettings` key list rejects it before configuring content. Existing Boxing defaults/identity must remain compatible. No prior attempts for this follow-up.

## Tasks
1. Extend Boxing settings validation and identity without changing old identity at scale 1.
2. Add focused schema, identity, coordinator configuration, and range tests.
3. Check changed JavaScript, run npm test, commit locally without pushing or version changes.

## Result
Boxing accepts the optional field and validates the 0..2 bound; omitted and explicit 1 retain the previous exact settings shape/identity, while 0/2 produce distinct identities. Dedicated Boxing scoring script including coordinator configuration passes. Changed JS `node --check`, `npm run test:integration`, and `git diff --check` pass. Full `npm test` remains blocked before reaching Boxing tests at the pre-existing incomplete settings fixture in `scripts/validate-equipment-pose-collision.js:75` (`collider_bounds_input_invalid` from shared contracts). No other repo or version changed.

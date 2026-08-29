# ADR 0002: Experimental prototype profile registry

- Status: Accepted
- Date: 2026-08-29

## Context

Task 11 needs deterministic named prototype settings across renderer visuals, gameplay scoring, and content conversion without implying a production Boxing winner. Settings must round-trip through embeddable public boundaries, preserve score identity, and never suggest that converter tuning has changed an already generated chart.

## Decision

Gameplay exports one per-game `AeroPrototypeProfileRegistry`. Every profile is explicitly experimental and belongs to exactly one ownership class:

- `live_visual` applies immediately;
- `between_run_ruleset` applies only with an explicit idle, paused, or between-run gameplay state;
- `converter_regeneration` changes selection only and remains pending until regenerated package provenance explicitly supplies the selected profile hash.

Profiles are bounded plain-data records. Their bare lowercase `contentHash` is SHA-256 over canonical `{schema,version,profileId,profileVersion,class,settings}`. Canonical JSON sorts record keys by code-point order, normalizes negative zero, and rejects accessors, hidden/symbol keys, sparse or extended arrays, classes, cycles, bytes, media objects, undefined, and non-finite numbers. Bundle exports have the exact `aerobeat/prototype_profile_bundle` v1 shape and a `sha256:`-prefixed canonical bundle hash. Imports validate completely before committing.

The coordinator accepts exact bounded scoring settings with the active `between_run_ruleset` identity. It retains profile and settings catalogs per variant, so paused future swaps cannot reinterpret preserved events. Score partitions expose the complete profile identity and immutable scoring settings and remain local-only. Shadows continue to be diagnostic-only.

## Consequences

Default scoring is backward compatible: one point per hit, no combo bonus, and no miss penalty. Visual settings remain renderer-owned, and converter settings remain authoring-owned. The registry communicates deterministic state and provenance truth but does not mutate either subsystem. No survey, durable preference notes, winner flag, ranked score, or public leaderboard path is introduced.

# Authoritative clock, safety, and evidence ownership

## Status

Accepted for Task 6.

## Decision

Each connected game owns one gameplay coordinator. Wall timestamps order host/input observations and drive the frozen countdown; only the injected audio snapshot establishes song timeline position and judgement timing. Gameplay never synthesizes an advancing clock. It selects the documented clock fields without recursively rejecting the audio package's optional `durationSeconds: undefined`, and validates a complete frame before committing its wall timestamp or domain state.

Initial play and every tracking-loss recovery require calibrated, measured, current input. Tracking loss cancels the countdown, clears current evidence, and latches the invalidated calibration ID until a different ready generation arrives. The resume countdown is `3..2..1` while both audio playback and position remain frozen; drift or rollback fails closed without rewinding gameplay truth. Media lease data is an injected participation check; arbitration stays process-wide in assembly.

Rules consume positive evidence only after the whole rule matches. Evidence is keyed by measured frame and action. Guard/punch consumption records the event category and inclusive window center, so only opposite-category windows that actually overlap are frame-exclusive; obstacle checkpoints remain disjoint and may score beside a punch. Actual content-runtime envelopes retain resolved identity/timing while gameplay reads targets and lineage from `authoredBeat`. Every scoring event emits exactly one hit/miss record; unsupported non-note Flow source events are explicitly ignored. Diagnostic shadows require the same current calibration-matched evidence, use separate bookkeeping, and never mutate live consumption or score.

Scores are local partitions keyed by variant score identity plus the complete tuning profile identity. Boxing composites are unranked and no leaderboard surface exists.

Paused content swaps preserve past, judged, and active truth, including each preserved event's original variant and tuning-profile identity; suppress duplicate source lineage; and replace only bounded future events.

## Consequences

- Audio, input, content, media arbitration, renderer, UI, and iframe transport remain replaceable services.
- Countdown and scoring are deterministic under fake-clock/replay tests.
- Tracking safety cannot be bypassed by stale/predicted evidence.
- Candidate/profile telemetry remains comparable without implying production promotion.
- Public data boundaries reject getters, coercion objects, media/byte payloads, duplicate identities, malformed hash/qualification records, and oversized structures before domain logic runs. Failed content/frame validation is transactional and cannot leave hidden state mutation.

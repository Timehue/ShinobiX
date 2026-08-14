# Ranked Pet Server Authority

Status: implemented for private certification; public gameplay remains disabled by default.

## Rollout gates

The private backend is fail-closed unless this exact positive flag is present:

```text
ENABLE_PET_RANKED_SERVER_V1=1
```

`DISABLE_PET_RANKED_SERVER_V1=1` overrides it as the emergency kill switch.
Misspellings, empty values, and values such as `true` remain disabled.

Private engine certification does not open either public matchmaking surface.
The Pet Ladder queue requires a separate presentation gate:

```text
ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1=1
```

Both that flag and `ENABLE_PET_RANKED_SERVER_V1=1` are required before queue
status reports enabled or join/poll can mutate matchmaking. `leave` remains
available for cleanup while disabled. The current Pet Ladder match presentation
routes to the exhibition socket, not `/api/pet/ranked-start` plus authoritative
result settlement, so keep this flag off outside disposable backend certification.

The legacy live-challenge surface has its own independent promotion gate:

```text
ENABLE_PET_RANKED_PUBLIC_CHALLENGES_V1=1
```

The engine flag plus this challenge flag are required before the API accepts a
`rankedPet` player challenge. The challenge flag does not enable the queue, and
the presentation flag does not enable direct challenges. The client still
intentionally blocks ranked-pet acceptance/routing. Never enable either public
flag merely to exercise the private engine.

## Authority flow

1. Two authenticated players voluntarily enter a server-owned reciprocal pairing. The server ignores body level/Elo and loads both from saves.
2. Matchmaking chooses the opponent and mints one 128-bit reciprocal `matchId`. Both short-lived queue records must agree on opponent, initiator, timestamp, and match ID.
3. `/api/pet/ranked-start` reads that pairing. It does not parse the request body; client opponent, pet, seed, rating, outcome, and reward fields cannot become engine inputs.
4. A shared `pet:battle-active:<player>` NX lease is claimed without expiry for both participants before snapshots. Pet training/equipment, breeding, expedition, Sanctuary, casual battle, and Warfront mutations use the same lease boundary. Ranked never delete-refreshes an unresolved lease; a crash therefore cannot expose an NX gap.
5. The server loads both saves, applies the current carried-pet entitlement, skips breeding/training/expedition-busy pets, and snapshots bounded combat fields. Lapsed overflow pets are not selectable through a body ID.
6. A cryptographic seed is minted on the server. The deterministic pet duel runs with PvP items and accuracy pinned on for both sides.
7. Before either save changes or any bounded token is published, an immutable no-TTL `pet:ranked-journal:<matchId>` seals the pair, seed, selected pet IDs, pre-match ratings, engine version, winner/draw, zero-ryo policy, server-owned rating deltas, and SHA-256 engine digest. Per-player `pet:ranked-recovery:<player>` pointers are also written without expiry. A crash immediately after resolution therefore cannot strand durable leases behind an expiring sole token.
8. Confirmation and completion use append-only journal companion keys, so no TTL refresh deletes the sole authority. The eventual start response exposes identifiers and the seed, but not outcome, rating snapshots, reward, digest, or complete replay snapshots.
9. Both ratings, W/L counters, selected-pet consumable cleanup, the shared bounded receipt, and a dedicated strict-schema `petRankedSettlementStamp` are committed atomically in each save. The stamp is server-owned across generic autosaves and cannot be evicted by unrelated shared-receipt churn. A partial write leaves the journal pending; stamp/receipt inspection identifies which side already committed and a retry applies only the missing side.
10. Only after both save stamps are confirmed is bounded 24-hour completed evidence published, including the compatibility `pet:ranked-token:<matchId>` replay row. Token and lease compaction must return `OK` or exact readback before immutable pending authority is compare-deleted; active rows then receive the bounded acknowledgement window and recovery pointers are compare-deleted. A completed replay reads its sealed rating result and never re-applies an aged-out shared receipt.
11. `/api/pet/battle-result` ignores the client-reported outcome, returns the authoritative outcome, and compare-deletes both active leases. Repeated reports cannot move either rating twice.

## Fault and abuse behavior

| Condition | Result |
| --- | --- |
| Direct opponent, pet, seed, outcome, rating, or reward forgery | Ignored; server pairing/save/sim values win |
| Missing, expired, or one-sided queue record | `409`; no token, lease, or rating mutation |
| Busy or non-entitled roster | `409`; both leases rolled back |
| Either player already in another pet mode | `409`; foreign lease is preserved |
| Second lease write fails | First lease is compare-deleted; no token is minted |
| Immutable journal/recovery write fails before commitment | Exact readback is required; otherwise no save moves and durable active rows remain closed for retry |
| Completed token publication or acknowledgement fails | Completed journal remains authoritative; retry resumes compaction without moving either rating twice |
| First save commits and second save fails | Durable journal and both recovery/active pointers remain; first receipt replays and retry settles only the missing side |
| Original token TTL passes during a partial settlement | Journal retains sealed authority and the initially durable active rows continue blocking every pet mode |
| Journal or save acknowledgement is lost after commit | Stored fingerprint/embedded receipt is read back; no duplicate rating or consumable charge |
| Start response is lost | Same active receipt, seed, and pet IDs are returned; no new seed |
| Client reports the opposite winner | Ignored; server outcome is returned |
| Draw | Zero rating movement; both consumables/receipts still settle exactly once |
| Kill switch, storage outage, or lock contention | Fail closed; no client-side fallback |

## Promotion checklist

The private engine can be certified with only `ENABLE_PET_RANKED_SERVER_V1=1`
in a disposable staging environment by a hermetic harness or operator-seeded
reciprocal pairing; that does not promote the public queue. Keep both public
flags disabled until all of the following are captured:

- Two disposable accounts with an operator-seeded reciprocal pairing exercise the private start and settlement endpoints, receive the same match ID, and confirm the server outcome without a client-owned result fallback.
- Base, active Supporter, and lapsed Supporter rosters select only their entitled carried pets.
- Training, breeding, expedition, equipment, Sanctuary, casual, and Warfront attempts are rejected while an unresolved ranked journal owns the durable lease.
- Refresh before start response, refresh during replay, duplicate result, opposite reported outcome, and both-client simultaneous result all replay once.
- A forced failure before each active write, token write, journal write, recovery-index write, first save write, second save write, compaction write, and response acknowledgement recovers as documented.
- Restart with an outstanding or partially settled journal resumes the same match and seed after more than 15 minutes.
- Receipts, match ID, engine version, digest, authoritative outcome, and both rating deltas are searchable in staging logs/admin tooling without exposing full pet snapshots publicly.
- Before `ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1=1`, the client must consume either (a) sealed replay-safe pet snapshots including both authoritative loadouts, with private ratings/outcome omitted, or (b) a server event stream whose replay is verified against the sealed engine digest. IDs plus the ordinary roster DTO are insufficient because the public opponent projection strips loadout data while the private simulation applies items.
- The public client must route the match through `/api/pet/ranked-start` and `/api/pet/battle-result`, with no exhibition-socket, local Elo, or local-result fallback.

If any item fails, set `DISABLE_PET_RANKED_SERVER_V1=1`, preserve journals,
tokens, and settlement receipts for investigation, and do not repair ratings
through client saves.

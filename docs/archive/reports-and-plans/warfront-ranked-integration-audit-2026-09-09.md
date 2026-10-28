# Ranked Warfront integration audit

The application mounts `api/pet-ladder/ladder.ts` at `/api/pet-ladder` through `server-api-routes.ts`. The historical `tactical` storage key now scores Beastbound Warfront Rite; existing rankings and sealed defenses retain their keys. Authenticated identity controls GET and POST ownership. Ranked snapshots come from eligible carried pets in the owner's save; posted combat stats, seed and outcome do not control the result.

The authenticated handler regression uses the isolated in-memory KV backend and JSON serialization at the response boundary. It covers defense save, legacy default formation, opponent offer, server scoring, replay verdict, human win and loss records, AI induction, quota, rematch exclusion, offline notifications, stale-client rejection, malformed rosters and contended writes. A separate cross-build test compares the client Rite replay with the server's sealed result and verifies model identity for renamed instance pets, evolution and palette variants.

The audit corrected commit-time rank/rematch eligibility races that previously returned a successful replay without recording the fight, daily-cap races that consumed an eleventh charge, unlocked defense-summary writes under contention, and notification failures that hid a committed result. Ranking storage no longer truncates at 1,000 players. GET returns the viewer's own record separately from the bounded public list.

Ranked AI pets now have canonical starter model identities and modest equipped moves. Snapshots preserve bounded `templateId`, `evolutionStage` and `paletteVariantId`, as well as trained stats and combat subroles. Legacy snapshots recover only missing presentation fields from their matching currently owned instance before scoring and replay; explicit snapshot identity, sealed combat data and stored defenses remain intact. Replays retain the effective role stored on legacy team slots.

Verification command:

```text
node --import tsx --test api/pet-ladder/ladder.integration.test.ts api/pet-ladder/_core.test.ts scripts/warfront-ladder-parity.test.ts
```

## Storage limitation

The shared KV adapter provides atomic single-key writes and locks, but no multi-key transaction. Daily quota increments before the standings write. A backing-store failure at that write can consume one daily attempt without a recorded result; an ambiguous transport failure after the backing store accepted the write can also leave the client uncertain. Lock contention, stale eligibility and pre-resolution validation failures do not consume an attempt. Optional rematch-marker or notification write failures after a committed standing are logged while the committed replay is returned. Exactly-once settlement across process crashes and uncertain KV responses requires a durable attempt/commit record or a multi-key transactional storage change; this audit does not claim that guarantee.

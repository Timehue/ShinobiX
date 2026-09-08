# Persistent world position: first MMO foundation slice

## Authority and behavior

`currentSector`, `currentTile`, `pendingTravel`, and `worldTravelReceipt` are
server-owned at the generic save boundary. Existing stored sectors are retained;
new saves without a position use the existing sector-40 spawn. Client conflict
recovery does not offer to overwrite these fields.

The server travel lease is the arrival authority. Map travel keeps its existing
three-second mask; road crossing keeps its existing instant timing. Town entry
remains convenient, but now persists through the same lease and versioned-save
path. An active journey or world duel blocks town entry. Infrastructure errors
while checking engagement cannot establish permission to leave.

New leases have no TTL. Settlement co-writes position and a receipt in the
versioned player save, then compare-deletes that exact lease. Retrying after a
cleanup failure does not publish another save version. Footfall remains cosmetic,
best-effort telemetry, not a durable progression ledger.

Owner save reads settle matured server leases and project active ones for the
loading UI. Legacy client-authored `pendingTravel` masks are cleared without
moving the character. Admin/foreign inspection does not settle another player's
lease. HTTP and socket cold ingress read stored position; a boot roster snapshot
is display-only until rehydrated and cannot authorize actions or sleeper camps.
Cold ingress discards snapshots superseded by a concurrent presence update.
Restored loading masks use remaining duration on the browser clock and expire
even without the original map callback, allowing heartbeat reconciliation.
Current clients send explicit town-navigation intent, so a world-map sector-0
report cannot turn a delayed outbound arrival into a return to town. Legacy
clients without that field keep their existing behavior and should upgrade with
the coordinated server/client release. Arrival coordinates reject stale tiles
from the departure sector. Client recovery updates the selected map, tile,
biome, weather, and roster together. Unmounted maps retire their travel callbacks
without cancelling the durable journey. An active journey overrides a stale town
bookmark during login, and owner reads recheck arrivals that mature mid-read.
Heartbeat refreshes that overlap an in-flight request coalesce into one latest
callback when it finishes, so retiring a countdown-era response does not delay
arrival recovery until the next village polling interval.

Main's walked-tile checkpoint is preserved: owner reads and both HTTP/socket
cold reconnects resume at the last recorded step within the saved sector. A new
arrival refreshes that checkpoint; retrying its cleanup never overwrites walking
after the arrival committed. Walking remains client-reported and throttled, with
the existing 24-hour checkpoint lifetime and durable arrival tile as fallback.

Expired boot rows still emit departures. Camp creation reloads their durable
position and combat evidence; town arrivals cannot create attackable camps.
Sleeper KO checks the arrival receipt under the save lock, preventing an
unfinished travel settlement from later undoing hospitalization.
Academy trace actions settle matured arrivals before checking the saved sector;
ceremony completion reconciles live presence and a replay never relocates again.

## Recovery and rollout

No SQL schema migration or character wipe is required. Drain old server processes
before cutover so legacy autosave and expiring-lease writers cannot run alongside
the new authority. Deploy server and client together.

Existing leases retain their original TTL until rewritten. The migration utility
prepares them without moving players:

```sh
node --import tsx scripts/travel-lease-retention.mjs
node --import tsx scripts/travel-lease-retention.mjs --apply
```

The first command only reports counts. The second removes TTLs using exact CAS,
preserving values and skipping concurrent changes. It is safe to repeat. Invalid
rows are left untouched and cause a nonzero exit; review them rather than invent
a destination. Already-expired records cannot be reconstructed from a client
loading mask. The migration was not run against production during development.

Retain player saves and outstanding leases together in backups. Rollback must
preserve the new ownership boundary and non-expiring leases; reverting to the old
writer would reopen client position authority. Disable new travel admissions for
an incident while leaving owner-read settlement/reconnect recovery available.

## Verification and remaining scope

`api/player/world-position.integration.test.ts` exercises forged saves and legacy
masks, owner-read recovery, long offline journeys, cleanup failure, restart
snapshots, town persistence, failed settlement, and stale arrival heartbeats.
It also covers delayed HTTP and real Socket.IO hydration, offline camp recovery,
KO replay, and Academy travel integration. `player-accounts-travel.test.ts`
checks restored mask durations against browser clock drift and local expiry.
`e2e/world-position-recovery.spec.ts` checks the built client with deterministic
API responses: a town-bookmarked outbound traveler resumes the map, sees the
destination tile, and publishes matching sector/biome state. Travel-presentation
tests retire responses and timers when the map/account changes. These checks do
not replace sustained production-load or multiple-server failover testing.
The existing travel, ownership, elapsed-state, and conflict-recovery suites cover
compatibility behavior.

Final local verification on 2026-09-07: the complete regression suite passed
9,584 tests with seven skipped and no failures or cancellations. The production
client build and server TypeScript check passed. All four Chromium desktop/mobile
travel and recovery browser checks passed against the final built client.

Release integration with main at `652ff05a4` also passed: 9,615 tests, seven
skipped, no failures or cancellations; the complete root release build including
distribution and size checks; 90/90 isolated fresh-account release-certification
checks; and all four desktop/mobile travel browser checks on the merged build.

This slice does not implement authoritative per-tile walking, atomic admission
across every combat mode, horizontal runtime scaling, parties, item escrow, a
complete progression ledger, or the world director. Within-sector tile updates
remain live presentation inputs, and live presence remains single-process.
The existing KV lease/save boundary is not a multi-row database transaction.

For later phases, account for PostgreSQL transaction retries and Socket.IO
recovery support separately from broadcast fanout:

- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
- [Socket.IO Redis adapter capabilities](https://github.com/socketio/socket.io-redis-adapter)
- [Socket.IO Redis Streams adapter](https://github.com/socketio/socket.io-redis-streams-adapter)

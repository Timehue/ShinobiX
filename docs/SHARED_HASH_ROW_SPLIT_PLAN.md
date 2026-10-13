# Shared hash row split — plan v3 (2026-10-13)

## Status and owner decisions (2026-10-13)

| # | Decision | Owner's answer | What happens |
|---|---|---|---|
| 1 | Avatar rule | "Do what is best, but players will always be able to choose one if they purchase the subscription." | Deploy 2 changes only where avatar bytes are written; who may choose what is unchanged. Deploy 3 (below) stores the two starter presets as references and enforces the subscriber perk on the server. |
| 2 | Freeze the old rows, list ids by key scan | Asked about the impact (§4.1). | Built in Deploy 2, after the dry-run review. |
| 3 | Two deploys | Yes. | Deploy 1 = read-only audit + era receipts. Deploy 2 = the image switch. |
| 4 | Kill switch | Yes. | Ships with Deploy 2. |
| 5 | Era receipts | "Do what is best"; `ENABLE_LEGACY=1` is set. | Option B, built in Deploy 1. |
| 6 | Phase 3 (drop the frozen rows) | "Do what is best for the game and players." | Do it after 7 clean days of Deploy 2, with a backup first, one row per call (§3.5). |

**Deploy 1 (built, branch `claude/image-store-dry-run`).** It contains:
- `POST /api/admin/image-store?cat=<category>`, the read-only audit (`api/_image-store.ts`, `api/admin/image-store.ts`);
- era receipt rows plus counter shards (`api/_era.ts`).

**Deploy 2 waits for two things:** the dry-run review, and PR #364, which another session has open on `api/images.ts`.

**Running the dry run.** Run one category per call, smallest first: `landmark`, `ai`, `misc`, `event`, `item`, `shrine`, `leader`, `card`, `avatar`, `bloodline`, `jutsu`, `pet`. Send the header `x-admin-password`. After each call, check `temp_blks_written` for that call in pg_stat_statements before starting the next one.

The rest of this document is plan v2, unchanged except where marked.

## What changed from v1, after a second check

1. **v1 broke a standing owner rule without flagging it.** The rule dates from 2026-06-04:
   "Don't touch avatars: leave the avatar write/read path alone without a fresh explicit
   request." v1 changed the avatar write path. v2 still does, because that is the fix, so it
   needs an explicit yes (§4, decision 1).
2. **v1's new index row had a bug, and v2 drops the row.**
   - The bug: the manifest read (`hkeys` with `nonEmptyStrings`) keeps only string values.
     v1's index stored numbers, so every id would have vanished from the manifest.
   - The design was also heavier than it needed to be: a seed step, a sentinel field, a
     lock, and two non-atomic writes per upload.
   - **v2 creates no new rows.** A category's ids are listed by a key-prefix scan of the
     per-image keys (`shared:img:<prefix>:*`). On production that scan is a range scan of
     the key index (`kv_store_key_pattern_idx`, text_pattern_ops) that never reads image
     bytes, as `EXPLAIN` confirms.
3. **v1 was wrong about who uses the full-content mode.** Players never load the full
   content: the client loads `misc` and `leader` through no path at all. Only admin tools
   and scripts use full content (AdminPanel item/jutsu/pet/ai/landmark/shrine,
   `gen-pet-battle-sprites`).
4. **v1 missed the avatar cache churn.** Every avatar upload bumps `shared:imgver:avatar`.
   That changes every avatar URL for every client, so every player re-downloads every avatar
   they see, and it also throws away the manifest memo. v2 bumps only when bytes behind an
   existing id change (a replace or a delete).
5. **v1 missed `audit:content`.** Every upload also rewrites this one row under a lock. It
   is bounded (13.8 KB today, capped at 5,000 entries, about 0.5–1 MB at the cap), so it is
   out of scope, but noted in §7.
6. **Orphans.** Some per-image keys are in no manifest: bloodline has 45 keys against 41
   hash fields. A key-scan manifest would make them visible again, and some could be
   images an admin deleted. So the read-only dry-run tool now ships and runs **before** the
   switch, which means two deploys instead of one (§3.5).
7. **Smaller corrections.**
   - `img.ts`'s bulk copy is dormant today, because every id already has its key.
   - The dry run moves about 150–200 MB, not 330 MB.
   - Era Option B costs "a few KB" of WAL per write, not "under 1 KB".

## 0. A note on how the numbers were gathered

The row sizes come from `pg_column_size(value)`. That function reads only the TOAST
pointer, so it costs nothing.

A coverage check I ran in the "same shape" as the app's manifest query **was not light**.
PG17 fed a `string_agg(DISTINCT …)` through a Sort, and every Sort row carried the whole
detoasted hash value. Five statements wrote **10.9 GB of temp files**. The pet check was
cancelled at the 2-minute `statement_timeout` while still spilling: it was heading for
about 5 GB, with about 4.9 GB of disk free.

The Postgres logs show no disk error, and nothing else failed. The lesson is saved in
memory. From here on, coverage checks go only through the dry-run tool (§3.6), which uses the
app's own kv calls.

## 1. Why now

Every write of a jsonb row rewrites the whole row, its TOAST and its WAL. `kv_hset` and
`kv_hdel` were about 14% of database time on 2026-10-12. #349 and #359 removed the writes
that changed nothing; what remains are real writes to rows that are too big.

- **Avatar is the urgent row.** Every new character publishes `avatar:<name>`
  (`features/character-creator/starterAvatarPublish.ts`). For a starter avatar, that is a
  re-encoded copy of a preset file, compacted to at most 512 px and 200 KB. Each upload
  rewrites the whole `shared:imgfields:avatar` row, which is 9.0 MB today and grows about
  66 KB per player. Total WAL therefore grows with the square of sign-ups:
  - the next 200 sign-ups ≈ 3 GB of WAL;
  - the next 1,000 ≈ 42 GB;
  - at 1,000 players, each sign-up rewrites about 66 MB.

  On top of that, every sign-up leaves dead TOAST and bumps the avatar cache version.
- **Bloodline Maker.** One save publishes the bloodline image and then each jutsu icon as
  separate POSTs. Each changed image rewrites the whole bloodline row (11.6 MB) or jutsu
  row (11.9 MB): about 70 MB of WAL for a bloodline with five new icons.
- **Manifests are slow as well.** The manifest query (`hkeys`) averages 917 ms and peaked
  at 32 s over 1,832 calls, because it detoasts the multi-MB row.

## 2. What production holds today (read-only, 2026-10-13 ~01:20Z)

**Database.** 2.05 GB in total, of which `kv_store` is 2.02 GB and its TOAST 1.99 GB.

**WAL settings.**
- `max_wal_size` 4 GB, `min_wal_size` 1 GB, `checkpoint_timeout` 5 min;
- `wal_compression` zstd, `full_page_writes` on, TOAST compression pglz;
- no replication slots;
- 18.1 GB of WAL written since 2026-09-19, about 780 MB a day.

**Estimated free disk** ≈ 8 − 2.05 − ~1.0 (WAL) − 0.17 (system) ≈ **4.8 GB**. If WAL sits at
`max_wal_size`, it is ≈ 1.8 GB. Confirm on the dashboard before any write step.

| Row | Stored | Fields | Non-empty ids with no `shared:img:<id>` | Last write |
|---|---:|---:|---|---|
| `shared:imgfields:pet` | 16.00 MB | ? | not checked (timed out); bytes match¹ | 07-17 |
| `shared:imgfields:jutsu` | 11.92 MB | 123 | 0 | 09-29 |
| `shared:imgfields:bloodline` | 11.57 MB | 41 | 0 | 09-29 |
| `shared:imgfields:avatar` | 9.03 MB | 137 | 0 | **10-12 23:15** |
| `shared:imgfields:card` | 5.14 MB | 115 | 0 | 07-24 |
| `shared:imgfields:shrine` | 2.25 MB | 107 | 0 | 07-17 |
| `shared:imgfields:item` | 1.10 MB | 49 | 0 | 07-17 |
| `shared:imgfields:event` | 1.09 MB | 17 | 0 (2 are empty tombstones) | 09-19 |
| `shared:imgfields:misc` | 0.50 MB | 23 | 1: `petbody:deploy-probe`² | 07-17 |
| `shared:imgfields:ai` | 0.48 MB | 16 | 0 | 07-17 |
| `shared:imgfields:landmark` | 0.03 MB | 1 | 0 | 07-17 |
| **11 hash rows** | **59.1 MB** | | | |
| `shared:images:<cat>` legacy blobs (7) | 14.1 MB | 361 | 0 | all 07-17 |
| `shared:images` monolith | 10.5 MB | — | no code reads it | 07-17 |
| `shared:img:<id>` per-image keys | 71.4 MB | 1,171 rows | — | 10-12 |
| `audit:content` | 13.8 KB | ≤ 5,000 entries | rewritten on every upload | 10-12 |
| `player:registry` | 10.4 KB | — | — | 10-13 |

¹ The pet hash plus the pet blob (17.29 MB) equals the `pet:` plus `petbody:` per-image keys
(17.26 MB).
² `misc` also holds `leader:*` portraits and stray `landmark:`, `shrine:` and `petbody:` ids
from before those prefixes existed.

**Conclusion.** Every id in the hashes already has its own `shared:img:<id>` key. That is the
result of the dual write and `img.ts`'s lazy copy. No backfill is needed: the job is to stop
writing the big rows.

**Possible orphans.** These are per-image keys in no manifest:
- bloodline: at least 4 (45 keys against 41 fields; there is no bloodline blob);
- avatar: maybe 1 (138 keys against 137 hash fields plus 3 blob fields).

These are most likely images lost to the old parallel-publish race that the `images.ts`
comment describes, but some could be deleted images whose per-image key survived. The dry
run lists them by id.

**Era receipts.** `era:contrib-receipts:*` has **zero rows**. *(Corrected in v3: v2 read
the stale `era:contrib:*` counters as a sign that Legacy was off. It is on: the owner
confirmed `ENABLE_LEGACY=1`, and `era:contrib-idempotent:missions` was written on 10-12.
The receipt-backed metrics simply have no receipts in the one-row hash yet.)*

## 3. Part 1 — image hashes

### 3.1 Design

- **Bytes** live only in `shared:img:<id>`, one row per image. An upload writes nothing else
  that holds image bytes.
- **The id list** (manifest) comes from a key-prefix scan of the category's prefixes:
  - single prefix: `avatar`, `jutsu`, `item`, `card`, `ai`, `shrine`, `landmark`,
    `bloodline`, `leader`;
  - `pet` covers `pet`, `petbody`, `petsheet` and `petlayers`;
  - `event` covers `event` and `vn`;
  - `misc` (admin-only) is a scan of `shared:img:*` filtered to unknown prefixes.

  This is unioned with the frozen legacy rows' keys (§3.3) until Phase 3.
- **The old rows** (`shared:imgfields:<cat>`, `shared:images:<cat>`) are **frozen**:
  - no upload writes them;
  - a delete still removes an id from them (the `kv_hdel` guard makes that free when the
    id is absent);
  - they stay as a read fallback until Phase 3 drops them.
- **The cache version** (`shared:imgver:<cat>`) bumps only when bytes behind an existing id
  change: on a replace or a delete. A first upload of a new id does not bump it, because no
  client can hold a cached URL for an id that did not exist.
- **No new storage rows.**

### 3.2 Who writes what

| Action | Today | After |
|---|---|---|
| Upload | `hset` the whole category row; `set` `shared:img:<id>` best-effort; always bump | `set` `shared:img:<id>` with `nx`. If that succeeds, the id is new and no bump happens. If the key exists, a plain `set` plus a bump. **A failure fails the upload** (same message as today). |
| Delete (single or batch) | `hdel` the row; rewrite the blob if present; `del` the per-image key best-effort; bump | storage object first; `hdel` the legacy row (guarded); blob only if present; then `del` the per-image key, **awaited, and the request fails if it fails** (it is now what makes the image disappear); bump |
| Server-reset leader reseed | `hset shared:imgfields:misc` only (so `/api/img`, which reads the per-image key first, never saw a changed portrait) | `set` `shared:img:leader:*`; bump `leader` |
| `GET /api/img` | per-image key first; on a miss it reads the legacy rows **and writes** copies, including a once-per-process bulk copy | per-image key first; on a miss it reads the legacy rows **read-only**. Coverage is already complete, so the copy is unnecessary, and dropping it removes the race in which a copy could resurrect a just-deleted image. |

### 3.3 Who reads what

- **Manifest** (`?ids=1`): the key scan, unioned with the legacy rows' non-empty keys.
  - The legacy keys come from the existing `hkeys` query, memoised per (category, version)
    for 1 h.
  - The legacy rows are frozen, so they change only on a delete, and a delete bumps the
    version.
  - The 9–16 MB rows are therefore read about once an hour per category instead of after
    every upload. The key scan itself is memoised for 60 s, as today.
- **Full-content mode** (admin and scripts only): the manifest ids, then `mget` of the
  per-image keys in chunks of 25. A miss falls back to the legacy value. The response shape
  is unchanged.
- **`/api/img`:** as in the table above.
- **`bloodlines/list.ts` and `admin/players.ts`:** `mget` of `shared:img:bloodline:<id>` for
  the bloodlines they list, with the legacy row read only if one is missing. Today they read
  the whole 11.6 MB row on every 60 s cache miss.

### 3.4 Files

- **`api/images.ts`:** upload, delete, manifest and full-content as above. Avatar validation
  (`avatarImageReject`) and every error message stay byte-identical.
- **`api/img.ts`:** read-only fallback.
- **`api/_image-version.ts`:** unchanged; only its callers change.
- **`api/bloodlines/list.ts`, `api/admin/players.ts`:** per-image reads.
- **`api/admin/server-reset.ts`:** leader reseed.
- **`api/admin/image-store.ts`** (new; full admin only; registered in
  `server-api-routes.ts`). It works on one category per call, with two modes:
  - `dry-run`, the default, which writes nothing (shipped in Deploy 1);
  - `write-back`, the rollback (§3.8), added in Deploy 2. Deploy 1 refuses any mode
    except `dry-run`.
- **Kill switch `IMAGE_LEGACY_HASH_WRITE=1`:** off by default. Setting it restores today's
  `hset` into the legacy row. It is a rollback lever only, never a rollout step.
- **No client changes.**

### 3.5 Phases

1. **Deploy 1: the read-only dry-run tool, plus the era receipt change (§5).** The image
   tool cannot change behaviour. The era change alters only how receipt-backed era
   contributions are stored; players see the same totals.
2. **Run the dry run on production**, one category per call, off-peak (§3.6). Review the
   report with the owner, especially the orphans. For each orphan the owner chooses to keep
   it (a lost image comes back) or to delete it. Deletion uses the existing batch
   `DELETE /api/images {ids}`; for an id that is not in the legacy rows, that is a guarded
   no-op on the big row plus a tiny row delete.
3. **Deploy 2: the switch.** Uploads stop writing the big rows, and manifests become key
   scan ∪ frozen legacy keys. No migration writes are needed.
4. **Phase 3: drop the frozen rows.** This is not part of this approval. It needs a
   separate PR and sign-off after at least 7 days. It `del`s one row per call, 5 minutes
   apart, and only for a category whose dry run shows 0 missing ids and 0 differing bytes.
   After it, manifests are the key scan alone, and `/api/img` misses are a plain 404.

### 3.6 Dry-run procedure

1. **Local rehearsal:** `node dist/server.js` with `NODE_ENV=test SHINOBIX_QA_MEMORY_KV=1`.
   The fixtures cover tombstones, blob-only ids, `leader:*` in `misc`, an orphan, a legacy
   id replaced after the switch, and a missing per-image key. Run the dry run, Deploy-2
   behaviour and the write-back. Every manifest, `/api/img` body and full-content body must
   match the expectations written down in the tests.
2. **pg-integration on postgres:16.** Judge writes by `ctid`/`xmin`, never by
   `dataWrites()`. The tests prove that:
   - an upload leaves the big row's `ctid` unchanged;
   - the dry run writes nothing;
   - a delete of a legacy id removes it from every place;
   - the key-scan query CAN be an index range scan, with no Sort, Agg or Hash above a jsonb
     value. Assert this from `EXPLAIN` under `SET LOCAL enable_seqscan = off`: on CI's tiny
     table the planner would rightly prefer a sequential scan, so a bare plan assertion
     would be wrong there. Production's plan was checked separately (§2).
3. **Production dry run** through the admin endpoint:
   - **Reads:** per category, one `hgetall` of the legacy hash and one `get` of the blob
     (today's full-content GET does the same), the key scan, and `mget` of the per-image
     keys, 25 at a time. That is about 150–200 MB through the pool in total, run
     sequentially with a pause between categories.
   - **Comparison:** bytes are compared by sha256 **in Node**, so Postgres does no sorting
     or aggregation.
   - **Report, per category:**
     - today's manifest, the key-scan manifest, and their difference (the orphans, by id);
     - legacy ids with no per-image key;
     - ids whose legacy and per-image bytes differ;
     - tombstones;
     - for avatars, how many are byte-identical copies of the same image (a rough count of
       starter presets; browsers re-encode differently, so it undercounts).
   - It **never** calls `GET /api/img`.
   - After each call, read that statement's `temp_blks_written` in pg_stat_statements
     before making the next call.

### 3.7 WAL and disk budget (8 GB cap)

**Gates.** Before every write step, the dashboard must show at least 2.5 GB free. Each step
is measured as the `pg_stat_wal.wal_bytes` delta. Abort if a step uses more than twice its
budget, or if any tool statement writes temp.

| Step | Writes | WAL budget |
|---|---|---|
| Deploy 1 + dry run | none (reads ~150–200 MB) | 0; temp must stay 0 |
| Orphan deletes, if chosen | tiny per-image rows (a guarded no-op on the big rows) | < 5 MB |
| Deploy 2 | none | 0 |
| **Avatar sign-up, ongoing** | today: the whole avatar row (9 MB, growing) + per-image + version + meta + audit | **9–18 MB → ≈ 0.1 MB**, flat in player count |
| Bloodline Maker save (5 icons) | today: 5 rewrites of 11.6–11.9 MB rows | ≈ 70 MB → the icons' own bytes |
| Rollback write-back | one `hset` per touched category | ≤ 59 MB + the new image bytes |
| Phase 3 drop (later) | `del` of 19 rows (83.7 MB stored) | ≤ ~170 MB in total, ≤ ~32 MB per step |

A drop does not shrink files; the space becomes reusable after autovacuum. **Never run
VACUUM FULL**: it copies the 2 GB table.

### 3.8 Rollback

- **Deploy 2:** set `IMAGE_LEGACY_HASH_WRITE=1` (a restart), then run `write-back` per
  category.
  - It finds ids uploaded since the switch: ids in the key scan but not in the legacy row,
    plus legacy ids whose per-image bytes now differ.
  - It `hset`s them into the legacy row in **one** batched write per category.
  - A full code revert is safe only after the write-back.
- **Deploy 1:** the image tool is read-only, so it needs nothing. The era part needs one
  step before a revert:
  - Old code sums only the one-row receipt hash, so after a plain revert, receipts recorded
    since the deploy would vanish from the era totals.
  - Before reverting, MOVE each receipt-backed metric's shard total into its old hash: in
    one transaction, write it as one field (for example `{"rollback:2026-10-13": <sum>}`)
    and delete that metric's 16 shard rows. That is three small transactions.
  - Move, not copy: if Deploy 1 is applied again later, the new code reads both the old hash
    and the shards, so a copied total would count twice. The receipt rows stay, so retries
    still find them after a re-apply.
  - A settlement retried after the revert could then count once more, because old code
    cannot see the receipt rows. Retries are rare and the error is one count, so this is
    accepted.
- **Phase 3:** irreversible. It needs a separate sign-off and a backup first.

## 4. The avatar issue, specifically

There are three separate problems, and Deploy 2 fixes all three without touching the client
or the upload's validation and messages:

1. **Write amplification.** This is the O(n²) problem in §1. Sign-up writes become one
   per-image row (about 66 KB on average) plus small rows. Nothing shared and growing is
   rewritten.
2. **Cache churn.** Today every sign-up bumps the avatar version, so all avatar URLs change
   for every client, which re-downloads every avatar on screen. After the change a new
   player's avatar does not bump the version; only a replace or a delete does.
3. **Manifest read.** The avatar manifest is read at every login. It becomes an index range
   scan instead of a detoast of a 9 MB row, which averages 917 ms today.

**Deploy 3 (decided 2026-10-13; a small, separate PR after Deploy 2).**
- **Presets become references.** There are exactly two presets,
  `/starter-avatar-one.webp` and `/starter-avatar-two.webp`. Today every new character
  stores its own re-encoded copy of one of them (up to 200 KB) as `avatar:<name>`, so that
  other players can find it by name.
  - Instead, `avatar:<name>` stores the preset path itself, about 30 bytes.
  - `/api/img` today redirects only stored `http(s)://` links. A relative preset path
    would get a 415, so Deploy 3 extends the redirect to exactly the two preset paths
    (the `PRESET_AVATARS` allowlist in `api/_entitlements.ts`) and sends viewers to the
    static file.
  - That file ships with the game and is cached once for every player who uses it.
  - Result: near-zero storage per free player, and their avatars load faster everywhere.
- **The subscriber perk is enforced on the server.** Custom avatars are a subscriber perk
  (`canCustomAvatar`), but today only the save field enforces it.
  - `POST /api/images` checks only that `avatar:<name>` is the player's own name, so a
    non-subscriber can push a custom picture through the API, and every other player sees
    it.
  - Deploy 3 accepts custom avatar bytes only from a subscriber. Everyone else may store
    only a preset reference.
- **Subscribers keep custom uploads exactly as they are today,** per the owner's condition.
- **Existing avatars are left alone.** The dry run counts how many are preset copies (its
  duplicate groups), which shows how much a later conversion would save.
- **Changes:**
  - client: `starterAvatarPublish.ts` sends the preset path instead of the re-encoded copy;
  - server: `POST /api/images` accepts a preset path for `avatar:<own name>` and requires a
    subscription for custom bytes;
  - server: `/api/img` redirects the two preset paths.

**Later, not planned:** every login fetches every player's avatar id, which is O(players)
per login. That is fine up to several thousand players; a per-name lookup is the later fix.

### 4.1 What decision 2 changes (owner question: "does that have a big impact on anything?")

- **Players:** nothing visible. The images, URLs and loading are the same. The one
  exception is the orphan images listed by the dry run, such as bloodline pictures lost to
  the old publish race. Each one either comes back or is deleted properly, and the owner
  chooses which before Deploy 2.
- **Database:**
  - a sign-up avatar writes about 0.1 MB instead of 9–18 MB, which grows with every player;
  - a Bloodline Maker save writes only its own icons instead of about 70 MB;
  - the avatar list read at every login becomes an index scan instead of a 917 ms average;
  - much less WAL and dead space accumulate on the 8 GB disk.
- **Admin tools:** the same responses.
- **Risk:** small and reversible. The old rows stay untouched as a fallback. The kill switch
  plus the write-back restores the old behaviour without losing a new upload.
- **Cost:** images stay stored twice (about 84 MB, as today) until Phase 3.

## 5. Part 2 — `era:contrib-receipts:<metric>`

**Decided: Option B, built in Deploy 1.** The owner confirmed `ENABLE_LEGACY=1`.
Production shows Legacy live (`era:contrib-idempotent:missions` was written on 10-12). The
one-row receipt hashes of the three receipt-backed metrics hold no rows yet, so the switch
happens with nothing to migrate. The receipt TTL is 30 days.
The old hash is still read for its total, and an id it already holds is never counted
twice.

Nothing exists to migrate, and the reset wipes `era:*`. A fallback read of the old key is
enough. Buckets alone only delay the problem. At an example rate of 1,000 players × 20
receipts a day, with 64 buckets, each bucket is about 660 KB by day 30, which means about
13 GB of WAL a day.

- **Option B (recommended): receipt rows plus sharded counters.** One transaction through
  the existing `kv.compareSetMany`:
  - `cas` `era:receipt:<metric>:<id>` (expected absent, value n, with a TTL via `ex`);
  - `cas` `era:contrib-sum:<metric>:<shard>` (16 shards chosen by a hash of the id).

  A retry finds the receipt and reports success, which keeps today's exactly-once guarantee
  with no crash window. Each write is a few KB of WAL at most, and it does not grow. Reading
  is `mget` of the old key plus 16 shards per metric. It needs no SQL schema change. The
  expired-row purge covers the receipt rows: production's pg_cron job `kv-cleanup` runs
  `kv_delete_expired()` every 2 minutes (checked 2026-10-13).
- **Option A:** 32–64 bucket hash keys. This is simpler, but it grows as shown above.
- **Option C:** defer until Legacy is switched on.

## 6. Tests and gates before each merge

- **Unit tests** (memory store):
  - an upload writes only `shared:img:<id>` plus metadata, never `shared:imgfields:*` or
    `shared:images:*`;
  - a first upload does not bump the version, while a replace and a delete do;
  - a failed per-image write fails the request;
  - the manifest equals today's for orphan-free fixtures, and an orphan fixture shows up as
    documented;
  - a deleted id disappears from every reader;
  - `img.ts` never writes;
  - the bloodline list and admin players read per-image keys;
  - the leader reseed writes per-image keys that survive the reset;
  - avatar validation and messages are byte-identical.
- **A ratchet:** only the kill switch and `write-back` may write `shared:imgfields:`.
- **pg-integration:** as in §3.6.
- **Full checks:** root `npm test`, plus `npm run build` for the size gates. There are no
  client changes, so the e2e gate does not apply.

## 7. Out of scope

- **`audit:content`:** one row of up to 5,000 entries, rewritten under a lock on every
  upload. Other audit domains already use one row per entry.
- **`player:registry` as per-player keys.**
- **The `clan-boss/_party.ts` sweep's `hdel` loop.**
- **The bloodline gallery's inline data URLs.** It returns up to ~11.6 MB of base64 per
  request; switching to URLs is a client change.

## 8. Decisions for the owner

*Answered on 2026-10-13; see the table at the top. Kept for the record.*

1. **Avatar rule.** Lift the 2026-06-04 "don't touch avatars" rule for the storage write
   only? Avatar bytes would go only to `shared:img:avatar:<name>`. Validation, size limits
   and messages are unchanged.
2. **Storage change.** Approve freezing the legacy image rows, with ids listed by key scan.
   No new rows are created.
3. **Two deploys.** Approve shipping the read-only dry-run tool first, then the switch after
   the orphan review.
4. **Kill switch.** Approve `IMAGE_LEGACY_HASH_WRITE` as the rollback lever.
5. **Era receipts.** Option B, A or C? And is `ENABLE_LEGACY=1` set on Railway?
6. **Phase 3** (dropping the frozen rows) gets its own sign-off later.

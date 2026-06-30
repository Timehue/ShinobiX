# Hollow Gate — Run Token + Augments Endpoint

Status: **SHIPPED (flag-gated).** This spec captures the server endpoint design
for (a) making Hollow Gate's reward economy server-authoritative and (b) adding a
roguelike "augment" run-modifier layer.

- **Tier 1 (foundation)** — commit `799bd5f7`, on `main`. The endpoint trio
  (`start` / `choose-augment` / `settle`) + `_run-token.ts` (catalog + bound math
  + offer roll), route-registered in `server.ts`, tested. Inert (nothing called
  them).
- **Tier 2 (client run-loop wiring)** — commit `d07df7cf`. Behind
  `hollowGateServer.v1` (localStorage, **default OFF**). `lib/hollow-gate-server.ts`
  owns the client orchestration; the dive entry background-mints the token + rolls
  augment offers (shown via the existing run-event modal), and every run-end funnel
  reports the haul to `settle` and reconciles local currencies to the server credit.
  No-token / flag-off / unreachable → the existing client-authoritative run, verbatim.

> ⚠️ **The "save-sanitizer freeze" in the section below was NOT adopted — and must
> not be.** See "Client + save-sanitizer changes" for why a freeze would zero every
> payout. The shipped model is reconcile-DOWN, not freeze.

Origin: the 2026-06-21 full-systems audit (see
`memory/project_full_systems_audit_2026_06_21.md`). This one endpoint trio closes
**three** items at once:

- **Finding #6 (medium):** Hollow Gate's entire reward economy is
  client-authoritative — there is no `api/hollow-gate/*` endpoint, no mint token,
  no server recompute. Currency/XP grants are computed in `App.tsx` and persisted
  through the generic `save:` endpoint, which only enforces per-save gain caps.
- **Finding #7 (low):** the 2/day (+attunement) run cap is enforced client-side;
  the server floor only engages when `exChar.lastDailyReset === today`, so a
  backdated `lastDailyReset` resets the counter and unlocks extra dives.
- **New feature:** server-minted, server-sealed run augments (a TFT/roguelike
  "choose 1 of 3 modifiers per run" layer) for repeatable-PvE replay variance.

It reuses the existing `raid-start → report-raid` single-use-token plumbing
(`api/missions/raid-start.ts`, `api/missions/report-raid.ts`) and the
`report-pet-event` reconcile pattern verbatim.

## Core idea — anchor on the entry snapshot

Hollow Gate **already** snapshots the clawback-eligible currencies at dive entry
(`entryCurrencies`) and computes the run's haul as `current − entry`
(`shinobij.client/src/lib/hollow-gate-run.ts` — `snapshotHollowGateCurrencies`,
`clawBackHollowGateLoot`). That snapshot is the trust anchor.

If the **server** seals the entry snapshot + dive depth + the chosen augment's
reward multiplier into a run token at dive start, then at extraction it can
**validate the claimed haul against a server-computed ceiling** — without
re-simulating the dungeon. The augment's reward effect is trusted because the
multiplier lives in the sealed token, never in the client body.

## Flow

```
 POST /api/hollow-gate/start
   auth · owns a Hollow Gate Key · under SERVER-stamped daily cap
   → server ROLLS 3 augment offers (client can't pick the pool)
   → mints  hg-run:<player>:<uuid>  sealing {
        floorDepth, seed, entryCurrencies snapshot,
        offeredAugmentIds, chosenAugmentId:null, dailyRunOrdinal }
   → kv.incr  hg-runs:<player>:<utcDate>   (server daily cap — fixes #7)
   ← { token, seed, augmentOffers:[display-only] }

 POST /api/hollow-gate/choose-augment
   token owned · pick ∈ offeredAugmentIds · not already chosen
   → re-seal token with chosenAugmentId = pick

 (client plays the dive — the augment's COMBAT effect is applied locally for feel)

 POST /api/hollow-gate/settle   (outcome: extract | death)
   token owned · NX idempotency keyed on the RUN (co-op-ready)
   → multiplier = CATALOG[chosenAugmentId].rewardMultiplier   (sealed)
   → bound      = maxHaulForDepth(floorDepth) × multiplier
   → credited   = min(client-claimed earned, bound)
       death → ×0.5 server-computed claw-back from the sealed snapshot
   → withKvLock(save, failClosed): delta-credit anchored to sealed entry, merge
   ← server-credited amounts for the client to reconcile
```

## Data model

```ts
// api/hollow-gate/_run-token.ts  — server source of truth
type HollowGateRunToken = {
  playerName: string;
  mintedAt: number;
  floorDepth: number;             // sealed dive depth → bounds the ceiling
  seed: string;                   // for the Tier-2 deterministic regen (later)
  entryCurrencies: Record<HollowGateCurrencyKey, number>;  // sealed snapshot
  offeredAugmentIds: string[];    // the 3 the server rolled
  chosenAugmentId: string | null; // set by choose-augment
  dailyRunOrdinal: number;        // which run today (server-counted)
};

type Augment = {
  id: string; label: string; description: string; rarity: 'common' | 'rare';
  // COMBAT effect — applied CLIENT-SIDE for feel; NOT trusted (it changes how the
  // run plays, never the payout), so it needs no sealing.
  combat?: { kind: 'elementBonus' | 'roleShield' | 'chainHit' | string; value: number };
  // REWARD effect — the ONLY thing the server enforces, via chosenAugmentId.
  rewardMultiplier: number;       // e.g. 2.0 = "double loot, enemies +30%"
  riskLabel?: string;             // cosmetic ("Enemies hit harder")
};
```

The key separation: **combat effect = client-side feel (untrusted)**, **reward
effect = sealed multiplier (server-enforced)**. That keeps the trust surface to a
single number per run.

## Handlers (idiomatic to the existing helpers)

```ts
// start.ts — mirrors raid-start.ts
const id = await authedPlayerOrAdmin(req, playerName);     // owner/admin gate
if (!hasHollowGateKey(char)) return res.json({ ok:true, reason:'no-key' });
// server-stamped daily cap — independent of client lastDailyReset (fixes #7)
const ord = await kv.incr(`hg-runs:${playerName}:${utcDateKey()}`, { ex: 25*3600 });
if (ord > dailyRunCap(char)) return res.json({ ok:true, reason:'daily-cap', token:null });

const offers = rollAugmentOffers(3);                       // server RNG → client can't choose the pool
const token  = randomUUID().replace(/-/g, '');
await kv.set(`hg-run:${playerName}:${token}`, {
  playerName, mintedAt: Date.now(), floorDepth,
  seed: randomUUID(), entryCurrencies: snapshotHollowGateCurrencies(char),
  offeredAugmentIds: offers.map(o => o.id), chosenAugmentId: null, dailyRunOrdinal: ord,
}, { ex: 60*60 });                                         // 60-min dive TTL
return res.json({ ok:true, token, augmentOffers: offers.map(displayOnly) });
```

```ts
// settle.ts — mirrors report-raid.ts consume + report-pet-event payout
const t = await kv.get<HollowGateRunToken>(`hg-run:${playerName}:${token}`);
if (!t) return res.json({ ok:true, reason:'invalid-or-spent' });          // graceful (stale client)
if (t.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(403)...

// entity-keyed idempotency = the co-op-ready part: keyed on the RUN, not the request
const once = await kv.set(`hg-settled:${playerName}:${token}`, true, { nx:true, ex: 24*3600 });
if (!once) return res.json({ ok:true, alreadyReported:true });
await kv.del(`hg-run:${playerName}:${token}`).catch(() => {});            // single-use

const mult  = AUGMENT_CATALOG[t.chosenAugmentId ?? '']?.rewardMultiplier ?? 1;
const bound = maxHaulForDepth(t.floorDepth, mult);    // Tier 1: theoretical max × sealed mult
const frac  = outcome === 'death' ? 0.5 : 1;          // server-computed claw-back

await withKvLock(`save:${playerName}`, async () => {
  const fresh = await kv.get(...); const c = fresh.character;
  for (const k of HOLLOW_GATE_CLAWBACK_KEYS) {
    const claimed = Math.max(0, Number(body.haul?.[k] ?? 0));
    const credit  = Math.floor(Math.min(claimed, bound[k]) * frac);      // ≤ sealed ceiling
    c[k] = Number(t.entryCurrencies[k] ?? 0) + credit;                   // anchor to SEALED entry
  }
  await kv.set(`save:${playerName}`, mergePreservingImages({ ...fresh, character: c }, fresh));
}, { failClosed: true });
```

## Two enforcement tiers

- **Tier 1 — sealed-bounds (ship first).** `maxHaulForDepth` = the sum of the
  *max* loot each tile type can drop at that depth (curves already exist in
  `hollow-gate-run.ts` — `hollowShardDrop`) × the sealed augment multiplier. Caps
  a run to its legitimate ceiling. Does **not** require regenerating the dungeon
  server-side. Closes the unbounded-farming exploit (#6) and makes the augment
  multiplier trustworthy.
- **Tier 2 — deterministic regen (later).** Make Hollow Gate generation
  deterministic from `seed` (swap `Math.random` for a seeded PRNG; run the
  generator in a shared lib), so `settle` re-derives the exact layout and
  validates the exact cleared-tile haul, not just an upper bound. This is the
  audit research's "deterministic sim as server-side verification" idea. Bigger
  lift (generator refactor) — deferred.

## Anti-cheat properties

| Guard | Closes |
|---|---|
| Augment offer rolled server-side | Can't self-select the strongest augment |
| `rewardMultiplier` sealed in token | Can't inflate the payout multiplier |
| Haul ≤ `maxHaulForDepth × mult` | **#6** — bounds the client-played dungeon to its ceiling |
| `kv.incr` server daily-run counter | **#7** — independent of client `lastDailyReset` |
| Single-use token + NX `hg-settled:` entity key | reconnect / retry / double-report pays once (co-op-idempotency-ready) |
| `failClosed` save lock + anchor to sealed `entryCurrencies` | lost-update on a concurrent autosave |
| 200-with-reason when token absent | stale clients & `SESSION_SECRET` unset keep working — **no save breakage** |

## Client + save-sanitizer changes — AS SHIPPED (read this before touching settle)

The **as-built** model differs from the original draft below it, and the
difference is load-bearing. Read the WHY before "fixing" it.

- **Live accrual + reconcile-DOWN (the shipped model).** The dive keeps applying
  loot to the character live (unchanged feel), and autosaves persist it. At
  extract/death the client reports the **gross** haul to `settle`, which SETS each
  balance to `min(current, sealedEntry + min(claimed, ceiling) × frac)` — i.e. it
  reconciles an over-claim *down* to the sealed ceiling. For a legit run this is a
  no-op; a crafted client is clamped. (`lib/hollow-gate-server.ts`
  `applyServerSettle`; server `settleCurrency`.)
- **There is deliberately NO "freeze HG increases while a token is open."** The
  original draft (next bullet) called for it; it was **rejected** because
  `settleCurrency` returns `min(current, entry+credit)` — it *needs* the live haul
  present in the save to pay out. Freezing increases pins `current` at `entry`, so
  `min(entry, entry+credit) = entry` and **the payout becomes zero**. The
  `_run-token.test.ts:88` "never restores in-run spends" test locks that
  `min(current,…)`. A regression guard in `_sanitize-hollowgate.test.ts` ("no
  currency freeze while a run token is open") fails if anyone re-adds the freeze.
- **What bounds the farming surface instead:** the no-token / generic-save path is
  bounded by the per-save `CURRENCY_CAPS` in `api/save/[name].ts` (e.g. hollowShards
  +200/cycle); the token path is bounded by the `settle` ceiling. The sanitizer
  only **shape-bounds** the new run fields (runToken/serverSeed ≤ 64 chars,
  augmentOffers ≤ 8) so a forged save can't bloat KV.
- Gated behind `hollowGateServer.v1` (default OFF); the no-token path still works
  (token-first invariant).

> ~~ORIGINAL DRAFT (superseded — do not implement):~~ *"The dive stops writing HG
> currencies to the save per-tile; it accrues a local provisional haul and posts
> it once at extract/death. Save sanitizer: reject HG-currency increases via the
> generic save while a run token is open."* — This would require a Model-B settle
> that credits additively (ignoring `current`); the shipped settle is Model-A
> (reconcile-down), so the freeze is incompatible. Switching to Model B means
> rewriting `settleCurrency` **and** its tests first.

## Wiring

- New files: `api/hollow-gate/start.ts`, `choose-augment.ts`, `settle.ts`,
  `_run-token.ts` (catalog + `maxHaulForDepth` + `rollAugmentOffers`).
- **Register all three handlers in `server.ts`** on both the bare and `/api`
  paths — there is no auto-routing; an unregistered handler is unreachable on
  Railway and cPanel. `server-routes.test.ts` enforces this both ways.
- Tests: `_run-token.test.ts` — bound math, augment seal/lookup, and a **drift
  test** asserting the server loot ceilings match the client `hollowShardDrop`
  tables (the `api/missions/_mission-catalog.test.ts` pattern); plus a `settle`
  idempotency + over-claim-clamp test.
- After the `api/` change: `npm run build` + commit the regenerated `dist/` (the
  cPanel auto-deploy serves committed `dist/` verbatim; Railway self-builds).

## Open tuning questions

- Number of augment offers per run (3?), rarity weights, and the
  `rewardMultiplier` ceiling.
- **Milestone augments:** offer one at F1/F3/F5 → `choose-augment` appends to a
  `chosenAugmentIds[]` and `settle` stacks the multipliers, with a hard cap so the
  stacked multiplier can't run away.
- Whether to keep per-tile optimistic client display (provisional) or batch the
  reveal at settle.

## Relationship to existing systems

- Mirrors `raid-start`/`report-raid` (token mint + single-use consume + daily cap)
  and `report-pet-event` (sealed-values payout + reconcile).
- Reuses `lib/hollow-gate-run.ts` (`HOLLOW_GATE_CLAWBACK_KEYS`,
  `snapshotHollowGateCurrencies`, `clawBackHollowGateLoot`, `hollowShardDrop`).
- The `hg-settled:<player>:<token>` entity key is the template for the broader
  **co-op idempotency** recommendation (Hollow Gate phase clears, clan-war flips):
  key the payout on the run/event, not the request, so two participants reporting
  the same outcome collapse to one credit.
- Complements the larger Hollow Gate design loop in `docs/hollow-gate-loop.md`.

# ShinobiX economy flow map

Audit snapshot: 2026-08-27. Values and balance were not changed.

## Authority model

The executable currency list is derived from the save ownership manifest by `api/_currency-ledger.ts`:

`ryo`, `bankRyo`, `honorSeals`, `fateShards`, `boneCharms`, `auraStones`, `auraDust`, `mythicSeals`, `hollowShards`.

The authoritative balance remains the character inside `save:<player>`. `ledger:currency:<player>` is a versioned, best-effort projection; gameplay does not read it. A missing/stale ledger row is observable lag, while different balances at the same `_saveVersion` are a declared divergence bug.

`api/_economy.ts` is also not balance authority. It appends best-effort recent transactions and aggregate faucet/sink totals. Its own coverage test states that the instrumented set is a floor, not a census.

```text
authenticated intent
    -> domain validates stored state and server catalog/proof
    -> fail-closed save/shared-resource lock or exact CAS/receipt
    -> authoritative save/treasury mutation
    -> _saveVersion bump
    -> optional currency-ledger projection
    -> optional economy telemetry
```

## Concurrency primitives in use

| Primitive | Guarantee | Current use |
| --- | --- | --- |
| `mutatePlayerSave` | Distributed `lock:save:<name>` with fail-closed acquisition; fresh read; exact-CAS versioned write; currency projection | Most modern one-player sinks/faucets: shop, inventory, crafting, missions, pet, story, world, profile, training. |
| `writeVersionedPlayerSave` | Exact compare-set of the previously read save; recovers lost acknowledgment only if readback equals intended write | Settlement sagas and handlers already holding the correct outer lock. |
| Embedded settlement receipt | Binds bounded request ID to an action fingerprint inside the same character blob | Shop, sale, PvP credit, named forge, and several reward/claim routes. |
| `reserveEconomicReceipt` | Durable primary-key pending/committed/aborted record; storage ambiguity fails closed | Cross-request economic rewards where the receipt cannot live only in the save. |
| `settleCrossKeyTransfer` | Deterministic two-key nested fail-closed locks | Player/player or shared-resource transfers that update two records. |
| `_economy-tx.ts` / `_durable-settlement.ts` | Durable state machine and reconciliation index for partial multi-step work | Routes explicitly integrated with transaction/reconciliation flows. |
| Domain saga | Ordered locks/writes, exact receipts, compensation, and audit row | Clan/village treasury, war declaration/mercenary funding, war settlement, Clan Exchange treasury rewards, weekly boss/ranked settlement. |

These are application-level transactions over `public.kv_store`; there is no general PostgreSQL multi-row transaction wrapper exposed by `KvLike`.

## Currency flow table

| Currency | Verified sources | Verified sinks/transfers | Server owners | Mutation / transaction | Telemetry/audit status | Duplication risk |
| --- | --- | --- | --- | --- | --- | --- |
| Ryo | XP-bearing combat/progression via `_xp-engine`; PvP/PVE/Tower/Clan Boss; missions; story/spar; dungeon/endless; weekly boss; war/clan rewards; map control/daily agenda; world chest/explore/sector quests, gifts, ambushes, contracts/services; pet gauntlet/battle; festival; inventory sale; bank interest; admin/legacy recovery paths | Shop items; training/jutsu training and completion; bank deposit/withdraw (transfer, not supply); player/clan/village transfer plus tax burn; travel/heal/cafeteria; crafting; Kage challenge; shrine offering; bounty/profile/progression services; war tax/mercenary costs | Domain functions plus `mutatePlayerSave`; `_xp-engine.ts`; shop/inventory/bank/training/war/sector handlers | One-save mutations are locked/CAS. Player/shared transfers use ordered locks/sagas. Some older reward writers hand-roll versioned writes. | Instrumented examples include shop, sale, mission, bank interest, trade burn, treasury gift burn, festival. Not a census. | Medium: broadest writer set; sidecar audit exists specifically because not every writer projects yet. |
| Bank Ryo | Deposit from wallet; bank interest; refunds/war adjustments where applicable | Withdrawal to wallet; war tax can debit wallet/bank according to policy | `api/bank/_transfer.ts`, `_wallet-transfer.ts`, `_bank-interest.ts`, `_war-tax-apply.ts` | Wallet and bank fields live in one save for ordinary transfer/interest; war tax also credits village treasury via a cross-key workflow | Interest has economy telemetry; internal wallet/bank transfer is supply-neutral | Low for bank transfer; medium for war-tax cross-key partial failure, which has settlement tests. |
| Honor Seals | Vanguard PvP; map-control/daily agenda; war/clan rewards; Hollow Gate; war crate; mission rewards; village daily/war processes; treasury gifts/transfers | Jutsu seal training; Hollow Gate unlock/uses; village structures/upgrades; war declaration and mercenary funding; clan/village donations/transfers; gift tax except exempt cases | PvP vanguard settlement, mission/war/village/Hollow Gate handlers | Player mutations locked/CAS; declaration/mercenary and treasury moves use dedicated receipts/ordered locks | Treasury gift burn and selected reward routes instrumented; full faucet census not enforced | Medium-high due to player plus village-treasury forms and multi-key war funding. Dedicated non-evicting receipts reduce replay risk. |
| Fate Shards | Missions/apex/checklist; story/sector quests/gifts/ambushes/rifts; world chests and duplicate relic substitution; Tower/Spire/war; dungeon; pet gauntlet/ladders; PvP/weekly boss; map control; festival; clan exchange/treasury | Premium/rare shop items and Card packs; profile title/customization; stat respec; pet nickname; Hollow Gate key; awakening/bloodline or other server-catalog progression costs; trades/donations/transfers | Shop/profile/save-stat/pet/Hollow Gate/mission/war/world/tower handlers | Modern sinks use `mutatePlayerSave` and request receipts; cross-player/shared moves use ordered locks | Shop/profile telemetry present; many reward faucets are not in the coverage floor | Medium. High-value premium currency has many reward routes; production ledger audit not run. |
| Bone Charms | Missions/hunts; dungeon; war/map/daily; sector rifts/gifts/ambushes/services; world/Hollow Gate chests; pet gauntlet; clan exchange; festival; war crate | Bloodline forge (B-rank); crafting supply conversion; trades/donations/transfers; configured shop/secondary systems | Mission, world, war, pet, craft, bloodline, treasury handlers | Same save mutation for ordinary source/sink; transfer sagas for gifts/treasury | Only some routes emit economy telemetry | Medium. Multiple stack/item crafting paths combine charm debit with output and require replay protection. |
| Aura Stones | Ranked-season podium; dungeon; mission pet event; Hollow Gate/world chest; legacy acceptance; clan mission/exchange; festival | Bloodline forge (A-rank); trades/donations/transfers; configured progression/content sinks | Ranked scheduler, dungeon/world/Hollow Gate, bloodline forge, trade/treasury | Ranked and boss rewards are crash-resumable per-player settlements; forge is one-save mutation; transfers ordered | Partial telemetry only | Medium. Scheduled reward and transfer paths are separate but tested. |
| Aura Dust | Mission catalog/hunts; story; PvP secondary/Vanguard reward; Hollow Gate combat/event/door; world chest; craft conversion | Aura Sphere feed/progression and any server-configured recipe | Mission/story/PvP/Hollow Gate/world/craft/aura handlers | One-save locked/CAS mutation; Hollow Gate uses parent settlement evidence | Partial telemetry only | Low-to-medium; fewer transfer paths, but multiple event faucets. |
| Mythic Seals | Clan mission treasury reward; festival jackpot/black market; administrative/legacy sources if invoked | Bloodline forge (S-rank); clan/village donation/transfer | Clan/festival/bloodline/treasury handlers | One-save forge; shared transfer sagas | Sparse telemetry | Medium. Rare currency has a small writer set but shared treasury movement. |
| Hollow Shards | Hollow Gate combat bosses, locked doors, events/shard veins | Hollow Gate attunement, consumables, key forge | Hollow Gate parent run/combat/event/attunement/key modules | Exact parent run token/ledger and fail-closed save mutation; parent reconciles entry/current/delta | Economy telemetry is not a complete census | Low within its isolated domain; parent/child receipt correctness is heavily tested. |

## Major source/sink flows

### Shop purchase

`POST /shop/settle` authenticates the exact player, applies a strict KV rate limit, loads the server settlement catalog, and accepts only an item/pack identifier plus quantity/request ID. `applyItemPurchase` or `applyCardPackPurchase` derives currency and cost, validates balance/level/unlock, writes the debit and owned result through one `mutatePlayerSave` call, and embeds a request fingerprint. A replay returns the stored result; conflicting reuse fails. Economy telemetry is appended only after the authoritative write.

**Transaction:** one `save:<player>` record; fail-closed distributed lock plus exact CAS. **Double-spend posture:** protected.

### Inventory sale

`POST /inventory/sell` loads the server catalog, derives sale value, verifies backpack/equipped ownership, removes the exact quantity or equipment reference, credits Ryo, and appends the receipt in one save mutation.

**Transaction:** one save. **Double-credit posture:** request/fingerprint protected.

### Bank

Bank transfer changes `ryo` and `bankRyo` together in the same character record. Interest validates stored time/balance and updates `bankRyo` plus `lastBankInterestAt` under the save lock. Interest telemetry follows the committed mutation.

**Transaction:** one save. **Replay posture:** time stamp/server function; focused interest/transfer tests exist.

### Player trade

Only Ryo, Fate Shards, Bone Charms, and Aura Stones are tradeable. The server validates both saves/limits and applies tax/burn. The trade flow uses deterministic cross-key locking/settlement rather than trusting a client balance.

**Transaction:** application-level two-save transfer. **Failure posture:** fail closed; burn telemetry is pinned as negative.

### Clan/village treasury donation and transfer

Currency allowlists and caps are server constants. Donation removes player funds and credits the shared treasury. Transfer/gift paths calculate tax, credit recipient/shared state, and emit burn telemetry. Permission and membership checks are server-side.

**Transaction:** ordered player/shared or player/player locks and domain saga, not one PostgreSQL transaction. **Risk:** compensation/reconciliation remains more complex than a single-row mutation.

### Missions/story/world rewards

These routes derive rewards from server catalogs and sealed activity/combat/discovery proof. They use bounded receipts or durable authority rows, then mutate the save. The client never supplies an authoritative amount.

**Transaction:** usually one save plus a proof/receipt key. **Replay posture:** route-specific exact/bounded receipt; many adversarial tests exist.

### PvP/PvE/Tower/Boss rewards

Combat mutation does not directly trust or pay a reported winner. Terminal session state, joined/participant evidence, authority stamps, and exact completion receipts feed separate settlement code. Weekly Boss and ranked rollover distribute per-player rewards using restart-safe markers and only close the parent when all planned recipients are handled.

**Transaction:** one save per recipient plus terminal/parent receipt state. **Risk:** multi-key sagas can require reconciliation after partial failure, but rewards are not authorized from browser outcomes.

### Crafting and named forging

Server recipes compute material/currency debit and result. Ordinary forge output and its sink commit in one save. Named forge seals RNG before payment, then commits exact materials, item ID, definition, and receipt together; the permanent definition registry is a best-effort post-commit redundancy write.

**Transaction:** one save, plus optional recovery registry. **Replay posture:** receipt protected.

### War declaration/mercenary/settlement

Declarations and mercenary hiring use non-evicting funding receipts because they debit a player and create/advance shared war state. War conclusion moves treasury spoils between villages and creates per-player reward eligibility/receipts.

**Transaction:** explicit domain saga over multiple KV keys. **Risk:** highest-complexity economy boundary; it needs failure-injection and live reconciliation evidence before scale-out.

## Telemetry coverage

`api/_economy-coverage.test.ts` currently ratchets `recordEconomyTxn` calls in:

- player trade burn;
- village/clan gift burn;
- village upgrade;
- Black Market stake/payout;
- Sunscar dice;
- bank interest;
- inventory sale;
- shop settlement;
- mission claim.

It explicitly says this is a floor, not a census. Therefore:

- **AUDITED?** Server authority/replay is heavily unit-tested for the major routes.
- **AUDITED?** Complete faucet/sink observability is **NO**.
- `econ:agg:*` is lock-free best-effort and can undercount on concurrent update; `econ:txns` is described as the more precise recent drill-down but is capped at 5,000.
- The versioned `ledger:currency:*` projection is the stronger divergence signal, but it is not fully hooked and has not been audited against production in this phase.

## Findings

### ARCHITECTURAL RISK — incomplete writer convergence

`mutatePlayerSave` and `writeVersionedPlayerSave` project currency changes, but `_currency-ledger.ts` documents that several settlements still hand-roll save writes. A stale projection is self-describing and does not change gameplay, yet it adds noise that can hide a same-version divergence.

### ARCHITECTURAL RISK — multi-key application transactions

Player trades, treasury movements, war funding/spoils, and several parent/reward flows cannot commit atomically through the current `KvLike` interface. The code uses deterministic locks, receipts, exact compare-set, compensation, and reconciliation. This is safer than unguarded writes but operationally more complex than one database transaction.

### ARCHITECTURAL RISK — lock lease can expire inside a valid writer

`withKvLock` defaults to a five-second TTL and has no renewal/fencing token on the data write. Exact compare-and-delete prevents a stale holder from deleting a newer lock, but it does not prevent the newer holder from entering while the old callback is still running. `mutatePlayerSave` and `settleCrossKeyTransfer` use the default. No duplicate was reproduced; instrument hold time and expiry before choosing renewal or route-specific TTLs.

### ARCHITECTURAL RISK — transaction observability indexes can lose concurrent updates

`_economy-tx.ts` stores each transaction under its own durable ID, but its `economy-tx:recent` index is a non-CAS read/filter/write and reads the key twice. Concurrent updates can omit an ID from the recent admin/reconciliation view without deleting the transaction row. Fix the index independently from transaction state and add a two-writer race test.

### PERFORMANCE RISK — telemetry write amplification

A single currency-changing request can write the save, the currency ledger, a receipt, the recent economy list, and one aggregate. Telemetry is best-effort, but its lock-free read-modify-write list/aggregate behavior and capped-list serialization should be measured under the Phase 13 mixed workload.

### UNKNOWN — production currency integrity

`npm run ledger:audit` and `npm run scan:data` were not run against production credentials. No claim is made that all current save blobs match ledger projections or contain valid balances.

## Safe next steps

1. Run `npm run ledger:audit -- --json` read-only in the Railway environment; do not use `--backfill` until the result is reviewed.
2. Extend the economy coverage ratchet from a hand-maintained instrumented floor to an executable writer registry, without making telemetry authoritative.
3. Migrate hand-rolled save writers to `writeSaveProjected` or `writeVersionedPlayerSave` one route at a time, with route-specific replay/concurrency tests.
4. Add two-request concurrency tests to any uncovered shop-like sink before changing its implementation.
5. Do not promote `ledger:currency:*` to gameplay authority until production audit reports zero same-version divergence and acceptable stale-row coverage over a defined soak period.

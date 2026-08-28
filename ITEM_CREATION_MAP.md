# ShinobiX item creation map

Audit snapshot: 2026-08-27. This map records executable creation paths; it does not change item stats, odds, costs, or rewards.

## Item state model

| State | Canonical representation | Enforcement |
| --- | --- | --- |
| Non-stack/count-by-instance ownership | `character.inventory: string[]` | Dedicated server mutations add/remove IDs. The save sanitizer prevents generic autosave from minting server-ledger inventory and enforces entitlement/ownership boundaries. |
| Stack ownership | `character.itemStacks: { itemId, count }[]` | Domain helpers normalize whole non-negative counts; save ownership treats the field as server-controlled. |
| Equipped gear | `character.equipment` slot-to-item references | `api/save/[name].ts` verifies slot whitelist, ownership, and item slot kind. Combat sessions seal server-resolved definitions. |
| Built-in definitions | `api/pvp/_item-catalog.ts` (`ITEM_CATALOG`) | Static server catalog used by combat and the settlement catalog. |
| Published creator definitions | `content:*` through `_content-store.ts`, parsed by `_admin-item-catalog.ts` | Canonical published rows/tombstones merge with built-ins. Legacy admin save slots remain dual-read compatibility inputs. |
| Personal named definitions | top-level `creatorItems` in the owner save plus `forged-item:<id>` recovery row | Named forge creates a UUID-shaped definition, item instance, receipt, and best-effort permanent recovery copy. |
| Card ownership | Card Clash collection fields, not `inventory` | Shop pack/starter/progression endpoints use Card Clash catalogs and collection caps. |
| Pet ownership | `character.pets` or sanctuary records, not `inventory` | Pet acquisition/breeding endpoints create canonical owned-pet instances from server templates and sealed proofs. |

The shared admin/item catalog deliberately excludes player-forged IDs from global content. A forged definition in the player's save wins; the permanent registry is a recovery source, not a public catalog.

## Definition creation and publication

| Path | Input accepted | Server validation | Persistence / replay | Risk |
| --- | --- | --- | --- | --- |
| Admin content publish | Authored item objects/tombstones | Content-scoped admin auth, field normalization, catalog parsing, item budget on persisted creator items | Versioned `content:<field>` plus compatibility mirror/cache | Published content is process-cached for 60 seconds; tombstone behavior is tested. |
| Named forge roll/forge | Kind/slot, later moderated name/flavor and sealed token | Stored level gate; server RNG seals roll for 20 minutes; exact material-point debit; text moderation; server-generated ID/stats | `mutatePlayerSave` atomically writes item ID + personal definition + bounded receipt; token deleted after; `forged-item:<id>` written best-effort | **ARCHITECTURAL RISK:** a crash after save commit but before registry copy leaves the authoritative in-save definition intact but removes the future recovery backstop. Replay repairs the registry if the item remains in the bounded `creatorItems` window. |
| Admin item grant | Player, item ID, request ID | Full/content admin auth; ID must exist in built-in or published catalog | Fail-closed save mutation with embedded settlement receipt and admin audit log | Direct operational power is intentional; audit log is best-effort after the committed save. |

## Player item faucet map

| Source / route | Items created | Authority and validation | Mutation / concurrency | Automated evidence |
| --- | --- | --- | --- | --- |
| First character save | `rustfang-kunai`, `shinobi-vest` | `api/save/[name].ts` server first-save baseline | Save creation/version path; later generic saves cannot re-mint inventory | Save first-baseline and ownership suites |
| Shop purchase `/shop/settle` | Built-in or published catalog items; stack/non-stack handling | Client names item/quantity only; server catalog determines price, currency, level, stack semantics, and tombstones | `mutatePlayerSave` fail-closed KV lock + exact CAS/version + embedded request receipt; currency and item commit in one save blob | Shop settlement, purchase, catalog, arbitrage invariants |
| Card pack `/shop/settle` | Server-random Card Clash cards | Chronicle unlock, server catalog, server RNG, collection cap, request receipt | Same locked save mutation as item purchase | Shop settlement and Card Clash collection tests |
| Mission claim `/missions/claim-mission` | Catalog `itemRewards` such as hunt materials | Mission state/proof, completion type, daily/repeatable limits, server reward catalog | Locked/versioned save mutation with bounded claim receipts/combat claim authority | Mission claim/eligibility/replay suites |
| Story settle `/story/settle` | Finale `hollow-gate-key` (unique check) and Chronicle cards where configured | Sealed story/spar opponent proof and progression gate | `mutatePlayerSave` + story settlement receipt | Story settlement/combat tests |
| Dungeon run `/dungeon/run` | `dungeon-legendary-relic` on valid terminal run | Sealed run/token, minimum duration/encounter proof, key/free-probe rules | Authenticated locked save mutation with redeemed-run receipt | Dungeon run/AI/proof tests |
| Village/Clan war settlement | `legendary-war-crate` instances | Server war record, participant role/contribution, reward window | Dedicated reward settlement with per-player receipts/locks | War reward and claim tests |
| War crate open `/inventory/open-war-crate` | `warforged-relic` if not already owned; possible `dungeon-key`; currencies | Requires owned crate; server RNG; duplicate/stack handling | One `mutatePlayerSave` call removes crate and adds rewards together | `inventory/_war-crate.test.ts`, village compatibility tests |
| Weekly Boss auto-distribution | weekly boss core, dungeon key, unique Hollow-Gate Cinder relic | Frozen server damage-share summary and server RNG; duplicate relic becomes Fate Shards | Crash-resumable per-player distribution and boss completion marker | Weekly boss reward/recovery tests |
| Ranked season rollover | champion `warforged-relic` plus Aura Stones | Server-computed podium from both ladders; season ID/epoch | Per-player settlement with season reward marker in scheduled job | Ranked-season tests |
| World chest `/world/open-chest` | Server-rolled biome relic/item plus currency; duplicate relic substitution | Durable exploration discovery, sector/daily reservation, server RNG, item uniqueness | Locked save mutation + bounded receipt + longer-lived discovery authority update | `world/_chest.test.ts`, world reward recovery tests |
| Built-in event `/events/claim` | Unique `aura-sphere` | Known event ID, not already inventory/equipped, claim ledger | `mutatePlayerSave` and claimed-event field | `events/_claim.test.ts` |
| Craft forge `/craft/forge` | Supply outputs, converted currency supplies, relic from fragments, catalog gear | Server recipe table, exact material point count, quantity bounds, server catalog/value | `mutatePlayerSave`; material debit and result creation in the same character write | `craft/_forge.test.ts` |
| Named forge `/craft/named` | Personal named weapon/armor and definition | Sealed roll, level gate, exact named-forge point debit, moderated text | Locked save write + receipt + best-effort registry as described above | `craft/_named.test.ts`, forged-registry tests |
| Hollow Gate key `/hollow-gate/forge-key` | `hollow-gate-key` | Server recipe accepts exact Hollow Shards, dungeon keys, or Fate Shards source | `mutatePlayerSave`; debit and key creation in one write | `hollow-gate/_forge-key.test.ts` |
| Hollow Gate combat/event/locked door | Counted fragments, Veils, elemental shards, and configured loot | Parent run ledger, exact child combat receipt, floor/event state, server RNG | Parent ledger reconciliation plus versioned save settlement; item entry/current/delta reconciled | Hollow Gate combat, ledger, event, adversarial, reconnect tests |
| Anbu infiltration | Server-selected cache item stack | Sealed infiltration run/cache proof and server store | Store settlement updates counted stack under authoritative run flow | Anbu infiltration store/encounter/cutover tests |
| Clan Exchange `/clan/exchange/purchase` | Catalog item rewards; some entries credit clan treasury instead | Stored clan membership, server exchange catalog, level/limit/points | Fail-closed player lock; treasury rewards lock clan then player and attempt refund/audit on second-write failure | Clan exchange tests |
| Cafeteria | Counted ration item | Server recipe and stored resources | Authenticated save mutation via cafeteria helper | Cafeteria tests |
| Elemental core forge `/weapon/forge-elemental-core` | Counted elemental core | Server recipe/material validation | Locked/versioned save mutation; apply route later consumes a core and stamps `weaponElements` | Elemental-core tests |
| Admin grant `/admin/grant-item` | Any built-in/published catalog item | Admin authentication and catalog existence | Receipt-protected save mutation + audit log | `admin/grant-item.test.ts` |

## Item sinks and transfers

| Sink / transfer | Validation and atomicity |
| --- | --- |
| Inventory sale `/inventory/sell` | Server catalog determines sellability/value; source is backpack/equipped; request receipt; item removal/unequip and Ryo credit share one locked save mutation. |
| Shop/craft materials | Server recipe removes exact quantities and creates the result in the same save mutation. |
| Combat consumables | PvP/Solo/Tower seal available charges at admission, record actual usage, and debit the authoritative inventory through terminal settlement/recovery. |
| Dungeon/Hollow Gate keys | Entry route consumes owned stack/instance while creating the sealed run; exact run token/receipt prevents duplicate entry/settlement. |
| Aura feed | Consumes owned Aura Sphere item/currency according to server function and advances server-owned progression. |
| Pet feed/equipment/evolution | Server validates owned item; permanent/consumable slots remove inventory as specified; unequipping a pet consumable returns it to inventory; evolution consumes server-recognized material. |
| Profession choice / hunter rank | Server helpers consume required approval/material items. |
| Clan/village treasury donation | Server validates item/currency eligibility and ownership, removes from player under fail-closed locks, and credits the shared record using a defined lock order/settlement path. |
| Elemental core apply | Validates equipped/owned weapon and core, consumes one core, and writes the server-owned weapon-element mapping together. |

## Pet and secondary collection creation

Pets and cards are not normal items, but they are duplication-sensitive creation paths:

| Collection | Creation paths | Authority / replay |
| --- | --- | --- |
| Wild pets | Encounter start/discovery -> `/pet/befriend` | Server-sealed encounter tied to durable world exploration; stored template, server trait RNG, bounded redeemed token, then roster or sanctuary placement. |
| Starter pet | `/pet/choose-starter` | Canonical template and one-time starter state. |
| Bred pet | breeding start -> requirements -> hatch | Species/palette/parents sealed at start; hatch uses deterministic session-derived instance ID and bounded hatch receipt; roster/sanctuary checked on replay. |
| Card starter/pack/progression cards | Card Clash starter, shop pack, progression sync | Server catalogs, unlocks, collection cap, and settlement receipts; client does not submit arbitrary cards to grant. |

## Invariants already protected

- Equipment must reference a valid owned item of the correct slot kind.
- Creator-item bonuses are budgeted on persistence and again when entering combat.
- Shop purchase and inventory sale bind a request ID to an action fingerprint; reuse with different intent conflicts.
- Stack counts and recipe quantities are normalized to whole non-negative values.
- A thrown/combat consumable cannot be spent beyond the server-sealed charge count.
- Named forge replay returns the previously minted item rather than rolling or charging again.
- War crate opening removes the crate and grants the randomized result in one locked save mutation.
- Bred-pet replay searches both roster and sanctuary before creating anything.

## Findings

### ARCHITECTURAL RISK

1. Item mutation has several local `addOwned`/stack-normalization helpers (`shop`, `craft`, `Hollow Gate`, `clan exchange`, cafeteria, war crate). They are not proven behaviorally identical: some intentionally cap at 9,999, some preserve duplicate instance IDs, and some enforce uniqueness. Do not replace them with one helper until each representation policy is characterized.
2. Named-forge recovery-registry publication is best-effort after the authoritative save commit. This is safe for the immediate result but leaves a narrow loss of recovery redundancy on process failure.
3. Clan Exchange's treasury-credit path is a two-key saga, not a database transaction. It has lock ordering, refund, and a 90-day audit row, but a failed refund explicitly requires admin reconciliation.
4. The generic save remains a large compatibility boundary. Dedicated item writers are safer, but all creation routes should eventually use `mutatePlayerSave`/`writeVersionedPlayerSave` or an explicitly documented saga.

### UNKNOWN

- No production scan was run for duplicate unknown item IDs, orphaned equipped IDs, negative stacks, or forged definitions missing from `forged-item:*`.
- Admin-published live item definitions were not queried; checked-in catalog and parser tests do not prove current production content quality.

## Next safe work

1. Run the existing read-only data scan and add a forged-registry coverage mode before changing item persistence.
2. Build an executable inventory-writer registry or static ratchet analogous to the save ownership manifest; current `rg` census is manual.
3. Add a fault-injection test for process failure between named save commit and recovery-registry publication, then decide whether registry repair belongs in replay/read augmentation rather than the critical commit.

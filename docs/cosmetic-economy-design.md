# Cosmetic-Only Player Economy — Design Doc

**Status:** Plan / not built. Read-only survey + implementation-ready design.
**Author target:** Lead Systems Designer + engineer.
**Model:** Dota 2 / Path of Exile cosmetic economy — deep, lively, monetized, **zero pay-to-win**.

---

## 0. The Pillar (non-negotiable)

> Shinobi Journey's foundation is **balanced PvP**. Power must NEVER be bought, grinded,
> RNG'd, gifted, or traded. This economy is **cosmetic + convenience only**. It can never
> grant, trade, sell, gift, or crate anything that affects PvP combat power.

Every decision below is subordinate to that rule. The rule is enforced **mechanically**
(an allowlist registry of cosmetic ids; a hard guard/test), not by reviewer discipline
(§9, §11).

---

## 1. Survey — what already exists (so we extend, not duplicate)

### 1.1 The existing trade system — pillar check (PASS, with a note)

The current trade system is **currency-only and there is no item/gear trade at all**:

- Client wrapper: `shinobij.client/src/lib/player-trade.ts:1-44`. `sendCurrency()` posts to
  `/api/player/trade`; the only payload is `{ currency, amount }`.
- Server: `api/player/trade.ts:39-140`. One-way taxed SEND. Tradeable set is
  `ryo | fateShards | boneCharms | auraStones` (`api/player/_trade-core.ts:18-19`); honor
  seals and mythic seals are deliberately excluded as "would launder a profession-exclusive /
  top-rarity currency" (`_trade-core.ts:11-14`). A **flat 10% burn is the economy sink**
  (`_trade-core.ts:16,52-53`).
- **No code path transfers gear, jutsu, materials, or any inventory item between players.**
  `parseDonation()` in `api/clan/treasury/donate.ts:57-68` accepts an `itemId`, but that is a
  one-way **donation to a clan treasury**, not a player↔player trade, and it is bounded by
  ownership validation in `api/_treasury-donate.ts`.

**Verdict:** No pillar violation exists today — there is no power-item trade to restrict.
The auction house (§4) is therefore **greenfield** and must be built cosmetic-only from day one.
The note for the build: because players will *expect* "trading" to mean items once an auction
house ships, the UI and validators must make it structurally impossible to list a non-cosmetic
(see §4.3, §9).

### 1.2 Currencies (`shinobij.client/src/lib/currency.ts`, `api/_economy.ts:19-26`)

Existing currencies: `ryo`, `fateShards`, `honorSeals`, `boneCharms`, `auraStones`,
`auraDust`, `mythicSeals`, `hollowShards`. All are **earned through play** (faucets) or burned
(sinks). `ryo` is the soft currency and the primary sink target (trade burn, black-market,
bounties, bank interest reprice).

**There is no premium / real-money cosmetic currency today.** We will add one (§6).

### 1.3 Existing cosmetic / expression systems (extend these)

| System | Files (file:line) | Data model | Storage | Cost | Touches power? |
|---|---|---|---|---|---|
| **Nindo creed** | `lib/nindo-bbcode.tsx:1-87`, `components/NindoEditor.tsx`, `screens/Profile.tsx:463-469` | `Character.nindo?: string` (safe BBCode subset; client editor caps ~1500 ch, **server caps 2000** `api/save/[name].ts:288`) | On char save; moderated `api/save/[name].ts:287-294` | Free | **No** |
| **Nindo banner preset** | `lib/nindo-backgrounds.ts:18-44` | `Character.nindoBg?: string` (preset id) | On char save; **server allowlist** `api/save/[name].ts:298-301` (`'', ember, frost, verdant, shadow, royal, sakura`) | Free | **No** |
| **Earned titles** | `lib/earned-titles.ts:1-23`, `constants/achievements.ts`, `Profile.tsx:405-431` | `Character.earnedTitles?: string[]`; worn = `customTitle` | On char save | Free to equip | **No** |
| **Custom title (free-text)** | `Profile.tsx:109,276` | `Character.customTitle?: string` | On char save; moderated `api/save/[name].ts:276-278` | 10 Fate Shards once | **No** |
| **Quest/story titles** | `character.ts:301-302,197` | `questTitles?: string[]`, `storyTitle?` | On char save | Earned | **No** |
| **Avatar** | `lib/avatar.ts:13-19`, `Profile.tsx:66-104` | `Character.avatarImage?: string` (data URL / `/api/img` path) | On char save (public field) + KV `avatar:<charname>` via `api/images.ts` | Free (self-upload) | **No** |
| **Pet portrait / body / poses** | `lib/pet-battle-anim.ts`, `types/pet.ts:101-107`, `lib/shared-images.ts` | `Pet.image?`, `Pet.bodyImage?`, `Pet.nickname?` | KV `shared:img:pet:<id>`, `shared:img:petbody:<id>`; pose files `/pet-poses/<id>-idle.webp` | Free | **No** |
| **Pet collar (glow aura)** | `data/pet-config.ts:139-191`, `types/pet.ts:38-44`, `styles/pet-skin.css` | `PetCollar { id,name,tint,glow,rarity,cost }`; worn = `Pet.loadout?.collar` | Collar id on pet loadout | **50–300 Fate Shards** | **No** (glow only) |
| **Jutsu VFX** | `lib/jutsu-vfx.ts:1-165` (see header lines 9-12), `lib/jutsu-fx-assets.ts` | element→palette+sprite map | Bundled Vite assets | Free | **No** (explicitly "cosmetic-only") |
| **GameIcon** | `components/icons/GameIcon.tsx:1-220` | inline SVG glyphs, `currentColor` | Bundled JS | n/a | **No** |

**Greenfield (do not exist yet):** name colors, clan/village emblems, battle entrances /
victory cinematics, sector/home decor, a unified **wardrobe** (own-once / equip-anywhere),
an **auction house**, **cosmetic crates**, **gifting**, **commissions**, **premium currency**,
**supporter/Patreon status**. Patreon is currently only an external link
(`components/MobileNav.tsx:148`, `RightMenu.tsx:120`, `data/guides.ts:749`).

### 1.4 CRITICAL nuance — the pet `loadout` is a mixed bag

`Pet.loadout` (`data/pet-config.ts`) has THREE slots:
- `collar` (lines 139-191) — **pure cosmetic** glow, safe.
- `pvp` (lines 214-266) — **grants real stat mods** (`applyPetPvpGear()` lines 255-265). **POWER.**
- `pve` (lines 309-343) — consumable PvE buffs. **POWER (PvE).**

**The cosmetic market/crate/auction must NEVER touch `pvp`/`pve` gear** — only `collar`
and pet portrait/skin cosmetics. This is the most likely place a future contributor could
accidentally violate the pillar; the registry in §9 is the guard.

### 1.5 Reusable server patterns (the spine of the build)

| Pattern | File:line | Reuse for |
|---|---|---|
| **Dual-lock debit-before-credit** | `api/clan/treasury/donate.ts:108-142` | Auction settle (escrow→buyer pays→seller credited), gifting |
| **Escrow board + idempotent claim + refund-on-fail** | `api/pvp/bounty.ts:86-175` | Auction listing escrow + idempotent purchase + relist-on-credit-fail |
| **Gacha RNG + sink (EV < cost) + daily cap** | `api/festival/_black-market.ts:1-55`, `black-market.ts:34-90` | Cosmetic crates (swap payout table to cosmetic ids) |
| **Crate-reveal UI** | `components/BlackMarketCrate.tsx:1-60` | Cosmetic crate open animation |
| **`withKvLock` failClosed** | `api/_lock.ts:84-149` | Every currency/cosmetic-ownership RMW |
| **Server-authoritative save clamps + cosmetic allowlist** | `api/save/[name].ts:298-301` (nindoBg) | Validate cosmetic ownership/equip server-side |
| **Anti-alt IP/FP overlap** | `api/_player-ips.ts:80-93` | Block gifting/auction funnels to your own alt |
| **Rate limiting (two-tier, strict)** | `api/_ratelimit.ts:158-182` | All new endpoints |
| **Audit log (capped, compact)** | `api/_audit.ts:70-88` | Trade-history audit (add `'market'` domain) |
| **Economy telemetry (sink/faucet deltas)** | `api/_economy.ts:71-99` | Log every fee burn as a negative `ryo` delta |
| **Image storage / categories** | `api/images.ts:115-156` (`shared:img:<id>`, `shared:imgfields:<cat>`, `KNOWN_PREFIXES`) | Cosmetic asset images; add a `cosmetic` category |
| **Route registration** | `server.ts:314-331` (`route()` registers bare + `/api`) | Wire every new handler |

---

## 2. Design overview

Three layers, all governed by one **Cosmetic Registry**:

```
                  ┌─────────────────────────────────────────────┐
                  │  COSMETIC REGISTRY (api/_cosmetics.ts)       │
                  │  - the ONLY source of valid cosmetic ids     │
                  │  - every id has: type, rarity, source,       │
                  │    tradeable?, price, image key              │
                  │  - HARD GUARD: nothing here grants power      │
                  └───────────────┬─────────────────────────────┘
                                  │  (every layer validates against it)
        ┌─────────────────────────┼─────────────────────────────┐
        ▼                         ▼                              ▼
┌───────────────┐        ┌────────────────┐            ┌──────────────────┐
│ COSMETIC SHOP │        │ AUCTION HOUSE  │            │ COSMETIC CRATES  │
│ (premium +    │        │ (player↔player │            │ (gacha, sink,    │
│  Fate Shards) │        │  cosmetic only,│            │  cosmetics only) │
│  → wardrobe   │        │  ryo fee burn) │            │  → wardrobe      │
└───────┬───────┘        └───────┬────────┘            └────────┬─────────┘
        │                        │                              │
        └────────────────────────┼──────────────────────────────┘
                                  ▼
                  ┌─────────────────────────────────────────────┐
                  │  WARDROBE (account-wide unlock ledger)       │
                  │  save:<name>.cosmetics = { owned[], equipped }│
                  │  GW2 transmog model: unlock once, equip      │
                  │  anywhere; ACCOUNT-BOUND on acquire           │
                  └─────────────────────────────────────────────┘
```

Plus **gifting** (mentorship vector) and **cosmetic commissions** (crafter-profession economy
role) as two ways to *move* cosmetics that don't move power.

---

## 3. Cosmetic catalog & data model

### 3.1 Cosmetic types (account-bound, zero power)

| Type id | What it skins | Anchor / new field | Notes |
|---|---|---|---|
| `petSkin` | Pet portrait + body sprite override | `Pet.appliedSkinId` (new) → resolves to `shared:img:petskin:<skinId>` | Override art only; stats unchanged |
| `petCollar` | Pet glow aura | reuse `Pet.loadout.collar` (already cosmetic) | Migrate existing collars into registry |
| `jutsuVfxSkin` | Cast particle/sprite palette for a jutsu *family* | `Character.cosmetics.jutsuVfx?: Record<element|family, skinId>` (new) | Maps onto `lib/jutsu-vfx.ts` palette; never changes element/tags |
| `battleEntrance` | Intro animation when a fight starts | `Character.cosmetics.battleEntrance?: skinId` (new) | Plays pre-fight; no combat effect |
| `victoryCinematic` | Win pose / banner | `Character.cosmetics.victory?: skinId` (new) | Post-fight only |
| `profileTheme` | Profile card theme (extends nindoBg) | reuse/extend `Character.nindoBg` allowlist → registry-backed | Superset of the 6 presets |
| `banner` | Profile/roster banner art | `Character.cosmetics.banner?: skinId` (new) | |
| `nameColor` | Username color/gradient in roster, chat, profile | `Character.cosmetics.nameColor?: skinId` (new) | Pure CSS; allowlist of palettes |
| `title` | Wearable title text | extend `earnedTitles` + a `cosmeticTitles[]` source | Registry titles join earned/quest titles |
| `clanEmblem` | Clan crest | `save:clan-<slug>.cosmetics.emblem` (new) | Clan-leader-equipped; greenfield |
| `villageEmblem` | Village crest accent | shared/admin-granted | Admin/event only |
| `sectorDecor` / `homeDecor` | Placed decorations in a player's home/sector tile | `Character.cosmetics.decor?: skinId[]` (new) | Visual only |

### 3.2 The Cosmetic Registry (single source of truth)

New shared helper `api/_cosmetics.ts` (+ a thin client mirror `shinobij.client/src/data/cosmetics.ts`):

```ts
export type CosmeticType =
  | 'petSkin' | 'petCollar' | 'jutsuVfxSkin' | 'battleEntrance' | 'victoryCinematic'
  | 'profileTheme' | 'banner' | 'nameColor' | 'title' | 'clanEmblem' | 'villageEmblem'
  | 'sectorDecor';

export type CosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type CosmeticSource = 'shop' | 'crate' | 'patreon' | 'event' | 'achievement' | 'commission' | 'admin';

export interface CosmeticDef {
  id: string;                 // globally unique, e.g. 'petskin:foxfire-kitsune'
  type: CosmeticType;         // what it skins
  name: string;
  rarity: CosmeticRarity;
  source: CosmeticSource;
  tradeable: boolean;         // can it appear on the auction house?
  giftable: boolean;          // can it be gifted?
  // Acquisition prices (only the relevant ones set):
  priceShards?: number;       // Fate Shards (soft-earnable premium)
  priceCoins?: number;        // Shinobi Coins (real-money premium currency, §6)
  imageKey?: string;          // shared:img:<imageKey> for the art
  // EXPLICITLY no stat/jutsu/gear fields. Adding any is a build error (§9 guard).
}

export const COSMETICS: Record<string, CosmeticDef>;        // the catalog
export function getCosmetic(id: string): CosmeticDef | null; // validation
export function isCosmeticId(id: unknown): id is string;     // allowlist gate
export function isTradeableCosmetic(id: unknown): boolean;   // auction gate
```

**Invariant:** any cosmetic id used anywhere (shop, auction, crate, gift, equip) MUST resolve
through `getCosmetic()`. If it does not, the operation is rejected. This is the structural
defense — see §9.

### 3.3 Ownership / wardrobe model (GW2 transmog)

- **Unlock once, equip anywhere, account-bound on acquire.** When a player obtains a cosmetic
  (buy, crate, gift, commission), it is added to their **owned ledger** and is thereafter
  **soulbound** — it can never be re-traded (prevents RMT laundering; §9). The exception:
  cosmetics flagged `tradeable: true` can be **re-listed on the auction house** *before* first
  equip (PoE "mirror-free" model). Once **equipped**, a tradeable cosmetic becomes account-bound
  ("bind-on-equip"). This mirrors PoE/Dota: the marketplace stays liquid, but equipping ends
  tradeability.
- **Storage** — a new sub-object on the player save (NOT a new top-level KV key, so it rides the
  existing save lock + clamp pipeline):

  ```jsonc
  // save:<name>.character.cosmetics
  {
    "owned":  { "petskin:foxfire-kitsune": { "acq": 1719720000000, "src": "crate", "bound": false }, ... },
    "equipped": {
      "petSkin":         { "<petId>": "petskin:foxfire-kitsune" },
      "jutsuVfxSkin":    { "fire": "vfx:azure-flame" },
      "battleEntrance":  "entrance:leaf-storm",
      "victoryCinematic":"victory:crane-bow",
      "profileTheme":    "theme:royal-deluxe",
      "banner":          "banner:sunset-cliff",
      "nameColor":       "namecolor:molten-gold",
      "title":           "title:ash-walker",
      "decor":           ["decor:lantern", "decor:koi-pond"]
    }
  }
  ```

- **`owned` is the durable wallet of cosmetics; `equipped` is the active set.** Equipping is free
  and reversible (own-once). Pet skins/collars key by petId since a player has up to 5 pets.

### 3.4 Storage keys (in the one-table KV)

| Key | Holds | Lock target | Backend |
|---|---|---|---|
| `save:<name>` (`.character.cosmetics`) | per-player owned + equipped ledger | `save:<name>` | disk overlay (save routing) |
| `save:clan-<slug>` (`.cosmetics.emblem`) | clan emblem | `save:clan-<slug>` | disk overlay |
| `market:listings` | active auction listings (array, capped) | `market:listings` | base store |
| `market:listing:<id>` | a single listing (for idempotent claim receipts) | `market:listings` (board lock) | base store |
| `market:claimed:<listingId>` | NX purchase receipt (idempotency) | — (NX) | base store |
| `gift:nonce:<name>:<nonce>` | gift idempotency receipt | — (NX) | base store |
| `cratecount:<name>:<YYYY-MM-DD>` | daily crate-pull cap counter | `save:<name>` | base store |
| `shinobicoins:order:<orderId>` | premium-currency purchase receipt (webhook) | `shinobicoins:order:<orderId>` | base store |
| `shared:img:cosmetic:<id>` / `shared:imgfields:cosmetic` | cosmetic art blobs (new `cosmetic` category in `KNOWN_PREFIXES`) | — | disk overlay (image routing) |
| `audit:market` (via `_audit.ts` domain `'market'`) | trade-history audit trail | `audit:market` | base store |

---

## 4. Auction house (player↔player COSMETIC listings)

### 4.1 Model

Server-authoritative escrow board, modeled on `api/pvp/bounty.ts` (escrow + idempotent claim +
refund-on-fail) and `api/clan/treasury/donate.ts` (dual-lock debit-before-credit). **Only
`tradeable: true` cosmetics that the seller owns and has NOT equipped (still `bound:false`) may
be listed.** Payment currency: **ryo** (the soft currency) — this keeps the AH a ryo SINK.

- **List:** seller escrows the cosmetic (removed from their `owned`, parked on the listing) and
  sets an ask price in ryo. Listing fee (small, burned) deters spam.
- **Buy:** buyer pays the ask in ryo; the **transaction fee (e.g. 10–15%) is BURNED** (primary
  ryo sink, mirrors `_trade-core.ts` burn); the seller is credited the remainder; the cosmetic
  is added to the buyer's `owned` (`bound:false`, still re-listable until equipped).
- **Cancel:** seller reclaims an unsold listing back into `owned`.

### 4.2 Endpoints (each MUST be created in `api/**` AND `route()`-registered in `server.ts`)

| Endpoint | Method | Body | Lock(s) |
|---|---|---|---|
| `/api/market/auction` | GET | — (returns active listings, `Cache-Control: s-maxage=15`) | none (read) |
| `/api/market/auction` | POST `action:'list'` | `{ playerName, cosmeticId, priceRyo }` | `market:listings` (outer) + `save:<seller>` (inner), both `failClosed` |
| `/api/market/auction` | POST `action:'buy'` | `{ playerName, listingId, nonce? }` | `market:listings` (outer) + `save:<buyer>` + `save:<seller>` (sorted, inner), `failClosed` |
| `/api/market/auction` | POST `action:'cancel'` | `{ playerName, listingId }` | `market:listings` + `save:<seller>` |

(One handler `api/market/auction.ts` switching on `action`, matching the bounty/treasury style.)

`server.ts` wiring (pattern from `server.ts:42,517` and `:150,734`):
```ts
import marketAuctionHandler from './api/market/auction.js';
route('/market/auction', marketAuctionHandler); // registers /market/auction AND /api/market/auction
```

### 4.3 Locking, idempotency, safety (mirrors proven code)

- **Atomicity:** `buy` debits the buyer, credits the seller, and transfers ownership **inside one
  nested `withKvLock(..., { failClosed: true })`** with saves locked in sorted order (no
  deadlock), debit-before-credit (`donate.ts:108-142` pattern). On a credit failure after debit,
  refund the buyer (bounty's `place` credit-back, `bounty.ts:98-115`).
- **Idempotency:** `market:claimed:<listingId>` NX receipt reserved INSIDE the failClosed lock
  (`bounty.ts:146-153`) so a retried buy is a no-op, never a double-charge.
- **Cosmetic-only enforcement:** `isTradeableCosmetic(cosmeticId)` gate at the top of `list`;
  reject otherwise (a power item has no registry entry, so it can never be listed — §9).
- **Anti-alt funnel:** `hasRecentIpOrFpOverlap(seller, buyer)` voids a sale between accounts on
  the same connection (`bounty.ts:144`, `trade.ts:72-78`).
- **Caps:** per-player max active listings (e.g. 20); ryo price floor/ceiling (mirror
  `_trade-core.ts` caps); rate limit `enforceRateLimitKv(..., 'market-<action>', 20, 60_000)`.
- **Audit + telemetry:** `recordAudit({ domain:'market', action:'auction.buy', ... })`
  (`_audit.ts`); `recordEconomyTxn({ currency:'ryo', delta:-burned, source:'market.burn' })`
  (`_economy.ts:71`).

---

## 5. Cosmetic crates ("Cosmetic Black Market")

Reuse the festival gacha tech wholesale — **cosmetics-only payout table**.

- **Pure roll module** `api/_cosmetic-crate.ts` modeled on `api/festival/_black-market.ts:37-55`:
  a seeded-`rand` function returning a `{ tier, cosmeticId }` from a **registry-filtered**
  table (only `source:'crate'` ids). Unit-testable with a pinned rng (mirrors
  `_black-market.test.ts`).
- **Handler** `api/cosmetic-crate.ts` modeled on `api/festival/black-market.ts:34-90`: under the
  save lock, check daily cap (`cratecount:<name>:<day>`), debit the crate cost (Fate Shards
  and/or Shinobi Coins — never ryo-only so it stays premium), roll a cosmetic id, **add it to
  `owned`** (NOT currency), bump the counter. Server-authoritative — the client renders only what
  is returned.
- **Duplicate protection:** if the rolled cosmetic is already owned, convert to a small Fate-Shard
  / "dust" refund (PoE-style) so crates never feel dead. The refund is a *cosmetic-currency*
  refund, never power.
- **No power in the table — ever.** Every entry is a registry id with `type ∈ CosmeticType`. The
  §9 test asserts the table ⊆ registry ∩ cosmetic.
- **UI:** reuse `components/BlackMarketCrate.tsx:1-60` reveal animation, swapping currency rows for
  a cosmetic-card reveal.
- **server.ts:** `import cosmeticCrateHandler from './api/cosmetic-crate.js'; route('/cosmetic-crate', cosmeticCrateHandler);`

---

## 6. Monetization (PoE model — large revenue, zero P2W)

### 6.1 Premium cosmetic currency — "Shinobi Coins"

- New currency `shinobiCoins`, **bought with real money only** and spendable **only on
  cosmetics** (shop + crates). It is NOT in `_economy.ts` faucet/sink telemetry as an earnable —
  it is a stored-value field on the save: `Character.shinobiCoins?: number`.
- **It can buy nothing that affects combat.** The shop and crate handlers accept `shinobiCoins`
  *only* for items whose registry `type ∈ CosmeticType`. There is no path from `shinobiCoins` to
  ryo, stats, jutsu, or gear.
- **Crediting is webhook-driven and idempotent** (Stripe or Patreon). A `/api/billing/webhook`
  handler verifies the provider signature, writes a `shinobicoins:order:<orderId>` NX receipt
  under `withKvLock(orderId, { failClosed:true })`, then credits the buyer's save. Real-money
  credits are the ONE place client-reported amounts are irrelevant — the amount comes from the
  signed webhook payload, never the client (consistent with the anti-cheat doc's "never trust the
  client for currency").

### 6.2 Patreon-exclusive cosmetics + supporter status

- New optional fields: `Character.supporterTier?: string`, `Character.supporterUntil?: number`
  (epoch ms), set **only** by the verified Patreon/Stripe webhook (§6.1) — never client-writable
  (add to the save validator's server-set / clamped fields like the currency caps in
  `api/save/[name].ts:336-339`).
- Patreon tiers grant: a monthly **Shinobi Coins stipend**, **`source:'patreon'` exclusive
  cosmetics** auto-granted into `owned` while active, a supporter **nameColor/banner**, and a
  supporter **title**. All cosmetic. Patreon link already in app (`MobileNav.tsx:148`).
- **Lapsing a tier never removes earned cosmetics** (they stay in `owned`) — only the *recurring*
  perks (stipend, supporter badge) stop. This avoids the "I paid and lost it" churn trap.

### 6.3 What is explicitly NOT sold

No stat boosts, XP boosts that change ranked outcomes, jutsu, gear, pets-with-stats, energy/AP,
ranked entries, or anything that shortcuts the power curve. "Convenience" is limited to
**cosmetic wardrobe slots, extra auction listing slots, and crate keys** — none of which touch
combat.

---

## 7. Gifting (mentorship vector) & cosmetic commissions

### 7.1 Gifting

- `/api/market/gift` POST `{ fromPlayer, toPlayer, cosmeticId, nonce? }`. Modeled on
  `api/player/trade.ts` (dual save lock, idempotent nonce, IP/FP anti-alt void).
- Only `giftable: true`, still-unbound cosmetics can be gifted. The cosmetic moves from sender's
  `owned` to recipient's `owned`. **A small ryo "wrapping fee" is burned** (sink) — optional, but
  recommended to deter alt-funnel spam, and consistent with taxing all transfers.
- **Mentorship hook:** a mentor who has graduated a mentee (existing mentorship/onboarding data,
  if present) gets a free wrapping fee or a one-time exclusive gift cosmetic — turning teaching
  into a cosmetic reward loop with zero power transfer.
- `server.ts`: `route('/market/gift', marketGiftHandler);`

### 7.2 Cosmetic commissions (crafter-profession economy role)

Gives crafter professions an economy role **without power** (today crafting can produce gear with
stats — that stays out of this system):

- A **commission board** (`/api/market/commission`, escrow model from `bounty.ts`): a buyer posts
  ryo + a request ("a fire-VFX skin in my clan colors"); a crafter-profession player claims it,
  the server mints a **cosmetic-only** result (a registry id flagged `source:'commission'`, art
  generated/selected, image stored at `shared:img:cosmetic:<id>`), and on delivery the ryo is
  released (fee burned) and the cosmetic is added to the buyer's `owned`.
- The mint MUST go through the registry (`getCosmetic`/insert), so a crafter can only ever produce
  a cosmetic, never a stat item. Crafter profession-rank can gate *which cosmetic tiers* they can
  commission (a progression hook that is purely cosmetic).
- v1 can be simplified to a **fixed cosmetic catalog the crafter "applies"** (no free-form art) to
  avoid moderation/asset cost; free-form art is a later phase using the asset-gen tooling
  (`scripts/gen-asset.mjs` → gpt-image-1 → `shared:img:*`, per project memory).

---

## 8. UI surfaces

| Surface | Where | Reuse |
|---|---|---|
| **Marketplace / Shop** | New top-level screen `src/screens/Marketplace.tsx` (Card-Hall-style tabbed hub): tabs = *Shop* (premium + Fate Shard), *Auction House*, *Crates*, *Commissions* | Tab pattern from Card Hall; `authFetch.ts` for calls |
| **Wardrobe** | New section in `screens/Profile.tsx` (next to Nindo/Title editors, `Profile.tsx:405-469`): grid of `owned` cosmetics, equip toggles per slot | Extends existing Profile cosmetic UI; `NindoEditor` as the pattern |
| **Pet skin/collar picker** | `screens/PetYard.tsx` (already hosts the collar picker) — add skin slot | Existing collar UI in PetYard |
| **VFX / entrance / victory preview** | Wardrobe sub-panel with a small in-canvas preview reusing `lib/jutsu-vfx.ts` | jutsu-vfx render path |
| **Name color / banner / theme** | Profile card live preview | nindoBg preset picker pattern |
| **Crate open** | Modal reusing `components/BlackMarketCrate.tsx` | direct reuse |
| **Mobile** | All screens must fill `100dvh`, no overlapping side panels (per CLAUDE.md); Marketplace tabs collapse to a `MobileNav`-style bottom bar | `components/MobileNav.tsx` |

App.tsx is at its line-budget ratchet (`src/App.size.test.ts`) — **all new screens/components go
in their own modules** under `src/{screens,components,lib,data}/`, never in App.tsx.

---

## 9. Anti-RMT / anti-abuse & the mechanical pillar guard

### 9.1 Structural defenses (defense-in-depth)

1. **Cosmetic-only = nothing valuable to launder.** Because the market/crate/gift can only move
   registry cosmetics, and cosmetics confer no power, the *incentive* for RMT collapses (PoE's
   core insight). This is the strongest defense.
2. **Account-bind on equip (bind-on-equip).** Tradeable until equipped, then soulbound. Caps how
   far any single cosmetic can circulate.
3. **Transaction-fee ryo burn** on every auction sale and gift — the same sink mechanic as
   `_trade-core.ts:16,52-53`, recorded via `_economy.ts:71`.
4. **Anti-alt:** `hasRecentIpOrFpOverlap` voids same-connection auction sales and gifts
   (`_player-ips.ts:80-93`).
5. **Audit trail:** every list/buy/cancel/gift/commission/crate logged via `_audit.ts` (new
   `'market'` domain) — investigable after the fact.
6. **Rate limits:** `enforceRateLimitKv(..., { strict:true })` on cost-bearing endpoints; daily
   crate cap.

### 9.2 THE HARD GUARD — the market can never list/crate/sell a power item

A registry + a test, not reviewer discipline:

- **`api/_cosmetics.ts` is the only allowlist.** Shop, auction `list`, crate table, gift, and
  commission mint ALL call `getCosmetic(id)` / `isCosmeticId(id)` and reject a miss. A power item
  (gear, jutsu, pet-pvp-gear) has no registry entry → unlistable, uncrateable, ungiftable by
  construction.
- **`CosmeticDef` has no stat/jutsu/gear fields.** The type makes "a cosmetic with power" not
  expressible.
- **`api/_cosmetics.test.ts` (new, hard-fails the build):**
  - every `COSMETICS` entry has `type ∈ CosmeticType` and **no** key matching
    `/stat|atk|def|dmg|hp|chakra|jutsu|power|mult|bonus|gear|pvp|pve|level|xp/i`;
  - the crate payout table ⊆ registry-cosmetic ids;
  - the auction `list` validator rejects any id not `isTradeableCosmetic`;
  - a regression fixture: attempt to list `'item:legendary-blade'` / a pet `pvp` gear id → 400.
- **Route-parity test** (`server-routes.test.ts`) already enforces every new endpoint is wired on
  both bare + `/api` paths; the new market/crate/gift/billing routes join it.

### 9.3 Premium-currency integrity

- Shinobi Coins, `supporterTier`, `supporterUntil` are **server-set only** (webhook), added to the
  save validator's non-client-writable set (alongside the currency clamps at
  `api/save/[name].ts:336-339`). A tampered client save can never mint coins or supporter status.
- Webhook handler verifies provider signature and is idempotent per `orderId`.

---

## 10. Phased build plan (MVP → full)

### Phase 0 — Registry + wardrobe foundation (no economy yet)
- **Files:** new `api/_cosmetics.ts`, `api/_cosmetics.test.ts`, `shinobij.client/src/data/cosmetics.ts`;
  extend `shinobij.client/src/types/character.ts` with `cosmetics` ledger; extend
  `api/save/[name].ts` to validate `character.cosmetics` (owned ⊆ registry; equipped ⊆ owned;
  clamp like nindoBg `:298-301`); migrate existing pet collars into the registry.
- **Storage:** `save:<name>.character.cosmetics`.
- **Wardrobe UI:** `screens/Profile.tsx` section to equip already-owned cosmetics (collars,
  nindoBg→profileTheme, earnedTitles) — surfaces value before any purchase exists.
- **Tests:** `_cosmetics.test.ts` (the §9.2 guard), save-validator clamp test, `App.size.test.ts`
  unaffected (new modules).
- **DoD:** players can equip/unequip owned cosmetics; tampered cosmetic ids rejected server-side;
  guard test green; `npm test` + client `npm run lint` pass; `dist/` rebuilt + committed.

### Phase 1 — Cosmetic crates (first faucet, first sink)
- **Files:** new `api/_cosmetic-crate.ts` (+ test), `api/cosmetic-crate.ts`, `server.ts` wiring;
  client `screens/Marketplace.tsx` (Crates tab) reusing `components/BlackMarketCrate.tsx`.
- **Endpoints:** `POST /api/cosmetic-crate` (+ `/api/...`).
- **Storage:** `cratecount:<name>:<day>`, writes to `owned`.
- **Locking/idempotency:** save-lock failClosed; daily cap; dup→dust refund.
- **Tests:** seeded-rng payout test (table ⊆ registry-cosmetic); daily-cap test.
- **DoD:** server-authoritative pulls; never returns power; route-parity test green; dist committed.

### Phase 2 — Premium currency + shop + monetization
- **Files:** `Character.shinobiCoins/supporterTier/supporterUntil` (+ validator server-set);
  `api/shop/purchase.ts` (Fate Shards / Shinobi Coins → cosmetic into `owned`);
  `api/billing/webhook.ts` (signed, idempotent credit); `server.ts` wiring; Marketplace *Shop* tab.
- **Storage:** `shinobicoins:order:<orderId>`.
- **Locking/idempotency:** `withKvLock(orderId, failClosed)`; NX order receipt.
- **Tests:** webhook signature + idempotency; shop rejects power ids; coins-can't-buy-power test.
- **Risks:** real money — webhook spoofing (mitigated by signature verification + the stripe skill
  guidance); refunds/chargebacks (revoke coins, keep audit).
- **DoD:** end-to-end purchase credits coins via webhook only; supporter status server-set;
  guard tests green.

### Phase 3 — Auction house (player↔player, the primary ryo sink)
- **Files:** `api/market/auction.ts` (+ test), `server.ts` wiring; Marketplace *Auction* tab;
  add `'market'` domain to `api/_audit.ts`.
- **Endpoints:** `GET/POST /api/market/auction` (`list`/`buy`/`cancel`).
- **Storage:** `market:listings`, `market:claimed:<id>`.
- **Locking/idempotency:** board lock + sorted save locks, failClosed, debit-before-credit,
  refund-on-fail, NX claim; IP/FP anti-alt; bind-on-equip ends tradeability.
- **Tests:** escrow/settle atomicity; idempotent buy; cosmetic-only list rejection; alt-funnel void;
  fee-burn telemetry.
- **DoD:** two-account list→buy works; fee burned + logged; can't list power; can't double-buy;
  dist committed.

### Phase 4 — Gifting + commissions (mentorship + crafter economy)
- **Files:** `api/market/gift.ts`, `api/market/commission.ts` (+ tests), `server.ts` wiring;
  Marketplace *Commissions* tab; mentorship hook.
- **Tests:** gift idempotency + anti-alt; commission escrow + cosmetic-only mint.
- **DoD:** gifting and (v1 fixed-catalog) commissions work cosmetic-only; guard tests green.

### Phase 5 — Breadth (entrances, victory cinematics, emblems, decor, free-form commission art)
- Add cosmetic *types* and art (`scripts/gen-asset.mjs` → `shared:img:cosmetic:*`), clan emblem on
  `save:clan-<slug>.cosmetics`, sector/home decor placement. Each new type is just a registry
  addition + a render hook + a wardrobe slot — no economy rework.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **RMT** | Cosmetic-only removes the incentive (§9.1); bind-on-equip; fee burn; anti-alt; audit. |
| **Pillar regression** (someone slips a power item into the market) | The registry + `_cosmetics.test.ts` hard guard (§9.2): a power item is *unexpressible* and *unlistable*; build fails. |
| **Save-compat** | `character.cosmetics` is additive + optional; absent on old saves = no cosmetics owned; validator treats missing ledger as `{}`. No schema migration (per CLAUDE.md, no Supabase schema change). |
| **Real-money fraud / chargebacks** | Webhook-only credit, signed + idempotent; revoke-on-chargeback path + audit; never client-reported amounts. |
| **Churn ("I paid and lost it")** | Lapsed supporters keep `owned` cosmetics; only recurring perks stop (§6.2). |
| **Image/asset cost & bloat** | Reuse the `shared:img` disk-overlay routing (large blobs off Supabase); 200 KB compact ceiling already enforced (`shared-images.ts`); cosmetic art is shared (`shared:img:cosmetic:<id>`), not per-player. |
| **Economy inflation** | Crates/gifts/auctions are net ryo-neutral-or-negative (fee burns); telemetry (`_economy.ts`) makes faucet/sink measurable. |
| **cPanel staleness** | After any `api/`/`server.ts` change, `npm run build` + commit `dist/` (both root and client) in the same change (CLAUDE.md hard rule); Railway self-builds. |
| **CORS drift** | No new custom headers needed (reuse `authFetch`); if any added, sync `api/_utils.ts` ↔ `server.ts` (CLAUDE.md). |

---

## 12. How the cosmetic-only rule is mechanically enforced (one-paragraph summary)

Every acquire/move/equip operation in the system validates its target id against a single
allowlist registry (`api/_cosmetics.ts`); the `CosmeticDef` type cannot express a stat/jutsu/gear
field; a build-failing test (`api/_cosmetics.test.ts`) asserts the registry, the crate table, and
the auction validator contain only cosmetic ids and reject known power ids; premium currency and
supporter status are server-set webhook-only and can buy nothing combat-relevant; and equipping
binds a cosmetic to the account so it leaves circulation. A power item has no registry entry, so
it is structurally unlistable, uncrateable, unsellable, and ungiftable — the pillar is enforced
by construction, not by review.
```

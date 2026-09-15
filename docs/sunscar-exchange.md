# Sunscar Exchange

## Player experience

The Exchange occupies the festival's top-middle card. Dice of Fate occupies the bottom-right card.

The trading hall supports browsing, text search, category, rarity, and listing-currency filters, budget filtering, sorting, pagination, inspection, publishing a listing, buying a whole lot, cancellation, and personal trade history.

Supported assets are owned pets, named weapons and armor, regular equipment and accessories, consumables, crafting materials, extra Chronicle cards, and Fate Shards, Bone Charms, Aura Stones, Honor Seals, and Mythic Seals. Sellers choose ryo or Fate Shards for each listing. Buyers pay the listed currency; there is no automatic conversion.

- Listings are free. The seller pays a 5% fee in the listing currency when a sale completes, rounded down to a whole unit. A 201 Fate Shards sale deducts 10 Shards and pays the seller 191 Shards.
- Prices are for the entire lot. There are no auctions or partial fills.
- Limits: 30 open listings per seller, 2,000 open listings overall, 9,999 units per lot, and 1,000,000,000 units of the selected currency per lot.
- Both wallet balances appear in the hall. Budget filtering uses each listing’s currency; price sorting groups ryo and Fate Shards separately. Checkout and trade history retain the exact currency.
- Listings remain open until purchased or cancelled. Nothing expires out of escrow.
- Equipped items must be returned to the backpack. Active, assigned, training, breeding, expedition, and equipped pets must be freed before listing. Sanctuary pets must first move into the carried roster.
- Starter card quantities and Chronicle progression unlocks remain with the character. Extra copies of starter cards can trade.
- Existing gear level requirements and inventory, stack, card, and carried-pet capacity rules apply before charging the buyer.
- Named gear transfers its complete server-held definition. Named-weapon elemental attunement transfers with it. Pets retain their instance ID, level, growth, traits, nickname, lineage, and remaining breeding uses.

## Authority and recovery

`POST /api/festival/exchange` is registered in the Express API router. It authenticates the acting player, requires guests to claim their account, applies the strict rate limiter, and never accepts client-supplied asset definitions or seller proceeds.

Listing states are `preparing → active → buying → sold` or `active → cancelling → cancelled`. Ownership moves into escrow before a listing becomes available. Purchase saves atomically combine buyer debit, asset delivery, and a receipt; seller credit has its own receipt.

The listing journal uses exact compare-and-set transitions and has no TTL. Player mutations use the existing versioned save writer and currency-ledger projection. Pending transfer receipts are server-owned and retained until their listing phase completes. Named definitions are included in the accepted client save snapshot.

Creation request IDs are permanently bound to their payload, including the asking currency. Existing listings without a currency and existing creation fingerprints remain ryo-compatible. A buy quote must match both price and currency; missing currency is accepted only for ryo. Buyer debit, seller credit, fee, and economy events use the listing’s currency. A Fate Shards resource lot priced in Shards preserves both delivery and payment, while still requiring sufficient funds before delivery.

Creation request IDs are permanently bound to their payload. Buying and cancelling replay against the same immutable listing identity. The client retains an unconfirmed request in session storage, disables a new trade, and retries that same request after connection loss.

Browsing recovers the player's interrupted transfers. The existing five-minute settlement reconciliation job also recovers up to 50 pending Exchange records per pass, including when both parties are offline. Exchange records bypass worker-local storage caching. Active listing reads use batched storage retrieval; personal history retains 100 terminal index entries while permanent transaction records remain available.

Each transfer phase has its own recovery pointer so delayed cleanup cannot remove a later purchase's recovery record. Capacity-blocked returns retain their goods and saved cancellation request; players make room and retry. Failed recovery entries move to the back of the scheduler queue so later trades can finish. Failed buyers are excluded from private trade history. Missing owned named definitions are restored from the durable forge registry, and ladder-defense pets show their restriction in the sell inventory.

Refresh resumes an unconfirmed trade. A rejected stale character response retains the saved request until a current response is adopted. Leaving the screen aborts client adoption; re-entering resumes the same request. The mobile Refresh control has an explicit accessible name.

## Verification

- 117 targeted tests passed: Exchange, authenticated save/reload integration, existing festival behavior, save ownership, storage, scheduler, and route registration.
- Exchange coverage includes authentication, invalid values, request-ID conflicts, self-buy, foreign cancellation, duplicate retries, concurrent buyers, named weapon and armor definitions, elemental attunement, pet lineage and progress, busy and full pet rosters, card floors and capacity, missing seller accounts, mixed legacy stacks, resource transfers, interrupted escrow, interrupted seller credit, and offline reconciliation.
- Authenticated integration tests cover normal and strict save-ledger modes, stale autosave refusal, all resource currencies, companions, cards, stack materials, named weapon/armor equipment, and named gear resolving in the shared combat builder.
- Egg-hatched Chromatic pets retain their palette variant, hatch timestamp, breeding session, and lineage through trading and save/reload. Unhatched eggs are not listed as assets.
- Browser checks use real handlers, normal player session tokens through `authFetch`, and the application's save coordinator with isolated in-memory accounts: buy, sell, review, cancellation, filters, search empty states, pet inspection, keyboard dismissal, lost-response Refresh, stale-response retry, leaving during a committed trade, re-entry, and browser reload.
- Desktop and 390px mobile layouts were inspected. Axe WCAG A/AA checks passed for the hall and inspection dialogs.
- Client and server TypeScript checks and scoped ESLint checks passed. The production Vite build passed in an isolated output directory.

Repeat browser checks:

```powershell
cd shinobij.client
node node_modules/vite/bin/vite.js build --config scripts/vite.sunscar-exchange-qa.config.mjs
cd ..
node --import tsx scripts/sunscar-exchange-qa-server.mts
# In a second terminal:
node shinobij.client/scripts/sunscar-exchange-browser-qa.mjs
```

The QA server binds only to localhost, serves a production-mode preview, creates disposable in-memory saves, and is not part of the production build. The browser script resets these fixtures before each run. Screenshots and the browser report live in `docs/screenshots/sunscar-exchange/`.

The release candidate was prepared on `origin/main` revision `96b892d0b63fa2e4f3ed28c224b9bf2c6a853330` with the locked dependencies and Node 22.23.1. The current-main test set covers 120 tests, including the App size ratchet; the ownership fixture explicitly includes the new Exchange receipt. Browser flows were repeated successfully from that clean checkout. Test trading uses disposable local accounts.

## Fate Shards release verification

Prepared on main revision `bcd04b427335eebe875ac90fb408a4e429ca9fbd` with Node 22.23.1.

- 40 Exchange, authenticated save integration, and ownership tests passed. Both currency paths cover named gear, egg-hatched Chromatic pets, cards, materials, and resources through normal and strict-ledger save/reload.
- Shard-specific checks cover fee rounding, insufficient and missing balances, legacy ryo compatibility, mismatched currency quotes, reused request IDs, cancellation, ambiguous seller writes, offline recovery, and same-currency resource delivery.
- Browser checks passed for currency/budget filters, exact Shard checkout balances and delivery, listing review with the 5% fee, free cancellation, and lost-response retry with a saved Shard request. Existing ryo purchase and navigation/reload recovery checks also passed.
- Desktop and 390px mobile screenshots were reviewed; accessibility checks reported no WCAG A/AA violations. Scoped client ESLint passed.
- The full production build passed, including server/client TypeScript, story-content checks, distribution verification, and build-size gates.

## Artwork

Built-in imagegen generated the trading-hall illustration. The project asset is `shinobij.client/src/assets/festival/sunscar-exchange-v1.webp` (1440 × 960, approximately 258 KB). Existing game artwork and category glyphs provide listing thumbnails.

Final image prompt:

> Create a premium fantasy RPG environment illustration, wide 3:2 composition, for Sunscar Exchange, a permanent shinobi desert caravan trading hall. No text, no lettering, no logos, no UI. Warm sandstone vaulted bazaar with elegant carved arches, layered deep teal awnings, hanging brass lanterns, desert sunset through a central courtyard arch. On the right foreground an exquisitely crafted curved sword on a display stand, dark ornate samurai armor, a small calm fox companion with subtle ember markings, rolled scrolls and trade scales; travelers and merchants in distant background only. Authentic tactile painted materials, cinematic depth, rich muted amber and antique gold with restrained turquoise accents, sophisticated hand painted Japanese fantasy concept art, polished AAA game environment splash art. Left third relatively dark and uncluttered for UI title overlay. Interesting silhouette and strong focal point around the glowing central courtyard, no modern objects, no gambling imagery.

# Player friction and "vibe-coded tell" audit — 2026-10-14

Scope: every player-facing screen in `shinobij.client/src`, the shipped `public/` folder, the boot shell
(`index.html`), and the server's response headers. Four read-only passes ran in parallel (copy, visual,
interaction, technical/meta), and every finding below was confirmed by reading the code. The live site was
probed for the meta findings.

## What counts as a tell

A "vibe-coded tell" is a pattern players and designers have learned to read as "nobody reviewed this".
The checklist came from published sources, then was narrowed to what applies to a dark-fantasy browser RPG:

- **Visual** (Fountain Institute, *7 Signs a UI Has Been Vibe Coded*; the `ux-skill` "AI slop" field guide):
  purple-to-indigo gradients, decorative glow, emoji used as icons, cards nested in cards, `rounded-2xl`
  everywhere, uniform hover lifts, infinite decorative motion, stock Tailwind colours instead of a palette.
- **Copy** (WikiProject AI Cleanup's *Signs of AI writing*, via FlowingData and Pangram): "not just X, it's Y",
  everything in threes, verbless tricolons, "legend/journey/beyond" marketing vocabulary, cheer ("Success!"),
  and developer text leaking to players ("Failed to fetch", "HTTP 502", snake_case codes).
- **Friction** (Nielsen's heuristics as adapted for games by Celia Hodent): visibility of status, error
  prevention and recovery, recognition over recall. In practice: blocking modals for routine results,
  irreversible spends with no confirm, disabled buttons that never say why, double-submit, typo traps,
  hover-only explanations that phone players can never see.

The project's own design system already bans most of these (`docs/VEILED_STEEL_UI_SYSTEM.md`, "Avoid"), so
"violates our written system" was the strongest evidence a finding could have.

No reward, cost, price, cooldown, odds or combat formula changed anywhere in this pass. Every confirm added
below guards a spend or a loss the server already performs.

## Applied: friction

**Routine results no longer need a click.** The Notice modal stays for things a player must acknowledge;
these were plain status and are toasts now.
- World map Explore ("Sector N explored. +X ryo.") and Recover, up to about 100 a day.
- Pet Yard feed (one modal per treat), training collected, expedition started.
- Crafter forges (named, key, relic, core), Weekly Board claim, Bounty placed, the migrated-contract notice.
- Seven Clan Hall successes (mission claim, mentoring, recruitment pitch, join request, terrain, scroll).

**Real losses ask first** (`gameConfirm`, danger style).
- Abandoning a field contract (Mission Hall and Logbook), which zeroes explore and raid progress.
- "Ask for a different proof" in Legacy, which resets trial progress.
- Paid element reroll (10 or 15 Fate Shards, random result), naming the element it replaces.
- The 10 Fate Shard Hollow Gate Key forge, which sits directly under the Dungeon Keys forge.
- "Finish now" with Honor Seals (the ryo finish already confirmed).
- Swapping or clearing pet PvE gear that still has durability. The server discards it.
- Clan treasury sends, showing the net after the 10% levy.
- Inventory: selling an equipped piece, an epic-or-better piece, or "Sell All" takes the same two-tap arm
  named gear already used.

**Destructive confirms open on Cancel**, so a stray Enter cannot release a companion, delete a clan or
concede a war. The Notice ignores a held Enter, and an Enter typed into chat in the 250 ms as it arrives.

**No double-spend.** "Buying…", "Forging…", "Spending…" and similar verb labels, with the button disabled
while in flight: Shop, Crafter special forges, Mastery "+1" and Respec, Clan create, join, kick, leave,
supply collect and mentor actions, Seal Pool buttons.

**Buttons say why they are grey.**
- Equip and Buy show "Requires Lv. N" or "Needs the X element" instead of refusing after the tap.
- Forge shows "Level N required", "Not enough ryo" or "Missing materials".
- These reasons are visible text instead of a tooltip a phone never shows:
  - Attune;
  - "Reroll both";
  - the active training session;
  - happiness upkeep;
  - the 2v2 partner;
  - gathering tools never used in battle.

**No lost input.**
- Post Clan Notice no longer clears the draft when the save fails.
- The Shop quantity and Profile stat inputs no longer turn "25" into "125". The stat input is a permanent
  spend.

**Visual behaviour.**
- 17 card hovers no longer stick on phones after a tap; the ratchet drops from 56 to 39.
- Disabled buttons no longer lift and glow on hover.
- Five infinite pulses now stop under Reduce Motion.
- A besieged sector keeps a static danger ring on weak phones and under Reduce Motion. Before, it had no
  mark at all.

## Applied: copy tells

**Developer text no longer reaches players.**
- `showGameAlert` is the one choke point every `alert()` passes through. It now rewrites these messages:
  - "Failed to fetch", "Load failed", "NetworkError…" and a 502 page parsed as JSON ("Unexpected token")
    → "The server could not be reached. Check your connection and try again."
  - A bare "Internal server error." → "The server could not finish that. Try again in a moment."
- About 30 API clients dropped "(HTTP 502)" / "Request failed (503)" tails for sentences that say what to
  do.
- The same fix covers sector and clan chat, clan war, village war and the PvP log, plus the raw codes
  `mission_not_eligible` and the 14 kebab-case breeding codes.
- A failed PvP move says it *may* not have gone through, because a 5xx can follow a committed move.

**Engineering words replaced.**
- "Verify Exit Safety", "Return Safely" and "Settlement pending" on the PvP connection card and result
  panel.
- "Movement remains server-blocked" (which also had a double period).
- "recalibrated an older field contract onto its verified ledger".
- "per call".
- The "Success:" / "Error:" / "Awakened:" colour prefixes, which were rendered verbatim on five screens.

**Placeholders and debug.**
- The literal "Loading Screen" / "Restoring the next view..." fallback is gone, and 13 more screens have
  their own line.
- The Pet Gauntlet's "build g23" tag is removed.
- A mis-encoded "Claimingâ€¦" now renders correctly.

**Honest error boundaries.** Both promised "your progress is saved", and labelled a whole-game reload
"Reload Current Screen".

**AI-shaped and cheer lines.**
- "A wise shinobi builds a squad, not just a hero."
- "Healed! +40 XP (mission complete!) — Rank 3!" now says "profession XP" in whole sentences.
- "⚔️ You cannot leave during a battle. Finish the fight first!" existed in two versions.

**Emoji used as icons.** The save-error banner uses the warning art instead of ⚠️. Broken card art shows the
Card Hall glyph; the 🃏 fallback never actually rendered.

## Reverted on review

`AMBIGUOUS_ACTION_MESSAGE` ("Action unconfirmed. Refresh before retrying.") was briefly rewritten to "reopen
this screen". It was put back. `permanent-action-safety.test.ts` deliberately requires paid flows to send
players to *refresh*, which forces an authoritative re-read before a retry. "Reopen this screen" may not do
that. The real conflict with the save-error banner ("do not refresh") is listed below for a decision.

## Owner decisions (not applied: taste, brand or balance-adjacent)

### 1. The landing page carries the strongest AI-marketing tells in the game

Every new visitor sees it first.

**Verbless tricolons** (`StartScreen.tsx`):
- "Your village. Your path. Your legend."
- "Rival villages. Hidden stories. A path that is yours to choose."
- "Find your clan. Raise your companions. Grow stronger together."
- "Master your jutsu. Meet your rivals. Earn your place among legends."
- "Choose your village. Create your shinobi. Take the first step."

**Layout:** three equal numbered cards (`01 / DISCOVER`, `02 / CONNECT`, `03 / RISE`).

**Repeated vocabulary:** "legend" about eight times, plus "Beyond the village gates, a thousand paths
unfold", "More than a battle", "A bond beyond battle", "Your next chapter is waiting" and "Forge your
legend".

**One action, four labels.** The same play button is called "Play Free", "Enter the World", "Begin Your
Journey" and "Start Playing". "Account" and "Log In" both open the same view.

Proposed copy: concrete facts in whole sentences.
- Eyebrow: "A free shinobi RPG you play in your browser."
- Card 1: "Pick a village, take its missions, and fight its rivals for the map."
- Card 2: "Join a clan and raise companions who fight beside you."
- Card 3: "Train your jutsu, climb the ranked ladder, and earn a place in the Hall of Legends."
- Closing line: "Pick a village and make your shinobi to begin."
- One play label everywhere ("Play free") and one login label ("Log in").

### 2. One house style for button case

Player screens split almost evenly: 155 distinct Title Case labels and 158 sentence case labels. Twelve
actions exist in both forms, for example "Try Again"/"Try again", "Claim Reward"/"Claim reward" and "Leave
Queue"/"Leave queue". Recommendation: sentence case, locked with a source test like the touch-hover ratchet.
About 20 labels still use "..." instead of "…", including the start screen.

### 3. Re-skin debt against Veiled Steel

The written system says "Avoid gold on every border, rounded SaaS cards, giant blur shadows, constant glow".
Each item below changes how the game looks, so none was touched.

| Where | What | Size of the change |
| --- | --- | --- |
| Companion Home (`pet-home.css`) | The most "AI dashboard" screen. It has its own palette, 12–24px radii on almost everything, shadows up to `0 30px 90px`, a glass blur, and cards nested in cards. | One file; token swap proposed in the audit notes |
| Daily Briefing (every login) | 16px card holding 12px strips, a stock amber claim button with an infinite glow, Fate Shards in an off-palette violet | One file |
| Retired yellow `#facc15` family | 746 uses in 138 files beside `--sj-gold`. A parallel `--bsv2-*` palette is defined identically four times. | Mechanical alias plus `color-mix` |
| Gold hairlines | 547 declarations, 81 of them `!important` in `profile-skin.css`, beating the neutral border token | Broad |
| Electric blue `#4ea8ff` hover/selection | 83 uses. Veiled Steel uses spirit teal and the village accent for selection. | Medium |
| Violet primaries | Hollow Gate boss button `#6d28d9 → #c026d3` (the most textbook purple gradient in the repo); Tower PvP primary; ANBU Stronghold threat bar (red is reserved for danger) | Three rules |
| Rarity chips | Tailwind-500 tints, while the `--rarity-*` tokens go unused. Mythic is violet on companions and seal-red everywhere else. | Every item chip |
| Inline styles | 2,220 `style={{}}` objects with 896 hard-coded hex values. Worst: PetColiseum 92, PetGauntlet 73, VillageWarScreen 62, LegacyPanel 57. | Per screen |
| Boot splash and manifest | `theme-color #0f172a` (Tailwind slate), slate text, an amber reload button and a 1.1rem panel. The manifest also feeds the Android shell. | Brand |
| Smaller items | XP bar indigo-to-cyan gradient; glowing rail currency numbers; Tailwind rainbow hunter-rank badges; Daily Briefing horizon bars; repeated Hall of Legends tab icons; a `⛩` CSS emoji map mark; 12px `!important` mobile panels vs the system's 6px; `Georgia` hard-coded 220 times; 8 one-off "✕" buttons beside the `CloseButton` primitive; decorative emoji left in "⭐ Mastery", "♛ Subscription Benefits", "⚔ Fight again" and the milestone toast | Small each |

### 4. Copy and behaviour calls

- **Refresh or not.** "Action unconfirmed. Refresh before retrying." can show while the save-error banner says
  "Do not refresh". Paid flows deliberately ask for a refresh (see "Reverted on review"). A decision is
  needed on which advice wins during a save outage, or on a re-read that is not a page reload.
- **"Coming soon" item in a live shop.** The Clan Exchange lists "Clan Banner Sigil" for 500 CP as
  "Coming soon". Recommendation: hide it until it ships.
- **Engineering words still on post-fight screens.**
  - "Battle settlement callbacks did not finish" and "Battle settlement is pending: \<code\>"
    (`PvpBattleScreen.tsx`).
  - "its active battle lease could not be retired" (`api/pet/battle-result.ts`).
  - "the same battle receipt will be replayed safely" and "Battle authority" (`PetArena.tsx`).
  - "until server-authoritative settlement is live" (`WeeklyBossArena.tsx`).
  - Several of these are pinned by e2e specs.
- **Server-side "Internal server error."** 217 handlers return it. The client now rewrites it at the alert
  choke point; a source-side constant would fix inline setters too.
- **One-tap premium donations.** Six adjacent "Donate 1 Fate Shard / Mythic Seal" buttons have no confirm.
  The amounts are small.
- **A confirm that could go.** Training "Remove · full refund" confirms a fully refunded action.
- **Post-fight world-map outcome lines** ("The patrol yields…", "Boss wave recorded 2/5") open modals. The
  routine ones could be toasts.

## Follow-ups found during the fixes (not applied)

- **Missions "Remove" on an archived card does nothing useful.** It shows an alert and the card stays.
- `lib/clan-war-actions.ts` still returns `HTTP ${status}` and raw `e.message`. The clan war tab now hides
  those, but the lib should match.
- `App.tsx` still has the old "Floor seal pending: … server-blocked" text on a second path.
- **Escape over a `Modal` closes the modal, not the confirm on top of it.** This affects the Awakening Stone
  and Crafter confirms. `ui/Modal.tsx` and `GameAlert.tsx` both listen on window.
- **Overlays with no Escape and no focus handling.** The incoming-challenge popup, the shrine/trail-signs
  sheet (its custom offering takes a typed amount up to 250,000 ryo with no confirm) and the hunt encounter
  card.
- **Place Bounty** escrows a typed ryo amount with no confirm and no busy state.
- **Combat-layout items, waiting for the combat matrix:**
  - Flee's 10% HP cost and failure chance live only in a tooltip that phones hide.
  - PvP hex tiles lose their focus ring under the old grid look.
- `lib/recovery.ts` still uses a native `window.confirm` behind "Reset Local Save…".
- `styles/sunscar-hub.css` has a dead `.bm-crate-dialog` block.

## Technical and meta tells (applied)

| Finding | Player/visitor impact | Fix |
| --- | --- | --- |
| `public/kage-progress.html` + `.json` and `public/kage-blind.html` were copied into every build and served live at shinobijourney.com. One is an internal rebuild-progress dashboard that grades itself and names three other games; the other is a blind A/B review page that iframes a third-party video (already broken in production by our CSP). | Anyone who finds the URL sees internal tooling. | Moved beside the other QA harnesses at the client root. Vite still serves them in dev; the build no longer ships them. |
| Every response carried `X-Powered-By: Express`. | Advertises the framework to scanners. | `app.disable('x-powered-by')`, pinned in `api/_http-security.test.ts`. |

Checked and clean: production client code has no stray `console.log` (the three hits are `import.meta.env.DEV`
gated), no leftover template assets (`vite.svg`, `App.css`), unknown paths fall back to the game, the other QA
harness pages are not served, and title/description/Open Graph metadata is real and accurate.

## Checked and clean elsewhere

- Native dialogs: there is no `prompt()`, `alert()` is globally themed, and the only native `confirm` left
  is the recovery path noted above (plus an admin one).
- Toasts scale their time with length (3–8 s), show at most 3 at once, and repeated Notices collapse.
- Already double-submit safe before this pass: Shop buy, Bank (with a transfer confirm), Inventory sale,
  Pet Yard workbench, the expedition board, stat and jutsu training, Hospital, Sunscar Exchange, Black
  Market, ranked queue, gathering mini-games, clan upgrades, donations and territory capture.
- Skippable waits: card packs, crafting, pet evolution and the cache reveal all skip. The PvP prefight
  countdown is shared server-side on purpose.
- Every top-level screen has a back control. No lorem ipsum, placeholder names or "TODO" reach players. The
  AI-vocabulary sweep only hit game mechanics ("Empower") and lore.

## Sources

- Fountain Institute, [7 Signs a UI Has Been Vibe Coded](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui)
- Laith0003/ux-skill, [How to detect AI slop in your design](https://github.com/Laith0003/ux-skill/wiki/How-to-detect-AI-slop-in-your-design)
- FlowingData, [Signs of AI writing on Wikipedia](https://flowingdata.com/2025/10/20/signs-of-ai-writing-on-wikipedia/), and Pangram, [9 Signs of AI Writing](https://www.pangram.com/signs-of-ai-writing)
- Axon Build, [How to tell if an app was vibe coded](https://axonbuild.com/blog/how-to-tell-if-an-app-was-vibe-coded/)
- UX Collective, [Usability heuristics and competition in games](https://uxdesign.cc/usability-heuristics-and-competition-in-games-707cac36ff12), and Celia Hodent, [The UX of Fortnite](https://www.designative.info/2019/03/28/the-ux-of-fortnite-celia-hodent/)
- Game Wisdom, [Designing for Minimal Friction in Player Onboarding](https://game-wisdom.com/?p=32617)

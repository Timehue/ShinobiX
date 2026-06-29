import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── App.tsx line-budget ratchet (anti-regrowth guardrail) ──────────────────────
// App.tsx is the legacy frontend monolith, in active drain into src/{screens,
// components,lib,data}/. This test fails if App.tsx grows past the budget below,
// to stop new features from landing back in the monolith.
//
// When you extract code OUT of App.tsx and the count drops well under budget,
// LOWER MAX_LINES to the new count + a small buffer to ratchet the gain in.
// Do NOT raise it to make a feature fit — put the new screen/helper in its own
// module under src/screens|components|lib|data instead.
//
// History: 35,947 (2026-06-09 baseline) → 31,753 (Stage 1A complete + 1B
// partial) → 29,733 (warning paydown + WorldMap) → 25,728 (Stage 1B complete)
// → 23,627 (Stage 1C complete) → 11,892 (Stage 1D + AdminPanel complete)
// → 10,380 (combat-AI + world-state system moves) → 10,451 (getJutsuSelectOptions
// → lib/jutsu-options, net of the profile Message/Challenge/Follow wiring)
// → 10,353 (retired the Hollow Gate Kenney atlas auto-slicer — terrain is now
// published shrine:tile-* art) → 10,228 (drained ClanWarsPanel → components/ +
// its now-orphaned imports) → 10,188 (drained adminIconOptions → data/admin-icons
// + useSharedNow → lib/use-shared-now [−50], re-exported from App for back-compat;
// then +10 for Battle Towers save-field normalize/create wiring — net −40 vs main)
// → 10,132 (Battle Towers nav wiring +7, then drained the PvP-UI/leaderboard type
// cluster → types/pvp-ui [−63], re-imported PvpSessionState + re-exported the
// public ones for back-compat — net −56).
// → 10,137 (+2 mandatory Pet Ladder screen WIRING only — the lazy import + the
// render branch, same 2 lines every screen needs; the PetLadder screen itself
// lives in its own module src/screens/PetLadder.tsx, not here).
// → 10,121 (−6: removed the ephemeral hospitalEntryTime state + its 3 KO-site
// setters + navigate entry-stamp + render prop; the Hospital free-checkout timer
// is now server-authoritative off character.hospitalizedUntil, fixing the
// refresh-trap loop).
// → 10,131 (+10 mandatory heartbeat WIRING for the "you were healed" push: the
// pendingHeal delivery block in the heartbeat handler + a small generalization of
// the mission-toast (custom label / hide 0-XP) so a Healer discharge auto-exits
// the hospital with a toast. The signal is queued/cleared server-side; this is
// just the client delivery, which must live in the heartbeat effect. Net for the
// session is −0 below the prior 10,137 budget — not a regrowth).
// → 10,134 (+3 mandatory Professions screen WIRING only: the lazy import, the
// render branch, and the one `profession` prop passed to RightMenu. The whole
// feature — the professions overview + the three profession hub screens
// (Healer/Vanguard/Pet Tamer) — lives in its own modules under
// src/screens/Professions.tsx, src/screens/professions/*, and shared bits in
// src/components/{HealerInjuredList,ProfessionHero}.tsx + src/data/professions.ts,
// NOT here. Hospital.tsx was also slimmed by reusing HealerInjuredList).
// What remains is the App() core (~150 hooks) and its
// module-level wiring — decompose via hooks, not moves.
// → 10,146 (+12 save-core safety fixes from the 2026-06-26 audit that
// inherently live in the App save core, NOT regrowth: the standalone-state
// dirty-tracking effect [accept-a-contract-then-close no longer loses it], the
// persistent-save-failure counter that drives the new SaveErrorBanner component
// [the banner JSX itself lives in src/components/SaveErrorBanner.tsx], and the
// Hollow Gate befriend immediate-save flush. These touch component refs/state +
// inline render handlers, so they cannot be extracted to a screen/helper module.
// → 10,156 (+10 audit #25: pushSaveToServer now clears the dirty flag + cancels
// the pending debounced autosave after a successful immediate save [same-ref
// guarded so a concurrent change isn't dropped], eliminating the redundant
// immediate-save→autosave self-409. Lives in the App save core — cannot move out.
// → 10,172 (+16 perf-audit load-speed wiring, NOT feature regrowth — this is a
// DRAIN in spirit: ten heavy nav screens (ClanHall/StoryHall/StoryBoss/Training/
// JutsuTrainingHall/Shop/GrandMarketplace/Dungeon×2/Bank/Profile/Missions/
// HunterBoard/GuidesLibrary) converted from eager `import` to `lazyWithRetry`
// dynamic imports, cutting the initial index chunk 2014KB→1102KB (−913KB) by
// moving them + their data catalogs (storylines/guides) into on-demand chunks.
// The lazy-const declarations must live at App's module top (+4). Also the
// navigate/logoutPlayer latest-ref memo stabilizers (+6) and the clan-war poller
// clan-gate (+1) — all reference App-local state, cannot move to a module.
// → 10,176 (+4 for VN trait-branching: the vnPages choice type gains
// requireTrait/forbidTrait (+2), the addStoryTrait import (+1), and the onChoice
// persist wiring on the live TriggeredVisualNovel usage (+1) — all reference
// App-local state (setCharacter) so they cannot move to a module).
// → 10,104 (−72 DRAIN: the CreatorEvent + StoryStep VN content types moved out
// to ./types/vn, imported back + re-exported from App for the "../App" sites;
// the now-unused CurrencyRewards type import was dropped too).
const MAX_LINES = 10_104;

test("App.tsx stays within its line budget (drain, don't regrow)", () => {
  const src = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const lines = (src.match(/\n/g) ?? []).length;
  assert.ok(
    lines <= MAX_LINES,
    `App.tsx is ${lines} lines, over the ${MAX_LINES} budget. New code belongs in a ` +
      `module under src/screens|components|lib|data — not App.tsx. If you genuinely ` +
      `drained code out, lower MAX_LINES to ratchet the win in.`,
  );
});

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
// → 10,176 (+4 mandatory WIRING for the jutsu-training queue: the lib import (+1)
// and the global useJutsuTrainingQueueRunner hook call (+3, incl. its 2-line
// rationale). The feature — queue a 2nd ryo training that auto-promotes the instant
// the first finishes — lives entirely in lib/jutsu-training-queue.ts +
// screens/Training.tsx; only the global hook MOUNT must run from App so the queue
// advances on any screen, like the other timer wiring here. Not regrowth.
// → 10,108 (merge of the VN-editor branch: +4 VN trait-branching wiring
// (requireTrait/forbidTrait choice fields + addStoryTrait import + onChoice persist
// on the live TriggeredVisualNovel), then −72 DRAIN moving the CreatorEvent +
// StoryStep VN content types out to ./types/vn (re-exported from App for the
// "../App" sites; dropped the now-unused CurrencyRewards import) — net vs main).
// → 10,114 (+8 Endless Tower ENTRY-FEE wiring — owner-approved budget raise for a
// ryo sink. The fee logic lives in lib/entry-fee.ts; only the charge-on-fresh-run
// wiring, which reads App-local character/setCharacter, lives here: the lib import
// (+1) and the fee block in startEndlessBattle (+7)).
// → 10,123 (+9 Hollow Gate SERVER run-loop wiring — flag-gated anti-cheat/economy
// pass. All logic lives in lib/hollow-gate-server.ts; only the App-local setter call
// sites live here: the import (+1), beginHollowGateServerRun at the two dive entries
// (+2 calls/comments), and the settle hooks replacing the inline claw-back at the
// run-end funnels (leave / battle-KO / boot-restore).)
// → 10,126 (+3 Hollow Gate future-proofing: resumeHollowGateServerRun re-presents the
// augment picker on run-resume (refresh-mid-pick safety) at the two restore branches;
// the decision logic is the pure shouldResumeAugmentPicker in the lib.)
// → 10,139 (+13 Hollow Gate augment COMBAT-FEEL layer, HG-only & flag-gated. Pure
// hollowGateAugmentEffects() maps the chosen augment to enemy-clone HP/stat/shave
// mults + run flags; applied ONLY to the per-dive enemy in startHollowGateBattle and
// the Keeper-heal / Leave-tile handlers — never the shared combat engine.)
// → 10,152 (+13 Hollow Gate server daily-cap HARD-block, audit #7: enterHollowGate
// is now async and AWAITS startHollowGateServerRun before spending the Key, so a
// 'daily-cap' reply blocks the dive (was soft). Lib split: attachStartedRun() shared
// by the awaited live entry + the background admin entry. Flag-off → unchanged.)
// → village-war branch: Village War Map (+2 WIRING / −4 BATTLE_SCREENS drain) and
// Sector War Card Battle (+2 WIRING / −7 VillageWarScreen 1-liner) screens — each
// net-negative; the screens live in their own modules (see those commits).
// → 10,145 (merge of main + the village-war branch — main's App.tsx plus the branch's
// net-negative screen wiring; measured post-merge.)
const MAX_LINES = 10_145;

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

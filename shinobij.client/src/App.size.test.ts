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
// What remains is the App() core (~150 hooks) and its
// module-level wiring — decompose via hooks, not moves.
const MAX_LINES = 10_137;

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

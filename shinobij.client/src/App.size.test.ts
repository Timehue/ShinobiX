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
// History: 35,947 (2026-06-09 baseline) → 31,753 (Stage 1A complete + 1B partial).
const MAX_LINES = 32_000;

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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * ⛔ ONLY the web rail may render a web checkout.
 *
 * A source assertion rather than a render test because the property is about
 * which branch the component takes before any DOM exists, and exercising it for
 * real would need a browser plus a forged android-app launch referrer — far
 * more machinery than the one-line invariant deserves. server-routes.test.ts
 * and webhook-gate-order.test.ts pin their wiring rules the same way.
 *
 * ── WHAT THIS PREVENTS ────────────────────────────────────────────────────
 * shardRail() has THREE values: "web", "play", and "blocked". The component
 * originally gated on `rail === "blocked"`, so everything else — including
 * "play" — fell through to the Tebex tiles. Harmless while no Android app
 * existed; the moment the TWA shipped with Play Billing enabled, the app would
 * have offered players an external payment page for digital goods. That is the
 * precise breach Play's billing policy forbids, it is grounds for removal, and
 * it is exactly what shardRail() was written to stop.
 *
 * Enumerating the SAFE case means a rail added later is refused by default
 * until someone deliberately handles it, rather than silently inheriting the
 * web checkout.
 */

// Resolved against this file, not the working directory — the runner invokes
// tests from the repo root, so a cwd-relative path would silently miss.
const SOURCE = readFileSync(new URL("./PremiumOffers.tsx", import.meta.url), "utf8");

test("the web checkout is gated on the web rail alone, not on 'not blocked'", () => {
    assert.match(
        SOURCE,
        /if\s*\(\s*rail\s*!==\s*"web"\s*\)/,
        'PremiumOffers must gate with `rail !== "web"`. Gating on `rail === "blocked"` lets '
        + '"play" fall through to the web checkout, which breaches Play billing policy.',
    );
    assert.doesNotMatch(
        SOURCE,
        /if\s*\(\s*rail\s*===\s*"blocked"\s*\)/,
        'Gating on `=== "blocked"` is the regression this guards: it treats every other rail, '
        + "including \"play\", as permission to show a web payment page.",
    );
});

test("the component still knows about the play rail it is refusing", () => {
    // If "play" ever stops being mentioned here, the branch above has probably
    // been rewritten without anyone thinking about the Android surface.
    assert.match(SOURCE, /play/i, "PremiumOffers should still reason about the Play surface");
});

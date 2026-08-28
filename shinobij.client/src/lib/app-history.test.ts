import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBack, screenFromHash, hashForScreen } from "./app-history";

test("hash round-trips a screen", () => {
    assert.equal(hashForScreen("village"), "#/village");
    assert.equal(screenFromHash("#/village"), "village");
    assert.equal(screenFromHash("#/petArena"), "petArena");
});

test("a hash that isn't ours yields no target", () => {
    assert.equal(screenFromHash(""), "");
    assert.equal(screenFromHash("#village"), "");
    assert.equal(screenFromHash("?foo=1"), "");
    assert.equal(screenFromHash(undefined as unknown as string), "");
});

test("back walks to the previous hub screen", () => {
    assert.deepEqual(
        decideBack({ targetHash: "#/village", battleUnresolved: false }),
        { action: "navigate", screen: "village" },
    );
    assert.deepEqual(
        decideBack({ targetHash: "#/inventory", battleUnresolved: false }),
        { action: "navigate", screen: "inventory" },
    );
});

// ── The refusals that keep back from becoming an exploit ────────────────────

test("⛔ back is REFUSED while a battle is unresolved — it must never be a flee route", () => {
    // lastScreen.v1 exists because routing a refresh to the village "was the bug
    // that let players refresh-flee a fight". Backing out of a fight and then
    // refreshing would re-open exactly that hole.
    assert.deepEqual(
        decideBack({ targetHash: "#/village", battleUnresolved: true }),
        { action: "refuse", reason: "battle-unresolved" },
    );
});

test("the battle refusal outranks an otherwise perfectly valid target", () => {
    // Ordering guard: if the target checks are ever moved above the battle
    // check, this is what catches it. No destination justifies leaving a fight.
    for (const targetHash of ["#/village", "#/profile", "#/bank", "#/messages"]) {
        const decision = decideBack({ targetHash, battleUnresolved: true });
        assert.equal(decision.action, "refuse", `${targetHash} must be refused mid-battle`);
        assert.equal((decision as { reason: string }).reason, "battle-unresolved");
    }
});

test("back into a non-restorable screen falls back to the village, never half-loads it", () => {
    // These hold ephemeral React state or a sealed server session; landing on
    // one from a history entry gives a broken board, which is the same failure
    // the refresh guards already prevent. They are also the COMMON entry to pop
    // — finishing any fight leaves one behind — so this must not be a no-op.
    for (const screen of ["pvpBattle", "storyBoss", "hollowGateTiles", "petShowdown", "dungeon"]) {
        assert.deepEqual(
            decideBack({ targetHash: `#/${screen}`, battleUnresolved: false }),
            { action: "navigate", screen: "village", fellBack: true },
            `${screen} should fall back, not restore`,
        );
    }
});

test("village → petArena → village: back lands somewhere real instead of doing nothing", () => {
    // The regression this guards: refusing here made back a dead button on the
    // most ordinary stack in the game.
    const decision = decideBack({ targetHash: "#/petArena", battleUnresolved: false });
    assert.equal(decision.action, "navigate");
    assert.equal((decision as { screen: string }).screen, "village");
});

test("an unrecognised screen name still resolves to a safe destination", () => {
    assert.deepEqual(
        decideBack({ targetHash: "#/notAScreen", battleUnresolved: false }),
        { action: "navigate", screen: "village", fellBack: true },
    );
});

test("a hash we never wrote is refused, so the app is not left on a foreign URL", () => {
    assert.deepEqual(
        decideBack({ targetHash: "", battleUnresolved: false }),
        { action: "refuse", reason: "unknown-target" },
    );
});

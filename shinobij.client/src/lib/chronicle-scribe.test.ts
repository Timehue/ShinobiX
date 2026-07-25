import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Character } from "../types/character";
import {
    SCRIBE_ACCEPT_MARKER, SCRIBE_MIN_LEVEL, SCRIBE_WANDERER_ID,
    scribeEligible, scribeWandererFor, scribeIntroEvent, synthChronicleScribe,
} from "./chronicle-scribe";

const asCharacter = (over: Record<string, unknown>): Character =>
    ({ name: "Aoi", level: 20, ...over }) as unknown as Character;

describe("scribeEligible", () => {
    it("requires the level band and an unclaimed codex", () => {
        assert.equal(scribeEligible({ level: SCRIBE_MIN_LEVEL - 1 }), false);
        assert.equal(scribeEligible({ level: SCRIBE_MIN_LEVEL }), true);
        assert.equal(scribeEligible({ level: 80 }), true, "no upper cap — an over-leveled player still gets the codex");
        assert.equal(scribeEligible({ level: 40, starterCardsClaimed: true }), false);
    });
});

describe("scribeWandererFor", () => {
    it("returns [] when ineligible regardless of sector", () => {
        const now = new Date(1_800_000_000_000);
        assert.deepEqual(scribeWandererFor(asCharacter({ level: 5 }), 12, now), []);
        assert.deepEqual(scribeWandererFor(asCharacter({ starterCardsClaimed: true }), 12, now), []);
        assert.deepEqual(scribeWandererFor(asCharacter({}), null, now), []);
    });

    it("FINDS YOU — present in every sector, every window, until the codex is claimed", () => {
        // Owner call 2026-07-24: unlike every other roaming giver, Ihara rolls no
        // presence chance. The card game, the pack storefronts and the gambler
        // wanderer are all sealed until she hands over the codex, so a player who
        // never bumps into her never sees the Chronicle at all.
        const char = asCharacter({});
        for (let sector = 1; sector <= 60; sector++) {
            for (const t of [1_800_000_000_000, 1_800_021_600_000, 1_800_043_200_000]) {
                const found = scribeWandererFor(char, sector, new Date(t));
                assert.equal(found.length, 1, `sector ${sector} @ ${t}: she must be here`);
                assert.equal(found[0].id, SCRIBE_WANDERER_ID);
            }
        }
    });

    it("still retires the instant the codex is claimed", () => {
        const now = new Date(1_800_000_000_000);
        for (let sector = 1; sector <= 60; sector++) {
            assert.deepEqual(scribeWandererFor(asCharacter({ starterCardsClaimed: true }), sector, now), []);
        }
    });

    it("synths a well-formed on-grid wanderer", () => {
        const w = synthChronicleScribe(7);
        assert.equal(w.id, SCRIBE_WANDERER_ID);
        assert.equal(w.verb, "quest");
        assert.ok(w.greeting.length > 20);
        for (const tile of [w.homeTile, ...w.waypoints]) {
            assert.ok(tile >= 0 && tile < 144, `tile ${tile} must be on the 12×12 grid`);
        }
    });
});

describe("scribeIntroEvent", () => {
    it("carries the full codex conversation with an accept/decline close", () => {
        const ev = scribeIntroEvent("forest");
        const pages = ev.vnPages ?? [];
        assert.ok(pages.length >= 4, "the scribe has a real conversation, not a toast");
        for (const page of pages) {
            assert.ok(page.dialogue.length >= 1);
            for (const line of page.dialogue) {
                assert.ok(line.length > 20, "every beat is a real spoken line");
                assert.ok(!/%user|%target|%player/.test(line), "codex VN is token-free");
            }
        }
        const last = pages[pages.length - 1];
        assert.ok(last.choices && last.choices.length === 2, "final page offers accept + decline");
        const accept = last.choices!.find((c) => c.trait === SCRIBE_ACCEPT_MARKER);
        const decline = last.choices!.find((c) => !c.trait);
        assert.ok(accept, "accept choice carries the sentinel marker");
        assert.ok(decline, "decline choice carries NO trait (nothing stored)");
        assert.ok(accept!.conclusion && decline!.conclusion, "both choices play a send-off beat");
    });

    it("anchors the lore: the Gate stood above ground, and the record is alive", () => {
        const all = scribeIntroEvent("forest").vnPages!.flatMap((p) => p.dialogue).join(" ");
        assert.match(all, /Hollow Gate .*above ground/i, "the ancient-origin canon must be spoken");
        assert.match(all, /can't burn what's in a thousand pockets/i, "the why-cards canon must be spoken");
        assert.match(all, /The Chronicle doesn't close/i, "the living-record canon must be spoken");
    });
});

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

    it("is deterministic per (player, sector, window) and present in a healthy share of sectors", () => {
        const now = new Date(1_800_000_000_000);
        const char = asCharacter({});
        let present = 0;
        for (let sector = 1; sector <= 55; sector++) {
            const a = scribeWandererFor(char, sector, now);
            const b = scribeWandererFor(char, sector, now);
            assert.deepEqual(a, b, `sector ${sector}: same window must give the same answer`);
            if (a.length) present++;
        }
        // Gate is 0.45 — allow wide tolerance, but she must be findable and not omnipresent.
        assert.ok(present >= 10 && present <= 45, `expected a findable-but-not-everywhere scribe (got ${present}/55)`);
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

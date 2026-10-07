import { beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    BOOT_WINDOW_MS, REVEAL_WINDOW_MS, dismissGearDrop, expectGearDropReveal, getGearDropsSnapshot, observeGearCounts, resetGearDropStore,
} from "./gear-drop-store";

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data }; };
const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));
const ids = () => getGearDropsSnapshot().map((drop) => drop.itemId);
const T0 = 1_000_000;
let storage = memory();

beforeEach(() => { storage = memory(); resetGearDropStore({ storage }); });

describe("gear drop store", () => {
    it("treats what a brand new account already owns as a baseline, not news", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 2 }), T0);
        assert.deepEqual(ids(), []);
        assert.deepEqual(JSON.parse(storage.data.get("gear-drops-seen:rill")!), { "cloth-hood-s1": 2 });
    });

    it("announces a new copy, once", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-robe-s2": 1 }), T0 + 5000);
        assert.deepEqual(ids(), ["cloth-robe-s2"]);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-robe-s2": 1 }), T0 + 6000);
        assert.deepEqual(ids(), ["cloth-robe-s2"]);
        dismissGearDrop(getGearDropsSnapshot()[0].key);
        assert.deepEqual(ids(), []);
    });

    it("does not repeat a drop when the stale cache paints first and the real save follows", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-robe-s2": 1 }), T0 + 5000);
        assert.deepEqual(ids(), ["cloth-robe-s2"]);
        // The player closes the tab, then returns: the cache lacks the drop, the real save has it.
        resetGearDropStore({ storage });
        const back = T0 + 600_000;
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), back);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-robe-s2": 1 }), back + 800);
        assert.deepEqual(ids(), [], "already announced, so not announced again");
    });

    it("announces a drop earned elsewhere or while away", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        resetGearDropStore({ storage });
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + 600_000);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-sash-s3": 1 }), T0 + 600_800);
        assert.deepEqual(ids(), ["cloth-sash-s3"]);
    });

    it("follows a real sale down after the boot window, so a later drop of that piece is announced", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        // Inside the boot window a lower count is only a stale cache.
        observeGearCounts("Rill", counts({}), T0 + 1000);
        assert.deepEqual(JSON.parse(storage.data.get("gear-drops-seen:rill")!), { "cloth-hood-s1": 1 });
        // After it, a lower count is a real loss.
        observeGearCounts("Rill", counts({}), T0 + BOOT_WINDOW_MS + 1000);
        assert.deepEqual(JSON.parse(storage.data.get("gear-drops-seen:rill")!), {});
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + BOOT_WINDOW_MS + 2000);
        assert.deepEqual(ids(), ["cloth-hood-s1"]);
    });

    it("announces a new drop of a piece that was sold inside the boot window, even if nothing else changed first", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        observeGearCounts("Rill", counts({}), T0 + 10_000);
        // The next change comes after the window closed and is a fresh drop of the same piece.
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + BOOT_WINDOW_MS + 5_000);
        assert.deepEqual(ids(), ["cloth-hood-s1"]);
    });

    it("keeps card numbers counting across an account switch, so a new card never shares one with a card on screen", () => {
        observeGearCounts("Rill", counts({}), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + 1000);
        const first = getGearDropsSnapshot()[0].key;
        observeGearCounts("Aya", counts({}), T0 + 2000);
        observeGearCounts("Aya", counts({ "cloth-robe-s1": 1 }), T0 + 3000);
        assert.notEqual(getGearDropsSnapshot()[0].key, first);
    });

    it("announces a second copy of a piece already owned", () => {
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 2 }), T0 + 5000);
        assert.deepEqual(ids(), ["cloth-hood-s1"]);
    });

    it("stays quiet once for an item a screen is revealing itself, then lapses", () => {
        observeGearCounts("Rill", counts({}), T0);
        expectGearDropReveal("cloth-hood-s1", T0 + 1000);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + 2000);
        assert.deepEqual(ids(), [], "the chest or cache reveal covers it");
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 2 }), T0 + 3000);
        assert.deepEqual(ids(), ["cloth-hood-s1"], "a later copy is a new announcement");
        dismissGearDrop(getGearDropsSnapshot()[0].key);
        expectGearDropReveal("cloth-robe-s1", T0 + 4000);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 2, "cloth-robe-s1": 1 }), T0 + 4000 + REVEAL_WINDOW_MS + 1);
        assert.deepEqual(ids(), ["cloth-robe-s1"], "an expectation that was never used lapses");
    });

    it("ignores a reveal request for something that is not a gear step item", () => {
        expectGearDropReveal("potion-rejuvenation", T0);
        observeGearCounts("Rill", counts({}), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + 1000);
        assert.deepEqual(ids(), ["cloth-hood-s1"]);
    });

    it("folds a flood into a summary and never reuses a card key", () => {
        observeGearCounts("Rill", counts({}), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1, "cloth-hood-s2": 1, "cloth-hood-s3": 1, "cloth-robe-s1": 1, "cloth-robe-s2": 1 }), T0 + 1000);
        const shown = getGearDropsSnapshot();
        assert.equal(shown.length, 3);
        assert.equal(shown[2].extra, 3);
        assert.equal(new Set(shown.map((d) => d.key)).size, 3);
    });

    it("keeps accounts apart, and clears the queue on logout", () => {
        observeGearCounts("Rill", counts({}), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0 + 1000);
        assert.equal(ids().length, 1);
        observeGearCounts("Aya", counts({ "cloth-hood-s1": 1 }), T0 + 2000);
        assert.deepEqual(ids(), [], "switching accounts drops the other account's announcements");
        assert.ok(storage.data.has("gear-drops-seen:aya"));
        observeGearCounts("Aya", counts({ "cloth-hood-s1": 1, "cloth-robe-s1": 1 }), T0 + 3000);
        assert.equal(ids().length, 1);
        observeGearCounts(null, counts({}), T0 + 4000);
        assert.deepEqual(ids(), []);
    });

    it("works with no usable storage, and ignores a damaged record", () => {
        const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        resetGearDropStore({ storage: broken });
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 2 }), T0 + 1000);
        assert.deepEqual(ids(), ["cloth-hood-s1"]);
        const damaged = memory(); damaged.data.set("gear-drops-seen:rill", "not json");
        resetGearDropStore({ storage: damaged });
        observeGearCounts("Rill", counts({ "cloth-hood-s1": 1 }), T0);
        assert.deepEqual(ids(), [], "a damaged record is a fresh baseline");
    });
});

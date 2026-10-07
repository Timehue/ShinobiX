import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { collapseGearDrops, gainedGearDrops, MAX_DROP_CARDS, stepCounts } from "./gear-drop-watch";

describe("gear drop watch", () => {
    it("counts only gear step items, in the bag and equipped", () => {
        const counts = stepCounts(["cloth-hood", "cloth-hood-s1", "cloth-hood-s1", "potion-rejuvenation"], { head: "iron-kabuto-s2", hand: "training-katana" });
        assert.deepEqual([...counts], [["cloth-hood-s1", 2], ["iron-kabuto-s2", 1]]);
    });

    it("tolerates a missing bag or equipment", () => {
        assert.equal(stepCounts(undefined, undefined).size, 0);
        assert.equal(stepCounts(null, "nope").size, 0);
    });

    it("reports a new copy, including a second copy of one already owned", () => {
        const before = stepCounts(["cloth-hood-s1"], {});
        const now = stepCounts(["cloth-hood-s1", "cloth-hood-s1", "rustfang-kunai-s3"], {});
        assert.deepEqual(gainedGearDrops(before, now, 7), [
            { key: 7, itemId: "cloth-hood-s1" },
            { key: 8, itemId: "rustfang-kunai-s3" },
        ]);
    });

    it("counts a legacy item named by two equipment slots once", () => {
        const counts = stepCounts([], { hand: "training-katana-s1", weapon: "training-katana-s1", body: "cloth-robe-s1", armor: "cloth-robe-s1" });
        assert.deepEqual([...counts], [["training-katana-s1", 1], ["cloth-robe-s1", 1]]);
        // Normalizing the aliases away later must not look like a loss and then a gain.
        const normalized = stepCounts([], { hand: "training-katana-s1", body: "cloth-robe-s1" });
        assert.deepEqual(gainedGearDrops(counts, normalized, 0), []);
        assert.deepEqual(gainedGearDrops(normalized, counts, 0), []);
    });

    it("shows a few drops as they are, and folds a flood into one summary", () => {
        const drop = (n: number) => ({ key: n, itemId: `cloth-hood-s${(n % 3) + 1}` });
        const three = [0, 1, 2].map(drop);
        assert.deepEqual(collapseGearDrops(three), three);
        const eight = [0, 1, 2, 3, 4, 5, 6, 7].map(drop);
        const folded = collapseGearDrops(eight);
        assert.equal(folded.length, MAX_DROP_CARDS);
        assert.deepEqual(folded.slice(0, 2), eight.slice(0, 2));
        assert.deepEqual(folded[2], { key: 2, itemId: "", extra: 6 });
        // Two single cards plus the six folded in account for all eight.
        assert.equal(folded.length - 1 + (folded[2].extra ?? 0), eight.length);
        assert.equal(new Set(folded.map((d) => d.key)).size, folded.length, "keys stay unique");
    });

    it("does not report equipping, selling or an unchanged bag", () => {
        const owned = stepCounts(["cloth-hood-s1"], {});
        assert.deepEqual(gainedGearDrops(owned, stepCounts([], { head: "cloth-hood-s1" }), 0), []);
        assert.deepEqual(gainedGearDrops(owned, stepCounts([], {}), 0), []);
        assert.deepEqual(gainedGearDrops(owned, owned, 0), []);
    });
});

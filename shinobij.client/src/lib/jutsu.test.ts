/*
 * normalizeJutsu guard — the client load boundary that strips the legacy EP-100
 * "fixed effect" sentinel. A jutsu carrying a binary control / displacement tag
 * deals STANDARD 60-AP damage (40), not ~3200, so preview + PvE combat agree
 * with the server (which clamps the same way in sanitizeJutsuList). Mirrors
 * api/pvp/_tags.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeJutsu, orderEquippedJutsus } from "./jutsu";

const make = (effectPower: number, tagName: string, ap = 60) =>
    normalizeJutsu({ id: "j", name: "J", type: "Ninjutsu", ap, effectPower, tags: [{ name: tagName, percent: 0 }] });

describe("normalizeJutsu — fixed-effect EP-100 sentinel is clamped to standard 40", () => {
    it("clamps a 60-AP control jutsu from EP 100 to 40", () => {
        assert.equal(make(100, "Stun").effectPower, 40);
        assert.equal(make(100, "Copy").effectPower, 40);
        assert.equal(make(100, "Push").effectPower, 40);
    });

    it("is alias-aware (Seal → Bloodline Seal is a fixed-effect tag)", () => {
        assert.equal(make(100, "Seal").effectPower, 40);
    });

    it("never raises EP — only clamps the sentinel down", () => {
        assert.equal(make(40, "Stun").effectPower, 40);
        assert.equal(make(30, "Stun").effectPower, 30);
    });

    it("leaves a normal damage jutsu untouched", () => {
        assert.equal(make(50, "Wound").effectPower, 50);
        assert.equal(normalizeJutsu({ id: "n", name: "N", type: "Ninjutsu", ap: 60, effectPower: 36, tags: [] }).effectPower, 36);
    });
});

describe("normalizeJutsu — Bloodline combat visual choice", () => {
    it("keeps a valid choice only on offensive 60 AP jutsu", () => {
        const valid = normalizeJutsu({ id: "valid", name: "Valid", type: "Ninjutsu", ap: 60, target: "OPPONENT", visualEffect: "shadow", tags: [] });
        const utility = normalizeJutsu({ id: "utility", name: "Utility", type: "Ninjutsu", ap: 40, target: "OPPONENT", visualEffect: "fire60", tags: [] });
        const selfCast = normalizeJutsu({ id: "self", name: "Self", type: "Ninjutsu", ap: 60, target: "SELF", visualEffect: "water60", tags: [] });
        const invalid = normalizeJutsu({ id: "invalid", name: "Invalid", type: "Ninjutsu", ap: 60, target: "OPPONENT", visualEffect: "godmode" as never, tags: [] });

        assert.equal(valid.visualEffect, "shadow");
        assert.equal(utility.visualEffect, undefined);
        assert.equal(selfCast.visualEffect, undefined);
        assert.equal(invalid.visualEffect, undefined);
    });
});

describe("normalizeJutsu — bloodline draft authority", () => {
    it("preserves bloodlineRank so creator previews and point math use the saved rank", () => {
        const normalized = normalizeJutsu({
            id: "ranked-draft",
            name: "Ranked Draft",
            type: "Ninjutsu",
            bloodlineRank: "S Rank",
            tags: [{ name: "Increase Damage Given", percent: 35 }],
        });
        assert.equal(normalized.bloodlineRank, "S Rank");
    });
});

describe("normalizeJutsu — Overload content repair", () => {
    it("repairs a stale single IDG tag to exactly two matching pulses", () => {
        const normalized = normalizeJutsu({
            id: "starter-universal-blitz",
            name: "Overload",
            type: "Ninjutsu",
            tags: [{ name: "Increase Damage Given", percent: 30 }],
        });
        assert.deepEqual(normalized.tags, [
            { name: "Increase Damage Given", percent: 30 },
            { name: "Increase Damage Given", percent: 30 },
        ]);
    });

    it("caps an over-authored Overload at two pulses without changing other jutsu", () => {
        const overload = normalizeJutsu({
            id: "starter-universal-blitz",
            name: "Overload",
            type: "Ninjutsu",
            tags: Array.from({ length: 3 }, () => ({ name: "Increase Damage Given", percent: 30 })),
        });
        const ordinary = normalizeJutsu({
            id: "ordinary",
            name: "Ordinary",
            type: "Ninjutsu",
            tags: [{ name: "Increase Damage Given", percent: 30 }],
        });
        assert.equal(overload.tags.length, 2);
        assert.equal(ordinary.tags.length, 1);
    });
});

describe("orderEquippedJutsus - Profile loadout order reaches combat", () => {
    const catalog = [
        normalizeJutsu({ id: "catalog-first", name: "Catalog First", type: "Ninjutsu" }),
        normalizeJutsu({ id: "catalog-second", name: "Catalog Second", type: "Taijutsu" }),
        normalizeJutsu({ id: "custom-third", name: "Custom Third", type: "Genjutsu" }),
    ];

    it("uses equipped slot order instead of catalog order", () => {
        const ordered = orderEquippedJutsus(catalog, ["custom-third", "catalog-first", "catalog-second"]);
        assert.deepEqual(ordered.map((jutsu) => jutsu.id), ["custom-third", "catalog-first", "catalog-second"]);
    });

    it("drops stale and duplicate ids without mutating the catalog", () => {
        const ordered = orderEquippedJutsus(catalog, ["catalog-second", "missing", "catalog-second", "catalog-first"]);
        assert.deepEqual(ordered.map((jutsu) => jutsu.id), ["catalog-second", "catalog-first"]);
        assert.deepEqual(catalog.map((jutsu) => jutsu.id), ["catalog-first", "catalog-second", "custom-third"]);
    });
});

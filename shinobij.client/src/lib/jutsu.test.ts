/*
 * normalizeJutsu guard — the client load boundary that strips the legacy EP-100
 * "fixed effect" sentinel. A jutsu carrying a binary control / displacement tag
 * deals STANDARD 60-AP damage (40), not ~3200, so preview + PvE combat agree
 * with the server (which clamps the same way in sanitizeJutsuList). Mirrors
 * api/pvp/_tags.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mergeDisplayJutsu, normalizeJutsu, orderEquippedJutsus } from "./jutsu";

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

describe("normalizeJutsu — repeated tags and flavor defaults", () => {
    // A technique that pulses one effect twice is a legitimate authoring choice
    // (the live "Overload" is two independent Increase Damage Given stacks).
    // normalizeJutsu must not collapse them, and must not invent extra ones.
    it("preserves an authored repeated tag exactly as written", () => {
        const normalized = normalizeJutsu({
            id: "admin-overload",
            name: "Overload",
            type: "Ninjutsu",
            tags: Array.from({ length: 2 }, () => ({ name: "Increase Damage Given", percent: 30 })),
        });
        assert.deepEqual(normalized.tags, [
            { name: "Increase Damage Given", percent: 30 },
            { name: "Increase Damage Given", percent: 30 },
        ]);
    });

    it("does not manufacture a second pulse for a single authored tag", () => {
        const normalized = normalizeJutsu({
            id: "admin-overload",
            name: "Overload",
            type: "Ninjutsu",
            tags: [{ name: "Increase Damage Given", percent: 30 }],
        });
        assert.equal(normalized.tags.length, 1);
    });

    // The fallback flavor branches on TARGET: a SELF cast that fell back to
    // "<name> strikes %target" made the battle log name the OPPONENT for a pure
    // self-buff, which is exactly how Overload read in live PvP.
    it("gives a SELF cast a self-directed flavor default", () => {
        const selfCast = normalizeJutsu({
            id: "admin-overload", name: "Overload", type: "Ninjutsu", target: "SELF",
            tags: [{ name: "Increase Damage Given", percent: 30 }],
        });
        assert.equal(selfCast.battleDescription, "Overload surges through %user.");
        assert.doesNotMatch(selfCast.battleDescription, /%target/);
    });

    it("leaves the outward-facing default naming the target", () => {
        const attack = normalizeJutsu({
            id: "admin-strike", name: "Strike", type: "Ninjutsu", target: "OPPONENT",
            tags: [{ name: "Damage", percent: 100 }],
        });
        assert.equal(attack.battleDescription, "Strike strikes %target");
    });

    it("never overrides authored flavor", () => {
        const authored = normalizeJutsu({
            id: "admin-overload", name: "Overload", type: "Ninjutsu", target: "SELF",
            battleDescription: "%user forces their chakra gates wide.",
            tags: [{ name: "Increase Damage Given", percent: 30 }],
        });
        assert.equal(authored.battleDescription, "%user forces their chakra gates wide.");
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

describe("mergeDisplayJutsu — a built-in outranks an authored copy of itself", () => {
    const builtIn = normalizeJutsu({
        id: "starter-tai-earth-3", name: "Ironbody Stance", type: "Taijutsu",
        tags: [{ name: "Absorb", percent: 30 }, { name: "Reflect", percent: 30 }],
    });
    // What save:admin1 actually held on 2026-09-01: a frozen hydrateImages
    // snapshot from an older balance pass, carrying only artwork of real value.
    const staleMirror = normalizeJutsu({
        id: "starter-tai-earth-3", name: "Ironbody Stance", type: "Taijutsu",
        tags: [{ name: "Stun", percent: 0 }], image: "/jutsu-ironbody.webp",
    });
    const ids: ReadonlySet<string> = new Set(["starter-tai-earth-3"]);

    it("keeps the built-in's combat values and takes only the artwork", () => {
        const merged = new Map([[builtIn.id, builtIn]]);
        mergeDisplayJutsu(merged, staleMirror, ids);
        const out = merged.get(builtIn.id)!;
        assert.deepEqual(out.tags.map((tag) => tag.name), ["Absorb", "Reflect"]);
        assert.equal(out.image, "/jutsu-ironbody.webp");
    });

    it("does not overwrite artwork the built-in already has", () => {
        const withArt = { ...builtIn, image: "/authored.webp" };
        const merged = new Map([[withArt.id, withArt]]);
        mergeDisplayJutsu(merged, staleMirror, ids);
        assert.equal(merged.get(withArt.id)!.image, "/authored.webp");
    });

    it("still lets a genuinely authored jutsu into the catalog", () => {
        const authored = normalizeJutsu({
            id: "admin-custom", name: "Custom", type: "Ninjutsu",
            tags: [{ name: "Wound", percent: 30 }],
        });
        const merged = new Map<string, typeof authored>();
        mergeDisplayJutsu(merged, authored, ids);
        assert.equal(merged.get("admin-custom")?.name, "Custom");
    });
});

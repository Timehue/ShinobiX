import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { jutsuEffectInfo, jutsuTargetingLabel } from "./jutsu-effects";
import { allTags } from "./tags";
import type { Jutsu, JutsuTag } from "../types/combat";

function jutsu(overrides: Partial<Jutsu> = {}): Jutsu {
    return {
        id: "timing-contract",
        name: "Timing Contract",
        type: "Ninjutsu",
        element: "Fire",
        ap: 60,
        range: 4,
        effectPower: 40,
        cooldown: 7,
        chakraCost: 100,
        staminaCost: 100,
        target: "OPPONENT",
        method: "SINGLE",
        tags: [],
        ...overrides,
    };
}

function info(name: string, overrides: Partial<Jutsu> = {}) {
    const tag: JutsuTag = { name, percent: 30 };
    return jutsuEffectInfo(jutsu({ tags: [tag], ...overrides }), tag);
}

describe("player-facing jutsu tag contract", () => {
    it("has an explicit description and activation timing for every live tag", () => {
        const liveTags = [...new Set([...allTags, "Pierce", "Barrier", "Increase Discipline"])];
        for (const name of liveTags) {
            const effect = info(name);
            assert.notEqual(effect.rule, "Custom effect tag.", `${name} needs an explicit rule`);
            assert.notEqual(effect.duration, "Varies", `${name} needs explicit timing`);
        }
    });

    it("separates cast-time effects from next-round statuses", () => {
        for (const name of ["Heal", "Shield", "Pierce", "Siphon", "Move", "Push", "Pull"]) {
            assert.match(info(name).duration, /Instant/i, `${name} should resolve on cast`);
        }
        for (const name of [
            "Absorb", "Reflect", "Lifesteal", "Wound", "Ignition", "Stun",
            "Bloodline Seal", "Elemental Seal", "Buff Prevent", "Debuff Prevent",
            "Cleanse Prevent", "Clear Prevent", "Stun Prevent", "Copy", "Mirror",
            "Lag", "Overclock", "Increase Heal", "Increase Generals", "Increase Discipline",
        ]) {
            assert.match(info(name).duration, /next round/i, `${name} should be labeled next-round`);
        }
    });

    it("describes the corrected heal, multi-hit, mirror, and prevention semantics", () => {
        assert.match(info("Heal").rule, /keeps its hit/i);
        assert.match(info("Lifesteal").summary, /every damaging attack/i);
        assert.match(info("Ignition").summary, /every hit/i);
        assert.match(info("Mirror").rule, /stay on the user/i);
        assert.match(info("Buff Prevent").rule, /direct Heal, Shield/i);
        assert.match(info("Push").value, /up to range/i);
        assert.match(info("Pull").rule, /stops early/i);
        // The tempo pair is a FLAT +/-10 AP per action, not a percentage, and the
        // copy must say so in AP — "20-30%, scaling with mastery" told players
        // nothing about what an action would actually cost.
        assert.equal(info("Lag").value, "+10 AP per action");
        assert.equal(info("Overclock").value, "−10 AP per action");
        assert.match(info("Lag").summary, /costs 10 more AP/i);
        assert.match(info("Overclock").summary, /costs 10 less AP/i);
        assert.match(info("Overclock").rule, /does not scale with mastery/i);
        for (const tempo of ["Lag", "Overclock"]) {
            assert.doesNotMatch(info(tempo).summary, /%/, `${tempo} copy must not quote a percentage`);
            assert.doesNotMatch(info(tempo).value, /%/, `${tempo} value must not quote a percentage`);
        }
        assert.match(info("Elemental Seal").summary, /Fire, Water, Earth, Wind, and Lightning/i);
        assert.match(info("Elemental Seal").rule, /special\/custom elements remain usable/i);
    });

    it("pins Copy and Mirror snapshot, exclusion, blocker, and fresh-duration rules", () => {
        const copy = info("Copy");
        assert.match(copy.summary, /all .* active positive statuses/i);
        assert.match(copy.summary, /except Absorb and Lifesteal/i);
        assert.match(copy.rule, /fresh 2 rounds starting next combat round/i);
        assert.match(copy.rule, /pending enemy buffs are not included/i);
        assert.match(copy.rule, /active Buff Prevent on the user blocks Copy/i);

        const mirror = info("Mirror");
        assert.match(mirror.summary, /all .* active negative statuses/i);
        assert.match(mirror.rule, /every active debuff/i);
        assert.match(mirror.rule, /including Wound, Ignition, Poison, and Drain/i);
        assert.match(mirror.rule, /fresh 2 rounds starting next combat round/i);
        assert.match(mirror.rule, /originals stay on the user/i);
        assert.match(mirror.rule, /pending debuffs are not included/i);
        assert.match(mirror.rule, /active Debuff Prevent on the enemy blocks Mirror/i);

        assert.equal(copy.duration, "Starts next round · fresh 2 rounds");
        assert.equal(mirror.duration, "Starts next round · fresh 2 rounds");
    });

    it("labels stat-tag percentages as potency and shows their flat lone-stack result", () => {
        const generals = info("Increase Generals");
        assert.match(generals.summary, /30% potency/i);
        assert.match(generals.summary, /\+937 to each/i);
        assert.match(generals.rule, /not a literal 30% multiplier/i);
        assert.equal(generals.value, "30% potency · +937 each");

        const discipline = info("Increase Discipline");
        assert.match(discipline.summary, /30% potency/i);
        assert.match(discipline.summary, /\+1874 as a lone stack/i);
        assert.match(discipline.rule, /flat offense bonus/i);
        assert.equal(discipline.value, "30% potency · +1874 Ninjutsu");
    });

    it("warns that a refreshed ground Poison can outlast its zone", () => {
        const poison = info("Poison", { target: "EMPTY_GROUND", method: "INSTANT_EFFECT" });
        assert.match(poison.rule, /remain after the zone expires/i);
    });

    it("distinguishes a circle impact from persistent ground-zone methods", () => {
        const circle = jutsuTargetingLabel(jutsu({ target: "EMPTY_GROUND", method: "AOE_CIRCLE", tags: [{ name: "Move", percent: 0 }] }));
        const instant = jutsuTargetingLabel(jutsu({ target: "EMPTY_GROUND", method: "INSTANT_EFFECT", tags: [{ name: "Poison", percent: 30 }] }));
        const spiral = jutsuTargetingLabel(jutsu({ target: "EMPTY_GROUND", method: "AOE_SPIRAL", tags: [{ name: "Move", percent: 0 }, { name: "Poison", percent: 30 }] }));
        assert.match(circle.detail, /does not create a persistent zone/i);
        assert.match(instant.detail, /persistent 2-round zone/i);
        assert.match(spiral.detail, /persistent 2-round/i);
    });
});

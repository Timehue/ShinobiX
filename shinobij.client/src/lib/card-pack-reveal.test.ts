import assert from "node:assert/strict";
import test from "node:test";
import {
    packArtUrl,
    packParticles,
    packTheme,
    planPackReveal,
    rarityTier,
    revealSfxForRarity,
} from "./card-pack-reveal";

const RARITIES: Record<string, string> = {
    "tc-01": "common",
    "tc-02": "rare",
    "tc-03": "legendary",
    "tc-04": "common",
    "tc-05": "mythic",
};
const rarityOf = (id: string) => RARITIES[id];

test("planPackReveal saves the rarest pull for last, stable within a tier", () => {
    const plan = planPackReveal(
        ["tc-03", "tc-01", "tc-02", "tc-04", "tc-05"],
        rarityOf,
        new Map(),
    );
    assert.deepEqual(
        plan.map((entry) => entry.id),
        ["tc-01", "tc-04", "tc-02", "tc-03", "tc-05"],
    );
});

test("planPackReveal flags first-ever copies, counting duplicates inside the same pack", () => {
    const plan = planPackReveal(
        ["tc-01", "tc-01", "tc-02"],
        rarityOf,
        new Map([["tc-02", 2]]),
    );
    // First tc-01 is brand new, the second copy in the same pack is not, and
    // tc-02 was already owned (starter copies count) so it is never NEW.
    assert.deepEqual(plan, [
        { id: "tc-01", isNew: true },
        { id: "tc-01", isNew: false },
        { id: "tc-02", isNew: false },
    ]);
});

test("unknown rarities sort as common instead of crashing", () => {
    assert.equal(rarityTier(undefined), 0);
    assert.equal(rarityTier("???"), 0);
    const plan = planPackReveal(["tc-99", "tc-03"], rarityOf, new Map());
    assert.deepEqual(plan.map((entry) => entry.id), ["tc-99", "tc-03"]);
});

test("packTheme labels the three storefront packs", () => {
    assert.equal(packTheme("standard").label, "Standard Pack");
    assert.equal(packTheme("epic").label, "Elite Pack");
    assert.equal(packTheme("legendary").label, "Legendary Pack");
});

test("pack wrapper art maps the epic pack to its Elite storefront name", () => {
    assert.equal(packArtUrl("standard"), "/chronicle/packs/standard.webp");
    assert.equal(packArtUrl("epic"), "/chronicle/packs/elite.webp");
    assert.equal(packArtUrl("legendary"), "/chronicle/packs/legendary.webp");
});

test("reveal stings scale with rarity and commons stay quiet", () => {
    assert.equal(revealSfxForRarity("common"), null);
    assert.equal(revealSfxForRarity("rare"), "reveal-rare");
    assert.equal(revealSfxForRarity("epic"), "reveal-epic");
    assert.equal(revealSfxForRarity("legendary"), "reveal-legendary");
    assert.equal(revealSfxForRarity("mythic"), "reveal-mythic");
});

test("particle bursts are deterministic per seed and sized to the request", () => {
    const a = packParticles(42, 12);
    const b = packParticles(42, 12);
    assert.equal(a.length, 12);
    assert.deepEqual(a, b);
    const c = packParticles(43, 12);
    assert.notDeepEqual(a, c);
    for (const p of a) {
        assert.ok(Number.isFinite(p.dx) && Number.isFinite(p.dy));
        assert.ok(p.duration >= 520 && p.delay >= 0 && p.size >= 3);
    }
});

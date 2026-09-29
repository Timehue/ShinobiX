import assert from "node:assert/strict";
import test from "node:test";
import { trainingRecommendation } from "./training-recommendation";
import { baseStats } from "./stats";
import { statCapForLevel } from "../constants/game";
import { starterSavedBloodlines } from "../data/jutsu";
import { getOffense, getDefense } from "../../../api/combat-core/formulas";
import type { Character } from "../types/character";
import type { SavedBloodline } from "../types/combat";

const character = (bloodline: string) => ({ bloodline, specialty: "Ninjutsu", level: 1, stats: baseStats() }) as Character;
for (const [bloodline, stat, discipline, secondGeneral] of [
    ["Ashen Eyes", "intelligence", "Genjutsu", "willpower"], ["Inferno Cataclysm", "willpower", "Ninjutsu", "speed"],
    ["Shadow Lotus", "intelligence", "Bukijutsu", "strength"], ["Iron Fang", "strength", "Taijutsu", "speed"],
]) test(`${bloodline}: recommended stat really improves its server attack AND defense`, () => {
    const c = character(bloodline);
    const recommendation = trainingRecommendation(c);
    assert.equal(recommendation.stat, stat);
    assert.equal(recommendation.discipline, discipline);
    assert.ok(recommendation.companionLine.includes(bloodline));
    assert.ok(recommendation.companionLine.startsWith(`Your ${bloodline} bloodline uses ${discipline} offense.`));
    assert.ok(recommendation.companionLine.includes(recommendation.label));
    assert.deepEqual(recommendation.generalStats, [stat, secondGeneral]);
    assert.match(recommendation.companionLine, /I'd start with \w+ or \w+/);
    for (const general of recommendation.generalStats) {
        const trained = { ...c.stats, [general]: c.stats[general] + 1 };
        assert.equal(getOffense(trained, discipline) - getOffense(c.stats, discipline), 1);
        assert.equal(getDefense(trained, discipline) - getDefense(c.stats, discipline), 1);
    }
    assert.equal(c.stats[recommendation.stat], 10, "recommendation must not change the character");
});

test("equipped bloodline and legacy alias match the game's active bloodline", () => {
    assert.equal(trainingRecommendation(character("Blue Blade Eyes")).discipline, "Genjutsu");
    const c = { ...character("Iron Fang"), equippedBloodlineId: "starter-bloodline-ashen-eyes" };
    assert.equal(trainingRecommendation(c).source, "Ashen Eyes");
});

test("custom bloodlines follow their damage techniques, not the old starter or support jutsu", () => {
    const custom: SavedBloodline = { ...starterSavedBloodlines[0]!, id: "custom", name: "Custom Storm",
        jutsus: [starterSavedBloodlines[1]!.jutsus[0]!, ...Array(5).fill(starterSavedBloodlines[0]!.jutsus[3]!)] };
    const result = trainingRecommendation({ ...character("Iron Fang"), equippedBloodlineId: "custom" }, [custom]);
    assert.equal(result.discipline, "Ninjutsu");
    assert.equal(result.source, "Custom Storm");
});

test("missing bloodline uses specialty and honestly labels its fallback", () => {
    const result = trainingRecommendation({ ...character("Unknown"), specialty: "Bukijutsu" });
    assert.equal(result.discipline, "Bukijutsu");
    assert.match(result.reason, /your specialty/);
    const general = trainingRecommendation({ ...character(""), specialty: "Any" });
    assert.match(general.reason, /general fallback/);
});

test("an explicitly damaging 40 AP technique counts toward a custom bloodline's style", () => {
    const custom: SavedBloodline = { ...starterSavedBloodlines[0]!, id: "custom", name: "Custom Flame",
        jutsus: [{ ...starterSavedBloodlines[1]!.jutsus[0]!, ap: 40, isUtility: false }, ...Array(3).fill(starterSavedBloodlines[0]!.jutsus[3]!)] };
    assert.equal(trainingRecommendation({ ...character("Iron Fang"), equippedBloodlineId: "custom" }, [custom]).discipline, "Ninjutsu");
});

test("skip capped stats and explain pooled gains if the whole path is capped", () => {
    const c = character("Inferno Cataclysm");
    const cap = statCapForLevel(c.level);
    c.stats.willpower = cap;
    assert.equal(trainingRecommendation(c).stat, "speed");
    c.stats.speed = cap;
    assert.equal(trainingRecommendation(c).stat, "ninjutsuOffense");
    assert.doesNotMatch(trainingRecommendation(c).reason, /and defense/);
    c.stats.ninjutsuOffense = c.stats.ninjutsuDefense = cap;
    assert.equal(trainingRecommendation(c).capped, true);
    assert.match(trainingRecommendation(c).reason, /unspent stat pool/);
});

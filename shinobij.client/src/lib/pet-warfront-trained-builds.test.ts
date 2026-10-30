import assert from "node:assert/strict";
import test from "node:test";
import type { Pet } from "../types/pet";
import { collectPetTraining, normalizePetGrowth, petGrowthPointsEarned, type GrowthAttribute } from "./pet-balance";
import { runPetSquadDuelCinematic } from "./pet-duel-cinematic";
import { runWarfrontRite, type RitePlan } from "./pet-warfront-rite";
import { runWarfrontRite as authorityRun } from "../../../api/_pet-sim/pet-warfront-rite";

const build = (attribute?: GrowthAttribute): Pet => normalizePetGrowth({
    id: "trained-pet", name: "Trained pet", rarity: "rare", level: 50, xp: 0, maxLevel: 100,
    hp: 1200, attack: 120, defense: 75, speed: 65, element: "None", role: "tracker", subRole: "kite",
    battleLoadoutVersion: "progression-v3", jutsus: [], growthVersion: 2,
    growthBaseStats: { hp: 1200, attack: 120, defense: 75, speed: 65 },
    growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0,
        ...(attribute ? { [attribute]: petGrowthPointsEarned(50) } : {}) },
} as Pet);
const duel = (blue: Pet, red: Pet) => runPetSquadDuelCinematic([blue], [red], 20, false, false, true, [5], [5]);
const damage = (result: ReturnType<typeof duel>) => result.events.find(e => e.type === "hit" && e.actorId === "player-0" && !e.crit)?.dmg ?? 0;

test("the four real Growth Point allocations affect current Warfront combat at the same level", () => {
    const base = build(), baseline = duel(base, base);
    const vitality = duel(build("vitality"), base);
    assert.ok(vitality.snapshots[0].actors[0].maxHp > baseline.snapshots[0].actors[0].maxHp * 1.3);
    assert.ok(damage(duel(build("power"), base)) > damage(baseline) * 1.3);
    assert.ok(damage(duel(base, build("guard"))) < damage(baseline), "Guard must reduce actual landed damage");
    const fast = duel(build("agility"), base);
    const firstTell = (result: typeof fast) => result.events.find(e => e.type === "windup" && e.actorId === "player-0")!.t;
    assert.ok(firstTell(fast) <= firstTell(baseline), "Agility cannot delay the opening");
    const hits = (result: typeof fast) => result.events.filter(e => e.type === "hit" && e.actorId === "player-0").length;
    assert.ok(hits(fast) > hits(baseline), "Agility must earn additional attacks, not just a faster animation");
});

test("completed training flows into the saved stats used by both Warfront resolvers", () => {
    const before = normalizePetGrowth({ ...build(), level: 1, xp: 99, growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 } });
    const trained = collectPetTraining({ ...before, training: { type: "strength", endsAt: 1 } } as Pet);
    assert.ok(trained.level > before.level && trained.attack > before.attack);
    assert.ok(trained.growthPoints! > before.growthPoints!);
    const band = ["vitality", "power", "guard", "agility"].map((stat, index) => ({ ...build(stat as GrowthAttribute), id: `pet-${index}` }));
    const plan: RitePlan = { formation: [2, 1, 3, 0], deployment: [8, 2, 5, 0], reformAfterClash: null };
    const opponent = band.map((pet, index) => ({ ...pet, id: `enemy-${index}` }));
    const result = runWarfrontRite(band, opponent, 23, plan);
    assert.deepEqual(authorityRun(band, opponent, 23, plan), result,
        "trained stats and roster-indexed placement must produce the same authoritative match");
    for (const combatant of result.clashes[0].blue) {
        assert.equal(combatant.petId, band[combatant.slot].id);
        assert.equal(combatant.node, plan.deployment![combatant.slot]);
    }
});

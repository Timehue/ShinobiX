import { runPetDuelCinematic, runPetPartyDuelCinematic } from "../shinobij.client/src/lib/pet-duel-cinematic";
import { DUEL_TPS, type DuelResult } from "../shinobij.client/src/lib/pet-duel-sim";
import type { Pet, PetJutsu } from "../shinobij.client/src/types/pet";
import type { PetRole, PetSubRole } from "../shinobij.client/src/lib/pet-roles";

type Element = "Fire" | "Water" | "Lightning" | "Earth" | "Wind";
const seedFor = (name: string) => [...name].reduce((seed, ch) => Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261) || 1;
const jutsu = (name: string, kind: PetJutsu["kind"], power: number, cooldown: number, extra: Partial<PetJutsu> = {}): PetJutsu => ({ name, kind, power, cooldown, currentCooldown: 0, ...extra });
const elementKit: Record<Element, PetJutsu[]> = {
    Fire: [jutsu("Cinder Brand", "burn", 102, 2), jutsu("Flame Burst", "push", 118, 4, { signature: true }), jutsu("Blazing Focus", "buff", 60, 5), jutsu("Cinder Flash", "move", 1, 3)],
    Water: [jutsu("Undertow", "slow", 102, 2), jutsu("Tidal Crash", "push", 112, 4, { signature: true }), jutsu("Tide Ward", "barrier", 62, 5), jutsu("Riptide Shift", "move", 1, 3)],
    Lightning: [jutsu("Static Mark", "mark", 98, 2), jutsu("Thunder Break", "stun", 116, 4, { signature: true }), jutsu("Overcharge", "haste", 58, 5), jutsu("Volt Switchback", "move", 1, 3)],
    Earth: [jutsu("Stone Crush", "crush", 106, 2), jutsu("Cataclysm", "push", 116, 4, { signature: true }), jutsu("Bastion", "barrier", 68, 5), jutsu("Stonebound Pivot", "move", 1, 3)],
    Wind: [jutsu("Gale Shear", "push", 102, 2), jutsu("Tempest", "slow", 114, 4, { signature: true }), jutsu("Tailwind", "haste", 58, 5), jutsu("Gale Spiral", "move", 1, 3)],
};

function pet(id: string, element: Element, role: PetRole = "tracker", subRole: PetSubRole = "control", over: Partial<Pet> = {}): Pet {
    return {
        id, name: id, rarity: "rare", level: 25, xp: 0, maxLevel: 100,
        hp: 820, attack: 105, defense: 52, speed: 88, element,
        role, subRole, jutsus: elementKit[element].map((move) => ({ ...move })),
        ...over,
    } as Pet;
}

function summarize(name: string, mode: "1v1" | "2v2", duel: DuelResult) {
    const snapshots = duel.snapshots;
    let distanceMin = Infinity, distanceMax = 0, crowded = 0;
    for (const snap of snapshots) {
        const player = snap.actors.find((actor) => actor.team === "player" && actor.hp > 0);
        const enemy = snap.actors.find((actor) => actor.team === "enemy" && actor.hp > 0);
        if (!player || !enemy) continue;
        const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
        distanceMin = Math.min(distanceMin, distance); distanceMax = Math.max(distanceMax, distance);
        if (distance < 2.5) crowded++;
    }
    const states = new Set(snapshots.flatMap((snap) => snap.actors.map((actor) => actor.ai?.state).filter(Boolean)));
    const targetSwitches = snapshots[0]?.actors.reduce((total, actor) => {
        let prior: string | null = null, changes = 0;
        for (const snap of snapshots) {
            const current = snap.actors.find((candidate) => candidate.id === actor.id)?.ai?.targetId ?? null;
            if (prior && current && prior !== current) changes++;
            prior = current;
        }
        return total + changes;
    }, 0) ?? 0;
    return {
        name, mode, result: duel.result, seconds: +(duel.ticks / DUEL_TPS).toFixed(1),
        ko: duel.events.filter((event) => event.type === "ko").length,
        dodges: duel.events.filter((event) => event.type === "dodge" && event.move === "Evade").length,
        maneuvers: duel.events.filter((event) => event.type === "maneuver").length,
        buffs: duel.events.filter((event) => event.type === "buff").length,
        ultimates: duel.events.filter((event) => event.type === "ultimate").length,
        elementalChains: duel.events.filter((event) => event.combo).length,
        rangeSpan: distanceMin < Infinity ? +(distanceMax - distanceMin).toFixed(1) : 0,
        crowdedPct: +((crowded / Math.max(1, snapshots.length)) * 100).toFixed(1),
        aiStates: states.size, targetSwitches,
    };
}

const elementPairs: Array<[Element, Element]> = [
    ["Fire", "Water"], ["Fire", "Earth"], ["Fire", "Wind"], ["Fire", "Lightning"],
    ["Water", "Earth"], ["Water", "Wind"], ["Water", "Lightning"],
    ["Earth", "Wind"], ["Earth", "Lightning"], ["Wind", "Lightning"],
];
const rows = elementPairs.map(([left, right]) => {
    const name = `${left} vs ${right}`;
    return summarize(name, "1v1", runPetDuelCinematic(pet(left, left), pet(right, right), seedFor(name), 1, 1, false, true, undefined, null, true));
});

const roles: Array<[string, PetRole, PetSubRole]> = [
    ["Defender mirror", "defender", "tank"], ["Attacker mirror", "tracker", "striker"],
    ["Assassin mirror", "assassin", "assassin"], ["Support mirror", "sage", "support"],
];
for (const [name, role, subRole] of roles) {
    rows.push(summarize(name, "1v1", runPetDuelCinematic(pet(`${name}-A`, "Earth", role, subRole), pet(`${name}-B`, "Earth", role, subRole), seedFor(name), 1, 1, false, true, undefined, null, true)));
}

const supportSolo = pet("Solo Support", "Water", "sage", "support", { hp: 900, defense: 65, jutsus: [jutsu("Mend", "heal", 105, 4), jutsu("Tide Ward", "barrier", 72, 4), jutsu("Undertow", "slow", 108, 2), jutsu("Riptide Shift", "move", 1, 3)] });
rows.push(summarize("Support solo viability", "1v1", runPetDuelCinematic(supportSolo, pet("Pressure Attacker", "Fire", "tracker", "striker", { hp: 720, attack: 92 }), seedFor("support"), 1, 1, false, true, undefined, null, true)));
rows.push(summarize("Melee vs ranged", "1v1", runPetDuelCinematic(pet("Melee", "Earth", "defender", "bruiser", { jutsus: [jutsu("Crush", "crush", 112, 2), jutsu("Bastion", "barrier", 60, 4)] }), pet("Ranged", "Wind", "tracker", "kite"), seedFor("melee-ranged"), 1, 1, false, true, undefined, null, true)));
rows.push(summarize("Burst vs durability", "1v1", runPetDuelCinematic(pet("Burst", "Lightning", "assassin", "assassin", { hp: 680, attack: 135, speed: 112 }), pet("Durability", "Earth", "defender", "tank", { hp: 1050, defense: 88, speed: 65 }), seedFor("burst-durability"), 1, 1, false, true, undefined, null, true)));

const partyScenarios: Array<{ name: string; player: [Pet, Pet]; enemy: [Pet, Pet] }> = [
    { name: "Fire + Wind vs Water + Lightning", player: [pet("Fire", "Fire", "assassin", "assassin"), pet("Wind", "Wind", "sage", "support")], enemy: [pet("Water", "Water", "defender", "tank"), pet("Lightning", "Lightning", "tracker", "striker")] },
    { name: "Earth + Support", player: [pet("Earth Tank", "Earth", "defender", "tank"), supportSolo], enemy: [pet("Fire Offense", "Fire", "assassin", "striker"), pet("Wind Offense", "Wind", "tracker", "kite")] },
    { name: "Double offense", player: [pet("Fire Burst", "Fire", "assassin", "assassin"), pet("Volt Burst", "Lightning", "assassin", "striker")], enemy: [pet("Water Front", "Water", "defender", "tank"), pet("Earth Front", "Earth", "defender", "bruiser")] },
    { name: "No-synergy comp", player: [pet("Earth A", "Earth"), pet("Earth B", "Earth")], enemy: [pet("Wind A", "Wind"), pet("Wind B", "Wind")] },
    { name: "Outnumbered / regroup", player: [pet("Fragile Ally", "Fire", "assassin", "assassin", { hp: 470, defense: 25 }), pet("Survivor", "Water", "defender", "tank", { hp: 1100, defense: 90 })], enemy: [pet("Hunter A", "Lightning", "tracker", "striker"), pet("Hunter B", "Wind", "tracker", "kite")] },
    { name: "Comeback pressure", player: [pet("Glass Lead", "Lightning", "assassin", "assassin", { hp: 560, attack: 145 }), pet("Late Anchor", "Earth", "defender", "tank", { hp: 1100, attack: 115, defense: 92 })], enemy: [pet("Steady A", "Water", "tracker", "control"), pet("Steady B", "Fire", "tracker", "striker")] },
];
for (const scenario of partyScenarios) {
    const duel = runPetPartyDuelCinematic(scenario.player[0], scenario.player[1], scenario.enemy[0], scenario.enemy[1], seedFor(scenario.name), 1, 1, false, true, undefined, true);
    rows.push(summarize(scenario.name, "2v2", duel));
}

console.table(rows);
const warnings = rows.flatMap((row) => [
    ...(row.seconds >= 75 ? [`${row.name}: reached the 75s score-decision cap`] : []),
    ...(row.crowdedPct > 20 ? [`${row.name}: crowded ${row.crowdedPct}% of snapshots`] : []),
    ...(row.rangeSpan < 3.5 ? [`${row.name}: narrow range span ${row.rangeSpan}`] : []),
    ...(row.aiStates < 4 ? [`${row.name}: only ${row.aiStates} AI states observed`] : []),
]);
console.log("\nReview warnings:");
console.log(warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "- none");

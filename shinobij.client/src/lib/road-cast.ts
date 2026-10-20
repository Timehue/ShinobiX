/*
 * The road cast beyond the natural roll (lib/wanderers.ts): who else walks a
 * sector for THIS player, and how the road patrols treat them.
 *
 *   - the angler or rival miner at a resource node, and the rift-touched
 *     creature in the target sector of the player's own rift
 *     (shared/wanderer-extra-slots.ts);
 *   - Kagero, the road rival, once the road has beaten the player
 *     (shared/road-nemesis.ts);
 *   - patrols renamed and re-voiced for the village that holds the sector
 *     (shared/village-patrol.ts).
 *
 * Pure apart from the hook at the bottom. The server runs the same shared rules,
 * so every actor here is one it will recognise.
 */
import { useMemo } from "react";
import { extraSlotWanderersAt, riftSealOf } from "../../../shared/wanderer-extra-slots";
import {
    ROAD_NEMESIS_NAME,
    roadNemesisActorId,
    roadNemesisAftermath,
    roadNemesisGreeting,
    roadNemesisPresentIn,
    roadNemesisTier,
    roadNemesisTitle,
} from "../../../shared/road-nemesis";
import { patrolGreeting, patrolNameFor, patrolStance } from "../../../shared/village-patrol";
import { RESOURCE_NODES } from "../../../shared/resource-nodes";
import { readResourceGathering, resourceSkillLevel } from "../../../shared/resource-gathering";
import {
    WANDERER_ARCHETYPES,
    WANDERER_NIGHT_INDEX,
    WANDERER_RIFT_INDEX,
    WANDERER_TRADE_INDEX,
    interiorTile,
    mulberry32,
    nearbyTile,
    placeWanderer,
} from "../../../shared/wanderer-roster";
import {
    currentWandererDayBucket,
    hasWandererRelocated,
    isWandererOnCooldown,
    parseWandererId,
    wandererHash32,
    type Wanderer,
} from "./wanderers";
import { serverNow } from "./server-clock";
import { ordinaryWandererEncounter } from '../../../shared/wanderer-roster';
import { ordinaryPvePortrait } from './ordinary-pve-presentation';
import { activeVillageWarsFor, loadSectorTerritory } from "./world-state";

export { roadNemesisActorId, roadNemesisTier, roadNemesisTitle };

export function withOrdinaryPvePreview(wanderer: Wanderer, playerLevel: number, sector: number | null | undefined): Wanderer {
    const encounter = sector != null ? ordinaryWandererEncounter(wanderer, playerLevel, sector) : null;
    return encounter ? { ...wanderer, level: encounter.level, avatarImage: ordinaryPvePortrait(encounter) } : wanderer;
}

type CastCharacter = {
    name: string;
    level: number;
    activeRiftQuest?: unknown;
    wandererNemesis?: { name?: string; level?: number; tier?: number } | null;
};

/** A hostile that stops you with Fight/Flee when it reaches you: you cannot
 *  wave it off, only fight it or pay to run. */
export function wandererForcesChoice(w: Wanderer): boolean {
    return w.verb === "attack" || w.verb === "bountyHunter" || (w.verb === "patrol" && w.patrolStance === "rivalWar");
}

/** The subtitle under a wanderer's name in the encounter dialog. */
export function wandererKindLabel(w: Wanderer): string {
    if (w.verb === "petDuel") return "Wild beast";
    if (w.archetype === "riftspawn") return "Rift-touched creature";
    if (w.verb === "angler") return "Angler";
    if (w.verb === "contest") return "Rival miner";
    if (w.factionVillage) return `${w.factionVillage} patrol`;
    return "Wandering shinobi";
}

/** The angler, miner and rift creature this player can see in `sector`. */
export function extraRoadWanderers(
    sector: number,
    dayBucket: number,
    character: CastCharacter,
    cooldowns: Record<string, number> | null | undefined,
    moves: Record<string, number> | null | undefined,
    now: number,
): Wanderer[] {
    return extraSlotWanderersAt(sector, dayBucket, riftSealOf(character))
        .filter((w) => !isWandererOnCooldown(cooldowns, w.id, now) && !hasWandererRelocated(moves, w.id));
}

/** Kagero's actor in `sector`, when he is waiting there for this player. */
export function roadNemesisWanderer(
    sector: number,
    dayBucket: number,
    character: CastCharacter,
    cooldowns: Record<string, number> | null | undefined,
    now: number,
): Wanderer | null {
    if (!character.wandererNemesis || !roadNemesisPresentIn(character.name, sector, dayBucket)) return null;
    const id = roadNemesisActorId(sector, dayBucket);
    if (isWandererOnCooldown(cooldowns, id, now)) return null;
    const tier = roadNemesisTier(character.wandererNemesis);
    const rng = mulberry32(wandererHash32(`${id}#${character.name.trim().toLowerCase()}`));
    const home = interiorTile(rng);
    const waypoints = Array.from(new Set([home, nearbyTile(home, rng), nearbyTile(home, rng)]));
    return placeWanderer({
        id,
        name: roadNemesisTitle(tier),
        archetype: "nemesis",
        verb: "attack",
        level: Math.max(1, Math.min(100, character.level + tier)),
        homeTile: home,
        waypoints,
        movement: "pursue",
        greeting: roadNemesisGreeting(tier, character.name),
        tellTint: WANDERER_ARCHETYPES.nemesis.tellTint,
        avatarKey: "nemesis",
    }, sector);
}

/** Re-voice the patrols for the village that holds the sector. */
export function withPatrolStance(
    wanderers: readonly Wanderer[],
    ownerVillage: string | undefined,
    playerVillage: string | undefined,
    warEnemies: readonly string[],
): Wanderer[] {
    const stance = patrolStance(ownerVillage, playerVillage, warEnemies);
    if (!stance) return wanderers as Wanderer[];
    return wanderers.map((w) => w.verb !== "patrol" ? w : {
        ...w,
        name: patrolNameFor(ownerVillage, stance, w.name),
        greeting: patrolGreeting(stance, wandererHash32(w.id)),
        factionVillage: ownerVillage,
        patrolStance: stance,
        // At war, the holder's patrol hunts you down like a bandit.
        movement: stance === "rivalWar" ? "pursue" : w.movement,
    });
}

const BAIT_LORE = [
    "Equip a fishing pole in Inventory before you cast.",
    "Practicing raises your Fishing skill and helps you catch better fish.",
    "A worn-out pole won't help you. Check its durability before fishing.",
    "Each shoal allows three attempts before it needs time to refill.",
];

/** What the angler tells you about the water in `sector`. */
export function anglerTip(sector: number, resourceGathering: unknown, dayBucket: number): string {
    const level = resourceSkillLevel(readResourceGathering(resourceGathering).fishingXp);
    const shoals = RESOURCE_NODES.filter((node) => node.sector === sector && node.activity === "fishing")
        .sort((a, b) => b.difficulty - a.difficulty);
    const best = shoals.find((node) => node.difficulty <= level) ?? shoals[shoals.length - 1];
    const lore = BAIT_LORE[Math.abs(dayBucket + sector) % BAIT_LORE.length];
    if (!best) return `"${lore}"`;
    const fit = best.difficulty <= level
        ? `Try ${best.name}. Your Fishing skill is high enough to fish there.`
        : `You need Fishing skill ${best.difficulty} to fish at ${best.name}. Practice at an easier shoal first.`;
    return `"${fit} ${lore}"`;
}

/** The line shown after a single road fight, by who you fought. */
export function roadFightAftermath(input: {
    sourceId: string;
    name?: string;
    won: boolean;
    nemesisTier: number;
}): string | null {
    const { sourceId, name, won } = input;
    if (sourceId === "nemesis") return roadNemesisAftermath(won, input.nemesisTier);
    const slot = parseWandererId(sourceId)?.index;
    if (slot === WANDERER_TRADE_INDEX) return won
        ? `${name ?? "The miner"} spits, shoulders his pick, and leaves the seam to you.`
        : `${name ?? "The miner"} goes back to his seam without another look at you.`;
    if (slot === WANDERER_RIFT_INDEX) return won
        ? "The creature comes apart in ash and violet sparks. The rift will spit out another before long."
        : "It drags itself back toward the rift and leaves you bleeding in the dust.";
    if (won) return null;
    if (slot === WANDERER_NIGHT_INDEX) return `${name ?? "The night ninja"} melts back into the dark. Somewhere on the road, ${ROAD_NEMESIS_NAME} hears that you lost.`;
    return `${name ?? "The bandit"} took what they wanted and laughed. Word of it is already on the road, and ${ROAD_NEMESIS_NAME} is listening.`;
}

/** The villages at war with `village` right now. */
function warEnemiesOf(village: string | undefined): string[] {
    if (!village) return [];
    return activeVillageWarsFor(village).flatMap((war) => war.villages.filter((v) => v !== village));
}

/**
 * The full road cast for `sector`: the natural roll (already filtered by the
 * caller), the extra-slot actors, and Kagero, with patrols re-voiced for the
 * village that holds the road.
 */
export function useRoadCast(
    sector: number | null | undefined,
    natural: readonly Wanderer[],
    character: CastCharacter & { village?: string; wandererCooldowns?: Record<string, number>; wandererMoves?: Record<string, number> },
): Wanderer[] {
    const { name, level, activeRiftQuest, wandererNemesis, village, wandererCooldowns, wandererMoves } = character;
    // Territory and wars are polled world state; reading them each render keeps
    // the patrols current, and the string keys keep the memo stable.
    const ownerVillage = sector != null ? loadSectorTerritory(sector).ownerVillage || undefined : undefined;
    const enemyKey = warEnemiesOf(village).join("|");
    return useMemo(() => {
        if (sector == null) return [];
        const now = serverNow();
        const bucket = currentWandererDayBucket();
        const self = { name, level, activeRiftQuest, wandererNemesis };
        const nemesis = roadNemesisWanderer(sector, bucket, self, wandererCooldowns, now);
        return [
            ...withPatrolStance(natural, ownerVillage, village, enemyKey ? enemyKey.split("|") : []),
            ...extraRoadWanderers(sector, bucket, self, wandererCooldowns, wandererMoves, now),
            ...(nemesis ? [nemesis] : []),
        ];
    }, [sector, natural, name, level, activeRiftQuest, wandererNemesis, village, wandererCooldowns, wandererMoves, ownerVillage, enemyKey]);
}

/*
 * The two roster slots above the night ninja (shared/wanderer-roster.ts).
 *
 *   WANDERER_TRADE_INDEX: an angler at a fishing shoal or a rival miner at an
 *     ore seam. World-deterministic from (sector, window), like the daytime
 *     cast, so every player in the sector sees the same one. Only sectors with
 *     an ordinary resource node (shared/resource-nodes.ts) can hold one.
 *   WANDERER_RIFT_INDEX: a rift-touched creature. Per player: it stands only in
 *     the target sector of the rift that player holds a seal for
 *     (character.activeRiftQuest), so nobody else sees it.
 *
 * Both ids keep the natural `w-<sector>-<bucket>-<index>` shape, so the
 * server's per-wanderer use cooldown and relocation apply to them unchanged.
 * Neither actor pays anything of its own: the angler only talks, and a fight
 * with the miner or the creature is an ordinary World fight under the shared
 * daily AI-fight cap.
 */
import { isPlayableWildSector, playableFieldObjectiveSector } from "./sector-geo.js";
import { RESOURCE_NODES } from "./resource-nodes.js";
import { isWalkableTile, tileNeighbors } from "./sector-walk-mask.js";
import {
    WANDERER_ARCHETYPES,
    WANDERER_RIFT_INDEX,
    WANDERER_TRADE_INDEX,
    interiorTile,
    mulberry32,
    naturalWandererMovement,
    nearbyTile,
    parseWandererId,
    placeWanderer,
    wandererDayBucketFromMs,
    wandererHash32,
    wandererLevelFor,
    type Wanderer,
    type WandererArchetypeId,
} from "./wanderer-roster.js";

/** Share of resource-node sectors that hold an angler or a miner in a window.
 *  Every playable sector has a node since the 2026-10-14 world-wide pass, so
 *  this is 12% (about 8 of 65 sectors per window), not the 50% it was when only
 *  ten sectors had nodes. */
export const TRADE_WANDERER_CHANCE = 0.12;

/** The rift a player holds a seal for, as the save stores it. */
export type RiftSealView = { id: string; targetSector: number };

function slotWanderer(
    archetype: WandererArchetypeId,
    id: string,
    sector: number,
    home: number,
    waypoints: number[],
    rng: () => number,
): Wanderer {
    const meta = WANDERER_ARCHETYPES[archetype];
    return {
        id,
        name: meta.names[Math.floor(rng() * meta.names.length)],
        archetype,
        verb: meta.verb,
        level: wandererLevelFor(sector, rng),
        homeTile: home,
        waypoints,
        movement: naturalWandererMovement(archetype),
        greeting: meta.greetings[Math.floor(rng() * meta.greetings.length)],
        tellTint: meta.tellTint,
        avatarKey: archetype,
    };
}

/** The angler or rival miner working a node in `sector` this window, or null.
 *  They stand beside the node, never on the tile a gatherer stands on. */
export function rollTradeWanderer(sector: number, dayBucket: number): Wanderer | null {
    if (!isPlayableWildSector(sector) || !Number.isSafeInteger(dayBucket)) return null;
    const nodes = RESOURCE_NODES.filter((node) => node.sector === sector);
    if (nodes.length === 0) return null;
    const rng = mulberry32(wandererHash32(`trade:${sector}:${dayBucket}`));
    if (rng() >= TRADE_WANDERER_CHANCE) return null;
    const node = nodes[Math.floor(rng() * nodes.length)];
    const beside = tileNeighbors(node.approach).filter((tile) => tile !== node.target && isWalkableTile(sector, tile));
    const home = beside[0] ?? node.approach;
    const archetype: WandererArchetypeId = node.activity === "fishing" ? "angler" : "rivalMiner";
    return placeWanderer(slotWanderer(archetype, `w-${sector}-${dayBucket}-${WANDERER_TRADE_INDEX}`, sector, home, [home], rng), sector);
}

/** Read a rift quest's id and target sector, or null. The client reads its
 *  display mirror (character.activeRiftQuest) with this; the server passes the
 *  record's sealed activeRiftQuestSeal, which has the same two fields. */
export function riftSealOf(character: { activeRiftQuest?: unknown } | null | undefined): RiftSealView | null {
    const raw = character?.activeRiftQuest;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    // The map sends a rift aimed at the festival sector to its field fallback.
    const targetSector = playableFieldObjectiveSector(Math.floor(Number(value.targetSector)));
    if (typeof value.id !== "string" || !value.id || !isPlayableWildSector(targetSector)) return null;
    return { id: value.id, targetSector };
}

/** The rift-touched creature hunting the seal holder in `sector`, or null.
 *  It exists only in the target sector of the player's own rift. */
export function rollRiftSpawn(sector: number, dayBucket: number, rift: RiftSealView | null): Wanderer | null {
    if (!rift || rift.targetSector !== sector || !isPlayableWildSector(sector) || !Number.isSafeInteger(dayBucket)) return null;
    const rng = mulberry32(wandererHash32(`riftspawn:${sector}:${dayBucket}:${rift.id}`));
    const home = interiorTile(rng);
    const waypoints = [home];
    const legs = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < legs; i++) waypoints.push(nearbyTile(home, rng));
    return placeWanderer(slotWanderer("riftspawn", `w-${sector}-${dayBucket}-${WANDERER_RIFT_INDEX}`, sector, home, Array.from(new Set(waypoints)), rng), sector);
}

/** The extra-slot actors standing in `sector` for this player right now. */
export function extraSlotWanderersAt(sector: number, dayBucket: number, rift: RiftSealView | null): Wanderer[] {
    return [rollTradeWanderer(sector, dayBucket), rollRiftSpawn(sector, dayBucket, rift)]
        .filter((w): w is Wanderer => w !== null);
}

/**
 * Server authority for the two extra slots: the wanderer an id names IF the id
 * is for the current window and the slot really holds someone for this player.
 * Slots 0..2 go through resolveWandererById instead; this returns null for them.
 *
 * `rift` must come from server-owned state (the save record's
 * activeRiftQuestSeal), never from character.activeRiftQuest: that field is a
 * display mirror the client's own save writes can set, so trusting it would let
 * a forged save summon a rift creature in any sector.
 */
export function resolveExtraSlotWanderer(
    id: string,
    nowMs: number,
    rift: RiftSealView | null,
): Wanderer | null {
    const parsed = parseWandererId(id);
    if (!parsed || !Number.isSafeInteger(parsed.sector) || !Number.isSafeInteger(parsed.dayBucket)
        || parsed.dayBucket !== wandererDayBucketFromMs(nowMs)) return null;
    if (parsed.index === WANDERER_TRADE_INDEX) return rollTradeWanderer(parsed.sector, parsed.dayBucket);
    if (parsed.index === WANDERER_RIFT_INDEX) return rollRiftSpawn(parsed.sector, parsed.dayBucket, rift);
    return null;
}

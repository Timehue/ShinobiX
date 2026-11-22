/*
 * Who walks the Unmapped Coast: Unmoored patrols and the coast's own beasts.
 *
 * The home map's road cast (shared/wanderer-roster.ts) never reaches the coast.
 * Its sectors would be empty ground between quest steps without a roster of
 * their own, so each open sector posts two encounters a day:
 *   - one Unmoored patrol, and
 *   - one beast of that region, or a second patrol.
 * The slip (sector 101) is kept quiet: it is where everyone lands.
 *
 * Which two, and where they stand, is worked out from the sector, the slot and
 * the UTC day, so the server needs no stored roster and a reset needs no step.
 * A player can drive each one off once a day. The fight is an ordinary sealed
 * world fight and pays the ordinary AI purse under the ordinary daily caps:
 * nothing about rewards is new here.
 *
 * Every figure wears a world model the game already has (owner ruling: no new
 * character art). Names are new. Levels follow the region's band, so a sector
 * deeper into a region is harder than its edge, and they do not bend to the
 * player: walking into Hushcrown at level 75 is meant to go badly.
 *
 * Names, levels and stat bonuses are placeholders for the owner's sign-off.
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { COAST_LANDING_SECTOR, COAST_REGION_LEVELS, coastRegionOf, isCoastSector } from '../../shared/world-maps.js';
import { coastExits, coastLayout, isCoastSectorOpen } from '../../shared/coast-world.js';
import { COAST_GRID } from '../../shared/coast-world-rules.js';
import type { OrdinaryPveArchetype } from '../../shared/ordinary-pve-encounter.js';
import { parseQuestLines } from '../quests/_record.js';

const DAY = 24 * 60 * 60_000;

export interface CoastPatrolKind {
    id: string;
    name: string;
    /** An existing world model, by file name. */
    model: string;
    loadoutId: 'bruiser' | 'burst' | 'defender';
    /** On the scale the road cast uses: 0 for rank and file, a few points for a harder foe. */
    statBonus: number;
    beast?: true;
}

export const COAST_UNMOORED_PATROLS: readonly CoastPatrolKind[] = [
    { id: 'scout', name: 'Unmoored Scout', model: 'underground-patrol', loadoutId: 'burst', statBonus: 1 },
    { id: 'blade', name: 'Unmoored Blade', model: 'underground-bandit', loadoutId: 'bruiser', statBonus: 2 },
    { id: 'warden', name: 'Unmoored Warden', model: 'ambush-bandit-3', loadoutId: 'defender', statBonus: 2 },
    { id: 'nightwalker', name: 'Unmoored Nightwalker', model: 'underground-night-ninja', loadoutId: 'burst', statBonus: 3 },
];

/** One beast per region, region 1 first. */
export const COAST_BEASTS: readonly CoastPatrolKind[] = [
    { id: 'saltmarsh-hound', name: 'Saltmarsh Hound', model: 'hollow-hound', loadoutId: 'bruiser', statBonus: 1, beast: true },
    { id: 'brackwater-fox', name: 'Brackwater Fox', model: 'ember-fox', loadoutId: 'burst', statBonus: 2, beast: true },
    { id: 'briar-stalker', name: 'Briar Stalker', model: 'riftspawn', loadoutId: 'burst', statBonus: 3, beast: true },
    { id: 'rime-hound', name: 'Rime Hound', model: 'hollow-hound', loadoutId: 'bruiser', statBonus: 3, beast: true },
    { id: 'crown-shade', name: 'Crown Shade', model: 'riftspawn', loadoutId: 'defender', statBonus: 4, beast: true },
];

/** The level band of each region, region 1 first (the plan's bands). */
export { COAST_REGION_LEVELS };
export const COAST_PATROL_SLOTS = 2;

/**
 * What an ambush found while exploring the coast is called, by the ordinary
 * fight role it rolled (shared/ordinary-pve-encounter.ts). Only the name
 * changes: the fight, its level rule and its purse are the home map's.
 */
export const COAST_AMBUSH_NAMES: Readonly<Record<OrdinaryPveArchetype, string>> = Object.freeze({
    bruiser: 'Unmoored Brawler',
    skirmisher: 'Unmoored Runner',
    assassin: 'Unmoored Knife',
    elementalist: 'Unmoored Tide Caller',
    defender: 'Unmoored Shieldbearer',
});

export interface CoastPatrol {
    /** `<sector>:<slot>:<day>`: what a fight request names. */
    id: string;
    sector: number;
    slot: number;
    kind: CoastPatrolKind;
    level: number;
    /** Where it stands in the sector. */
    tile: number;
}

const coastDay = (now: number) => Math.floor(now / DAY);
function hash(text: string): number {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return value >>> 0;
}

/** How hard a sector's foes are: the region's band, rising from its first sector to its last. */
export function coastSectorLevel(sector: number): number {
    const region = coastRegionOf(sector);
    const [low, high] = COAST_REGION_LEVELS[region - 1] ?? COAST_REGION_LEVELS[0];
    const depth = ((sector - 101) % 10) / 9;
    return Math.round(low + (high - low) * depth);
}

/**
 * How hard a sector's patrols and beasts are. They stand above the sector's
 * own level: two levels above at a region's first sector and ten above its
 * first at its last, never past level 100.
 *
 * Owner ruling 2026-11-21, after the coast moved to level 75: "make the patrols
 * harder too". The regions are five levels wide now where they were eight to
 * thirteen, so a patrol that stood at the sector's own level was at most five
 * above a player who had just reached the region, where it used to be up to
 * thirteen. This puts the far end of a region back at ten above its gate. A
 * flat stat bonus could not do it: stats are capped, and a level 100 foe is
 * already at the cap. The board shows this level, and the fight is fought at it.
 */
export const COAST_PATROL_EDGE = { near: 2, deep: 5 } as const;
export function coastPatrolLevel(sector: number): number {
    const depth = ((sector - 101) % 10) / 9;
    return Math.min(100, coastSectorLevel(sector) + COAST_PATROL_EDGE.near + Math.round((COAST_PATROL_EDGE.deep - COAST_PATROL_EDGE.near) * depth));
}

/** Open ground a figure can stand on without blocking a doorway or a trail's end. */
function standingTiles(sector: number): number[] {
    const layout = coastLayout(sector);
    if (!layout) return [];
    const taken = new Set<number>([...Object.values(layout.sites).map(site => site.approach), ...coastExits(sector).map(exit => exit.tile)]);
    const tiles: number[] = [];
    layout.mask.forEach((row, y) => [...row].forEach((cell, x) => {
        const tile = y * COAST_GRID + x;
        if (cell === '=' && !taken.has(tile)) tiles.push(tile);
    }));
    return tiles;
}

/** The encounters a sector posts on the day `now` falls in. */
export function coastPatrolsIn(sector: number, now: number): CoastPatrol[] {
    if (!isCoastSector(sector) || !isCoastSectorOpen(sector) || sector === COAST_LANDING_SECTOR) return [];
    const day = coastDay(now), tiles = standingTiles(sector), level = coastPatrolLevel(sector);
    if (!tiles.length) return [];
    const patrols: CoastPatrol[] = [];
    const used = new Set<number>();
    for (let slot = 0; slot < COAST_PATROL_SLOTS; slot++) {
        const roll = hash(`coast-patrol:${sector}:${slot}:${day}`);
        // The first slot is always the Unmoored; the second is the region's beast two days in three.
        const beast = slot === 1 && roll % 3 !== 0 ? COAST_BEASTS[coastRegionOf(sector) - 1] : undefined;
        const kind = beast ?? COAST_UNMOORED_PATROLS[roll % COAST_UNMOORED_PATROLS.length];
        let pick = roll % tiles.length;
        while (used.has(tiles[pick]) && used.size < tiles.length) pick = (pick + 1) % tiles.length;
        used.add(tiles[pick]);
        patrols.push({ id: `${sector}:${slot}:${day}`, sector, slot, kind, level, tile: tiles[pick] });
    }
    return patrols;
}

// Account deletion clears these by pattern (api/_delete-player-account.ts); keep the two in step.
const beatenKey = (player: string, day: number) => `coast:patrol-beaten:${player}:${day}`;
const BEATEN_TTL_SEC = 2 * 24 * 60 * 60;

async function beatenToday(player: string, now: number): Promise<string[]> {
    const stored = await kv.get<unknown>(beatenKey(player, coastDay(now)));
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * The patrol a fight request names, if this player may fight it now. Throws a
 * sentence the player can read; the fight route shows it as it is.
 */
export async function coastPatrolFightStart(playerName: string, sector: number, patrolId: string, now: number): Promise<CoastPatrol> {
    const patrol = coastPatrolsIn(sector, now).find(entry => entry.id === patrolId);
    if (!patrol) throw new Error('That patrol has moved on.');
    if ((await beatenToday(safeName(playerName), now)).includes(patrol.id)) throw new Error('You have already driven that one off today. It will be back tomorrow.');
    return patrol;
}

/**
 * Mark a patrol driven off, from the fight's own settlement. The id carries its
 * day, so a fight that ends just after midnight marks the day it was started
 * for, and a settlement that is retried marks nothing twice.
 */
export async function recordCoastPatrolWin(playerName: string, patrolId: string): Promise<void> {
    const player = safeName(playerName), day = Number(patrolId.split(':')[2]);
    if (!player || !Number.isInteger(day)) return;
    const key = beatenKey(player, day);
    // Read and write under the row's own lock, so two settlements landing
    // together cannot each write a list without the other's patrol.
    await withKvLock(key, async () => {
        const stored = await kv.get<unknown>(key);
        const beaten = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
        if (beaten.includes(patrolId)) return;
        await kv.set(key, [...beaten, patrolId].slice(-200), { ex: BEATEN_TTL_SEC });
    });
}
export interface CoastPatrolView { id: string; name: string; model: string; level: number; tile: number; beast: boolean; beaten: boolean }

/**
 * What a player's finished quests have made of the Unmoored they meet.
 *
 * Who walks a sector, where they stand and how hard they are never change:
 * that is the same for everyone and is worked out above. What changes is who
 * they are to THIS player, which is their name on the board and in the fight:
 *   - `unmoored`: the garrison of their region still stands. Also the whole
 *     coast again once the player has asked for it to be kept closed: the
 *     Unmoored hold the shore by that player's own word.
 *   - `masterless`: the player has beaten the commander of their region, so
 *     the ones still walking it answer to nobody.
 *   - `holdout`: the player asked for the coast to be opened, and these are
 *     the ones who will not have it.
 * Beasts are beasts whatever a player has done.
 */
export type CoastPatrolStanding = 'unmoored' | 'masterless' | 'holdout';
/** The Crossing War quest that ends each region, region 1 first. */
const REGION_ENDING_QUESTS = ['crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'crossing-war-5'] as const;
const COAST_FINALE_QUEST = 'the-unmoored';

export function coastPatrolStanding(sector: number, save: Record<string, unknown> | null | undefined): CoastPatrolStanding {
    const done = parseQuestLines(save?.questLines).done;
    if (Object.hasOwn(done, COAST_FINALE_QUEST)) {
        const standings = (save?.character as { questStandings?: unknown } | undefined)?.questStandings;
        return Array.isArray(standings) && standings.includes('coast-opened') ? 'holdout' : 'unmoored';
    }
    return Object.hasOwn(done, REGION_ENDING_QUESTS[coastRegionOf(sector) - 1] ?? '') ? 'masterless' : 'unmoored';
}

export function coastPatrolName(kind: CoastPatrolKind, standing: CoastPatrolStanding): string {
    if (kind.beast || standing === 'unmoored') return kind.name;
    return kind.name.replace('Unmoored', standing === 'holdout' ? 'Holdout' : 'Masterless');
}

/** The player's save, read only to learn what their quests have changed. A missing save changes nothing. */
const savedQuests = (player: string) => kv.get<Record<string, unknown>>(`save:${player}`).catch(() => null);

/** What a player standing in a coast sector is shown of who walks it today. */
export async function coastPatrolViews(playerName: string, sector: number, now: number): Promise<CoastPatrolView[]> {
    const patrols = coastPatrolsIn(sector, now);
    if (!patrols.length) return [];
    const player = safeName(playerName);
    const [beaten, save] = await Promise.all([beatenToday(player, now), savedQuests(player)]);
    const standing = coastPatrolStanding(sector, save);
    return patrols.map(patrol => ({
        id: patrol.id, name: coastPatrolName(patrol.kind, standing), model: patrol.kind.model, level: patrol.level, tile: patrol.tile,
        beast: patrol.kind.beast === true, beaten: beaten.includes(patrol.id),
    }));
}

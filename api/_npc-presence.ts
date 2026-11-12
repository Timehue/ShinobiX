/**
 * Cinderhold's shinobi in the world (Push 2, 2026-11-09).
 *
 * Every NPC not under admin control is written into the same presence store
 * players' heartbeats use, so the existing world UI shows them like any other
 * shinobi and the existing world attack starts a real PvP duel with them (the
 * server then plays the NPC's seat; api/_npc-duel-driver.ts). Rebuilt from the
 * NPC's save on every tick, so a rescale or rebuild shows at once.
 *
 * Where they are (owner ruling 2026-11-11): war duty first, exactly as before
 * (a village-war or clan-war order, then a war front's squad, reached in one
 * trip and held). Every other NPC is out on a JOURNEY (api/_npc-journeys.ts):
 * a destination with a reason, walked tile by tile and road by road at a
 * player's pace by the in-memory walker this module starts beside the tick, a
 * few minutes spent there, then the next one. A rival hunt and watching the
 * world boss are journeys with that purpose. No per-sector cap applies.
 *
 * NPCs have no browser, so this tick is also their heartbeat. A player's beat
 * re-derives `inBattle` from the combat stores; without that an NPC mid-duel
 * across a restart would read free. So each tick derives `inBattle` the same
 * way (resolveBattleAuthority). An attacked NPC carries no `pendingAttacker`
 * (player/attack.ts); it is held in memory instead (api/_npc-attack-hold.ts)
 * from the attack until its seat joins. The tick still drops any attacker flag
 * that outlives it with no duel behind it, should one ever be set.
 */
import { cinderholdWorldModel } from '../shared/cinderhold-world-models.js';
import { kv } from './_storage.js';
import { playerSessionsEnabled } from './_auth.js';
import { onlineStore } from './_realtime/online-store.js';
import { queuePresenceUpdate } from './_realtime/presence-broadcast.js';
import { PRESENCE_CHARACTER_FIELDS, presenceBroadcastSignature, slimPresenceCharacter } from './_realtime/presence-input.js';
import { readKvProjection, type KvProjection } from './_storage-projection.js';
import { npcOwnedIds } from './_npc-ownership.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from './_realtime/battle-authority.js';
import { battleStartedWithin } from './_realtime/battle-projection.js';
import { npcPossessKey, type NpcPossession } from './_npc-possession.js';
import { NPC_VILLAGE_ROSTER, type NpcShinobi } from '../shared/npc-village-roster.js';
import { SECTOR_GRID_WIDTH, nearestWalkableTile } from '../shared/sector-walk-mask.js';
import { isNpcWarDefenderRank, npcWarParticipants } from './_npc-war-roster.js';
import { npcWarFronts } from './_npc-village-war.js';
import { woundedNpcIds } from './_npc-wounds.js';
import { liveNpcCampaignPosts, npcOrderTile, type NpcCampaignAssignment } from './_npc-campaign-assignments.js';
import { PUBLIC_INDEX_CHARACTER_FIELDS, REGISTRY_KEY, buildPublicPlayerIndexEntry } from './player/_public-index.js';
import {
    NPC_BOSS_WATCHERS, NPC_GROUND_SECTORS, isNodeApproachTile, isNpcRoamSector, npcHuntRegistry, npcStandTile, npcWorldBossSector,
} from './_npc-roam.js';
import { safeName } from './_utils.js';
import {
    NPC_WALK_TICK_MS, announceNpcStep, dropNpcJourney, ensureNpcJourney, holdNpcJourney, npcTravelMs, releaseNpcJourney,
    setNpcJourneyErrand, setNpcJourneyWorld, stepNpcJourneys, syncNpcJourneyActivity,
} from './_npc-journeys.js';
import { npcPinned } from './_npc-attack-hold.js';

export { NPC_TRAVEL_MS, npcTravelMs, setNpcTravelMsForTest } from './_npc-journeys.js';

/** War-front squads (and the boss's watchers) rotate on this window. */
export const NPC_POST_WINDOW_MS = 30 * 60 * 1000;
export const NPC_PRESENCE_TICK_MS = 20_000;
/**
 * Looking like players (2026-11-10). A front's guard takes its post at its own
 * moment inside the window (up to NPC_MOVE_SPREAD_MS late), not the whole squad
 * on the half hour; and every NPC is offline for a few hours each day, at its
 * own time. Free movement is the journey walker's (api/_npc-journeys.ts).
 */
export const NPC_MOVE_SPREAD_MS = 24 * 60 * 1000;
/** Chance, per tick, that a guard at a war front steps to a nearby tile. */
export const NPC_WANDER_PERCENT = 35;
/** Tiles a guard strays from its post at a front. */
export const NPC_WANDER_RADIUS = 2;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const NPC_OFF_DUTY_MIN_HOURS = 5;
export const NPC_OFF_DUTY_MAX_HOURS = 8;
/** An attacker flag with no duel behind it is dropped after this long (a player's own beat clears it within ~1 s). */
export const NPC_PENDING_ATTACKER_TTL_MS = 30_000;

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/**
 * Whether the NPC is logged off right now. Each day it is away for one stretch
 * of NPC_OFF_DUTY_MIN_HOURS-NPC_OFF_DUTY_MAX_HOURS starting at its own hour (a
 * stretch that starts late in the day runs past midnight), so about a quarter
 * of Cinderhold is offline at any hour, and never the same quarter.
 */
export function npcOffDuty(id: string, now: number): boolean {
    const day = Math.floor(now / DAY_MS);
    for (const d of [day, day - 1]) {
        const h = hash32(`${id}:off:${d}`);
        const start = d * DAY_MS + (h % 24) * HOUR_MS + ((h >>> 8) % 60) * 60_000;
        const span = NPC_OFF_DUTY_MAX_HOURS - NPC_OFF_DUTY_MIN_HOURS + 1;
        const length = (NPC_OFF_DUTY_MIN_HOURS + ((h >>> 16) % span)) * HOUR_MS;
        if (now >= start && now < start + length) return true;
    }
    return false;
}

/** Every NPC offline right now. */
export function npcsOffDuty(now: number, roster: readonly NpcShinobi[] = NPC_VILLAGE_ROSTER): Set<string> {
    return new Set(roster.filter((npc) => npcOffDuty(npc.id, now)).map((npc) => npc.id));
}

/** How far into each window this NPC waits before taking its new post. */
export function npcMoveDelayMs(id: string): number {
    return hash32(`${id}:move`) % (NPC_MOVE_SPREAD_MS + 1);
}

/**
 * This NPC's war duty now: its post for the current window once its own move
 * moment has come, the previous window's post until then (undefined: no duty,
 * it is on a journey).
 */
export function npcPostFor<P extends { sector: number; tile: number }>(id: string, now: number, current: ReadonlyMap<string, P>, previous: ReadonlyMap<string, P>): P | undefined {
    const late = now - Math.floor(now / NPC_POST_WINDOW_MS) * NPC_POST_WINDOW_MS < npcMoveDelayMs(id);
    return (late ? previous.get(id) : undefined) ?? current.get(id);
}

/** A walkable tile within NPC_WANDER_RADIUS of the post, or null if this tick the NPC stands still. */
export function npcWanderTile(id: string, sector: number, postTile: number, now: number): number | null {
    const h = hash32(`${id}:walk:${Math.floor(now / NPC_PRESENCE_TICK_MS)}`);
    if (h % 100 >= NPC_WANDER_PERCENT) return null;
    const span = NPC_WANDER_RADIUS * 2 + 1;
    const col = Math.max(0, Math.min(SECTOR_GRID_WIDTH - 1, (postTile % SECTOR_GRID_WIDTH) + ((h >>> 8) % span) - NPC_WANDER_RADIUS));
    const row = Math.max(0, Math.min(SECTOR_GRID_WIDTH - 1, Math.floor(postTile / SECTOR_GRID_WIDTH) + ((h >>> 12) % span) - NPC_WANDER_RADIUS));
    const tile = nearestWalkableTile(sector, row * SECTOR_GRID_WIDTH + col);
    // Never onto the spot a player stands on to gather.
    return isNodeApproachTile(sector, tile) ? null : tile;
}

/** War defenders sent to each sector Cinderhold is fighting a sector war over (Push 4). */
export const NPC_FRONT_SQUAD = 4;

export type NpcPost = { sector: number; tile: number; duty: 'front' | 'boss' };

/**
 * The war duty of each NPC in a 30-minute window (everyone else is out on a
 * journey, api/_npc-journeys.ts, and has no post here). Each war front first
 * gets a squad of NPC_FRONT_SQUAD war defenders (Commanders, Elites, Jonin;
 * rotating per window), so the sector being fought over has Cinderhold
 * shinobi in it to duel. `opts.warParticipants` (npcWarParticipants: the Genin
 * and Chunin at level 15 or more, owner ruling 2026-11-11) fill the fronts
 * after them, so the ANBU still lead and a front the ANBU cannot man is
 * filled. While a world boss stands on the roam ground (`bossSector`), up to
 * NPC_BOSS_WATCHERS others are sent to watch it (`duty: 'boss'`: a journey
 * with that purpose, presence only).
 */
export function npcPosts(now: number, roster: readonly NpcShinobi[] = NPC_VILLAGE_ROSTER, fronts: readonly number[] = [], wounded: ReadonlySet<string> = new Set(), opts: { bossSector?: number | null; warParticipants?: ReadonlySet<string> } = {}): Map<string, NpcPost> {
    const window = Math.floor(now / NPC_POST_WINDOW_MS);
    // A wounded guard is recovering (api/_npc-wounds.ts): it has no post, and a
    // reserve fills the front in its place while one is left.
    const order = [...roster].filter((npc) => !wounded.has(npc.id))
        .sort((a, b) => hash32(`${a.id}:${window}`) - hash32(`${b.id}:${window}`) || a.id.localeCompare(b.id));
    const posts = new Map<string, NpcPost>();
    const place = (npc: NpcShinobi, sector: number, duty: NpcPost['duty']) => posts.set(npc.id, { sector, duty, tile: npcStandTile(sector, nearestWalkableTile(sector, hash32(`${npc.id}:tile:${window}`) % 144)) });
    const extra = opts.warParticipants;
    const soldiers = [
        ...order.filter((npc) => isNpcWarDefenderRank(npc.rank)),
        ...(extra?.size ? order.filter((npc) => !isNpcWarDefenderRank(npc.rank) && extra.has(npc.id)) : []),
    ];
    let next = 0;
    for (const sector of fronts) {
        for (let i = 0; i < NPC_FRONT_SQUAD && next < soldiers.length; i++) place(soldiers[next++]!, sector, 'front');
    }
    const boss = opts.bossSector ?? null;
    if (boss !== null && isNpcRoamSector(boss) && !fronts.includes(boss)) {
        for (const npc of order.filter((n) => !posts.has(n.id)).slice(0, NPC_BOSS_WATCHERS)) place(npc, boss, 'boss');
    }
    return posts;
}

/** Stamps the NPC's public-index row (its profile and roster "last seen") with the moment it left the map. */
export async function noteNpcLastSeen(id: string, character: Record<string, unknown>, now: number): Promise<void> {
    await kv.hset(REGISTRY_KEY, { [id]: buildPublicPlayerIndexEntry(character, id, now, now) });
}

/** When each NPC's current attacker flag was first seen (cleared once it lapses or the duel starts). */
const attackerSeenAt = new Map<string, number>();

/**
 * Every NPC's war duty right now (and in the previous window, for the
 * staggered move), and who is off the map: the one source the tick and the rival-hunt
 * step (api/_npc-hunt.ts) both read, so a hunter the map sends to a war front
 * is a hunter the hunt sees as busy.
 */
export async function npcPresencePlan(now: number, fronts: readonly number[]) {
    const wounded = await woundedNpcIds(now).catch(() => new Set<string>());
    const offline = npcsOffDuty(now);
    // A roster id whose account is a PLAYER's (api/_npc-ownership.ts) is never
    // posted, hunted with or sent anywhere: it is not an NPC at all.
    const owned = await npcOwnedIds(now);
    const unowned = new Set(NPC_VILLAGE_ROSTER.filter((npc) => !owned.has(npc.id)).map((npc) => npc.id));
    // Off the map either way: a reserve fills a front in its place.
    const absent = new Set([...wounded, ...offline, ...unowned]);
    // Cached for a minute: one boss read per minute, not per tick.
    const bossSector = await npcWorldBossSector(now).catch(() => null);
    // Who may stand at a front: read (cached a minute) only while there is one.
    const warParticipants = fronts.length
        ? new Set((await npcWarParticipants(now).catch(() => [])).map((npc) => npc.id))
        : undefined;
    const posts = npcPosts(now, NPC_VILLAGE_ROSTER, fronts, absent, { bossSector, warParticipants });
    const previousPosts = npcPosts(now - NPC_POST_WINDOW_MS, NPC_VILLAGE_ROSTER, fronts, absent, { bossSector, warParticipants });
    return { absent, wounded, offline, unowned, bossSector, posts, previousPosts };
}

/**
 * The save fields the tick needs, read where the save lives: what the presence
 * row shows (slimPresenceCharacter) and what the public-index row on the way
 * out is built from (buildPublicPlayerIndexEntry). Never the whole save.
 */
export const NPC_PRESENCE_SAVE_PROJECTION: KvProjection = Object.freeze(Object.fromEntries(
    [...new Set([...PRESENCE_CHARACTER_FIELDS, ...PUBLIC_INDEX_CHARACTER_FIELDS])].map((field) => [field, ['character', field]]),
));

/** One tick: refresh every free NPC's presence; a controlled NPC shows only the admin's own beats. */
export async function refreshNpcPresence(now = Date.now()): Promise<number> {
    // Without session tokens the server cannot play an NPC's seat (the create
    // refuses), so an attackable NPC would only collect stuck attack flags.
    if (!playerSessionsEnabled()) return 0;
    const fronts = await npcWarFronts(now);
    const { absent, wounded, unowned, bossSector, posts, previousPosts } = await npcPresencePlan(now, fronts);
    // The walker's view of the world until the next tick: fronts to keep out
    // of, the boss's sector (only its watchers go there).
    setNpcJourneyWorld(fronts, bossSector);
    for (const id of unowned) dropNpcJourney(id);
    // Village-war orders (Push 4b, api/_npc-village-campaign.ts) override the
    // rota: a stronghold, the shrine, a strike or a field order.
    const campaign = await liveNpcCampaignPosts(now).catch((error) => {
        logPresenceFailure('campaign orders', error);
        return new Map<string, NpcCampaignAssignment>();
    });
    // Rival hunts (api/_npc-hunt.ts), in memory: where each hunter is heading.
    const hunts = npcHuntRegistry();
    // A player's account under an NPC id is skipped outright: never read, never
    // posted, and its own (the player's) presence row is never touched.
    const roster = NPC_VILLAGE_ROSTER.filter((npc) => !unowned.has(npc.id));
    // Combat evidence only for an NPC that can be on the map this tick: an
    // absent one (wounded, off duty) is not judged, only taken off the map.
    const judged = roster.filter((npc) => !absent.has(npc.id));
    const battleKeys = judged.map((npc) => battleAuthorityKeys(npc.id));
    const width = battleKeys[0]?.length ?? 0;
    const evidenceAt = new Map(judged.map((npc, i) => [npc.id, i]));
    // Two round trips side by side: the presence fields of every save (never a
    // whole save), and every possession row plus combat-evidence key.
    const [characters, values] = await Promise.all([
        readKvProjection(kv, roster.map((npc) => `save:${npc.id}`), NPC_PRESENCE_SAVE_PROJECTION),
        kv.mget<unknown[]>(...roster.map((npc) => npcPossessKey(npc.id)), ...battleKeys.flat()),
    ]);
    // The boot snapshot's unverified rows (api/_realtime/online-store.ts
    // restore), read once and only if some NPC has no live row this tick.
    let booted: Map<string, number> | null = null;
    const bootSectorOf = (name: string): number | undefined => {
        booted ??= new Map(onlineStore.list().filter((p) => p.locationUnverified && NPC_GROUND_SECTORS.has(p.sector)).map((p) => [p.name, p.sector]));
        return booted.get(safeName(name));
    };
    let shown = 0;
    for (const [index, npc] of roster.entries()) {
        const projected = characters[index];
        const save = projected && Object.keys(projected).length ? { character: projected } : null;
        const possession = values[index] as NpcPossession | null;
        const order = campaign.get(npc.id);
        const rota = npcPostFor(npc.id, now, posts, previousPosts);
        // Orders and war fronts always win, and hold the NPC where they send it.
        const atFront = !order && rota?.duty === 'front';
        const duty = order ? 'order' : atFront ? 'front' : null;
        // Anyone else is on a journey: its own, or an errand (a rival hunt, the world boss).
        const hunt = duty ? undefined : hunts.get(npc.id);
        const watch = !duty && !hunt && rota?.duty === 'boss' ? rota : undefined;
        if (possession && Number(possession.expiresAt) > now) {
            attackerSeenAt.delete(npc.id);
            // The admin walks it now: the walker stands down, and a gathering
            // pose would otherwise ride along on every beat (upsert keeps it
            // in-sector), and only this tick ever clears it.
            holdNpcJourney(npc.id, 'possessed');
            const held = onlineStore.get(npc.name);
            if (held?.activity) { onlineStore.setActivity(npc.name, undefined); queuePresenceUpdate(held.name, held.sector); }
            continue;
        }
        // Wounded and recovering, or logged off: off the map, unless it is
        // still finishing a fight (the row then goes next tick).
        if (absent.has(npc.id)) {
            const row = onlineStore.get(npc.name);
            if (row && !row.inBattle && row.pendingAttacker == null) {
                onlineStore.remove(npc.name);
                // Back from hospital it starts in Cinderhold; back from its
                // time off, where it logged off (as a player does).
                dropNpcJourney(npc.id, wounded.has(npc.id) ? 'home' : { sector: row.sector, tile: row.tile ?? 78 });
                // Its "last seen" is this moment, as a player's is when they
                // log off: one write on the way out, never per tick.
                if (save?.character) await noteNpcLastSeen(npc.id, save.character, now).catch((error) => logPresenceFailure(`last seen ${npc.id}`, error));
            } else if (row) holdNpcJourney(npc.id, 'leaving');
            else dropNpcJourney(npc.id, wounded.has(npc.id) ? 'home' : null);
            attackerSeenAt.delete(npc.id);
            continue;
        }
        if (!save?.character) continue;
        const at = evidenceAt.get(npc.id) ?? 0;
        const evidence = values.slice(roster.length + at * width, roster.length + (at + 1) * width);
        let inBattle: boolean | null = null;
        try {
            const battle = await resolveBattleAuthority(npc.id, battleEvidenceFrom(evidence), { now: () => now });
            inBattle = battle.inBattle;
        } catch (error) {
            // Storage hiccup: not evidence either way; the flag stays as it was.
            logPresenceFailure(`battle evidence ${npc.id}`, error);
        }

        let before = onlineStore.get(npc.name);
        const engaged = inBattle ?? before?.inBattle === true;
        if (before?.pendingAttacker != null && !engaged) {
            const seen = attackerSeenAt.get(npc.id) ?? now;
            attackerSeenAt.set(npc.id, seen);
            if (now - seen >= NPC_PENDING_ATTACKER_TTL_MS) { onlineStore.clearPendingAttacker(npc.name); attackerSeenAt.delete(npc.id); }
        } else attackerSeenAt.delete(npc.id);
        before = onlineStore.get(npc.name);
        // Mid-fight, or with an attacker queued, the NPC stays put; it moves
        // only between duels, so a world attack never loses its target.
        const pinned = !!before && (engaged || before.pendingAttacker != null);
        const character = slimPresenceCharacter(save.character);
        const modelAppearance = { serverPlayerModel: process.env.ENABLE_SECTOR_MODEL_DISPLAY === '1'
            ? cinderholdWorldModel(npc.id, npc.avatar) ?? null : null };
        if (duty) {
            // War duty: the walker stands down while the order or front holds it.
            holdNpcJourney(npc.id, duty);
            const post = order ? { sector: order.sector, tile: npcOrderTile(npc.id, order.sector, order.since) } : rota!;
            const sector = pinned ? before!.sector : post.sector;
            // On the road: the lease is still running; it lands on a later tick.
            if (before && !pinned && Number(before.travelingUntil) > onlineStore.clockNow()) {
                // Still its heartbeat on the road: a stale fight flag clears as it would at a post.
                if (inBattle === false && before.inBattle) onlineStore.setInBattle(npc.name, false);
                shown++;
                continue;
            }
            // The store never lets a live row change sector except by a matured
            // travel lease, so an order or a front is reached in one three-second
            // road trip, as it always was (the next tick's upsert settles it).
            // A row the store will not send travelling (mid-fight) leaves and reappears.
            if (before && !pinned && before.sector !== sector && before.travelDestinationSector !== sector) {
                const leaving = onlineStore.startTravel(npc.name, sector, onlineStore.clockNow() + npcTravelMs(), before.sector, post.tile);
                if (leaving) { queuePresenceUpdate(leaving.name, before.sector); shown++; continue; }
                onlineStore.remove(npc.name); before = null;
            }
            // Same sector: keep where it walked to (its wander, below), not the post tile.
            const sameSector = !!before && before.sector === sector && before.travelDestinationSector === undefined;
            const tile = pinned || (sameSector && before!.tile !== undefined) ? before!.tile : post.tile;
            const stored = onlineStore.upsert({ name: npc.name, sector, character, tile, tileSector: sector, ...modelAppearance });
            if (inBattle !== null && (inBattle || !battleStartedWithin(npc.name, now))) onlineStore.setInBattle(npc.name, inBattle);
            // A guard at a front walks about its post between fights. On a war
            // order it stands still: a step would end a shrine or stronghold lease.
            if (!pinned && !order && !onlineStore.get(npc.name)?.inBattle && !npcPinned(npc.id)) {
                const step = npcWanderTile(npc.id, sector, post.tile, now);
                // Told to the sector as any step is, or watchers saw it frozen and then jump.
                const moved = step !== null && step !== onlineStore.get(npc.name)?.tile ? onlineStore.moveToTile(npc.name, step) : null;
                if (moved && step !== null) announceNpcStep(moved, step);
            }
            onlineStore.setActivity(npc.name, undefined);
            const published = onlineStore.get(npc.name) ?? stored;
            if (!before || presenceBroadcastSignature(before) !== presenceBroadcastSignature(published)) queuePresenceUpdate(published.name, published.sector);
            shown++;
            continue;
        }
        // On a journey. A row an admin's client left a world cursor on (after a
        // takeover) would refuse every server step, so it is put back as a
        // plain row where it stands.
        let resumeAt: { sector: number; tile: number } | null = null;
        if (before?.worldPosition && !pinned && !(Number(before.travelingUntil) > onlineStore.clockNow())) {
            resumeAt = { sector: before.sector, tile: before.tile ?? 78 };
            onlineStore.remove(npc.name);
            before = null;
        }
        // Just after a restart its row is the boot snapshot's (sector only,
        // hidden until verified): it carries on from that sector.
        if (!before && !resumeAt) {
            const booted = bootSectorOf(npc.name);
            if (booted !== undefined) resumeAt = { sector: booted, tile: npcStandTile(booted, nearestWalkableTile(booted, hash32(`${npc.id}:boot`) % 144)) };
        }
        const where = ensureNpcJourney(npc, now, before ?? resumeAt);
        releaseNpcJourney(npc.id, now);
        setNpcJourneyErrand(npc.id, hunt
            ? { purpose: 'hunt', sector: hunt.sector, tile: npcStandTile(hunt.sector, npcOrderTile(npc.id, hunt.sector, hunt.since)) }
            : watch ? { purpose: 'boss', sector: watch.sector, tile: watch.tile } : null);
        // The walker moves it (api/_npc-journeys.ts); this beat only keeps its
        // row fresh where it is, as a player's heartbeat does.
        if (before && !pinned && Number(before.travelingUntil) > onlineStore.clockNow()) {
            if (inBattle === false && before.inBattle) onlineStore.setInBattle(npc.name, false);
            shown++;
            continue;
        }
        const sector = before ? before.sector : where.sector;
        const tile = before?.tile ?? where.tile;
        const stored = onlineStore.upsert({ name: npc.name, sector, character, tile, tileSector: sector, ...modelAppearance });
        if (inBattle !== null && (inBattle || !battleStartedWithin(npc.name, now))) onlineStore.setInBattle(npc.name, inBattle);
        syncNpcJourneyActivity(npc.id);
        const published = onlineStore.get(npc.name) ?? stored;
        if (!before || presenceBroadcastSignature(before) !== presenceBroadcastSignature(published)) queuePresenceUpdate(published.name, published.sector);
        shown++;
    }
    return shown;
}

/** A failed step of the tick, said once per kind per minute (the tick runs every 20 s). */
const lastLogged = new Map<string, number>();
function logPresenceFailure(scope: string, error: unknown): void {
    const now = Date.now();
    const kind = scope.split(' ')[0]!;
    if (now - (lastLogged.get(kind) ?? -Infinity) < 60_000) return;
    lastLogged.set(kind, now);
    console.error(`[npc-presence] ${scope} failed:`, (error as Error)?.message ?? error);
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
/** One guarded tick: a slow tick is never stacked on (two would race the same rows), and a failure is logged. */
export async function runNpcPresenceTick(now = Date.now()): Promise<number | null> {
    if (ticking) return null;
    ticking = true;
    try { return await refreshNpcPresence(now); }
    catch (error) { logPresenceFailure('tick', error); return null; }
    finally { ticking = false; }
}
/**
 * One step of the journey walker (api/_npc-journeys.ts), every
 * NPC_WALK_TICK_MS: synchronous, in memory, no storage. The kill switch and a
 * server with no session tokens stop it, as they stop the tick (and an NPC it
 * already placed is left where it stands).
 */
export function runNpcWalkerStep(now = Date.now()): ReturnType<typeof stepNpcJourneys> | null {
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) return null;
    try { return stepNpcJourneys(now); }
    catch (error) { logPresenceFailure('walker', error); return null; }
}

let walker: ReturnType<typeof setInterval> | null = null;
/** Starts the presence tick and the journey walker (idempotent). DISABLE_NPC_VILLAGE=1 keeps Cinderhold empty. */
export function startNpcPresence(): void {
    if (timer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    void runNpcPresenceTick();
    timer = setInterval(() => { void runNpcPresenceTick(); }, NPC_PRESENCE_TICK_MS);
    timer.unref?.();
    walker = setInterval(() => { runNpcWalkerStep(); }, NPC_WALK_TICK_MS);
    walker.unref?.();
}
export function stopNpcPresence(): void {
    if (timer) clearInterval(timer);
    if (walker) clearInterval(walker);
    timer = walker = null;
}

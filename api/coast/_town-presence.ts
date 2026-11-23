/*
 * Being inside a clan's town on the Unmapped Coast.
 *
 * Owner ruling, 2026-11-21: a clan that holds a coast sector has a town there
 * for its members, and inside it they are in a safe zone, like a village. A
 * village is sector 0. A town is inside a field sector, so "inside" has to be
 * something the server issues and can take back. It is the same thing a war
 * shrine uses: a server-issued interior location (api/_stronghold-presence.ts),
 * in a room marked as a safe one. While a member is in that room nobody can
 * attack them and they can attack nobody (presence-gating.ts), and if they log
 * off there they leave no sleeper camp (sleeper-camps.ts).
 *
 * What keeps it honest:
 *   - Only the server lets a player in: a member of the clan that holds the
 *     sector, standing in that sector, with a town standing (an active Landing
 *     above the staked plot), and not in a fight or about to be in one.
 *   - It lasts only while they stay put. The interior is leased to the
 *     player's movement count and field epoch, so a step in the sector, a
 *     journey, or a fight ends it at once, with no message from the client.
 *   - Each heartbeat renews it (both heartbeat paths call refreshCoastTownVisit),
 *     and every 30 seconds that renewal reads the claim and the Landing again.
 *     A town that falls or goes dormant, or a member who leaves the clan, is
 *     out within one beat of that check.
 *   - Working the field ends it. Presence says "in the sector", so without
 *     this a member could explore, gather and fight patrols while nobody could
 *     touch them: the very hole api/_sector-presence-gate.ts was written to
 *     close. That gate, gathering and world fights all walk the member out.
 *   - It ends with the connection it was made on. A logout inside leaves no
 *     sleeper camp, and the member logs back in on the open sector.
 *
 * A fight a member starts from a town facility (a mission, a spar) takes them
 * out of the room for as long as it runs: a fighter is not attackable anyway.
 * The first beat after it puts them back, because they have not moved.
 *
 * In memory and single-process, like the online store and the interiors it
 * stands on. A restart forgets who was inside; their next "enter" puts them back.
 */
import { kv } from '../_storage.js';
import { clanBareSlug, clanRecordKey, safeName } from '../_utils.js';
import { OFFLINE_AFTER_MS, onlineStore } from '../_realtime/online-store.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import { SAFE_ROOM_PREFIX, leaveStrongholdPresence, strongholdLocation, touchStrongholdPresence } from '../_stronghold-presence.js';
import { liveCoastClaimAt } from './_land.js';
import { coastTownFacilities } from './_landing-rules.js';
import { readCoastLanding } from './_landing-store.js';

type Refusal = { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });

/** How often a renewal reads the claim and the Landing again. */
export const COAST_TOWN_RECHECK_MS = 30_000;

/**
 * `connectedAt` is the presence record the visit was made on. A record that goes stale and is made again (a logout
 * and a login) starts its movement count over, so the count alone could match by accident and put a returning
 * player back inside a town they never walked into this time.
 */
type Visit = { sector: number; room: string; movementSequence: number; connectedAt: number; tile: number; checkedAt: number };
const visits = new Map<string, Visit>();

type Town = { ok: true; sector: number; room: string; town: string[] };

/**
 * The town this saved player may enter in `sector` right now, read from their save, their clan, that sector's
 * claim and the Landing. Four single-key reads: this runs on the heartbeat of every member inside a town, so it
 * asks for the one claim it needs and never lists the coast's claims.
 */
async function townOf(player: string, sector: number): Promise<Town | Refusal> {
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const clan = String(((save?.character ?? {}) as Record<string, unknown>).clan ?? '').trim();
    const record = clan ? await kv.get<Record<string, unknown>>(clanRecordKey(clan)) : null;
    const members = Array.isArray(record?.members) ? record.members as Array<Record<string, unknown>> : [];
    if (!record || !members.some(member => safeName(String(member?.name ?? '')) === player)) {
        return refuse(403, 'A clan town is for the members of the clan that holds the ground.');
    }
    const claim = await liveCoastClaimAt(sector);
    if (!claim || claim.clanSlug !== clanBareSlug(clan)) return refuse(409, 'Stand in the sector your clan holds to enter its town.');
    const landing = await readCoastLanding(claim.clanSlug);
    const standing = landing && landing.sector === claim.sector && landing.landingEpoch === claim.landingEpoch ? landing : null;
    const town = coastTownFacilities(standing);
    if (!town.length) {
        return refuse(409, standing?.status === 'dormant'
            ? 'The Landing is dormant, and its town is shut. Stock its stores so it can pay its upkeep.'
            : 'Your clan has no town standing yet. Raise the Landing past its staked plot first.');
    }
    return { ok: true, sector: claim.sector, room: `${SAFE_ROOM_PREFIX}${claim.clanSlug}:${claim.landingEpoch}`, town };
}

/** Whether this presence record is a player who could be standing in a town in `sector` right now. */
function standsIn(present: OnlinePlayer | null | undefined, sector: number, now: number): present is OnlinePlayer {
    return !!present && !present.locationUnverified && present.sector === sector && !((present.travelingUntil ?? 0) > now);
}

function admit(player: string, present: OnlinePlayer, town: Town, now: number): void {
    const tile = Number.isInteger(present.tile) ? present.tile as number : 0;
    visits.set(player, { sector: town.sector, room: town.room, movementSequence: present.movementSeq ?? 0, connectedAt: present.connectedAt, tile, checkedAt: now });
    touchStrongholdPresence(player, town.sector, tile, now, town.room, { ttlMs: OFFLINE_AFTER_MS, closesAt: now + OFFLINE_AFTER_MS });
}

/**
 * Walk into the clan's town. The caller is the signed-in player. Safe to call again: a member already inside
 * is simply renewed, which is what the town screen does each time it opens.
 */
export async function enterCoastTown(playerName: string, now = Date.now()): Promise<{ ok: true; sector: number; town: string[] } | Refusal> {
    const player = safeName(playerName);
    const arriving = onlineStore.get(player);
    if (!arriving || arriving.locationUnverified) return refuse(409, 'Your world presence is not ready.');
    const town = await townOf(player, arriving.sector);
    if (!town.ok) return town;
    // Presence is read again after the storage reads above, so nothing that changed while they ran is missed.
    const present = onlineStore.get(player);
    if (!present || present.locationUnverified) return refuse(409, 'Your world presence is not ready.');
    if (!standsIn(present, town.sector, now)) return refuse(409, 'Stand in the sector your clan holds to enter its town.');
    // A town is not a way out of a fight: not one under way, and not one another player has just started.
    if (present.inBattle || present.pendingAttacker) return refuse(409, 'Finish your fight before entering the town.');
    const interior = strongholdLocation(player, town.sector, now);
    if (interior && interior.room !== town.room) return refuse(409, 'Leave where you are before entering the town.');
    admit(player, present, town, now);
    return { ok: true, sector: town.sector, town: town.town };
}

/** Walk back out onto the sector. Safe to call when not inside. */
export function leaveCoastTown(playerName: string): void {
    const player = safeName(playerName), visit = visits.get(player);
    if (!visit) return;
    visits.delete(player);
    if (strongholdLocation(player, visit.sector)?.room === visit.room) leaveStrongholdPresence(player);
}

/**
 * Heartbeat path. Does nothing, and reads nothing, for a player who is not in a town. For one who is: they are
 * out if they have moved, travelled or changed sector; otherwise the room is renewed, and every
 * COAST_TOWN_RECHECK_MS the town itself is read again.
 */
export async function refreshCoastTownVisit(playerName: string, now = Date.now()): Promise<void> {
    const player = safeName(playerName), visit = visits.get(player);
    if (!visit) return;
    const still = (present: OnlinePlayer | null | undefined): present is OnlinePlayer =>
        standsIn(present, visit.sector, now) && (present.movementSeq ?? 0) === visit.movementSequence && present.connectedAt === visit.connectedAt;
    if (!still(onlineStore.get(player))) return leaveCoastTown(player);
    if (now - visit.checkedAt >= COAST_TOWN_RECHECK_MS) {
        const town = await townOf(player, visit.sector).catch(() => null);
        // A read that failed is not proof the town is gone: keep the visit and look again on the next beat.
        if (town && (!town.ok || town.sector !== visit.sector || town.room !== visit.room)) return leaveCoastTown(player);
        if (town) visit.checkedAt = now;
        if (visits.get(player) !== visit) return;
    }
    const present = onlineStore.get(player);
    if (!still(present)) return leaveCoastTown(player);
    // Mid-fight the room stays lapsed (see the header); the beat after the fight renews it.
    if (present.inBattle) return;
    touchStrongholdPresence(player, visit.sector, visit.tile, now, visit.room, { ttlMs: OFFLINE_AFTER_MS, closesAt: now + OFFLINE_AFTER_MS });
}

/**
 * For the sweep that turns a departed player into a sleeper camp, called once as they go. True when they were
 * inside a town at that moment: same sector, same connection, and not a step taken since they entered. They leave
 * no camp, as a logout in a village leaves none. Either way their visit is over when this returns.
 */
export function endCoastTownVisitAtLogout(player: Pick<OnlinePlayer, 'name' | 'sector' | 'movementSeq' | 'connectedAt'>): boolean {
    const slug = safeName(player.name), visit = visits.get(slug);
    if (!visit) return false;
    // The visit ends with the connection it was made on. They log back in on the open sector.
    visits.delete(slug);
    return visit.sector === player.sector && visit.movementSequence === (player.movementSeq ?? 0) && visit.connectedAt === player.connectedAt;
}

/** Whether the server holds this player as inside a town right now. For the status reply and for tests. */
export function inCoastTown(playerName: string, now = Date.now()): boolean {
    const player = safeName(playerName), visit = visits.get(player);
    return !!visit && strongholdLocation(player, visit.sector, now)?.room === visit.room;
}

/** Test-only: forget every visit. */
export function __resetCoastTownVisitsForTest(): void {
    for (const player of [...visits.keys()]) leaveCoastTown(player);
}

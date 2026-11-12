/**
 * Rival hunts (owner ruling 2026-11-10, LIMITED): a Cinderhold shinobi a player
 * beat may come looking for them.
 *
 *   - Only a rival who beat this NPC within NPC_HUNT_RIVAL_DAYS (its fight
 *     record, api/_npc-duel.ts), within NPC_HUNT_LEVEL_WINDOW levels of it.
 *   - At most ONCE per player per UTC day, by any NPC (the day key is set when
 *     the strike is opened), and never while the shared 15-minute merc target
 *     cooldown covers them.
 *   - Never in the player's own village's home block (npcHuntSectorAllowed),
 *     nor anywhere off the NPC's roam ground (api/_npc-roam.ts: every walkable
 *     sector, outskirts gates and the castle city included, but no festival,
 *     Death's Gate or safe zone), nor at a war front.
 *   - Never while the player is protected: the strike is the ordinary world
 *     attack (api/_npc-war-strike.ts openNpcWorldDuel), so every protection in
 *     api/player/attack.ts applies (newcomer floor, hospital, Field Recovery
 *     shield, travel, an existing fight, world-boss protection, co-location).
 *     The pick also skips the ones it can see from the save first, so a
 *     protected player is not walked to at all.
 *   - The hunter walks the roads there (a journey with the purpose "hunt":
 *     the presence tick points it at the rival's sector and the journey walker,
 *     api/_npc-journeys.ts, walks it there at a player's pace) and strikes only
 *     once it stands in the player's sector. A player
 *     who moves on is followed once more; after NPC_HUNT_LAPSE_MS the hunt lapses.
 *   - One hunt per NPC, at most NPC_HUNT_MAX_ACTIVE server-wide, never for an
 *     NPC that is off duty, wounded, under admin control, mid-fight, at a war
 *     front or under a village-war or clan-war order. DISABLE_NPC_VILLAGE=1
 *     stops it.
 * The duel is an ordinary NPC world duel: it pays the player under the NPC
 * daily pay rule (api/_npc-duel.ts sealNpcDuel), and an NPC that loses is
 * wounded off the map like any other.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { playerSessionsEnabled } from './_auth.js';
import { onlineStore } from './_realtime/online-store.js';
import { isIncapacitated } from './_elapsed-state.js';
import { HOME_SECTORS, type WarVillage } from './_war-map-sectors.js';
import { npcDuelRecordKey, type NpcDuelRecord } from './_npc-duel.js';
import { mercTargetsOnCooldown, setMercTargetCooldown } from './_merc-roam.js';
import { npcStandsIn, openNpcWorldDuel, type NpcWarDuel } from './_npc-war-strike.js';
import { npcPostFor, npcPresencePlan } from './_npc-presence.js';
import { npcWarFronts } from './_npc-village-war.js';
import { liveNpcCampaignPosts, npcsHeldByClanWars } from './_npc-campaign-assignments.js';
import { isNpcRoamSector, npcHuntRegistry, type NpcHunt } from './_npc-roam.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount, type NpcShinobi } from '../shared/npc-village-roster.js';
import { CINDERHOLD_SECTORS } from '../shared/sector-geo.js';
import { ATTACKABLE_MIN_LEVEL } from './_realtime/presence-gating.js';

export const NPC_HUNT_STEP_MS = 20_000;
/** New hunts are picked at most this often. */
export const NPC_HUNT_PICK_MS = 2 * 60_000;
export const NPC_HUNT_LAPSE_MS = 10 * 60_000;
export const NPC_HUNT_MAX_ACTIVE = 4;
export const NPC_HUNT_LEVEL_WINDOW = 10;
export const NPC_HUNT_RIVAL_DAYS = 7;
/** Times a hunt follows a rival who moved on before it lapses. */
export const NPC_HUNT_FOLLOWS = 1;
/**
 * A player the attack refused (protected: shield, hospital, newcomer floor...)
 * is not hunted again, by ANY NPC, for this long. Stored, so a restart or a
 * second hunter does not walk to the same protected player again.
 */
export const NPC_HUNT_REFUSED_MS = 60 * 60_000;

const DAY_MS = 86_400_000;
export const NPC_HUNTS_KEY = 'npc-village:hunts';
const utcDay = (now: number) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
/** Set when a hunt's strike is opened: that player is not hunted again that UTC day. */
export const npcHuntedKey = (player: string, now: number) => `npc-village:hunted:${utcDay(now)}:${safeName(player)}`;
/** Set when a strike on this player was refused: { until }, honoured by every pick until then. */
export const npcHuntRefusedKey = (player: string) => `npc-village:hunt-refused:${safeName(player)}`;

export type NpcHuntDeps = {
    now?: number;
    /** The real world attack (default openNpcWorldDuel). */
    strike?: (npc: NpcShinobi, target: string, sector: number) => Promise<NpcWarDuel>;
    /** The full "free to fight" check (default: wound, engaged, possession, duty). */
    npcFree?: (id: string, now: number) => Promise<boolean>;
    /** Pick new hunts this step even if the last pick was under NPC_HUNT_PICK_MS ago. */
    forcePick?: boolean;
};
export type NpcHuntReport = {
    picked: Array<{ npc: string; target: string; sector: number }>;
    followed: Array<{ npc: string; target: string; sector: number }>;
    struck: Array<{ npc: string; target: string; sector: number; ok: boolean; battleId?: string; reason?: string }>;
    lapsed: Array<{ npc: string; target: string; reason: string }>;
};

let loaded = false;
let lastPickAt = -Infinity;
export function resetNpcHuntsForTest(): void { npcHuntRegistry().clear(); loaded = false; lastPickAt = -Infinity; }

/** Stores the registry; false if the write failed (the caller tries again at the end of the step). */
async function persist(): Promise<boolean> {
    return kv.set(NPC_HUNTS_KEY, { hunts: Object.fromEntries(npcHuntRegistry()) }, { ex: 86_400 }).then(() => true, () => false);
}

async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const row = await kv.get<{ hunts?: Record<string, NpcHunt> }>(NPC_HUNTS_KEY).catch(() => null);
    for (const [id, hunt] of Object.entries(row?.hunts ?? {})) {
        if (hunt && typeof hunt.target === 'string' && Number.isInteger(hunt.sector)) npcHuntRegistry().set(id, hunt);
    }
}

/** A sector a hunt may strike in: on the NPC's ground, off every war front and off the rival's own home block. */
export function npcHuntSectorAllowed(sector: number, homes: readonly number[], fronts: readonly number[]): boolean {
    return (isNpcRoamSector(sector) || CINDERHOLD_SECTORS.includes(sector)) && !homes.includes(sector) && !fronts.includes(sector);
}

/** When this rival last beat the NPC (older rows: their last fight, if they ever won one). */
function beatAt(rival: { losses?: number; last?: number; beatAt?: number }): number {
    return Number(rival.beatAt) || (Number(rival.losses) > 0 ? Number(rival.last) || 0 : 0);
}

async function defaultNpcFree(id: string, now: number): Promise<boolean> {
    const { npcCampaignFighterFree } = await import('./_npc-village-campaign.js');
    return npcCampaignFighterFree(id, { now });
}

/** One step of every rival hunt. Never throws. */
export async function runNpcHunts(deps: NpcHuntDeps = {}): Promise<NpcHuntReport> {
    const report: NpcHuntReport = { picked: [], followed: [], struck: [], lapsed: [] };
    const hunts = npcHuntRegistry();
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) {
        if (hunts.size) { hunts.clear(); await persist(); }
        return report;
    }
    const now = deps.now ?? Date.now();
    const strike = deps.strike ?? openNpcWorldDuel;
    const npcFree = deps.npcFree ?? defaultNpcFree;
    await load();
    const pickDue = deps.forcePick || now - lastPickAt >= NPC_HUNT_PICK_MS;
    if (!hunts.size && !pickDue) return report;

    let changed = false;
    const fronts = await npcWarFronts(now).catch(() => [] as number[]);
    const orders = await liveNpcCampaignPosts(now).catch(() => new Map());
    const clanHeld = await npcsHeldByClanWars(now).catch(() => new Set<string>());
    // The presence tick's own plan (wounded and off-duty NPCs off the map, boss
    // watchers placed), so a hunter the map posts to a war front is busy here too.
    const { absent, posts, previousPosts: previous } = await npcPresencePlan(now, fronts);
    /** Cheap: off the map, ordered, or holding a war front (orders and fronts always win). */
    const unavailable = (id: string) => absent.has(id) || orders.has(id) || clanHeld.has(id)
        || fronts.includes(npcPostFor(id, now, posts, previous)?.sector ?? -1);
    const byId = new Map(NPC_VILLAGE_ROSTER.map((npc) => [npc.id, npc]));
    const drop = (hunt: NpcHunt, reason: string) => {
        hunts.delete(hunt.npc); changed = true;
        report.lapsed.push({ npc: hunt.npc, target: hunt.target, reason });
    };

    // 1. Hunts under way: follow, strike or lapse.
    for (const hunt of [...hunts.values()]) {
        const npc = byId.get(hunt.npc);
        if (!npc) { drop(hunt, 'unknown'); continue; }
        if (now >= hunt.until) { drop(hunt, 'lapsed'); continue; }
        if (unavailable(npc.id)) { drop(hunt, 'busy'); continue; }
        const target = onlineStore.get(hunt.target);
        if (!target || target.sector < 1) { drop(hunt, 'gone'); continue; }
        if (Number(target.travelingUntil) > onlineStore.clockNow()) continue; // see where they land
        if (target.sector !== hunt.sector) {
            if (hunt.follows >= NPC_HUNT_FOLLOWS || !npcHuntSectorAllowed(target.sector, hunt.homes, fronts)) { drop(hunt, 'moved-away'); continue; }
            hunt.sector = target.sector; hunt.follows++; changed = true;
            report.followed.push({ npc: npc.id, target: hunt.target, sector: hunt.sector });
            continue;
        }
        // Struck only where both stand: never from another sector, never on the road.
        if (!npcStandsIn(npc, hunt.sector) || target.inBattle || target.pendingAttacker != null) continue;
        if (!(await npcFree(npc.id, now).catch(() => false))) { drop(hunt, 'busy'); continue; }
        // Before the strike, two things are stored, so neither a later write
        // failing nor a crash mid-strike can let this player be struck twice in
        // a day: the hunt's end, and the player's day key (claimed now, kept on a
        // strike, released on a refusal). If either cannot be written, no strike.
        hunts.delete(npc.id);
        if (!(await persist())) { changed = true; continue; }
        const dayKey = npcHuntedKey(hunt.target, now);
        const claimed = await kv.set(dayKey, 'striking', { ex: 2 * 86_400 }).then(() => true)
            .catch((err) => { console.error('[npc-hunt] day key not written, no strike:', (err as Error)?.message ?? err); return false; });
        if (!claimed) continue;
        const result = await strike(npc, hunt.target, hunt.sector).catch((err) => ({ ok: false as const, step: 'session' as const, reason: String((err as Error)?.message ?? err) }));
        if (result.ok) {
            await kv.set(dayKey, result.battleId, { ex: 2 * 86_400 })
                .catch((err) => console.error('[npc-hunt] day key not updated:', (err as Error)?.message ?? err));
            await setMercTargetCooldown(hunt.target, now).catch(() => undefined);
            report.struck.push({ npc: npc.id, target: hunt.target, sector: hunt.sector, ok: true, battleId: result.battleId });
        } else {
            // No fight: the player is huntable again today.
            await kv.del(dayKey).catch(() => undefined);
            // Only a refused ATTACK (the player's own protection: shield,
            // hospital, newcomer, world-boss protection) keeps every hunter off
            // them for the hour. A failure on the NPC's side (a duel that could
            // not open, storage) is not the player's, so it marks nothing.
            if (result.step === 'attack') {
                await kv.set(npcHuntRefusedKey(hunt.target), { until: now + NPC_HUNT_REFUSED_MS, by: npc.id }, { ex: Math.ceil(NPC_HUNT_REFUSED_MS / 1000) })
                    .catch(() => undefined);
            }
            report.struck.push({ npc: npc.id, target: hunt.target, sector: hunt.sector, ok: false, reason: result.reason });
        }
    }

    // 2. New hunts, every NPC_HUNT_PICK_MS.
    if (pickDue && hunts.size < NPC_HUNT_MAX_ACTIVE) {
        lastPickAt = now;
        try { changed = (await pickHunts(now, fronts, unavailable, npcFree, report)) || changed; }
        catch (err) { console.error('[npc-hunt] pick skipped:', (err as Error)?.message ?? err); }
    }
    if (changed) await persist();
    return report;
}

async function pickHunts(now: number, fronts: readonly number[], unavailable: (id: string) => boolean,
    npcFree: (id: string, now: number) => Promise<boolean>, report: NpcHuntReport): Promise<boolean> {
    const hunts = npcHuntRegistry();
    const roster = NPC_VILLAGE_ROSTER.filter((npc) => !hunts.has(npc.id) && !unavailable(npc.id) && !!onlineStore.get(npc.name));
    if (!roster.length) return false;
    // One read for every hunter's record (30 small rows, once per pick).
    const records = await kv.mget<Array<NpcDuelRecord | null>>(...roster.map((npc) => npcDuelRecordKey(npc.id)));
    const since = now - NPC_HUNT_RIVAL_DAYS * DAY_MS;
    const rivalsOf = new Map<string, string[]>();
    const wanted = new Set<string>();
    roster.forEach((npc, i) => {
        const rivals = Object.entries(records[i]?.rivals ?? {})
            .filter(([slug, rival]) => !isNpcAccount(slug) && beatAt(rival) >= since)
            .sort((a, b) => beatAt(b[1]) - beatAt(a[1]) || a[0].localeCompare(b[0]))
            .map(([slug]) => slug)
            .filter((slug) => { const row = onlineStore.get(slug); return !!row && row.sector >= 1; });
        if (!rivals.length) return;
        rivalsOf.set(npc.id, rivals);
        rivals.forEach((slug) => wanted.add(slug));
    });
    if (!wanted.size) return false;
    const slugs = [...wanted];
    const [saves, hunted, refused, npcSaves, cooling] = await Promise.all([
        kv.mget<Array<{ character?: Record<string, unknown> } | null>>(...slugs.map((slug) => `save:${slug}`)),
        kv.mget<unknown[]>(...slugs.map((slug) => npcHuntedKey(slug, now))),
        kv.mget<Array<{ until?: number } | null>>(...slugs.map((slug) => npcHuntRefusedKey(slug))),
        kv.mget<Array<{ character?: Record<string, unknown> } | null>>(...roster.map((npc) => `save:${npc.id}`)),
        mercTargetsOnCooldown(slugs, now),
    ]);
    const info = new Map(slugs.map((slug, i) => [slug, {
        character: saves[i]?.character,
        // Hunted today, or refused as protected within the hour: left alone.
        hunted: hunted[i] != null || Number(refused[i]?.until ?? 0) > now,
    }]));
    const npcLevel = new Map(roster.map((npc, i) => [npc.id, Math.floor(Number(npcSaves[i]?.character?.level ?? 0)) || 0]));
    const targeted = new Set([...hunts.values()].map((hunt) => hunt.target));
    let changed = false;
    for (const npc of roster) {
        if (hunts.size >= NPC_HUNT_MAX_ACTIVE) break;
        const level = npcLevel.get(npc.id) ?? 0;
        for (const slug of rivalsOf.get(npc.id) ?? []) {
            if (targeted.has(slug) || cooling.has(slug)) continue;
            const seen = info.get(slug);
            const ch = seen?.character;
            if (!ch || seen.hunted) continue;
            const row = onlineStore.get(slug);
            if (!row || Number(row.travelingUntil) > onlineStore.clockNow() || row.inBattle) continue;
            const theirLevel = Math.floor(Number(ch.level ?? 0)) || 0;
            if (theirLevel < ATTACKABLE_MIN_LEVEL || !level || Math.abs(theirLevel - level) > NPC_HUNT_LEVEL_WINDOW) continue;
            if (isIncapacitated(ch, now) || Math.floor(Number(ch.pvpShieldUntil ?? 0)) > now) continue;
            const homes = [...(HOME_SECTORS[String(ch.village ?? '').trim() as WarVillage] ?? [])];
            if (!npcHuntSectorAllowed(row.sector, homes, fronts)) continue;
            if (!(await npcFree(npc.id, now).catch(() => false))) break;
            const hunt: NpcHunt = { npc: npc.id, target: slug, sector: row.sector, since: now, follows: 0, until: now + NPC_HUNT_LAPSE_MS, homes };
            hunts.set(npc.id, hunt);
            targeted.add(slug);
            changed = true;
            report.picked.push({ npc: npc.id, target: slug, sector: row.sector });
            break;
        }
    }
    return changed;
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
/** Starts the hunt step (idempotent). DISABLE_NPC_VILLAGE=1 keeps it off. */
export function startNpcHunts(): void {
    if (timer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    timer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void runNpcHunts().catch(() => undefined).finally(() => { ticking = false; });
    }, NPC_HUNT_STEP_MS);
    timer.unref?.();
}
export function stopNpcHunts(): void { if (timer) clearInterval(timer); timer = null; }

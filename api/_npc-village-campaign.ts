/**
 * Cinderhold in a five-day VILLAGE WAR (Push 4b, owner rulings 2026-11-10).
 *
 * Cinderhold has no players, so in a village war it "plays like players" here,
 * through the players' own routes called in-process as each NPC (the duel
 * driver's asNpc token pattern) and under the same caps players have:
 *
 *   - strongholds: up to NPC_STRONGHOLD_SQUAD free war NPCs are posted to each
 *     of Cinderhold's three campaign strongholds and queue to defend it with
 *     the real `defend` action, so the attack route's chooseDefense finds them
 *     as it finds queued players. A combat defense is a real PvP duel with the
 *     NPC seated (the driver plays it); pet and card defenses resolve on the
 *     server. A defense it wins scores for Cinderhold as a player's would; a
 *     beaten defender is wounded off the map (api/_npc-wounds.ts).
 *   - shrine: during each open window up to NPC_SHRINE_SQUAD free NPCs walk to
 *     the shrine sector, enter it (`shrine-enter`) and keep their lease
 *     (`shrine-state`, every NPC_SHRINE_TICK_MS), so they earn control time and
 *     are the shrineOpponent a player attacking in the shrine meets.
 *   - strikes: once per war-party window it picks an online enemy player in a
 *     wild sector (lowest HP first, the shared 15-minute merc-target
 *     cooldown), sends a free war NPC there on the ordinary travel lease, and
 *     attacks on a LATER tick only if both still stand there. The duel scores
 *     the campaign through the world-PvP settlement every duel takes.
 *   - field orders: once per window a free war NPC takes a supply, sabotage or
 *     espionage order under its own personal daily allowance, travels to the
 *     order's sector, stays there for a walk-and-fight length of time and
 *     completes it, unless it is beaten (or logs off) first.
 *   - raids (owner ruling 2026-11-10, "they should raid player strongholds"):
 *     once per war-party window a free war NPC is ordered against one of the
 *     enemy village's campaign strongholds Cinderhold's own intel has
 *     discovered (still open, under its bout limit). It travels there, enters
 *     the stronghold with the real `enter` action, and on a later tick, still
 *     there and free, starts the assault with the real `start` action, so it
 *     meets whoever a player attacker would: a queued defender (a real PvP
 *     duel the defender is told about, a server pet duel, or a Chronicle duel
 *     the card seat plays, api/_npc-campaign-card-seat.ts) or the village's AI
 *     copy (scored as PvE support under the NPC's own daily allowance). It
 *     stays posted there until the battle is over; beaten, it is wounded.
 *   - peace: it answers a player village's standing offer of peace on every
 *     tick (api/world-state.ts reconsiderNpcVillagePeace). It never offers
 *     peace or surrenders itself.
 *
 * NPCs are never paid: every action here scores the campaign only, and the
 * war's payout routes refuse NPC accounts (api/_npc-guard.ts).
 * DISABLE_NPC_VILLAGE=1 stops all of it; a running war simply gets no NPC
 * activity.
 */
import { kv } from './_storage.js';
import { readKvProjection, type KvProjection } from './_storage-projection.js';
import { safeName } from './_utils.js';
import { playerSessionsEnabled } from './_auth.js';
import { onlineStore } from './_realtime/online-store.js';
import { queuePresenceUpdate } from './_realtime/presence-broadcast.js';
import { isNpcPossessed } from './_npc-possession.js';
import { npcOwnsSlug } from './_npc-ownership.js';
import { npcEngaged } from './_npc-duel.js';
import { readNpcWound, woundShieldUntil } from './_npc-wounds.js';
import { npcOffDuty, npcTravelMs } from './_npc-presence.js';
import { holdNpcJourney } from './_npc-journeys.js';
import { isNpcWarDefenderRank, npcWarParticipants } from './_npc-war-roster.js';
import { NPC_VILLAGE } from '../shared/npc-village.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount, type NpcShinobi } from '../shared/npc-village-roster.js';
import { MAX_WILD_SECTOR } from '../shared/sector-geo.js';
import { campaignWarPlayable, type CampaignWarRow } from './_village-war-campaign.js';
import {
    WAR_OPERATIONS, WAR_OPERATION_CAPS, campaignDay, campaignObjectiveAvailable, campaignView,
    type CampaignObjective, type VillageCampaign, type WarBattleMode, type WarOperation,
} from '../shared/village-war-campaign.js';
import { strongholdLocation } from './_stronghold-presence.js';
// The card seat loads the Chronicle engine and AI: only when a raid needs it.
const cardSeat = () => import('./_npc-campaign-card-seat.js');
import { shrineRoomLocation } from './_village-war-shrine-presence.js';
import { startNpcFieldOperation, finishNpcFieldOperation } from './_village-war-field-operations.js';
import { mercTargetsOnCooldown, pickMercTarget, setMercTargetCooldown, type RoamTarget } from './_merc-roam.js';
import { npcStandsIn, openNpcWarDuel, type NpcWarDuel } from './_npc-war-strike.js';
import { NPC_WAR_PARTY_TICK_MS } from './_npc-war-party.js';
import {
    npcOrderTile, readNpcCampaignState, writeNpcCampaignState, npcsHeldByClanWars,
    type NpcCampaignAssignment, type NpcCampaignState,
} from './_npc-campaign-assignments.js';

export const NPC_CAMPAIGN_TICK_MS = 60_000;
export const NPC_SHRINE_TICK_MS = 8_000;
export const NPC_STRONGHOLD_SQUAD = 4;
export const NPC_SHRINE_SQUAD = 3;
/** Free war shinobi the strongholds leave unposted, for strikes and field orders. */
export const NPC_STRONGHOLD_RESERVE = 2;
/** A field order takes as long as a player's walk and fight would: 8-12 minutes, per NPC and order. */
export const NPC_OPERATION_MIN_MS = 8 * 60_000;
export const NPC_OPERATION_MAX_MS = 12 * 60_000;
/** A strike order that has not met its target by then lapses. */
export const NPC_STRIKE_ORDER_MS = 5 * 60_000;
/** A raid order that has not reached, entered and started its stronghold by then lapses. */
export const NPC_RAID_ORDER_MS = 6 * 60_000;
/** A started raid keeps its NPC posted at the stronghold until the battle is over, at most this long (the battle itself plays on). */
export const NPC_RAID_HOLD_MS = 45 * 60_000;
/** The minimum level a player needs for any village-war action. */
const WAR_MIN_LEVEL = 15;
/** The two save facts that decide whether a shinobi may fight this tick. */
const WAR_FIGHTER_FACTS: KvProjection = { village: ['character', 'village'], level: ['character', 'level'] };

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** How long this NPC takes over this order (8-12 min, fixed for the order). */
export function npcOperationMs(npcId: string, missionId: string): number {
    return NPC_OPERATION_MIN_MS + hash32(`${npcId}:${missionId}:op`) % (NPC_OPERATION_MAX_MS - NPC_OPERATION_MIN_MS + 1);
}

/**
 * Whether this NPC can take part in a fight right now: on duty, not recovering
 * (hospital or Field Recovery shield), not already in a server-played fight,
 * and not under admin control (unless `allowPossessed`: the admin then plays
 * it, as with a queued defender). `forCopy`: an AI copy of it (the stronghold
 * ANBU defense) needs no live NPC, so DISABLE_NPC_VILLAGE does not stop it.
 */
export async function npcCampaignFighterFree(npcId: string, opts: { allowPossessed?: boolean; forCopy?: boolean; now?: number } = {}): Promise<boolean> {
    const id = safeName(npcId);
    if (!isNpcAccount(id)) return false;
    if (!opts.forCopy && process.env.DISABLE_NPC_VILLAGE === '1') return false;
    const now = opts.now ?? Date.now();
    // A player holding an NPC's account name is never sent to fight as one (api/_npc-ownership.ts).
    if (!(await npcOwnsSlug(id, now))) return false;
    if (woundShieldUntil(await readNpcWound(id), now) > 0) return false;
    if (await npcEngaged(id, now)) return false;
    if (await isNpcPossessed(id, now)) return !!opts.allowPossessed;
    return !npcOffDuty(id, now);
}

function warIsLive(war: Pick<CampaignWarRow, 'endedAt' | 'declarationFunding'>): boolean {
    return !war.endedAt && (!war.declarationFunding || war.declarationFunding.status === 'active');
}

/** The war-row fields the tick decides on before it reads any war whole (each row carries five days of receipts). */
const CAMPAIGN_WAR_SCAN: KvProjection = {
    villages: ['villages'],
    endedAt: ['endedAt'],
    declarationFunding: ['declarationFunding'],
    startsAt: ['campaign', 'startsAt'],
    endsAt: ['campaign', 'endsAt'],
    peaceProposals: ['peaceProposals'],
};
type CampaignWarScan = {
    id: string; villages: string[]; endedAt?: number; declarationFunding?: { status: string };
    peaceProposals?: Record<string, number>;
    /** The campaign's last moment: a war past it is over for the tick even before world-state stamps endedAt. */
    endsAt?: number;
};

/** Cinderhold's live campaign wars, from one projected read of the war rows. */
async function scanLiveCampaignWars(): Promise<CampaignWarScan[]> {
    const keys = await kv.keys('world:war:*');
    const rows = keys.length ? await readKvProjection(kv, keys, CAMPAIGN_WAR_SCAN) : [];
    return rows.flatMap((row, i) => {
        if (!row || !Array.isArray(row.villages) || !row.villages.includes(NPC_VILLAGE) || row.startsAt === undefined) return [];
        const war: CampaignWarScan = {
            id: keys[i]!.slice('world:war:'.length),
            villages: row.villages as string[],
            ...(row.endedAt ? { endedAt: Number(row.endedAt) } : {}),
            ...(Number.isFinite(Number(row.endsAt)) && row.endsAt !== null ? { endsAt: Number(row.endsAt) } : {}),
            ...(row.declarationFunding ? { declarationFunding: row.declarationFunding as { status: string } } : {}),
            ...(row.peaceProposals && typeof row.peaceProposals === 'object' ? { peaceProposals: row.peaceProposals as Record<string, number> } : {}),
        };
        return warIsLive(war) ? [war] : [];
    });
}

/** Reads whole only the war rows the scan found live. */
async function readCampaignWars(ids: readonly string[]): Promise<CampaignWarRow[]> {
    const rows = ids.length ? await kv.mget<Array<CampaignWarRow | null>>(...ids.map((id) => `world:war:${id}`)) : [];
    return rows.filter((war): war is CampaignWarRow => !!war?.campaign && Array.isArray(war.villages) && war.villages.includes(NPC_VILLAGE));
}

let enemiesCache: { at: number; enemies: Set<string> } | null = null;
/** The villages Cinderhold is fighting a declared, unended village war against (cached 30 s). */
export async function npcVillageWarEnemies(now = Date.now()): Promise<Set<string>> {
    if (enemiesCache && now - enemiesCache.at < 30_000) return enemiesCache.enemies;
    let enemies = new Set<string>();
    try {
        enemies = new Set((await scanLiveCampaignWars())
            .map((war) => war.villages.find((village) => village !== NPC_VILLAGE)!).filter(Boolean));
    } catch { enemies = enemiesCache?.enemies ?? new Set(); }
    enemiesCache = { at: now, enemies };
    return enemies;
}
export function resetNpcVillageCampaignCacheForTest(): void { enemiesCache = null; }

type Reply = { status: number; body: Record<string, unknown> };
/** Calls /api/village/war-campaign in-process as the NPC (its own token: the real route, every check). */
async function asNpcOnCampaign(npc: NpcShinobi, body: Record<string, unknown>): Promise<Reply> {
    const { asNpc, routeHandler } = await import('./_npc-duel-driver.js');
    return asNpc(routeHandler(await import('./village/war-campaign.js')), npc.id, npc.name, body);
}

/** Sends the NPC to `sector` on the ordinary travel lease (the presence tick lands it and keeps it there). */
function sendNpcTo(npc: NpcShinobi, sector: number, since: number): void {
    // The order holds it from now: its journey walker stands down at once
    // (the presence tick keeps holding it while the order lasts).
    holdNpcJourney(npc.id, 'order');
    const row = onlineStore.get(npc.name);
    if (!row || row.inBattle || row.pendingAttacker != null) return;
    if (row.travelDestinationSector === sector) return;
    if (row.sector === sector && !(Number(row.travelingUntil) > onlineStore.clockNow())) return;
    const leaving = onlineStore.startTravel(npc.name, sector, onlineStore.clockNow() + npcTravelMs(), row.sector, npcOrderTile(npc.id, sector, since));
    if (leaving) queuePresenceUpdate(leaving.name, row.sector);
}

/** Standing (not travelling) in `sector`. */
function npcAt(npc: NpcShinobi, sector: number): boolean {
    const row = onlineStore.get(npc.name);
    return !!row && row.sector === sector && !(Number(row.travelingUntil) > onlineStore.clockNow());
}

export type NpcCampaignDeps = {
    now?: number;
    /** Whether an NPC is free to fight (npcCampaignFighterFree). */
    fighterFree?: (npcId: string, now: number) => Promise<boolean>;
    /** The real world duel (api/_npc-war-strike.ts), with no sector-war registration. */
    openDuel?: (npc: NpcShinobi, target: string, sector: number) => Promise<NpcWarDuel>;
    campaign?: (npc: NpcShinobi, body: Record<string, unknown>) => Promise<Reply>;
    /** Answers the standing offers on these wars (reconsiderNpcVillagePeace); called only when one stands. */
    peace?: (now: number, warIds: string[]) => Promise<string[]>;
};
export type NpcCampaignReport = {
    peace: string[];
    defending: Array<{ npc: string; objectiveId: string; ok: boolean }>;
    shrine: Array<{ npc: string; action: string; ok: boolean }>;
    strikes: Array<{ npc: string; target: string; sector: number; stage: 'sent' | 'attacked' | 'refused' | 'lapsed'; battleId?: string }>;
    operations: Array<{ npc: string; missionId: string; kind?: WarOperation; stage: 'started' | 'completed' | 'failed'; points?: number }>;
    raids: NpcRaidReport[];
};
export type NpcRaidReport = {
    npc: string; objectiveId: string; sector: number;
    stage: 'sent' | 'entered' | 'started' | 'finished' | 'refused' | 'lapsed';
    mode?: WarBattleMode;
    /** started: a queued player defender, or the defending village's AI copy. */
    against?: 'player' | 'copy';
    runId?: string; battleId?: string; points?: number; reason?: string;
};

type Resolved = Required<Omit<NpcCampaignDeps, 'now'>>;

/** One tick of every Cinderhold village war. Never throws. */
export async function runNpcVillageCampaign(deps: NpcCampaignDeps = {}): Promise<NpcCampaignReport> {
    const report: NpcCampaignReport = { peace: [], defending: [], shrine: [], strikes: [], operations: [], raids: [] };
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) return report;
    const now = deps.now ?? Date.now();
    // One projected scan of the war rows; only Cinderhold's live wars are read whole.
    let scanned: CampaignWarScan[];
    try { scanned = await scanLiveCampaignWars(); } catch (err) { logSkip('scan', err); return report; }
    // A campaign past its end is over for the tick (raids, orders, peace) even
    // before world-state stamps endedAt: its row is not read whole each minute.
    scanned = scanned.filter((war) => war.endsAt === undefined || now < war.endsAt);
    let clanHeld: Set<string> | null = null;
    const baseFree = deps.fighterFree ?? ((id: string, at: number) => npcCampaignFighterFree(id, { now: at }));
    const d: Resolved = {
        // A shinobi a clan war holds (posted at its shrine, queued or mid-match;
        // api/_npc-clan-war-campaign.ts) is not free for the village war either.
        fighterFree: async (id, at) => {
            clanHeld ??= await npcsHeldByClanWars(now).catch(() => new Set<string>());
            return !clanHeld.has(id) && await baseFree(id, at);
        },
        openDuel: deps.openDuel ?? ((npc, target, sector) => openNpcWarDuel(npc, target, sector, { registerSectorWar: false })),
        campaign: deps.campaign ?? asNpcOnCampaign,
        peace: deps.peace ?? (async (at, ids) => (await import('./world-state.js')).reconsiderNpcVillagePeace(at, ids)),
    };
    // Peace is answered only where a player village's offer stands.
    const offers = scanned.filter((war) => {
        const enemy = war.villages.find((village) => village !== NPC_VILLAGE);
        return !!enemy && Number(war.peaceProposals?.[enemy]) > 0;
    }).map((war) => war.id);
    if (offers.length) {
        try { report.peace = await d.peace(now, offers); } catch (err) { logSkip('peace', err); }
    }
    const endedInPeace = new Set(report.peace);
    let wars: CampaignWarRow[] = [];
    try {
        wars = (await readCampaignWars(scanned.map((war) => war.id).filter((id) => !endedInPeace.has(id))))
            .filter((war) => warIsLive(war) && campaignWarPlayable(war, now));
    } catch (err) { logSkip('scan', err); return report; }
    let state: NpcCampaignState;
    try { state = await readNpcCampaignState(); } catch (err) { logSkip('state', err); return report; }
    const before = JSON.stringify(state);
    const live = new Map(wars.map((war) => [war.id, war]));
    // Orders for a war that is over (or a stale row) end here.
    for (const [id, order] of Object.entries(state.assignments)) {
        const war = live.get(order.warId);
        if (war && war.declarationGeneration === order.generation && order.until > now) continue;
        if (order.kind === 'operation' && order.missionId && war) {
            await finishNpcFieldOperation(order.warId, order.generation, id, order.missionId, false, now).catch(() => 0);
        }
        delete state.assignments[id];
    }
    for (const id of Object.keys(state.wars)) if (!live.has(id)) delete state.wars[id];
    for (const war of wars) {
        try { await campaignStep(war, state, now, d, report); } catch (err) { logSkip(`war ${war.id}`, err); }
    }
    // Nothing changed (no war, nothing to clear): no write.
    if (JSON.stringify(state) !== before) {
        try { await writeNpcCampaignState(state); } catch (err) { logSkip('state write', err); }
    }
    if (wars.length) await keepNpcShrineHolders({ now, campaign: d.campaign, state }).then((rows) => report.shrine.push(...rows)).catch(() => undefined);
    return report;
}

async function campaignStep(war: CampaignWarRow, state: NpcCampaignState, now: number, d: Resolved, report: NpcCampaignReport): Promise<void> {
    const c = war.campaign!;
    const generation = war.declarationGeneration ?? 1;
    const enemy = war.villages.find((village) => village !== NPC_VILLAGE)!;
    // Who fights: its ANBU, and its Genin and Chunin at level 15 or more (owner
    // ruling 2026-11-11). Each minute reads only the two facts that decide it;
    // a whole save is read only for an NPC weighed for a raid (its kit).
    const participants = await npcWarParticipants(now);
    const facts = await readKvProjection(kv, participants.map((npc) => `save:${npc.id}`), WAR_FIGHTER_FACTS);
    const eligible = new Set(participants.filter((npc, i) => {
        const f = facts[i];
        return !!f && String(f.village ?? '') === NPC_VILLAGE && Number(f.level) >= WAR_MIN_LEVEL;
    }).map((npc) => npc.id));
    const characterReads = new Map<string, Promise<Record<string, unknown> | null>>();
    const characterOf = (id: string) => {
        if (!characterReads.has(id)) {
            characterReads.set(id, kv.get<{ character?: Record<string, unknown> }>(`save:${id}`)
                .then((save) => save?.character ?? null, () => null));
        }
        return characterReads.get(id)!;
    };
    const freeCache = new Map<string, boolean>();
    const free = async (npc: NpcShinobi) => {
        if (!eligible.has(npc.id)) return false;
        if (!freeCache.has(npc.id)) freeCache.set(npc.id, await d.fighterFree(npc.id, now));
        return freeCache.get(npc.id)!;
    };
    const assign = (npc: NpcShinobi, order: Omit<NpcCampaignAssignment, 'warId' | 'generation'>) => {
        state.assignments[npc.id] = { ...order, warId: war.id, generation };
    };
    const ordersOf = (kind: NpcCampaignAssignment['kind']) => Object.entries(state.assignments)
        .filter(([, a]) => a.warId === war.id && a.kind === kind);
    // Its ANBU first, so the strongest fill the squads; the Genin and Chunin after them.
    const tier = (npc: NpcShinobi) => (isNpcWarDefenderRank(npc.rank) ? 0 : 1);
    const rotation = (salt: string) => [...participants]
        .sort((a, b) => tier(a) - tier(b) || hash32(`${a.id}:${salt}`) - hash32(`${b.id}:${salt}`) || a.id.localeCompare(b.id));
    const window = Math.floor(now / NPC_WAR_PARTY_TICK_MS);
    // Every shinobi, not only today's participants: an order held by one who
    // has since dropped out (a rescale) is still found, and released by free().
    const byId = new Map(NPC_VILLAGE_ROSTER.map((npc) => [npc.id, npc]));
    const warState = state.wars[war.id] ?? (state.wars[war.id] = {});

    // 1. Field orders already under way: beaten (or logged off) fails them,
    //    standing in the sector once the time is up completes them.
    for (const [id, order] of ordersOf('operation')) {
        const npc = byId.get(id);
        if (!npc || !order.missionId) { delete state.assignments[id]; continue; }
        const wound = await readNpcWound(id);
        const beaten = !!wound && Number(wound.at) >= order.since;
        const row = onlineStore.get(npc.name);
        if (!beaten && row?.inBattle) continue; // finishing a fight: decided after it
        if (!beaten && now < Number(order.readyAt)) {
            if (row) sendNpcTo(npc, order.sector, order.since);
            continue;
        }
        const ok = !beaten && npcAt(npc, order.sector);
        const points = await finishNpcFieldOperation(war.id, generation, id, order.missionId, ok, now);
        report.operations.push({ npc: id, missionId: order.missionId, stage: ok ? 'completed' : 'failed', points });
        delete state.assignments[id];
    }

    // 1b. Raids under way: walk, enter, then start on a later tick; a started
    //     one keeps its NPC posted until the battle is over.
    const raid: RaidContext = { war, c, enemy, state, now, window, d, report, free, assign, ordersOf, rotation, byId, characterOf, warState };
    await progressRaids(raid);

    // 2. Strongholds: keep a squad queued at each of Cinderhold's open ones.
    const open = c.strongholds.filter((o) => o.village === NPC_VILLAGE && now >= o.opensAt && now < o.closesAt && o.bouts < o.limit);
    for (const [id, order] of ordersOf('stronghold')) {
        const npc = byId.get(id)!;
        if (!open.some((o) => o.id === order.objectiveId) || !(await free(npc))) {
            delete state.assignments[id];
            await d.campaign(npc, { action: 'dequeue', warId: war.id }).catch(() => undefined);
        }
    }
    // A small reserve stays unposted for strikes and field orders (and the
    // shrine squad, while a window is open), so the strongholds never take
    // every free shinobi.
    const shrineOpen = c.shrine.some((o) => now >= o.opensAt && now < o.closesAt);
    const reserve = NPC_STRONGHOLD_RESERVE + (shrineOpen ? Math.max(0, NPC_SHRINE_SQUAD - ordersOf('shrine').length) : 0);
    const unassignedFree = async () => {
        let n = 0;
        for (const npc of participants) if (!state.assignments[npc.id] && await free(npc)) n++;
        return n;
    };
    let spare = await unassignedFree();
    for (const objective of open) {
        let squad = ordersOf('stronghold').filter(([, a]) => a.objectiveId === objective.id).length;
        for (const npc of rotation(`${objective.id}:${window}`)) {
            if (squad >= NPC_STRONGHOLD_SQUAD || spare <= reserve) break;
            if (state.assignments[npc.id] || !(await free(npc))) continue;
            spare--;
            assign(npc, { kind: 'stronghold', sector: objective.sector, objectiveId: objective.id, since: now, until: now + 3 * NPC_CAMPAIGN_TICK_MS });
            sendNpcTo(npc, objective.sector, now);
            squad++;
        }
    }
    for (const [id, order] of ordersOf('stronghold')) {
        const npc = byId.get(id)!;
        order.until = now + 3 * NPC_CAMPAIGN_TICK_MS;
        if (!npcAt(npc, order.sector)) { sendNpcTo(npc, order.sector, order.since); continue; }
        const reply = await d.campaign(npc, { action: 'defend', warId: war.id, objectiveId: order.objectiveId });
        report.defending.push({ npc: id, objectiveId: order.objectiveId!, ok: reply.status === 200 });
    }

    // 3. The shrine: a squad holds it through each open window.
    const shrine = c.shrine.find((o) => now >= o.opensAt && now < o.closesAt);
    for (const [id, order] of ordersOf('shrine')) {
        const npc = byId.get(id)!;
        if (shrine?.id === order.objectiveId && await free(npc)) continue;
        delete state.assignments[id];
        await d.campaign(npc, { action: 'shrine-leave', warId: war.id, objectiveId: order.objectiveId }).catch(() => undefined);
    }
    if (shrine) {
        let squad = ordersOf('shrine').length;
        for (const npc of rotation(`${shrine.id}:shrine`)) {
            if (squad >= NPC_SHRINE_SQUAD) break;
            if (state.assignments[npc.id] || !(await free(npc))) continue;
            assign(npc, { kind: 'shrine', sector: shrine.sector, objectiveId: shrine.id, since: now, until: shrine.closesAt });
            sendNpcTo(npc, shrine.sector, now);
            squad++;
        }
        // The shrine outranks a stronghold post: short of hands, it calls
        // stronghold defenders off their queue (a player village would too).
        for (const [id] of ordersOf('stronghold')) {
            if (squad >= NPC_SHRINE_SQUAD) break;
            const npc = byId.get(id)!;
            if (!(await free(npc))) continue;
            await d.campaign(npc, { action: 'dequeue', warId: war.id }).catch(() => undefined);
            assign(npc, { kind: 'shrine', sector: shrine.sector, objectiveId: shrine.id, since: now, until: shrine.closesAt });
            sendNpcTo(npc, shrine.sector, now);
            squad++;
        }
        for (const [id, order] of ordersOf('shrine')) sendNpcTo(byId.get(id)!, order.sector, order.since);
    }

    // 4. Strikes: an order sent earlier attacks now, if both still stand there.
    for (const [id, order] of ordersOf('strike')) {
        const npc = byId.get(id)!;
        const target = String(order.target ?? '');
        const targetRow = target ? onlineStore.get(target) : null;
        const metThere = !!targetRow && targetRow.sector === order.sector && !(Number(targetRow.travelingUntil) > onlineStore.clockNow());
        if (now < Number(order.readyAt)) continue;
        if (!metThere || !(await free(npc))) {
            if (now >= order.until || !metThere) { report.strikes.push({ npc: id, target, sector: order.sector, stage: 'lapsed' }); delete state.assignments[id]; }
            continue;
        }
        if (!npcStandsIn(npc, order.sector)) {
            if (now >= order.until) { report.strikes.push({ npc: id, target, sector: order.sector, stage: 'lapsed' }); delete state.assignments[id]; }
            continue;
        }
        const duel = await d.openDuel(npc, target, order.sector);
        delete state.assignments[id];
        // In a duel now: not free for anything else this tick (a raid order below).
        if (duel.ok) freeCache.set(id, false);
        if (!duel.ok) { report.strikes.push({ npc: id, target, sector: order.sector, stage: 'refused' }); continue; }
        // Committed to this target: the shared merc cooldown, win or lose.
        await setMercTargetCooldown(target, now);
        report.strikes.push({ npc: id, target, sector: order.sector, stage: 'attacked', battleId: duel.battleId });
    }
    // One look for a target per strike window: a miss (nobody eligible, or no
    // free shinobi to send) waits for the next window instead of re-reading
    // every online player's save each minute.
    if (now - (warState.lastStrikeAt ?? -Infinity) >= NPC_WAR_PARTY_TICK_MS && !ordersOf('strike').length && warState.strikeLookWindow !== window) {
        warState.strikeLookWindow = window;
        const target = await pickStrikeTarget(enemy, now);
        if (target) {
            for (const npc of rotation(`${window}:strike`)) {
                if (state.assignments[npc.id] || !onlineStore.get(npc.name) || !(await free(npc))) continue;
                assign(npc, { kind: 'strike', sector: target.sector, target: target.name, since: now, readyAt: now + npcTravelMs(), until: now + NPC_STRIKE_ORDER_MS });
                sendNpcTo(npc, target.sector, now);
                warState.lastStrikeAt = now;
                report.strikes.push({ npc: npc.id, target: target.name, sector: target.sector, stage: 'sent' });
                break;
            }
        }
    }

    // 5. A new field order, at most one per war-party window.
    if (now - (warState.lastOperationAt ?? -Infinity) >= NPC_WAR_PARTY_TICK_MS) {
        for (const npc of rotation(`${window}:operation`)) {
            if (state.assignments[npc.id] || !(await free(npc))) continue;
            warState.lastOperationAt = now;
            const kinds = [...WAR_OPERATIONS].sort((a, b) => hash32(`${npc.id}:${a}:${window}`) - hash32(`${npc.id}:${b}:${window}`));
            for (const kind of kinds) {
                const mission = await startNpcFieldOperation(war.id, generation, npc.id, NPC_VILLAGE, kind, now).catch(() => null);
                if (!mission) continue;
                const readyAt = now + npcOperationMs(npc.id, mission.id);
                assign(npc, { kind: 'operation', sector: mission.sectors[0]!, missionId: mission.id, since: now, readyAt, until: readyAt + 2 * NPC_WAR_PARTY_TICK_MS });
                sendNpcTo(npc, mission.sectors[0]!, now);
                report.operations.push({ npc: npc.id, missionId: mission.id, kind, stage: 'started' });
                break;
            }
            break;
        }
    }

    // 6. A new raid on an enemy stronghold, at most one per war-party window.
    await orderRaid(raid);
}

type RaidContext = {
    war: CampaignWarRow; c: VillageCampaign; enemy: string; state: NpcCampaignState; now: number; window: number;
    d: Resolved; report: NpcCampaignReport;
    free: (npc: NpcShinobi) => Promise<boolean>;
    assign: (npc: NpcShinobi, order: Omit<NpcCampaignAssignment, 'warId' | 'generation'>) => void;
    ordersOf: (kind: NpcCampaignAssignment['kind']) => Array<[string, NpcCampaignAssignment]>;
    rotation: (salt: string) => NpcShinobi[];
    byId: Map<string, NpcShinobi>;
    /** The NPC's whole character, read once per tick and only when a raid weighs it. */
    characterOf: (id: string) => Promise<Record<string, unknown> | null>;
    warState: NpcCampaignState['wars'][string];
};

/** The enemy strongholds Cinderhold may raid now: discovered by its own intel (as a player's view needs), open and under the bout limit. */
export function npcRaidTargets(c: VillageCampaign, villages: readonly string[], enemy: string, now: number): CampaignObjective[] {
    return campaignView(c, villages, NPC_VILLAGE, now).strongholds
        .filter((o) => o.village === enemy && campaignObjectiveAvailable(c, o, NPC_VILLAGE, now));
}

/**
 * Whether the NPC's personal daily allowance still covers an assault on the AI
 * copy (a `sabotage` operation). Whether a defender will be queued is only
 * known when it starts, so a raider is sent only while either fight could be
 * admitted.
 */
function raidAllowanceLeft(c: VillageCampaign, npcId: string, now: number): boolean {
    const personal = c.usage[`${NPC_VILLAGE}:${campaignDay(c, now)}`]?.players?.[npcId];
    return !personal || (personal.total < WAR_OPERATION_CAPS.player && (personal.categories.sabotage ?? 0) < WAR_OPERATION_CAPS.byType.sabotage.player);
}

/** Whether this NPC can fight in this stronghold's mode: a war pet team, a legal Chronicle deck, or (combat) itself. */
async function npcRaidKit(npcId: string, character: Record<string, unknown> | null, mode: WarBattleMode): Promise<boolean> {
    if (!character) return false;
    if (mode === 'pet') return !!(await (await import('./_pet-showdown/war-team.js')).sealWarTeam(npcId).catch(() => null))?.length;
    if (mode === 'card') return (await import('./card-clash/_deck.js')).resolveChronicleDeckMutation(character, []).ok;
    return true;
}

/** Whether a started raid's battle is over, and what it scored for Cinderhold (read from the run, or a combat duel's own row). */
async function raidBattleOver(war: CampaignWarRow, runId: string): Promise<{ over: boolean; card: boolean; points?: number; battleId?: string }> {
    const run = await kv.get<{ status?: string; mode?: string; npc?: boolean; battleId?: string; result?: { points: number } }>(`village-campaign-run:${runId}`);
    if (!run) return { over: true, card: false };
    if (run.status === 'done') return { over: true, card: run.mode === 'card', points: run.result?.points ?? 0, battleId: run.battleId };
    if (run.mode === 'combat' && !run.npc && run.battleId) {
        const duel = await kv.get<{ status?: string }>(`pvp:${run.battleId}`);
        // No row yet a moment after the create, or a row still being fought.
        if (duel?.status !== 'done') return { over: false, card: false, battleId: run.battleId };
        const receipt = war.campaign?.receipts[`combat:${run.battleId}`];
        return { over: true, card: false, battleId: run.battleId, ...(receipt ? { points: receipt.village === NPC_VILLAGE ? receipt.points : 0 } : {}) };
    }
    return { over: false, card: run.mode === 'card' };
}

async function progressRaids(x: RaidContext): Promise<void> {
    const { war, c, state, now, d, report } = x;
    for (const [id, order] of x.ordersOf('raid')) {
        const npc = x.byId.get(id);
        if (!npc || !order.objectiveId) { delete state.assignments[id]; continue; }
        const base = { npc: id, objectiveId: order.objectiveId, sector: order.sector };
        const leave = () => d.campaign(npc, { action: 'leave', warId: war.id, objectiveId: order.objectiveId }).catch(() => undefined);
        if (order.runId) {
            // Under way: the NPC never gives a battle up. It stays posted until
            // the battle is over (the duel drivers play it to the end).
            const battle = await raidBattleOver(war, order.runId);
            if (battle.over) {
                report.raids.push({ ...base, stage: 'finished', runId: order.runId, ...(battle.battleId ? { battleId: battle.battleId } : {}), ...(battle.points !== undefined ? { points: battle.points } : {}) });
                delete state.assignments[id];
                await leave();
            } else if (now >= order.until) delete state.assignments[id];
            else if (battle.card) await (await cardSeat()).registerNpcCampaignCardRun(order.runId, { npc: id, warId: war.id, at: now }).catch(() => undefined);
            continue;
        }
        const objective = c.strongholds.find((o) => o.id === order.objectiveId);
        const lapse = async (stage: 'lapsed' | 'refused', reason?: string) => {
            report.raids.push({ ...base, stage, ...(reason ? { reason } : {}) });
            delete state.assignments[id];
            if (strongholdLocation(npc.name, order.sector)) await leave();
        };
        if (!objective || !campaignObjectiveAvailable(c, objective, NPC_VILLAGE, now) || now >= order.until) { await lapse('lapsed'); continue; }
        if (!(await x.free(npc))) { await lapse('lapsed', 'not free'); continue; }
        if (!npcAt(npc, order.sector)) { sendNpcTo(npc, order.sector, order.since); continue; }
        if (!strongholdLocation(npc.name, order.sector)) {
            const entered = await d.campaign(npc, { action: 'enter', warId: war.id, objectiveId: objective.id });
            if (entered.status !== 200) { await lapse('refused', String(entered.body.error ?? entered.status)); continue; }
            order.enteredAt = now;
            report.raids.push({ ...base, stage: 'entered' });
            continue;
        }
        // Inside: the assault starts on a later tick than the entry.
        if (order.enteredAt === undefined || order.enteredAt >= now) { order.enteredAt ??= now; continue; }
        const started = await d.campaign(npc, { action: 'start', warId: war.id, objectiveId: objective.id });
        const runId = typeof started.body.runId === 'string' ? started.body.runId : '';
        if (started.status !== 200 || !runId) { await lapse('refused', String(started.body.error ?? started.status)); continue; }
        const battleId = typeof started.body.battleId === 'string' ? started.body.battleId : undefined;
        report.raids.push({ ...base, stage: 'started', mode: objective.mode, against: started.body.npc ? 'copy' : 'player', runId, ...(battleId ? { battleId } : {}) });
        if (started.body.status === 'done') {
            // A pet duel, or the combat assault on the AI copy, is decided on the spot.
            const result = started.body.warResult as { points?: number } | undefined;
            report.raids.push({ ...base, stage: 'finished', runId, points: Number(result?.points ?? 0) });
            delete state.assignments[id];
            await leave();
            continue;
        }
        order.runId = runId;
        order.until = now + NPC_RAID_HOLD_MS;
        if (objective.mode === 'card') {
            const seat = await cardSeat();
            await seat.registerNpcCampaignCardRun(runId, { npc: id, warId: war.id, at: now }).catch(() => undefined);
            void seat.kickNpcCampaignCardRun(runId).catch(() => undefined);
        }
    }
}

async function orderRaid(x: RaidContext): Promise<void> {
    const { war, c, enemy, state, now, window } = x;
    if (x.warState.raidWindow === window) return;
    const raided = new Set(x.ordersOf('raid').map(([, a]) => a.objectiveId));
    const targets = npcRaidTargets(c, war.villages, enemy, now)
        .filter((o) => !raided.has(o.id))
        .sort((a, b) => hash32(`${a.id}:${window}:raid`) - hash32(`${b.id}:${window}:raid`) || a.id.localeCompare(b.id));
    if (!targets.length) return;
    // An unposted shinobi first. Short of hands (the shrine squad and the field
    // order took the spare ones), a stronghold defender is called off its queue
    // to raid, as the shrine does and as a player village would: Cinderhold's
    // raids never wait on the strongholds having filled every post.
    const rotation = x.rotation(`${window}:raid`);
    const candidates = [
        ...rotation.filter((npc) => !state.assignments[npc.id]),
        ...rotation.filter((npc) => state.assignments[npc.id]?.kind === 'stronghold' && state.assignments[npc.id]!.warId === war.id),
    ];
    for (const npc of candidates) {
        if (!onlineStore.get(npc.name) || !(await x.free(npc)) || !raidAllowanceLeft(c, npc.id, now)) continue;
        let objective: CampaignObjective | undefined;
        for (const o of targets) if (await npcRaidKit(npc.id, await x.characterOf(npc.id), o.mode)) { objective = o; break; }
        if (!objective) continue;
        if (state.assignments[npc.id]?.kind === 'stronghold') await x.d.campaign(npc, { action: 'dequeue', warId: war.id }).catch(() => undefined);
        x.warState.raidWindow = window;
        x.assign(npc, { kind: 'raid', sector: objective.sector, objectiveId: objective.id, since: now, until: now + NPC_RAID_ORDER_MS });
        sendNpcTo(npc, objective.sector, now);
        x.report.raids.push({ npc: npc.id, objectiveId: objective.id, sector: objective.sector, stage: 'sent', mode: objective.mode });
        return;
    }
}

const STRIKE_TARGET_FACTS: KvProjection = {
    village: ['character', 'village'], level: ['character', 'level'], hp: ['character', 'hp'], maxHp: ['character', 'maxHp'],
};

/** The enemy player a strike goes for: online in a wild sector, not travelling or fighting, lowest HP first, off the merc cooldown. */
async function pickStrikeTarget(enemy: string, now: number): Promise<{ name: string; sector: number } | null> {
    const rows = onlineStore.list().filter((p) => !isNpcAccount(p.name) && p.sector >= 1 && p.sector <= MAX_WILD_SECTOR
        && !p.inBattle && p.pendingAttacker == null && !(Number(p.travelingUntil) > onlineStore.clockNow()) && !p.locationUnverified);
    if (!rows.length) return null;
    const slugs = rows.map((p) => safeName(p.name));
    // Only the four fields the pick reads, never the whole save.
    const saves = await readKvProjection(kv, slugs.map((slug) => `save:${slug}`), STRIKE_TARGET_FACTS);
    const targets: Array<RoamTarget & { sector: number }> = [];
    slugs.forEach((name, i) => {
        const ch = saves[i];
        if (!ch || String(ch.village ?? '').trim() !== enemy || Number(ch.level) < WAR_MIN_LEVEL) return;
        const hp = Number(ch.hp);
        targets.push({ name, village: enemy, hp, maxHp: Number(ch.maxHp) || hp, sector: rows[i]!.sector });
    });
    const cooling = await mercTargetsOnCooldown(targets.map((t) => t.name), now);
    const pick = pickMercTarget(targets.filter((t) => !cooling.has(t.name)), enemy);
    return pick ? { name: pick.name, sector: targets.find((t) => t.name === pick.name)!.sector } : null;
}

/**
 * Keeps every shrine holder's room lease alive (a lease lapses after 20 s
 * without a step or a poll): `shrine-state` while it holds a lease,
 * `shrine-enter` once it stands in the sector without one (just arrived, or
 * back from a fight). A holder mid-fight keeps its lease through the battle.
 */
export async function keepNpcShrineHolders(opts: { now?: number; campaign?: NpcCampaignDeps['campaign']; state?: NpcCampaignState } = {}): Promise<NpcCampaignReport['shrine']> {
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) return [];
    const now = opts.now ?? Date.now();
    const campaign = opts.campaign ?? asNpcOnCampaign;
    const state = opts.state ?? await readNpcCampaignState();
    const out: NpcCampaignReport['shrine'] = [];
    const wars = new Map<string, CampaignWarRow | null>();
    for (const [id, order] of Object.entries(state.assignments)) {
        if (order.kind !== 'shrine' || order.until <= now || !order.objectiveId) continue;
        const npc = NPC_VILLAGE_ROSTER.find((entry) => entry.id === id);
        if (!npc) continue;
        if (!wars.has(order.warId)) wars.set(order.warId, await kv.get<CampaignWarRow>(`world:war:${order.warId}`));
        const war = wars.get(order.warId);
        const objective = war?.campaign?.shrine.find((o) => o.id === order.objectiveId);
        if (!war || !objective || now < objective.opensAt || now >= objective.closesAt) continue;
        const row = onlineStore.get(npc.name);
        if (!row || row.inBattle || row.sector !== order.sector || Number(row.travelingUntil) > onlineStore.clockNow()) continue;
        const holding = shrineRoomLocation(npc.name, war, order.sector, now)?.objectiveId === objective.id;
        const action = holding ? 'shrine-state' : 'shrine-enter';
        const reply = await campaign(npc, { action, warId: war.id, objectiveId: objective.id }).catch(() => ({ status: 500, body: {} }));
        out.push({ npc: id, action, ok: reply.status === 200 });
    }
    return out;
}

function logSkip(scope: string, err: unknown): void {
    console.error(`[npc-village-campaign] ${scope} skipped this tick:`, (err as Error)?.message ?? err);
}

let mainTimer: ReturnType<typeof setInterval> | null = null;
let shrineTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let shrineTicking = false;
/** Starts the campaign tick and the shrine lease keeper (idempotent). DISABLE_NPC_VILLAGE=1 keeps both off. */
export function startNpcVillageCampaign(): void {
    if (mainTimer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    mainTimer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void runNpcVillageCampaign().catch(() => undefined).finally(() => { ticking = false; });
    }, NPC_CAMPAIGN_TICK_MS);
    mainTimer.unref?.();
    shrineTimer = setInterval(() => {
        if (shrineTicking || ticking) return;
        shrineTicking = true;
        void keepNpcShrineHolders().catch(() => undefined).finally(() => { shrineTicking = false; });
    }, NPC_SHRINE_TICK_MS);
    shrineTimer.unref?.();
    // The seat that plays a raider's village-war card battles, once a second.
    void cardSeat().then((seat) => seat.startNpcCampaignCardSeat()).catch(() => undefined);
}
export function stopNpcVillageCampaign(): void {
    if (mainTimer) clearInterval(mainTimer);
    if (shrineTimer) clearInterval(shrineTimer);
    mainTimer = null; shrineTimer = null;
    void cardSeat().then((seat) => seat.stopNpcCampaignCardSeat()).catch(() => undefined);
}

/**
 * Cinderhold's clans in a clan war (owner rulings 2026-11-10).
 *
 * A Cinderhold clan has no players, so in a clan war its members "play like
 * players" here, through the players' own routes called in-process as each
 * NPC (the duel driver's asNpc token pattern), under every rule a player meets:
 *
 *   - queue: when the opposing player clan has a member queued for a mode
 *     (Shinobi Duel, Pet Showdown, Chronicle Showdown), a free NPC on the sealed
 *     roster joins that mode's queue, keeps its heartbeat and confirms the ready
 *     check, so pairing, budgets and the abandon rules are the real ones. It
 *     never queues first: it answers a player who is waiting, as a rival clan's
 *     member would.
 *   - Shinobi Duel: the player's client opens the PvP session as always; the
 *     session seals the NPC's seat (api/_npc-duel.ts, never paid) and the duel
 *     driver joins and plays it (api/_npc-duel-driver.ts).
 *   - Pet Showdown: the NPC fields its own active companion through
 *     /api/clan/war/pet, and the server resolves the duel.
 *   - Chronicle Showdown: once the player has taken the first seat, the NPC
 *     joins the real clan-war card duel with its own saved deck and the card
 *     seat below plays its turns with the hard Chronicle AI.
 *   - Team Battle (2v2): never. Tower team fights have no NPC seats; the
 *     campaign panel tells the player clan so.
 *   - shrines: during each golden-shrine window up to NPC_CLAN_SHRINE_SQUAD free
 *     NPCs walk to the shrine sector, enter the shrine (`shrine-enter`) and keep
 *     their visit (`shrine-state`), so they stand in its room as players do and
 *     answer a player queued there for the shrine's mode.
 *   - a beaten NPC takes a player's ordinary loss: the hospital stay, then the
 *     Field Recovery shield (api/_npc-wounds.ts); it is not chosen again until
 *     it has recovered.
 *
 * It never declares (owner ruling 2026-11-10: only player clans start a clan
 * war with a Cinderhold clan, and /clan/war/declare refuses every NPC), never
 * surrenders or withdraws, never buys provisions, and is never paid
 * (api/clan/war/_campaign-rewards.ts skips NPCs). DISABLE_NPC_VILLAGE=1 stops
 * all of it; a running war simply gets no NPC activity.
 */
import { kv } from './_storage.js';
import { readKvProjection, type KvProjection } from './_storage-projection.js';
import { clanRecordKey, safeName } from './_utils.js';
import { playerSessionsEnabled } from './_auth.js';
import { onlineStore } from './_realtime/online-store.js';
import { queuePresenceUpdate } from './_realtime/presence-broadcast.js';
import { isNpcPossessed } from './_npc-possession.js';
import { npcTravelMs } from './_npc-presence.js';
import { holdNpcJourney } from './_npc-journeys.js';
import { woundNpc } from './_npc-wounds.js';
import { npcCampaignFighterFree } from './_npc-village-campaign.js';
import { NPC_CLAN_CARD_DUEL_REGISTRY_KEY } from './_npc-duel.js';
import {
    npcOrderTile, readNpcCampaignState, readNpcClanWarState, writeNpcClanWarState, type NpcClanWarState,
} from './_npc-campaign-assignments.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount, type NpcShinobi } from '../shared/npc-village-roster.js';
import { isNpcClanRecord } from '../shared/npc-clans.js';
import {
    CLAN_WAR_RULES, clanWarCampaignDay, clanWarCampaignPhase, clanWarOwnValue, clanWarPlayerKey,
    type ClanWarMatchScope, type ClanWarQueueMode,
} from '../shared/clan-war-campaign.js';
import { isClanWarRowKey, type ClanWar } from './clan/war/_storage.js';
import { clanShrinePresenceError } from './clan/war/_shrine-presence.js';
import { clanWarPetSessionKey } from './clan/war/_pet-duel.js';
import { PVP_HOSPITAL_DURATION_MS, PVP_RAID_SHIELD_MS } from './pvp/_vitals-settlement.js';
import { withKvLock } from './_lock.js';
import { withNpcSeatLease, type NpcSeatLease } from './_npc-seat-lease.js';
import { chooseAiIntents } from './card-clash/_ai-engine.js';
import { npcCardBeatMs, npcCardJoinAt, npcChronicleReadyAt } from './_npc-card-duel-driver.js';
import { advanceExpiredChronicleTurn, applyAction, type ChronicleActionIntent, type ChronicleMatch } from '../shared/chronicle-duel.js';

export const NPC_CLAN_WAR_TICK_MS = 10_000;
export const NPC_CLAN_SHRINE_TICK_MS = 8_000;
export const NPC_CLAN_SHRINE_SQUAD = 3;
/** The modes a Cinderhold clan answers (never 2v2: tower team fights have no NPC seats). */
export const NPC_CLAN_WAR_MODES: readonly ClanWarQueueMode[] = ['pvp1v1', 'pet1v1', 'tilecards'];
/** How long a queued or matched NPC stays "held" for the village-war tick without a fresh mark. */
const BUSY_MS = 60_000;
/** A player reads the pet lineup before sending theirs; the NPC waits a few seconds too. */
export const NPC_PET_THINK_MS = 4_000;
/** New NPC answers per war per tick, so a burst of rival queues fills over a few ticks, not at once. */
const MAX_JOINS_PER_TICK = 3;
/** Refused joins (an NPC the route turns away) per war per tick, so a bad tick never asks the whole roster for every waiting player. */
const MAX_REFUSALS_PER_TICK = 10;

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

type Reply = { status: number; body: Record<string, unknown> };
type Handler = (req: unknown, res: unknown) => unknown;
let tilecardsForTest: ((npcId: string, body: Record<string, unknown>) => Promise<Reply>) | null = null;
/** Tests stand a fake route in for /api/clan/war/tilecards, the card seat's (null restores it). */
export function setNpcClanTilecardsSendForTest(send: typeof tilecardsForTest): void { tilecardsForTest = send; }
async function asNpcOn(modPath: 'queue' | 'pet' | 'tilecards', npc: NpcShinobi, body: Record<string, unknown>): Promise<Reply> {
    if (modPath === 'tilecards' && tilecardsForTest) return tilecardsForTest(npc.id, body);
    const { asNpc, routeHandler } = await import('./_npc-duel-driver.js');
    const mod = modPath === 'queue' ? await import('./clan/war/queue.js')
        : modPath === 'pet' ? await import('./clan/war/pet.js') : await import('./clan/war/tilecards.js');
    return asNpc(routeHandler(mod) as Handler, npc.id, npc.name, body);
}

/** Whether the war's other side is a Cinderhold clan (by its stored record), and which. */
export function npcSideOf(war: ClanWar, npcClans: ReadonlySet<string>): { npcClan: string; enemy: string } | null {
    const npcClan = war.clans.find((clan) => npcClans.has(clan));
    const enemy = war.clans.find((clan) => clan !== npcClan);
    return npcClan && enemy && !npcClans.has(enemy) ? { npcClan, enemy } : null;
}

async function seededNpcClans(): Promise<Set<string>> {
    const { NPC_CLANS } = await import('../shared/npc-clans.js');
    const records = await kv.mget<Array<Record<string, unknown> | null>>(...NPC_CLANS.map((clan) => clanRecordKey(clan.name)));
    return new Set(NPC_CLANS.filter((_, i) => isNpcClanRecord(records[i])).map((clan) => clan.name));
}

/**
 * Which clan-war rows are a live war of a Cinderhold clan. Every war row ever
 * declared stays under `clan-war:` with its whole history, so the 10 s tick
 * must not read them all: each key is classified once from two projected
 * fields, and only the live NPC wars are read whole. The whole index is
 * re-read every NPC_CLAN_WAR_INDEX_MS (a pair re-declared on its old key, an
 * NPC clan seeded later); a new key is classified on the tick it appears.
 */
export const NPC_CLAN_WAR_INDEX_MS = 60_000;
const WAR_INDEX_PROJECTION: KvProjection = { clans: ['clans'], endedAt: ['endedAt'] };
let warIndex: { at: number; clans: string; live: Map<string, boolean> } | null = null;
export function resetNpcClanWarIndexForTest(): void { warIndex = null; }

async function liveNpcClanWars(npcClans: ReadonlySet<string>, now: number): Promise<ClanWar[]> {
    if (!npcClans.size) return [];
    const keys = (await kv.keys('clan-war:*')).filter(isClanWarRowKey);
    const signature = [...npcClans].sort().join('|');
    if (!warIndex || warIndex.clans !== signature || !(now - warIndex.at >= 0 && now - warIndex.at < NPC_CLAN_WAR_INDEX_MS)) {
        warIndex = { at: now, clans: signature, live: new Map() };
    }
    const index = warIndex;
    const unseen = keys.filter((key) => !index.live.has(key));
    if (unseen.length) {
        const rows = await readKvProjection(kv, unseen, WAR_INDEX_PROJECTION);
        unseen.forEach((key, i) => {
            const row = rows[i];
            const clans = Array.isArray(row?.clans) ? row!.clans as [string, string] : null;
            index.live.set(key, !!clans && !row!.endedAt && !!npcSideOf({ clans } as ClanWar, npcClans));
        });
    }
    const liveKeys = keys.filter((key) => index.live.get(key));
    const rows = liveKeys.length ? await kv.mget<Array<ClanWar | null>>(...liveKeys) : [];
    return rows.filter((war, i): war is ClanWar => {
        const live = !!war?.campaign && !war.endedAt && !!npcSideOf(war, npcClans);
        if (!live) index.live.set(liveKeys[i]!, false); // ended (or gone): not read whole again until the index refreshes
        return live;
    });
}

/** Sends the NPC to `sector` on the ordinary travel lease (the presence tick lands it and keeps it there). */
function sendNpcTo(npc: NpcShinobi, sector: number, since: number): void {
    // The shrine post holds it from now: its journey walker stands down at once.
    holdNpcJourney(npc.id, 'order');
    const row = onlineStore.get(npc.name);
    if (!row || row.inBattle || row.pendingAttacker != null) return;
    if (row.travelDestinationSector === sector) return;
    if (row.sector === sector && !(Number(row.travelingUntil) > onlineStore.clockNow())) return;
    const leaving = onlineStore.startTravel(npc.name, sector, onlineStore.clockNow() + npcTravelMs(), row.sector, npcOrderTile(npc.id, sector, since));
    if (leaving) queuePresenceUpdate(leaving.name, row.sector);
}
function standingIn(npc: NpcShinobi, sector: number): boolean {
    const row = onlineStore.get(npc.name);
    return !!row && !row.inBattle && row.sector === sector && !(Number(row.travelingUntil) > onlineStore.clockNow());
}

export type NpcClanWarDeps = {
    now?: number;
    /** Whether an NPC is free to fight (wounds, live duels, admin control, off duty). */
    fighterFree?: (npcId: string, now: number) => Promise<boolean>;
    queue?: (npc: NpcShinobi, body: Record<string, unknown>) => Promise<Reply>;
    pet?: (npc: NpcShinobi, body: Record<string, unknown>) => Promise<Reply>;
};
export type NpcClanWarReport = {
    joined: Array<{ npc: string; warId: string; mode: string; scope: ClanWarMatchScope; ok: boolean; error?: string }>;
    ready: Array<{ npc: string; matchId: string; ok: boolean }>;
    left: Array<{ npc: string; warId: string }>;
    pets: Array<{ npc: string; matchId: string; ok: boolean }>;
    cards: Array<{ npc: string; matchId: string }>;
    shrine: Array<{ npc: string; action: string; ok: boolean }>;
    wounded: string[];
};
type Resolved = Required<Omit<NpcClanWarDeps, 'now'>>;

const sameSlot = (a: { mode: string; scope: string; windowIndex?: number }, b: { mode: string; scope: string; windowIndex?: number }) =>
    a.mode === b.mode && a.scope === b.scope && (a.windowIndex ?? null) === (b.windowIndex ?? null);

/** One tick of every Cinderhold clan war. Never throws. */
export async function runNpcClanWarCampaign(deps: NpcClanWarDeps = {}): Promise<NpcClanWarReport> {
    const report: NpcClanWarReport = { joined: [], ready: [], left: [], pets: [], cards: [], shrine: [], wounded: [] };
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) return report;
    const now = deps.now ?? Date.now();
    let wars: ClanWar[];
    let state: NpcClanWarState;
    let npcClans: Set<string>;
    try {
        npcClans = await seededNpcClans();
        wars = await liveNpcClanWars(npcClans, now);
        state = await readNpcClanWarState();
    } catch (err) { logSkip('scan', err); return report; }
    // No war and nothing left to clear: the tick reads nothing more and writes nothing.
    const before = JSON.stringify(state);
    if (!wars.length && !Object.keys(state.posts).length && !Object.keys(state.busy).length && !Object.keys(state.wounded).length) return report;
    let villagePosted = new Set<string>();
    try {
        const village = await readNpcCampaignState();
        villagePosted = new Set(Object.entries(village.assignments).filter(([, a]) => Number(a?.until) > now).map(([id]) => id));
    } catch { /* no village orders: nothing to avoid */ }
    const baseFree = deps.fighterFree ?? ((id: string, at: number) => npcCampaignFighterFree(id, { now: at }));
    const d: Resolved = {
        // A shinobi on a village-war order stays on it (api/_npc-village-campaign.ts).
        fighterFree: async (id, at) => !villagePosted.has(id) && await baseFree(id, at),
        queue: deps.queue ?? ((npc, body) => asNpcOn('queue', npc, body)),
        pet: deps.pet ?? ((npc, body) => asNpcOn('pet', npc, body)),
    };
    const live = new Map(wars.map((war) => [war.id, war]));
    // Posts for an ended war (or a closed window) end here; the shrine is left as a player leaves it.
    for (const [id, post] of Object.entries(state.posts)) {
        const war = live.get(post.warId);
        const window = war?.campaign?.shrines.find((entry) => entry.index === post.windowIndex);
        if (war && window && now < window.closesAt && post.until > now) continue;
        delete state.posts[id];
        const npc = NPC_VILLAGE_ROSTER.find((entry) => entry.id === id);
        if (npc && war) await d.queue(npc, { action: 'shrine-leave', warId: war.id, scope: 'shrine', windowIndex: post.windowIndex }).catch(() => undefined);
    }
    for (const [id, until] of Object.entries(state.busy)) if (!(Number(until) > now)) delete state.busy[id];
    for (const [matchId, at] of Object.entries(state.wounded)) if (now - Number(at) > 4 * CLAN_WAR_RULES.dayMs) delete state.wounded[matchId];
    for (const war of wars) {
        try { await warStep(war, npcClans, state, now, d, report); } catch (err) { logSkip(`war ${war.id}`, err); }
    }
    if (JSON.stringify(state) !== before) {
        try { await writeNpcClanWarState(state); } catch (err) { logSkip('state write', err); }
    }
    return report;
}

async function warStep(war: ClanWar, npcClans: ReadonlySet<string>, state: NpcClanWarState, now: number, d: Resolved, report: NpcClanWarReport): Promise<void> {
    const side = npcSideOf(war, npcClans);
    const c = war.campaign!;
    if (!side || clanWarCampaignPhase(c, now) !== 'active') return;
    const { npcClan, enemy } = side;
    const sealed = c.rosters.find((roster) => roster.clan === npcClan)?.members ?? [];
    const ids = new Set(sealed.map((member) => clanWarPlayerKey(member.name)).filter(isNpcAccount));
    const npcs = NPC_VILLAGE_ROSTER.filter((npc) => ids.has(npc.id));
    const byId = new Map(npcs.map((npc) => [npc.id, npc]));
    const ours = (name: string) => byId.get(clanWarPlayerKey(name));
    const openMatches = Object.values(c.matches).filter((m) => m.status === 'ready' || m.status === 'active');
    const engaged = new Set<string>();
    for (const m of openMatches) for (const name of [...m.fromPlayers, ...m.toPlayers]) if (ours(name)) engaged.add(clanWarPlayerKey(name));
    for (const entry of c.queue) for (const name of entry.players) if (ours(name)) engaged.add(clanWarPlayerKey(name));
    for (const id of engaged) state.busy[id] = now + BUSY_MS;
    const freeCache = new Map<string, boolean>();
    const free = async (npc: NpcShinobi) => {
        if (engaged.has(npc.id)) return false;
        if (!freeCache.has(npc.id)) freeCache.set(npc.id, await d.fighterFree(npc.id, now));
        return freeCache.get(npc.id)!;
    };
    const rotation = (salt: string) => [...npcs].sort((a, b) => hash32(`${a.id}:${salt}`) - hash32(`${b.id}:${salt}`) || a.id.localeCompare(b.id));
    const window = Math.floor(now / (30 * 60_000));

    // 1. Ready checks: every NPC paired with a waiting player confirms.
    for (const m of openMatches) {
        if (m.status !== 'ready' || now >= m.readyUntil) continue;
        for (const name of [...m.fromPlayers, ...m.toPlayers]) {
            const npc = ours(name);
            if (!npc || m.readyPlayers.includes(npc.id) || await isNpcPossessed(npc.id, now)) continue; // an admin confirms by hand
            const reply = await d.queue(npc, { action: 'ready', warId: war.id, matchId: m.id });
            report.ready.push({ npc: npc.id, matchId: m.id, ok: reply.status === 200 });
        }
    }

    // 2. Admitted matches the server plays outside the PvP driver.
    for (const m of openMatches) {
        if (m.status !== 'active') continue;
        for (const name of [...m.fromPlayers, ...m.toPlayers]) {
            const npc = ours(name);
            if (!npc || await isNpcPossessed(npc.id, now)) continue; // the admin plays it
            if (m.mode === 'pet1v1' && now >= Number(m.startedAt ?? 0) + NPC_PET_THINK_MS) {
                const session = await kv.get<{ from?: Array<{ name?: string }>; to?: Array<{ name?: string }>; status?: string }>(clanWarPetSessionKey(war.id, m.id));
                const fielded = [...(session?.from ?? []), ...(session?.to ?? [])].some((f) => safeName(String(f?.name ?? '')) === npc.id);
                if (session?.status === 'done' || fielded) continue;
                const save = await kv.get<{ character?: { activePetId?: unknown } }>(`save:${npc.id}`);
                const reply = await d.pet(npc, { action: 'submit', warId: war.id, challengeId: m.id, petId: String(save?.character?.activePetId ?? '') });
                report.pets.push({ npc: npc.id, matchId: m.id, ok: reply.status === 200 });
            } else if (m.mode === 'tilecards') {
                const registry = await liveNpcClanCardDuels();
                if (!registry[m.id]) {
                    await registerNpcClanCardDuel(m.id, { npc: npc.id, warId: war.id, at: now });
                    report.cards.push({ npc: npc.id, matchId: m.id });
                }
            }
        }
    }

    // 3. A beaten NPC takes a player's ordinary loss (the shinobi duel's is
    //    taken by its duel seat, api/_npc-duel-driver.ts claimAsNpc).
    for (const m of Object.values(c.matches)) {
        if (m.status !== 'completed' || m.mode === 'pvp1v1' || state.wounded[m.id] || !m.completedAt || now - m.completedAt > 60 * 60_000) continue;
        const npcLost = (m.result === 'from-wins' ? m.toPlayers : m.result === 'to-wins' ? m.fromPlayers : []).map(ours).filter(Boolean) as NpcShinobi[];
        const winners = m.result === 'from-wins' ? m.fromPlayers : m.result === 'to-wins' ? m.toPlayers : [];
        for (const npc of npcLost) {
            await woundNpc(npc.id, m.completedAt, safeName(String(winners[0] ?? '')), { ms: PVP_HOSPITAL_DURATION_MS, shieldMs: PVP_RAID_SHIELD_MS }).catch(() => undefined);
            report.wounded.push(npc.id);
        }
        state.wounded[m.id] = now;
    }

    // 4. Queue entries: keep the heartbeat while a rival player still waits in
    //    the same slot; leave once nobody does (a player stops waiting too).
    const enemyEntries = c.queue.filter((entry) => entry.clan === enemy && entry.players.length === 1 && NPC_CLAN_WAR_MODES.includes(entry.mode));
    for (const entry of c.queue.filter((e) => e.clan === npcClan)) {
        const npc = entry.players.map(ours).find(Boolean);
        if (!npc) continue;
        const wanted = enemyEntries.some((e) => sameSlot(e, entry));
        const body = { warId: war.id, mode: entry.mode, scope: entry.scope, ...(entry.windowIndex !== undefined ? { windowIndex: entry.windowIndex } : {}) };
        if (wanted && !(await isNpcPossessed(npc.id, now))) await d.queue(npc, { ...body, action: 'heartbeat' }).catch(() => undefined);
        else if (!wanted && !(await isNpcPossessed(npc.id, now))) {
            await d.queue(npc, { ...body, action: 'leave' }).catch(() => undefined);
            report.left.push({ npc: npc.id, warId: war.id });
        }
    }

    // 5. The shrine: a squad holds it through each open window.
    const shrine = c.shrines.find((entry) => now >= entry.opensAt && now < entry.closesAt);
    const postedHere = () => Object.entries(state.posts).filter(([, post]) => post.warId === war.id);
    for (const [id, post] of postedHere()) {
        const npc = byId.get(id);
        if (npc && shrine && post.windowIndex === shrine.index && (engaged.has(id) || await d.fighterFree(id, now))) continue;
        delete state.posts[id];
        if (npc) await d.queue(npc, { action: 'shrine-leave', warId: war.id, scope: 'shrine', windowIndex: post.windowIndex }).catch(() => undefined);
    }
    if (shrine) {
        let squad = postedHere().length;
        for (const npc of rotation(`${war.id}:${shrine.index}:shrine`)) {
            if (squad >= NPC_CLAN_SHRINE_SQUAD) break;
            if (state.posts[npc.id] || !onlineStore.get(npc.name) || !(await free(npc))) continue;
            state.posts[npc.id] = { warId: war.id, windowIndex: shrine.index, sector: shrine.sector, since: now, until: shrine.closesAt };
            squad++;
        }
        for (const [id, post] of postedHere()) { const npc = byId.get(id); if (npc) sendNpcTo(npc, post.sector, post.since); }
    }

    // 6. Answer every rival player waiting in a slot no NPC has taken yet.
    //    Only answers made count against MAX_JOINS_PER_TICK. An NPC whose own
    //    scored slots for the day (or for this shrine appearance) are used up is
    //    passed over without asking the route, so a few spent shinobi never
    //    starve the rest of the roster.
    const day = clanWarCampaignDay(c, now);
    const slotsSpent = (npc: NpcShinobi, waiting: { scope: string; windowIndex?: number }) => {
        if (waiting.scope === 'shrine') {
            const window = c.shrines.find((entry) => entry.index === waiting.windowIndex);
            return (clanWarOwnValue(window?.memberUses, npc.id) ?? 0) >= CLAN_WAR_RULES.shrineMemberMatches;
        }
        const budget = day === null ? undefined : c.days[day];
        return (clanWarOwnValue(budget?.memberUses, npc.id) ?? 0) >= CLAN_WAR_RULES.memberSlotsPerDay;
    };
    let joins = 0;
    let refusals = 0;
    const answered = new Map<string, number>();
    for (const entry of c.queue.filter((e) => e.clan === npcClan)) {
        const k = `${entry.mode}:${entry.scope}:${entry.windowIndex ?? ''}`;
        answered.set(k, (answered.get(k) ?? 0) + 1);
    }
    for (const waiting of [...enemyEntries].sort((a, b) => a.joinedAt - b.joinedAt)) {
        if (joins >= MAX_JOINS_PER_TICK) break;
        const k = `${waiting.mode}:${waiting.scope}:${waiting.windowIndex ?? ''}`;
        if ((answered.get(k) ?? 0) > 0) { answered.set(k, answered.get(k)! - 1); continue; }
        const shrineSlot = waiting.scope === 'shrine';
        const pool = shrineSlot
            // At the shrine only its holders answer: they are the ones standing inside.
            ? postedHere().filter(([, post]) => post.windowIndex === waiting.windowIndex).map(([id]) => byId.get(id)!).filter(Boolean)
                .filter((npc) => !clanShrinePresenceError(npc.name, war, waiting.windowIndex!, now))
            : rotation(`${war.id}:${window}:${waiting.mode}`).filter((npc) => !state.posts[npc.id]);
        for (const npc of pool) {
            if (refusals >= MAX_REFUSALS_PER_TICK) break;
            if (slotsSpent(npc, waiting) || !(await free(npc))) continue;
            const reply = await d.queue(npc, { action: 'join', warId: war.id, mode: waiting.mode, scope: waiting.scope,
                ...(waiting.windowIndex !== undefined ? { windowIndex: waiting.windowIndex } : {}) });
            const ok = reply.status === 200;
            report.joined.push({ npc: npc.id, warId: war.id, mode: waiting.mode, scope: waiting.scope, ok, ...(ok ? {} : { error: String(reply.body.error ?? '') }) });
            if (ok) { joins++; engaged.add(npc.id); state.busy[npc.id] = now + BUSY_MS; break; }
            refusals++;
            freeCache.set(npc.id, false); // no longer eligible: try the next
        }
    }
}

/**
 * Keeps every shrine holder's visit alive (a visit lapses after the offline
 * window without a step or a poll): `shrine-state` while it holds one,
 * `shrine-enter` once it stands in the sector without one (just arrived, or
 * back from a fight). A holder mid-fight keeps its visit through the battle.
 */
export async function keepNpcClanShrineHolders(opts: { now?: number; queue?: NpcClanWarDeps['queue']; state?: NpcClanWarState } = {}): Promise<NpcClanWarReport['shrine']> {
    if (process.env.DISABLE_NPC_VILLAGE === '1' || !playerSessionsEnabled()) return [];
    const now = opts.now ?? Date.now();
    const queue = opts.queue ?? ((npc: NpcShinobi, body: Record<string, unknown>) => asNpcOn('queue', npc, body));
    const state = opts.state ?? await readNpcClanWarState();
    const out: NpcClanWarReport['shrine'] = [];
    const wars = new Map<string, ClanWar | null>();
    for (const [id, post] of Object.entries(state.posts)) {
        if (!(post.until > now)) continue;
        const npc = NPC_VILLAGE_ROSTER.find((entry) => entry.id === id);
        if (!npc || await isNpcPossessed(npc.id, now)) continue;
        if (!wars.has(post.warId)) wars.set(post.warId, await kv.get<ClanWar>(`clan-war:${post.warId}`));
        const war = wars.get(post.warId);
        const window = war?.campaign?.shrines.find((entry) => entry.index === post.windowIndex);
        if (!war || war.endedAt || !window || now < window.opensAt || now >= window.closesAt) continue;
        if (!standingIn(npc, post.sector)) continue;
        const holding = !clanShrinePresenceError(npc.name, war, post.windowIndex, now);
        const action = holding ? 'shrine-state' : 'shrine-enter';
        const reply = await queue(npc, { action, warId: war.id, scope: 'shrine', windowIndex: post.windowIndex }).catch(() => ({ status: 500, body: {} }));
        out.push({ npc: id, action, ok: reply.status === 200 });
    }
    return out;
}

// --- The Chronicle Showdown seat -------------------------------------------
// The NPC joins second (seat p2, the seat the hard Chronicle AI plays) once the
// player has opened the duel, then plays its turns through the real clan-war
// card route, exactly as the war card seat does (api/_npc-card-duel-driver.ts).
/** The registry the NPC busy checks read too (api/_npc-duel.ts owns the name). */
export const NPC_CLAN_CARD_DUEL_ACTIVE_KEY = NPC_CLAN_CARD_DUEL_REGISTRY_KEY;
export type NpcClanCardDuelEntry = { npc: string; warId: string; at: number };
type ClanCardSession = { status: 'awaiting-p2' | 'active' | 'done'; p1Name: string; p2Name?: string; state?: ChronicleMatch; createdAt?: number };

/**
 * Whether any NPC clan-war card duel is registered, kept in memory so the 1 s
 * card seat reads storage only while one is (null: not known yet, so the first
 * sweep after a start reads the registry once). This one process is the only
 * writer of the registry.
 */
let cardDuelsLive: boolean | null = null;
export function resetNpcClanCardDuelFlagForTest(): void { cardDuelsLive = null; }

export async function liveNpcClanCardDuels(): Promise<Record<string, NpcClanCardDuelEntry>> {
    const live = (await kv.get<Record<string, NpcClanCardDuelEntry>>(NPC_CLAN_CARD_DUEL_ACTIVE_KEY)) ?? {};
    cardDuelsLive = Object.keys(live).length > 0;
    return live;
}
export async function registerNpcClanCardDuel(challengeId: string, entry: NpcClanCardDuelEntry): Promise<void> {
    await withKvLock(NPC_CLAN_CARD_DUEL_ACTIVE_KEY, async () => {
        const live = await liveNpcClanCardDuels();
        if (live[challengeId]) return;
        await kv.set(NPC_CLAN_CARD_DUEL_ACTIVE_KEY, { ...live, [challengeId]: entry });
        cardDuelsLive = true;
    }, { failClosed: true });
}
async function forgetNpcClanCardDuel(challengeId: string): Promise<void> {
    await withKvLock(NPC_CLAN_CARD_DUEL_ACTIVE_KEY, async () => {
        const live = await liveNpcClanCardDuels();
        if (!(challengeId in live)) return;
        delete live[challengeId];
        await kv.set(NPC_CLAN_CARD_DUEL_ACTIVE_KEY, live);
        cardDuelsLive = Object.keys(live).length > 0;
    }, { failClosed: true });
}

const MAX_CARD_ACTIONS_PER_DRIVE = 24;
let cardBeatMs = 450;
/** The seat's human pace (api/_npc-card-duel-driver.ts): 0 in tests, with the beat. */
let cardThinkScale = 1;
const CARD_DRIVE_BUDGET_MS = 20_000;
export function setNpcClanCardBeatForTest(ms: number): void { cardBeatMs = Math.max(0, ms); cardThinkScale = ms > 0 ? 1 : 0; }
const SAFE_STEPS: ChronicleActionIntent[] = [{ action: 'pass-response' }, { action: 'advance-phase' }, { action: 'enter-end-phase' }, { action: 'end-turn' }];
const cardDriving = new Map<string, Promise<'idle' | 'acted' | 'finished' | 'gone'>>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One pass over a clan-war card duel an NPC is matched in. Never drives one duel twice at once. */
export async function driveNpcClanCardDuel(challengeId: string, entry: NpcClanCardDuelEntry): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    const inFlight = cardDriving.get(challengeId);
    if (inFlight) { await inFlight.catch(() => undefined); return 'idle'; }
    const run = (async (): Promise<'idle' | 'acted' | 'finished' | 'gone'> => {
        // One read decides whether there is work before the lease is taken, so
        // a sweep that finds the NPC reading the board or waiting on the
        // player writes nothing (the war card seat's rule).
        const seen = await kv.get<ClanCardSession>(`cw-tilecards:${challengeId}`).catch((error) => { console.error('[npc-clan-war] card seat', challengeId, String(error)); return undefined; });
        if (seen === undefined) return 'idle';
        if (!seen) {
            // Waiting for the player to open it: only a match that ended without a duel is work (letting it go).
            const war = await kv.get<ClanWar>(`clan-war:${entry.warId}`).catch(() => undefined);
            if (war === undefined) return 'idle';
            const match = war?.campaign?.matches[challengeId];
            if (match && match.status === 'active') return 'idle';
        } else if (!npcClanCardHasWork(challengeId, entry, seen, Date.now())) return 'idle';
        if (NPC_VILLAGE_ROSTER.some((n) => n.id === entry.npc) && await isNpcPossessed(entry.npc)) return 'idle'; // the admin plays this seat
        // Across processes too (a deploy overlap): one seat per duel.
        return withNpcSeatLease(`npc-clan-card:lease:${challengeId}`, 'idle' as const, (lease) => driveCardOnce(challengeId, entry, lease));
    })();
    cardDriving.set(challengeId, run);
    try { return await run; } finally { cardDriving.delete(challengeId); }
}

/** Whether a clan-war card duel row gives the NPC seat anything to do now (the checks driveCardOnce acts on). */
function npcClanCardHasWork(challengeId: string, entry: NpcClanCardDuelEntry, duel: ClanCardSession, now: number): boolean {
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === entry.npc);
    if (!npc) return true; // forget it
    if (duel.status === 'done') return true; // settle it
    if (duel.status === 'awaiting-p2') {
        if (safeName(duel.p1Name) === npc.id) return false;
        return npcCardJoinAt(challengeId, Number(duel.createdAt) || Number(entry.at) || now, undefined, cardThinkScale) <= now;
    }
    const state = duel.state;
    if (!state) return false;
    if (advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) return true; // a lapsed clock to pass
    if (safeName(duel.p2Name ?? '') !== npc.id) return false;
    const window = state.responseWindow;
    if (window ? window.responder !== 'p2' : state.activePlayer !== 'p2') return false; // the player's move
    return npcChronicleReadyAt(challengeId, state, 'p2', cardThinkScale) <= now;
}

async function driveCardOnce(challengeId: string, entry: NpcClanCardDuelEntry, lease: NpcSeatLease): Promise<'idle' | 'acted' | 'finished' | 'gone'> {
    try {
        const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === entry.npc);
        if (!npc) { await forgetNpcClanCardDuel(challengeId); return 'gone'; }
        if (await isNpcPossessed(npc.id)) return 'idle'; // the admin plays this seat
        const base = { warId: entry.warId, challengeId };
        const read = () => kv.get<ClanCardSession>(`cw-tilecards:${challengeId}`);
        let duel = await read();
        if (!duel) {
            // Waiting for the player to open it; a match that ended without a duel lets go.
            // (Only then is the whole war row read: a sweep over a duel in play never reads it.)
            const war = await kv.get<ClanWar>(`clan-war:${entry.warId}`);
            const match = war?.campaign?.matches[challengeId];
            if (!match || match.status !== 'active') { await forgetNpcClanCardDuel(challengeId); return 'gone'; }
            return 'idle';
        }
        if (duel.status === 'done') {
            // One read settles the duel's own Chronicle Points even if the player left.
            await asNpcOn('tilecards', npc, { ...base, action: 'state' }).catch(() => undefined);
            await forgetNpcClanCardDuel(challengeId);
            return 'finished';
        }
        if (duel.status === 'awaiting-p2') {
            if (safeName(duel.p1Name) === npc.id) return 'idle';
            // A player takes a few seconds to sit down at the table.
            if (npcCardJoinAt(challengeId, Number(duel.createdAt) || Number(entry.at) || Date.now(), undefined, cardThinkScale) > Date.now()) return 'idle';
            // An empty request resolves the NPC's own saved 40-card deck.
            const joined = await asNpcOn('tilecards', npc, { ...base, action: 'join', deck: [] });
            if (joined.status !== 200) console.warn('[npc-clan-war] card join refused', challengeId, joined.status, JSON.stringify(joined.body).slice(0, 160));
            return 'acted';
        }
        if (safeName(duel.p2Name ?? '') !== npc.id) {
            // Seated first by hand (an admin): the server cannot play seat p1, it only keeps the clock.
            const state = duel.state;
            if (state && advanceExpiredChronicleTurn(state, Date.now(), { catchUp: true }) !== state) {
                await asNpcOn('tilecards', npc, { ...base, action: 'state' });
                return 'acted';
            }
            return 'idle';
        }
        let acted = false;
        const started = Date.now();
        for (let step = 0; step < MAX_CARD_ACTIONS_PER_DRIVE; step++) {
            const state = duel?.state;
            if (!duel || duel.status !== 'active' || !state) break;
            const now = Date.now();
            if (advanceExpiredChronicleTurn(state, now, { catchUp: true }) !== state) {
                await asNpcOn('tilecards', npc, { ...base, action: 'state' });
                acted = true;
                break;
            }
            // Reading the board, or weighing a response: the 1 s sweep comes back.
            if (npcChronicleReadyAt(challengeId, state, 'p2', cardThinkScale) > now || now - started > CARD_DRIVE_BUDGET_MS || !await lease.keep()) break;
            const candidates = chooseAiIntents(state, 'hard');
            if (!candidates) break; // the player's move
            const legal = [...candidates, ...SAFE_STEPS].find((intent) => applyAction(state, 'p2', intent, now).ok);
            if (!legal) break;
            if (acted && cardBeatMs) await sleep(npcCardBeatMs(cardBeatMs));
            const reply = await asNpcOn('tilecards', npc, { ...base, ...legal });
            acted = true;
            if (reply.status !== 200) break;
            duel = await read();
        }
        return acted ? 'acted' : 'idle';
    } catch (error) {
        console.error('[npc-clan-war] card seat', challengeId, String(error));
        return 'idle';
    }
}

/** One sweep: every clan-war card duel an NPC is matched in, side by side. */
export async function sweepNpcClanCardDuels(): Promise<number> {
    if (cardDuelsLive === false) return 0; // nothing registered: no read every second
    const live = await liveNpcClanCardDuels();
    const results = await Promise.all(Object.entries(live)
        .filter(([challengeId]) => !cardDriving.has(challengeId))
        .map(([challengeId, entry]) => driveNpcClanCardDuel(challengeId, entry)));
    return results.filter((result) => result === 'finished').length;
}

function logSkip(scope: string, err: unknown): void {
    console.error(`[npc-clan-war] ${scope} skipped this tick:`, (err as Error)?.message ?? err);
}

let mainTimer: ReturnType<typeof setInterval> | null = null;
let shrineTimer: ReturnType<typeof setInterval> | null = null;
let cardTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let shrineTicking = false;
/** Starts the clan-war tick, the shrine keeper and the card seat (idempotent). DISABLE_NPC_VILLAGE=1 keeps all off. */
export function startNpcClanWarCampaign(): void {
    if (mainTimer || process.env.DISABLE_NPC_VILLAGE === '1') return;
    mainTimer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void runNpcClanWarCampaign().catch(() => undefined).finally(() => { ticking = false; });
    }, NPC_CLAN_WAR_TICK_MS);
    mainTimer.unref?.();
    shrineTimer = setInterval(() => {
        if (shrineTicking || ticking) return;
        shrineTicking = true;
        void keepNpcClanShrineHolders().catch(() => undefined).finally(() => { shrineTicking = false; });
    }, NPC_CLAN_SHRINE_TICK_MS);
    shrineTimer.unref?.();
    cardTimer = setInterval(() => { void sweepNpcClanCardDuels().catch(() => undefined); }, 1000);
    cardTimer.unref?.();
}
export function stopNpcClanWarCampaign(): void {
    for (const timer of [mainTimer, shrineTimer, cardTimer]) if (timer) clearInterval(timer);
    mainTimer = null; shrineTimer = null; cardTimer = null;
}

/**
 * Cinderhold's aggression meter (2026-11-08): how hostile the NPC village is
 * toward each player village, 0-100. Tracked and shown now; nothing acts on it
 * until the village-war phase. Fed today by PvP wins over an admin-controlled
 * NPC (api/pvp/claim-rewards.ts → noteNpcDefeat); the NPC AI fights add more.
 *
 * Gains come from beating Cinderhold shinobi. Farming is capped three ways: the
 * same player against the same NPC counts once per 6 h, one player adds at most
 * +5 a day, and one village gains at most +10 a day. After 24 h with no gain the
 * meter cools by 2 a day.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { PLAYER_VILLAGES, type PlayerVillage } from '../shared/npc-village.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount, type NpcRank } from '../shared/npc-village-roster.js';
import { safeName } from './_utils.js';

export const NPC_AGGRESSION_KEY = 'npc-village:aggression';
export const NPC_AGGRESSION_MAX = 100;
export const NPC_AGGRESSION_PAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const NPC_AGGRESSION_PLAYER_DAILY_CAP = 5;
export const NPC_AGGRESSION_VILLAGE_DAILY_CAP = 10;
export const NPC_AGGRESSION_DECAY_PER_DAY = 2;
export const NPC_AGGRESSION_QUIET_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AggressionBand = 'peaceful' | 'watchful' | 'hostile' | 'war-ready';
export type NpcAggressionState = {
    byVillage: Record<PlayerVillage, number>;
    /** Last time each village gained (drives the quiet-period decay). */
    lastGainAt: Partial<Record<PlayerVillage, number>>;
    /** UTC day the daily counters below belong to. */
    day: string;
    villageToday: Partial<Record<PlayerVillage, number>>;
    playerToday: Record<string, number>;
    /** `${player}|${npc}` -> last counted time, pruned past the cooldown. */
    pairs: Record<string, number>;
    lastDecayDay?: string;
};

export function aggressionBand(value: number): AggressionBand {
    return value >= 75 ? 'war-ready' : value >= 50 ? 'hostile' : value >= 25 ? 'watchful' : 'peaceful';
}

export function aggressionGainFor(rank: NpcRank): number {
    return rank === 'kage' ? 5 : rank === 'commander' || rank === 'elite' ? 2 : 1;
}

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export function emptyAggression(now: number): NpcAggressionState {
    return {
        byVillage: Object.fromEntries(PLAYER_VILLAGES.map((v) => [v, 0])) as Record<PlayerVillage, number>,
        lastGainAt: {}, day: utcDay(now), villageToday: {}, playerToday: {}, pairs: {},
    };
}

function rollDay(state: NpcAggressionState, now: number): NpcAggressionState {
    const day = utcDay(now);
    const pairs = Object.fromEntries(Object.entries(state.pairs).filter(([, at]) => now - at < NPC_AGGRESSION_PAIR_COOLDOWN_MS));
    return state.day === day ? { ...state, pairs } : { ...state, day, villageToday: {}, playerToday: {}, pairs };
}

export type AggressionWin = { village: string; player: string; npcId: string; npcRank: NpcRank; now: number };
export type AggressionResult = { state: NpcAggressionState; gained: number; reason?: 'not-a-player-village' | 'pair-cooldown' | 'player-cap' | 'village-cap' | 'max' };

/** Pure: apply one player's win over a Cinderhold NPC. */
export function applyAggressionWin(prior: NpcAggressionState, win: AggressionWin): AggressionResult {
    const state = rollDay(prior, win.now);
    const village = PLAYER_VILLAGES.find((v) => v === win.village);
    if (!village) return { state, gained: 0, reason: 'not-a-player-village' };
    const player = win.player.trim().toLowerCase();
    const pair = `${player}|${win.npcId}`;
    if (win.now - (state.pairs[pair] ?? -Infinity) < NPC_AGGRESSION_PAIR_COOLDOWN_MS) return { state, gained: 0, reason: 'pair-cooldown' };
    const playerLeft = NPC_AGGRESSION_PLAYER_DAILY_CAP - (state.playerToday[player] ?? 0);
    if (playerLeft <= 0) return { state, gained: 0, reason: 'player-cap' };
    const villageLeft = NPC_AGGRESSION_VILLAGE_DAILY_CAP - (state.villageToday[village] ?? 0);
    if (villageLeft <= 0) return { state, gained: 0, reason: 'village-cap' };
    const current = state.byVillage[village] ?? 0;
    const gained = Math.min(aggressionGainFor(win.npcRank), playerLeft, villageLeft, NPC_AGGRESSION_MAX - current);
    if (gained <= 0) return { state, gained: 0, reason: 'max' };
    return {
        gained,
        state: {
            ...state,
            byVillage: { ...state.byVillage, [village]: current + gained },
            lastGainAt: { ...state.lastGainAt, [village]: win.now },
            villageToday: { ...state.villageToday, [village]: (state.villageToday[village] ?? 0) + gained },
            playerToday: { ...state.playerToday, [player]: (state.playerToday[player] ?? 0) + gained },
            pairs: { ...state.pairs, [pair]: win.now },
        },
    };
}

/** Pure: once per UTC day, cool every village that has been quiet for 24 h. */
export function decayAggression(prior: NpcAggressionState, now: number): NpcAggressionState {
    const state = rollDay(prior, now);
    if (state.lastDecayDay === state.day) return state;
    const byVillage = { ...state.byVillage };
    for (const village of PLAYER_VILLAGES) {
        const quiet = now - (state.lastGainAt[village] ?? 0) >= NPC_AGGRESSION_QUIET_MS;
        if (quiet) byVillage[village] = Math.max(0, (byVillage[village] ?? 0) - NPC_AGGRESSION_DECAY_PER_DAY);
    }
    return { ...state, byVillage, lastDecayDay: state.day };
}

export async function readNpcAggression(now = Date.now()): Promise<NpcAggressionState> {
    const row = await kv.get<NpcAggressionState>(NPC_AGGRESSION_KEY);
    return row?.byVillage ? row : emptyAggression(now);
}

/** Records a win under the shared-resource lock (fails closed). */
export async function recordNpcAggressionWin(win: AggressionWin): Promise<AggressionResult> {
    return withKvLock(NPC_AGGRESSION_KEY, async () => {
        const result = applyAggressionWin(await readNpcAggression(win.now), win);
        await kv.set(NPC_AGGRESSION_KEY, result.state);
        return result;
    }, { failClosed: true });
}

/**
 * A settled fight a player won against a Cinderhold shinobi (today: PvP against
 * an admin-controlled NPC). Takes the shared aggression lock, so callers must
 * hold no save lock: run it after settlement, best-effort. NPC-vs-NPC and
 * player-vs-player results are ignored; a non-player village gains nothing.
 */
export async function noteNpcDefeat(winnerName: string, winnerVillage: string, loserName: string, now = Date.now()): Promise<AggressionResult | null> {
    const npc = NPC_VILLAGE_ROSTER.find((entry) => entry.id === safeName(loserName));
    if (!npc || isNpcAccount(winnerName)) return null;
    return recordNpcAggressionWin({ village: winnerVillage, player: safeName(winnerName), npcId: npc.id, npcRank: npc.rank, now });
}

/** Daily-pass step. */
export async function decayNpcAggression(now = Date.now()): Promise<NpcAggressionState> {
    return withKvLock(NPC_AGGRESSION_KEY, async () => {
        const next = decayAggression(await readNpcAggression(now), now);
        await kv.set(NPC_AGGRESSION_KEY, next);
        return next;
    }, { failClosed: true });
}

/** Public view: just the meter and band per village. */
export function aggressionView(state: NpcAggressionState) {
    return PLAYER_VILLAGES.map((village) => ({ village, value: state.byVillage[village] ?? 0, band: aggressionBand(state.byVillage[village] ?? 0) }));
}

export const __testing = { utcDay, DAY_MS };

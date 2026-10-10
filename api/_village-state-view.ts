/*
 * Who may read which part of a village's shared record, `game:village-state:<slug>`.
 *
 * Owner ruling 2026-10-08: a village's internals are for its MEMBERS. The
 * /api/game-state frame is public: it needs no login and Cloudflare caches it.
 * It used to carry this whole record for every village, so anyone could read
 * any village's treasury and Village Stores, its upgrade levels, its orders
 * board (raid targets included), its activity log of who donated or was gifted
 * what, and the settlement journals behind them.
 *
 * Now the frame carries only what anyone may know: the village's war history,
 * whether its Hollow Gate stands open, and its war-morale stamps (which
 * /api/village/war-debuff already serves to everyone). api/game-state.ts adds
 * the leadership on top, from its own authoritative rows. The members-only part
 * is served by GET /api/village/state, to that village's members. The
 * settlement journals go to nobody: they are server bookkeeping.
 *
 * Both lists are ALLOWLISTS, so a field added to the record later stays out of
 * both until someone decides where it belongs.
 */
import { leadershipVillageKey } from '../shared/village-anbu.js';

/** What the public frame carries from the record. */
export const PUBLIC_VILLAGE_STATE_FIELDS = Object.freeze([
    'warRecords', 'kageHistory', 'hollowGateUnlockedUntil', 'warLossDebuffUntil', 'warWinBuffUntil',
] as const);

/** What only the village's members read (GET /api/village/state). */
export const MEMBER_VILLAGE_STATE_FIELDS = Object.freeze([
    'treasury', 'upgrades', 'contributionPoints', 'notices', 'noticePosts', 'dailyAgenda',
] as const);

export function villageStateKey(village: string): string {
    return `game:village-state:${leadershipVillageKey(village)}`;
}

type StoredVillageState = Record<string, unknown> | null | undefined;

/** The record as the public frame shows it. A field the record lacks is absent. */
export function publicVillageStateView(row: StoredVillageState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of PUBLIC_VILLAGE_STATE_FIELDS) {
        if (row && row[field] !== undefined) out[field] = row[field];
    }
    return out;
}

/**
 * The record as its members see it. Every member field is present, null where
 * the record has none, so a client always replaces what it held before: a
 * field cleared on the server must not survive in the client's copy.
 */
export function memberVillageStateView(row: StoredVillageState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of MEMBER_VILLAGE_STATE_FIELDS) out[field] = row?.[field] ?? null;
    return out;
}

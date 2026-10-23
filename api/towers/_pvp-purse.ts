/*
 * Team Arena and tournament purse (2026-10 economy rebalance, owner amendment
 * A7): a won public Team Arena match or tournament match pays each winning
 * member 0.5 x A(L) per active minute (api/_activity-purse.ts).
 *
 * settleTowerPvpMatch stays a bare acknowledgement that writes no save; the
 * two route surfaces that own these bindings (api/towers/pvp-settle.ts and
 * api/tournaments/event.ts) call this after it. Clan-war and ranked 2v2
 * matches keep their own settlement and pay nothing here.
 *
 * A PvP purse can be farmed by two parties trading wins, so it keeps the
 * PvP valid-fight rules (api/pvp/_valid-fight.ts, owner amendment A4), each
 * read through the same dials:
 *   - every member is paid at the LOWEST fighter's level, so an alt pays alt money;
 *   - a winner more than 20 levels above the strongest opponent is paid nothing;
 *   - an opponent account younger than the PvP age floor pays nothing;
 *   - under 3 completed rounds or 60 s a fight pays half, or nothing when the
 *     losing side forfeited or went AFK; a match with no completed round pays nothing;
 *   - the same group of fighters is weighted 1 / 1 / 0.5 / 0.25 / 0 across a
 *     UTC day.
 * Win-only: the losing side is paid nothing, so a colluding group earns at
 * most one side's purse per match.
 */
import { createHash } from 'node:crypto';
import { towerPvpBindingOf } from '../../shared/tower-pvp.js';
import { kv as realKv, type KvLike } from '../_storage.js';
import { activityPurseMinutes, creditActivityPurse, type ActivityPurseCredit, type ActivityPurseResult } from '../_activity-purse.js';
import { PVP_CREDIT_LEVEL_GAP_MAX } from '../pvp/_pvp-anti-alt.js';
import {
    assignPvpCreditSlot,
    pvpAccountOldEnough,
    pvpMinFightMs,
    pvpMinRounds,
    pvpPairWeight,
    pvpShortFightMult,
    pvpUtcDay,
} from '../pvp/_valid-fight.js';
import type { StoredTowerPvpMatch } from './_pvp-session.js';

export type TowerPvpPurse = Omit<ActivityPurseCredit, 'reason'> & {
    reason?: ActivityPurseResult['reason'] | 'not-done' | 'not-a-winner' | 'draw' | 'not-a-member'
        | 'too-young' | 'level-gap' | 'no-terminal-time';
};

type PurseStore = Pick<KvLike, 'get' | 'set' | 'incr'>;

/** Day counter for one group of fighters, unordered. */
export function towerPvpGroupCounterKey(slugs: readonly string[], day: string): string {
    const group = createHash('sha256').update([...slugs].sort().join('\u0000')).digest('hex').slice(0, 32);
    return `towerpvp:purse-group:${group}:${day}`;
}
export const towerPvpGroupSlotKey = (matchId: string): string => `towerpvp:purse-slot:${matchId}`;

function opponentForfeited(match: StoredTowerPvpMatch, loserSlugs: readonly string[]): boolean {
    const strikesToForfeit = Number(match.rules.afkStrikesToForfeit) || 2;
    if (loserSlugs.some((slug) => Number(match.afkStrikes?.[slug] ?? 0) >= strikesToForfeit)) return true;
    const loserNames = match.combat.actors
        .filter((actor) => actor.ownerSlug && loserSlugs.includes(actor.ownerSlug))
        .map((actor) => actor.name);
    return match.combat.log.some((line) => loserNames.some((name) => line.startsWith(`${name} forfeits`)));
}

/**
 * The route reply for a settled purse: the purse itself, plus the payee's
 * save when the credit read or wrote it, so the fight screen adopts the new
 * balance (BattleTowerFight adopts a custom settle's `character`).
 */
export function towerPvpPurseReply(purse: TowerPvpPurse | null): Record<string, unknown> {
    if (!purse) return {};
    const { save, ...view } = purse;
    return { purse: view, ...(save ? { character: save.character, _saveVersion: save._saveVersion } : {}) };
}

/**
 * Settle one member's purse for one terminal match. Returns null for a
 * binding that pays no purse. Idempotent: the credit is receipted in the save,
 * and the group slot is assigned once per match, so a retry of the settle
 * route answers with the same purse.
 */
export async function settleTowerPvpPurse(
    match: StoredTowerPvpMatch,
    slug: string,
    deps: { store?: PurseStore } = {},
): Promise<TowerPvpPurse | null> {
    const kind = towerPvpBindingOf(match).kind;
    const mode = kind === 'public-queue' ? 'arena' : kind === 'tournament' ? 'tournament' : null;
    if (!mode) return null;
    const store = deps.store ?? realKv;
    const member = match.roster.find((entry) => entry.slug === slug);
    if (!member) return { ryo: 0, minutes: 0, reason: 'not-a-member' };
    if (match.status !== 'done') return { ryo: 0, minutes: 0, reason: 'not-done' };
    if (match.winner !== 'amber' && match.winner !== 'violet') return { ryo: 0, minutes: 0, reason: 'draw' };
    const endedAt = Number(match.combat.terminalAt);
    const minutes = activityPurseMinutes(match.createdAt, endedAt);
    if (member.teamId !== match.winner) return { ryo: 0, minutes, reason: 'not-a-winner' };
    if (!(endedAt > 0)) return { ryo: 0, minutes: 0, reason: 'no-terminal-time' };

    const slugs = match.roster.map((entry) => entry.slug);
    const loserSlugs = match.roster.filter((entry) => entry.teamId !== match.winner).map((entry) => entry.slug);
    const chars = await Promise.all(slugs.map(async (name) => {
        const save = await store.get<{ character?: Record<string, unknown> }>(`save:${name}`).catch(() => null);
        return [name, save?.character ?? null] as const;
    }));
    const levelOf = (name: string) => {
        const level = Number(chars.find(([entry]) => entry === name)?.[1]?.level);
        return Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
    };
    // Every opponent must be established: past the age floor or at L20 (a missing createdAt passes).
    for (const [name, char] of chars) {
        if (loserSlugs.includes(name) && !pvpAccountOldEnough(char?.createdAt, endedAt, levelOf(name))) {
            return { ryo: 0, minutes, reason: 'too-young' };
        }
    }
    const strongestOpponent = Math.max(...loserSlugs.map(levelOf));
    if (levelOf(slug) - strongestOpponent > PVP_CREDIT_LEVEL_GAP_MAX) return { ryo: 0, minutes, reason: 'level-gap' };

    const completedRounds = Math.max(0, Math.floor(Number(match.combat.round) || 0) - 1);
    const short = completedRounds < pvpMinRounds() || endedAt - match.createdAt < pvpMinFightMs();
    // A match with no completed round was never fought (a tournament pairing
    // that timed out unreadied is adjudicated, not won), so it pays nothing.
    const shortMult = completedRounds === 0 ? 0
        : !short ? 1
            : opponentForfeited(match, loserSlugs) ? 0 : pvpShortFightMult();
    const ordinal = shortMult > 0
        ? await assignPvpCreditSlot(store, {
            slotKey: towerPvpGroupSlotKey(match.matchId),
            counterKey: towerPvpGroupCounterKey(slugs, pvpUtcDay(endedAt)),
        })
        : 1;
    return creditActivityPurse({
        mode,
        playerSlug: slug,
        outcomeId: match.matchId,
        startedAt: match.createdAt,
        minutes,
        factor: shortMult * pvpPairWeight(ordinal),
        level: Math.min(...slugs.map(levelOf)),
    });
}

/*
 * Clan War shinobi 2v2 — match creation.
 *
 * The engine is the SAME four-player Tower MPvP lifecycle that powers the public
 * Team Arena (api/towers/_pvp-session.ts). Only two things differ, and both are
 * expressed through the match's `binding`:
 *
 *   1. Teams are FIXED by clan — challengers on amber, defenders on violet —
 *      instead of skill-balanced. The split is a fact of the challenge.
 *   2. The terminal winner is consumed by _mpvp-settlement.ts, which applies the
 *      war HP. Nothing in this file or in any api/towers/_pvp-* module writes a
 *      reward; that isolation is asserted by _pvp-contract.test.ts and is what
 *      keeps "Tower Team Arena pays nothing" structurally true.
 *
 * Creation is idempotent for all four players: the first caller to win the
 * challenge-scoped lock mints the match and publishes a challenge→match index;
 * every later caller (including a retry after a lost response) resolves that
 * index and receives the same match.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { safeName } from '../../_utils.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases } from '../../towers/_battle-lease.js';
import {
    createTowerPvpMatch,
    TOWER_PVP_ID,
    type StoredTowerPvpMatch,
    type TowerPvpFighterSeed,
} from '../../towers/_pvp-session.js';
import { loadTowerPvpFighter, readTowerPvpMatch, writeTowerPvpMatch } from '../../towers/_pvp-store.js';
import { CLAN_WAR_KEY_PREFIX, type ClanChallenge, type ClanWar } from './_storage.js';

/** Challenge → published match. Outlives the match so re-entry always converges. */
export const clanWar2v2IndexKey = (challengeId: string) => `clan-war:mpvp:${challengeId}`;
const INDEX_TTL_SECONDS = 24 * 60 * 60;

export type ClanWar2v2Start =
    | { ok: true; match: StoredTowerPvpMatch; replayed: boolean }
    | { ok: false; status: number; code: string; error: string };

export type ClanWar2v2Sides = {
    /** Challenging clan's pair; maps to the amber team. */
    from: [string, string];
    /** Defending clan's pair; maps to the violet team. */
    to: [string, string];
};

/**
 * Exactly the four accepted fighters, or null when the challenge is not a fully
 * crewed, accepted 2v2. Both queues must be full — a half-joined 2v2 has no
 * four-player match to publish.
 */
export function clanWar2v2Sides(challenge: ClanChallenge | undefined): ClanWar2v2Sides | null {
    if (!challenge || challenge.mode !== 'pvp2v2' || challenge.status !== 'accepted') return null;
    const from = [safeName(challenge.fromPlayer ?? ''), safeName(challenge.fromPlayer2 ?? '')];
    const to = [safeName(challenge.acceptedPlayer ?? ''), safeName(challenge.acceptedPlayer2 ?? '')];
    const all = [...from, ...to];
    if (all.some(slug => !slug)) return null;
    if (new Set(all).size !== 4) return null;
    return { from: [from[0]!, from[1]!], to: [to[0]!, to[1]!] };
}

function findChallenge(war: ClanWar, challengeId: string): ClanChallenge | undefined {
    return war.pendingChallenges.find(entry => entry.id === challengeId)
        ?? war.completedChallenges.find(entry => entry.id === challengeId);
}

async function loadPublishedMatch(challengeId: string): Promise<StoredTowerPvpMatch | null> {
    const matchId = await kv.get<string>(clanWar2v2IndexKey(challengeId));
    if (!matchId || !TOWER_PVP_ID.test(matchId)) return null;
    return readTowerPvpMatch(matchId);
}

/**
 * Publish (or re-resolve) the four-player match for an accepted 2v2 challenge.
 * Callable by any of the four members; the other three converge on the same
 * match without minting a second one.
 */
export async function startClanWar2v2Match(input: {
    warId: string;
    challengeId: string;
    actor: string;
}): Promise<ClanWar2v2Start> {
    const actor = safeName(input.actor);
    if (!actor) return { ok: false, status: 400, code: 'invalid-actor', error: 'Invalid player.' };

    const existing = await loadPublishedMatch(input.challengeId);
    if (existing) {
        return existing.roster.some(member => member.slug === actor)
            ? { ok: true, match: existing, replayed: true }
            : { ok: false, status: 403, code: 'not-a-member', error: 'You are not in that Clan War duel.' };
    }

    const war = await kv.get<ClanWar>(`${CLAN_WAR_KEY_PREFIX}${input.warId}`);
    if (!war || war.id !== input.warId) {
        return { ok: false, status: 404, code: 'war-not-found', error: 'That clan war no longer exists.' };
    }
    if (war.endedAt) return { ok: false, status: 409, code: 'war-ended', error: 'That clan war has ended.' };

    const challenge = findChallenge(war, input.challengeId);
    const sides = clanWar2v2Sides(challenge);
    if (!challenge || !sides) {
        return { ok: false, status: 409, code: 'challenge-not-ready', error: 'That 2v2 challenge is not fully accepted yet.' };
    }
    if (challenge.result) {
        return { ok: false, status: 409, code: 'challenge-settled', error: 'That 2v2 challenge already has a result.' };
    }
    const members = [...sides.from, ...sides.to];
    if (!members.includes(actor)) {
        return { ok: false, status: 403, code: 'not-a-member', error: 'You are not in that Clan War duel.' };
    }
    const toClan = war.clans.find(clan => clan !== challenge.fromClan);
    if (!toClan) return { ok: false, status: 409, code: 'war-invalid', error: 'That clan war is malformed.' };

    // One winner mints; the rest resolve the index it publishes.
    return withKvLock(clanWar2v2IndexKey(input.challengeId), async () => {
        const raced = await loadPublishedMatch(input.challengeId);
        if (raced) {
            return raced.roster.some(member => member.slug === actor)
                ? { ok: true as const, match: raced, replayed: true }
                : { ok: false as const, status: 403, code: 'not-a-member', error: 'You are not in that Clan War duel.' };
        }

        // Consumables ON. A clan-war duel is reward-bearing, so it must field
        // the same sealed per-fight item budget clan-war 1v1 gets on the PvP
        // engine. Only the open Team Arena, which settles no economy, fights
        // consumable-free.
        const seeds = await Promise.all(members.map(slug => loadTowerPvpFighter(slug, { consumables: true })));
        const missing = members.filter((_slug, index) => !seeds[index]);
        if (missing.length) {
            return {
                ok: false as const,
                status: 409,
                code: 'member-unavailable',
                error: 'A duellist no longer has an available save.',
            };
        }

        const matchId = `tpvp-${randomUUID().replaceAll('-', '')}`;
        if (!TOWER_PVP_ID.test(matchId)) throw new Error('Invalid generated Clan War 2v2 match ID.');
        const lease = await claimTowerBattleLeases({ runId: matchId, members, mode: 'clan-war-mpvp' });
        if (!lease.ok) {
            return {
                ok: false as const,
                status: 409,
                code: 'member-busy',
                error: 'A duellist is already in another active battle.',
            };
        }

        try {
            const match = createTowerPvpMatch({
                matchId,
                fighters: seeds as TowerPvpFighterSeed[],
                seed: randomInt(1, 0x7fff_ffff),
                now: Date.now(),
                teams: { amber: sides.from, violet: sides.to },
                binding: {
                    kind: 'clan-war',
                    warId: war.id,
                    challengeId: challenge.id,
                    fromClan: challenge.fromClan,
                    toClan,
                },
            });
            await writeTowerPvpMatch(match);
            // Index last: a crash before this point leaves an orphan match whose
            // leases are released below, never a challenge pointing at nothing.
            await kv.set(clanWar2v2IndexKey(challenge.id), matchId, { ex: INDEX_TTL_SECONDS });
            return { ok: true as const, match, replayed: false };
        } catch (error) {
            await releaseTowerBattleLeases(matchId, members).catch(() => undefined);
            throw error;
        }
    }, { failClosed: true });
}

/** Resolve an already-published match for polling/settlement callers. */
export async function readClanWar2v2Match(challengeId: string): Promise<StoredTowerPvpMatch | null> {
    return loadPublishedMatch(challengeId);
}

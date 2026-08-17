import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { CLAN_WAR_KEY_PREFIX, type ClanChallenge, type ClanWar } from '../clan/war/_storage.js';
import { pvpSessionPublicationTombstoneFor } from './_session-publication-tombstone.js';

const SAFE_ID = /^[A-Za-z0-9_-]{3,100}$/;
const RESERVATION_LEASE_MS = 30_000;

export type ClanWarPvpReservation = {
    warId: string;
    challengeId: string;
    battleId: string;
    p1: string;
    p2: string;
    reservedAt: number;
    owned: boolean;
};

export function clanWarPvpReportAuthorityError(
    challenge: Pick<ClanChallenge, 'mode' | 'battleId'>,
): string | null {
    const isPvp = challenge.mode === 'pvp1v1' || challenge.mode === 'pvp2v2';
    if (isPvp) return challenge.battleId
        ? 'Clan War PvP results are settled from the sealed battle session during reward claim.'
        : 'Clan War PvP results require a sealed battle session and cannot be client-reported.';
    return null;
}

function exactBinding(
    war: ClanWar | null,
    reservation: ClanWarPvpReservation,
): ClanChallenge | null {
    const challenge = war?.pendingChallenges.find((candidate) => candidate.id === reservation.challengeId) ?? null;
    if (!challenge
        || challenge.status !== 'accepted'
        || challenge.mode !== 'pvp1v1'
        || challenge.battleId !== reservation.battleId
        || challenge.pvpReservedAt !== reservation.reservedAt
        || safeName(challenge.fromPlayer) !== reservation.p1
        || safeName(challenge.acceptedPlayer ?? '') !== reservation.p2) return null;
    return challenge;
}

function validateChallenge(
    war: ClanWar | null,
    args: { warId: string; challengeId: string; creator: string; p1: string; p2: string },
): ClanChallenge | null {
    const challenge = war?.pendingChallenges.find((candidate) => candidate.id === args.challengeId) ?? null;
    const p1 = safeName(challenge?.fromPlayer ?? '');
    const p2 = safeName(challenge?.acceptedPlayer ?? '');
    const creator = safeName(args.creator);
    if (!war || war.id !== args.warId || war.endedAt
        || !challenge || challenge.status !== 'accepted' || challenge.mode !== 'pvp1v1'
        || !p1 || !p2 || (creator !== p1 && creator !== p2)
        || safeName(args.p1) !== p1 || safeName(args.p2) !== p2) return null;
    return challenge;
}

/** Bind the stable battle id inside the exact Clan War row it authorizes. */
export async function reserveClanWarPvpSession(args: {
    warId: string;
    challengeId: string;
    creator: string;
    p1: string;
    p2: string;
    battleId: string;
}): Promise<ClanWarPvpReservation | null> {
    if (!SAFE_ID.test(args.warId) || !SAFE_ID.test(args.challengeId) || !args.battleId.trim()) return null;
    const warKey = `${CLAN_WAR_KEY_PREFIX}${args.warId}`;
    return withKvLock(warKey, async () => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const war = await kv.get<ClanWar>(warKey);
            const challenge = validateChallenge(war, args);
            if (!war || !challenge) return null;
            const p1 = safeName(challenge.fromPlayer);
            const p2 = safeName(challenge.acceptedPlayer ?? '');
            if (challenge.battleId) {
                const existing: ClanWarPvpReservation = {
                    warId: args.warId,
                    challengeId: args.challengeId,
                    battleId: challenge.battleId,
                    p1,
                    p2,
                    reservedAt: Number(challenge.pvpReservedAt ?? 0),
                    owned: challenge.battleId === args.battleId,
                };
                if (challenge.battleId === args.battleId) {
                    if (!Number.isSafeInteger(existing.reservedAt) || existing.reservedAt <= 0) {
                        throw new Error('clan-war-pvp-reservation-invalid');
                    }
                    return existing;
                }
                const liveRow = await kv.get<unknown>(`pvp:${challenge.battleId}`);
                // A publication tombstone means the previous holder's battle
                // was rolled back, not that a session is live on that id — so
                // the expired reservation stays takeable.
                const live = pvpSessionPublicationTombstoneFor(liveRow, challenge.battleId) ? null : liveRow;
                if (live || !Number.isSafeInteger(existing.reservedAt)
                    || Date.now() - existing.reservedAt <= RESERVATION_LEASE_MS) {
                    return existing;
                }
            }
            const reservation: ClanWarPvpReservation = {
                warId: args.warId,
                challengeId: args.challengeId,
                battleId: args.battleId,
                p1,
                p2,
                reservedAt: Date.now(),
                owned: true,
            };
            const candidate: ClanWar = {
                ...war,
                pendingChallenges: war.pendingChallenges.map((entry) => entry.id === challenge.id
                    ? { ...entry, battleId: reservation.battleId, pvpReservedAt: reservation.reservedAt }
                    : entry),
                updatedAt: Math.max(Number(war.updatedAt) || 0, reservation.reservedAt),
            };
            try {
                if (await kv.compareSet(warKey, war, candidate)) return reservation;
            } catch (error) {
                const recovered = await kv.get<ClanWar>(warKey).catch(() => null);
                if (exactBinding(recovered, reservation)) return reservation;
                throw error;
            }
        }
        throw new Error('clan-war-pvp-reservation-busy');
    }, { failClosed: true });
}

/** Publication fence: a holder paused beyond its lease may not publish later. */
export async function requireClanWarPvpReservation(reservation: ClanWarPvpReservation): Promise<void> {
    const war = await kv.get<ClanWar>(`${CLAN_WAR_KEY_PREFIX}${reservation.warId}`);
    if (!exactBinding(war, reservation)) throw new Error('clan-war-pvp-reservation-lost');
}

/** Exact rollback; an old request cannot clear a successor's binding. */
export async function releaseClanWarPvpReservation(reservation: ClanWarPvpReservation): Promise<void> {
    if (!reservation.owned) return;
    const warKey = `${CLAN_WAR_KEY_PREFIX}${reservation.warId}`;
    await withKvLock(warKey, async () => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const war = await kv.get<ClanWar>(warKey);
            if (!war || !exactBinding(war, reservation)) return;
            const candidate: ClanWar = {
                ...war,
                pendingChallenges: war.pendingChallenges.map((entry) => entry.id === reservation.challengeId
                    ? { ...entry, battleId: undefined, pvpReservedAt: undefined }
                    : entry),
            };
            try {
                if (await kv.compareSet(warKey, war, candidate)) return;
            } catch (error) {
                const recovered = await kv.get<ClanWar>(warKey).catch(() => null);
                if (recovered && isDeepStrictEqual(recovered, candidate)) return;
                throw error;
            }
        }
        throw new Error('clan-war-pvp-release-busy');
    }, { failClosed: true });
}

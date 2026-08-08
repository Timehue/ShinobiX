import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { CLAN_WAR_KEY_PREFIX, type ClanChallenge, type ClanWar } from '../clan/war/_storage.js';

const PROOF_TTL_SECONDS = 24 * 60 * 60;
const SAFE_ID = /^[A-Za-z0-9_-]{3,100}$/;

export type ClanWarPvpReservation = {
    warId: string;
    challengeId: string;
    battleId: string;
    p1: string;
    p2: string;
    reservedAt: number;
    owned: boolean;
};

function proofKey(warId: string, challengeId: string): string {
    return `pvp:clan-war-proof:${warId}:${challengeId}`;
}

export function clanWarPvpReportAuthorityError(
    challenge: Pick<ClanChallenge, 'mode' | 'battleId'>,
): string | null {
    const isPvp = challenge.mode === 'pvp1v1' || challenge.mode === 'pvp2v2';
    if (isPvp && !challenge.battleId) {
        return 'Clan War PvP results require a sealed battle session before they can be reported.';
    }
    return null;
}

/**
 * Bind an accepted 1v1 clan-war challenge to exactly one random PvP session.
 * The war record (not a client flag) proves consent and membership. Concurrent
 * launch clicks converge on the first reserved battleId.
 */
export async function reserveClanWarPvpSession(args: {
    warId: string;
    challengeId: string;
    creator: string;
    p1: string;
    p2: string;
    battleId: string;
}): Promise<ClanWarPvpReservation | null> {
    if (!SAFE_ID.test(args.warId) || !SAFE_ID.test(args.challengeId)) return null;
    const warKey = `${CLAN_WAR_KEY_PREFIX}${args.warId}`;
    const key = proofKey(args.warId, args.challengeId);
    return withKvLock(warKey, async () => {
        const existing = await kv.get<Omit<ClanWarPvpReservation, 'owned'>>(key);
        if (existing) {
            const creator = safeName(args.creator);
            if ((creator !== existing.p1 && creator !== existing.p2)
                || safeName(args.p1) !== existing.p1
                || safeName(args.p2) !== existing.p2) return null;
            const liveSession = await kv.get(`pvp:${existing.battleId}`);
            if (liveSession || Date.now() - Number(existing.reservedAt ?? 0) < 15_000) {
                return { ...existing, owned: false };
            }
            // The creator crashed after reserving but before writing pvp:<id>.
            // Reclaim a stale reservation so the accepted duel is not wedged.
        }

        const war = await kv.get<ClanWar>(warKey);
        const challenge = war?.pendingChallenges.find((candidate) => candidate.id === args.challengeId);
        if (!war || war.id !== args.warId || !challenge || challenge.status !== 'accepted' || challenge.mode !== 'pvp1v1') return null;
        const p1 = safeName(challenge.fromPlayer);
        const p2 = safeName(challenge.acceptedPlayer ?? '');
        const creator = safeName(args.creator);
        if (!p1 || !p2 || (creator !== p1 && creator !== p2) || safeName(args.p1) !== p1 || safeName(args.p2) !== p2) return null;

        const sealed = { warId: args.warId, challengeId: args.challengeId, battleId: args.battleId, p1, p2, reservedAt: Date.now() };
        const nextWar: ClanWar = {
            ...war,
            pendingChallenges: war.pendingChallenges.map((candidate) => candidate.id === challenge.id
                ? { ...candidate, battleId: args.battleId }
                : candidate),
            updatedAt: Date.now(),
        };
        await Promise.all([
            kv.set(key, sealed, { ex: PROOF_TTL_SECONDS }),
            kv.set(warKey, nextWar),
        ]);
        return { ...sealed, owned: true };
    }, { failClosed: true });
}

export async function releaseClanWarPvpReservation(reservation: ClanWarPvpReservation): Promise<void> {
    if (!reservation.owned) return;
    const warKey = `${CLAN_WAR_KEY_PREFIX}${reservation.warId}`;
    const key = proofKey(reservation.warId, reservation.challengeId);
    await withKvLock(warKey, async () => {
        const existing = await kv.get<Omit<ClanWarPvpReservation, 'owned'>>(key);
        if (!existing || existing.battleId !== reservation.battleId) return;
        const war = await kv.get<ClanWar>(warKey);
        if (war) {
            await kv.set(warKey, {
                ...war,
                pendingChallenges: war.pendingChallenges.map((candidate) => candidate.id === reservation.challengeId && candidate.battleId === reservation.battleId
                    ? { ...candidate, battleId: undefined }
                    : candidate),
                updatedAt: Date.now(),
            });
        }
        await kv.del(key);
    });
}

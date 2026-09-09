import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';

export const PLAYER_CHALLENGE_MODES = [
    'standard',
    'ranked',
    'clanWar1v1',
    'clanWar2v2',
    'clanWarPet',
    'rankedPet',
] as const;

export type PlayerChallengeMode = (typeof PLAYER_CHALLENGE_MODES)[number];
export type ChallengeRecordStatus =
    | 'pending'
    | 'session-started'
    | 'accepted'
    | 'declined'
    | 'cancelled';

export type AuthoritativeChallengeRecord = {
    id: string;
    from: string;
    to: string;
    mode: PlayerChallengeMode;
    status: ChallengeRecordStatus;
    createdAt: number;
    challenge: Record<string, unknown>;
    battleId?: string;
    resolvedAt?: number;
};

const CHALLENGE_RECORD_TTL_SECONDS = 10 * 60;

export function challengeRecordKey(id: string): string {
    return `challenges:record:${id}`;
}

export function isChallengeId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length >= 8
        && value.length <= 80
        && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isPlayerChallengeMode(value: unknown): value is PlayerChallengeMode {
    return typeof value === 'string'
        && (PLAYER_CHALLENGE_MODES as readonly string[]).includes(value);
}

export async function loadChallengeRecord(id: string): Promise<AuthoritativeChallengeRecord | null> {
    if (!isChallengeId(id)) return null;
    return await kv.get<AuthoritativeChallengeRecord>(challengeRecordKey(id));
}

export async function saveChallengeRecord(record: AuthoritativeChallengeRecord): Promise<boolean> {
    return !!(await kv.set(challengeRecordKey(record.id), record, { nx: true, ex: CHALLENGE_RECORD_TTL_SECONDS }));
}

/** Political duel notices are tied to the exact incumbent/challenger pair.
 * Social blocks cannot make an active seat challenge impossible to answer. */
export async function isCurrentKageInvitation(
    record: Pick<AuthoritativeChallengeRecord, 'from' | 'to' | 'mode' | 'challenge'>,
    allowSealed = false,
): Promise<boolean> {
    const village = record.challenge.kageVillage;
    const challengeId = record.challenge.kageChallengeId;
    if (record.mode !== 'standard' || typeof village !== 'string' || typeof challengeId !== 'string'
        || !village || !challengeId || record.challenge.sectorAttack === true
        || record.challenge.battleId || record.challenge.arenaMatch === true
        || Number(record.challenge.clanWarPoints ?? 0) !== 0) return false;
    const { kageKey } = await import('../village/_kage-settle.js');
    const [state, sender, recipient] = await Promise.all([
        kv.get<import('../village/_kage-challenge.js').KageStateLike>(kageKey(village)),
        kv.get<{ character?: { village?: string } }>(`save:${record.from}`),
        kv.get<{ character?: { village?: string } }>(`save:${record.to}`),
    ]);
    return state?.kageSystemUnlocked === true && !!state.challenge
        && state.challenge.challengeId === challengeId
        && (allowSealed || state.challenge.status === 'pending')
        && safeName(state.seatedKage ?? '') === record.from
        && safeName(state.challenge.challenger) === record.to
        && sender?.character?.village === village && recipient?.character?.village === village;
}

export type ChallengeSessionReservation = {
    id: string;
    from: string;
    to: string;
    mode: PlayerChallengeMode;
    battleId: string;
    kageDuelAuthority?: {
        version: 1;
        village: string;
        challengeId: string;
    };
};

/**
 * Atomically bind one pending, server-recorded challenge to one PvP battle.
 * The responder (record.to) must create the session, and the fighter order must
 * remain challenger=p1 / responder=p2. A replay or a made-up challenge id gets
 * no reservation and therefore no reward authority.
 */
export async function reserveChallengeForPvpSession(args: {
    challengeId: string;
    creator: string;
    p1: string;
    p2: string;
    mode: unknown;
    battleId: string;
}): Promise<ChallengeSessionReservation | null> {
    if (!isChallengeId(args.challengeId)) return null;
    const key = challengeRecordKey(args.challengeId);
    return withKvLock(key, async () => {
        const record = await kv.get<AuthoritativeChallengeRecord>(key);
        if (!record || record.status !== 'pending') return null;
        const creator = safeName(args.creator);
        const p1 = safeName(args.p1);
        const p2 = safeName(args.p2);
        if (!creator || creator !== record.to || p1 !== record.from || p2 !== record.to) return null;
        if (isPlayerChallengeMode(args.mode) && args.mode !== record.mode) return null;
        // Pet-only protocols do not create the hex-grid PvP session.
        if (record.mode === 'clanWarPet' || record.mode === 'rankedPet') return null;

        const kageVillage = typeof record.challenge.kageVillage === 'string'
            ? record.challenge.kageVillage.trim()
            : '';
        const kageChallengeId = typeof record.challenge.kageChallengeId === 'string'
            ? record.challenge.kageChallengeId.trim()
            : '';
        if (!!kageVillage !== !!kageChallengeId) {
            throw new Error('kage-duel-challenge-authority-incomplete');
        }
        if (kageVillage && kageChallengeId) {
            const { advanceKageChallengeClock } = await import('../village/_kage-clock.js');
            const { state } = await advanceKageChallengeClock(kageVillage);
            const councilChallenge = state?.challenge;
            if (!await isCurrentKageInvitation(record) || !councilChallenge || councilChallenge.status !== 'pending'
                || councilChallenge.challengeId !== kageChallengeId || councilChallenge.kageAcceptedAt === undefined
                || record.from !== safeName(state?.seatedKage ?? '') || record.to !== safeName(councilChallenge.challenger)) {
                throw new Error('kage-duel-requires-kage-invitation-and-challenger-acceptance');
            }
        }
        const next: AuthoritativeChallengeRecord = {
            ...record,
            status: 'session-started',
            battleId: args.battleId,
            resolvedAt: Date.now(),
        };
        await kv.set(key, next, { ex: CHALLENGE_RECORD_TTL_SECONDS });
        return {
            id: record.id,
            from: record.from,
            to: record.to,
            mode: record.mode,
            battleId: args.battleId,
            ...(kageVillage && kageChallengeId ? {
                kageDuelAuthority: {
                    version: 1 as const,
                    village: kageVillage,
                    challengeId: kageChallengeId,
                },
            } : {}),
        };
    }, { failClosed: true });
}

/** Release only our own failed reservation, allowing the responder to retry. */
export async function releaseChallengePvpReservation(challengeId: string, battleId: string): Promise<void> {
    if (!isChallengeId(challengeId) || !battleId) return;
    const key = challengeRecordKey(challengeId);
    await withKvLock(key, async () => {
        const record = await kv.get<AuthoritativeChallengeRecord>(key);
        if (!record || record.status !== 'session-started' || record.battleId !== battleId) return;
        await kv.set(key, {
            ...record,
            status: 'pending',
            battleId: undefined,
            resolvedAt: undefined,
        }, { ex: CHALLENGE_RECORD_TTL_SECONDS });
    });
}

export async function resolveChallengeRecord(args: {
    id: string;
    responder: string;
    target: string;
    resolution: 'accepted' | 'declined';
    battleId?: string;
}): Promise<{ record: AuthoritativeChallengeRecord; replay: boolean } | null> {
    if (!isChallengeId(args.id)) return null;
    const key = challengeRecordKey(args.id);
    return withKvLock(key, async () => {
        const record = await kv.get<AuthoritativeChallengeRecord>(key);
        if (!record) return null;
        if (safeName(args.responder) !== record.to || safeName(args.target) !== record.from) return null;

        const wantedStatus = args.resolution;
        if (record.status === wantedStatus) {
            const sameBattle = wantedStatus === 'declined' || record.battleId === args.battleId;
            return sameBattle ? { record, replay: true } : null;
        }
        if (wantedStatus === 'accepted') {
            const isPetProtocol = record.mode === 'clanWarPet' || record.mode === 'rankedPet';
            if (isPetProtocol) {
                if (record.status !== 'pending' || args.battleId) return null;
            } else if (record.status !== 'session-started' || !args.battleId || record.battleId !== args.battleId) {
                return null;
            }
        } else if (record.status !== 'pending') {
            return null;
        }

        const next: AuthoritativeChallengeRecord = {
            ...record,
            status: wantedStatus,
            ...(args.battleId ? { battleId: args.battleId } : {}),
            resolvedAt: Date.now(),
        };
        await kv.set(key, next, { ex: CHALLENGE_RECORD_TTL_SECONDS });
        return { record: next, replay: false };
    }, { failClosed: true });
}

export async function cancelChallengeRecord(id: string, actor: string): Promise<AuthoritativeChallengeRecord | null> {
    if (!isChallengeId(id)) return null;
    const key = challengeRecordKey(id);
    return withKvLock(key, async () => {
        const record = await kv.get<AuthoritativeChallengeRecord>(key);
        if (!record) return null;
        const who = safeName(actor);
        if (who !== record.from && who !== record.to) return null;
        if (record.status === 'pending') {
            const next: AuthoritativeChallengeRecord = {
                ...record,
                status: 'cancelled',
                resolvedAt: Date.now(),
            };
            await kv.set(key, next, { ex: CHALLENGE_RECORD_TTL_SECONDS });
            return next;
        }
        return record;
    }, { failClosed: true });
}

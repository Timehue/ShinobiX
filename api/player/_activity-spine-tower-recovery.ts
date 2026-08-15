import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import {
    clanBossBattleMarkerKey,
    towerBattleLeaseForMember,
    type TowerBattleLock,
} from '../towers/_battle-lease.js';
import { getTowerInvite, isPublicTowerRun, isSpireRun, readSession } from '../towers/_tower-store.js';
import type { TowerSession } from '../towers/_tower-session.js';

export type ActivityTowerRecovery = {
    runId: string;
    title: string;
    screen: 'battleTowers' | 'clan';
    runtimeModeId: 'battle-towers' | 'endless-spire' | 'clan-boss';
    context: 'towers' | 'clan-boss';
};

export type ActivityTowerRecoveryReaders = {
    readLease: (slug: string) => Promise<TowerBattleLock | null>;
    readClanBossMarker: (slug: string) => Promise<unknown>;
    readInvite: (slug: string) => Promise<string | null>;
    readSession: (runId: string) => Promise<TowerSession | null>;
};

type ClanBossMarkerPointer = {
    kind: 'clanBoss';
    requestId: string;
    runId: string;
    startedAt: number;
};

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;

function clanBossMarkerPointer(value: unknown): ClanBossMarkerPointer | null {
    if (!value || typeof value !== 'object') return null;
    const marker = value as Partial<ClanBossMarkerPointer>;
    return marker.kind === 'clanBoss'
        && typeof marker.requestId === 'string'
        && REQUEST_ID_PATTERN.test(marker.requestId)
        && typeof marker.runId === 'string'
        && marker.runId.startsWith('cboss-')
        && RUN_ID_PATTERN.test(marker.runId)
        && Number.isFinite(marker.startedAt)
        ? marker as ClanBossMarkerPointer
        : null;
}

function validRunId(value: unknown): string | null {
    return typeof value === 'string' && RUN_ID_PATTERN.test(value) ? value : null;
}

/**
 * Recovery visibility requires an authoritative session, an unfinished status,
 * and a live human squad actor owned by the requesting account. Borrowed AI and
 * enemy ownership can never grant discovery access.
 */
export function isOwnedRecoverableTowerSession(session: TowerSession | null, slug: string): session is TowerSession {
    return !!session
        && (session.status === 'active'
            || (session.status === 'done' && session.rewardSettlementState !== 'settled'))
        && session.actors.some(actor => actor.side === 'squad'
            && actor.ai === false
            && actor.ownerSlug === slug);
}

function recoveryForSession(session: TowerSession, runId: string): ActivityTowerRecovery | null {
    if (runId.startsWith('cboss-')) {
        return {
            runId,
            title: 'Resume your Clan Boss assault',
            screen: 'clan',
            runtimeModeId: 'clan-boss',
            context: 'clan-boss',
        };
    }
    if (isSpireRun(session)) {
        return {
            runId,
            title: 'Resume your Endless Spire run',
            screen: 'battleTowers',
            runtimeModeId: 'endless-spire',
            context: 'towers',
        };
    }
    if (isPublicTowerRun(session)) {
        return {
            runId,
            title: 'Resume your Battle Towers run',
            screen: 'battleTowers',
            runtimeModeId: 'battle-towers',
            context: 'towers',
        };
    }
    return null;
}

const defaultReaders: ActivityTowerRecoveryReaders = {
    readLease: towerBattleLeaseForMember,
    readClanBossMarker: slug => kv.get<unknown>(clanBossBattleMarkerKey(slug)),
    readInvite: getTowerInvite,
    readSession,
};

/**
 * Purely discovers a resumable Tower-engine activity from durable pointers.
 * Every injected operation is a read. Storage failures deliberately propagate
 * so the Activity Spine fails closed instead of hiding an uncertain live fight.
 */
export async function discoverActivityTowerRecovery(
    playerName: string,
    readers: ActivityTowerRecoveryReaders = defaultReaders,
): Promise<ActivityTowerRecovery | null> {
    const slug = safeName(playerName);
    if (!slug) return null;

    const [lease, markerValue, inviteValue] = await Promise.all([
        readers.readLease(slug),
        readers.readClanBossMarker(slug),
        readers.readInvite(slug),
    ]);

    // MPvP has an isolated match store and recovery route. Never interpret its
    // shared account lease (or any stale Tower pointer beside it) as PvE.
    if (lease?.meta.mode === 'mpvp') return null;

    const marker = clanBossMarkerPointer(markerValue);
    const candidates = [
        validRunId(lease?.battleId),
        validRunId(marker?.runId),
        validRunId(inviteValue),
    ].filter((runId, index, all): runId is string => !!runId && all.indexOf(runId) === index);
    if (!candidates.length) return null;

    // Read every candidate before deciding. A failure on any durable pointer is
    // uncertainty, not evidence that no fight exists, and therefore rejects the
    // whole Activity Spine request without mutating or cleaning that pointer.
    const sessions = await Promise.all(candidates.map(runId => readers.readSession(runId)));
    for (let index = 0; index < candidates.length; index += 1) {
        const runId = candidates[index]!;
        const session = sessions[index] ?? null;
        if (session?.runId !== runId || !isOwnedRecoverableTowerSession(session, slug)) continue;
        const recovery = recoveryForSession(session, runId);
        if (recovery) return recovery;
    }
    return null;
}

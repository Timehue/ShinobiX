import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import type { KvLike } from '../_storage.js';
import { canTakeApex, isApexBeastForWeek, isoWeekKey } from './_apex-contract.js';
import { resolveDungeonAiFightAuthority } from '../dungeon/_ai-fight.js';
import type { AiFightProfile, AiFightScaling } from './_ai-fight-encounter.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from '../world/_explore-authority.js';

export type GenericAiFightBattleKind = 'practice' | 'explore' | 'raidAi' | 'dungeon';

export type GenericAiFightAuthority = {
    battleKind: GenericAiFightBattleKind;
    opponentId: string;
    sector?: number;
    exploreReceiptKey?: string;
    worldExploreRequestId?: string;
    raidTokenId?: string;
    raidTokenKey?: string;
    raidTokenRecord?: RaidAiTokenRecord;
    /** Server-built profile/scaling for a dedicated adapter. Never request data. */
    profile?: AiFightProfile;
    scaling?: AiFightScaling;
    dungeonRunToken?: string;
};

export type RaidAiTokenRecord = Record<string, unknown> & {
    playerName: string;
    aiId: string;
    sector: number;
    authorityVersion?: 2;
    status?: 'minted' | 'reserved' | 'settled';
    aiFightToken?: string;
    sessionId?: string;
};

export function raidGuardOpponentId(levelRaw: unknown): string {
    const level = Math.max(1, Math.floor(Number(levelRaw) || 1));
    if (level < 20) return 'builtin-ai-mist-sentinel';
    if (level < 40) return 'builtin-ai-ember-duelist';
    if (level < 60) return 'builtin-ai-frost-sealer';
    if (level < 80) return 'builtin-ai-shadow-weaver';
    return 'builtin-ai-central-champion';
}

export async function reserveRaidAiToken(params: {
    store: Pick<KvLike, 'get' | 'compareSet'>;
    key: string;
    expected: RaidAiTokenRecord;
    aiFightToken: string;
    sessionId: string;
    ttlSeconds: number;
}): Promise<void> {
    const next: RaidAiTokenRecord = {
        ...params.expected,
        authorityVersion: 2,
        status: 'reserved',
        aiFightToken: params.aiFightToken,
        sessionId: params.sessionId,
        reservedAt: Date.now(),
    };
    if (await params.store.compareSet(params.key, params.expected, next, { ex: params.ttlSeconds })) return;
    const readback = await params.store.get<RaidAiTokenRecord>(params.key);
    if (readback?.status === 'reserved'
        && readback.aiFightToken === params.aiFightToken
        && readback.sessionId === params.sessionId) return;
    throw new Error('That AI-raid token is already bound to another encounter.');
}

export async function releaseRaidAiTokenReservation(params: {
    store: Pick<KvLike, 'get' | 'compareSet'>;
    key: string;
    aiFightToken: string;
    sessionId: string;
    ttlSeconds: number;
}): Promise<void> {
    const current = await params.store.get<RaidAiTokenRecord>(params.key);
    if (!current
        || current.status !== 'reserved'
        || current.aiFightToken !== params.aiFightToken
        || current.sessionId !== params.sessionId) return;
    const next: RaidAiTokenRecord = { ...current, status: 'minted' };
    delete next.aiFightToken;
    delete next.sessionId;
    delete next.reservedAt;
    await params.store.compareSet(params.key, current, next, { ex: params.ttlSeconds });
}

export async function settleRaidAiToken(params: {
    store: Pick<KvLike, 'get' | 'compareSet'>;
    playerName: string;
    raidTokenId: string;
    aiFightToken: string;
    sessionId: string;
    outcome: string;
    ttlSeconds: number;
}): Promise<void> {
    const key = `raid-token:${params.playerName}:${params.raidTokenId}`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await params.store.get<RaidAiTokenRecord>(key);
        if (!current) throw new Error('The sealed AI-raid authority expired before settlement.');
        if (current.status === 'settled') {
            if (current.aiFightToken === params.aiFightToken && current.sessionId === params.sessionId) return;
            throw new Error('That AI-raid token was settled by another encounter.');
        }
        const serverBindingMatches = current.status === 'reserved'
            ? current.aiFightToken === params.aiFightToken && current.sessionId === params.sessionId
            : current.authorityVersion === 2 && (current.status === 'minted' || current.status == null);
        if (!serverBindingMatches) throw new Error('The AI-raid settlement does not match its reservation.');
        const next: RaidAiTokenRecord = {
            ...current,
            status: 'settled',
            aiFightToken: params.aiFightToken,
            sessionId: params.sessionId,
            outcome: params.outcome,
            settledAt: Date.now(),
        };
        if (await params.store.compareSet(key, current, next, { ex: params.ttlSeconds })) return;
    }
    throw new Error('The AI-raid token could not be settled safely.');
}

const EXPLORE_POOL_IDS = [
    'builtin-ai-academy-sparring',
    'builtin-ai-mist-sentinel',
    'builtin-ai-ember-duelist',
    'builtin-ai-exam-proctor',
    'builtin-ai-frost-sealer',
    'builtin-ai-rogue-ninja',
    'builtin-ai-shadow-weaver',
    'builtin-ai-central-champion',
] as const;

// One exploration receipt may launch its sealed battle for 30 days. The
// one-use KV marker lives slightly longer, so a dormant save cannot resurrect
// the same battle after the marker expires while the receipt is still present.
export const EXPLORE_BATTLE_AUTHORITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EXPLORE_BATTLE_MARKER_TTL_SECONDS = 31 * 24 * 60 * 60;

export function exploreBattleMarkerKey(playerName: string, receiptId: string): string {
    return `world-ai-explore-fight:${playerName}:${receiptId}`;
}

function hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function cleanOpaqueId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

function cleanProfileId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9:_-]+$/.test(id) ? id : '';
}

export function genericExploreOpponentId(params: {
    playerName: string;
    level: number;
    sector: number;
    receiptId: string;
}): string {
    const level = Math.max(1, Math.min(100, Math.floor(Number(params.level) || 1)));
    const profiles = EXPLORE_POOL_IDS
        .map((id) => AI_PROFILE_CATALOG[id])
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile) && profile.isBossAi !== true);
    const distance = Math.min(...profiles.map((profile) => Math.abs(profile.level - level)));
    const closest = profiles.filter((profile) => Math.abs(profile.level - level) === distance);
    return closest[hash(`${params.playerName.toLowerCase()}:${params.sector}:${params.receiptId}`) % closest.length]!.id;
}

async function ownsExploreReceipt(
    store: Pick<KvLike, 'get'>,
    playerName: string,
    character: Record<string, unknown>,
    receiptId: string,
    sector: number,
): Promise<boolean> {
    const receipts = Array.isArray(character.redeemedSectorExplorations)
        ? character.redeemedSectorExplorations as Array<Record<string, unknown>>
        : [];
    if (receipts.some((entry) => entry
        && entry.id === receiptId
        && Number(entry.sector) === sector
        && Number.isFinite(Number(entry.at))
        && Number(entry.at) > 0
        && Date.now() - Number(entry.at) <= EXPLORE_BATTLE_AUTHORITY_TTL_MS
        && typeof entry.outcome === 'object'
        && entry.outcome !== null
        && (entry.outcome as Record<string, unknown>).kind === 'battle')) return true;
    const durable = cleanWorldExploreAuthorityReceipt(await store.get(worldExploreAuthorityKey(playerName, receiptId)));
    return durable?.playerName.toLowerCase() === playerName.toLowerCase()
        && durable.sector === sector
        && Date.now() - durable.at <= EXPLORE_BATTLE_AUTHORITY_TTL_MS
        && durable.outcome?.kind === 'battle';
}

export async function resolveGenericAiFightAuthority(params: {
    store: Pick<KvLike, 'get' | 'set'>;
    playerName: string;
    body: Record<string, unknown>;
    character: Record<string, unknown>;
    tokenTtlSeconds: number;
}): Promise<GenericAiFightAuthority> {
    const battleKind = typeof params.body.battleKind === 'string' ? params.body.battleKind : 'practice';
    const requestedOpponentId = cleanProfileId(params.body.opponentId);
    if (battleKind === 'practice') {
        if (!requestedOpponentId) throw new Error('A published practice opponent is required.');
        return { battleKind, opponentId: requestedOpponentId };
    }
    if (battleKind === 'dungeon') {
        return resolveDungeonAiFightAuthority({
            playerName: params.playerName,
            character: params.character,
            dungeonRunToken: params.body.dungeonRunToken,
        });
    }
    if (battleKind === 'explore') {
        const sector = Math.floor(Number(params.body.sector));
        const receiptId = cleanOpaqueId(params.body.worldExploreRequestId);
        if (!Number.isSafeInteger(sector) || sector < 1 || sector > 66 || !receiptId) {
            throw new Error('A sealed exploration receipt is required for this encounter.');
        }
        if (!(await ownsExploreReceipt(params.store, params.playerName, params.character, receiptId, sector))) {
            throw new Error('That exploration receipt does not prove this sector.');
        }
        const exploreReceiptKey = exploreBattleMarkerKey(params.playerName, receiptId);
        if (await params.store.get(exploreReceiptKey)) {
            throw new Error('That exploration encounter was already started.');
        }
        return {
            battleKind,
            opponentId: genericExploreOpponentId({
                playerName: params.playerName,
                level: Number(params.character.level),
                sector,
                receiptId,
            }),
            sector,
            exploreReceiptKey,
            worldExploreRequestId: receiptId,
        };
    }
    if (battleKind === 'raidAi') {
        const week = isoWeekKey(new Date());
        if (isApexBeastForWeek(requestedOpponentId, week)) {
            if (!canTakeApex(params.character)) throw new Error('The current Apex contract is not available to this hunter.');
            return { battleKind, opponentId: requestedOpponentId };
        }
        const sector = Math.floor(Number(params.body.sector));
        const raidToken = cleanOpaqueId(params.body.raidToken);
        if (!Number.isSafeInteger(sector) || sector < 1 || sector > 66 || !raidToken) {
            throw new Error('A sealed AI-raid token is required for this encounter.');
        }
        const key = `raid-token:${params.playerName}:${raidToken}`;
        const authority = await params.store.get<RaidAiTokenRecord>(key);
        if (!authority
            || String(authority.playerName ?? '').toLowerCase() !== params.playerName.toLowerCase()
            || typeof authority.aiId !== 'string'
            || Number(authority.sector) !== sector
            || (authority.status != null && authority.status !== 'minted')) {
            throw new Error('The AI-raid token does not match this opponent and sector.');
        }
        // The token owns the opponent. `body.opponentId` is display-era input
        // only and cannot substitute a weaker profile.
        return {
            battleKind,
            opponentId: authority.aiId,
            sector,
            raidTokenId: raidToken,
            raidTokenKey: key,
            raidTokenRecord: authority,
        };
    }
    throw new Error('This AI battle kind must use its dedicated authoritative combat route.');
}

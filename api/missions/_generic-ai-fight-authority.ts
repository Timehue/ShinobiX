import { randomUUID } from 'node:crypto';
import type { KvLike } from '../_storage.js';
import { canTakeApex, isApexBeastForWeek, isoWeekKey } from './_apex-contract.js';
import { resolveDungeonAiFightAuthority } from '../dungeon/_ai-fight.js';
import type { AiFightProfile, AiFightScaling } from './_ai-fight-encounter.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from '../world/_explore-authority.js';
import { serverFieldMissionRun } from './_field-trail.js';
import { cleanOrdinaryPveEncounter, rollOrdinaryPveEncounter, type OrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter.js';
import { ordinaryAiProfile } from './_ordinary-ai-encounter.js';
import { computeAiFightBaseReward } from './_ai-fight-token.js';
import { WORLD_EXPLORE_RECEIPT_TTL_SECONDS } from '../world/_explore-authority.js';
import { MAX_LEVEL } from '../_xp-engine.js';

export type GenericAiFightBattleKind = 'practice' | 'explore' | 'raidAi' | 'dungeon';

export type GenericAiFightAuthority = {
    battleKind: GenericAiFightBattleKind;
    opponentId: string;
    sector?: number;
    exploreReceiptKey?: string;
    worldExploreRequestId?: string;
    encounter?: OrdinaryPveEncounter;
    raidTokenId?: string;
    raidMissionId?: string;
    raidTokenKey?: string;
    raidTokenRecord?: RaidAiTokenRecord;
    /** Server-owned profile/scaling, including the bounded consensual practice choice. */
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
    scaling?: AiFightScaling;
};

export function raidGuardOpponentId(levelRaw: unknown): string {
    const level = Math.max(1, Math.floor(Number(levelRaw) || 1));
    if (level < 20) return 'builtin-ai-mist-sentinel';
    if (level < 40) return 'builtin-ai-ember-duelist';
    if (level < 60) return 'builtin-ai-frost-sealer';
    if (level < 80) return 'builtin-ai-shadow-weaver';
    return 'builtin-ai-central-champion';
}

const VILLAGE_GUARD_KEYS: Record<string, string> = {
    'Stormveil Village': 'stormveil',
    'Ashen Leaf Village': 'ashen-leaf',
    'Frostfang Village': 'frostfang',
    'Moonshadow Village': 'moonshadow',
};

/** The no-human-defense fallback is themed to the territory owner. */
export function raidVillageGuardOpponentId(villageRaw: unknown, levelRaw: unknown): string {
    const village = typeof villageRaw === 'string' ? villageRaw.trim() : '';
    const key = VILLAGE_GUARD_KEYS[village];
    if (!key) return raidGuardOpponentId(levelRaw);
    const level = Math.max(1, Math.floor(Number(levelRaw) || 1));
    const tiers = [4, 15, 25, 35, 50, 65, 75, 85, 100];
    const tier = [...tiers].reverse().find((candidate) => candidate <= level) ?? tiers[0];
    return `story-ai-${key}-village-${tier}`;
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

// One exploration receipt may launch its sealed battle for 30 days. The
// one-use KV marker lives slightly longer, so a dormant save cannot resurrect
// the same battle after the marker expires while the receipt is still present.
export const EXPLORE_BATTLE_AUTHORITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EXPLORE_BATTLE_MARKER_TTL_SECONDS = 31 * 24 * 60 * 60;

export function exploreBattleMarkerKey(playerName: string, receiptId: string): string {
    return `world-ai-explore-fight:${playerName}:${receiptId}`;
}

function cleanOpaqueId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

function cleanProfileId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9:_-]+$/.test(id) ? id : '';
}

/** @deprecated Compatibility preview helper only. Server encounter rolls use
 * private random entropy and then persist the complete receipt descriptor. */
export function genericExploreOpponentId(params: {
    playerName: string;
    level: number;
    sector: number;
    receiptId: string;
}): string {
    return rollOrdinaryPveEncounter({ sourceId: params.receiptId, playerLevel: params.level, sector: params.sector,
        seed: `${params.playerName.toLowerCase()}:${params.sector}:${params.receiptId}` }).profileId;
}

async function exploreReceipt(store: Pick<KvLike, 'get'>, playerName: string, character: Record<string, unknown>, receiptId: string, sector: number) {
    const durable = cleanWorldExploreAuthorityReceipt(await store.get(worldExploreAuthorityKey(playerName, receiptId)));
    const receipts = Array.isArray(character.redeemedSectorExplorations)
        ? character.redeemedSectorExplorations as Array<Record<string, unknown>> : [];
    const saved = receipts.find((entry) => entry?.id === receiptId);
    const receipt = durable ?? saved;
    if (!receipt || (durable && durable.playerName.toLowerCase() !== playerName.toLowerCase())
        || Number(receipt.sector) !== sector || !Number.isSafeInteger(Number(receipt.at))
        || Number(receipt.at) <= 0 || Number(receipt.at) > Date.now() + 60_000
        || Date.now() - Number(receipt.at) > EXPLORE_BATTLE_AUTHORITY_TTL_MS
        || !receipt.outcome || typeof receipt.outcome !== 'object'
        || (receipt.outcome as Record<string, unknown>).kind !== 'battle') return null;
    return receipt;
}

/** The exploration receipt is this player's, in this sector, still fightable, and rolled a battle. */
export async function ownsExploreReceipt(
    store: Pick<KvLike, 'get'>,
    playerName: string,
    character: Record<string, unknown>,
    receiptId: string,
    sector: number,
): Promise<boolean> {
    return Boolean(await exploreReceipt(store, playerName, character, receiptId, sector));
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
        // Arena explicitly offers a level selector. Other practice adapters
        // (authored events, Dojo Circuit) omit it and retain their sealed kit.
        // Never reuse legacy opponentLevel: road/raid/dungeon requests carry
        // that display field too and cannot choose their encounter difficulty.
        const level = params.body.practiceLevel;
        if (level !== undefined && (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL)) {
            throw new Error(`Practice level must be an integer from 1 to ${MAX_LEVEL}.`);
        }
        return { battleKind, opponentId: requestedOpponentId, ...(level !== undefined ? { scaling: { level } } : {}) };
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
        const receipt = await exploreReceipt(params.store, params.playerName, params.character, receiptId, sector);
        if (!receipt) {
            throw new Error('That exploration receipt does not prove this sector.');
        }
        const exploreReceiptKey = exploreBattleMarkerKey(params.playerName, receiptId);
        if (await params.store.get(exploreReceiptKey)) {
            throw new Error('That exploration encounter was already started.');
        }
        const outcome = receipt.outcome as Record<string, unknown>;
        let encounter = cleanOrdinaryPveEncounter(outcome.encounter);
        if (outcome.encounter != null && (!encounter || encounter.sourceId !== receiptId)) {
            throw new Error('The sealed exploration opponent is invalid.');
        }
        if (!encounter) {
            // Pre-overhaul receipts have no combat descriptor. Upgrade once at
            // their existing authority key before starting; subsequent retries
            // must use it even when the save level or pet changes.
            encounter = rollOrdinaryPveEncounter({ sourceId: receiptId, playerLevel: Number(params.character.level), sector,
                seed: randomUUID(), reward: computeAiFightBaseReward(params.character) });
            await params.store.set(worldExploreAuthorityKey(params.playerName, receiptId), {
                version: 1, playerName: params.playerName, requestId: receiptId, sector,
                reward: receipt.reward ?? { sector, xp: 0, ryo: 0 }, outcome: { ...outcome, encounter }, at: receipt.at,
            }, { ex: WORLD_EXPLORE_RECEIPT_TTL_SECONDS });
        }
        if (params.body.encounterId != null && params.body.encounterId !== encounter.id) {
            throw new Error('The exploration preview is stale. Resume its sealed opponent.');
        }
        return {
            battleKind,
            opponentId: encounter.profileId,
            profile: ordinaryAiProfile(encounter),
            encounter,
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
        if (authority.source === 'field-mission-raid' && typeof authority.missionRunId === 'string'
            && serverFieldMissionRun(params.character, String(authority.missionId ?? ''))?.runId !== authority.missionRunId) {
            throw new Error('That mission raid belongs to an earlier contract run. Start a new raid from the outpost.');
        }
        // The token owns the opponent. `body.opponentId` is display-era input
        // only and cannot substitute a weaker profile.
        return {
            battleKind,
            opponentId: authority.aiId,
            ...(authority.scaling ? { scaling: authority.scaling } : {}),
            sector,
            raidTokenId: raidToken,
            ...(authority.source === 'field-mission-raid' && typeof authority.missionId === 'string'
                ? { raidMissionId: authority.missionId }
                : {}),
            raidTokenKey: key,
            raidTokenRecord: authority,
        };
    }
    throw new Error('This AI battle kind must use its dedicated authoritative combat route.');
}

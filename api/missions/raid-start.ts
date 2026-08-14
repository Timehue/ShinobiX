import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { homeVillageForSector } from '../_war-map-sectors.js';
import { loadPublishedContent } from '../_content-store.js';
import { loadAiFightProfile } from './_ai-fight-encounter.js';
import { acceptedRaidFetchMissions } from './_field-raid-progress.js';
import { raidGuardOpponentId } from './_generic-ai-fight-authority.js';

/*
 * /api/missions/raid-start  — POST only
 *
 * Mints the single-use server authority used to open a canonical Solo-PvE AI
 * raid session. PvP raids use their sealed PvpSession instead.
 *
 * The token is a UUID stored under `raid-token:<player>:<uuid>` with a 5-min
 * TTL. ai-fight-start reserves it to one session and report-ai-fight settles
 * it after the shared field/Vanguard/territory saga is durable.
 *
 * Body shape:
 *   { playerName, requestId, aiId?: string, sector: number }
 *
 * The stable requestId replays the same opponent, sector, and token after a
 * lost response. aiId only selects a published creator raid; field targets
 * are reconstructed from server territory/mission authority.
 *
 * Rate limited 1 per 30s + 30 per day (half the report-raid cap, since the
 * report itself also rate-limits — the effective ceiling stays at 30/day for
 * AI raids).
 */

const MAX_RAID_STARTS_PER_DAY = 30;
const RAID_TOKEN_TTL_SECONDS = 5 * 60;
const RAID_START_RECEIPT_TTL_SECONDS = 25 * 60 * 60;

type RaidStartResponse = {
    ok: true;
    vanguard: boolean;
    requestId: string;
    token: string | null;
    opponentId?: string;
    aiId?: string;
    sector?: number;
    source?: RaidStartAuthority['source'];
    reason?: string;
    replayed?: boolean;
};

type RaidStartTokenRecord = {
    playerName: string;
    mintedAt: number;
    aiId: string;
    sector: number;
    source: RaidStartAuthority['source'];
    sourceId?: string;
    authorityVersion: 2;
    status: 'minted';
    requestId: string;
};

type RaidStartReceipt = {
    version: 2;
    day: string;
    mintedAt: number;
    response: RaidStartResponse;
    tokenRecord?: RaidStartTokenRecord;
};

function cleanRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

function raidStartRequestKey(playerName: string, requestId: string): string {
    return `raid-start-request:${playerName}:${requestId}`;
}

function cleanRaidStartReceipt(raw: unknown): RaidStartReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<RaidStartReceipt>;
    if (value.version !== 2 || !value.response || typeof value.response !== 'object') return null;
    const mintedAt = Math.floor(Number(value.mintedAt));
    if (!Number.isSafeInteger(mintedAt) || mintedAt <= 0 || typeof value.day !== 'string') return null;
    return value as RaidStartReceipt;
}

async function replayRaidStart(
    playerName: string,
    requestKey: string,
): Promise<{ response?: RaidStartResponse; error?: 'raid-launch-expired' | 'raid-launch-spent' }> {
    const raw = await kv.get<unknown>(requestKey);
    if (!raw) return {};
    const receipt = cleanRaidStartReceipt(raw);
    if (!receipt) {
        // Rollout compatibility for the brief v1 response-only shape.
        const legacy = raw as RaidStartResponse;
        if (!legacy?.ok) return {};
        if (legacy.token && !(await kv.get(`raid-token:${playerName}:${legacy.token}`))) {
            return { error: 'raid-launch-expired' };
        }
        return { response: { ...legacy, replayed: true } };
    }
    const response = receipt.response;
    if (!response.token || !receipt.tokenRecord) return { response: { ...response, replayed: true } };
    if (Date.now() - receipt.mintedAt >= RAID_TOKEN_TTL_SECONDS * 1_000) {
        return { error: 'raid-launch-expired' };
    }
    const tokenKey = `raid-token:${playerName}:${response.token}`;
    const existing = await kv.get<Record<string, unknown>>(tokenKey);
    if (existing?.status === 'settled') return { error: 'raid-launch-spent' };
    if (!existing) {
        const remaining = Math.max(1, Math.ceil((RAID_TOKEN_TTL_SECONDS * 1_000 - (Date.now() - receipt.mintedAt)) / 1_000));
        await kv.set(tokenKey, receipt.tokenRecord, { ex: remaining });
    }
    return { response: { ...response, replayed: true } };
}

type RaidStartAuthority = {
    aiId: string;
    sector: number;
    source: 'creator-raid' | 'field-raid';
    sourceId?: string;
};

function creatorRaidRows(record: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
    return Array.isArray(record?.creatorRaids)
        ? (record.creatorRaids as unknown[]).filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
        : [];
}

async function creatorRaidAuthority(params: {
    requestedAiId: string;
    sector: number;
    level: number;
}): Promise<RaidStartAuthority | null> {
    if (!params.requestedAiId) return null;
    const [admin1, admin2, published] = await Promise.all([
        kv.get<Record<string, unknown>>('save:admin1'),
        kv.get<Record<string, unknown>>('save:admin2'),
        loadPublishedContent().catch(() => ({} as Record<string, unknown>)),
    ]);
    const byId = new Map<string, Record<string, unknown>>();
    for (const source of [admin1, admin2, published]) {
        for (const raid of creatorRaidRows(source)) {
            const id = typeof raid.id === 'string' ? raid.id.trim().slice(0, 96) : '';
            if (id) byId.set(id, raid);
        }
    }
    const match = [...byId.values()].find((raid) => raid.aiProfileId === params.requestedAiId
        && Math.floor(Number(raid.targetSector)) === params.sector
        && params.level >= Math.max(1, Math.floor(Number(raid.levelReq) || 1)));
    if (!match || !(await loadAiFightProfile(params.requestedAiId))) return null;
    return {
        aiId: params.requestedAiId,
        sector: params.sector,
        source: 'creator-raid',
        sourceId: String(match.id),
    };
}

async function fieldRaidAuthority(params: {
    playerName: string;
    save: Record<string, unknown>;
    character: Record<string, unknown>;
    sector: number;
}): Promise<RaidStartAuthority | null> {
    const territory = await kv.get<Record<string, unknown>>(`world:territory:${params.sector}`);
    const playerVillage = String(params.character.village ?? '').trim();
    const playerClan = String(params.character.clan ?? '').trim();
    const ownerVillage = String(territory?.ownerVillage ?? homeVillageForSector(params.sector) ?? '').trim();
    const ownerClan = String(territory?.ownerClan ?? '').trim();
    const hostileTerritory = (!!ownerVillage && ownerVillage !== playerVillage)
        || (!!ownerClan && ownerClan !== playerClan);
    const acceptedFieldContract = acceptedRaidFetchMissions(params.save)
        .some((mission) => Math.floor(Number(mission.targetSector)) === params.sector);
    if (!hostileTerritory && !acceptedFieldContract) return null;

    let guardLevel = Math.max(1, Math.floor(Number(params.character.level) || 1));
    if (ownerVillage) {
        const keys = await kv.keys('guard:*').catch(() => [] as string[]);
        if (keys.length > 0) {
            const guards = await kv.mget<Array<Record<string, unknown> | null>>(...keys).catch(() => []);
            for (const guard of guards) {
                if (guard && guard.village === ownerVillage) {
                    guardLevel = Math.max(guardLevel, Math.floor(Number(guard.level) || 1));
                }
            }
        }
    }
    return {
        aiId: raidGuardOpponentId(guardLevel),
        sector: params.sector,
        source: 'field-raid',
        sourceId: ownerClan || ownerVillage || acceptedRaidFetchMissions(params.save)
            .find((mission) => Math.floor(Number(mission.targetSector)) === params.sector)?.id,
    };
}

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const aiIdRaw = typeof body.aiId === 'string' ? body.aiId.trim().slice(0, 64) : '';
        const aiId = /^[A-Za-z0-9:_-]+$/.test(aiIdRaw) ? aiIdRaw : '';
        const sector = Math.floor(Number(body.sector));
        const requestedId = cleanRequestId(body.requestId);

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own raids.' });
        }
        if (!requestedId && !identity.admin) {
            return res.status(400).json({ error: 'A stable raid requestId is required.' });
        }
        const requestId = requestedId || `admin_${randomUUID().replace(/-/g, '')}`;
        const requestKey = raidStartRequestKey(playerName, requestId);
        // Exact authenticated replay is exempt from the new-launch throttle.
        // A lost 200 must recover the same launch immediately, not wait 30s or
        // spend another daily slot.
        const replay = await replayRaidStart(playerName, requestKey);
        if (replay.error) {
            return res.status(409).json({
                error: replay.error === 'raid-launch-spent'
                    ? 'That raid launch has already settled.'
                    : 'That raid launch expired before combat began.',
                reason: replay.error,
                requestId,
            });
        }
        if (replay.response) return res.status(200).json(replay.response);
        if (!identity.admin && await findTowerBattleStartConflict([playerName])) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }

        if (!isWildSector(sector)) return res.status(400).json({ error: 'Invalid raid sector.' });
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!record || !char) return res.status(404).json({ error: 'Player save not found.' });
        const creatorAuthority = await creatorRaidAuthority({
            requestedAiId: aiId,
            sector,
            level: Math.max(1, Math.floor(Number(char.level) || 1)),
        });
        if (!creatorAuthority) {
            const presenceBlock = sectorPresenceBlock(playerName, sector);
            if (presenceBlock && !identity.admin) {
                return res.status(presenceBlock.status).json({ error: presenceBlock.error, reason: presenceBlock.reason });
            }
        }
        const authority = creatorAuthority ?? await fieldRaidAuthority({ playerName, save: record, character: char, sector });
        if (!authority) {
            return res.status(409).json({ error: 'There is no server-authorized raid target in that sector.' });
        }

        // Every profession mints a token. Vanguards spend it on raid-mission
        // progress; everyone else spends it on built-in fetch-* mission
        // raidCount, which report-raid credits from the same proof. The token
        // grants nothing on its own — report-raid decides what it is worth — so
        // minting for non-vanguards opens no reward path a vanguard did not
        // already have. (This used to hard-return for non-vanguards, which left
        // fetch raids with no server witness and made all five fetch missions
        // permanently unclaimable.)
        const vanguard = char?.profession === 'vanguard';
        const day = utcDateKey();
        const launch = await withKvLock(`raid-start-daily:${playerName}:${day}`, async (): Promise<RaidStartResponse | { replayError: string } | { rateLimited: true }> => {
            const raced = await replayRaidStart(playerName, requestKey);
            if (raced.error) return { replayError: raced.error };
            if (raced.response) return raced.response;
            if (!enforceRateLimit(req, res, 'raid-start', 1, 30_000, playerName)) return { rateLimited: true };
            const dailyKey = `raid-start-count:${playerName}:${utcDateKey()}`;
            const legacyStartedToday = Math.max(0, Math.floor(Number(await kv.get(dailyKey)) || 0));
            const receiptKeys = await kv.keys(`raid-start-request:${playerName}:*`);
            const receiptRows = receiptKeys.length ? await kv.mget<Array<unknown>>(...receiptKeys) : [];
            const durableStartedToday = receiptRows
                .map(cleanRaidStartReceipt)
                .filter((entry) => entry?.day === day && entry.tokenRecord).length;
            const startedToday = legacyStartedToday + durableStartedToday;
            if (startedToday >= MAX_RAID_STARTS_PER_DAY) {
                const capped: RaidStartResponse = {
                    ok: true,
                    vanguard,
                    requestId,
                    reason: 'daily-mint-cap',
                    token: null,
                };
                const now = Date.now();
                await kv.set(requestKey, {
                    version: 2,
                    day,
                    mintedAt: now,
                    response: capped,
                } satisfies RaidStartReceipt, { ex: RAID_START_RECEIPT_TTL_SECONDS });
                return capped;
            }
            const tokenId = randomUUID().replace(/-/g, '');
            const tokenKey = `raid-token:${playerName}:${tokenId}`;
            const mintedAt = Date.now();
            const tokenRecord: RaidStartTokenRecord = {
                playerName,
                mintedAt,
                aiId: authority.aiId,
                sector: authority.sector,
                source: authority.source,
                sourceId: authority.sourceId,
                authorityVersion: 2,
                status: 'minted',
                requestId,
            };
            const response: RaidStartResponse = {
                ok: true,
                vanguard,
                requestId,
                token: tokenId,
                opponentId: authority.aiId,
                aiId: authority.aiId,
                sector: authority.sector,
                source: authority.source,
                replayed: false,
            };
            // Receipt first, token second. If the process dies after either
            // write, same-request replay reconstructs the exact token from the
            // durable envelope; no extra mint or daily slot is consumed.
            await kv.set(requestKey, {
                version: 2,
                day,
                mintedAt,
                response,
                tokenRecord,
            } satisfies RaidStartReceipt, { ex: RAID_START_RECEIPT_TTL_SECONDS });
            await kv.set(tokenKey, tokenRecord, { ex: RAID_TOKEN_TTL_SECONDS });
            return response;
        }, { failClosed: true });
        if ('replayError' in launch) {
            return res.status(409).json({ error: 'That raid launch is no longer active.', reason: launch.replayError, requestId });
        }
        if ('rateLimited' in launch) return;
        return res.status(200).json(launch);

    } catch (err) {
        console.error('[missions/raid-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

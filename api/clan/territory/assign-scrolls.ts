import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MAX_WILD_SECTOR, OUTSKIRTS_SECTORS } from '../../../shared/sector-geo.js';
import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { LockContendedError, withKvLock } from '../../_lock.js';
import {
    planTerritoryScrollAssignment,
    TERRITORY_CAPTURE_SCROLLS,
    type AssignableTerritory,
    type TerritoryBuffStat,
    type TerritoryWeather,
} from './_assign-core.js';

const TERRITORY_KEY_PREFIX = 'world:territory:';
const RECEIPT_PREFIX = 'clan-territory-assign:';
const RECEIPT_TTL_SEC = 30 * 24 * 60 * 60;
const AUDIT_LOG_PREFIX = 'audit:clan-territory-assign:';
const VALID_WEATHER = new Set<TerritoryWeather>(['clear', 'rain', 'thunderstorm', 'ashfall', 'tornado', 'desertHaze']);
const VALID_BUFFS = new Set<TerritoryBuffStat>(['bukijutsuOffense', 'taijutsuOffense', 'ninjutsuOffense', 'genjutsuOffense']);

type AssignmentResponse = {
    territory: AssignableTerritory;
    treasury: Record<string, unknown>;
    captured: boolean;
    spent: number;
};

type AssignmentReceipt = {
    fingerprint: string;
    actor: string;
    status: 'reserved' | 'complete';
    createdAt: number;
    clanBefore: Record<string, unknown>;
    clanAfter: Record<string, unknown>;
    territoryBefore: AssignableTerritory | null;
    territoryAfter: AssignableTerritory;
    response: AssignmentResponse;
    completedAt?: number;
};

function requestFingerprint(input: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function actorIsClanMember(clanRec: Record<string, unknown>, actor: string): boolean {
    if (safeName(String(clanRec.founderName ?? '')) === actor) return true;
    const members = Array.isArray(clanRec.members) ? clanRec.members : [];
    return members.some((member) => safeName(String((member as Record<string, unknown>)?.name ?? '')) === actor);
}

function actorCanAssign(clanRec: Record<string, unknown>, actor: string): boolean {
    if (safeName(String(clanRec.founderName ?? '')) === actor) return true;
    const overrides = (clanRec.roleOverrides ?? {}) as Record<string, unknown>;
    const role = Object.entries(overrides).find(([name]) => safeName(name) === actor)?.[1];
    return role === 'Leader' || role === 'Officer';
}

async function commitExact(key: string, before: unknown | null, after: unknown): Promise<void> {
    try {
        if (await kv.compareSet(key, before, after)) return;
        throw new Error(`compare-set-conflict:${key}`);
    } catch (error) {
        const recovered = await kv.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(recovered, after)) return;
        throw error;
    }
}

async function finishReservedReceipt(
    receiptKey: string,
    receipt: AssignmentReceipt,
    clanKey: string,
    territoryKey: string,
): Promise<AssignmentReceipt> {
    const currentClan = await kv.get<Record<string, unknown>>(clanKey);
    if (!isDeepStrictEqual(currentClan, receipt.clanAfter)) {
        if (!isDeepStrictEqual(currentClan, receipt.clanBefore)) throw new Error('assignment-clan-recovery-conflict');
        await commitExact(clanKey, receipt.clanBefore, receipt.clanAfter);
    }

    const currentTerritory = await kv.get<AssignableTerritory>(territoryKey);
    if (!isDeepStrictEqual(currentTerritory, receipt.territoryAfter)) {
        if (!isDeepStrictEqual(currentTerritory, receipt.territoryBefore)) {
            const clanNow = await kv.get<Record<string, unknown>>(clanKey);
            if (isDeepStrictEqual(clanNow, receipt.clanAfter)) {
                await commitExact(clanKey, receipt.clanAfter, receipt.clanBefore);
            }
            throw new Error('assignment-territory-recovery-conflict');
        }
        try {
            await commitExact(territoryKey, receipt.territoryBefore, receipt.territoryAfter);
        } catch (error) {
            const clanNow = await kv.get<Record<string, unknown>>(clanKey);
            if (isDeepStrictEqual(clanNow, receipt.clanAfter)) {
                await commitExact(clanKey, receipt.clanAfter, receipt.clanBefore).catch(() => undefined);
            }
            throw error;
        }
    }

    const complete: AssignmentReceipt = { ...receipt, status: 'complete', completedAt: Date.now() };
    await kv.set(receiptKey, complete, { ex: RECEIPT_TTL_SEC });
    return complete;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const sector = Number(body.sector);
        const count = Number(body.count);
        const weather = body.weather as TerritoryWeather;
        const terrainBuffStat = body.terrainBuffStat as TerritoryBuffStat;
        const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });
        if (!Number.isSafeInteger(sector) || sector < 1 || sector > MAX_WILD_SECTOR) return res.status(400).json({ error: 'Invalid sector.' });
        if (OUTSKIRTS_SECTORS.includes(sector)) return res.status(400).json({ error: 'Village sectors cannot be captured.' });
        if (count !== 1 && count !== 5 && count !== TERRITORY_CAPTURE_SCROLLS) {
            return res.status(400).json({ error: `Scroll count must be 1, 5, or ${TERRITORY_CAPTURE_SCROLLS}.` });
        }
        if (!VALID_WEATHER.has(weather)) return res.status(400).json({ error: 'Invalid weather.' });
        if (!VALID_BUFFS.has(terrainBuffStat)) return res.status(400).json({ error: 'Invalid terrain bonus.' });
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ error: 'Invalid request id.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only act for your own account.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-territory-assign', 30, 60_000, identity.name))) return;

        const targetSlug = clanBareSlug(clan);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid clan name.' });
        const clanKey = clanRecordKey(clan);
        const territoryKey = `${TERRITORY_KEY_PREFIX}${sector}`;
        const receiptKey = `${RECEIPT_PREFIX}${targetSlug}:${requestId}`;
        const fingerprint = requestFingerprint({ playerName, targetSlug, sector, count, weather, terrainBuffStat });

        const result = await withKvLock(clanKey, async () => withKvLock(territoryKey, async () => {
            const prior = await kv.get<AssignmentReceipt>(receiptKey);
            if (prior) {
                if (prior.fingerprint !== fingerprint || prior.actor !== playerName) {
                    return { ok: false as const, status: 409, error: 'That request id was already used for a different action.' };
                }
                const completed = prior.status === 'complete'
                    ? prior
                    : await finishReservedReceipt(receiptKey, prior, clanKey, territoryKey);
                return { ok: true as const, response: completed.response, replayed: true };
            }

            const clanBefore = await kv.get<Record<string, unknown>>(clanKey);
            if (!clanBefore) return { ok: false as const, status: 404, error: 'Clan not found.' };
            if (!identity.admin) {
                const actorRec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const actorChar = (actorRec?.character ?? null) as Record<string, unknown> | null;
                if (!actorChar
                    || clanBareSlug(String(actorChar.clan ?? '')) !== targetSlug
                    || !actorIsClanMember(clanBefore, playerName)) {
                    return { ok: false as const, status: 403, error: 'You are not a member of this clan.' };
                }
                if (!actorCanAssign(clanBefore, playerName)) {
                    return { ok: false as const, status: 403, error: 'Only clan leadership can assign Territory Control Scrolls.' };
                }
            }

            const territoryBefore = await kv.get<AssignableTerritory>(territoryKey);
            const territoryKeys = await kv.keys(`${TERRITORY_KEY_PREFIX}*`);
            const territories = territoryKeys.length
                ? await kv.mget<Record<string, unknown>[]>(...territoryKeys)
                : [];
            const ownedSectorCount = territories.filter((territory) => territory
                && clanBareSlug(String(territory.ownerClan ?? '')) === targetSlug).length;
            const now = Date.now();
            const plan = planTerritoryScrollAssignment({
                clanBefore,
                clanDisplayName: String(clanBefore.name ?? clan),
                territoryBefore,
                ownedSectorCount,
                sector,
                count,
                weather,
                terrainBuffStat,
                now,
            });
            if (!plan.ok) return plan;

            const response: AssignmentResponse = {
                territory: plan.territoryAfter,
                treasury: plan.treasury,
                captured: plan.captured,
                spent: plan.spent,
            };
            const reserved: AssignmentReceipt = {
                fingerprint,
                actor: playerName,
                status: 'reserved',
                createdAt: now,
                clanBefore,
                clanAfter: plan.clanAfter,
                territoryBefore,
                territoryAfter: plan.territoryAfter,
                response,
            };
            await kv.set(receiptKey, reserved, { ex: RECEIPT_TTL_SEC });
            const completed = await finishReservedReceipt(receiptKey, reserved, clanKey, territoryKey);
            return { ok: true as const, response: completed.response, replayed: false };
        }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 }), { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });

        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (!result.replayed) {
            await kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
                ts: Date.now(),
                actor: identity.admin ? 'admin' : identity.name,
                clan,
                sector,
                count,
                captured: result.response.captured,
                requestId,
            }, { ex: RECEIPT_TTL_SEC }).catch(() => undefined);
        }
        return res.status(200).json({ ok: true, ...result.response, replayed: result.replayed });
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(429).json({ error: 'Another clan or territory change is saving. Retry.' });
        console.error('[clan/territory/assign-scrolls]', safeLogValue(error));
        return res.status(500).json({ error: 'Territory assignment could not be completed. Retrying the same action is safe.' });
    }
}

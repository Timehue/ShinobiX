import { safeLogValue } from '../_safe-log.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { DAILY_WILD_ENCOUNTER_ATTEMPTS, rollWildPet } from './_encounter.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { withKvLock } from '../_lock.js';
import {
    cleanPetEncounterPointer,
    petEncounterActiveKey,
    petEncounterRequestKey,
    PET_ENCOUNTER_POINTER_TTL_SECONDS,
} from './_encounter-pointer.js';
import { unresolvedFreeDungeonMiss } from '../dungeon/_run.js';

const ATTEMPT_RECEIPT_TTL_SECONDS = PET_ENCOUNTER_POINTER_TTL_SECONDS;

type PetAttemptReceipt = {
    version: 1;
    playerName: string;
    requestId: string;
    day: string;
    sector: number;
    mintedAt: number;
    token?: string;
    pet?: Record<string, unknown>;
    resolvedAt?: number;
    worldExploreRequestId?: string;
    resolution?: 'explored-miss' | 'befriended' | 'declined' | 'expired';
};

function cleanRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

function cleanReceipt(raw: unknown): PetAttemptReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<PetAttemptReceipt>;
    const sector = Math.floor(Number(value.sector));
    const mintedAt = Math.floor(Number(value.mintedAt));
    if (value.version !== 1 || typeof value.playerName !== 'string'
        || !cleanRequestId(value.requestId) || typeof value.day !== 'string'
        || !isWildSector(sector) || !Number.isSafeInteger(mintedAt) || mintedAt <= 0) return null;
    const token = typeof value.token === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value.token) ? value.token : undefined;
    const pet = value.pet && typeof value.pet === 'object' && !Array.isArray(value.pet)
        ? value.pet as Record<string, unknown>
        : undefined;
    if (Boolean(token) !== Boolean(pet)) return null;
    const resolvedAt = Math.floor(Number(value.resolvedAt));
    const worldExploreRequestId = cleanRequestId(value.worldExploreRequestId);
    const resolution = value.resolution === 'explored-miss'
        || value.resolution === 'befriended'
        || value.resolution === 'declined'
        || value.resolution === 'expired'
        ? value.resolution
        : undefined;
    return {
        version: 1,
        playerName: value.playerName,
        requestId: value.requestId!,
        day: value.day,
        sector,
        mintedAt,
        ...(token && pet ? { token, pet } : {}),
        ...(Number.isSafeInteger(resolvedAt) && resolvedAt > 0 ? { resolvedAt } : {}),
        ...(worldExploreRequestId ? { worldExploreRequestId } : {}),
        ...(resolution ? { resolution } : {}),
    };
}

async function persistAuthority(playerName: string, receipt: PetAttemptReceipt): Promise<void> {
    // The player-scoped pointer is written first. If the process dies between
    // these writes, another device can still recover the exact hit OR miss and
    // help-forward the request/token rows instead of rerolling or spending a
    // second daily attempt.
    await kv.set(petEncounterActiveKey(playerName), {
        playerName,
        requestId: receipt.requestId,
        outcome: receipt.token ? 'hit' : 'miss',
        ...(receipt.token && receipt.pet ? { token: receipt.token, pet: receipt.pet } : {}),
        sector: receipt.sector,
        mintedAt: receipt.mintedAt,
    }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
    await kv.set(petEncounterRequestKey(playerName, receipt.requestId), receipt, { ex: ATTEMPT_RECEIPT_TTL_SECONDS });
    if (!receipt.token || !receipt.pet) return;
    const tokenKey = `pet-encounter:${playerName}:${receipt.token}`;
    const prior = await kv.get<Record<string, unknown>>(tokenKey);
    await kv.set(tokenKey, {
        ...prior,
        playerName,
        token: receipt.token,
        pet: receipt.pet,
        sector: receipt.sector,
        mintedAt: receipt.mintedAt,
        requestId: receipt.requestId,
    }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
}

function responseFor(receipt: PetAttemptReceipt, replayed: boolean, worldExploreRequestId?: string) {
    const terminal = Boolean(receipt.resolvedAt);
    return {
        requestId: receipt.requestId,
        ...(!terminal && receipt.token ? { token: receipt.token } : {}),
        pet: !terminal ? receipt.pet ?? null : null,
        sector: receipt.sector,
        replayed,
        ...(terminal ? { resolved: true, resolution: receipt.resolution } : {}),
        ...(worldExploreRequestId || receipt.worldExploreRequestId
            ? { worldExploreRequestId: worldExploreRequestId || receipt.worldExploreRequestId }
            : {}),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanRequestId(body.requestId);
        const identity = playerName ? await authedPlayerOrAdmin(req, playerName) : null;
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your encounter.' });
        if (!requestId && !identity.admin) return res.status(400).json({ error: 'A stable encounter requestId is required.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-encounter-start', 180, 60_000, identity.name))) return;
        const sector = Math.floor(Number(body.sector));
        if (!isWildSector(sector)) return res.status(400).json({ error: 'Invalid encounter sector.' });
        const stableRequestId = requestId || `admin_${randomUUID().replace(/-/g, '')}`;
        const activeKey = petEncounterActiveKey(playerName);
        const outcome = await withKvLock(activeKey, async () => {
            const active = cleanPetEncounterPointer(await kv.get(activeKey));
            if (active && active.playerName.toLowerCase() === playerName.toLowerCase()) {
                let activeReceipt: PetAttemptReceipt = cleanReceipt(await kv.get(
                    petEncounterRequestKey(playerName, active.requestId),
                )) ?? {
                    version: 1,
                    playerName,
                    requestId: active.requestId,
                    day: new Date(active.mintedAt).toISOString().slice(0, 10),
                    sector: active.sector,
                    mintedAt: active.mintedAt,
                    ...(active.outcome === 'hit' && active.token && active.pet
                        ? { token: active.token, pet: active.pet }
                        : {}),
                };
                if (Date.now() - activeReceipt.mintedAt >= ATTEMPT_RECEIPT_TTL_SECONDS * 1_000) {
                    activeReceipt = { ...activeReceipt, resolvedAt: Date.now(), resolution: 'expired' };
                    await kv.set(petEncounterRequestKey(playerName, activeReceipt.requestId), activeReceipt, { ex: ATTEMPT_RECEIPT_TTL_SECONDS });
                    if (active.token) await kv.del(`pet-encounter:${playerName}:${active.token}`).catch(() => undefined);
                    await kv.del(activeKey).catch(() => undefined);
                    return responseFor(activeReceipt, true);
                }
                await persistAuthority(playerName, activeReceipt);
                const encounter = active.token
                    ? await kv.get<Record<string, unknown>>(`pet-encounter:${playerName}:${active.token}`)
                    : null;
                const bound = typeof encounter?.exploreReceiptId === 'string' ? encounter.exploreReceiptId : undefined;
                return responseFor(activeReceipt, true, bound);
            } else if (active) {
                await kv.del(activeKey).catch(() => undefined);
            }

            const prior = cleanReceipt(await kv.get(petEncounterRequestKey(playerName, stableRequestId)));
            if (prior) {
                if (!prior.resolvedAt && Date.now() - prior.mintedAt < ATTEMPT_RECEIPT_TTL_SECONDS * 1_000) {
                    await persistAuthority(playerName, prior);
                    return responseFor(prior, true);
                }
                if (!prior.resolvedAt) {
                    const expired: PetAttemptReceipt = { ...prior, resolvedAt: Date.now(), resolution: 'expired' };
                    await kv.set(petEncounterRequestKey(playerName, stableRequestId), expired, { ex: ATTEMPT_RECEIPT_TTL_SECONDS });
                    if (prior.token) await kv.del(`pet-encounter:${playerName}:${prior.token}`).catch(() => undefined);
                    return responseFor(expired, true);
                }
                return responseFor(prior, true);
            }

            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const savedCharacter = save?.character as Record<string, unknown> | undefined;
            const pendingDungeonMiss = savedCharacter ? unresolvedFreeDungeonMiss(savedCharacter) : null;
            if (pendingDungeonMiss
                && (pendingDungeonMiss.requestId !== stableRequestId || pendingDungeonMiss.sector !== sector)) {
                return {
                    error: 'pending-dungeon-discovery',
                    status: 409,
                    reason: 'pending-dungeon-discovery',
                    requestId: pendingDungeonMiss.requestId,
                    sector: pendingDungeonMiss.sector,
                };
            }
            if (!pendingDungeonMiss) {
                const presenceBlock = sectorPresenceBlock(playerName, sector);
                if (presenceBlock && !identity.admin) {
                    return { error: presenceBlock.error, status: presenceBlock.status, reason: presenceBlock.reason };
                }
            }
            const day = new Date().toISOString().slice(0, 10);
            const keys = await kv.keys(`pet-encounter-request:${playerName}:*`);
            const rows = keys.length ? await kv.mget<Array<unknown>>(...keys) : [];
            const durableAttempts = rows.map(cleanReceipt).filter((row) => row?.day === day).length;
            const legacyAttempts = Math.max(0, Math.floor(Number(await kv.get(`pet-encounter-attempt:${playerName}:${day}`)) || 0));
            if (!identity.admin && legacyAttempts + durableAttempts >= DAILY_WILD_ENCOUNTER_ATTEMPTS) {
                return { error: 'Daily exploration limit reached.', status: 429 };
            }
            const pet = rollWildPet(() => randomInt(1_000_000_000) / 1_000_000_000);
            const receipt: PetAttemptReceipt = {
                version: 1,
                playerName,
                requestId: stableRequestId,
                day,
                sector,
                mintedAt: Date.now(),
                ...(pet ? { token: randomUUID().replace(/-/g, ''), pet } : {}),
            };
            await persistAuthority(playerName, receipt);
            return responseFor(receipt, false);
        }, { failClosed: true });
        if ('error' in outcome) return res.status(Math.floor(Number(outcome.status) || 500)).json({
            error: outcome.error,
            reason: outcome.reason,
            ...('requestId' in outcome ? { requestId: outcome.requestId } : {}),
            ...('sector' in outcome ? { sector: outcome.sector } : {}),
        });
        return res.status(200).json({ ok: true, ...outcome });
    } catch (error) {
        console.error('[pet/encounter-start]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

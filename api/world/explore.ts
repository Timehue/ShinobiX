import { safeLogValue } from '../_safe-log.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applySectorExploreReward, rollSectorExploreOutcome } from './_explore.js';
import { DAILY_ANCIENT_CHEST_LIMIT } from './_chest.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import {
    cleanPetEncounterPointer,
    petEncounterActiveKey,
    petEncounterRequestKey,
    PET_ENCOUNTER_POINTER_TTL_SECONDS,
} from '../pet/_encounter-pointer.js';
import { resolveFreeDungeonMiss, unresolvedFreeDungeonMiss } from '../dungeon/_run.js';
import {
    cleanWorldExploreAuthorityReceipt,
    WORLD_EXPLORE_RECEIPT_TTL_SECONDS,
    worldExploreAuthorityKey,
    type WorldExploreAuthorityReceipt,
} from './_explore-authority.js';
import { creditFieldExploreProgress } from '../missions/_field-explore-progress.js';

function cleanRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

type ExternalExploreProof = { kind: 'dungeon' | 'pet'; token: string };

function cleanExternalExploreProof(value: unknown): ExternalExploreProof | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const kind = raw.kind === 'dungeon' || raw.kind === 'pet' ? raw.kind : null;
    const token = typeof raw.token === 'string' ? raw.token.trim().slice(0, 96) : '';
    return kind && /^[A-Za-z0-9]{8,96}$/.test(token) ? { kind, token } : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const requestId = cleanRequestId(body.requestId);
        if (!playerName || !requestId) return res.status(400).json({ error: 'Invalid player or request id.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your exploration.' });
        const durableKey = worldExploreAuthorityKey(playerName, requestId);
        const durable = cleanWorldExploreAuthorityReceipt(await kv.get(durableKey));
        if (durable && (durable.playerName.toLowerCase() !== playerName.toLowerCase()
            || durable.sector !== Math.floor(Number(body.sector)))) {
            return res.status(409).json({ error: 'That exploration request id is already bound to another sector.' });
        }
        // Exact lost-ACK replay bypasses the new-action throttle.
        if (!durable && !identity.admin && !(await enforceRateLimitKv(req, res, 'world-explore', 180, 60_000, identity.name))) return;

        // The wild pays out only to someone actually standing in it — the same
        // rule attacking already follows. Without this, a client can report
        // sector 0 (unattackable town presence) and still farm the field.
        const today = new Date().toISOString().slice(0, 10);
        const externalProof = cleanExternalExploreProof(body.externalOutcomeProof);
        if (body.externalOutcomeProof != null && !externalProof) {
            return res.status(400).json({ error: 'Invalid external exploration proof.' });
        }
        // Non-admin callers cannot select the profitable branch. An omitted or
        // false flag is treated as a request for the server roll, which keeps a
        // rolling deploy safe without preserving the old trust boundary.
        const resolveOutcome = identity.admin ? body.resolveOutcome === true : !externalProof;
        const activePetKey = petEncounterActiveKey(playerName);
        const result = await withKvLock(activePetKey, async () => {
            const mutation = await mutatePlayerSave(playerName, async ({ character }) => {
            const receipts = Array.isArray(character.redeemedSectorExplorations)
                ? (character.redeemedSectorExplorations as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry.id === 'string')
                : [];
            const activePet = cleanPetEncounterPointer(await kv.get(activePetKey));
            const pendingDungeonMiss = unresolvedFreeDungeonMiss(character);
            const prior = receipts.find((entry) => entry.id === requestId);
            if (prior || durable) {
                const authority = prior ?? durable!;
                const replayCharacter = pendingDungeonMiss?.requestId === requestId
                    ? resolveFreeDungeonMiss(character, requestId)
                    : character;
                return {
                ok: true as const,
                character: replayCharacter,
                value: {
                    reward: authority.reward,
                    outcome: authority.outcome,
                    replayed: true,
                    exploreReceiptAt: Number(authority.at),
                    ...(activePet?.outcome === 'miss'
                        && activePet.requestId === requestId
                        && activePet.sector === Number(authority.sector)
                        ? { petMissRequestId: activePet.requestId }
                        : durable?.petMissRequestId ? { petMissRequestId: durable.petMissRequestId }
                        : {}),
                },
                write: replayCharacter === character ? false as const : true,
                };
            }
            let petMissRequestId = '';
            if (pendingDungeonMiss && pendingDungeonMiss.requestId !== requestId) {
                return {
                    ok: false as const,
                    status: 409,
                    error: JSON.stringify({
                        error: 'pending-dungeon-discovery',
                        reason: 'pending-dungeon-discovery',
                        requestId: pendingDungeonMiss.requestId,
                        sector: pendingDungeonMiss.sector,
                    }),
                };
            }
            if (!externalProof) {
                const activeDungeon = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
                    ? character.activeDungeonRun as Record<string, unknown>
                    : null;
                if (activeDungeon?.entry === 'free' && activeDungeon.token && !activeDungeon.exploreReceiptId) {
                    return { ok: false as const, status: 409, error: 'pending-dungeon-discovery' };
                }
                if (activePet && activePet.playerName.toLowerCase() === playerName.toLowerCase()) {
                    if (activePet.outcome === 'miss') {
                        if (activePet.requestId !== requestId
                            || activePet.sector !== Math.floor(Number(body.sector))) {
                            return {
                                ok: false as const,
                                status: 409,
                                error: JSON.stringify({
                                    error: 'pending-pet-discovery',
                                    reason: 'pending-pet-discovery',
                                    requestId: activePet.requestId,
                                    sector: activePet.sector,
                                }),
                            };
                        }
                        petMissRequestId = activePet.requestId;
                    } else if (activePet.token && activePet.pet) {
                        const tokenKey = `pet-encounter:${playerName}:${activePet.token}`;
                        let activeToken = await kv.get<Record<string, unknown>>(tokenKey);
                        if (!activeToken) {
                            activeToken = {
                                playerName,
                                token: activePet.token,
                                pet: activePet.pet,
                                sector: activePet.sector,
                                mintedAt: activePet.mintedAt,
                                requestId: activePet.requestId,
                            };
                            await kv.set(tokenKey, activeToken, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                        }
                        const boundReceiptId = typeof activeToken?.exploreReceiptId === 'string' ? activeToken.exploreReceiptId : '';
                        const settled = boundReceiptId && receipts.some((entry) => entry.id === boundReceiptId);
                        return {
                            ok: false as const,
                            status: 409,
                            error: settled ? 'pending-pet-choice' : 'pending-pet-discovery',
                        };
                    }
                }
                // Presence authorizes a NEW ordinary exploration. A sealed pet
                // or dungeon token already proved presence at its own sector,
                // so ACK-loss recovery may settle after movement/reconnect.
                if (!petMissRequestId && !pendingDungeonMiss) {
                    const presenceBlock = sectorPresenceBlock(playerName, body.sector);
                    if (presenceBlock && !identity.admin) {
                        return { ok: false as const, status: presenceBlock.status, error: presenceBlock.error };
                    }
                }
            }
            let authorityCharacter = character;
            if (externalProof?.kind === 'dungeon') {
                const active = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
                    ? character.activeDungeonRun as Record<string, unknown>
                    : null;
                if (!active
                    || active.entry !== 'free'
                    || active.token !== externalProof.token
                    || Number(active.sector) !== Math.floor(Number(body.sector))) {
                    return { ok: false as const, status: 409, error: 'missing-dungeon-discovery' };
                }
                const boundReceiptId = typeof active.exploreReceiptId === 'string' ? active.exploreReceiptId : '';
                if (boundReceiptId && boundReceiptId !== requestId) {
                    return { ok: false as const, status: 409, error: 'dungeon-discovery-already-used' };
                }
                authorityCharacter = {
                    ...character,
                    activeDungeonRun: { ...active, exploreReceiptId: requestId },
                };
            } else if (externalProof?.kind === 'pet') {
                const key = `pet-encounter:${playerName}:${externalProof.token}`;
                const raw = await kv.get<Record<string, unknown>>(key);
                if (!raw
                    || String(raw.playerName ?? '').toLowerCase() !== playerName.toLowerCase()
                    || Number(raw.sector) !== Math.floor(Number(body.sector))) {
                    return { ok: false as const, status: 409, error: 'missing-pet-discovery' };
                }
                const boundReceiptId = typeof raw.exploreReceiptId === 'string' ? raw.exploreReceiptId : '';
                if (boundReceiptId && boundReceiptId !== requestId) {
                    return { ok: false as const, status: 409, error: 'pet-discovery-already-used' };
                }
                if (!boundReceiptId) {
                    const bound = { ...raw, exploreReceiptId: requestId };
                    const committed = await kv.compareSet(key, raw, bound, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    if (!committed) {
                        const readback = await kv.get<Record<string, unknown>>(key);
                        if (readback?.exploreReceiptId !== requestId) {
                            return { ok: false as const, status: 409, error: 'pet-discovery-already-used' };
                        }
                    }
                }
            }
            const storedChestDate = typeof character.serverChestDate === 'string' ? character.serverChestDate : '';
            const chestsToday = storedChestDate === today
                ? Math.max(0, Math.floor(Number(character.serverChestsToday) || 0))
                : 0;
            const rolledOutcome = resolveOutcome
                ? rollSectorExploreOutcome(
                    () => randomInt(1_000_000_000) / 1_000_000_000,
                    chestsToday < DAILY_ANCIENT_CHEST_LIMIT,
                )
                : externalProof
                    ? { kind: 'external' as const, source: externalProof.kind }
                    : undefined;
            // Discovering a chest reserves that day's finite slot in this same
            // save mutation. Opening later only consumes the sealed discovery;
            // players cannot bank unlimited chest outcomes before cashing them.
            const outcome = rolledOutcome?.kind === 'chest'
                ? {
                    ...rolledOutcome,
                    reservationDate: today,
                    reservationOrdinal: chestsToday + 1,
                }
                : rolledOutcome;
            // Once the server resolves the branch, a chest or battle counts as
            // the explored tile but cannot also collect the quiet-tile ryo.
            // Legacy pet/dungeon callers may still explicitly request `tile`.
            const credit = externalProof
                ? 'tile' as const
                : resolveOutcome
                    ? (outcome?.kind === 'none' ? 'full' as const : 'tile' as const)
                    : (body.credit === 'tile' ? 'tile' as const : 'full' as const);
            const applied = applySectorExploreReward(authorityCharacter, body.sector, today, credit);
            if (!applied.ok) return { ok: false as const, status: 409, error: applied.reason };
            const exploredAt = Date.now();
            const receipt = {
                id: requestId,
                sector: applied.reward.sector,
                reward: applied.reward,
                ...(outcome ? { outcome } : {}),
                at: exploredAt,
            };
            const nextCharacterBeforeDungeonResolution = outcome?.kind === 'chest'
                ? {
                    ...applied.character,
                    serverChestDate: today,
                    serverChestsToday: chestsToday + 1,
                }
                : applied.character;
            const nextCharacter = resolveFreeDungeonMiss(nextCharacterBeforeDungeonResolution, requestId);
            return {
                ok: true as const,
                character: { ...nextCharacter, redeemedSectorExplorations: [...receipts.slice(-149), receipt] },
                value: {
                    reward: applied.reward,
                    outcome,
                    replayed: false,
                    exploreReceiptAt: exploredAt,
                    ...(petMissRequestId ? { petMissRequestId } : {}),
                },
            };
            });
            if (mutation.ok && 'petMissRequestId' in mutation.value && mutation.value.petMissRequestId) {
                const active = cleanPetEncounterPointer(await kv.get(activePetKey));
                if (active?.outcome === 'miss' && active.requestId === mutation.value.petMissRequestId) {
                    const receiptKey = petEncounterRequestKey(playerName, active.requestId);
                    const priorAttempt = await kv.get<Record<string, unknown>>(receiptKey);
                    await kv.set(receiptKey, {
                        version: 1,
                        playerName,
                        requestId: active.requestId,
                        day: new Date(active.mintedAt).toISOString().slice(0, 10),
                        sector: active.sector,
                        mintedAt: active.mintedAt,
                        ...priorAttempt,
                        resolvedAt: Date.now(),
                        resolution: 'explored-miss',
                        worldExploreRequestId: requestId,
                    }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    await kv.del(activePetKey);
                }
            }
            return mutation;
        }, { failClosed: true });
        if (!result.ok) {
            try {
                const details = JSON.parse(result.error) as Record<string, unknown>;
                if (details && typeof details.error === 'string') return res.status(result.status).json(details);
            } catch { /* plain error */ }
            return res.status(result.status).json({ error: result.error, reason: result.error });
        }
        let authority = durable;
        try {
            if (!authority) {
                authority = {
                    version: 1,
                    playerName,
                    requestId,
                    sector: Math.floor(Number((result.value.reward as Record<string, unknown>)?.sector ?? body.sector)),
                    reward: result.value.reward as Record<string, unknown>,
                    ...(result.value.outcome && typeof result.value.outcome === 'object'
                        ? { outcome: result.value.outcome as Record<string, unknown> }
                        : {}),
                    ...('petMissRequestId' in result.value && typeof result.value.petMissRequestId === 'string'
                        ? { petMissRequestId: result.value.petMissRequestId }
                        : {}),
                    at: Math.floor(Number(result.value.exploreReceiptAt) || Date.now()),
                } satisfies WorldExploreAuthorityReceipt;
                await kv.set(durableKey, authority, { ex: WORLD_EXPLORE_RECEIPT_TTL_SECONDS });
            }
            const fieldProgress = await creditFieldExploreProgress({
                playerName,
                requestId,
                sector: authority.sector,
                proofAt: authority.at,
            });
            return res.status(200).json({ ok: true, ...result.value, fieldProgress, character: result.character, _saveVersion: result._saveVersion });
        } catch (sideEffectError) {
            console.error('[world/explore] durable settlement pending', safeLogValue(sideEffectError));
            return res.status(503).json({ error: 'Exploration settlement is still finalizing.', retryable: true, requestId });
        }
    } catch (error) {
        console.error('[world/explore]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAiFightProfile } from './_ai-fight-encounter.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { readSoloPveSession, soloPveSessionKey, writeSoloPveSession } from '../solo-pve/_store.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { resolveAiFightScaling } from './_ai-fight-scaling.js';
import {
    EXPLORE_BATTLE_MARKER_TTL_SECONDS,
    exploreBattleMarkerKey,
    releaseRaidAiTokenReservation,
    reserveRaidAiToken,
    resolveGenericAiFightAuthority,
    type GenericAiFightAuthority,
} from './_generic-ai-fight-authority.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import {
    AI_FIGHT_TOKEN_TTL_SECONDS,
    aiFightTokenKey,
    computeAiFightBaseReward,
    createAiFightTokenRecord,
    type AiFightToken,
} from './_ai-fight-token.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { settleMaturedTravelForAction } from '../_realtime/travel-lease.js';
import {
    WORLD_AI_ACTIVE_TTL_SECONDS,
    WORLD_AI_FIGHT_TTL_SECONDS,
    applyWorldChainHeal,
    buildWorldAiFightSpec,
    cleanWorldAiActivePointer,
    cleanWorldAiPendingChain,
    cleanWorldAiPendingOutcome,
    cleanWorldAiFightRequest,
    newWorldChainId,
    releaseWorldAiChainStage,
    repairWorldAiChainForPending,
    reserveWorldAiChainStage,
    sameWorldAiFightRequest,
    worldAiActiveKey,
    type WorldAiFightSpec,
} from './_world-ai-fight.js';
import type { WorldAiFightActivePointer, WorldAiFightContext } from '../../shared/world-ai-fight.js';
import {
    claimWandererUseCooldown,
    WANDERER_ENCOUNTER_COOLDOWN_MS,
    withWandererUseState,
} from '../sector/_wanderer-encounter.js';

type AiFightActivePointer = {
    playerName: string;
    token: string;
    sessionId: string;
    createdAt: number;
};

const aiFightActiveKey = (playerName: string) => `ai-fight-active:${playerName}`;
const aiFightStartLeaseKey = (playerName: string) => `ai-fight-start-lease:${playerName}`;

function cleanAiFightActivePointer(raw: unknown): AiFightActivePointer | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<AiFightActivePointer>;
    if (typeof value.playerName !== 'string'
        || typeof value.token !== 'string' || !/^[A-Za-z0-9]{8,96}$/.test(value.token)
        || typeof value.sessionId !== 'string' || !/^[A-Za-z0-9:_-]{8,96}$/.test(value.sessionId)
        || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) <= 0) return null;
    return value as AiFightActivePointer;
}

async function ensureExploreBattleMarker(
    playerName: string,
    receiptId: string,
    token: string,
    sessionId: string,
): Promise<boolean> {
    const key = exploreBattleMarkerKey(playerName, receiptId);
    const existing = await kv.get<Record<string, unknown>>(key);
    if (existing) {
        if (existing.token === token && existing.sessionId === sessionId) return false;
        throw new Error('That exploration encounter was already started.');
    }
    const marker = { playerName, token, sessionId, at: Date.now() };
    let acknowledged: 'OK' | null;
    try {
        acknowledged = await kv.set(key, marker, {
            ex: EXPLORE_BATTLE_MARKER_TTL_SECONDS,
            nx: true,
        });
    } catch (error) {
        const readback = await kv.get<Record<string, unknown>>(key).catch(() => null);
        // The write can commit even when its acknowledgement is lost. Since a
        // freshly minted AI token/session is unique to this start attempt, a
        // matching readback was created by this call and must be included in
        // compensating cleanup if a later persistence step fails.
        if (readback?.token === token && readback.sessionId === sessionId) return true;
        throw error;
    }
    if (acknowledged === 'OK') return true;
    const readback = await kv.get<Record<string, unknown>>(key);
    if (readback?.token === token && readback.sessionId === sessionId) return true;
    throw new Error('That exploration encounter was already started.');
}

async function recoverAiFight(playerName: string): Promise<{ pointer: AiFightActivePointer; token: AiFightToken; session: SoloPveSession } | null> {
    const key = aiFightActiveKey(playerName);
    const pointer = cleanAiFightActivePointer(await kv.get(key));
    if (!pointer || pointer.playerName.toLowerCase() !== playerName.toLowerCase()) {
        if (pointer) await kv.del(key).catch(() => undefined);
        return null;
    }
    const [token, session] = await Promise.all([
        kv.get<AiFightToken>(aiFightTokenKey(playerName, pointer.token)),
        readSoloPveSession(pointer.sessionId),
    ]);
    if (!token || !session || token.sessionId !== pointer.sessionId) {
        await kv.del(key).catch(() => undefined);
        return null;
    }
    if (token.worldExploreRequestId) {
        await ensureExploreBattleMarker(
            playerName,
            token.worldExploreRequestId,
            pointer.token,
            pointer.sessionId,
        );
    }
    return { pointer, token, session };
}

function genericStartBody(recovered: { pointer: AiFightActivePointer; token: AiFightToken; session: SoloPveSession }, resumed: boolean) {
    return {
        ok: true,
        token: recovered.pointer.token,
        expiresInSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
        maxXp: recovered.token.maxXp,
        maxRyo: recovered.token.maxRyo,
        baseXp: recovered.token.baseXp ?? 0,
        baseRyo: recovered.token.baseRyo ?? 0,
        sessionId: recovered.pointer.sessionId,
        session: recovered.session,
        opponentId: recovered.token.opponentId ?? '',
        battleKind: recovered.token.battleKind ?? 'practice',
        sector: recovered.token.sector ?? null,
        worldExploreRequestId: recovered.token.worldExploreRequestId ?? null,
        raidToken: recovered.token.raidTokenId ?? null,
        dungeonRunToken: recovered.token.dungeonRunToken ?? null,
        opponentName: String(recovered.session.enemy?.name ?? ''),
        resumed,
    };
}

/*
 * /api/missions/ai-fight-start - POST only
 *
 * Mints a single-use token for one AI-fight reward report. The report endpoint
 * consumes this token and only accepts XP/ryo claims within the sealed ceilings,
 * so a direct client report can no longer mint arbitrary rewards.
 *
 * It ALSO seals a real server-resolved encounter for the fight (step 2 of
 * docs/runbooks/combat-mode-migration.md) and returns its mandatory standalone
 * solo-PvE session. The token is minted only after that authority is persisted.
 */

/**
 * Build and persist the mandatory standalone encounter for this fight.
 *
 * The session is returned because the client's server-combat screen
 * (`MissionArenaFight`) takes `initialSession` as a required prop. The sealed
 * session carries combat fields but no art,
 * so this adds no image payload.
 *
 * Unknown opponents are rejected; persistence failures propagate to the route's
 * fail-closed error response. No client-resolved combat path exists here.
 */
async function sealAiFightEncounter(
    playerName: string,
    body: Record<string, unknown>,
    rawSave: Record<string, unknown>,
    worldSpec?: WorldAiFightSpec,
    genericAuthority?: GenericAiFightAuthority,
): Promise<{ sessionId: string; session: SoloPveSession } | null> {
        const profile = worldSpec?.profile ?? genericAuthority?.profile ?? await loadAiFightProfile(body.opponentId);
        if (!profile) return null;
        // Same augmentation combat-start applies, so a forged weapon resolves to
        // its real definition instead of being dropped from the sealed loadout.
        const save = await augmentSaveWithForgedDefs(rawSave);
        if (!save?.character) throw new Error('Authoritative player save is unavailable.');
        const sessionId = `aifight-${randomUUID().replace(/-/g, '')}`;
        // Step 3c: scaling from SERVER state. `body.opponentLevel` is never read
        // for the encounter — a client-chosen level is a client-chosen
        // difficulty. Combat missions are the only entry point that re-levels
        // its opponent (see _ai-fight-scaling.ts); everything else resolves to
        // undefined and is built at its authored level, matching the client.
        const scaling = worldSpec ? undefined : genericAuthority?.scaling ?? resolveAiFightScaling({
            opponentId: body.opponentId,
            battleKind: body.battleKind,
            playerLevel: (save.character as Record<string, unknown> | undefined)?.level,
        });
        const session = buildSoloPveAiEncounter({
            playerName,
            save,
            profile,
            sessionId,
            now: Date.now(),
            ...(scaling ? { scaling } : {}),
            ...(worldSpec ? {
                environment: worldSpec.environment,
                encounter: {
                    kind: 'world-ai',
                    id: worldSpec.context.kind,
                    sourceId: worldSpec.context.sourceId,
                    bindingId: worldSpec.context.chainId ?? worldSpec.context.decisionId,
                    metadata: { sector: worldSpec.context.sector, stage: worldSpec.context.stage },
                },
            } : {}),
            admin: await loadAdminCombatContent(),
        });
        await writeSoloPveSession(session);
        return { sessionId, session };
}

function isNaturalWorldEncounter(context: WorldAiFightContext): boolean {
    return (context.kind === 'wanderer' && context.sourceId !== 'nemesis')
        || context.kind === 'patrol';
}

async function ensureNaturalWorldEncounterClaim(
    playerName: string,
    context: WorldAiFightContext,
    token: string,
): Promise<void> {
    if (!isNaturalWorldEncounter(context)) return;
    const proofId = `world-ai:${token}`;
    const claim = await claimWandererUseCooldown(kv, playerName, context.sourceId, Date.now(), proofId);
    if (!claim.ok) throw new Error('That wanderer has already moved on.');
    const claimAt = claim.cooldownUntil - WANDERER_ENCOUNTER_COOLDOWN_MS;
    const moved = await mutatePlayerSave(playerName, ({ character }) => {
        const next = withWandererUseState(character, context.sourceId, claimAt, context.sector);
        const cooldowns = character.wandererCooldowns && typeof character.wandererCooldowns === 'object'
            ? character.wandererCooldowns as Record<string, unknown>
            : {};
        const moves = character.wandererMoves && typeof character.wandererMoves === 'object'
            ? character.wandererMoves as Record<string, unknown>
            : {};
        const alreadyApplied = Number(cooldowns[context.sourceId]) === claim.cooldownUntil
            && Number(moves[context.sourceId]) === next.moveToSector;
        return {
            ok: true as const,
            character: alreadyApplied ? character : next.character,
            value: null,
            write: !alreadyApplied,
        };
    });
    if (!moved.ok) throw new Error(moved.error);
}

async function recoverWorldFight(playerName: string): Promise<{
    pointer: WorldAiFightActivePointer;
    token: AiFightToken;
    session: SoloPveSession;
} | null> {
    const key = worldAiActiveKey(playerName);
    const pointer = cleanWorldAiActivePointer(await kv.get(key));
    if (!pointer || pointer.playerName.toLowerCase() !== playerName.toLowerCase()) {
        if (pointer) await kv.del(key).catch(() => undefined);
        return null;
    }
    const [token, session] = await Promise.all([
        kv.get<AiFightToken>(aiFightTokenKey(playerName, pointer.token)),
        readSoloPveSession(pointer.sessionId),
    ]);
    if (!token || !session || token.sessionId !== pointer.sessionId) {
        await releaseWorldAiChainStage(playerName, pointer.context).catch(() => undefined);
        await kv.del(key).catch(() => undefined);
        return null;
    }
    await ensureNaturalWorldEncounterClaim(playerName, pointer.context, pointer.token);
    return { pointer, token, session };
}

function worldStartBody(recovered: {
    pointer: WorldAiFightActivePointer;
    token: AiFightToken;
    session: SoloPveSession;
}, resumed: boolean) {
    return {
        ok: true,
        token: recovered.pointer.token,
        expiresInSeconds: WORLD_AI_FIGHT_TTL_SECONDS,
        maxXp: recovered.token.maxXp,
        maxRyo: recovered.token.maxRyo,
        baseXp: recovered.token.baseXp ?? 0,
        baseRyo: recovered.token.baseRyo ?? 0,
        sessionId: recovered.pointer.sessionId,
        session: recovered.session,
        worldContext: recovered.pointer.context,
        resumed,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own AI fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'ai-fight-start', 30, 60_000, identity.name))) return;
        if (!identity.admin && await findTowerBattleStartConflict([playerName])) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }

        const worldRequest = cleanWorldAiFightRequest(body.worldEncounter);
        const resumeWorldFight = body.resumeWorldFight === true;
        const resumeAiFight = body.resumeAiFight === true;
        // Only clients that understand an empty successful response opt in to
        // 204. Older cached bundles still receive their established 404 so a
        // rolling deployment cannot turn "nothing to resume" into a parse error.
        const noContentRecoveryProbe = Number(body.recoveryProbeVersion) >= 2;
        if (body.worldEncounter != null && !worldRequest) {
            return res.status(400).json({ error: 'Invalid world encounter descriptor.' });
        }
        if (resumeWorldFight || worldRequest) {
            const response = await withKvLock(aiFightStartLeaseKey(playerName), async () => {
                const generic = await recoverAiFight(playerName);
                if (generic) return { status: 409, body: { error: 'Another AI encounter is already active.', resumable: true, mode: 'generic' } };
                const recovered = await recoverWorldFight(playerName);
                if (recovered) return { status: 200, body: worldStartBody(recovered, true) };

                const worldStartNow = Date.now();
                const arrivedSector = worldRequest
                    ? await settleMaturedTravelForAction(playerName, worldStartNow)
                    : null;
                let save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                if (save && arrivedSector != null) save = { ...save, currentSector: arrivedSector };
                let character = (save?.character ?? null) as Record<string, unknown> | null;
                if (!save || !character) return { status: 404, body: { error: 'Player save not found.' } };
                const pendingChain = cleanWorldAiPendingChain(character.worldAiPendingChain);
                const pendingOutcome = cleanWorldAiPendingOutcome(character.worldAiPendingOutcome);
                if (resumeWorldFight && !worldRequest) {
                    if (pendingChain) return { status: 200, body: { ok: true, resumed: true, pendingWorldChain: pendingChain } };
                    if (pendingOutcome) {
                        return { status: 200, body: {
                            ok: true,
                            resumed: true,
                            pendingWorldOutcome: {
                                ...pendingOutcome,
                                action: 'claim',
                                endpoint: '/api/sector/wanderer-ambush',
                            },
                        } };
                    }
                    return noContentRecoveryProbe
                        ? { status: 204, body: { error: 'No active World encounter.' } }
                        : { status: 404, body: { error: 'No active World encounter.' } };
                }
                if (worldRequest && pendingChain) {
                    if (!sameWorldAiFightRequest(worldRequest, pendingChain.request)) {
                        return { status: 409, body: { error: 'A chained World encounter must continue at its sealed next stage.', pendingWorldChain: pendingChain } };
                    }
                }

                const generatedChainId = newWorldChainId();
                let worldSpec: WorldAiFightSpec;
                try {
                    // Validate the complete encounter, including chain kind/source/
                    // sector binding, before any heal or cooldown mutates the save.
                    worldSpec = await buildWorldAiFightSpec({
                        playerName,
                        request: worldRequest!,
                        save,
                        generatedChainId,
                        now: worldStartNow,
                    });
                } catch (error) {
                    return { status: 409, body: { error: error instanceof Error ? error.message : 'World encounter is no longer reachable.' } };
                }

                // A validated chained wave uses only its prior sealed win as
                // permission and persists its one-third heal exactly once.
                if (worldSpec.context.chainId && worldSpec.context.stage > 0) {
                    const healed = await mutatePlayerSave(playerName, ({ character: fresh }) => {
                        try {
                            const next = applyWorldChainHeal(fresh, worldRequest!);
                            return { ok: true as const, character: next, value: null, write: next !== fresh };
                        } catch (error) {
                            return { ok: false as const, status: 409, error: error instanceof Error ? error.message : 'World chain proof is missing.' };
                        }
                    });
                    if (!healed.ok) return { status: healed.status, body: { error: healed.error } };
                    save = healed.record;
                    character = healed.character;
                }

                const reward = computeAiFightBaseReward(character);
                try {
                    if (pendingChain && worldRequest && sameWorldAiFightRequest(worldRequest, pendingChain.request)) {
                        await repairWorldAiChainForPending(playerName, character, pendingChain);
                    }
                    await reserveWorldAiChainStage(playerName, worldSpec.context);
                } catch (error) {
                    return { status: 409, body: { error: error instanceof Error ? error.message : 'World chain is already active.' } };
                }
                let sealedAttempt: { sessionId: string; session: SoloPveSession } | null = null;
                let tokenAttempt = '';
                try {
                    sealedAttempt = await sealAiFightEncounter(playerName, body, save, worldSpec);
                    if (!sealedAttempt) throw new Error('World opponent could not be reconstructed.');

                    const token = randomUUID().replace(/-/g, '');
                    tokenAttempt = token;
                    const record = createAiFightTokenRecord(playerName, token, Date.now(), {
                        opponentId: worldSpec.profile.id,
                        opponentLevel: worldSpec.profile.level,
                        baseXp: reward.xp,
                        baseRyo: reward.ryo,
                        battleKind: 'world',
                        sessionRuntime: 'solo-pve',
                        sessionId: sealedAttempt.sessionId,
                        worldContext: worldSpec.context,
                        rewardTrait: reward.trait,
                    });
                    await kv.set(aiFightTokenKey(playerName, token), record, { ex: WORLD_AI_FIGHT_TTL_SECONDS });
                    const pointer: WorldAiFightActivePointer = {
                        playerName,
                        token,
                        sessionId: sealedAttempt.sessionId,
                        context: worldSpec.context,
                        createdAt: Date.now(),
                    };
                    await kv.set(worldAiActiveKey(playerName), pointer, { ex: WORLD_AI_ACTIVE_TTL_SECONDS });
                    if (worldRequest!.kind === 'wanderer-ambush' && (worldRequest!.stage ?? 0) === 0) {
                        await kv.set(`wanderer-ambush:${playerName}`, {
                            baseline: Number(character.totalAiKills ?? 0),
                            at: Date.now(),
                            authority: 'world-ai-chain',
                            chainId: worldSpec.context.chainId,
                            kind: worldSpec.context.kind,
                            sourceId: worldSpec.context.sourceId,
                            sector: worldSpec.context.sector,
                        }, { ex: 60 * 60 });
                    }
                    // Claim/relocate a natural wanderer only after every other
                    // fallible start write is durable. A process death before
                    // this line is healed by recoverWorldFight; after it, the
                    // active pointer guarantees the same fight can resume.
                    await ensureNaturalWorldEncounterClaim(playerName, worldSpec.context, token);
                    return { status: 200, body: { ...worldStartBody({ pointer, token: record, session: sealedAttempt.session }, false), trait: reward.trait } };
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'World encounter could not be sealed.';
                    if (sealedAttempt && tokenAttempt
                        && isNaturalWorldEncounter(worldSpec.context)
                        && message !== 'That wanderer has already moved on.') {
                        // Session/token/pointer are the durable start intent.
                        // Keep them and the chain lease so same-player resume
                        // can help-forward a cooldown/save write that failed
                        // after the encounter was already sealed.
                        return {
                            status: 503,
                            body: {
                                error: 'The wanderer encounter is still finalizing. Resume the same fight.',
                                retryable: true,
                                resumable: true,
                            },
                        };
                    }
                    // Only clean resources minted by this attempt. The active-key
                    // lock prevents racing another start, and explicit ids avoid
                    // deleting any pre-existing fight.
                    const cleanupKeys: string[] = [];
                    if (sealedAttempt) cleanupKeys.push(soloPveSessionKey(sealedAttempt.sessionId));
                    if (tokenAttempt) cleanupKeys.push(aiFightTokenKey(playerName, tokenAttempt));
                    const pointer = cleanWorldAiActivePointer(await kv.get(worldAiActiveKey(playerName)).catch(() => null));
                    if (pointer?.token === tokenAttempt) cleanupKeys.push(worldAiActiveKey(playerName));
                    if (cleanupKeys.length > 0) await kv.del(...cleanupKeys).catch(() => undefined);
                    await releaseWorldAiChainStage(playerName, worldSpec.context).catch(() => undefined);
                    return { status: 409, body: { error: message } };
                }
            }, { failClosed: true });
            // World starts may atomically heal a chained wave or claim/relocate a
            // natural encounter. Echo the latest committed version on every
            // outcome so authFetch advances the caller's save-version ratchet.
            const latest = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
            const saveVersion = Math.floor(Number(latest?._saveVersion));
            if (response.status === 204) return res.status(204).end();
            return res.status(response.status).json({
                ...response.body,
                ...(Number.isSafeInteger(saveVersion) && saveVersion > 0 ? { _saveVersion: saveVersion } : {}),
            });
        }

        const genericResponse = await withKvLock(aiFightStartLeaseKey(playerName), async () => {
            const world = await recoverWorldFight(playerName);
            if (world) return { status: 409, body: { error: 'A World encounter is already active.', resumable: true, mode: 'world' } };
            const recovered = await recoverAiFight(playerName);
            if (recovered) {
                if (resumeAiFight) return { status: 200, body: genericStartBody(recovered, true) };
                return { status: 409, body: { error: 'An AI encounter is already active.', resumable: true, sessionId: recovered.pointer.sessionId } };
            }
            if (resumeAiFight) {
                return noContentRecoveryProbe
                    ? { status: 204, body: { error: 'No active AI encounter.' } }
                    : { status: 404, body: { error: 'No active AI encounter.' } };
            }

            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const character = (save?.character ?? null) as Record<string, unknown> | null;
            if (!save || !character) return { status: 404, body: { error: 'Player save not found.' } };
            let genericAuthority;
            try {
                genericAuthority = await resolveGenericAiFightAuthority({
                    store: kv,
                    playerName,
                    body,
                    character,
                    tokenTtlSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
                });
            } catch (error) {
                return { status: 409, body: { error: error instanceof Error ? error.message : 'This AI encounter has no start authority.' } };
            }
            const sealedBody: Record<string, unknown> = {
                ...body,
                opponentId: genericAuthority.opponentId,
                battleKind: genericAuthority.battleKind,
                ...(genericAuthority.sector !== undefined ? { sector: genericAuthority.sector } : {}),
            };
            const reward = computeAiFightBaseReward(character);
            let sealed: { sessionId: string; session: SoloPveSession } | null = null;
            let token = '';
            let exploreReceiptOwned = false;
            let raidTokenOwned = false;
            try {
                // Persist combat authority before minting its one-battle reward token.
                sealed = await sealAiFightEncounter(playerName, sealedBody, save, undefined, genericAuthority);
                if (!sealed) return { status: 404, body: { error: 'AI opponent is not published on the server.' } };
                token = randomUUID().replace(/-/g, '');
                const record = createAiFightTokenRecord(playerName, token, Date.now(), {
                    opponentId: genericAuthority.opponentId,
                    opponentLevel: sealed.session.enemy.character.level,
                    sector: genericAuthority.sector,
                    worldExploreRequestId: genericAuthority.worldExploreRequestId,
                    raidTokenId: genericAuthority.raidTokenId,
                    dungeonRunToken: genericAuthority.dungeonRunToken,
                    baseXp: reward.xp,
                    baseRyo: reward.ryo,
                    battleKind: genericAuthority.battleKind,
                    sessionRuntime: 'solo-pve',
                    sessionId: sealed.sessionId,
                    rewardTrait: reward.trait,
                });
                await kv.set(aiFightTokenKey(playerName, token), record, { ex: AI_FIGHT_TOKEN_TTL_SECONDS });
                const pointer: AiFightActivePointer = { playerName, token, sessionId: sealed.sessionId, createdAt: Date.now() };
                await kv.set(aiFightActiveKey(playerName), pointer, { ex: AI_FIGHT_TOKEN_TTL_SECONDS });
                if (genericAuthority.exploreReceiptKey) {
                    exploreReceiptOwned = await ensureExploreBattleMarker(
                        playerName,
                        genericAuthority.worldExploreRequestId!,
                        token,
                        sealed.sessionId,
                    );
                }
                if (genericAuthority.raidTokenKey && genericAuthority.raidTokenRecord) {
                    await reserveRaidAiToken({
                        store: kv,
                        key: genericAuthority.raidTokenKey,
                        expected: genericAuthority.raidTokenRecord,
                        aiFightToken: token,
                        sessionId: sealed.sessionId,
                        ttlSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
                    });
                    raidTokenOwned = true;
                }
                return { status: 200, body: { ...genericStartBody({ pointer, token: record, session: sealed.session }, false), trait: reward.trait } };
            } catch (error) {
                const cleanup: string[] = [];
                if (sealed) cleanup.push(soloPveSessionKey(sealed.sessionId));
                if (token) cleanup.push(aiFightTokenKey(playerName, token));
                const pointer = cleanAiFightActivePointer(await kv.get(aiFightActiveKey(playerName)).catch(() => null));
                if (pointer?.token === token) cleanup.push(aiFightActiveKey(playerName));
                if (exploreReceiptOwned && genericAuthority.exploreReceiptKey) cleanup.push(genericAuthority.exploreReceiptKey);
                if (cleanup.length) await kv.del(...cleanup).catch(() => undefined);
                if (raidTokenOwned && genericAuthority.raidTokenKey && sealed && token) {
                    await releaseRaidAiTokenReservation({
                        store: kv,
                        key: genericAuthority.raidTokenKey,
                        aiFightToken: token,
                        sessionId: sealed.sessionId,
                        ttlSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
                    }).catch(() => undefined);
                }
                throw error;
            }
        }, { failClosed: true });
        if (genericResponse.status === 204) return res.status(204).end();
        return res.status(genericResponse.status).json(genericResponse.body);
    } catch (err) {
        console.error('[missions/ai-fight-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

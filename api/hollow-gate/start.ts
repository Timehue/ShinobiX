import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { randomUUID } from 'node:crypto';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    rollAugmentOffers,
    AUGMENT_CATALOG,
    augmentDisplay,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    hollowGateRunKey,
    itemStackCount,
    canonicalHollowGateDepth,
    type HollowGateRunToken,
    type HgCurrencyKey,
} from './_run-token.js';
import { RIFT_QUESTS, parseRiftQuestSeal, reconcileRiftRunBinding, type RiftQuestSeal } from '../sector/_rift-quest.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import { loadPublishedContent } from '../_content-store.js';
import { HOLLOW_GATE_LEDGER_ITEM_IDS, type HollowGateRewardLedger } from './_ledger.js';
import { withKvLock } from '../_lock.js';
import { isDeepStrictEqual } from 'node:util';

/*
 * /api/hollow-gate/start  — POST only  (docs/hollow-gate-augments.md)
 *
 * Mints a server-sealed run token for a Hollow Gate dive: seals the entry
 * currency snapshot + dive depth, rolls 3 augment offers (the client can't pick
 * the pool), and increments a SERVER daily-run counter (independent of the
 * client's lastDailyReset — closes the backdated-reset extra-dive exploit, #7).
 * Every server-owned run event appends an exact credit to the sealed ledger.
 *
 * This seal is mandatory for browser runs; there is no rewarding no-token path.
 */

const DEFAULT_DAILY_RUN_CAP = 2;
const DAILY_RUN_COUNTER_TTL_SECONDS = 25 * 60 * 60;

type StartReservation = {
    saveKey: string;
    requestId: string;
    countKey: string;
    ordinal: number;
    counterHeld: boolean;
    rollbackAttempted: boolean;
    token: string | null;
    runKey: string | null;
    runToken: HollowGateRunToken | null;
};

async function rollbackStartReservation(reservation: StartReservation): Promise<void> {
    const cleanupErrors: unknown[] = [];
    if (reservation.counterHeld) {
        try {
            await withKvLock(reservation.countKey, async () => {
                const current = Math.max(0, Math.floor(Number(await kv.get<number>(reservation.countKey)) || 0));
                if (current <= 0) return;
                if (current === 1) await kv.del(reservation.countKey);
                else await kv.set(reservation.countKey, current - 1, { ex: DAILY_RUN_COUNTER_TTL_SECONDS });
            }, { failClosed: true });
            reservation.counterHeld = false;
        } catch (error) {
            cleanupErrors.push(error);
        }
    }

    if (reservation.runKey && reservation.runToken) {
        try {
            await withKvLock(reservation.runKey, async () => {
                const current = await kv.get<HollowGateRunToken>(reservation.runKey!);
                if (isDeepStrictEqual(current, reservation.runToken)) await kv.del(reservation.runKey!);
            }, { failClosed: true });
        } catch (error) {
            cleanupErrors.push(error);
        }
    }

    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'hollow-gate-start-rollback-failed');
}

async function rollbackDefinitiveStartFailure(reservation: StartReservation): Promise<void> {
    if (reservation.rollbackAttempted) return;
    if (reservation.token) {
        let record: Record<string, unknown> | null;
        try {
            record = await kv.get<Record<string, unknown>>(reservation.saveKey);
        } catch (error) {
            // An unavailable readback cannot distinguish a failed write from a
            // committed write with a lost acknowledgement. Preserve both
            // reservations for retry instead of risking deletion of a live run.
            console.error('[hollow-gate/start rollback deferred]', safeLogValue(error));
            return;
        }
        const character = record?.character && typeof record.character === 'object'
            ? record.character as Record<string, unknown>
            : null;
        const marker = character?.lastHollowGateStart && typeof character.lastHollowGateStart === 'object'
            ? character.lastHollowGateStart as Record<string, unknown>
            : null;
        if (marker?.requestId === reservation.requestId && marker.token === reservation.token) return;
    }
    reservation.rollbackAttempted = true;
    await rollbackStartReservation(reservation);
}

function utcDateKey(): string { return new Date().toISOString().slice(0, 10); }

type PublishedEventGate = {
    id: string;
    floors: number;
    width: number;
    height: number;
    bossAiId?: string;
    bossName?: string;
    keyCost: 0 | 1;
    updatedAt: number;
};

export function normalizePublishedEventGate(raw: unknown, requestedId: string): PublishedEventGate | null {
    if (!raw || typeof raw !== 'object') return null;
    const config = raw as Record<string, unknown>;
    if (config.active !== true || String(config.id ?? '') !== requestedId) return null;
    const bossAiId = String(config.bossAiId ?? '').trim().slice(0, 128);
    const bossName = String(config.bossName ?? '').trim().slice(0, 64);
    const dimension = (value: unknown, min: number, max: number, fallback: number): number => {
        const parsed = Math.floor(Number(value));
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
    };
    return {
        id: requestedId,
        floors: canonicalHollowGateDepth(config.maxFloor),
        width: dimension(config.width, 15, 31, 25),
        height: dimension(config.height, 11, 21, 17),
        ...(bossAiId ? { bossAiId } : {}),
        ...(bossName ? { bossName } : {}),
        keyCost: Number(config.keyCost) === 0 ? 0 : 1,
        updatedAt: Math.max(0, Number(config.updatedAt) || 0),
    };
}

async function readPublishedEventGate(requestedId: string): Promise<PublishedEventGate | null> {
    if (!requestedId || requestedId.startsWith('rift-')) return null;
    // Dual-read (P0-4): the canonical content store is one more source; the
    // existing updatedAt-recency sort decides, so it is a no-op until published.
    const [slot1, slot2, published] = await Promise.all([
        kv.get<Record<string, unknown>>('save:admin1'),
        kv.get<Record<string, unknown>>('save:admin2'),
        loadPublishedContent().catch(() => ({}) as Record<string, unknown>),
    ]);
    const saves = [slot1, slot2, published];
    const latest = saves
        .map((save) => save?.hollowGateEventConfig)
        .filter((raw): raw is Record<string, unknown> => Boolean(raw && typeof raw === 'object'))
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
    return normalizePublishedEventGate(latest, requestedId);
}

export function consumeHollowGateKey(character: Record<string, unknown>): Record<string, unknown> | null {
    const itemId = 'hollow-gate-key';
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    let removed = false;
    const nextStacks = stacks.map((stack) => {
        if (removed || String(stack?.itemId ?? '') !== itemId || Number(stack?.count) <= 0) return stack;
        removed = true;
        return { ...stack, count: Math.max(0, Math.floor(Number(stack.count) || 0) - 1) };
    }).filter((stack) => Number(stack?.count) > 0);
    if (removed) return { ...character, itemStacks: nextStacks };
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    const index = inventory.indexOf(itemId);
    if (index < 0) return null;
    return { ...character, inventory: inventory.filter((_, i) => i !== index) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const requestedVariantId = String(body.variantId ?? '').slice(0, 64);
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9:_-]{8,96}$/.test(body.requestId) ? body.requestId : '';
        if (!playerName || !requestId) return res.status(400).json({ error: 'Missing playerName or requestId.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only start your own dive.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-start', 20, 60_000, identity.name))) return;

        const preflightRecord = requestedVariantId.startsWith('rift-')
            ? await kv.get<Record<string, unknown>>(`save:${playerName}`)
            : null;
        const sealedRift = requestedVariantId.startsWith('rift-')
            ? parseRiftQuestSeal(preflightRecord?.activeRiftQuestSeal)
                ?? parseRiftQuestSeal(await kv.get(`rift-quest:${playerName}`))
            : null;
        const riftDef = sealedRift?.id === requestedVariantId ? RIFT_QUESTS[requestedVariantId] : undefined;
        const eventDef = await readPublishedEventGate(requestedVariantId);
        // Only server-owned Rift quests and the current admin-published event
        // may shorten a dive. Arbitrary client floorDepth input is ignored.
        const floorDepth = riftDef?.floors ?? eventDef?.floors ?? canonicalHollowGateDepth();

        let issued: { token: string; runToken: HollowGateRunToken; offers: ReturnType<typeof rollAugmentOffers> } | null = null;
        let replayed = false;
        let reservation: StartReservation | null = null;
        const mutation = await mutatePlayerSave(playerName, async ({ character, record }) => {
            let currentRiftSeal: RiftQuestSeal | null = null;
            if (requestedVariantId.startsWith('rift-')) {
                currentRiftSeal = parseRiftQuestSeal(record.activeRiftQuestSeal)
                    ?? parseRiftQuestSeal(await kv.get(`rift-quest:${playerName}`));
                if (!riftDef || currentRiftSeal?.id !== requestedVariantId || currentRiftSeal.at !== sealedRift?.at) {
                    return { ok: false as const, status: 409, error: 'rift-quest-seal-mismatch' };
                }
                if (Math.floor(Number(record.currentSector)) !== currentRiftSeal.targetSector) {
                    return { ok: false as const, status: 409, error: 'rift-quest-target-mismatch' };
                }
            }
            const priorStart = character.lastHollowGateStart && typeof character.lastHollowGateStart === 'object'
                ? character.lastHollowGateStart as Record<string, unknown>
                : null;
            if (priorStart?.requestId === requestId && typeof priorStart.token === 'string') {
                let priorRun = await kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, priorStart.token));
                if (!priorRun) return { ok: false as const, status: 409, error: 'hollow-gate-start-spent' };
                if ((priorRun.variantId ?? '') !== requestedVariantId) {
                    return { ok: false as const, status: 409, error: 'hollow-gate-start-request-mismatch' };
                }
                let repairedRiftSeal: RiftQuestSeal | null = null;
                if (currentRiftSeal) {
                    const savedRunToken = character.hollowGateRun && typeof character.hollowGateRun === 'object'
                        ? (character.hollowGateRun as Record<string, unknown>).runToken
                        : null;
                    const binding = reconcileRiftRunBinding(currentRiftSeal, {
                        variantId: priorRun.variantId,
                        runToken: priorStart.token,
                        mintedAt: priorRun.mintedAt,
                        riftQuestAcceptedAt: priorRun.riftQuestAcceptedAt,
                    }, savedRunToken);
                    if (!binding) return { ok: false as const, status: 409, error: 'rift-quest-run-mismatch' };
                    repairedRiftSeal = binding.seal;
                    if (priorRun.riftQuestAcceptedAt !== binding.acceptedAt) {
                        priorRun = { ...priorRun, riftQuestAcceptedAt: binding.acceptedAt };
                        await kv.set(hollowGateRunKey(playerName, priorStart.token), priorRun);
                    }
                }
                const priorOffers = priorRun.offeredAugmentIds
                    .map((id) => AUGMENT_CATALOG[id])
                    .filter((offer): offer is NonNullable<typeof offer> => Boolean(offer));
                replayed = true;
                issued = { token: priorStart.token, runToken: priorRun, offers: priorOffers };
                return {
                    ok: true as const,
                    character,
                    ...(repairedRiftSeal ? { recordPatch: { activeRiftQuestSeal: repairedRiftSeal } } : {}),
                    value: { token: priorStart.token },
                };
            }
            const freeEntry = Boolean(riftDef) || eventDef?.keyCost === 0;
            const afterKey = identity.admin || freeEntry ? character : consumeHollowGateKey(character);
            if (!afterKey) return { ok: false as const, status: 409, error: 'hollow-gate-key-required' };
            const attunement = character.hollowGateAttunement && typeof character.hollowGateAttunement === 'object'
                ? character.hollowGateAttunement as Record<string, unknown>
                : {};
            const cap = DEFAULT_DAILY_RUN_CAP + Math.max(0, Math.min(1, Math.floor(Number(attunement['extra-dive']) || 0)));
            const countKey = `hg-runs:${playerName}:${utcDateKey()}`;
            const ord = await withKvLock<number | null>(countKey, async () => {
                const priorRuns = Math.max(0, Math.floor(Number(await kv.get<number>(countKey)) || 0));
                if (!identity.admin && priorRuns >= cap) return null;
                const intended = priorRuns + 1;
                const held: StartReservation = {
                    saveKey: `save:${playerName}`,
                    requestId,
                    countKey,
                    ordinal: intended,
                    counterHeld: false,
                    rollbackAttempted: false,
                    token: null,
                    runKey: null,
                    runToken: null,
                };
                reservation = held;
                try {
                    await kv.set(countKey, intended, { ex: DAILY_RUN_COUNTER_TTL_SECONDS });
                } catch (error) {
                    const readback = await kv.get<number>(countKey);
                    if (readback !== intended) {
                        reservation = null;
                        throw error;
                    }
                }
                held.counterHeld = true;
                return intended;
            }, { failClosed: true });
            if (ord === null) return { ok: false as const, status: 429, error: 'daily-cap' };
            if (!reservation) throw new Error('hollow-gate-start-reservation-missing');
            const entry = {} as Partial<Record<HgCurrencyKey, number>>;
            for (const k of HG_CLAWBACK_KEYS) entry[k] = Math.max(0, Math.floor(Number(character[k]) || 0));
            const offers = rollAugmentOffers(3);
            const token = randomUUID().replace(/-/g, '');
            const entryItems = Object.fromEntries(
                HOLLOW_GATE_LEDGER_ITEM_IDS.map((itemId) => [itemId, itemStackCount(character.itemStacks, itemId)]),
            );
            const rewardLedger: HollowGateRewardLedger = { currencies: {}, items: {}, sourceIds: [] };
            const startKeys = Math.max(0, Math.min(2, Math.floor(Number(attunement['seasoned-delver']) || 0)));
            const wardSteps = Math.max(0, Math.min(6, Math.floor(Number(attunement['reiki-reserves']) || 0) * 3));
            const runToken: HollowGateRunToken = {
                playerName, mintedAt: Date.now(), floorDepth, currentFloor: 1, seed: randomUUID(),
                floorWidth: eventDef?.width ?? 25,
                floorHeight: eventDef?.height ?? 17,
                entryCurrencies: entry,
                entryFragments: itemStackCount(character.itemStacks, HG_HIGH_VALUE_ITEM_ID),
                entryItems,
                rewardLedger,
                keys: startKeys,
                torch: 10,
                threat: 0,
                resolvedEventIds: [],
                stepVersion: 0,
                recentStepIds: [],
                recentConsumableIds: [],
                wardSteps,
                divinerUsed: false,
                pendingAmbush: null,
                offeredAugmentIds: offers.map((o) => o.id), chosenAugmentId: null,
                dailyRunOrdinal: ord,
                ...(riftDef ? {
                    variantId: riftDef.id,
                    riftQuestAcceptedAt: currentRiftSeal!.at,
                    bossProfileId: riftDef.bossAiId,
                    bossName: riftDef.bossName,
                } : eventDef ? {
                    variantId: eventDef.id,
                    ...(eventDef.bossAiId ? { bossProfileId: eventDef.bossAiId } : {}),
                    ...(eventDef.bossName ? { bossName: eventDef.bossName } : {}),
                } : {}),
            };
            issued = { token, runToken, offers };
            reservation.token = token;
            reservation.runKey = hollowGateRunKey(playerName, token);
            reservation.runToken = runToken;
            // Write the reward-bearing run before committing the key/daily save.
            // A crash can leave an unguessable orphan, but never a paid save with
            // a missing run token. The request marker makes a lost response safe.
            await kv.set(hollowGateRunKey(playerName, token), runToken);
            const augmentOffers = offers.map(augmentDisplay);
            const boundRiftSeal = currentRiftSeal ? { ...currentRiftSeal, runToken: token } : null;
            return {
                ok: true as const,
                character: {
                    ...afterKey,
                    dailyHollowGateRuns: ord,
                    lastDailyReset: utcDateKey(),
                    lastHollowGateStart: { requestId, token, at: Date.now() },
                    // Persist enough private projection for an immediate reload
                    // to recover before the browser has generated/sealed floor 1.
                    // The browser replaces this with its presentation grid; the
                    // KV run above remains the gameplay authority throughout.
                    hollowGateRun: {
                        floor: 1,
                        runToken: token,
                        serverSeed: runToken.seed,
                        augmentOffers,
                        chosenAugment: null,
                        entryCurrencies: entry,
                        keys: startKeys,
                        torch: runToken.torch,
                        threat: runToken.threat,
                        wardSteps: runToken.wardSteps,
                        secondWindArmed: false,
                        pendingFloorSeal: true,
                    },
                },
                ...(boundRiftSeal ? { recordPatch: { activeRiftQuestSeal: boundRiftSeal } } : {}),
                value: { token },
            };
        }).catch(async (error: unknown) => {
            if (reservation) {
                try {
                    await rollbackDefinitiveStartFailure(reservation);
                } catch (cleanupError) {
                    console.error('[hollow-gate/start rollback]', safeLogValue(cleanupError));
                }
            }
            throw error;
        });
        if (!mutation.ok) {
            if (reservation) {
                try {
                    await rollbackDefinitiveStartFailure(reservation);
                } catch (cleanupError) {
                    console.error('[hollow-gate/start rollback]', safeLogValue(cleanupError));
                }
            }
            if (mutation.error === 'daily-cap') return res.status(200).json({ ok: true, reason: 'daily-cap', token: null });
            return res.status(mutation.status).json({ error: mutation.error });
        }
        if (!issued) return res.status(500).json({ error: 'Run token was not issued.' });
        const committed = issued as { token: string; runToken: HollowGateRunToken; offers: ReturnType<typeof rollAugmentOffers> };
        // A run remains durable until extraction/death. Expiring the only exact
        // ledger would let an abandoned browser keep immediate credits without
        // applying the loss rule. It was written inside the save mutation above,
        // before the entry key/daily fields could commit.
        await recordBetaMetric({
            event: replayed ? 'hollow_gate.run_start_replayed' : 'hollow_gate.run_started',
            playerName,
            level: Number((mutation.character as Record<string, unknown> | null)?.level),
            source: committed.runToken.variantId ? `variant:${committed.runToken.variantId}` : `standard:${committed.runToken.floorDepth}f`,
        });
        return res.status(200).json({
            ok: true,
            token: committed.token,
            seed: committed.runToken.seed,
            floorDepth: committed.runToken.floorDepth,
            variantId: committed.runToken.variantId,
            floorWidth: committed.runToken.floorWidth,
            floorHeight: committed.runToken.floorHeight,
            bossProfileId: committed.runToken.bossProfileId,
            bossName: committed.runToken.bossName,
            chosenAugmentId: committed.runToken.chosenAugmentId,
            augmentOffers: committed.offers.map(augmentDisplay),
            character: mutation.character,
            _saveVersion: mutation._saveVersion,
        });
    } catch (err) {
        console.error('[hollow-gate/start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

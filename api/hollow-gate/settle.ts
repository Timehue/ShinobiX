import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    hollowGateRunsEnabled,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    clampFragmentTotal,
    itemStackCount,
    maxFragmentsForDepth,
    maxHaulForDepth,
    rewardMultiplierForToken,
    type HollowGateRunToken,
} from './_run-token.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';
import { abortEconomicReceipt, commitEconomicReceipt, isEconomicReceiptStorageError, reserveEconomicReceipt } from '../_economic-receipt.js';

/*
 * /api/hollow-gate/settle  — POST only  (docs/hollow-gate-augments.md)
 *
 * The authoritative payout for a dive. Reads the sealed token (depth + entry
 * snapshot + chosen augment), computes the per-currency ceiling
 * maxHaulForDepth(depth, sealedMultiplier), and adds min(client-claimed,
 * ceiling) to the fresh trusted save balance. Raw-save growth is pinned, so this
 * endpoint owns the currency credit. A crafted client can neither exceed the
 * sealed ceiling nor smuggle a bigger multiplier. Death applies a server-computed ×0.5
 * claw-back. Single-use (NX hg-settled entity key → reconnect/retry/co-op pays
 * once). Body: { playerName, token, outcome: 'extract'|'death', haul: {currency:n} }.
 *
 * pure helper exported for the test.
 */

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Pure: authoritative post-settlement balance for one currency.
 *
 * The raw save endpoint pins Hollow Gate currency growth while a server run is
 * open, so `current` is the trusted server balance, not a client-prewritten
 * haul. Settle adds the bounded run credit itself. `entry` remains in the
 * signature because it is part of the sealed token and response reconciliation,
 * but it no longer acts as the source balance.
 */
export function settleCurrency(current: number, _entry: number, claimed: number, ceiling: number, frac: number): number {
    const credit = Math.floor(Math.min(Math.max(0, claimed), Math.max(0, ceiling)) * frac);
    return Math.max(0, num(current)) + Math.max(0, credit);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const outcome = body.outcome === 'death' || body.outcome === 'extract' ? body.outcome : null;
        const haul = (body.haul && typeof body.haul === 'object') ? body.haul as Record<string, unknown> : {};
        if (!playerName || !token) return res.status(400).json({ error: 'Missing playerName or token.' });
        if (!outcome) return res.status(400).json({ error: 'Invalid Hollow Gate outcome.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!hollowGateRunsEnabled()) {
            return res.status(503).json({ error: 'Hollow Gate runs are temporarily unavailable until server settlement is complete.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-settle', 20, 60_000, identity.name))) return;

        const runKey = `hg-run:${playerName}:${token}`;
        const run = await kv.get<HollowGateRunToken>(runKey);
        // Graceful: a stale client (or SESSION_SECRET unset re-mint) just gets a
        // no-op — never a save-breaking error (token-first invariant).
        if (!run) return res.status(200).json({ ok: true, reason: 'invalid-or-spent' });
        if (run.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(403).json({ error: 'Not your run.' });

        // Entity-keyed single-use: keyed on the RUN, so a reconnect/retry (or a
        // co-op partner reporting the same run) collapses to one credit.
        const settlementReceiptKey = `hg-settled:${playerName}:${token}`;
        const settlementReceiptTtl = 24 * 60 * 60;
        const reservation = await reserveEconomicReceipt(kv, {
            key: settlementReceiptKey,
            fingerprint: `hollow-gate:${playerName}:${token}:${outcome}`,
            ttlSeconds: settlementReceiptTtl,
            metadata: { playerName, token, outcome },
        });
        if (reservation.status === 'replay') {
            return res.status(200).json({ ok: true, alreadyReported: true });
        }
        if (reservation.status === 'conflict') {
            return res.status(409).json({ error: 'This run was already settled with a different outcome.' });
        }

        const mult = rewardMultiplierForToken(run);
        const ceiling = maxHaulForDepth(run.floorDepth, mult);
        const frac = outcome === 'death' ? 0.5 : 1;

        const credited = {} as Record<string, number>;
        const fragmentCeiling = maxFragmentsForDepth(run.floorDepth);
        let fragmentsClampedTo: number | null = null;
        const saveKey = `save:${playerName}`;
        let saveMutationAttempted = false;
        let result: { ok: true } | { ok: false };
        try {
        result = await withKvLock(saveKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(saveKey);
            const c = (fresh?.character ?? null) as Record<string, unknown> | null;
            if (!fresh || !c) return { ok: false as const };
            const next: Record<string, unknown> = { ...c };
            for (const k of HG_CLAWBACK_KEYS) {
                const value = settleCurrency(num(c[k]), num(run.entryCurrencies[k]), num(haul[k]), ceiling[k], frac);
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            // High-value forge item (Dungeon Legendary Fragment) — anti-fabrication.
            // The client keeps its inline boss-drop grant (byte-identical, no reliability
            // regression); here we only CLAMP this run's GAIN (current minus sealed entry)
            // to the depth ceiling, clawing back a crafted client's excess. No-op for legit
            // hauls. Guarded on entryFragments so tokens minted before this field skip it
            // (a missing baseline can't distinguish run-gain from pre-run holdings).
            const currentFragments = itemStackCount(c.itemStacks, HG_HIGH_VALUE_ITEM_ID);
            const allowedFragments = typeof run.entryFragments === 'number'
                ? clampFragmentTotal(currentFragments, run.entryFragments, fragmentCeiling)
                : currentFragments; // token predates the sealed baseline — skip the clamp
            if (allowedFragments < currentFragments && Array.isArray(c.itemStacks)) {
                const others = (c.itemStacks as Array<Record<string, unknown>>)
                    .filter((s) => !(s && String(s.itemId ?? '') === HG_HIGH_VALUE_ITEM_ID));
                next.itemStacks = allowedFragments > 0
                    ? [...others, { itemId: HG_HIGH_VALUE_ITEM_ID, count: allowedFragments }]
                    : others;
                fragmentsClampedTo = allowedFragments;
            }
            const updated = bumpSaveVersion({ ...fresh, character: next });
            saveMutationAttempted = true;
            await kv.set(saveKey, mergePreservingImages(updated, fresh));
            return { ok: true as const };
        }, { failClosed: true });

        if (result.ok) await commitEconomicReceipt(kv, settlementReceiptKey, reservation, settlementReceiptTtl);
        else await abortEconomicReceipt(kv, settlementReceiptKey, reservation);
        } catch (error) {
            if (!saveMutationAttempted) await abortEconomicReceipt(kv, settlementReceiptKey, reservation).catch(() => false);
            throw error;
        }

        if (!result.ok) return res.status(404).json({ error: 'Your save was not found.' });
        await kv.del(runKey).catch((error) => {
            // The committed settlement receipt still prevents a duplicate payout.
            console.error('[hollow-gate/settle] run-token cleanup failed', error);
            return 0;
        });
        // Legacy tracking (ENABLE_LEGACY): only a successful EXTRACTION counts
        // as a clear — deaths settle currency but don't feed Legacy progress.
        // Anti-farm gate: an instant start→settle round-trip is not a dive; a
        // clear needs the run to have lived a few real minutes (the currency
        // ceiling already bounds the loot side; verification finding).
        const runAgeMs = Date.now() - Number((run as { mintedAt?: number }).mintedAt ?? 0);
        if (outcome === 'extract' && runAgeMs >= 3 * 60 * 1000) {
            await bumpLegacyStats(playerName, { hollowGateClears: 1, dungeonClears: 1, eliteKills: 2 });
            await bumpEraContribution('gateClears');
        }
        return res.status(200).json({ ok: true, outcome, credited, fragmentsClampedTo });
    } catch (err) {
        console.error('[hollow-gate/settle]', err);
        if (isEconomicReceiptStorageError(err)) {
            return res.status(503).json({ error: 'Could not reserve the Hollow Gate settlement. Please retry.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

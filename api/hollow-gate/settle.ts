import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    HOLLOW_GATE_SERVER_DEPTH,
    itemStackCount,
    maxFragmentsForDepth,
    maxHaulForDepth,
    maxVeilsForDepth,
    maxXpForDepth,
    rewardMultiplierForToken,
    type HollowGateRunToken,
} from './_run-token.js';
import { gainXp } from '../_xp-engine.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';

/*
 * /api/hollow-gate/settle  — POST only  (docs/hollow-gate-augments.md)
 *
 * The authoritative payout for a dive. Reads the sealed token (depth + entry
 * snapshot + chosen augment), computes the per-currency ceiling
 * maxHaulForDepth(depth, sealedMultiplier), and credits min(client-claimed,
 * ceiling) — anchored to the sealed entry so a crafted client can neither inflate
 * the haul nor smuggle a bigger multiplier. Death applies a server-computed ×0.5
 * claw-back. Single-use (NX hg-settled entity key → reconnect/retry/co-op pays
 * once). Body: { playerName, token, outcome: 'extract'|'death', haul: {currency:n} }.
 *
 * pure helper exported for the test.
 */

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Pure: credit a sealed, ceiling-bounded haul onto the stored wallet.
 * Generic saves cannot pre-credit the haul, so settlement is the sole positive
 * writer. In-run spending is preserved and the total stays within entry+credit. */
export function settleCurrency(current: number, entry: number, claimed: number, ceiling: number, frac: number): number {
    const credit = Math.floor(Math.min(Math.max(0, claimed), Math.max(0, ceiling)) * frac);
    return Math.max(0, Math.min(num(current) + credit, Math.max(0, entry) + credit));
}

export function addCountedItem(itemStacks: unknown, itemId: string, amountRaw: unknown): Array<Record<string, unknown>> {
    const amount = Math.max(0, Math.floor(num(amountRaw)));
    const stacks = Array.isArray(itemStacks) ? itemStacks as Array<Record<string, unknown>> : [];
    if (!amount) return stacks;
    let found = false;
    const next = stacks.map((stack) => {
        if (!stack || String(stack.itemId ?? '') !== itemId) return stack;
        found = true;
        return { ...stack, count: Math.max(0, Math.floor(num(stack.count))) + amount };
    });
    return found ? next : [...next, { itemId, count: amount }];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const outcome = body.outcome === 'death' ? 'death' : 'extract';
        const haul = (body.haul && typeof body.haul === 'object') ? body.haul as Record<string, unknown> : {};
        if (!playerName || !token) return res.status(400).json({ error: 'Missing playerName or token.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-settle', 20, 60_000, identity.name))) return;

        const runKey = `hg-run:${playerName}:${token}`;
        const run = await kv.get<HollowGateRunToken>(runKey);
        // Graceful: a stale client (or SESSION_SECRET unset re-mint) just gets a
        // no-op — never a save-breaking error (token-first invariant).
        if (!run) {
            // A retry can arrive after the single-use run token was consumed. Return
            // the current committed character so the client can still reconcile a
            // response that was lost after the save write succeeded.
            const current = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            return res.status(200).json({
                ok: true,
                reason: 'invalid-or-spent',
                character: current?.character ?? null,
                _saveVersion: Number(current?._saveVersion ?? 0),
            });
        }
        if (run.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(403).json({ error: 'Not your run.' });

        const runAgeMs = Date.now() - Number(run.mintedAt ?? 0);
        if (outcome === 'extract' && runAgeMs < 3 * 60 * 1000) {
            return res.status(409).json({ error: 'The run is too new to extract.' });
        }

        const mult = rewardMultiplierForToken(run);
        const ceiling = maxHaulForDepth(run.floorDepth, mult);
        const frac = outcome === 'death' ? 0.5 : 1;

        const credited = {} as Record<string, number>;
        const fragmentCeiling = maxFragmentsForDepth(run.floorDepth);
        let fragmentsClampedTo: number | null = null;
        const saveKey = `save:${playerName}`;
        const result = await withKvLock(saveKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(saveKey);
            const c = (fresh?.character ?? null) as Record<string, unknown> | null;
            if (!fresh || !c) return { ok: false as const, character: null, _saveVersion: 0 };
            const redeemedRuns = Array.isArray(c.redeemedHollowGateRuns)
                ? (c.redeemedHollowGateRuns as unknown[]).filter((entry): entry is string => typeof entry === 'string')
                : [];
            if (redeemedRuns.includes(token)) {
                return { ok: true as const, alreadyReported: true as const, character: c, _saveVersion: Number(fresh._saveVersion ?? 0) };
            }
            let next: Record<string, unknown> = { ...c };
            for (const k of HG_CLAWBACK_KEYS) {
                const value = settleCurrency(num(c[k]), num(run.entryCurrencies[k]), num(haul[k]), ceiling[k], frac);
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            // Generic saves reject XP and ownership additions. Credit the bounded
            // run tallies here so legitimate Hollow Gate rewards survive autosave.
            const xpCredit = Math.floor(Math.min(Math.max(0, num(haul.xp)), maxXpForDepth(run.floorDepth, mult)));
            next = gainXp(next, xpCredit) as Record<string, unknown>;
            const fragmentCredit = Math.min(Math.max(0, Math.floor(num(haul.fragments))), fragmentCeiling);
            const veilCredit = Math.min(Math.max(0, Math.floor(num(haul.veils))), maxVeilsForDepth(run.floorDepth));
            next.itemStacks = addCountedItem(next.itemStacks, HG_HIGH_VALUE_ITEM_ID, fragmentCredit);
            next.itemStacks = addCountedItem(next.itemStacks, 'veil-of-the-hollow', veilCredit);
            // Each cleared Warden contributes one of the claimed fragments; the
            // sealed depth bounds this counter even though the Tier-1 run model
            // does not re-simulate each room.
            if (outcome === 'extract' && run.floorDepth === HOLLOW_GATE_SERVER_DEPTH && fragmentCredit > 0) {
                next.hollowGateWardenKills = num(next.hollowGateWardenKills) + 1;
            }
            next.redeemedHollowGateRuns = [...redeemedRuns.slice(-99), token];
            fragmentsClampedTo = itemStackCount(next.itemStacks, HG_HIGH_VALUE_ITEM_ID);
            const updated: Record<string, unknown> = bumpSaveVersion({ ...fresh, character: next });
            await kv.set(saveKey, mergePreservingImages(updated, fresh));
            return {
                ok: true as const,
                alreadyReported: false as const,
                character: next,
                _saveVersion: Number(updated._saveVersion ?? 0),
            };
        }, { failClosed: true });

        if (!result.ok) return res.status(404).json({ error: 'Your save was not found.' });
        await kv.set(`hg-settled:${playerName}:${token}`, '1', { ex: 24 * 60 * 60 }).catch(() => undefined);
        await kv.del(runKey).catch(() => undefined);
        if (result.alreadyReported) {
            return res.status(200).json({ ok: true, alreadyReported: true, character: result.character, _saveVersion: result._saveVersion });
        }
        // Legacy tracking (ENABLE_LEGACY): only a successful EXTRACTION counts
        // as a clear — deaths settle currency but don't feed Legacy progress.
        // Anti-farm gate: an instant start→settle round-trip is not a dive; a
        // clear needs the run to have lived a few real minutes (the currency
        // ceiling already bounds the loot side; verification finding).
        if (outcome === 'extract' && runAgeMs >= 3 * 60 * 1000) {
            await bumpLegacyStats(playerName, { hollowGateClears: 1, dungeonClears: 1, eliteKills: 2 });
            await bumpEraContribution('gateClears');
        }
        return res.status(200).json({
            ok: true,
            outcome,
            credited,
            fragmentsClampedTo,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (err) {
        console.error('[hollow-gate/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    HG_CLAWBACK_KEYS,
    maxHaulForDepth,
    rewardMultiplierForToken,
    type HollowGateRunToken,
} from './_run-token.js';

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

/** Pure: the credited value for one currency given the sealed entry + ceiling.
 *  Never exceeds the ceiling, never restores in-run spends (min with current),
 *  and applies the death claw-back fraction. */
export function settleCurrency(current: number, entry: number, claimed: number, ceiling: number, frac: number): number {
    const credit = Math.floor(Math.min(Math.max(0, claimed), Math.max(0, ceiling)) * frac);
    return Math.max(0, Math.min(num(current), Math.max(0, entry) + credit));
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
        if (!run) return res.status(200).json({ ok: true, reason: 'invalid-or-spent' });
        if (run.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(403).json({ error: 'Not your run.' });

        // Entity-keyed single-use: keyed on the RUN, so a reconnect/retry (or a
        // co-op partner reporting the same run) collapses to one credit.
        const once = await kv.set(`hg-settled:${playerName}:${token}`, '1', { nx: true, ex: 24 * 60 * 60 }).catch(() => 'OK' as const);
        if (once === null) return res.status(200).json({ ok: true, alreadyReported: true });
        await kv.del(runKey).catch(() => undefined);

        const mult = rewardMultiplierForToken(run);
        const ceiling = maxHaulForDepth(run.floorDepth, mult);
        const frac = outcome === 'death' ? 0.5 : 1;

        const credited = {} as Record<string, number>;
        const saveKey = `save:${playerName}`;
        const result = await withKvLock(saveKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(saveKey);
            const c = (fresh?.character ?? null) as Record<string, unknown> | null;
            if (!fresh || !c) return { ok: false as const };
            const next: Record<string, unknown> = { ...c };
            for (const k of HG_CLAWBACK_KEYS) {
                const value = settleCurrency(num(c[k]), num(run.entryCurrencies[k]), num(haul[k]), ceiling[k], frac);
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            const updated = bumpSaveVersion({ ...fresh, character: next });
            await kv.set(saveKey, mergePreservingImages(updated, fresh));
            return { ok: true as const };
        }, { failClosed: true });

        if (!result.ok) return res.status(404).json({ error: 'Your save was not found.' });
        return res.status(200).json({ ok: true, outcome, credited });
    } catch (err) {
        console.error('[hollow-gate/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

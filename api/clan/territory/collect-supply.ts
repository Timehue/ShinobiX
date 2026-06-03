import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { collectTerritorySupply } from '../../_territory-supply.js';

/*
 * /api/clan/territory/collect-supply  — POST only
 *
 * Server-authoritative replacement for the old client-side
 * collectTerritoryWarSupply: the client used to read each owned sector's
 * (client-computed) warSupply, zero the sectors, and credit the clan treasury
 * via the save blob — a trust-the-client path the clan-save validator could
 * only cap, not verify.
 *
 * This endpoint owns the accrual: it scans the canonical world:territory:*
 * records, recomputes each owned sector's accrued warSupply from the server
 * clock (collectTerritorySupply mirrors the client formula), zeroes the sectors
 * under their per-sector locks (debit first), THEN credits the clan treasury
 * under the clan-save lock (so a crash can lose supply but never duplicate it).
 * Naturally idempotent — a second call finds the sectors already at 0.
 *
 * Auth/permission note: collecting moves territory supply into the SHARED clan
 * treasury (no personal gain), so this is gated at clan MEMBERSHIP, exactly like
 * /api/clan/treasury/donate. The "leader/elder only" restriction stays a client
 * UI gate (canSpendTerritoryScrolls); a non-leader who crafts the request can
 * only help their own clan's pool, which is not an exploit.
 *
 * Body: { playerName, clan }. Caller MUST be the player (or admin) and a member
 * of `clan`. Rate-limited 30/min per actor. Also fixes the latent bug where the
 * old save-blob path was silently truncated to +100 warSupply/write.
 */

const TERRITORY_KEY_PREFIX = 'world:territory:';
const AUDIT_LOG_PREFIX = 'audit:clan-collect-supply:';

function clanSlugBare(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan) {
            return res.status(400).json({ error: 'Missing playerName or clan.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only collect for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-collect-supply', 30, 60_000, identity.name))) return;

        const targetSlug = clanSlugBare(clan);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = `save:clan-${targetSlug}`;

        const clanRec = await kv.get<Record<string, unknown>>(clanSaveKey);
        if (!clanRec) return res.status(404).json({ error: 'Clan not found.' });

        // Membership: the caller's character must belong to this clan (admin exempt).
        if (!identity.admin) {
            const donorRec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null) as Record<string, unknown> | null;
            if (!donorChar) return res.status(404).json({ error: 'Your save was not found.' });
            if (clanSlugBare(String(donorChar.clan ?? '')) !== targetSlug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
        }

        const now = Date.now();

        // Find this clan's owned sectors (canonical world-state records).
        const territoryKeys = await kv.keys(`${TERRITORY_KEY_PREFIX}*`);
        const territories = territoryKeys.length
            ? ((await kv.mget<Record<string, unknown>[]>(...territoryKeys)).filter(Boolean) as Record<string, unknown>[])
            : [];
        const owned = territories.filter((t) => String(t.ownerClan ?? '') === clan);

        // ── Phase 1 (debit): zero each owned sector under its own lock,
        // recomputing accrual from the freshly-read record so a concurrent
        // raid/accrual write isn't clobbered and supply isn't double-counted.
        let total = 0;
        for (const t of owned) {
            const sector = Number(t.sector);
            if (!Number.isFinite(sector)) continue;
            const key = `${TERRITORY_KEY_PREFIX}${sector}`;
            await withKvLock(key, async () => {
                const fresh = await kv.get<Record<string, unknown>>(key);
                if (!fresh || String(fresh.ownerClan ?? '') !== clan) return; // ownership changed under us
                const { collected, nextLastSupplyAt } = collectTerritorySupply(fresh, now);
                if (collected <= 0) return;
                total += collected;
                await kv.set(key, { ...fresh, warSupply: 0, lastSupplyAt: nextLastSupplyAt, updatedAt: now });
            }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });
        }

        // ── Phase 2 (credit): add the collected total to the clan treasury under
        // the clan-save lock. Re-read so we don't clobber a concurrent clan write.
        let treasury: Record<string, unknown>;
        if (total > 0) {
            try {
                treasury = await withKvLock(clanSaveKey, async () => {
                    const fresh = (await kv.get<Record<string, unknown>>(clanSaveKey)) ?? clanRec;
                    const prevTreasury = (fresh.treasury ?? {}) as Record<string, unknown>;
                    const nextTreasury = { ...prevTreasury, warSupply: Math.max(0, Number(prevTreasury.warSupply ?? 0)) + total };
                    await kv.set(clanSaveKey, { ...fresh, treasury: nextTreasury });
                    return nextTreasury;
                }, { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 });
            } catch (creditErr) {
                // Phase 1 already zeroed the sectors (debit). If the treasury
                // credit can't land — sustained clan-save lock contention or a KV
                // hiccup — `total` War Supply would otherwise silently vanish. We
                // deliberately KEEP "lose, never duplicate" (do NOT re-credit the
                // sectors — that could mint on a racing collect), but record the
                // shortfall durably (90d) + loudly so an admin can reconcile, and
                // tell the caller it failed instead of pretending it succeeded.
                console.error(`[clan/territory/collect-supply] CREDIT FAILED after debit — ${total} War Supply unreconciled for clan "${clan}":`, creditErr);
                await kv.set(`${AUDIT_LOG_PREFIX}LOSS:${targetSlug}:${now}`, {
                    ts: now,
                    actor: identity.admin ? 'admin' : identity.name,
                    clan,
                    unreconciled: total,
                    sectors: owned.length,
                    error: creditErr instanceof Error ? creditErr.message : String(creditErr),
                }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
                return res.status(503).json({
                    ok: false,
                    error: 'Supply was collected from your sectors but the treasury credit could not be saved. An admin can reconcile it — please do not retry.',
                    unreconciled: total,
                });
            }
            await kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${now}`, {
                ts: now,
                actor: identity.admin ? 'admin' : identity.name,
                clan,
                collected: total,
                sectors: owned.length,
            }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        } else {
            treasury = (clanRec.treasury ?? {}) as Record<string, unknown>;
        }

        return res.status(200).json({ ok: true, treasury, collected: total });
    } catch (err) {
        console.error('[clan/territory/collect-supply]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { sectorContractsEnabled } from '../_release-flags.js';
import { sectorContractFor, utcDayOf } from '../../shared/sector-contracts.js';
import {
    CONTRACT_TTL_SECONDS, contractClaimKey, contractProgressKey,
    readSectorContractStatus, sectorContractStatus,
} from '../_sector-contracts.js';

/*
 * /api/sector/contract — GET status, POST claim
 *
 * GET  ?playerName=&sector=  → { ok, contract, progress, claimed, claimable }
 * POST { playerName, sector } → { ok:true, ryo, totalRyo } | { ok:false, reason }
 *
 * Server-authoritative throughout. The contract is RECOMPUTED from the sealed
 * (sector, UTC day) by the pure shared module at claim time — the request body
 * carries no reward, no target and no day, so there is nothing in it to inflate.
 * Progress is the count the server itself wrote as each explore landed
 * (api/_sector-contracts.ts), never a client tally.
 *
 * NO presence gate, deliberately — unlike wanderer-gift and explore, which pay
 * for something you do ON the spot. Every point of contract progress was already
 * credited from an explore that passed `sectorPresenceBlock`, so the work is
 * proven; the claim is collecting a settled bounty, not earning it. Requiring the
 * player to walk back would add nothing an attacker could not trivially satisfy.
 *
 * The check-then-pay runs inside the player's own `save:<name>` lock with
 * failClosed, so two racing claims cannot both collect one bounty: the first
 * writes the claim key, the second reads it and is refused.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!sectorContractsEnabled()) return res.status(404).json({ error: 'Sector contracts are disabled.' });
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

    try {
        const body = req.method === 'POST'
            ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>
            : {};
        const source = req.method === 'POST' ? body : (req.query ?? {}) as Record<string, unknown>;
        const playerName = safeName(String(source.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const sector = Math.floor(Number(source.sector ?? 0));
        if (!Number.isFinite(sector) || sector <= 0) return res.status(400).json({ error: 'Missing sector.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }

        if (req.method === 'GET') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-contract-read', 60, 60_000, identity.name))) return;
            return res.status(200).json({ ok: true, ...(await readSectorContractStatus(playerName, sector)) });
        }

        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-contract-claim', 12, 60_000, identity.name))) return;

        const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
            const now = Date.now();
            const day = utcDayOf(now);
            // Recomputed here, inside the lock, from the sealed sector and day.
            const contract = sectorContractFor(sector, day);
            if (!contract) return { status: 200, body: { ok: false, reason: 'no-contract' } };

            const claimKey = contractClaimKey(playerName, sector, day);
            const [progress, claimedAt] = await Promise.all([
                kv.get<number>(contractProgressKey(playerName, sector, day)),
                kv.get<number>(claimKey),
            ]);
            const status = sectorContractStatus(contract, progress, claimedAt, now);
            if (status.claimed) return { status: 200, body: { ok: false, reason: 'already-claimed', ...status } };
            if (!status.claimable) return { status: 200, body: { ok: false, reason: 'incomplete', ...status } };

            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

            // Claim first: if the payout write fails after this, the player has
            // lost a bounty. If it were the other way round, a failure here
            // would leave a paid contract still claimable — and that is a
            // faucet. Losing one is recoverable; minting is not.
            await kv.set(claimKey, now, { ex: CONTRACT_TTL_SECONDS });
            const updated = { ...char, ryo: Number(char.ryo ?? 0) + contract.ryo };
            const record = bumpSaveVersion({ ...rec, character: updated });
            await kv.set(`save:${playerName}`, mergePreservingImages(record, rec));
            return {
                status: 200,
                body: {
                    ok: true,
                    contract,
                    ryo: contract.ryo,
                    totalRyo: updated.ryo,
                    progress: status.progress,
                    claimed: true,
                    claimable: false,
                    _saveVersion: Number(record._saveVersion ?? 0),
                },
            };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not settle the contract — please retry.' });
        }
        console.error('[sector/contract]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

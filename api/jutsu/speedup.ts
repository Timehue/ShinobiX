import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';

// Honor Seal training speedup. Each Seal reduces the current training timer
// by 10 minutes. 10 Seals = effectively instant (cap at 100 minutes per call
// to keep the math simple — the client can chain calls for longer skips).
//
// Training state lives on the client (activeJutsuTraining); this endpoint
// is the server-side ledger of Seal debits. The client subtracts the granted
// minutes from its local endsAt timestamp on success.
const MINUTES_PER_SEAL = 10;
const MAX_SEALS_PER_CALL = 20;

// Vanguard Rank 8+ pays 90% of the listed cost (10% discount), so the same
// time-skip costs fewer Seals: ceil(seals * 0.9).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;

function effectiveCost(seals: number, profession: unknown, professionRank: unknown): number {
    if (profession === 'vanguard' && Number(professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        return Math.max(1, Math.ceil(seals * VANGUARD_DISCOUNT_MULT));
    }
    return seals;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const sealsRequested = Math.floor(Number(body.seals ?? 0));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!Number.isFinite(sealsRequested) || sealsRequested <= 0) {
            return res.status(400).json({ error: 'seals must be a positive integer.' });
        }
        if (sealsRequested > MAX_SEALS_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_SEALS_PER_CALL} Seals per call.` });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only spend your own Seals.' });
        }

        const key = `save:${playerName}`;
        // Wrap the read-modify-write under lock:save:<name> so two concurrent
        // speedup calls can't both read the same balance + endsAt, both
        // deduct the cost, and the player end up paying 2× Seals for one
        // skip (or, conversely, losing the debit when a concurrent auto-
        // save lands between the read and write).
        const lockResult = await withKvLock(key, async () => {
            const record = await kv.get<Record<string, unknown>>(key);
            if (!record) return { status: 404 as const, body: { error: 'Player not found.' } };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { status: 404 as const, body: { error: 'Character not found.' } };

            // Verify there's actually an active jutsu training that isn't already
            // finished — otherwise the player would lose Seals for nothing. The
            // training state lives at the top level of the save record (see
            // buildPlayerSavePayload in App.tsx).
            const activeJutsuTraining = record.activeJutsuTraining as { endsAt?: number; jutsuId?: string } | undefined | null;
            if (!activeJutsuTraining || !activeJutsuTraining.endsAt) {
                return { status: 400 as const, body: { error: 'No active jutsu training to speed up.' } };
            }
            const remainingMs = Number(activeJutsuTraining.endsAt) - Date.now();
            if (remainingMs <= 0) {
                return { status: 400 as const, body: { error: 'Your training is already complete — collect it instead.' } };
            }

            const cost = effectiveCost(sealsRequested, char.profession, char.professionRank);
            const balance = Number(char.honorSeals ?? 0);
            if (balance < cost) {
                return { status: 402 as const, body: { error: 'Not enough Honor Seals.', cost, balance } };
            }

            const requestedMinutes = sealsRequested * MINUTES_PER_SEAL;
            // Don't sell more time than remains. Otherwise the player can over-pay.
            const remainingMinutes = Math.ceil(remainingMs / 60_000);
            if (requestedMinutes > remainingMinutes) {
                return {
                    status: 400 as const,
                    body: {
                        error: `Only ${remainingMinutes} minute(s) of training left — buy fewer Seals.`,
                        remainingMinutes,
                        maxSeals: Math.ceil(remainingMinutes / MINUTES_PER_SEAL),
                    },
                };
            }

            const minutesReduced = requestedMinutes;
            const updated = {
                ...record,
                character: {
                    ...char,
                    honorSeals: balance - cost,
                },
                activeJutsuTraining: {
                    ...activeJutsuTraining,
                    endsAt: Math.max(Date.now(), Number(activeJutsuTraining.endsAt) - minutesReduced * 60_000),
                },
            };
            await kv.set(key, mergePreservingImages(updated, record));

            return {
                status: 200 as const,
                body: {
                    ok: true,
                    sealsRequested,
                    sealsSpent: cost,
                    minutesReduced,
                    honorSealsRemaining: balance - cost,
                    newEndsAt: (updated.activeJutsuTraining as { endsAt: number }).endsAt,
                },
            };
        });
        return res.status(lockResult.status).json(lockResult.body);
    } catch (err) {
        console.error('[jutsu/speedup]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

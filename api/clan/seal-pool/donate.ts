import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { safeName, mergePreservingImages, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { loadPool, savePool } from './_storage.js';

// Vanguards donate Honor Seals to their clan's pool. Spec: up to 50% of
// current Seal balance per donation. Per-donation cap rather than a daily
// cumulative cap — simpler and the cap naturally tightens after each donation.
const DONATE_FRACTION_CAP = 0.5;
const MIN_DONATION = 1;
const MAX_DONATION_PER_CALL = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const amount = Math.floor(Number(body.amount ?? 0));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!Number.isFinite(amount) || amount < MIN_DONATION) {
            return res.status(400).json({ error: `Amount must be at least ${MIN_DONATION}.` });
        }
        if (amount > MAX_DONATION_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_DONATION_PER_CALL} Seals per donation call.` });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only donate your own Seals.' });
        }

        const saveKey = `save:${playerName}`;
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!char) return res.status(404).json({ error: 'Character not found.' });

        if (char.profession !== 'vanguard') {
            return res.status(403).json({ error: 'Only Vanguards can donate Honor Seals.' });
        }

        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to donate.' });

        const balance = Number(char.honorSeals ?? 0);
        const maxThisCall = Math.floor(balance * DONATE_FRACTION_CAP);
        if (amount > maxThisCall) {
            return res.status(400).json({
                error: `Per-donation cap is 50% of current balance (${maxThisCall} Seals).`,
                cap: maxThisCall,
                balance,
            });
        }

        // Debit donor.
        const updatedRecord = {
            ...record,
            character: { ...char, honorSeals: balance - amount },
        };
        await kv.set(saveKey, mergePreservingImages(updatedRecord, record));

        // Credit pool.
        const pool = await loadPool(clanName);
        pool.balance += amount;
        pool.log.unshift({ kind: 'donate', by: playerName, amount, at: Date.now() });
        await savePool(pool);

        return res.status(200).json({
            ok: true,
            donated: amount,
            honorSealsRemaining: balance - amount,
            poolBalance: pool.balance,
        });
    } catch (err) {
        console.error('[clan/seal-pool/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

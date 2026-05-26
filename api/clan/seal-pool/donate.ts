import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { safeName, mergePreservingImages, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { loadPool, savePool } from './_storage.js';

// Vanguards donate Honor Seals to their clan's pool. Per-day cumulative cap
// of 50% of (currentBalance + alreadyDonatedToday) — i.e. you can move up to
// half of what you'd have if you hadn't donated yet today. Resets at UTC
// midnight via the lazy-reset pattern on dailyDonationDate.
const DONATE_FRACTION_CAP = 0.5;
const MIN_DONATION = 1;
const MAX_DONATION_PER_CALL = 200;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

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
        // Per-day cumulative cap. Lazy-reset: if the stamped date != today,
        // dailyDonatedToday is effectively zero. Cap = 50% of (currentBalance
        // + dailyDonatedToday) — i.e. the cap is computed against the "if you
        // hadn't donated today" balance so it doesn't tighten as you spend.
        const today = utcDateKey();
        const stampedDate = typeof char.dailyDonationDate === 'string' ? char.dailyDonationDate : '';
        const donatedToday = stampedDate === today ? Number(char.dailyDonatedSeals ?? 0) : 0;
        const dailyCap = Math.floor((balance + donatedToday) * DONATE_FRACTION_CAP);
        const remaining = Math.max(0, dailyCap - donatedToday);
        if (amount > remaining) {
            return res.status(400).json({
                error: `Daily donation cap is 50% of your "start of day" Seal balance. You can donate ${remaining} more today.`,
                dailyCap,
                donatedToday,
                remaining,
                balance,
            });
        }

        // Debit donor + bump daily tracking.
        const updatedRecord = {
            ...record,
            character: {
                ...char,
                honorSeals: balance - amount,
                dailyDonatedSeals: donatedToday + amount,
                dailyDonationDate: today,
            },
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
            dailyDonatedToday: donatedToday + amount,
            dailyCap,
        });
    } catch (err) {
        console.error('[clan/seal-pool/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

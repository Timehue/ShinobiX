import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { safeName, mergePreservingImages, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { loadPool, savePool } from './_storage.js';

// Clan leader (clanFounder = true) distributes Honor Seals from the clan
// pool to a clan member. Recipient must be in the same clan.
const MIN_DISTRIBUTE = 1;
const MAX_DISTRIBUTE_PER_CALL = 500;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const leaderName = safeName(String(body.leaderName ?? ''));
        const recipientName = safeName(String(body.recipientName ?? ''));
        const amount = Math.floor(Number(body.amount ?? 0));
        if (!leaderName || !recipientName) {
            return res.status(400).json({ error: 'Missing leaderName or recipientName.' });
        }
        if (!Number.isFinite(amount) || amount < MIN_DISTRIBUTE) {
            return res.status(400).json({ error: `Amount must be at least ${MIN_DISTRIBUTE}.` });
        }
        if (amount > MAX_DISTRIBUTE_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_DISTRIBUTE_PER_CALL} Seals per call.` });
        }

        const identity = await authedPlayerOrAdmin(req, leaderName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== leaderName) {
            return res.status(403).json({ error: 'Can only distribute as yourself.' });
        }

        // Rate limit AFTER auth so anonymous spam still hits the auth gate
        // first. 10/min is generous for legit founder activity.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-seal-distribute', 10, 60_000, identity.name))) return;

        // Verify leader status.
        const leaderRecord = await kv.get<Record<string, unknown>>(`save:${leaderName}`);
        const leaderChar = leaderRecord?.character as Record<string, unknown> | undefined;
        if (!leaderChar) return res.status(404).json({ error: 'Leader character not found.' });
        const clanName = typeof leaderChar.clan === 'string' ? leaderChar.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to distribute.' });
        if (!identity.admin && !leaderChar.clanFounder) {
            return res.status(403).json({ error: 'Only the clan founder can distribute Honor Seals.' });
        }

        // Verify recipient is in the same clan.
        const recipientRecord = await kv.get<Record<string, unknown>>(`save:${recipientName}`);
        const recipientChar = recipientRecord?.character as Record<string, unknown> | undefined;
        if (!recipientChar) return res.status(404).json({ error: 'Recipient not found.' });
        if (recipientChar.clan !== clanName) {
            return res.status(400).json({ error: 'Recipient is not in your clan.' });
        }

        // Pool debit + recipient credit under a per-clan-pool lock so two
        // simultaneous distributes can't both read pre-debit balance and
        // double-spend. Lock keyed on the pool key so it doesn't collide
        // with unrelated locks.
        const poolKey = `clan-seal-pool:${clanName.toLowerCase()}`;
        const result = await withKvLock(poolKey, async () => {
            const pool = await loadPool(clanName);
            if (pool.balance < amount) {
                return { ok: false as const, available: pool.balance };
            }
            pool.balance -= amount;
            pool.log.unshift({
                kind: 'distribute',
                by: leaderName,
                to: recipientName,
                amount,
                at: Date.now(),
            });
            await savePool(pool);
            return { ok: true as const, poolBalance: pool.balance };
        });
        if (!result.ok) {
            return res.status(400).json({
                error: 'Not enough Seals in the clan pool.',
                requested: amount,
                available: result.available,
            });
        }

        // Credit recipient. (Outside the pool lock — the per-save write
        // lock in api/save/[name].ts isn't held here because we're using
        // kv.set directly; a recipient who happens to be writing their
        // save concurrently could race, but it's a single-line read and
        // re-write of one field. Acceptable trade-off vs. nesting locks.)
        const updatedRecipient = {
            ...recipientRecord,
            character: {
                ...recipientChar,
                honorSeals: Number(recipientChar.honorSeals ?? 0) + amount,
            },
        };
        await kv.set(`save:${recipientName}`, mergePreservingImages(updatedRecipient, recipientRecord));

        return res.status(200).json({
            ok: true,
            distributed: amount,
            recipient: recipientName,
            poolBalance: result.poolBalance,
        });
    } catch (err) {
        console.error('[clan/seal-pool/distribute]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

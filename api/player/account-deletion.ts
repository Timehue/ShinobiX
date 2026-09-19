import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { authKey, type AuthRecord } from '../player-auth.js';
import { accountDeletionStatus } from '../_account-deletion-wait.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'account-deletion', 30, 60_000)) return;
    try {
        const name = await authedPlayer(req);
        if (!name) return res.status(401).json({ error: 'Authentication required.' });
        const action = req.method === 'GET' ? 'status' : req.body?.action;
        if (!['status', 'request', 'cancel'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
        // Same outer lock as DELETE /save. Cancellation cannot overtake teardown.
        return await withKvLock(`save:${name}`, () => withKvLock(authKey(name), async () => {
            if (await authedPlayer(req) !== name) return res.status(401).json({ error: 'Sign in again.' });
            const record = await kv.get<AuthRecord>(authKey(name));
            if (!record) return res.status(404).json({ error: 'Account does not exist.' });
            if (action !== 'status') {
                if (!await kv.get(`save:${name}`)) return res.status(409).json({ error: 'The save is already removed. Finish deleting the account.' });
                if (action === 'request' && !accountDeletionStatus(record).requestedAt) record.deletionRequestedAt = Date.now();
                if (action === 'cancel') delete record.deletionRequestedAt;
                await kv.set(authKey(name), record);
            }
            return res.status(200).json({ ok: true, name, ...accountDeletionStatus(record) });
        }, { failClosed: true }), { failClosed: true });
    } catch {
        return res.status(503).json({ error: 'Could not confirm deletion status. Please retry.' });
    }
}

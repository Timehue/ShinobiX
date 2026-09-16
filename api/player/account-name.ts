import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayer } from '../_auth.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { accountNameKey } from '../_account-name.js';
import { authKey, isReservedUsername, newAccountNameError } from '../player-auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { getActiveSilence } from '../admin/moderation.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const player = safeName(String(body.playerName ?? ''));
        const owner = await authedPlayer(req, player);
        if (!player || owner !== player) return res.status(401).json({ error: 'Sign in again to change your account name.' });
        if (!(await enforceRateLimitKv(req, res, 'account-name', 10, 60_000, owner))) return;
        const next = typeof body.accountName === 'string' ? body.accountName.trim() : '';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(next)) return res.status(400).json({ error: 'Use 3–32 letters, numbers, underscores or hyphens, starting with a letter or number.' });
        const invalid = newAccountNameError(req, next);
        if (invalid) return res.status(invalid.status).json(invalid.body);
        if (isReservedUsername(next) || isReservedUsername(owner)) return res.status(403).json({ error: 'Protected account names cannot be changed here.' });
        if (await getActiveSilence(owner)) return res.status(403).json({ error: 'Account names cannot be changed while silenced.' });
        const slug = safeName(next);
        // Same locks as registration, in deterministic order for A→B / B→A.
        const locks = [...new Set([authKey(owner), authKey(slug)])].sort();
        const run = async (index: number): Promise<Awaited<ReturnType<typeof mutatePlayerSave>>> => {
            if (index < locks.length) return withKvLock(locks[index], () => run(index + 1), { failClosed: true, ttlSec: 30 });
            const reserved = await kv.get<string>(accountNameKey(slug));
            if ((reserved && reserved !== owner) || (slug !== owner && (await kv.get(authKey(slug)) || await kv.get(`save:${slug}`)))) {
                return { ok: false, status: 409, error: 'That account name is already taken.' };
            }
            // NX remains the gate if a lock lease expires. Keep reservations on
            // failure; only this owner can retry, and resolveAccountLogin checks
            // the committed save before accepting the name.
            if (!reserved && !(await kv.set(accountNameKey(slug), owner, { nx: true }))) {
                return { ok: false, status: 409, error: 'That account name is already taken. Try again.' };
            }
            return mutatePlayerSave(owner, ({ character }) => ({
                ok: true, character: { ...character, accountName: next }, value: null,
                ...(character.accountName === next ? { write: false } : {}),
            }));
        };
        const result = await run(0);
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, character: result.character, _saveVersion: result._saveVersion });
    } catch {
        return res.status(503).json({ error: 'Could not confirm the name change. Retry the same name to check it safely.' });
    }
}

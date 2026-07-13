import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { transferBankRyo, type BankTransferDirection } from './_wallet-transfer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const direction = String(body.direction ?? '') as BankTransferDirection;
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (direction !== 'deposit' && direction !== 'withdraw') return res.status(400).json({ error: 'Invalid transfer direction.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only transfer your own ryo.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'bank-transfer', 30, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const moved = transferBankRyo(character, direction, body.amount);
            if (!moved.ok) return { ok: false as const, status: 400, error: moved.error };
            return {
                ok: true as const,
                character: moved.character,
                value: { walletRyo: moved.walletRyo, bankRyo: moved.bankRyo, amount: moved.amount, direction },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[bank/transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

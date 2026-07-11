import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    applyBankTransfer,
    parseBankTransferAction,
    parseBankTransferAmount,
} from './_transfer.js';

/*
 * /api/bank/transfer - POST { playerName, action, amount }
 *
 * Moves ryo using only balances read under the fail-closed save lock. The
 * returned character is authoritative; clients must not reproduce the move
 * locally or fall back to a raw autosave.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const action = parseBankTransferAction(body.action);
        const amount = parseBankTransferAmount(body.amount);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!action) return res.status(400).json({ error: 'Action must be deposit or withdraw.' });
        if (amount === null) return res.status(400).json({ error: 'Amount must be a whole number from 1 to 10,000,000.' });

        // This is a personal economy action. Require the player's credential
        // instead of accepting either admin role as an authentication shortcut.
        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only use your own bank account.' });
        if (!(await enforceRateLimitKv(req, res, 'bank-transfer', 20, 60_000, identityName, { strict: true }))) return;
        // Compatibility-mode raw saves can still increase wallet ryo, while
        // bankRyo is server-pinned. Accepting that wallet as a deposit would let
        // a player repeatedly mint trusted bank principal. Withdrawals remain
        // safe; deposits reopen only after wallet ryo has a server ledger.
        if (action === 'deposit') {
            return res.status(503).json({ error: 'Bank deposits are temporarily unavailable while the wallet ledger is finalized. Nothing was changed.' });
        }

        try {
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                const transfer = applyBankTransfer(character, action, amount);
                if (!transfer.ok) return transfer;
                return {
                    ok: true,
                    character: transfer.character,
                    value: {
                        action: transfer.action,
                        amount: transfer.amount,
                        ryo: transfer.ryo,
                        bankRyo: transfer.bankRyo,
                    },
                };
            });
            if (!out.ok) return res.status(out.status).json({ error: out.error });
            return res.status(200).json({
                ok: true,
                ...out.value,
                character: out.character,
                _saveVersion: out._saveVersion,
            });
        } catch (err) {
            console.error('[bank/transfer] locked mutation failed', err);
            return res.status(503).json({ error: 'Could not update your bank account. Please retry.' });
        }
    } catch (err) {
        console.error('[bank/transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

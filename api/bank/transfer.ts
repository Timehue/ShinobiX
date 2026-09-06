import { safeLogValue } from '../_safe-log.js';
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    parseSettlementRequestId,
} from '../_settlement-receipts.js';
import {
    applyBankTransfer,
    parseBankTransferAction,
    parseBankTransferAmount,
    type BankTransferAction,
} from './_transfer.js';

/*
 * /api/bank/transfer - POST { playerName, action, amount, requestId? }
 *
 * Moves ryo using only balances read under the fail-closed save lock. The
 * returned character is authoritative; clients must not reproduce the move
 * locally or fall back to a raw autosave.
 *
 * `requestId` (optional, 16–80 chars) is the operation's replay identity. It
 * is settled with the in-save receipt convention (`serverSettlementReceipts`),
 * so the wallet/bank move and the proof it happened land in ONE save write:
 * the same id with the same action/amount returns the stored result without a
 * second move; the same id with a different payload is refused. A body without
 * an id runs exactly as before (no replay identity — legacy clients).
 *
 * `direction` is accepted as an alias of `action`: the Bank screen has sent
 * `direction` since 2026-07 while this handler only read `action`, so every
 * deposit/withdrawal from that screen was answered with a 400.
 */
export function bankTransferFingerprint(action: BankTransferAction, amount: number): string {
    return createHash('sha256').update(`bank-transfer:${action}:${amount}`).digest('hex').slice(0, 32);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const action = parseBankTransferAction(body.action ?? body.direction);
        const amount = parseBankTransferAmount(body.amount);
        const requestId = parseSettlementRequestId(body.requestId);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        if (!action) return res.status(400).json({ error: 'Action must be deposit or withdraw.' });
        if (amount === null) return res.status(400).json({ error: 'Amount must be a whole number from 1 to 10,000,000.' });
        if (body.requestId !== undefined && body.requestId !== null && !requestId) {
            return res.status(400).json({ error: 'Invalid requestId.' });
        }

        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only use your own bank account.' });
        if (!(await enforceRateLimitKv(req, res, 'bank-transfer', 20, 60_000, identityName, { strict: true }))) return;
        try {
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                const fingerprint = requestId ? bankTransferFingerprint(action, amount) : '';
                const inspected = requestId ? inspectSettlementReceipt(character, requestId, fingerprint) : null;
                if (inspected?.status === 'conflict') {
                    return { ok: false as const, status: 409, error: 'That request id was already used for a different bank operation.' };
                }
                if (inspected?.status === 'invalid') {
                    return { ok: false as const, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' };
                }
                if (inspected?.status === 'replay') {
                    // The move already happened in an earlier attempt whose
                    // response may have been lost. Return the stored result; the
                    // caller also receives the CURRENT authoritative character.
                    const stored = inspected.receipt.value;
                    return {
                        ok: true as const,
                        character,
                        value: {
                            action: stored.action as BankTransferAction,
                            amount: Number(stored.amount),
                            ryo: Number(stored.ryo),
                            bankRyo: Number(stored.bankRyo),
                            replayed: true,
                        },
                        write: false as const,
                    };
                }
                const transfer = applyBankTransfer(character, action, amount);
                if (!transfer.ok) return transfer;
                const value = {
                    action: transfer.action,
                    amount: transfer.amount,
                    ryo: transfer.ryo,
                    bankRyo: transfer.bankRyo,
                };
                return {
                    ok: true as const,
                    character: requestId && inspected?.status === 'fresh'
                        ? appendSettlementReceipt(transfer.character, inspected.receipts, {
                            requestId,
                            fingerprint,
                            value: { kind: 'bank-transfer', ...value },
                            settledAt: Date.now(),
                        })
                        : transfer.character,
                    value,
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
            console.error('[bank/transfer] locked mutation failed', safeLogValue(err));
            return res.status(503).json({ error: 'Could not update your bank account. Please retry.' });
        }
    } catch (err) {
        console.error('[bank/transfer]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

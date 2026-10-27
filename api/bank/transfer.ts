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
} from '../_settlement-receipts.js';
import {
    applyBankTransfer,
    type BankTransferAction,
} from './_transfer.js';
import { assessVillageTax } from '../_war-tax-apply.js';
import { villageTaxEcho } from '../village/_village-tax-echo.js';
import { bankTransferRequestContract, bankTransferResponseContract } from '../../shared/bank-contract.js';
import { contractResponse } from '../_contract-response.js';

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
    const reply = contractResponse(res, bankTransferResponseContract);

    try {
        const parsed = bankTransferRequestContract.safeParse(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
        if (!parsed.success) return reply(400, { error: parsed.error });
        const { action, amount, requestId } = parsed.data;
        const playerName = safeName(parsed.data.playerName);
        if (!playerName) return reply(400, { error: 'Missing playerName.' });

        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return reply(401, { error: 'Authentication required.' });
        if (identityName !== playerName) return reply(403, { error: 'You can only use your own bank account.' });
        if (!(await enforceRateLimitKv(req, res, 'bank-transfer', 20, 60_000, identityName, { strict: true }))) return;
        // The day's occupation tax, assessed by the server before the move (2026-10
        // rebalance, I-11): a conqueror's modded client that never called
        // /api/village/tax was never taxed. Outside the save lock (the tax takes its
        // own), idempotent per day, never throws. The move below reads the post-tax
        // balances, so the returned character already reflects it.
        const villageTax = await assessVillageTax(playerName);
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
            // A refusal still echoes the tax: its day stamp moved the save version,
            // and the client adopts that so its next autosave is not stale.
            if (!out.ok) return reply(out.status, { error: out.error, ...villageTaxEcho(villageTax) });
            return reply(200, {
                ok: true,
                ...out.value,
                character: out.character,
                _saveVersion: out._saveVersion,
                ...villageTaxEcho(villageTax),
            });
        } catch (err) {
            console.error('[bank/transfer] locked mutation failed', safeLogValue(err));
            return reply(503, { error: 'Could not update your bank account. Please retry.', ...villageTaxEcho(villageTax) });
        }
    } catch (err) {
        console.error('[bank/transfer]', safeLogValue(err));
        return reply(500, { error: 'Internal server error.' });
    }
}

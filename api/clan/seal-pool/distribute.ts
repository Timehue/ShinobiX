import { randomUUID } from 'node:crypto';
import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { safeName, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { LockContendedError } from '../../_lock.js';
import { writeVersionedPlayerSave } from '../../save/_mutate-player-save.js';
import { getDurableSettlement, settlementFingerprint, settlementTransactionId } from '../../_durable-settlement.js';
import { settleCrossKeyTransfer, SettlementValidationError } from '../../_cross-key-settlement.js';
import { loadPool, savePool, type ClanSealPool } from './_storage.js';

// Clan leader (clanFounder = true) distributes Honor Seals from the clan
// pool to a clan member. Recipient must be in the same clan.
const MIN_DISTRIBUTE = 1;
const MAX_DISTRIBUTE_PER_CALL = 500;
const OPERATION = 'clan-seal-distribute';

// Same bound as donate.ts. A client that sends no id gets a one-shot key: two
// deliberate gifts of the same amount to the same member are two gifts.
function requestIdFrom(raw: unknown): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(value)
        ? value
        : `legacy-${randomUUID().replace(/-/g, '')}`;
}

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

        const requestId = requestIdFrom(body.requestId);
        const transactionId = settlementTransactionId(OPERATION, requestId);

        // A retry of a gift that may already have moved Seals resumes it. It
        // must not be refused by a check that only a fresh gift needs: the
        // founder may have stepped down or left since, and refusing would
        // strand Seals that already left the pool. The journal remembers which
        // clan paid. A pending or cancelled attempt never wrote anything, so it
        // is checked again from the start.
        const journal = await getDurableSettlement(transactionId, { kv });
        const resuming = journal !== null && journal.state !== 'pending' && journal.state !== 'cancelled';
        let clanName: string;
        if (resuming) {
            const meta = journal.meta ?? {};
            if (meta.leaderName !== leaderName || meta.recipientName !== recipientName || journal.amount !== amount || typeof meta.clanName !== 'string') {
                return res.status(409).json({ error: 'That distribution request ID is already bound to a different distribution.', requestId });
            }
            clanName = meta.clanName;
        } else {
            const leaderRecord = await kv.get<Record<string, unknown>>(`save:${leaderName}`);
            const leaderChar = leaderRecord?.character as Record<string, unknown> | undefined;
            if (!leaderChar) return res.status(404).json({ error: 'Leader character not found.' });
            clanName = typeof leaderChar.clan === 'string' ? leaderChar.clan : '';
            if (!clanName) return res.status(400).json({ error: 'You must be in a clan to distribute.' });
            if (!identity.admin && !leaderChar.clanFounder) {
                return res.status(403).json({ error: 'Only the clan founder can distribute Honor Seals.' });
            }
        }

        // One settlement moves both sides exactly once per request id (see
        // api/_cross-key-settlement.ts). The pool row is locked first, then the
        // recipient's save, like every path that holds a shared row and a
        // player save. The pool receipt proves the debit and the in-save
        // receipt proves the credit, so a retry after any failure finishes what
        // is missing and never refunds a credit that may have landed.
        const poolKey = `clan-seal-pool:${clanName.toLowerCase()}`;
        const recipientKey = `save:${recipientName}`;
        let poolBalanceAfterDebit: number | null = null;
        const transfer = await settleCrossKeyTransfer<ClanSealPool>({
            operationType: OPERATION,
            idempotencyKey: requestId,
            fingerprint: settlementFingerprint({ operation: OPERATION, leaderName, recipientName, clanName: clanName.toLowerCase(), amount }),
            actorIds: [leaderName, recipientName, clanName.toLowerCase()],
            resource: 'honorSeals',
            amount,
            meta: { leaderName, recipientName, clanName },
            sourceKey: poolKey,
            recipientKey,
            loadSource: () => loadPool(clanName),
            validateSource: (pool) => {
                const available = Number(pool.balance ?? 0);
                if (available < amount) {
                    throw new SettlementValidationError(400, 'Not enough Seals in the clan pool.', { requested: amount, available });
                }
            },
            debitSource: (pool, receipt) => {
                poolBalanceAfterDebit = Number(pool.balance ?? 0) - amount;
                return {
                    ...pool,
                    balance: poolBalanceAfterDebit,
                    log: [{ kind: 'distribute', by: leaderName, to: recipientName, amount, at: receipt.appliedAt }, ...pool.log],
                    settlementReceipts: [{ ...receipt, value: { poolBalance: poolBalanceAfterDebit } }, ...(pool.settlementReceipts ?? [])].slice(0, 100),
                };
            },
            saveSource: (pool) => savePool(pool),
            loadRecipient: async () => {
                const record = await kv.get<Record<string, unknown>>(recipientKey);
                const character = record?.character as Record<string, unknown> | undefined;
                return record && character ? { record, character } : null;
            },
            validateRecipient: ({ character }) => {
                if (character.clan !== clanName) throw new SettlementValidationError(400, 'Recipient is not in your clan.');
            },
            creditRecipient: (character) => ({
                character: { ...character, honorSeals: Number(character.honorSeals ?? 0) + amount },
                result: {
                    distributed: amount,
                    recipient: recipientName,
                    ...(poolBalanceAfterDebit !== null ? { poolBalance: poolBalanceAfterDebit } : {}),
                },
            }),
            saveRecipient: async (record, character) => (await writeVersionedPlayerSave(recipientKey, record, character)).record,
        });

        // The settlement result carries the RECIPIENT's save version. The
        // client adopts any top-level _saveVersion as the caller's own, so it
        // never goes back to the leader.
        const result: Record<string, unknown> = { ...transfer.result };
        delete result._saveVersion;
        const poolBalance = typeof result.poolBalance === 'number' ? result.poolBalance : (await loadPool(clanName)).balance;
        return res.status(200).json({ ok: true, ...result, poolBalance, requestId });
    } catch (err) {
        if (err instanceof SettlementValidationError) {
            return res.status(err.status).json({ ...err.details, error: err.message });
        }
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The Seal pool is busy; retry with the same requestId.', retryable: true });
        }
        console.error('[clan/seal-pool/distribute]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

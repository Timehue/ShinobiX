import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { computeBankInterest, BANK_INTEREST_WINDOW_MS } from '../_bank-interest.js';
import { recordEconomyTxn } from '../_economy.js';
import { recordBetaMetric } from '../_beta-metrics.js';

/*
 * /api/bank/claim-interest  — POST only
 *
 * Server-authoritative Bank-interest claim (audit #7 / Stage 3 Phase 4f, the
 * first deterministic non-PvP source). The old flow let the CLIENT compute
 * `projectedInterest = floor(bankRyo × rate)` and self-apply it to `bankRyo`
 * via the save blob; the sanitizer only enforced the 24h timestamp window and
 * leaves `bankRyo` uncapped, so a crafted client could mint arbitrary banked
 * ryo through the interest claim.
 *
 * This endpoint OWNS the claim end-to-end: through mutatePlayerSave (the
 * autosave's `lock:save:<name>`, fail-closed, and an exact compare-and-set) it
 * reads the saved `bankRyo` + bank-upgrade rate, recomputes the interest with
 * the verbatim-ported `computeBankInterest` (server clock for the 24h gate → no
 * clock-rollback repeat), credits `bankRyo` and stamps `lastBankInterestAt`
 * atomically, contention → 503/retry. The same write settles the idle recovery
 * earned since the player's last save instead of discarding it. The client adds the
 * returned `claimed` delta to its OWN `bankRyo` (preserving concurrent deposits/
 * withdrawals) and re-asserts via autosave; the two converge. There is no
 * separate completion to verify — claiming interest IS the action, fully owned
 * here. Body: { playerName }. Caller MUST be the player (or admin). 30/min.
 */

const AUDIT_LOG_PREFIX = 'audit:bank-interest:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim your own bank interest.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'bank-claim-interest', 30, 60_000, identity.name))) return;

        const now = Date.now();

        type Decision =
            | { credited: false; reason: string; nextClaimAt: number }
            | { credited: true; interest: number; bankRyo: number; nextClaimAt: number; level: number };
        let committed: PlayerSaveMutationResult<Decision>;
        try {
            // `lastBankInterestAt` commits with the credit, so re-running the
            // whole claim after a lost compare-and-set can pay at most once.
            committed = await retryOnSaveVersionConflict(() => mutatePlayerSave<Decision>(playerName, ({ character: char }) => {
                const result = computeBankInterest(char, now);
                if (!result.eligible) {
                    return { ok: true, write: false, character: char, value: { credited: false, reason: result.reason, nextClaimAt: result.nextClaimAt } };
                }
                const nextBankRyo = (Number(char.bankRyo) || 0) + result.interest;
                const nextChar = { ...char, bankRyo: nextBankRyo, lastBankInterestAt: now };
                return {
                    ok: true,
                    character: nextChar,
                    value: { credited: true, interest: result.interest, bankRyo: nextBankRyo, nextClaimAt: now + BANK_INTEREST_WINDOW_MS, level: Number(char.level ?? 0) },
                };
            }));
        } catch (e) {
            console.error('[bank/claim-interest] credit failed', e);
            return res.status(503).json({ error: 'Could not claim bank interest — please retry.' });
        }

        if (!committed.ok) {
            if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
            return res.status(committed.status).json({ error: committed.error });
        }
        const out = { ...committed.value, saveVersion: committed._saveVersion };
        if (!out.credited) {
            return res.status(200).json({ ok: true, eligible: false, claimed: 0, reason: out.reason, nextClaimAt: out.nextClaimAt, _saveVersion: out.saveVersion });
        }

        await kv.set(`${AUDIT_LOG_PREFIX}${playerName}:${now}`, {
            ts: now,
            actor: identity.admin ? 'admin' : identity.name,
            claimed: out.interest,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        // Economy telemetry — bank interest is the top inflation faucet, so log it.
        await recordEconomyTxn({ txnId: `bank-interest:${playerName}:${now}`, player: playerName, currency: 'ryo', delta: out.interest, source: 'bank.interest', balanceAfter: out.bankRyo });
        await recordBetaMetric({ event: 'bank.interest.claimed', playerName, level: out.level, source: 'bank', ryo: out.interest });

        return res.status(200).json({
            ok: true,
            eligible: true,
            claimed: out.interest,
            bankRyo: out.bankRyo,
            lastBankInterestAt: now,
            nextClaimAt: out.nextClaimAt,
            _saveVersion: out.saveVersion,
        });
    } catch (err) {
        console.error('[bank/claim-interest]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

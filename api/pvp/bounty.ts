import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { runSaveDebitSaga, SaveDebitRefusal } from '../_save-debit-saga.js';
import { BOUNTY_PLACE_SAGA } from '../_save-debit-kinds.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { pvpSessionMayGrantProgress, type PvpSession } from './session.js';
import { loadPvpRewardRecoverySnapshot } from './_reward-recovery.js';
import { pvpTerminalRecoveryExpiresAt } from './_pending-session.js';
import {
    normalizeBoard,
    placeBounty,
    findBounty,
    findPendingBountyClaim,
    finishBountyClaim,
    reserveBountyClaim,
    restoreBountyClaim,
    BOUNTY_KEY,
    BOUNTY_AUDIT_PREFIX,
    type BountyBoard,
} from './_bounty.js';
import {
    bountyClaimRecordKey,
    duelBountyClaimId,
    payPendingBountyClaim,
    sweepPendingBountyClaims,
    writeDuelBountyRecord,
    type DuelBountyRecord,
} from './_bounty-claim.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { announce } from '../_announce.js';
import { contractHunterCooldownKey, contractHunterIdFor } from '../../shared/contract-hunter.js';

/*
 * /api/pvp/bounty — GET (board) + POST (place / claim)
 *
 * Server-authoritative PvP bounty board. Stake ryo on a player's head; whoever
 * beats them in a real duel claims the pool. Turns anonymous fights into grudges.
 *
 *   GET                          → { bounties: [...] }
 *   POST { action:'place', target, amount, requestId? }  → escrow ryo onto target's head
 *   POST { action:'claim', battleId }        → pay the winner the loser's pool
 *
 * Money safety:
 *   - place is a retry-safe save->board settlement (api/_save-debit-saga.ts,
 *     issue #179): board lock outside, placer's save lock inside, the debit and
 *     the escrow each written with a receipt. The same requestId never charges
 *     twice; a failed board write gives the stake back in the same request.
 *   - claim verifies against the real PvpSession (winner = claimer, loser = the
 *     bountied target, recent), is decided once per battle, and is VOID when
 *     the two fighters share an IP/device (no paying your own alt). It is
 *     two-phase (api/pvp/_bounty-claim.ts, issue #180): the head leaves the
 *     board BEFORE the winner is credited, so no other battle can collect the
 *     same pool if anything fails after that point.
 */

const SESSION_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Board (public, for the bounty-board UI + StartScreen) ────────────────
    if (req.method === 'GET') {
        const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=15');
        return res.status(200).json({ bounties: board.bounties });
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `pvp-bounty-${action}`, 20, 60_000, identity.name))) return;
        const now = Date.now();

        if (action === 'receipt') {
            const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
            const session = await kv.get<PvpSession>(`pvp:${battleId}`) ?? await loadPvpRewardRecoverySnapshot(kv, battleId);
            if (!session || session.status !== 'done' || !session.winner || session.winner === 'draw' || !pvpSessionMayGrantProgress(session)) {
                return res.status(404).json({ error: 'No confirmed battle receipt.' });
            }
            const winner = session.winner === 'p1' ? session.p1.name : session.p2.name;
            if (safeName(winner) !== playerName) return res.status(403).json({ error: 'Only the winner can read this bounty receipt.' });
            const receipt = await kv.get<{ amount?: number; target?: string }>(`pvp:bounty-claimed:${battleId}`);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ ok: true, amount: receipt?.amount ?? 0, target: receipt?.target });
        }

        // ── PLACE ────────────────────────────────────────────────────────────
        if (action === 'place') {
            const { resolvePlayerReference } = await import('../_account-name.js');
            const target = typeof body.target === 'string' ? await resolvePlayerReference(body.target.trim()) : '';
            const amount = Math.floor(num(body.amount));
            if (!target) return res.status(400).json({ error: 'Missing target.' });
            const targetSlug = safeName(target);
            const requestId = parseSettlementRequestId(body.requestId);
            if (body.requestId !== undefined && body.requestId !== null && !requestId) {
                return res.status(400).json({ error: 'Invalid requestId.' });
            }

            const targetRec = await kv.get<Record<string, unknown>>(`save:${targetSlug}`);
            const targetChar = (targetRec?.character ?? null) as Record<string, unknown> | null;
            const targetExists = !!targetChar;
            const targetDisplay = (targetChar?.name as string) ?? target;

            // No bountying someone on your own connection (would let you escrow
            // ryo to a head your main then claim it via a thrown duel).
            if (!identity.admin && targetExists) {
                try { if (await hasRecentIpOrFpOverlap(playerName, targetSlug)) return res.status(403).json({ error: "You can't place a bounty on someone sharing your connection." }); } catch { /* fail open */ }
            }

            // A SaveDebitRefusal or LockContendedError is answered by the outer catch.
            const settled = await runSaveDebitSaga({
                definition: BOUNTY_PLACE_SAGA,
                playerName,
                requestId,
                identity: { target: targetSlug, amount },
                sharedKey: BOUNTY_KEY,
                resource: 'ryo',
                amount,
                meta: { target: targetSlug },
                decide: ({ character, shared }) => {
                    const placer = identity.admin ? playerName : (character.name as string ?? playerName);
                    const board = shared ?? normalizeBoard(null);
                    const result = placeBounty({ placerName: placer, targetName: targetDisplay, amount, placerRyo: num(character.ryo), targetExists, board }, now);
                    if (!result.ok) return { ok: false, status: 400, error: result.reason };
                    return {
                        ok: true,
                        character: { ...character, ryo: num(character.ryo) - result.amount },
                        plan: { target: targetDisplay, amount: result.amount, placer },
                        result: { placer },
                    };
                },
                messages: {
                    refunded: 'The bounty board did not record your stake, so your ryo was returned. Please try again.',
                    pending: 'Your stake was taken but not yet posted. Place it again to finish; you will not be charged twice.',
                },
            });
            // Herald, notice and audit follow the escrow landing, once: a replay
            // moved nothing, and a resumed placement lands in this call.
            const placed = settled.replayed ? null : { placer: settled.result.placer ?? playerName, amount: settled.plan.amount };
            const out = {
                status: 200,
                body: {
                    ok: true,
                    bounties: settled.shared.bounties,
                    balances: { ryo: num(settled.character.ryo) },
                    _saveVersion: settled._saveVersion,
                    ...(settled.replayed ? { replayed: true } : {}),
                },
                placed,
            };

            if (out.placed) await kv.set(`${BOUNTY_AUDIT_PREFIX}place:${Date.now()}`, { ts: now, placer: playerName, target: targetSlug, amount }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            if (out.placed) {
                // Feed-only ("medium") — the board write is durable; the receipt
                // is the head + its updatedAt stamp (the stamp placeBounty wrote),
                // so a retried request cannot double-post.
                const head = findBounty(normalizeBoard({ bounties: out.body.bounties }), targetDisplay);
                try {
                    await announce({
                        type: 'bounty_placed',
                        importance: 'medium',
                        title: 'Bounty Posted',
                        // Thousands separators, explicitly en-US so the Herald
                        // line reads the same for every reader regardless of
                        // the host's locale. The client-side "while you were
                        // away" copy has always formatted these; the Herald was
                        // still shipping a bare `250000`.
                        message: `${out.placed.placer} put ${out.placed.amount.toLocaleString('en-US')} ryo on ${targetDisplay}'s head (total ${(head?.amount ?? out.placed.amount).toLocaleString('en-US')}).`,
                        player: out.placed.placer,
                        meta: { target: targetSlug, amount: out.placed.amount, total: head?.amount ?? out.placed.amount },
                    }, { receiptId: `bounty-placed:${targetSlug}:${head?.updatedAt ?? now}` });
                } catch { /* best-effort */ }
                // Tell the target — they wake up to "you're on the board" on
                // their next heartbeat (best-effort; the escrow is already durable).
                if (targetExists) {
                    try {
                        await pushOfflineNotice(targetSlug, { kind: 'bounty-placed', by: out.placed.placer, sector: 0, amount: out.placed.amount, total: head?.amount ?? out.placed.amount, at: now });
                    } catch { /* best-effort */ }
                }
            }
            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ──────────────────────────────────────────────────────────────
        if (action === 'ai-hunter-start') {
            // Read-only gate. The AI bounty hunter still spawns and fights you —
            // the client scales it to the pool size returned here — but an AI kill
            // NEVER settles the bounty. Only a real player winning a verified duel
            // can (the 'claim' action, cross-checked against a real PvpSession).
            // So this just confirms a bounty still exists and hands back its size
            // for scaling; there is nothing to settle, so no token is minted.
            const hunterId = typeof body.hunterId === 'string' ? body.hunterId.trim().slice(0, 140) : '';
            if (!/^[A-Za-z0-9:_-]{8,140}$/.test(hunterId)) {
                return res.status(400).json({ error: 'Missing hunterId.' });
            }
            const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
            const bounty = board.bounties.find((entry) => safeName(entry.target) === playerName);
            if (!bounty) return res.status(200).json({ ok: false, reason: 'no-bounty' });
            // The displayed hunter may come from an older board poll. Confirm
            // the exact contract before opening the combat overlay.
            if (hunterId !== contractHunterIdFor(bounty.target, bounty)) {
                return res.status(200).json({ ok: false, reason: 'stale-hunter', bounty });
            }
            const cooldown = await kv.get<{ until?: unknown }>(contractHunterCooldownKey(playerName, hunterId));
            const cooldownUntil = Number(cooldown?.until) || 0;
            if (cooldownUntil > Date.now()) {
                return res.status(200).json({ ok: false, reason: 'cooldown', cooldownUntil });
            }
            return res.status(200).json({
                ok: true,
                bounty: { target: bounty.target, amount: bounty.amount, contributors: bounty.contributors, updatedAt: bounty.updatedAt },
            });
        }

        if (action === 'ai-hunter-claim') {
            // AI bounty hunters do NOT collect bounties — that was the self-clear
            // exploit (a client-resolved PvE "loss" burned a bounty other players
            // had staked ryo on, with no authoritative receipt). The bounty stays
            // on the board until a real player claims it via 'claim'. This branch
            // is kept only so a client that hasn't updated yet gets a clean,
            // correct answer (its "the bounty could not be settled" path) instead
            // of an error. It never mutates the board.
            return res.status(200).json({ ok: true, amount: 0, uncollectible: true });
        }

        if (action === 'claim') {
            const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });

            // A settled player-ranked terminal compacts back to the ordinary
            // session lease well inside the 2h claim window below, so fall back
            // to the sealed recovery snapshot — the same immutable terminal
            // claim-rewards verifies against. Every check below still runs
            // against it, so a compacted row narrows nothing but the read.
            const session = await kv.get<PvpSession>(`pvp:${battleId}`)
                ?? await loadPvpRewardRecoverySnapshot(kv, battleId);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
                return res.status(409).json({ error: 'That battle is not decided yet.' });
            }
            if (!pvpSessionMayGrantProgress(session)) {
                return res.status(403).json({ error: 'That battle was not a mutually joined, sanctioned PvP match.' });
            }
            const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
            const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
            if (!identity.admin && safeName(winnerName) !== playerName) {
                return res.status(403).json({ error: 'Only the winner of that battle can claim its bounty.' });
            }
            // A completed payout can be read back for the result panel without
            // reopening eligibility for a new claim.
            const recordKey = bountyClaimRecordKey(battleId);
            const priorReceipt = await kv.get<DuelBountyRecord>(recordKey);
            if (priorReceipt?.amount && priorReceipt.balances) return res.status(200).json({ ok: true, alreadyClaimed: true, ...priorReceipt });
            const delayedClaim = now - num(session.createdAt) > SESSION_REPLAY_WINDOW_MS;
            const terminalAt = num(session.endedAt);
            // A failed reward settlement can keep the client from reaching this
            // optional claim for hours. Recovery snapshots last 48h. For a late
            // claim, require a sealed terminal time and prove below that the
            // current bounty head already existed before that terminal.
            if (delayedClaim) {
                let recoveryExpiresAt: number | null = null;
                try { recoveryExpiresAt = pvpTerminalRecoveryExpiresAt(session); } catch { /* invalid terminal */ }
                if (!recoveryExpiresAt || now >= recoveryExpiresAt) {
                    return res.status(409).json({ error: 'That battle is too old to claim a bounty.' });
                }
            }

            // The winner is paid from the SESSION, never from the request body: an
            // admin acting on a winner's behalf still pays that winner.
            const winnerSlug = safeName(winnerName);
            const claimId = duelBountyClaimId(battleId);
            const out = await withKvLock<{ status: number; body: unknown; paid?: number }>(BOUNTY_KEY, async () => {
                // Decided once per battle. Every outcome, paid or not, ends in the
                // per-battle record, and a present record is final: a retry of this
                // battle can never collect a bounty posted after it.
                const decided = await kv.get<DuelBountyRecord>(recordKey);
                if (decided) {
                    return { status: 200, body: { ok: true, alreadyClaimed: true, amount: 0, ...(decided.amount && decided.balances ? decided : {}) } };
                }
                let board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                // Finish any other payout an earlier crash left half done.
                const swept = await sweepPendingBountyClaims(board, now, claimId);
                let boardDirty = swept !== board;
                board = swept;
                const settleWithoutPayout = async (body: Record<string, unknown>, record: DuelBountyRecord) => {
                    if (boardDirty) await kv.set(BOUNTY_KEY, board);
                    await writeDuelBountyRecord(battleId, record);
                    return { status: 200, body };
                };

                let pending = findPendingBountyClaim(board, claimId);
                if (!pending) {
                    if (delayedClaim) {
                        const head = findBounty(board, loserName);
                        // A bounty posted or increased after this battle cannot be
                        // collected by replaying its old result. If the head changed
                        // since the battle, its old amount cannot be proven here.
                        if (!head || head.updatedAt <= 0 || head.updatedAt > terminalAt) {
                            return settleWithoutPayout({ ok: true, amount: 0 }, { ts: now, amount: 0 });
                        }
                    }
                    // No bounty on the loser — a harmless no-op.
                    if (!findBounty(board, loserName)) return settleWithoutPayout({ ok: true, amount: 0 }, { ts: now, amount: 0 });
                    // A shared connection voids only the optional bounty payout; it
                    // does not invalidate the already-authoritative battle result.
                    // Return a successful no-payout settlement so the winner's PvP
                    // completion callback can ACK and clear its pending-session
                    // pointer. The board is deliberately left unchanged for a
                    // legitimate hunter, while the battle record prevents a later
                    // retry from collecting a bounty posted after this duel.
                    try {
                        if (await hasRecentIpOrFpOverlap(winnerName, loserName)) {
                            return settleWithoutPayout({ ok: true, amount: 0, voided: 'shared-connection' }, { ts: now, amount: 0, voided: 'shared-connection' });
                        }
                    } catch { /* fail open */ }
                    // Phase 1: the head leaves the board before anyone is paid.
                    const reserved = reserveBountyClaim(board, loserName, { id: claimId, winner: winnerSlug, at: now, battleId });
                    if (!reserved.ok) return settleWithoutPayout({ ok: true, amount: 0 }, { ts: now, amount: 0 });
                    await kv.set(BOUNTY_KEY, reserved.board);
                    board = reserved.board;
                    boardDirty = false;
                    pending = reserved.pending;
                }

                // Phase 2: credit the winner, exactly once (in-save receipt).
                const paid = await payPendingBountyClaim(pending);
                if (paid.status === 'missing-save') {
                    // The winner can never be paid: put the pool back for a real
                    // hunter, and leave the battle undecided so a restored save
                    // can still claim it.
                    await kv.set(BOUNTY_KEY, restoreBountyClaim(board, claimId));
                    return { status: 404, body: { error: 'Your save was not found.' } };
                }
                if (paid.status === 'unprovable') {
                    if (boardDirty) await kv.set(BOUNTY_KEY, board).catch(() => undefined);
                    console.error('[pvp/bounty] claim needs reconciliation', claimId, paid.reason);
                    return { status: 409, body: { error: 'This bounty payout needs an administrator to finish it.', reconcile: true } };
                }

                // Phase 3: the battle's final answer, then the board clean-up. A
                // clean-up that fails leaves a pending entry the next sweep closes
                // without paying again.
                const amount = pending.head.amount;
                await writeDuelBountyRecord(battleId, { ts: now, amount, target: loserName, balances: { ryo: paid.ryo } });
                await kv.set(BOUNTY_KEY, finishBountyClaim(board, claimId)).catch((cleanupErr) => {
                    console.error('[pvp/bounty] pending claim clean-up deferred', claimId, safeLogValue(cleanupErr));
                });
                return {
                    status: 200,
                    body: { ok: true, amount, target: loserName, balances: { ryo: paid.ryo }, _saveVersion: paid.saveVersion },
                    // This call wrote the battle's record, which happens once per
                    // battle, so the herald and the loser's notice go out once.
                    paid: amount,
                };
            }, { failClosed: true });

            if (out.paid) await kv.set(`${BOUNTY_AUDIT_PREFIX}claim:${Date.now()}`, { ts: now, winner: playerName, target: safeName(loserName), amount: out.paid, battleId }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            if (out.paid) {
                // World Herald — the pool is credited; exact-once per battle.
                try {
                    await announce({
                        type: 'bounty_claimed',
                        importance: 'high',
                        title: 'Bounty Collected',
                        message: `${winnerName} collected the ${out.paid.toLocaleString('en-US')}-ryo bounty on ${loserName}.`,
                        player: winnerName,
                        meta: { battleId, target: safeName(loserName), amount: out.paid },
                    }, { receiptId: `bounty-claimed:${battleId}` });
                } catch { /* best-effort */ }
                // Tell the loser their head was collected (best-effort).
                try {
                    await pushOfflineNotice(safeName(loserName), { kind: 'bounty-claimed', by: winnerName, sector: 0, amount: out.paid, at: now });
                } catch { /* best-effort */ }
            }
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof SaveDebitRefusal) {
            return res.status(err.status).json({ ...err.details, error: err.message });
        }
        if (err instanceof LockContendedError) {
            // The fail-closed lock aborts before its own write. A claim that got
            // as far as reserving the head is resumed by the retry.
            return res.status(503).json({ error: 'The bounty board is busy — please retry.', retryable: true });
        }
        console.error('[pvp/bounty]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

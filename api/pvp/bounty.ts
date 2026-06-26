import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import type { PvpSession } from './session.js';
import { normalizeBoard, placeBounty, claimBounty, type BountyBoard } from './_bounty.js';

/*
 * /api/pvp/bounty — GET (board) + POST (place / claim)
 *
 * Server-authoritative PvP bounty board. Stake ryo on a player's head; whoever
 * beats them in a real duel claims the pool. Turns anonymous fights into grudges.
 *
 *   GET                          → { bounties: [...] }
 *   POST { action:'place', target, amount }  → escrow ryo onto target's head
 *   POST { action:'claim', battleId }        → pay the winner the loser's pool
 *
 * Money safety:
 *   - place debits the placer's ryo and credits the head pool atomically, under
 *     the board lock + the placer's save lock (board-outer / save-inner — the
 *     same ordering claim uses, so they can't deadlock).
 *   - claim verifies against the real PvpSession (winner = claimer, loser = the
 *     bountied target, recent), is idempotent per battle (NX receipt), and is
 *     VOID when the two fighters share an IP/device (no paying your own alt).
 */

const BOUNTY_KEY = 'pvp:bounties';
const SESSION_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;
const CLAIM_TTL_SECONDS = 24 * 60 * 60;
const AUDIT_PREFIX = 'audit:pvp-bounty:';

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

        // ── PLACE ────────────────────────────────────────────────────────────
        if (action === 'place') {
            const target = typeof body.target === 'string' ? body.target.trim() : '';
            const amount = Math.floor(num(body.amount));
            if (!target) return res.status(400).json({ error: 'Missing target.' });
            const targetSlug = safeName(target);

            const targetRec = await kv.get<Record<string, unknown>>(`save:${targetSlug}`);
            const targetChar = (targetRec?.character ?? null) as Record<string, unknown> | null;
            const targetExists = !!targetChar;
            const targetDisplay = (targetChar?.name as string) ?? target;

            // No bountying someone on your own connection (would let you escrow
            // ryo to a head your main then claim it via a thrown duel).
            if (!identity.admin && targetExists) {
                try { if (await hasRecentIpOrFpOverlap(playerName, targetSlug)) return res.status(403).json({ error: "You can't place a bounty on someone sharing your connection." }); } catch { /* fail open */ }
            }

            const out = await withKvLock<{ status: number; body: unknown }>(BOUNTY_KEY, async () => {
                const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                const debit = await withKvLock<{ ok: boolean; reason?: string; board?: BountyBoard; debited?: number }>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !char) return { ok: false, reason: 'Your save was not found.' };
                    const result = placeBounty({ placerName: identity.admin ? playerName : (char.name as string ?? playerName), targetName: targetDisplay, amount, placerRyo: num(char.ryo), targetExists, board }, now);
                    if (!result.ok) return { ok: false, reason: result.reason };
                    await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: { ...char, ryo: num(char.ryo) - result.amount } }, rec));
                    return { ok: true, board: result.board, debited: result.amount };
                }, { failClosed: true });
                if (!debit.ok) return { status: 400, body: { error: debit.reason ?? 'Could not place the bounty.' } };
                try {
                    await kv.set(BOUNTY_KEY, debit.board);
                } catch (boardErr) {
                    // The ryo is already debited but the board never recorded the
                    // escrow. Best-effort re-credit the placer's ryo (under their
                    // save lock) so the stake isn't lost to a vanished bounty,
                    // then surface the failure so the client can retry.
                    try {
                        await withKvLock<void>(`save:${playerName}`, async () => {
                            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                            const char = (rec?.character ?? null) as Record<string, unknown> | null;
                            if (rec && char) await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: { ...char, ryo: num(char.ryo) + (debit.debited ?? 0) } }, rec));
                        }, { failClosed: true });
                    } catch (refundErr) {
                        console.error('[pvp/bounty] place credit-back failed', refundErr);
                    }
                    throw boardErr;
                }
                return { status: 200, body: { ok: true, bounties: debit.board!.bounties } };
            }, { failClosed: true });

            if (out.status === 200) await kv.set(`${AUDIT_PREFIX}place:${Date.now()}`, { ts: now, placer: playerName, target: targetSlug, amount }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }

        // ── CLAIM ──────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const battleId = typeof body.battleId === 'string' ? body.battleId.trim() : '';
            if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });

            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner || session.winner === 'draw') {
                return res.status(409).json({ error: 'That battle is not decided yet.' });
            }
            if (now - num(session.createdAt) > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'That battle is too old to claim a bounty.' });
            }
            const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
            const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
            if (!identity.admin && safeName(winnerName) !== playerName) {
                return res.status(403).json({ error: 'Only the winner of that battle can claim its bounty.' });
            }

            // Void if the two fighters share an IP/device — same ladder-integrity
            // rule as ranked rating. Bounty pool stays for a legitimate hunter.
            try { if (await hasRecentIpOrFpOverlap(winnerName, loserName)) return res.status(403).json({ error: 'Bounty not paid: you and that player share a connection.' }); } catch { /* fail open */ }

            const out = await withKvLock<{ status: number; body: unknown; paid?: number }>(BOUNTY_KEY, async () => {
                // Per-battle idempotency — a single duel pays a bounty at most
                // once. Reserved INSIDE the failClosed lock (mirrors
                // claim-rewards.ts ordering) so lock contention / KV failure can
                // never leave the receipt placed while the winner goes unpaid and
                // a retry short-circuits to alreadyClaimed.
                const placed = await kv.set(`pvp:bounty-claimed:${battleId}`, { ts: now }, { nx: true, ex: CLAIM_TTL_SECONDS } as never);
                if (!placed) return { status: 200, body: { ok: true, alreadyClaimed: true, amount: 0 } };
                const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                const result = claimBounty(board, loserName);
                if (!result.ok) return { status: 200, body: { ok: true, amount: 0 } }; // no bounty on the loser — harmless no-op
                const credit = await withKvLock<{ ok: boolean }>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !char) return { ok: false };
                    await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: { ...char, ryo: num(char.ryo) + result.amount } }, rec));
                    return { ok: true };
                }, { failClosed: true });
                if (!credit.ok) {
                    // Winner's save vanished — release the idempotency receipt so a
                    // later retry can settle, rather than locking the bounty out.
                    await kv.del(`pvp:bounty-claimed:${battleId}`).catch(() => undefined);
                    return { status: 404, body: { error: 'Your save was not found.' } };
                }
                await kv.set(BOUNTY_KEY, result.board);
                return { status: 200, body: { ok: true, amount: result.amount, target: loserName }, paid: result.amount };
            }, { failClosed: true });

            if (out.paid) await kv.set(`${AUDIT_PREFIX}claim:${Date.now()}`, { ts: now, winner: playerName, target: safeName(loserName), amount: out.paid, battleId }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[pvp/bounty]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

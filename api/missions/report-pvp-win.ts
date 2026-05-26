import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { reportMissionEvent } from './_progress.js';
import type { PvpSession } from '../pvp/session.js';
import { hasRecentIpOverlap } from '../_player-ips.js';

// Quick-surrender protection: fights ending in <15s grant no mission progress.
const MIN_FIGHT_DURATION_MS = 15_000;
const ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;

// Server-validated report channel for Vanguard PvP-win missions. The client
// calls this after handlePvpWin fires. The server cross-checks the reported
// win against the actual PvpSession state so a malicious client can't just
// claim wins it didn't earn.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const battleId = String(body.battleId ?? '').trim();
        const opponentName = safeName(String(body.opponentName ?? ''));
        if (!playerName || !battleId || !opponentName) {
            return res.status(400).json({ error: 'Missing playerName, battleId, or opponentName.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own wins.' });
        }

        // Validate the win against the actual PvP session. Key is `pvp:${id}`
        // — must match what session.ts writes and move.ts reads (an earlier
        // mismatched `pvp:session:${id}` here silently 404'd every Vanguard
        // PvP-win mission report).
        const session = await kv.get<PvpSession>(`pvp:${battleId}`);
        if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
        if (session.status !== 'done' || !session.winner) {
            return res.status(409).json({ error: 'Battle not yet decided.' });
        }
        const winnerName = session.winner === 'p1' ? session.p1.name : session.winner === 'p2' ? session.p2.name : '';
        const loserName = session.winner === 'p1' ? session.p2.name : session.winner === 'p2' ? session.p1.name : '';
        if (winnerName.toLowerCase() !== playerName.toLowerCase()) {
            return res.status(403).json({ error: 'You are not the winner of this battle.' });
        }
        if (loserName.toLowerCase() !== opponentName.toLowerCase()) {
            return res.status(400).json({ error: 'Opponent name does not match the recorded loser.' });
        }

        // Look up player's profession.
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'vanguard') {
            // Not a Vanguard — nothing to do, but return 200 so the client
            // doesn't treat it as an error.
            return res.status(200).json({ ok: true, vanguard: false });
        }

        // Anti-abuse checks (mission rewards only; Honor Seals are gated
        // client-side until server-side rewards land).
        const fightStarted = Number(session.createdAt ?? 0);
        const fightDuration = fightStarted ? Date.now() - fightStarted : 0;
        if (fightDuration < MIN_FIGHT_DURATION_MS) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'quick-surrender', xpAwarded: 0, missionsCompleted: [] });
        }

        const opponentRecord = await kv.get<Record<string, unknown>>(`save:${opponentName}`);
        const opponentChar = opponentRecord?.character as Record<string, unknown> | undefined;
        const opponentCreated = Number(opponentChar?.createdAt ?? 0);
        if (opponentCreated > 0 && (Date.now() - opponentCreated) < ACCOUNT_AGE_MIN_MS) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'account-too-young', xpAwarded: 0, missionsCompleted: [] });
        }

        const sharesIp = await hasRecentIpOverlap(playerName, opponentName);
        if (sharesIp) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'same-ip', xpAwarded: 0, missionsCompleted: [] });
        }

        // Idempotency: stamp this battle as already-reported so a client retry
        // (network blip, page reload) can't double-credit. 24h TTL covers any
        // reasonable retry window.
        const idemKey = `missions:pvp-reported:${playerName}:${battleId}`;
        const already = await kv.get<boolean>(idemKey);
        if (already) {
            return res.status(200).json({ ok: true, alreadyReported: true });
        }
        await kv.set(idemKey, true, { ex: 24 * 60 * 60 });

        const winsResult = await reportMissionEvent({
            playerName,
            profession: 'vanguard',
            kind: 'vanguard-pvp-wins',
        });
        const uniqueResult = await reportMissionEvent({
            playerName,
            profession: 'vanguard',
            kind: 'vanguard-pvp-unique',
            targetName: opponentName.toLowerCase(),
        });

        return res.status(200).json({
            ok: true,
            vanguard: true,
            xpAwarded: winsResult.xpAwarded + uniqueResult.xpAwarded,
            missionsCompleted: [...winsResult.missionsCompleted, ...uniqueResult.missionsCompleted],
        });
    } catch (err) {
        console.error('[missions/report-pvp-win]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

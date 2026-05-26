import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    applyLazyClanWarExpiry,
    CHALLENGE_DAMAGE,
    CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey,
    loadClanContext,
    type ChallengeResult,
    type ClanWar,
} from './_storage.js';

// POST /api/clan/war/report
// Body: { warId, challengeId, result: 'from-wins' | 'to-wins' | 'draw' }
//
// Validates the reporter is one of the 2 (or 4 for 2v2) participants.
// Applies HP damage to the losing clan based on the challenge's mode
// tier. Stamps the challenge as completed and moves it to history.
// On a draw: no damage, no win credit.
// If the damage drives a clan's HP to 0: stamps endedAt, winnerClan,
// sets the 7-day rematch cooldown key, computes MVP per clan from
// the completed-challenges history.

function isParticipant(playerName: string, ch: { fromPlayer: string; fromPlayer2?: string; acceptedPlayer?: string; acceptedPlayer2?: string }): boolean {
    const n = playerName.toLowerCase();
    if ((ch.fromPlayer ?? '').toLowerCase() === n) return true;
    if ((ch.fromPlayer2 ?? '').toLowerCase() === n) return true;
    if ((ch.acceptedPlayer ?? '').toLowerCase() === n) return true;
    if ((ch.acceptedPlayer2 ?? '').toLowerCase() === n) return true;
    return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-war-report', 30, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const warId = String(body?.warId ?? '').trim();
        const challengeId = String(body?.challengeId ?? '').trim();
        const result = String(body?.result ?? '') as ChallengeResult;
        if (!warId || !challengeId) return res.status(400).json({ error: 'Missing warId or challengeId.' });
        if (result !== 'from-wins' && result !== 'to-wins' && result !== 'draw') {
            return res.status(400).json({ error: "Invalid result; must be 'from-wins' | 'to-wins' | 'draw'." });
        }

        const key = `clan-war:${warId}`;

        const lockResult = await withKvLock(key, async () => {
            const fresh = await kv.get<ClanWar>(key);
            if (!fresh) return { status: 404 as const, body: { error: 'War not found.' } };
            let war = applyLazyClanWarExpiry(fresh).war;
            if (war.endedAt) {
                return { status: 409 as const, body: { error: 'War has already ended.' } };
            }

            const ch = war.pendingChallenges.find(c => c.id === challengeId);
            if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already completed.' } };
            if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };

            // Participant check (admin bypasses).
            if (!identity.admin && !isParticipant(identity.name, ch)) {
                return { status: 403 as const, body: { error: 'Only a participant can report this result.' } };
            }

            const now = Date.now();
            const dmg = CHALLENGE_DAMAGE[ch.mode] ?? 0;
            const winnerClanName = result === 'from-wins' ? ch.fromClan : result === 'to-wins' ? war.clans.find(c => c !== ch.fromClan) : undefined;
            const loserClanName = winnerClanName ? war.clans.find(c => c !== winnerClanName) : undefined;

            const updatedHp = { ...war.hp };
            if (loserClanName && dmg > 0 && result !== 'draw') {
                updatedHp[loserClanName] = Math.max(0, (war.hp[loserClanName] ?? 0) - dmg);
            }

            const completed = { ...ch, status: 'completed' as const, result, completedAt: now };
            war = {
                ...war,
                hp: updatedHp,
                pendingChallenges: war.pendingChallenges.filter(c => c.id !== ch.id),
                completedChallenges: [completed, ...war.completedChallenges].slice(0, 200),
                updatedAt: now,
            };

            // Check for war end: one clan's HP hit 0.
            let warJustEnded = false;
            for (const clan of war.clans) {
                if (updatedHp[clan] <= 0 && !war.endedAt) {
                    const otherClan = war.clans.find(c => c !== clan)!;
                    war = {
                        ...war,
                        endedAt: now,
                        winnerClan: otherClan,
                    };
                    warJustEnded = true;
                    break;
                }
            }

            if (warJustEnded) {
                // Compute MVP per clan from completed challenges — most
                // wins on each side. Tiebreak by most damage contributed.
                const mvpByClan: Record<string, string> = {};
                for (const clan of war.clans) {
                    const tallies = new Map<string, { wins: number; damage: number }>();
                    for (const past of war.completedChallenges) {
                        if (past.status !== 'completed' || !past.result || past.result === 'draw') continue;
                        const won = (past.result === 'from-wins' && past.fromClan === clan) || (past.result === 'to-wins' && past.fromClan !== clan);
                        if (!won) continue;
                        const winners = past.fromClan === clan
                            ? [past.fromPlayer, past.fromPlayer2].filter(Boolean) as string[]
                            : [past.acceptedPlayer, past.acceptedPlayer2].filter(Boolean) as string[];
                        const dealt = CHALLENGE_DAMAGE[past.mode] ?? 0;
                        for (const p of winners) {
                            const cur = tallies.get(p) ?? { wins: 0, damage: 0 };
                            cur.wins += 1;
                            cur.damage += dealt;
                            tallies.set(p, cur);
                        }
                    }
                    const top = [...tallies.entries()].sort(([, a], [, b]) => b.wins - a.wins || b.damage - a.damage)[0];
                    if (top) mvpByClan[clan] = top[0];
                }
                war = { ...war, mvpByClan };
                // 7-day rematch cooldown stamp.
                await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
            }

            await kv.set(key, war);
            return { status: 200 as const, body: { war, challenge: completed, warEnded: warJustEnded } };
        });
        return res.status(lockResult.status).json(lockResult.body);
    } catch (err) {
        console.error('[clan/war/report]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

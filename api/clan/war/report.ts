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
    finalizeClanWarEnd,
    isTentativeAutoConfirmable,
    type ChallengeResult,
    type ClanWar,
    type ClanChallenge,
} from './_storage.js';

// POST /api/clan/war/report
// Body: { warId, challengeId, result: 'from-wins' | 'to-wins' | 'draw' }
//
// Two-phase reporting to defeat the single-side fake-win exploit:
//   1. First reporter ("tentative"): server stamps tentativeResult /
//      tentativeBy / tentativeAt on the challenge. No damage applied
//      yet. The challenge stays in pendingChallenges with status
//      'accepted' so participants on the other side can see it and
//      respond. The response carries warEnded=false, tentative=true.
//   2. Second reporter MUST be on the opposite side (i.e. one of the
//      two from-side players reported first → confirm/dispute must
//      come from a to-side player, and vice versa).
//        - If results match → confirm; apply damage, finalize.
//        - If results differ → mark as 'draw'; no damage. (We treat
//          disputes as draws so a malicious actor can't deny rewards
//          either.)
//   3. Auto-confirm: lazy expiry promotes tentative → final after
//      REPORT_AUTO_CONFIRM_MS (15 min). This handles cases where the
//      losing side ghosts. (Future: implemented in a follow-up tick.)
//
// Participant gating: only one of the 2 (or 4 for 2v2) named
// participants on the challenge can submit a result. Admin bypasses.

function isParticipant(playerName: string, ch: { fromPlayer: string; fromPlayer2?: string; acceptedPlayer?: string; acceptedPlayer2?: string }): boolean {
    const n = playerName.toLowerCase();
    if ((ch.fromPlayer ?? '').toLowerCase() === n) return true;
    if ((ch.fromPlayer2 ?? '').toLowerCase() === n) return true;
    if ((ch.acceptedPlayer ?? '').toLowerCase() === n) return true;
    if ((ch.acceptedPlayer2 ?? '').toLowerCase() === n) return true;
    return false;
}

function playerOnFromSide(playerName: string, ch: { fromPlayer: string; fromPlayer2?: string }): boolean {
    const n = playerName.toLowerCase();
    return (ch.fromPlayer ?? '').toLowerCase() === n
        || (ch.fromPlayer2 ?? '').toLowerCase() === n;
}

// Apply a confirmed result: HP damage, move to completed history,
// check for war end. Returns the updated war + the completed
// challenge entry. Caller is responsible for kv.set + cooldown stamp.
function applyFinalResult(war: ClanWar, ch: ClanChallenge, result: ChallengeResult, now: number): { war: ClanWar; completed: ClanChallenge; warJustEnded: boolean } {
    const dmg = CHALLENGE_DAMAGE[ch.mode] ?? 0;
    const winnerClanName = result === 'from-wins' ? ch.fromClan : result === 'to-wins' ? war.clans.find(c => c !== ch.fromClan) : undefined;
    const loserClanName = winnerClanName ? war.clans.find(c => c !== winnerClanName) : undefined;

    const updatedHp = { ...war.hp };
    if (loserClanName && dmg > 0 && result !== 'draw') {
        updatedHp[loserClanName] = Math.max(0, (war.hp[loserClanName] ?? 0) - dmg);
    }

    const completed: ClanChallenge = {
        ...ch,
        status: 'completed',
        result,
        completedAt: now,
        // Clear tentative fields once finalized.
        tentativeResult: undefined,
        tentativeBy: undefined,
        tentativeAt: undefined,
    };
    let next: ClanWar = {
        ...war,
        hp: updatedHp,
        pendingChallenges: war.pendingChallenges.filter(c => c.id !== ch.id),
        completedChallenges: [completed, ...war.completedChallenges].slice(0, 200),
        updatedAt: now,
    };

    // Check for war end: one clan's HP hit 0.
    let warJustEnded = false;
    let losingClan: string | undefined;
    for (const clan of next.clans) {
        if (updatedHp[clan] <= 0 && !next.endedAt) {
            losingClan = clan;
            warJustEnded = true;
            break;
        }
    }
    if (warJustEnded && losingClan) {
        const wc = next.clans.find(c => c !== losingClan)!;
        next = finalizeClanWarEnd(next, { endedAt: now, winnerClan: wc, reason: 'hp-zero' });
    }
    return { war: next, completed, warJustEnded };
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
            const expiry = applyLazyClanWarExpiry(fresh);
            let war = expiry.war;
            if (war.endedAt) {
                if (expiry.changed) {
                    await kv.set(key, war);
                    if (expiry.needsCooldownStamp) {
                        await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), war.endedAt, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
                    }
                }
                return { status: 409 as const, body: { error: 'War has already ended.' } };
            }

            const ch = war.pendingChallenges.find(c => c.id === challengeId);
            if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already completed.' } };
            if (ch.status !== 'accepted') return { status: 409 as const, body: { error: 'Challenge has not been accepted yet.' } };

            // Participant check (admin bypasses for both phases).
            if (!identity.admin && !isParticipant(identity.name, ch)) {
                return { status: 403 as const, body: { error: 'Only a participant can report this result.' } };
            }

            const now = Date.now();

            // Admin: skip two-phase entirely, finalize immediately.
            if (identity.admin) {
                const { war: nextWar, completed, warJustEnded } = applyFinalResult(war, ch, result, now);
                war = nextWar;
                if (warJustEnded) {
                    await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
                }
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false } };
            }

            const reporterOnFromSide = playerOnFromSide(identity.name, ch);

            // ── Phase 0: stale tentative → auto-confirm ──────────────
            // If a tentative has been sitting for ≥ REPORT_AUTO_CONFIRM_MS
            // and the opposing side never responded, ANY participant
            // calling /api/clan/war/report finalizes the tentative as
            // submitted (the report body's `result` is ignored — the
            // first reporter's call wins).
            if (ch.tentativeResult && isTentativeAutoConfirmable(ch, now)) {
                const { war: nextWar, completed, warJustEnded } = applyFinalResult(war, ch, ch.tentativeResult, now);
                war = nextWar;
                if (warJustEnded) {
                    await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
                }
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false, autoConfirmed: true } };
            }

            // ── Phase 1: no tentative yet → stamp one ────────────────
            if (!ch.tentativeResult) {
                const updated: ClanChallenge = {
                    ...ch,
                    tentativeResult: result,
                    tentativeBy: identity.name,
                    tentativeAt: now,
                };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge: updated, warEnded: false, tentative: true } };
            }

            // ── Phase 2: a tentative exists; only the OTHER side may confirm/dispute ──
            const tentativeReporterOnFromSide = playerOnFromSide(ch.tentativeBy ?? '', ch);
            const samePlayer = (ch.tentativeBy ?? '').toLowerCase() === identity.name.toLowerCase();
            if (samePlayer) {
                return { status: 409 as const, body: { error: 'You already submitted a tentative result. Wait for the opposing side to confirm or dispute.' } };
            }
            if (reporterOnFromSide === tentativeReporterOnFromSide) {
                return { status: 409 as const, body: { error: 'Waiting on the opposing side to confirm or dispute the tentative result.' } };
            }

            // Match → finalize as the tentative result.
            // Mismatch → finalize as 'draw' (disputed results award nothing).
            const finalResult: ChallengeResult = (ch.tentativeResult === result) ? ch.tentativeResult : 'draw';
            const { war: nextWar, completed, warJustEnded } = applyFinalResult(war, ch, finalResult, now);
            war = nextWar;
            if (warJustEnded) {
                await kv.set(clanWarCooldownKey(war.clans[0], war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
            }
            await kv.set(key, war);
            return { status: 200 as const, body: { war, challenge: completed, warEnded: warJustEnded, tentative: false, disputed: finalResult === 'draw' && ch.tentativeResult !== result } };
        });
        return res.status(lockResult.status).json(lockResult.body);
    } catch (err) {
        console.error('[clan/war/report]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

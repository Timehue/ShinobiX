import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

const CHALLENGE_TTL = 120; // seconds — long enough for two heartbeat cycles

function challengeKey(name: string) {
    return `challenges:${name.toLowerCase().trim()}`;
}

function outgoingKey(name: string) {
    return `challenge-outgoing:${name.toLowerCase().trim()}`;
}

function challengeId(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'id' in challenge
        ? String((challenge as { id?: unknown }).id ?? '')
        : '';
}

function challengeFromName(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'fromName' in challenge
        ? String((challenge as { fromName?: unknown }).fromName ?? '').trim()
        : '';
}

// Server-clamp clanWarPoints to the mode's legal value. Without this,
// a malicious challenger could set clanWarPoints: 9999 on the body and
// the client's `addClanWarPoints` call after a win would credit the
// inflated value to the clan leaderboard.
//
// Keep in sync with the client's challengePlayer() call sites
// (App.tsx ~33901-33903):
//   clanWar1v1 → +50
//   clanWar2v2 → +100
//   clanWarPet → +25
//   anything else → 0
const CLAN_WAR_POINTS_BY_MODE: Record<string, number> = {
    clanWar1v1: 50,
    clanWar2v2: 100,
    clanWarPet: 25,
};

function clampClanWarPoints(challenge: unknown): unknown {
    if (!challenge || typeof challenge !== 'object') return challenge;
    const rec = challenge as Record<string, unknown>;
    const mode = String(rec.mode ?? '');
    const cap = CLAN_WAR_POINTS_BY_MODE[mode] ?? 0;
    if (typeof rec.clanWarPoints !== 'number' && rec.clanWarPoints !== undefined) {
        // Non-number — coerce to 0.
        return { ...rec, clanWarPoints: 0 };
    }
    const pts = Number(rec.clanWarPoints ?? 0);
    if (!Number.isFinite(pts) || pts <= 0) {
        // Strip any falsy or NaN value so downstream UI doesn't choke.
        if ('clanWarPoints' in rec) {
            const { clanWarPoints: _drop, ...rest } = rec;
            void _drop;
            return rest;
        }
        return rec;
    }
    if (pts > cap) {
        return { ...rec, clanWarPoints: cap };
    }
    return rec;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // All challenge operations require a logged-in player (or admin).
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        if (req.method === 'DELETE') {
            const { targetName, challengeId: id, fromName } = body as { targetName?: string; challengeId?: string; fromName?: string };
            if (!targetName && !fromName) return res.status(400).json({ error: 'Missing targetName or fromName.' });
            const pendingKey = targetName ? challengeKey(targetName) : '';
            const existing = pendingKey ? await kv.get<unknown[]>(pendingKey) ?? [] : [];
            const updated = id ? existing.filter(challenge => challengeId(challenge) !== id) : existing;
            await Promise.all([
                pendingKey ? (updated.length ? kv.set(pendingKey, updated, { ex: CHALLENGE_TTL }) : kv.del(pendingKey)) : Promise.resolve(),
                fromName ? kv.del(outgoingKey(fromName)) : Promise.resolve(),
            ]);
            return res.status(200).json({ ok: true });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const { targetName, challenge } = body as { targetName?: string; challenge?: unknown };
        if (!targetName || !challenge) return res.status(400).json({ error: 'Missing targetName or challenge.' });

        const record = challenge as { accepted?: boolean; declined?: boolean; battleId?: string };
        const fromName = challengeFromName(challenge);

        // The challenge's fromName (sender) must match the authed identity unless admin.
        if (!identity.admin && fromName && fromName.toLowerCase() !== identity.name) {
            return res.status(403).json({ error: 'Cannot send a challenge as another player.' });
        }

        // For new challenges (not accept/decline/battle routing), gate on travel + battle state.
        if (!record.accepted && !record.declined && !record.battleId) {
            const targetPresence = await kv.get<Record<string, unknown>>(`presence:${targetName}`);
            if (targetPresence) {
                if (Number(targetPresence.travelingUntil ?? 0) > Date.now()) {
                    return res.status(409).json({ error: 'Target is traveling.' });
                }
                if (targetPresence.inBattle) {
                    return res.status(409).json({ error: 'Target is already in a battle.' });
                }
                if (targetPresence.pendingAttacker) {
                    return res.status(409).json({ error: 'Target is already engaged in combat.' });
                }
            }
        }

        if (record.accepted || record.declined) {
            await kv.del(outgoingKey(targetName));
        } else if (fromName && !record.battleId) {
            const senderKey = outgoingKey(fromName);
            const existingOutgoing = await kv.get(senderKey);
            if (existingOutgoing) {
                return res.status(409).json({ error: 'You already have a pending challenge.' });
            }
            await kv.set(senderKey, { targetName, challengeId: challengeId(challenge), createdAt: Date.now() }, { ex: CHALLENGE_TTL });
        }

        // Clamp clanWarPoints to the mode's legal value before persisting.
        // The win-credit path (App.tsx handlePvpWin → addClanWarPoints)
        // trusts whatever value sits on the stored challenge, so clamping
        // here is the only chokepoint that prevents inflation.
        const safeChallenge = clampClanWarPoints(challenge);

        // Read-modify-write — the previous retry loop was dead code (broke on
        // iter 0). Concurrent challenges to the same target can race; we
        // dedupe by id so retries don't duplicate, but a true CAS would need
        // RPC-level support.
        const key = challengeKey(targetName);
        const existing = await kv.get<unknown[]>(key) ?? [];
        const cid = challengeId(challenge);
        const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
        const updated = [...deduped, safeChallenge].slice(-20);
        await kv.set(key, updated, { ex: CHALLENGE_TTL });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

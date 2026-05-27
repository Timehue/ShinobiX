import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';

const CHALLENGE_TTL = 120; // seconds — long enough for two heartbeat cycles

// Public projection for the challenger character stored alongside a
// challenges:<name> entry. The challenges:* prefix is anon-readable via
// Supabase Realtime (see supabase-schema.sql), so the FULL challenger
// character — including ryo, jutsu, equipment, stats — would otherwise
// be world-readable to any anon WS subscriber. Strip down to the bare
// minimum the recipient's inbox needs to render: name, level, village,
// avatar, cosmetic title, ranked rating.
const CHALLENGER_PUBLIC_FIELDS = new Set<string>([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
]);
function projectChallengerCharacter(c: unknown): unknown {
    if (!c || typeof c !== 'object') return c;
    const src = c as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS) if (k in src) out[k] = src[k];
    return out;
}
function projectChallenge(c: unknown): unknown {
    if (!c || typeof c !== 'object') return c;
    const rec = c as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rec };
    if ('challenger' in rec) out.challenger = projectChallengerCharacter(rec.challenger);
    return out;
}

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
            // Lock the recipient's inbox during the read-filter-write so a
            // concurrent POST adding a new challenge can't be silently
            // overwritten by our DELETE (or vice versa).
            if (pendingKey) {
                await withKvLock(pendingKey, async () => {
                    const existing = await kv.get<unknown[]>(pendingKey) ?? [];
                    const updated = id ? existing.filter(challenge => challengeId(challenge) !== id) : existing;
                    if (updated.length) await kv.set(pendingKey, updated, { ex: CHALLENGE_TTL });
                    else await kv.del(pendingKey);
                });
            }
            if (fromName) await kv.del(outgoingKey(fromName));
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

        // Two server-side transforms before the challenge hits KV:
        //   1. clampClanWarPoints — keeps the win-credit path honest.
        //   2. projectChallenge   — strips the challenger's full character
        //      down to the inbox-renderable public projection. The
        //      challenges:* key prefix is anon-readable via Supabase
        //      Realtime; the full payload would otherwise leak ryo /
        //      jutsu / equipment / stats to any anon WS subscriber.
        const safeChallenge = projectChallenge(clampClanWarPoints(challenge));

        // Lock the recipient's inbox around the read-dedupe-write so two
        // simultaneous challengers can't both read the same snapshot and
        // both produce a final list that's missing the other's entry.
        const key = challengeKey(targetName);
        const cid = challengeId(challenge);
        await withKvLock(key, async () => {
            const existing = await kv.get<unknown[]>(key) ?? [];
            const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
            const updated = [...deduped, safeChallenge].slice(-20);
            await kv.set(key, updated, { ex: CHALLENGE_TTL });
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

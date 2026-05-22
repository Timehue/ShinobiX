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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
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

        // Read-modify-write — the previous retry loop was dead code (broke on
        // iter 0). Concurrent challenges to the same target can race; we
        // dedupe by id so retries don't duplicate, but a true CAS would need
        // RPC-level support.
        const key = challengeKey(targetName);
        const existing = await kv.get<unknown[]>(key) ?? [];
        const cid = challengeId(challenge);
        const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
        const updated = [...deduped, challenge].slice(-20);
        await kv.set(key, updated, { ex: CHALLENGE_TTL });

        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
const CHALLENGE_TTL = 120; // seconds — long enough for two heartbeat cycles
function challengeKey(name) {
    return `challenges:${name.toLowerCase().trim()}`;
}
function outgoingKey(name) {
    return `challenge-outgoing:${name.toLowerCase().trim()}`;
}
function challengeId(challenge) {
    return challenge && typeof challenge === 'object' && 'id' in challenge
        ? String(challenge.id ?? '')
        : '';
}
function challengeFromName(challenge) {
    return challenge && typeof challenge === 'object' && 'fromName' in challenge
        ? String(challenge.fromName ?? '').trim()
        : '';
}
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (req.method === 'DELETE') {
            const { targetName, challengeId: id, fromName } = body;
            if (!targetName && !fromName)
                return res.status(400).json({ error: 'Missing targetName or fromName.' });
            const pendingKey = targetName ? challengeKey(targetName) : '';
            const existing = pendingKey ? await kv.get(pendingKey) ?? [] : [];
            const updated = id ? existing.filter(challenge => challengeId(challenge) !== id) : existing;
            await Promise.all([
                pendingKey ? (updated.length ? kv.set(pendingKey, updated, { ex: CHALLENGE_TTL }) : kv.del(pendingKey)) : Promise.resolve(),
                fromName ? kv.del(outgoingKey(fromName)) : Promise.resolve(),
            ]);
            return res.status(200).json({ ok: true });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        const { targetName, challenge } = body;
        if (!targetName || !challenge)
            return res.status(400).json({ error: 'Missing targetName or challenge.' });
        const record = challenge;
        const fromName = challengeFromName(challenge);
        // For new challenges (not accept/decline/battle routing), gate on travel + battle state.
        if (!record.accepted && !record.declined && !record.battleId) {
            const targetPresence = await kv.get(`presence:${targetName}`);
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
        }
        else if (fromName && !record.battleId) {
            const senderKey = outgoingKey(fromName);
            const existingOutgoing = await kv.get(senderKey);
            if (existingOutgoing) {
                return res.status(409).json({ error: 'You already have a pending challenge.' });
            }
            await kv.set(senderKey, { targetName, challengeId: challengeId(challenge), createdAt: Date.now() }, { ex: CHALLENGE_TTL });
        }
        // Retry loop reduces the chance of a concurrent challenger overwriting this
        // append. Without KV-level CAS this is best-effort, but covers the common case.
        const key = challengeKey(targetName);
        for (let attempt = 0; attempt < 3; attempt++) {
            const existing = await kv.get(key) ?? [];
            // Deduplicate by id so a retry never inserts the same challenge twice
            const cid = challengeId(challenge);
            const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
            const updated = [...deduped, challenge].slice(-20);
            await kv.set(key, updated, { ex: CHALLENGE_TTL });
            break;
        }
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

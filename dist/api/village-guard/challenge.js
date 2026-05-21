import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
const CHALLENGE_TTL = 120; // seconds — survives two heartbeat cycles
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { attackerCharacter, village, battleId, guardName } = body;
        if (!village)
            return res.status(400).json({ error: 'Missing village.' });
        // Find all active guards for this village
        const keys = await kv.keys('guard:*');
        const guards = (await kv.mget(...keys))
            .filter((g) => !!g && g.village === village);
        if (guards.length === 0) {
            return res.status(200).json({ noGuard: true });
        }
        // Use the requested guard when the client already picked one for a shared PvP session.
        const requestedGuard = guardName ? guards.find(g => g.name.toLowerCase().trim() === guardName.toLowerCase().trim()) : undefined;
        const guard = requestedGuard ?? guards[Math.floor(Math.random() * guards.length)];
        // Fetch guard's full character from their persistent save
        const guardSave = await kv.get(`save:${guard.name.toLowerCase()}`);
        const guardCharacter = guardSave?.character ?? null;
        if (!guardCharacter) {
            // Guard's save is missing — fall back to AI
            return res.status(200).json({ pvp: false, guardName: guard.name, guardLevel: guard.level, defenseBonusPercent: guard.defenseBonusPercent ?? 0 });
        }
        // Send a sectorAttack-style DuelChallenge to the guard.
        // Their heartbeat will pick it up in pendingChallenges and the auto-routing
        // effect will immediately route them to the arena as the defender.
        if (attackerCharacter && battleId) {
            const challenge = {
                id: `guard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fromName: attackerCharacter.name ?? 'Raider',
                toName: guard.name,
                challenger: attackerCharacter,
                createdAt: Date.now(),
                mode: 'standard',
                sectorAttack: true,
                ...(battleId ? { battleId } : {}),
            };
            const challengeKey = `challenges:${guard.name.toLowerCase().trim()}`;
            const existing = await kv.get(challengeKey) ?? [];
            await kv.set(challengeKey, [...existing, challenge].slice(-20), { ex: CHALLENGE_TTL });
        }
        return res.status(200).json({ pvp: true, guardCharacter, guardName: guard.name });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

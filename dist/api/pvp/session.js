import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
const SESSION_TTL = 600;
// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;
function makeFighter(char, pos) {
    const maxHp = Number(char.maxHp ?? 100);
    const maxChakra = Number(char.maxChakra ?? 50);
    const maxStamina = Number(char.maxStamina ?? 50);
    return {
        name: char.name ?? 'Unknown',
        hp: Math.min(Number(char.hp ?? maxHp), maxHp),
        maxHp,
        chakra: Math.min(Number(char.chakra ?? maxChakra), maxChakra),
        maxChakra,
        stamina: Math.min(Number(char.stamina ?? maxStamina), maxStamina),
        maxStamina,
        shield: 0,
        statuses: [],
        character: char,
        pos,
    };
}
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        const battleId = String(req.query.id ?? '');
        if (!battleId)
            return res.status(400).json({ error: 'Missing id' });
        const session = await kv.get(`pvp:${battleId}`);
        if (!session)
            return res.status(404).json({ error: 'Session not found' });
        return res.status(200).json(session);
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character } = body;
            if (!p1Character || !p2Character)
                return res.status(400).json({ error: 'Missing characters' });
            const p1Name = p1Character.name ?? 'Player 1';
            const p2Name = p2Character.name ?? 'Player 2';
            const battleId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const session = {
                battleId,
                p1: makeFighter(p1Character, P1_START),
                p2: makeFighter(p2Character, P2_START),
                round: 1,
                activePlayer: 'p1',
                ap: { p1: 100, p2: 100 },
                actionsThisTurn: 0,
                cooldowns: { p1: {}, p2: {} },
                log: [`⚔️ ${p1Name} vs ${p2Name} — Battle begins! ${p1Name} goes first.`],
                status: 'active',
                winner: null,
                createdAt: Date.now(),
            };
            await kv.set(`pvp:${battleId}`, session, { ex: SESSION_TTL });
            return res.status(200).json({ battleId });
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}

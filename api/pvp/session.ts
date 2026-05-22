import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

export type PvpStatus = {
    name: string;
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    kind: 'positive' | 'negative';
};

export type PvpFighter = {
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: PvpStatus[];
    character: Record<string, unknown>;
    pos: number; // hex grid position (0–119 for 12×10 grid)
};

export type PvpGroundEffect = {
    id: string;
    owner: 'p1' | 'p2';
    name: string;
    tiles: number[];
    rounds: number;
    tags: Array<{ name: string; percent?: number; amount?: number }>;
};

export type PvpSession = {
    battleId: string;
    p1: PvpFighter;
    p2: PvpFighter;
    round: number;
    activePlayer: 'p1' | 'p2'; // whose turn it is
    ap: { p1: number; p2: number };
    actionsThisTurn: number;
    cooldowns: { p1: Record<string, number>; p2: Record<string, number> };
    groundEffects?: PvpGroundEffect[];
    log: string[];
    status: 'active' | 'done';
    winner: 'p1' | 'p2' | 'draw' | null;
    fleedBy?: 'p1' | 'p2';
    createdAt: number;
};

const SESSION_TTL = 60 * 60;

// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;

function makeFighter(char: Record<string, unknown>, pos: number): PvpFighter {
    const maxHp = Number((char.maxHp as number) ?? 100);
    const maxChakra = Number((char.maxChakra as number) ?? 50);
    const maxStamina = Number((char.maxStamina as number) ?? 50);
    return {
        name: (char.name as string) ?? 'Unknown',
        hp: Math.min(Number((char.hp as number) ?? maxHp), maxHp),
        maxHp,
        chakra: Math.min(Number((char.chakra as number) ?? maxChakra), maxChakra),
        maxChakra,
        stamina: Math.min(Number((char.stamina as number) ?? maxStamina), maxStamina),
        maxStamina,
        shield: 0,
        statuses: [],
        character: char,
        pos,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const battleId = String(req.query.id ?? '');
        if (!battleId) return res.status(400).json({ error: 'Missing id' });
        const session = await kv.get<PvpSession>(`pvp:${battleId}`);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        return res.status(200).json(session);
    }

    if (req.method === 'POST') {
        // Require a logged-in player. The creator must be one of the two
        // fighters (or admin) — otherwise anyone could fabricate a PvP session
        // with arbitrary stats (e.g. 999999 HP god mode).
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character } = body as {
                p1Character?: Record<string, unknown>;
                p2Character?: Record<string, unknown>;
            };
            if (!p1Character || !p2Character) return res.status(400).json({ error: 'Missing characters' });

            const p1Name = (p1Character.name as string) ?? 'Player 1';
            const p2Name = (p2Character.name as string) ?? 'Player 2';

            if (!identity.admin) {
                const me = identity.name;
                const p1 = String(p1Name).trim().toLowerCase();
                const p2 = String(p2Name).trim().toLowerCase();
                if (me !== p1 && me !== p2) {
                    return res.status(403).json({ error: 'Can only create sessions you are a fighter in.' });
                }
            }
            const battleId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            const session: PvpSession = {
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
        } catch (err) {
            console.error('[pvp/session]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}

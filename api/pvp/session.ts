import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

export type PvpStatus = {
    name: string;
    rounds: number;
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
    shield: number;
    statuses: PvpStatus[];
    character: Record<string, unknown>;
};

export type PvpSession = {
    battleId: string;
    p1: PvpFighter;
    p2: PvpFighter;
    round: number;
    p1Move: string | null;
    p2Move: string | null;
    log: string[];
    status: 'active' | 'done';
    winner: 'p1' | 'p2' | 'draw' | null;
    createdAt: number;
};

const SESSION_TTL = 600;

function makeFighter(char: Record<string, unknown>): PvpFighter {
    const maxHp = Number((char.maxHp as number) ?? 100);
    const maxChakra = Number((char.maxChakra as number) ?? 50);
    return {
        name: (char.name as string) ?? 'Unknown',
        hp: Math.min(Number((char.hp as number) ?? maxHp), maxHp),
        maxHp,
        chakra: Math.min(Number((char.chakra as number) ?? maxChakra), maxChakra),
        maxChakra,
        shield: 0,
        statuses: [],
        character: char,
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
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character } = body as {
                p1Character?: Record<string, unknown>;
                p2Character?: Record<string, unknown>;
            };
            if (!p1Character || !p2Character) return res.status(400).json({ error: 'Missing characters' });

            const p1Name = (p1Character.name as string) ?? 'Player 1';
            const p2Name = (p2Character.name as string) ?? 'Player 2';
            const battleId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            const session: PvpSession = {
                battleId,
                p1: makeFighter(p1Character),
                p2: makeFighter(p2Character),
                round: 1,
                p1Move: null,
                p2Move: null,
                log: [`⚔️ ${p1Name} vs ${p2Name} — Battle begins! Both players choose simultaneously.`],
                status: 'active',
                winner: null,
                createdAt: Date.now(),
            };

            await kv.set(`pvp:${battleId}`, session, { ex: SESSION_TTL });
            return res.status(200).json({ battleId });
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}

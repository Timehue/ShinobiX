import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

type GuardEntry = { name: string; village: string; level: number; lastSeen: number; defenseBonusPercent?: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { attackerCharacter, village } = body as { attackerCharacter?: unknown; village?: string };
        if (!village) return res.status(400).json({ error: 'Missing village.' });

        // Find all active guards for this village
        const keys = await kv.keys('guard:*');
        const guards = (await Promise.all(keys.map(k => kv.get<GuardEntry>(k))))
            .filter((g): g is GuardEntry => !!g && g.village === village);

        if (guards.length === 0) {
            return res.status(200).json({ noGuard: true });
        }

        // Pick a random guard
        const guard = guards[Math.floor(Math.random() * guards.length)];

        // Fetch guard's full character from their persistent save
        const guardSave = await kv.get<Record<string, unknown>>(`save:${guard.name.toLowerCase()}`);
        const guardCharacter = (guardSave?.character as Record<string, unknown>) ?? null;

        // Check if guard is online (presence key still alive)
        const presenceKey = `presence:${guard.name}`;
        const presence = await kv.get<Record<string, unknown>>(presenceKey);

        if (presence && attackerCharacter && guardCharacter) {
            // Guard is online — pull them into a defense battle on their next heartbeat
            await kv.set(presenceKey, { ...presence, pendingAttacker: attackerCharacter }, { ex: 30 });
            return res.status(200).json({ pvp: true, guardCharacter, guardName: guard.name });
        }

        // Guard is offline — caller falls back to AI using guard's level/bonus
        return res.status(200).json({
            pvp: false,
            guardName: guard.name,
            guardLevel: guard.level,
            defenseBonusPercent: guard.defenseBonusPercent ?? 0,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

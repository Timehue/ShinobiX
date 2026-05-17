import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';
import type { PvpFighter, PvpSession } from './session.js';

type JutsuTag = { tag: string; percent?: number; value?: number; rounds?: number };
type Jutsu = { id: string; name: string; type: string; effectPower?: number; tags?: JutsuTag[] };

const MAX_STAT = 500;
const MAX_ROUNDS = 25;

function getOffense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}

function getDefense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}

function findJutsu(character: Record<string, unknown>, jutsuId: string): Jutsu | null {
    if (!jutsuId || jutsuId === 'skip') return null;
    const list = (character.jutsu as Jutsu[] | undefined) ?? [];
    return list.find(j => j.id === jutsuId) ?? null;
}

function applyJutsu(
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: Jutsu,
): { self: PvpFighter; opponent: PvpFighter; desc: string } {
    const offStats = (self.character.stats as Record<string, number>) ?? {};
    const defStats = (opponent.character.stats as Record<string, number>) ?? {};
    const offense = getOffense(offStats, jutsu.type);
    const defense = getDefense(defStats, jutsu.type);
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + (offense - defense) / (MAX_STAT * 2) * 0.85));
    const ep = Math.max(1, jutsu.effectPower ?? 20);
    const baseDmg = Math.max(1, Math.floor(opponent.maxHp * (ep / 100) * statFactor));

    const tags = jutsu.tags ?? [];
    // Default to damage if no Heal/Shield tag
    const hasDmg = tags.some(t => t.tag === 'Damage') || !tags.some(t => ['Heal', 'Shield'].includes(t.tag));
    const hasHeal = tags.some(t => t.tag === 'Heal');
    const hasShield = tags.some(t => t.tag === 'Shield');
    const hasStun = tags.some(t => t.tag === 'Stun');
    const hasWound = tags.some(t => t.tag === 'Wound');

    const descs: string[] = [];
    let s = { ...self };
    let o = { ...opponent };

    if (hasDmg) {
        const absorbed = Math.min(o.shield, baseDmg);
        const net = baseDmg - absorbed;
        o = { ...o, hp: Math.max(0, o.hp - net), shield: Math.max(0, o.shield - baseDmg) };
        descs.push(`${net} dmg${absorbed > 0 ? ` (${absorbed} absorbed by shield)` : ''}`);
    }
    if (hasHeal) {
        const heal = Math.floor(s.maxHp * (ep / 100));
        const effective = s.wound ? Math.floor(heal * 0.5) : heal;
        s = { ...s, hp: Math.min(s.maxHp, s.hp + effective) };
        descs.push(`+${effective} HP healed`);
    }
    if (hasShield) {
        const amt = Math.floor(s.maxHp * (ep / 100));
        s = { ...s, shield: s.shield + amt };
        descs.push(`+${amt} shield`);
    }
    if (hasStun) {
        const rounds = tags.find(t => t.tag === 'Stun')?.rounds ?? 1;
        o = { ...o, stunRounds: Math.max(o.stunRounds, rounds) };
        descs.push(`stunned ${rounds} round(s)`);
    }
    if (hasWound) {
        o = { ...o, wound: true };
        descs.push('wounded (healing halved)');
    }

    return { self: s, opponent: o, desc: descs.join(', ') };
}

function resolveRound(session: PvpSession): PvpSession {
    const j1 = findJutsu(session.p1.character, session.p1Move ?? 'skip');
    const j2 = findJutsu(session.p2.character, session.p2Move ?? 'skip');
    let p1 = { ...session.p1 };
    let p2 = { ...session.p2 };
    const lines: string[] = [`— Round ${session.round} —`];

    // Both moves resolve simultaneously
    if (p1.stunRounds > 0) {
        lines.push(`${p1.name} is stunned and cannot act.`);
        p1 = { ...p1, stunRounds: p1.stunRounds - 1 };
    } else if (j1) {
        const r = applyJutsu(p1, p2, j1);
        p1 = r.self; p2 = r.opponent;
        lines.push(`${p1.name} uses ${j1.name} → ${r.desc}.`);
    } else {
        lines.push(`${p1.name} skips their turn.`);
    }

    if (p2.stunRounds > 0) {
        lines.push(`${p2.name} is stunned and cannot act.`);
        p2 = { ...p2, stunRounds: p2.stunRounds - 1 };
    } else if (j2) {
        const r = applyJutsu(p2, p1, j2);
        p2 = r.self; p1 = r.opponent;
        lines.push(`${p2.name} uses ${j2.name} → ${r.desc}.`);
    } else {
        lines.push(`${p2.name} skips their turn.`);
    }

    // Determine winner
    let status: 'active' | 'done' = 'active';
    let winner: 'p1' | 'p2' | 'draw' | null = null;

    if (p1.hp <= 0 && p2.hp <= 0) {
        status = 'done'; winner = 'draw';
        lines.push('Both fighters fall! Draw!');
    } else if (p1.hp <= 0) {
        status = 'done'; winner = 'p2';
        lines.push(`⚔️ ${p2.name} wins!`);
    } else if (p2.hp <= 0) {
        status = 'done'; winner = 'p1';
        lines.push(`⚔️ ${p1.name} wins!`);
    } else if (session.round >= MAX_ROUNDS) {
        status = 'done';
        if (p1.hp > p2.hp) { winner = 'p1'; lines.push(`Time limit! ${p1.name} wins by HP!`); }
        else if (p2.hp > p1.hp) { winner = 'p2'; lines.push(`Time limit! ${p2.name} wins by HP!`); }
        else { winner = 'draw'; lines.push('Time limit! Draw!'); }
    }

    return {
        ...session,
        p1,
        p2,
        round: status === 'active' ? session.round + 1 : session.round,
        p1Move: null,
        p2Move: null,
        log: [...session.log, ...lines],
        status,
        winner,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { battleId, role, jutsuId } = body as {
            battleId?: string;
            role?: 'p1' | 'p2';
            jutsuId?: string;
        };
        if (!battleId || !role || jutsuId === undefined) {
            return res.status(400).json({ error: 'Missing battleId, role, or jutsuId' });
        }

        const key = `pvp:${battleId}`;
        const session = await kv.get<PvpSession>(key);
        if (!session) return res.status(404).json({ error: 'Battle session not found' });
        if (session.status === 'done') return res.status(200).json(session);

        // Idempotent — if this role already submitted, return current state
        if (role === 'p1' && session.p1Move !== null) return res.status(200).json(session);
        if (role === 'p2' && session.p2Move !== null) return res.status(200).json(session);

        const updated: PvpSession = { ...session, [role === 'p1' ? 'p1Move' : 'p2Move']: jutsuId };

        // Resolve round once both moves are in
        const resolved = (updated.p1Move !== null && updated.p2Move !== null)
            ? resolveRound(updated)
            : updated;

        await kv.set(key, resolved, { ex: 600 });
        return res.status(200).json(resolved);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

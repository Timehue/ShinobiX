import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';
import type { PvpFighter, PvpSession, PvpStatus } from './session.js';

// ─── Formula constants (matches arena) ───────────────────────────────────────
const MAX_STAT = 2500;
const MAX_ROUNDS = 25;
// Halved vs arena so that TTK ≈ 10 rounds with 20 EP jutsu at equal stats
const PVP_SCALE = 0.5;

// Flat amounts that match arena constants
const HEAL_FLAT = 500;
const SHIELD_FLAT = 500;
const DRAIN_AMOUNT = 250;

type JutsuTag = { name: string; percent?: number; amount?: number };
type Jutsu = {
    id: string;
    name: string;
    type: string;
    effectPower?: number;
    ap?: number;
    tags?: JutsuTag[];
};

// ─── Stat helpers ─────────────────────────────────────────────────────────────

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

// ─── Bucket 2: Damage tag bonus multiplier (matches arena getTagMultiplier) ──

function getTagMultiplier(tags: JutsuTag[]): number {
    const dmgTags = (tags ?? [])
        .filter(t => t.name === 'Damage' && (t.percent ?? 0) > 0)
        .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    return dmgTags.reduce((mult, tag, i) => mult * (1 + ((tag.percent ?? 0) / 100) * Math.pow(0.7, i)), 1);
}

// ─── cappedPostDamage (matches arena) ─────────────────────────────────────────

function cappedPostDamage(damage: number, percent: number): number {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findJutsu(character: Record<string, unknown>, jutsuId: string): Jutsu | null {
    if (!jutsuId || jutsuId === 'skip') return null;
    const list = (character.jutsu as Jutsu[] | undefined) ?? [];
    return list.find(j => j.id === jutsuId) ?? null;
}

function hasStatus(fighter: PvpFighter, name: string): boolean {
    return fighter.statuses.some(s => s.name === name);
}

function addStatus(fighter: PvpFighter, status: PvpStatus): PvpFighter {
    return { ...fighter, statuses: [...fighter.statuses, status] };
}

function tickStatuses(fighter: PvpFighter): PvpFighter {
    return { ...fighter, statuses: fighter.statuses.map(s => ({ ...s, rounds: s.rounds - 1 })).filter(s => s.rounds > 0) };
}

// ─── Status multipliers for damage ────────────────────────────────────────────

function damageMultiplierFor(attacker: PvpFighter, defender: PvpFighter): number {
    let mult = 1;
    // Attacker's damage boosts
    for (const s of attacker.statuses) {
        if (s.name === 'Increase Damage Given') mult *= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Decrease Damage Given') mult /= (1 + (s.percent ?? 0) / 100);
    }
    // Defender's vulnerability
    for (const s of defender.statuses) {
        if (s.name === 'Increase Damage Taken') mult *= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Decrease Damage Taken') mult /= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Afterburn') mult *= (1 + (s.percent ?? 0) / 100);
    }
    return mult;
}

// ─── Apply one jutsu — returns updated self + opponent + log lines ────────────

function applyJutsu(
    self: PvpFighter,
    opponent: PvpFighter,
    jutsu: Jutsu,
): { self: PvpFighter; opponent: PvpFighter; lines: string[] } {
    const offStats = (self.character.stats as Record<string, number>) ?? {};
    const defStats = (opponent.character.stats as Record<string, number>) ?? {};
    const offense = getOffense(offStats, jutsu.type);
    const defense = getDefense(defStats, jutsu.type);

    // Bucket 1: base damage
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + (offense - defense) / (MAX_STAT * 2) * 0.85));
    const effectFactor = Math.max(0, jutsu.effectPower ?? 20) / 100;
    const bucketOne = opponent.maxHp * effectFactor * statFactor * PVP_SCALE;

    // Bucket 2: Damage tag bonus
    const bucketTwo = getTagMultiplier(jutsu.tags ?? []);

    // Bucket 3: bloodline (1.0 — not tracked here)
    const bucketThree = 1.0;

    const baseDmg = Math.max(0, Math.floor(bucketOne * bucketTwo * bucketThree));

    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
    let s = { ...self };
    let o = { ...opponent };
    let damage = baseDmg;
    let healing = 0;
    let shieldGain = 0;
    let pierce = false;

    // ── Pre-damage tag resolution (buffs/debuffs first) ──────────────────────

    for (const tag of tags) {
        const pct = tag.percent ?? 0;

        if (tag.name === 'Heal') {
            healing += HEAL_FLAT;
            damage = 0;
            lines.push(`Heal: ${s.name} restores ${HEAL_FLAT} HP.`);
            continue;
        }

        if (tag.name === 'Shield') {
            shieldGain += SHIELD_FLAT;
            damage = 0;
            lines.push(`Shield: ${s.name} gains ${SHIELD_FLAT} shield.`);
            continue;
        }

        if (tag.name === 'Pierce') {
            pierce = true;
            lines.push(`Pierce: ${jutsu.name} bypasses all defenses.`);
            continue;
        }

        if (tag.name === 'Stun') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: 'Stun', rounds: 1, kind: 'negative' });
                lines.push(`Stun: ${o.name} is stunned and must skip their next turn.`);
            }
            continue;
        }

        if (tag.name === 'Poison') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                const poisonDmg = Math.floor(o.maxChakra * 0.06);
                o = addStatus(o, { name: 'Poison', rounds: 2, percent: pct, kind: 'negative' });
                lines.push(`Poison: ${o.name} takes ~${poisonDmg} damage/round for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Drain') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: 'Drain', rounds: 2, amount: DRAIN_AMOUNT, kind: 'negative' });
                lines.push(`Drain: ${o.name} loses ${DRAIN_AMOUNT} HP, chakra, and stamina/round for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Absorb') {
            if (!hasStatus(s, 'Buff Prevent')) {
                s = addStatus(s, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' });
                lines.push(`Absorb: ${s.name} converts ${pct}% incoming damage to healing for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Reflect') {
            if (!hasStatus(s, 'Buff Prevent')) {
                s = addStatus(s, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' });
                lines.push(`Reflect: ${s.name} reflects ${pct}% damage for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Lifesteal') {
            if (!hasStatus(s, 'Buff Prevent')) {
                s = addStatus(s, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' });
                lines.push(`Lifesteal: ${s.name} will heal ${pct}% of damage dealt for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Increase Damage Given') {
            s = addStatus(s, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' });
            lines.push(`+${pct}% Damage Given: ${s.name} deals more damage for 2 rounds.`);
            continue;
        }

        if (tag.name === 'Decrease Damage Given') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' });
                lines.push(`-${pct}% Damage Given: ${o.name} deals less damage for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Increase Damage Taken') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' });
                lines.push(`+${pct}% Damage Taken: ${o.name} takes more damage for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Decrease Damage Taken') {
            s = addStatus(s, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' });
            lines.push(`-${pct}% Damage Taken: ${s.name} takes less damage for 2 rounds.`);
            continue;
        }

        if (tag.name === 'Afterburn') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: 'Afterburn', rounds: 2, percent: pct, kind: 'negative' });
                lines.push(`Afterburn: ${o.name} takes ${pct}% extra damage for 2 rounds.`);
            }
            continue;
        }

        if (tag.name === 'Debuff Prevent') {
            s = addStatus(s, { name: 'Debuff Prevent', rounds: 2, percent: pct, kind: 'positive' });
            lines.push(`Debuff Prevent: ${s.name} cannot be debuffed for 2 rounds.`);
            continue;
        }

        if (tag.name === 'Seal' || tag.name === 'Elemental Seal') {
            if (!hasStatus(o, 'Debuff Prevent')) {
                o = addStatus(o, { name: tag.name, rounds: 2, kind: 'negative' });
                lines.push(`${tag.name}: ${o.name} is sealed.`);
            }
            continue;
        }
    }

    // ── Apply status multipliers to damage ────────────────────────────────────

    if (pierce) {
        damage = (jutsu.ap ?? 40) >= 60 ? 900 : 500;
    } else {
        const mult = damageMultiplierFor(s, o);
        damage = Math.floor(damage * mult);
    }

    // ── Shield block / deal damage ────────────────────────────────────────────

    if (damage > 0) {
        // Absorb: some damage converts to self-heal
        const absorb = s.statuses.find(st => st.name === 'Absorb');
        if (absorb && pierce === false) {
            // Absorb applies to INCOMING damage on the opponent side — but in this
            // function `s` is the attacker. Absorb will be handled when defender
            // resolves THEIR incoming damage from attacker's move.
        }

        const blocked = pierce ? 0 : Math.min(o.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);

        // Defender's Reflect
        const reflect = o.statuses.find(st => st.name === 'Reflect');
        let reflectedDmg = 0;
        if (reflect && !pierce) {
            reflectedDmg = cappedPostDamage(finalDmg, reflect.percent ?? 30);
        }

        // Defender's Absorb
        const defAbsorb = o.statuses.find(st => st.name === 'Absorb');
        let absorbHeal = 0;
        if (defAbsorb) {
            absorbHeal = cappedPostDamage(finalDmg, defAbsorb.percent ?? 30);
        }

        o = { ...o, hp: Math.max(0, o.hp - finalDmg), shield: Math.max(0, o.shield - damage) };

        if (absorbHeal > 0) {
            o = { ...o, hp: Math.min(o.maxHp, o.hp + absorbHeal) };
        }

        if (blocked > 0) lines.push(`${blocked} absorbed by shield.`);
        if (finalDmg > 0) lines.push(`${finalDmg} damage to ${o.name}.`);
        if (absorbHeal > 0) lines.push(`${o.name} absorbs ${absorbHeal} HP.`);
        if (reflectedDmg > 0) {
            s = { ...s, hp: Math.max(0, s.hp - reflectedDmg) };
            lines.push(`${s.name} takes ${reflectedDmg} reflected damage.`);
        }

        // Post-damage: Wound, Recoil, Siphon/Vamp, Lifesteal
        for (const tag of tags) {
            const pct = tag.percent ?? 0;
            if (tag.name === 'Wound' && !hasStatus(o, 'Debuff Prevent')) {
                const woundAmt = cappedPostDamage(finalDmg, pct || 30);
                o = addStatus(o, { name: 'Wound', rounds: 2, amount: woundAmt, kind: 'negative' });
                lines.push(`Wound: ${o.name} bleeds for ${woundAmt}/round for 2 rounds.`);
            }
            if (tag.name === 'Recoil') {
                const rc = cappedPostDamage(finalDmg, pct || 30);
                s = { ...s, hp: Math.max(0, s.hp - rc) };
                lines.push(`Recoil: ${s.name} takes ${rc} recoil damage.`);
            }
            if (tag.name === 'Siphon' || tag.name === 'Vamp') {
                const siphon = cappedPostDamage(finalDmg, pct || 30);
                s = { ...s, hp: Math.min(s.maxHp, s.hp + siphon) };
                lines.push(`${tag.name}: ${s.name} heals ${siphon} HP.`);
            }
        }

        // Active Lifesteal status
        const ls = s.statuses.find(st => st.name === 'Lifesteal');
        if (ls && finalDmg > 0) {
            const lsHeal = cappedPostDamage(finalDmg, ls.percent ?? 30);
            s = { ...s, hp: Math.min(s.maxHp, s.hp + lsHeal) };
            lines.push(`Lifesteal: ${s.name} heals ${lsHeal} HP.`);
        }
    }

    // ── Apply heal and shield to self ─────────────────────────────────────────

    if (healing > 0) s = { ...s, hp: Math.min(s.maxHp, s.hp + healing) };
    if (shieldGain > 0) s = { ...s, shield: s.shield + shieldGain };

    return { self: s, opponent: o, lines };
}

// ─── Apply DoTs/status-over-time at start of each actor's resolution ─────────

function applyDoTs(fighter: PvpFighter): { fighter: PvpFighter; lines: string[] } {
    const lines: string[] = [];
    let f = { ...fighter };

    for (const s of f.statuses) {
        if (s.name === 'Wound' && s.amount) {
            f = { ...f, hp: Math.max(0, f.hp - s.amount) };
            lines.push(`${f.name} bleeds for ${s.amount} (Wound).`);
        }
        if (s.name === 'Poison') {
            const dmg = Math.floor(f.maxChakra * 0.06);
            f = { ...f, hp: Math.max(0, f.hp - dmg), chakra: Math.max(0, f.chakra - dmg) };
            lines.push(`${f.name} takes ${dmg} Poison damage.`);
        }
        if (s.name === 'Drain') {
            const amt = s.amount ?? DRAIN_AMOUNT;
            f = { ...f, hp: Math.max(0, f.hp - amt), chakra: Math.max(0, f.chakra - amt) };
            lines.push(`${f.name} is drained for ${amt} HP and chakra.`);
        }
    }

    return { fighter: f, lines };
}

// ─── Round resolution ─────────────────────────────────────────────────────────

function resolveRound(session: PvpSession): PvpSession {
    const j1 = findJutsu(session.p1.character, session.p1Move ?? 'skip');
    const j2 = findJutsu(session.p2.character, session.p2Move ?? 'skip');
    let p1 = { ...session.p1 };
    let p2 = { ...session.p2 };
    const lines: string[] = [`— Round ${session.round} —`];

    // Apply DoTs to both fighters
    const d1 = applyDoTs(p1); p1 = d1.fighter; lines.push(...d1.lines);
    const d2 = applyDoTs(p2); p2 = d2.fighter; lines.push(...d2.lines);

    // Resolve both moves simultaneously
    const p1Stunned = p1.statuses.some(s => s.name === 'Stun');
    const p2Stunned = p2.statuses.some(s => s.name === 'Stun');

    let p1Result: { self: PvpFighter; opponent: PvpFighter; lines: string[] } | null = null;
    let p2Result: { self: PvpFighter; opponent: PvpFighter; lines: string[] } | null = null;

    if (p1Stunned) {
        lines.push(`${p1.name} is stunned and skips their action.`);
    } else if (j1) {
        p1Result = applyJutsu(p1, p2, j1);
        lines.push(`${p1.name} uses ${j1.name}:`);
        lines.push(...p1Result.lines);
    } else {
        lines.push(`${p1.name} skips their turn.`);
    }

    if (p2Stunned) {
        lines.push(`${p2.name} is stunned and skips their action.`);
    } else if (j2) {
        // p2 attacks the state BEFORE p1's move resolved (simultaneous)
        p2Result = applyJutsu(p2, p1, j2);
        lines.push(`${p2.name} uses ${j2.name}:`);
        lines.push(...p2Result.lines);
    } else {
        lines.push(`${p2.name} skips their turn.`);
    }

    // Merge simultaneous results: each gets their own self-changes + combined opponent damage
    if (p1Result && p2Result) {
        // P1's self updates + P2's incoming damage on P1
        p1 = {
            ...p1Result.self,
            hp: Math.max(0, Math.min(p1Result.self.maxHp, p1Result.self.hp - (p1.hp - p2Result.opponent.hp))),
            shield: p2Result.opponent.shield,
            statuses: [...new Map([...p1Result.self.statuses, ...p2Result.opponent.statuses].map(s => [s.name + s.kind, s])).values()],
        };
        // P2's self updates + P1's incoming damage on P2
        p2 = {
            ...p2Result.self,
            hp: Math.max(0, Math.min(p2Result.self.maxHp, p2Result.self.hp - (p2.hp - p1Result.opponent.hp))),
            shield: p1Result.opponent.shield,
            statuses: [...new Map([...p2Result.self.statuses, ...p1Result.opponent.statuses].map(s => [s.name + s.kind, s])).values()],
        };
    } else if (p1Result) {
        p1 = p1Result.self;
        p2 = p1Result.opponent;
    } else if (p2Result) {
        p2 = p2Result.self;
        p1 = p2Result.opponent;
    }

    // Tick statuses (remove Stun after it fires)
    p1 = tickStatuses(p1);
    p2 = tickStatuses(p2);

    // Check winner
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

// ─── Handler ──────────────────────────────────────────────────────────────────

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

        // Idempotent — if already submitted this role's move, return current state
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

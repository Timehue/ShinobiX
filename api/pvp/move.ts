import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';
import type { PvpFighter, PvpSession, PvpStatus } from './session.js';

// ─── Grid constants (match arena exactly) ─────────────────────────────────────
const GRID_W = 12;
const GRID_H = 10;
const MAX_ROUNDS = 25;
const MAX_ACTIONS = 5;

// ─── Combat formula constants ─────────────────────────────────────────────────
const MAX_STAT = 2500;
const PVP_SCALE = 0.5;
const HEAL_FLAT = 500;
const SHIELD_FLAT = 500;
const DRAIN_AMOUNT = 250;

// ─── Grid helpers (exact match to arena geometry) ─────────────────────────────
function xy(pos: number) { return { x: pos % GRID_W, y: Math.floor(pos / GRID_W) }; }
function posFromXY(x: number, y: number): number {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1;
    return y * GRID_W + x;
}
function axial(pos: number) {
    const { x, y } = xy(pos);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
function distance(a: number, b: number): number {
    const A = axial(a); const B = axial(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
function hexNeighbors(pos: number): number[] {
    const { x, y } = xy(pos);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx!, y + dy!)).filter(n => n >= 0);
}

// ─── Jutsu types ──────────────────────────────────────────────────────────────
type JutsuTag = { name: string; percent?: number; amount?: number };
type Jutsu = {
    id: string;
    name: string;
    type: string;
    target?: string;
    range?: number;
    ap?: number;
    cooldown?: number;
    effectPower?: number;
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
function getTagMultiplier(tags: JutsuTag[]): number {
    const dmg = (tags ?? []).filter(t => t.name === 'Damage' && (t.percent ?? 0) > 0).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
    return dmg.reduce((m, t, i) => m * (1 + ((t.percent ?? 0) / 100) * Math.pow(0.7, i)), 1);
}
function cappedPostDamage(damage: number, percent: number): number {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}

// ─── Fighter helpers ──────────────────────────────────────────────────────────
function hasStatus(f: PvpFighter, name: string) { return f.statuses.some(s => s.name === name); }
function addStatus(f: PvpFighter, s: PvpStatus): PvpFighter {
    return { ...f, statuses: [...f.statuses.filter(x => x.name !== s.name), s] };
}
function tickStatuses(f: PvpFighter): PvpFighter {
    return { ...f, statuses: f.statuses.map(s => ({ ...s, rounds: s.rounds - 1 })).filter(s => s.rounds > 0) };
}
function tickCooldowns(cds: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(cds)) if (v > 1) next[k] = v - 1;
    return next;
}
function damageMultiplierFor(attacker: PvpFighter, defender: PvpFighter): number {
    let m = 1;
    for (const s of attacker.statuses) {
        if (s.name === 'Increase Damage Given') m *= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Decrease Damage Given') m /= (1 + (s.percent ?? 0) / 100);
    }
    for (const s of defender.statuses) {
        if (s.name === 'Increase Damage Taken') m *= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Decrease Damage Taken') m /= (1 + (s.percent ?? 0) / 100);
        if (s.name === 'Afterburn') m *= (1 + (s.percent ?? 0) / 100);
    }
    return m;
}

// ─── Jutsu application (3-bucket formula, all tags) ───────────────────────────
function applyJutsu(self: PvpFighter, opponent: PvpFighter, jutsu: Jutsu): { self: PvpFighter; opponent: PvpFighter; lines: string[] } {
    const offStats = (self.character.stats as Record<string, number>) ?? {};
    const defStats = (opponent.character.stats as Record<string, number>) ?? {};
    const statFactor = Math.max(0.35, Math.min(1.85, 1 + (getOffense(offStats, jutsu.type) - getDefense(defStats, jutsu.type)) / (MAX_STAT * 2) * 0.85));
    const effectFactor = Math.max(0, jutsu.effectPower ?? 20) / 100;
    const baseDmg = Math.max(0, Math.floor(opponent.maxHp * effectFactor * statFactor * PVP_SCALE * getTagMultiplier(jutsu.tags ?? [])));

    const tags = jutsu.tags ?? [];
    const lines: string[] = [];
    let s = { ...self };
    let o = { ...opponent };
    let damage = baseDmg;
    let healing = 0;
    let shieldGain = 0;
    let pierce = false;

    for (const tag of tags) {
        const pct = tag.percent ?? 0;
        if (tag.name === 'Heal') { healing += HEAL_FLAT; damage = 0; lines.push(`Heal: ${s.name} restores ${HEAL_FLAT} HP.`); continue; }
        if (tag.name === 'Shield') { shieldGain += SHIELD_FLAT; damage = 0; lines.push(`Shield: ${s.name} gains ${SHIELD_FLAT} shield.`); continue; }
        if (tag.name === 'Pierce') { pierce = true; lines.push(`Pierce: bypasses defenses.`); continue; }
        if (tag.name === 'Stun') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: 'Stun', rounds: 1, kind: 'negative' }); lines.push(`Stun: ${o.name} loses their next turn.`); } continue; }
        if (tag.name === 'Poison') { if (!hasStatus(o, 'Debuff Prevent')) { const dmg = Math.floor(o.maxChakra * 0.06); o = addStatus(o, { name: 'Poison', rounds: 2, percent: pct, kind: 'negative' }); lines.push(`Poison: ${o.name} takes ~${dmg}/round for 2 turns.`); } continue; }
        if (tag.name === 'Drain') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: 'Drain', rounds: 2, amount: DRAIN_AMOUNT, kind: 'negative' }); lines.push(`Drain: ${o.name} loses ${DRAIN_AMOUNT} HP+chakra/turn for 2 turns.`); } continue; }
        if (tag.name === 'Absorb') { if (!hasStatus(s, 'Buff Prevent')) { s = addStatus(s, { name: 'Absorb', rounds: 2, percent: pct, kind: 'positive' }); lines.push(`Absorb: ${s.name} converts ${pct}% incoming damage for 2 turns.`); } continue; }
        if (tag.name === 'Reflect') { if (!hasStatus(s, 'Buff Prevent')) { s = addStatus(s, { name: 'Reflect', rounds: 2, percent: pct, kind: 'positive' }); lines.push(`Reflect: ${s.name} reflects ${pct}% damage for 2 turns.`); } continue; }
        if (tag.name === 'Lifesteal') { if (!hasStatus(s, 'Buff Prevent')) { s = addStatus(s, { name: 'Lifesteal', rounds: 2, percent: pct, kind: 'positive' }); lines.push(`Lifesteal: ${s.name} heals on hit for 2 turns.`); } continue; }
        if (tag.name === 'Increase Damage Given') { s = addStatus(s, { name: 'Increase Damage Given', rounds: 2, percent: pct, kind: 'positive' }); lines.push(`+${pct}% Damage Given: ${s.name} for 2 turns.`); continue; }
        if (tag.name === 'Decrease Damage Given') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: 'Decrease Damage Given', rounds: 2, percent: pct, kind: 'negative' }); lines.push(`-${pct}% Damage Given: ${o.name} for 2 turns.`); } continue; }
        if (tag.name === 'Increase Damage Taken') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: 'Increase Damage Taken', rounds: 2, percent: pct, kind: 'negative' }); lines.push(`+${pct}% Damage Taken: ${o.name} for 2 turns.`); } continue; }
        if (tag.name === 'Decrease Damage Taken') { s = addStatus(s, { name: 'Decrease Damage Taken', rounds: 2, percent: pct, kind: 'positive' }); lines.push(`-${pct}% Damage Taken: ${s.name} for 2 turns.`); continue; }
        if (tag.name === 'Afterburn') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: 'Afterburn', rounds: 2, percent: pct, kind: 'negative' }); lines.push(`Afterburn: ${o.name} +${pct}% damage taken for 2 turns.`); } continue; }
        if (tag.name === 'Debuff Prevent') { s = addStatus(s, { name: 'Debuff Prevent', rounds: 2, kind: 'positive' }); lines.push(`Debuff Prevent: ${s.name} for 2 turns.`); continue; }
        if (tag.name === 'Seal' || tag.name === 'Elemental Seal') { if (!hasStatus(o, 'Debuff Prevent')) { o = addStatus(o, { name: tag.name, rounds: 2, kind: 'negative' }); lines.push(`${tag.name}: ${o.name} is sealed.`); } continue; }
    }

    if (pierce) {
        damage = (jutsu.ap ?? 40) >= 60 ? 900 : 500;
    } else {
        damage = Math.floor(damage * damageMultiplierFor(s, o));
    }

    if (damage > 0) {
        const blocked = pierce ? 0 : Math.min(o.shield, damage);
        const finalDmg = Math.max(0, damage - blocked);
        const reflect = o.statuses.find(st => st.name === 'Reflect');
        const reflectedDmg = reflect && !pierce ? cappedPostDamage(finalDmg, reflect.percent ?? 30) : 0;
        const defAbsorb = o.statuses.find(st => st.name === 'Absorb');
        const absorbHeal = defAbsorb ? cappedPostDamage(finalDmg, defAbsorb.percent ?? 30) : 0;

        o = { ...o, hp: Math.max(0, o.hp - finalDmg), shield: Math.max(0, o.shield - damage) };
        if (absorbHeal > 0) o = { ...o, hp: Math.min(o.maxHp, o.hp + absorbHeal) };
        if (blocked > 0) lines.push(`${blocked} absorbed by ${o.name}'s shield.`);
        if (finalDmg > 0) lines.push(`${finalDmg} damage to ${o.name}.`);
        if (absorbHeal > 0) lines.push(`${o.name} absorbs ${absorbHeal} HP.`);
        if (reflectedDmg > 0) { s = { ...s, hp: Math.max(0, s.hp - reflectedDmg) }; lines.push(`${s.name} takes ${reflectedDmg} reflected damage.`); }

        for (const tag of tags) {
            const pct = tag.percent ?? 0;
            if (tag.name === 'Wound' && !hasStatus(o, 'Debuff Prevent')) {
                const amt = cappedPostDamage(finalDmg, pct || 30);
                o = addStatus(o, { name: 'Wound', rounds: 2, amount: amt, kind: 'negative' });
                lines.push(`Wound: ${o.name} bleeds ${amt}/turn for 2 turns.`);
            }
            if (tag.name === 'Recoil') { const rc = cappedPostDamage(finalDmg, pct || 30); s = { ...s, hp: Math.max(0, s.hp - rc) }; lines.push(`Recoil: ${s.name} takes ${rc} recoil.`); }
            if (tag.name === 'Siphon' || tag.name === 'Vamp') { const h = cappedPostDamage(finalDmg, pct || 30); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`${tag.name}: ${s.name} heals ${h} HP.`); }
        }

        const ls = s.statuses.find(st => st.name === 'Lifesteal');
        if (ls && finalDmg > 0) { const h = cappedPostDamage(finalDmg, ls.percent ?? 30); s = { ...s, hp: Math.min(s.maxHp, s.hp + h) }; lines.push(`Lifesteal: ${s.name} heals ${h} HP.`); }
    }

    if (healing > 0) s = { ...s, hp: Math.min(s.maxHp, s.hp + healing) };
    if (shieldGain > 0) s = { ...s, shield: s.shield + shieldGain };
    return { self: s, opponent: o, lines };
}

// ─── DoTs applied at start of each turn ───────────────────────────────────────
function applyDoTs(fighter: PvpFighter): { fighter: PvpFighter; lines: string[] } {
    const lines: string[] = [];
    let f = { ...fighter };
    for (const s of f.statuses) {
        if (s.name === 'Wound' && s.amount) { f = { ...f, hp: Math.max(0, f.hp - s.amount) }; lines.push(`${f.name} bleeds ${s.amount} (Wound).`); }
        if (s.name === 'Poison') { const dmg = Math.floor(f.maxChakra * 0.06); f = { ...f, hp: Math.max(0, f.hp - dmg), chakra: Math.max(0, f.chakra - dmg) }; lines.push(`${f.name} takes ${dmg} Poison damage.`); }
        if (s.name === 'Drain') { const amt = s.amount ?? DRAIN_AMOUNT; f = { ...f, hp: Math.max(0, f.hp - amt), chakra: Math.max(0, f.chakra - amt) }; lines.push(`${f.name} drained ${amt} HP+chakra.`); }
    }
    return { fighter: f, lines };
}

// ─── Win check ────────────────────────────────────────────────────────────────
function checkWinner(s: PvpSession): PvpSession {
    if (s.status === 'done') return s;
    const { p1, p2 } = s;
    const lines: string[] = [];
    let status: 'active' | 'done' = 'active';
    let winner: 'p1' | 'p2' | 'draw' | null = null;
    if (p1.hp <= 0 && p2.hp <= 0) { status = 'done'; winner = 'draw'; lines.push('Both fighters fall! Draw!'); }
    else if (p1.hp <= 0) { status = 'done'; winner = 'p2'; lines.push(`⚔️ ${p2.name} wins!`); }
    else if (p2.hp <= 0) { status = 'done'; winner = 'p1'; lines.push(`⚔️ ${p1.name} wins!`); }
    else if (s.round > MAX_ROUNDS) {
        status = 'done';
        if (p1.hp > p2.hp) { winner = 'p1'; lines.push(`Time limit! ${p1.name} wins by HP!`); }
        else if (p2.hp > p1.hp) { winner = 'p2'; lines.push(`Time limit! ${p2.name} wins by HP!`); }
        else { winner = 'draw'; lines.push('Time limit! Draw!'); }
    }
    return { ...s, status, winner, log: lines.length ? [...s.log, ...lines] : s.log };
}

// ─── End active player's turn, hand off to the other ──────────────────────────
function endTurn(session: PvpSession, depth = 0): PvpSession {
    const current = session.activePlayer;
    const next: 'p1' | 'p2' = current === 'p1' ? 'p2' : 'p1';
    const newRound = current === 'p2' ? session.round + 1 : session.round;
    const lines: string[] = [];

    // Tick current player's statuses + cooldowns
    let s = { ...session };
    if (current === 'p1') {
        s = { ...s, p1: tickStatuses(s.p1), cooldowns: { ...s.cooldowns, p1: tickCooldowns(s.cooldowns.p1) } };
    } else {
        s = { ...s, p2: tickStatuses(s.p2), cooldowns: { ...s.cooldowns, p2: tickCooldowns(s.cooldowns.p2) } };
    }

    // Apply DoTs to the next player at start of their turn
    let nextFighter = next === 'p1' ? s.p1 : s.p2;
    const dots = applyDoTs(nextFighter);
    nextFighter = dots.fighter;
    lines.push(...dots.lines);
    s = next === 'p1' ? { ...s, p1: nextFighter } : { ...s, p2: nextFighter };

    s = checkWinner({ ...s, round: newRound, log: lines.length ? [...s.log, ...lines] : s.log });
    if (s.status === 'done') return s;

    // Auto-skip stunned player (max depth 2 to avoid infinite recursion)
    const isStunned = nextFighter.statuses.some(st => st.name === 'Stun');
    if (isStunned && depth < 2) {
        const unstunned = { ...nextFighter, statuses: nextFighter.statuses.filter(st => st.name !== 'Stun') };
        const skipLine = `${nextFighter.name} is stunned and loses their turn.`;
        s = next === 'p1' ? { ...s, p1: unstunned } : { ...s, p2: unstunned };
        s = { ...s, activePlayer: next, ap: { ...s.ap, [next]: 100 }, actionsThisTurn: 0, log: [...s.log, skipLine] };
        return endTurn(s, depth + 1);
    }

    return { ...s, activePlayer: next, ap: { ...s.ap, [next]: 100 }, actionsThisTurn: 0 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { battleId, role, action, tile, jutsuId, itemName, itemData } = body as {
            battleId?: string;
            role?: 'p1' | 'p2';
            action?: string;
            tile?: number;
            jutsuId?: string;
            itemName?: string;
            itemData?: {
                effectPower?: number;
                type?: string;
                weaponRange?: number;
                ap?: number;
                tags?: JutsuTag[];
                weaponEffect?: string;
                weaponEffectValue?: number;
            };
        };
        if (!battleId || !role || !action) return res.status(400).json({ error: 'Missing battleId, role, or action' });

        const key = `pvp:${battleId}`;
        const session = await kv.get<PvpSession>(key);
        if (!session) return res.status(404).json({ error: 'Battle session not found' });
        if (session.status === 'done') return res.status(200).json(session);
        if (session.activePlayer !== role) return res.status(200).json(session);

        const me = role === 'p1' ? session.p1 : session.p2;
        const opp = role === 'p1' ? session.p2 : session.p1;
        const myCooldowns = role === 'p1' ? session.cooldowns.p1 : session.cooldowns.p2;
        const myAp = role === 'p1' ? session.ap.p1 : session.ap.p2;
        const lines: string[] = [];

        function canAct(cost: number) { return myAp >= cost && session.actionsThisTurn < MAX_ACTIONS; }

        function commit(updMe: PvpFighter | null, updOpp: PvpFighter | null, apCost: number, cd?: Record<string, number>): PvpSession {
            let s = { ...session };
            if (updMe) s = role === 'p1' ? { ...s, p1: updMe } : { ...s, p2: updMe };
            if (updOpp) s = role === 'p1' ? { ...s, p2: updOpp } : { ...s, p1: updOpp };
            s = { ...s, ap: { ...s.ap, [role]: myAp - apCost }, actionsThisTurn: s.actionsThisTurn + 1 };
            if (cd) s = { ...s, cooldowns: { ...s.cooldowns, [role]: { ...myCooldowns, ...cd } } };
            if (lines.length) s = { ...s, log: [...s.log, ...lines] };
            return checkWinner(s);
        }

        let result: PvpSession;

        switch (action) {
            case 'wait': {
                lines.push(`${me.name} ends their turn.`);
                result = endTurn({ ...session, log: [...session.log, ...lines] });
                break;
            }

            case 'move': {
                if (tile === undefined || !canAct(30)) return res.status(200).json(session);
                if (!hexNeighbors(me.pos).includes(tile) || tile === opp.pos) return res.status(200).json(session);
                lines.push(`${me.name} moves.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }

            case 'dash': {
                if (tile === undefined || !canAct(30)) return res.status(200).json(session);
                if (distance(me.pos, tile) > 3 || tile === opp.pos || tile === me.pos) return res.status(200).json(session);
                lines.push(`${me.name} dashes.`);
                result = commit({ ...me, pos: tile }, null, 30);
                break;
            }

            case 'basicAttack': {
                if (!canAct(40)) return res.status(200).json(session);
                if (distance(me.pos, opp.pos) > 1) {
                    await kv.set(key, { ...session, log: [...session.log, `${me.name}: too far for basic attack — move closer.`] }, { ex: 600 });
                    return res.status(200).json({ ...session, log: [...session.log, `${me.name}: too far for basic attack.`] });
                }
                if (me.stamina < 10) {
                    await kv.set(key, { ...session, log: [...session.log, `${me.name}: not enough stamina.`] }, { ex: 600 });
                    return res.status(200).json({ ...session, log: [...session.log, `${me.name}: not enough stamina.`] });
                }
                const specialty = (me.character.specialty as string) ?? 'Ninjutsu';
                const basicJutsu: Jutsu = { id: 'basic-attack', name: 'Basic Attack', type: specialty, effectPower: 10, ap: 40, range: 1, tags: [{ name: 'Damage', percent: 10 }] };
                lines.push(`${me.name} uses Basic Attack:`);
                const atk = applyJutsu(me, opp, basicJutsu);
                lines.push(...atk.lines);
                result = commit({ ...atk.self, stamina: Math.max(0, atk.self.stamina - 10) }, atk.opponent, 40);
                break;
            }

            case 'basicHeal': {
                if (!canAct(60) || (myCooldowns.basicHeal ?? 0) > 0 || me.chakra < 10) return res.status(200).json(session);
                const healAmt = Math.max(1, Math.floor(me.maxHp * 0.1));
                lines.push(`${me.name} uses Basic Heal, restoring ${healAmt} HP.`);
                result = commit({ ...me, hp: Math.min(me.maxHp, me.hp + healAmt), chakra: Math.max(0, me.chakra - 10) }, null, 60, { basicHeal: 5 });
                break;
            }

            case 'clear': {
                if (!canAct(60) || (myCooldowns.clear ?? 0) > 0) return res.status(200).json(session);
                if (hasStatus(opp, 'Clear Prevent')) {
                    lines.push(`${opp.name}'s Clear Prevent blocks the clear.`);
                    result = commit(null, null, 60, { clear: 10 });
                } else {
                    const removed = opp.statuses.filter(s => s.kind === 'positive').map(s => s.name);
                    lines.push(`Clear: removed ${removed.length ? removed.join(', ') : 'no positive effects'} from ${opp.name}.`);
                    result = commit(null, { ...opp, statuses: opp.statuses.filter(s => s.kind !== 'positive') }, 60, { clear: 10 });
                }
                break;
            }

            case 'cleanse': {
                if (!canAct(60) || (myCooldowns.cleanse ?? 0) > 0) return res.status(200).json(session);
                if (hasStatus(me, 'Cleanse Prevent')) {
                    lines.push(`${me.name}'s Cleanse Prevent blocks the cleanse.`);
                    result = commit(null, null, 60, { cleanse: 10 });
                } else {
                    const removed = me.statuses.filter(s => s.kind === 'negative').map(s => s.name);
                    lines.push(`Cleanse: removed ${removed.length ? removed.join(', ') : 'no negative effects'} from ${me.name}.`);
                    result = commit({ ...me, statuses: me.statuses.filter(s => s.kind !== 'negative') }, null, 60, { cleanse: 10 });
                }
                break;
            }

            case 'jutsu': {
                if (!jutsuId) return res.status(400).json({ error: 'Missing jutsuId' });
                const jutsuList = (me.character.jutsu as Jutsu[] | undefined) ?? [];
                const jutsu = jutsuList.find(j => j.id === jutsuId);
                if (!jutsu) return res.status(200).json(session);
                const apCost = jutsu.ap ?? 40;
                if (!canAct(apCost) || (myCooldowns[jutsuId] ?? 0) > 0) return res.status(200).json(session);

                const selfTarget = jutsu.target === 'SELF' ||
                    (jutsu.tags ?? []).some(t => ['Heal', 'Shield', 'Absorb', 'Reflect', 'Lifesteal', 'Debuff Prevent', 'Increase Damage Given', 'Decrease Damage Taken'].includes(t.name));
                if (!selfTarget) {
                    const range = Math.max(0, Number(jutsu.range) || 0);
                    if (range > 0 && distance(me.pos, opp.pos) > range) {
                        const outOfRangeMsg = `${jutsu.name} is out of range (need ≤${range}, distance ${Math.round(distance(me.pos, opp.pos))}).`;
                        const updated = { ...session, log: [...session.log, outOfRangeMsg] };
                        await kv.set(key, updated, { ex: 600 });
                        return res.status(200).json(updated);
                    }
                }

                lines.push(`${me.name} uses ${jutsu.name}:`);
                const jr = applyJutsu(me, opp, jutsu);
                lines.push(...jr.lines);
                const cd = (jutsu.cooldown ?? 0) > 0 ? { [jutsuId]: jutsu.cooldown! } : undefined;
                result = commit(jr.self, jr.opponent, apCost, cd);
                break;
            }

            case 'weapon': {
                if (!itemData) return res.status(400).json({ error: 'Missing itemData' });
                const weapRange = itemData.weaponRange ?? 1;
                const wApCost = itemData.ap ?? 40;
                if (!canAct(wApCost)) return res.status(200).json(session);
                if (distance(me.pos, opp.pos) > weapRange) {
                    const msg = `${me.name}: ${itemName ?? 'Weapon'} is out of range (need ≤${weapRange}).`;
                    const updated = { ...session, log: [...session.log, msg] };
                    await kv.set(key, updated, { ex: 600 });
                    return res.status(200).json(updated);
                }
                const wTags: JutsuTag[] = [{ name: 'Damage', percent: 100 }, ...(itemData.tags ?? [])];
                if (itemData.weaponEffect && !wTags.find(t => t.name === itemData.weaponEffect)) {
                    wTags.push({ name: itemData.weaponEffect, percent: itemData.weaponEffectValue ?? 0 });
                }
                const weaponJutsu: Jutsu = {
                    id: 'weapon',
                    name: itemName ?? 'Weapon Attack',
                    type: itemData.type ?? 'Bukijutsu',
                    effectPower: itemData.effectPower ?? 15,
                    ap: wApCost,
                    range: weapRange,
                    tags: wTags,
                };
                lines.push(`${me.name} uses ${weaponJutsu.name}:`);
                const wr = applyJutsu(me, opp, weaponJutsu);
                lines.push(...wr.lines);
                result = commit(wr.self, wr.opponent, wApCost);
                break;
            }

            case 'item': {
                if (!itemData) return res.status(400).json({ error: 'Missing itemData' });
                const iApCost = itemData.ap ?? 35;
                if (!canAct(iApCost)) return res.status(200).json(session);
                const iTags: JutsuTag[] = itemData.tags?.length ? itemData.tags : [{ name: 'Heal' }];
                const itemJutsu: Jutsu = {
                    id: 'item',
                    name: itemName ?? 'Item',
                    type: 'Ninjutsu',
                    target: 'SELF',
                    effectPower: itemData.effectPower ?? 10,
                    ap: iApCost,
                    range: 0,
                    tags: iTags,
                };
                lines.push(`${me.name} uses ${itemJutsu.name}:`);
                const ir = applyJutsu(me, opp, itemJutsu);
                lines.push(...ir.lines);
                result = commit(ir.self, ir.opponent, iApCost);
                break;
            }

            case 'flee': {
                if (!canAct(100)) return res.status(200).json(session);
                const hpCost = Math.max(1, Math.floor(me.maxHp * 0.1));
                const escaped = Math.random() < 0.2;
                const updatedMe = { ...me, hp: Math.max(0, me.hp - hpCost) };
                if (escaped) {
                    lines.push(`${me.name} fled the battle, losing ${hpCost} HP.`);
                    result = {
                        ...session,
                        ...(role === 'p1' ? { p1: updatedMe } : { p2: updatedMe }),
                        ap: { ...session.ap, [role]: myAp - 100 },
                        actionsThisTurn: session.actionsThisTurn + 1,
                        status: 'done',
                        winner: role === 'p1' ? 'p2' : 'p1',
                        log: [...session.log, ...lines],
                    };
                } else {
                    lines.push(`${me.name} tried to flee, lost ${hpCost} HP, but failed.`);
                    result = commit(updatedMe, null, 100);
                }
                break;
            }

            default:
                return res.status(400).json({ error: `Unknown action: ${action}` });
        }

        await kv.set(key, result, { ex: 600 });
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOARD_COLS = exports.BOARD_ROWS_PER_SIDE = exports.BOARD_SQUAD_MAX = void 0;
exports.elementMult = elementMult;
exports.runPetGridBattle = runPetGridBattle;
exports.BOARD_SQUAD_MAX = 5;
exports.BOARD_ROWS_PER_SIDE = 3;
exports.BOARD_COLS = 5;
const MAX_ROUNDS = 40;
const DMG_SCALE = 1.5;
const CRIT_CHANCE = 0.12;
const CRIT_MULT = 1.5;
const FRONT_DMG_BONUS = 1.12;
const BACK_COVER_MULT = 0.82;
const ELEMENT_CYCLE = ['Fire', 'Wind', 'Lightning', 'Earth', 'Water'];
function elementMult(a, b) {
    const ia = a ? ELEMENT_CYCLE.indexOf(a) : -1;
    const ib = b ? ELEMENT_CYCLE.indexOf(b) : -1;
    if (ia < 0 || ib < 0)
        return 1;
    if ((ia + 1) % ELEMENT_CYCLE.length === ib)
        return 1.25;
    if ((ib + 1) % ELEMENT_CYCLE.length === ia)
        return 0.8;
    return 1;
}
const HEAL_KINDS = new Set(['heal']);
const SHIELD_KINDS = new Set(['shield', 'barrier', 'absorb']);
const BUFF_KINDS = new Set(['buff', 'haste']);
const CONTROL_KINDS = new Set(['stun', 'freeze', 'slow', 'movelock', 'pull', 'confuse', 'mark', 'taunt', 'debuff']);
function actionKindOf(kind) {
    if (HEAL_KINDS.has(kind))
        return 'heal';
    if (SHIELD_KINDS.has(kind))
        return 'shield';
    if (BUFF_KINDS.has(kind))
        return 'buff';
    if (CONTROL_KINDS.has(kind))
        return 'control';
    return 'damage';
}
const NO_MODS = { shieldStartFrac: 0, reflectPct: 0, chainPct: 0, lifestealPct: 0, reviveCharges: 0, reviveHpFrac: 0 };
function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function buildUnit(pet, team, slot, row, col) {
    const role = pet.role;
    const jutsus = (pet.jutsus ?? [])
        .filter((j) => j.kind !== 'move')
        .slice(0, 4)
        .map((j) => ({
        name: j.name, kind: j.kind, act: actionKindOf(j.kind),
        power: j.power || 0, cd: 1, maxCd: Math.max(2, Math.round(j.cooldown || 3)),
        lifesteal: j.kind === 'lifesteal',
    }));
    return {
        id: pet.id, name: pet.name, element: pet.element, role, team, slot, row, col,
        maxHp: Math.max(1, Math.round(pet.hp)), hp: Math.max(1, Math.round(pet.hp)),
        attack: Math.max(1, Math.round(pet.attack)), defense: Math.max(0, Math.round(pet.defense)),
        speed: Math.max(1, Math.round(pet.speed)),
        shield: 0, atkBuff: 0, stunned: false, jutsus,
    };
}
const alive = (u) => u.hp > 0;
const teamAlive = (units, team) => units.some((u) => u.team === team && alive(u));
function pickTarget(u, units) {
    const foes = units.filter((f) => f.team !== u.team && alive(f));
    if (!foes.length)
        return null;
    const minRow = Math.min(...foes.map((f) => f.row));
    const maxRow = Math.max(...foes.map((f) => f.row));
    const front = foes.filter((f) => f.row === minRow);
    const back = foes.filter((f) => f.row === maxRow);
    const byCol = (pool) => pool.length ? [...pool].sort((a, b) => Math.abs(a.col - u.col) - Math.abs(b.col - u.col) || a.slot - b.slot)[0] : null;
    const byLowHp = (pool) => pool.length ? [...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0] : null;
    if (u.role === 'assassin') {
        const backSages = back.filter((f) => f.role === 'sage');
        return byLowHp(backSages) ?? byLowHp(back) ?? byLowHp(front);
    }
    if (u.role === 'tracker') {
        const sages = foes.filter((f) => f.role === 'sage');
        return byLowHp(sages) ?? byLowHp(foes);
    }
    const frontDefenders = front.filter((f) => f.role === 'defender');
    return byCol(frontDefenders.length ? frontDefenders : front);
}
function pickChain(u, units, exclude) {
    const foes = units.filter((f) => f.team !== u.team && alive(f) && f.id !== exclude.id);
    if (!foes.length)
        return null;
    return [...foes].sort((a, b) => Math.abs(a.col - exclude.col) - Math.abs(b.col - exclude.col) || a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0];
}
function woundedAlly(units, team) {
    const allies = units.filter((u) => u.team === team && alive(u)).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    return allies[0] ?? null;
}
function defenseFactor(def) {
    return Math.max(0.35, 1 - def * 0.0012);
}
function positionalDmgMult(attacker, target) {
    let m = 1;
    if (attacker.row === 0)
        m *= FRONT_DMG_BONUS;
    const meleeAttacker = attacker.role !== 'assassin' && attacker.role !== 'tracker';
    if (meleeAttacker && target.row >= exports.BOARD_ROWS_PER_SIDE - 1)
        m *= BACK_COVER_MULT;
    return m;
}
function dealDamage(target, raw, events, t, attackerId, crit, element, kind, ctx) {
    let dmg = Math.max(1, Math.round(raw));
    if (target.shield > 0) {
        const soak = Math.min(target.shield, dmg);
        target.shield -= soak;
        dmg -= soak;
    }
    target.hp = Math.max(0, target.hp - dmg);
    events.push({ t, type: 'hit', actorId: attackerId, targetId: target.id, dmg, crit, element, kind });
    if (ctx && dmg > 0 && target.team === 'player') {
        if (ctx.mods.reflectPct > 0 && target.row === 0) {
            const attacker = ctx.units.find((f) => f.id === attackerId && f.team === 'enemy' && alive(f));
            if (attacker) {
                const refl = Math.max(1, Math.round(dmg * ctx.mods.reflectPct));
                attacker.hp = Math.max(0, attacker.hp - refl);
                events.push({ t, type: 'hit', actorId: target.id, targetId: attacker.id, dmg: refl, element: target.element });
            }
        }
        if (target.hp <= 0 && ctx.mods.reviveCharges > 0) {
            ctx.mods.reviveCharges -= 1;
            target.hp = Math.max(1, Math.round(target.maxHp * ctx.mods.reviveHpFrac));
            target.shield = 0;
            events.push({ t, type: 'heal', actorId: target.id, targetId: target.id, dmg: target.hp });
        }
    }
}
function act(u, units, rng, t, events, ctx) {
    if (!alive(u))
        return;
    if (u.stunned) {
        u.stunned = false;
        return;
    }
    const ready = u.jutsus.find((j) => j.cd <= 0);
    const crit = rng() < CRIT_CHANCE;
    const atk = u.attack + u.atkBuff;
    const isPlayer = u.team === 'player';
    const relicHeal = (raw) => { if (isPlayer && ctx.mods.lifestealPct > 0 && raw > 0)
        u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.round(raw * ctx.mods.lifestealPct))); };
    if (ready) {
        ready.cd = ready.maxCd;
        events.push({ t, type: 'ability', actorId: u.id, kind: ready.kind, element: u.element });
        if (ready.act === 'heal') {
            const ally = woundedAlly(units, u.team);
            if (ally) {
                const heal = Math.max(1, Math.round(ally.maxHp * 0.12 * (ready.power / 100 || 0.5)));
                ally.hp = Math.min(ally.maxHp, ally.hp + heal);
                events.push({ t, type: 'heal', actorId: u.id, targetId: ally.id, dmg: heal });
            }
            return;
        }
        if (ready.act === 'shield') {
            const ally = woundedAlly(units, u.team) ?? u;
            const amount = Math.max(1, Math.round(ally.maxHp * 0.15 * (ready.power / 100 || 0.5)));
            ally.shield += amount;
            events.push({ t, type: 'shield', actorId: u.id, targetId: ally.id, dmg: amount });
            return;
        }
        if (ready.act === 'buff') {
            u.atkBuff += Math.max(1, Math.round(u.attack * 0.2));
            events.push({ t, type: 'buff', actorId: u.id });
            return;
        }
        const target = pickTarget(u, units);
        if (!target)
            return;
        if (ready.act === 'control') {
            target.stunned = true;
            const raw = atk * DMG_SCALE * 0.4 * elementMult(u.element, target.element) * defenseFactor(target.defense) * positionalDmgMult(u, target);
            dealDamage(target, raw, events, t, u.id, crit, u.element, ready.kind, ctx);
            relicHeal(raw);
            return;
        }
        const raw = atk * DMG_SCALE * (ready.power / 100 || 1) * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1) * defenseFactor(target.defense) * positionalDmgMult(u, target);
        dealDamage(target, raw, events, t, u.id, crit, u.element, ready.kind, ctx);
        if (ready.lifesteal)
            u.hp = Math.min(u.maxHp, u.hp + Math.round(Math.max(1, raw) * 0.4));
        else
            relicHeal(raw);
        return;
    }
    const target = pickTarget(u, units);
    if (!target)
        return;
    events.push({ t, type: 'attack', actorId: u.id, targetId: target.id, element: u.element });
    const raw = atk * DMG_SCALE * elementMult(u.element, target.element) * (crit ? CRIT_MULT : 1) * defenseFactor(target.defense) * positionalDmgMult(u, target);
    dealDamage(target, raw, events, t, u.id, crit, u.element, undefined, ctx);
    relicHeal(raw);
    if (isPlayer && ctx.mods.chainPct > 0) {
        const second = pickChain(u, units, target);
        if (second) {
            const craw = atk * DMG_SCALE * ctx.mods.chainPct * elementMult(u.element, second.element) * defenseFactor(second.defense) * positionalDmgMult(u, second);
            dealDamage(second, craw, events, t, u.id, false, u.element, undefined, ctx);
            relicHeal(craw);
        }
    }
}
/**
 * Resolve a positional board battle between two placed squads (row 0 = front).
 * Deterministic from (placements, seed). Returns the win/loss/draw verdict (the
 * server only needs the outcome; the client keeps the full snapshot/event stream
 * for its renderer).
 */
function runPetGridBattle(player, enemy, seed, opts) {
    const rng = lcg(seed);
    const mods = { ...NO_MODS, ...(opts?.playerMods ?? {}) };
    const p = player.slice(0, exports.BOARD_SQUAD_MAX), e = enemy.slice(0, exports.BOARD_SQUAD_MAX);
    const units = [
        ...p.map((g, i) => buildUnit(g.pet, 'player', i, g.row, g.col)),
        ...e.map((g, i) => buildUnit(g.pet, 'enemy', i, g.row, g.col)),
    ];
    if (mods.shieldStartFrac > 0)
        for (const u of units)
            if (u.team === 'player')
                u.shield = Math.round(u.maxHp * mods.shieldStartFrac);
    const ctx = { units, mods };
    const events = [];
    let rounds = 0;
    for (let r = 1; r <= MAX_ROUNDS; r++) {
        rounds = r;
        const order = units.filter(alive).sort((a, b) => b.speed - a.speed || a.slot - b.slot || (a.team === b.team ? 0 : a.team === 'player' ? -1 : 1));
        for (const u of order) {
            act(u, units, rng, r, events, ctx);
            if (!teamAlive(units, 'player') || !teamAlive(units, 'enemy'))
                break;
        }
        for (const u of units)
            for (const j of u.jutsus)
                if (j.cd > 0)
                    j.cd -= 1;
        if (!teamAlive(units, 'player') || !teamAlive(units, 'enemy'))
            break;
    }
    const pAlive = teamAlive(units, 'player');
    const eAlive = teamAlive(units, 'enemy');
    let result;
    let winner;
    if (pAlive && !eAlive) {
        result = 'win';
        winner = 'player';
    }
    else if (eAlive && !pAlive) {
        result = 'loss';
        winner = 'enemy';
    }
    else {
        const frac = (team) => {
            const ts = units.filter((u) => u.team === team);
            const hp = ts.reduce((s, u) => s + Math.max(0, u.hp), 0);
            const max = ts.reduce((s, u) => s + u.maxHp, 0) || 1;
            return hp / max;
        };
        const pf = frac('player'), ef = frac('enemy');
        if (pf > ef + 0.02) {
            result = 'win';
            winner = 'player';
        }
        else if (ef > pf + 0.02) {
            result = 'loss';
            winner = 'enemy';
        }
        else {
            result = 'draw';
            winner = null;
        }
    }
    return { result, winner, rounds };
}

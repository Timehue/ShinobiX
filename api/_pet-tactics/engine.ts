/** Isolated competitive rules. Never reads saves, clocks, gear catalogs or client outcomes. */
import { SHOWDOWN_ELEMENT_BEATS, type ShowdownEvent, type ShowdownPetView, type ShowdownStateView } from '../../shared/pet-showdown-contract.js';
import { TACTICS_MAX_ROUNDS, type TacticsBuild, type TacticsMove, type TacticsOrder, type TacticsPetSheet, type TacticsSeat } from '../../shared/pet-tactics-contract.js';
import { TACTICS_BASIC, TACTICS_ITEMS, TACTICS_MOVES, tacticsSpecies } from '../../shared/pet-tactics-roster.js';

type Condition = { until: number; amount: number; born: number };
export type TacticsPet = TacticsPetSheet & {
    conditionsByKind: Record<string, Condition>; cooldowns: Record<string, number>;
    signatureUsed: boolean; controlImmuneUntil: number; stunned: boolean; guardChain: number;
    guardMult: number; protected: boolean; redirect: boolean; steadySpent: boolean;
};
export type TacticsBattle = {
    roomId: string; round: number; rng: number; teams: Record<TacticsSeat, TacticsPet[]>;
    result: TacticsSeat | 'draw' | null; reason: string | null; weather: { element: string; until: number } | null;
};
export class TacticsError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export const opposite = (seat: TacticsSeat): TacticsSeat => seat === 'a' ? 'b' : 'a';
const active = (team: TacticsPet[]): TacticsPet[] => team.filter(p => p.slot !== null && !p.ko);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

export function validateBuilds(value: unknown): TacticsBuild[] {
    if (!Array.isArray(value) || value.length !== 4) throw new TacticsError('Choose four distinct pets.');
    const seen = new Set<string>();
    return value.map(raw => {
        const species = tacticsSpecies(raw?.speciesId);
        if (!species || seen.has(species.id)) throw new TacticsError('Each squad needs four different roster species.');
        seen.add(species.id);
        const ids = raw?.moveIds;
        if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => typeof id !== 'string' || !species.pool.includes(id))) {
            throw new TacticsError('Equip four distinct moves from this pet’s pool.');
        }
        const moves = ids.map(id => TACTICS_MOVES[id]);
        if (!moves.some(m => m.power > 0 && m.cooldown === 0 && m.hold === 0)) throw new TacticsError('Each pet needs repeatable offense.');
        if (moves.filter(m => m.kind === 'stun').length > 1 || moves.filter(m => m.power > 0 && m.element !== 'None' && m.element !== species.element).length > 1) {
            throw new TacticsError('At most one control and one off-element attack per pet.');
        }
        const allocation = {} as TacticsBuild['allocation'];
        for (const key of ['vitality', 'power', 'guard', 'agility'] as const) {
            const n = raw?.allocation?.[key];
            if (!Number.isSafeInteger(n) || n < 0 || n > 25) throw new TacticsError('Allocation values must be whole numbers from 0 to 25.');
            allocation[key] = n;
        }
        if (Object.values(allocation).reduce((a, b) => a + b, 0) !== 49) throw new TacticsError('Allocate exactly 49 competitive points.');
        if (!TACTICS_ITEMS.some(i => i.id === raw?.item)) throw new TacticsError('Choose a competitive item.');
        return { speciesId: species.id, moveIds: [...ids], allocation, item: raw.item };
    });
}

export function sealTeam(builds: TacticsBuild[], seat: TacticsSeat): TacticsPet[] {
    return validateBuilds(builds).map((build, index): TacticsPet => {
        const species = tacticsSpecies(build.speciesId)!;
        const a = build.allocation, base = species.stats;
        const stats = {
            hp: Math.round(base.hp * (1 + a.vitality * .006)),
            attack: Math.round(base.attack * (1 + a.power * .006)), spAttack: Math.round(base.spAttack * (1 + a.power * .006)),
            defense: Math.round(base.defense * (1 + a.guard * .004)), spDefense: Math.round(base.spDefense * (1 + a.guard * .004)),
            speed: Math.round(base.speed * (1 + a.agility * .004)),
        };
        return { id: `${seat}-${index}`, speciesId: species.id, name: species.name, element: species.element, role: species.role, rarity: species.rarity,
            hp: stats.hp, maxHp: stats.hp, stamina: 100, meter: 0, slot: index < 2 ? index : null, ko: false, stats,
            allocation: { ...a }, trait: species.traitText, item: build.item, conditions: [], fieldRounds: 0, guardCost: 12, guardReduction: 50,
            moves: build.moveIds.map(id => ({ ...TACTICS_MOVES[id], available: true, ranges: [] })),
            signature: { ...species.signature, available: false, ranges: [] },
            conditionsByKind: build.item === 'ward-charm' ? { shield: { until: 2, born: 0, amount: Math.round(stats.hp * .08) } } : {},
            cooldowns: {}, signatureUsed: false, controlImmuneUntil: 0, stunned: false, guardChain: 0,
            guardMult: 1, protected: false, redirect: false, steadySpent: false,
        };
    });
}
export function createTacticsBattle(roomId: string, a: TacticsBuild[], b: TacticsBuild[], seed: number): TacticsBattle {
    return { roomId, round: 0, rng: seed | 0, teams: { a: sealTeam(a, 'a'), b: sealTeam(b, 'b') }, result: null, reason: null, weather: null };
}
export function setLeads(battle: TacticsBattle, seat: TacticsSeat, leads: number[]): void {
    if (leads.length !== 2 || new Set(leads).size !== 2 || leads.some(n => !Number.isSafeInteger(n) || n < 0 || n > 3)) throw new TacticsError('Choose two different lead pets.');
    battle.teams[seat].forEach((pet, i) => { pet.slot = leads.includes(i) ? leads.indexOf(i) : null; });
}
export function availability(pet: TacticsPet, move: TacticsMove, round: number, signature = false): string | undefined {
    if (pet.ko || pet.slot === null) return 'Not on the field';
    if (pet.stamina < move.cost) return 'Not enough stamina';
    if (pet.fieldRounds < move.hold) return `Needs ${move.hold - pet.fieldRounds} more field round${move.hold - pet.fieldRounds === 1 ? '' : 's'}`;
    if ((pet.cooldowns[move.id] ?? 0) > round) return `Ready in round ${pet.cooldowns[move.id]}`;
    if (signature && (pet.meter < 100 || round < 4)) return 'Needs full meter; earliest round four';
    return undefined;
}
export function guardCost(pet: TacticsPet): number { return Math.min(30, 12 + pet.guardChain * 6); }
export function validateOrders(battle: TacticsBattle, seat: TacticsSeat, value: unknown): TacticsOrder[] {
    if (battle.result) throw new TacticsError('The battle has ended.', 409);
    const field = active(battle.teams[seat]);
    if (!Array.isArray(value) || value.length !== field.length) throw new TacticsError('Give one order to each active pet.');
    const seen = new Set<string>(), reserves = new Set<string>();
    let signatures = 0;
    const orders: TacticsOrder[] = value.map(raw => {
        const pet = field.find(p => p.id === raw?.actorId);
        if (!pet || seen.has(pet.id)) throw new TacticsError('Orders must belong to distinct active pets on your side.');
        seen.add(pet.id);
        if (raw.kind === 'guard' || raw.kind === 'rest') {
            if (raw.kind === 'guard' && pet.stamina < guardCost(pet)) throw new TacticsError('Guard is exhausted. Rest to recover stamina.');
            return { kind: raw.kind, actorId: pet.id };
        }
        if (raw.kind === 'switch') {
            const reserve = battle.teams[seat].find(p => p.id === raw.reserveId && p.slot === null && !p.ko);
            if (!reserve || reserves.has(reserve.id)) throw new TacticsError('Choose a different living reserve for each switch.');
            reserves.add(reserve.id);
            return { kind: 'switch', actorId: pet.id, reserveId: reserve.id };
        }
        if (!['move', 'basic', 'signature'].includes(raw.kind)) throw new TacticsError('Unknown battle order.');
        const signature = raw.kind === 'signature';
        const move = signature ? pet.signature : raw.kind === 'basic' ? TACTICS_BASIC : pet.moves.find(m => m.id === raw.moveId);
        if (!move) throw new TacticsError('That move is not equipped.');
        const reason = availability(pet, move, battle.round + 1, signature);
        if (reason) throw new TacticsError(`${pet.name}: ${reason}.`);
        if (signature && ++signatures > 1) throw new TacticsError('Only one signature may be ordered per team each round.');
        const targetSlot = raw.targetSlot;
        if (!Number.isSafeInteger(targetSlot) || targetSlot < 0 || targetSlot > 1) throw new TacticsError('Choose an active target slot.');
        const targets = battle.teams[move.target === 'foe' ? opposite(seat) : seat];
        if (!targets.some(p => p.slot === targetSlot && !p.ko)) throw new TacticsError('That target slot is empty.');
        return raw.kind === 'move' ? { kind: 'move', actorId: pet.id, moveId: move.id, targetSlot } : { kind: raw.kind, actorId: pet.id, targetSlot };
    });
    return orders.sort((a, b) => a.actorId.localeCompare(b.actorId));
}
export function defaultOrders(battle: TacticsBattle, seat: TacticsSeat): TacticsOrder[] {
    return active(battle.teams[seat]).map(p => ({ actorId: p.id, kind: p.stamina >= guardCost(p) ? 'guard' : 'rest' }));
}
function random(battle: TacticsBattle): number {
    let t = (battle.rng += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    battle.rng |= 0;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function condition(pet: TacticsPet, kind: string, round: number, rounds: number, amount = 1): void {
    pet.conditionsByKind[kind] = { until: round + rounds - 1, born: round, amount };
}
const wheel = (element: string, target: string) => SHOWDOWN_ELEMENT_BEATS[element] === target ? 1.4 : SHOWDOWN_ELEMENT_BEATS[target] === element ? .75 : 1;
function signatureCap(battle: TacticsBattle, actor: TacticsPet, target: TacticsPet, move: TacticsMove): number {
    const round = battle.round + 1;
    const prepared = (actor.conditionsByKind.buff?.until ?? -1) >= round || (target.conditionsByKind.mark?.until ?? -1) >= round || battle.weather?.element === move.element && battle.weather.until >= round;
    return Math.floor(target.maxHp * (prepared ? .75 : .60));
}
export function damageEstimate(battle: TacticsBattle, actor: TacticsPet, target: TacticsPet, move: TacticsMove): number {
    if (move.power <= 0) return 0;
    const offense = actor.stats[move.cls === 'physical' ? 'attack' : 'spAttack'];
    const defense = target.stats[move.cls === 'physical' ? 'defense' : 'spDefense'];
    // Species lean is bounded; investments keep their full value rather than
    // disappearing inside that compression. Power trades damage for bulk,
    // Guard trades some bulk for stamina income, Agility buys action timing.
    const powerGrowth = 1 + actor.allocation.power * .006;
    const guardGrowth = 1 + target.allocation.guard * .004;
    const ratio = clamp((offense / powerGrowth) / (defense / guardGrowth), .6, 1.55);
    const buff = (actor.conditionsByKind.buff?.until ?? -1) >= battle.round + 1 ? 1.2 : 1;
    const marked = (target.conditionsByKind.mark?.until ?? -1) >= battle.round + 1 ? 1.3 : 1;
    const sky = battle.weather?.element === move.element && battle.weather.until >= battle.round + 1 ? 1.15 : 1;
    const stab = move.element === actor.element ? 1.1 : 1;
    const lens = actor.item === 'focus-lens' && move.element === 'None' ? 1.1 : 1;
    const damage = 160 * move.power / 100 * (.65 + .35 * ratio) * powerGrowth / guardGrowth * wheel(move.element, target.element) * stab * buff * marked * sky * lens;
    return move.id === actor.signature.id ? Math.min(damage, signatureCap(battle, actor, target, move)) : damage;
}

export function resolveTacticsRound(battle: TacticsBattle, a: TacticsOrder[], b: TacticsOrder[]): { events: ShowdownEvent[]; notes: string[] } {
    // Validate the entire simultaneous batch before touching battle state.
    const orders = { a: validateOrders(battle, 'a', a), b: validateOrders(battle, 'b', b) };
    const round = battle.round + 1, notes: string[] = [];
    const events: ShowdownEvent[] = [{ t: 'roundStart', round }];
    const gains = new Map<string, { useful: boolean; received: number }>();
    const acted = new Set<string>();
    const side = (seat: TacticsSeat): 'player' | 'enemy' => seat === 'a' ? 'player' : 'enemy';
    const all = [...battle.teams.a, ...battle.teams.b];
    for (const pet of all) {
        pet.guardMult = 1; pet.protected = false; pet.redirect = false;
        for (const [kind, value] of Object.entries(pet.conditionsByKind)) if (value.until < round) delete pet.conditionsByKind[kind];
        if (pet.slot !== null && !pet.ko) gains.set(pet.id, { useful: false, received: 0 });
    }
    if (battle.weather && battle.weather.until < round) battle.weather = null;
    const consumeStun = (pet: TacticsPet, seat: TacticsSeat): boolean => {
        if (!pet.stunned) return false;
        pet.stunned = false; delete pet.conditionsByKind.stun;
        events.push({ t: 'skip', actorId: pet.id, actorSide: side(seat), reason: 'stun' });
        acted.add(pet.id); return true;
    };
    // Switches change slot occupants before aim is resolved. Incoming pets do not act.
    for (const seat of ['a', 'b'] as const) for (const order of orders[seat]) {
        if (order.kind !== 'switch') continue;
        const pet = battle.teams[seat].find(p => p.id === order.actorId)!;
        const reserve = battle.teams[seat].find(p => p.id === order.reserveId)!;
        if (pet.stunned) { pet.stunned = false; delete pet.conditionsByKind.stun; notes.push(`${pet.name} withdraws while bound.`); }
        reserve.slot = pet.slot; pet.slot = null; pet.fieldRounds = 0; pet.guardChain = 0; reserve.fieldRounds = 0;
        gains.delete(pet.id); gains.set(reserve.id, { useful: false, received: 0 });
        acted.add(pet.id); acted.add(reserve.id);
        events.push({ t: 'switch', side: side(seat), outId: pet.id, inId: reserve.id, reinforcement: false });
    }
    const entries = (['a', 'b'] as const).flatMap(seat => orders[seat].filter(o => o.kind !== 'switch').map(order => {
        const actor = battle.teams[seat].find(p => p.id === order.actorId)!;
        const move = order.kind === 'move' ? actor.moves.find(m => m.id === order.moveId)! : order.kind === 'signature' ? actor.signature : TACTICS_BASIC;
        const phase = order.kind === 'guard' || order.kind === 'move' && ['protect', 'redirect'].includes(move.kind) ? 2 : 1;
        const speed = actor.stats.speed * (actor.conditionsByKind.slow ? .75 : 1) * (order.kind === 'rest' ? .9 : move.priority);
        return { seat, order, actor, move, phase, speed, tie: random(battle) };
    })).sort((x, y) => y.phase - x.phase || y.speed - x.speed || x.tie - y.tie);
    for (const { seat, order, actor, move } of entries) {
        if (actor.ko || actor.slot === null || acted.has(actor.id)) continue;
        if (consumeStun(actor, seat)) continue;
        acted.add(actor.id);
        const signature = order.kind === 'signature';
        const targets: Extract<ShowdownEvent, { t: 'action' }>['targets'] = [];
        let useful = false;
        if (order.kind === 'guard') {
            actor.stamina -= guardCost(actor); actor.guardMult = actor.guardChain === 0 ? .5 : actor.guardChain === 1 ? .7 : .85; actor.guardChain++;
            notes.push(`${actor.name} guards (${Math.round((1 - actor.guardMult) * 100)}% reduction).`);
        } else if (order.kind === 'rest') {
            actor.stamina = Math.min(100, actor.stamina + 30 + (tacticsSpecies(actor.speciesId)!.trait === 'scout' ? 5 : 0)); actor.guardChain = 0;
        } else {
            actor.guardChain = 0;
            actor.stamina -= move.cost;
            if (move.cooldown) actor.cooldowns[move.id] = round + move.cooldown + 1;
            if (signature) { actor.meter = 0; actor.signatureUsed = true; }
            const team = battle.teams[move.target === 'foe' ? opposite(seat) : seat];
            const aim = 'targetSlot' in order ? order.targetSlot : actor.slot;
            let victims = move.target === 'team' ? active(team) : move.target === 'self' ? [actor] : team.filter(p => p.slot === aim && !p.ko);
            if (move.target === 'foe' && victims.length) {
                const interceptor = active(team).find(p => p.redirect && p.id !== victims[0].id);
                if (interceptor) { victims = [interceptor]; notes.push(`${interceptor.name} intercepts the attack.`); }
            }
            for (const target of victims) {
                const affinity = wheel(move.element, target.element);
                let damage = move.power > 0 ? Math.round(damageEstimate(battle, actor, target, move) * (.98 + random(battle) * .04)) : 0;
                if (signature) damage = Math.min(damage, signatureCap(battle, actor, target, move));
                if (target.protected) damage = 0;
                else damage = Math.round(damage * target.guardMult * (target.redirect ? .7 : 1));
                const shield = target.conditionsByKind.shield;
                if (shield && damage) { const soak = Math.min(shield.amount, damage); shield.amount -= soak; damage -= soak; if (shield.amount <= 0) delete target.conditionsByKind.shield; }
                damage = Math.min(target.hp, damage);
                target.hp -= damage; target.ko = target.hp <= 0;
                const received = gains.get(target.id); if (received) received.received += damage / target.maxHp;
                let heal = 0, applied: string | undefined;
                if (!target.ko && (!target.protected || move.target !== 'foe')) {
                    const trait = tacticsSpecies(actor.speciesId)!.trait;
                    if (move.kind === 'heal') {
                        const pressure = round >= 18 ? Math.max(0, 1 - (round - 17) * .2) : 1;
                        heal = Math.min(target.maxHp - target.hp, Math.round(target.maxHp * (signature ? .20 : .18) * (trait === 'medic' ? 1.1 : 1) * (target.conditionsByKind.wound ? .5 : 1) * pressure));
                        target.hp += heal;
                    } else if (move.kind === 'shield') {
                        const amount = Math.round(target.maxHp * (signature ? .22 : .18) * (trait === 'sentinel' ? 1.1 : 1));
                        useful ||= amount > (target.conditionsByKind.shield?.amount ?? 0);
                        condition(target, 'shield', round, 2, Math.max(amount, target.conditionsByKind.shield?.amount ?? 0)); applied = 'shield';
                    } else if (move.kind === 'cleanse') {
                        for (const kind of ['burn', 'wound', 'mark', 'slow', 'stun']) {
                            if (target.conditionsByKind[kind]) useful = true;
                            delete target.conditionsByKind[kind];
                        }
                        target.stunned = false; applied = 'cleanse';
                    } else if (move.kind === 'stun') {
                        if (target.controlImmuneUntil < round && !target.stunned) {
                            target.stunned = true; target.controlImmuneUntil = round + 3; condition(target, 'stun', round, 2); applied = 'stun'; useful = true;
                        } else notes.push(`${target.name} is immune to control.`);
                    } else if (['burn', 'wound', 'mark', 'slow', 'buff'].includes(move.kind)) {
                        condition(target, move.kind, round, move.kind === 'mark' ? 2 : 3); applied = move.kind; useful = true;
                    } else if (move.kind === 'protect') { actor.protected = true; applied = 'protect'; }
                    else if (move.kind === 'redirect') { actor.redirect = true; applied = 'taunt'; useful = true; }
                    else if (move.kind === 'weather') { battle.weather = { element: move.element, until: round + 2 }; applied = 'weather'; useful = true; }
                }
                useful ||= damage > 0 || heal > 0;
                targets.push({ id: target.id, damage, heal, effectiveness: affinity > 1 ? 'super' : affinity < 1 ? 'weak' : 'neutral', guarded: target.guardMult < 1 || target.protected, ko: target.ko, ...(applied ? { applied } : {}) });
            }
            if (!victims.length) notes.push(`${actor.name}'s ${move.name} finds an empty slot.`);
        }
        const gain = gains.get(actor.id); if (gain) gain.useful ||= useful && !signature;
        events.push({ t: 'action', actorId: actor.id, actorSide: side(seat), moveName: order.kind === 'guard' ? 'Guard' : order.kind === 'rest' ? 'Rest' : move.name,
            moveKind: order.kind === 'guard' ? 'guard' : order.kind === 'rest' ? 'rest' : move.kind, element: move.element,
            delivery: order.kind === 'guard' || order.kind === 'rest' || move.target === 'self' ? 'self' : move.cls === 'physical' ? 'melee' : 'ranged',
            weight: signature || move.power >= 140 ? 'heavy' : move.power <= 60 ? 'light' : 'normal', super: signature,
            targetId: targets[0]?.id, targets, staminaAfter: actor.stamina, meterAfter: actor.meter, overexerted: false });
    }
    for (const seat of ['a', 'b'] as const) for (const pet of battle.teams[seat]) {
        if (pet.ko) continue;
        let bleed = pet.conditionsByKind.burn && pet.conditionsByKind.burn.born < round ? Math.round(pet.maxHp * .04) : 0;
        if (round >= 18) bleed += Math.round(pet.maxHp * Math.min(.20, (round - 17) * .02));
        if (bleed) {
            bleed = Math.min(pet.hp, bleed); pet.hp -= bleed; pet.ko = pet.hp <= 0;
            events.push({ t: 'dot', targetId: pet.id, targetSide: side(seat), kind: round >= 18 ? 'attrition' : 'burn', damage: bleed, ko: pet.ko });
        }
        if (pet.ko) continue;
        const gain = gains.get(pet.id);
        if (pet.slot !== null) {
            pet.fieldRounds++;
            let meter = (!pet.signatureUsed ? 15 : 0) + (gain?.useful ? 10 : 0) + (gain?.received ? Math.min(10, Math.round(gain.received * 50)) : 0);
            if (gain?.useful && !pet.steadySpent && tacticsSpecies(pet.speciesId)!.trait === 'steady') { meter += 5; pet.steadySpent = true; }
            pet.meter = Math.min(100, pet.meter + Math.min(35, meter));
        }
        pet.stamina = Math.min(100, pet.stamina + (pet.slot === null ? 12 + (pet.item === 'reserve-cell' ? 4 : 0) : 8) + Math.floor(pet.allocation.guard / 10));
    }
    // No reinforcement gets an attack this round. Empty aimed slots stay empty until here.
    for (const seat of ['a', 'b'] as const) {
        const team = battle.teams[seat];
        for (const fallen of team.filter(p => p.ko && p.slot !== null)) {
            const reserve = team.find(p => !p.ko && p.slot === null);
            const slot = fallen.slot; fallen.slot = null;
            if (reserve) { reserve.slot = slot; reserve.fieldRounds = 0; events.push({ t: 'switch', side: side(seat), outId: fallen.id, inId: reserve.id, reinforcement: true }); }
        }
    }
    battle.round = round;
    const aliveA = battle.teams.a.some(p => !p.ko), aliveB = battle.teams.b.some(p => !p.ko);
    if (!aliveA || !aliveB) { battle.result = aliveA ? 'a' : aliveB ? 'b' : 'draw'; battle.reason = 'knockout'; }
    else if (round >= TACTICS_MAX_ROUNDS) {
        const score = (team: TacticsPet[]) => team.reduce((sum, p) => sum + p.hp / p.maxHp, 0);
        const gap = score(battle.teams.a) - score(battle.teams.b);
        battle.result = Math.abs(gap) < .000001 ? 'draw' : gap > 0 ? 'a' : 'b'; battle.reason = 'round limit';
    }
    events.push({ t: 'roundEnd', round });
    if (battle.result) events.push({ t: 'end', outcome: battle.result === 'a' ? 'win' : 'loss' });
    return { events, notes };
}

export function petSheets(battle: TacticsBattle, seat: TacticsSeat): TacticsPetSheet[] {
    return battle.teams[seat].map(pet => {
        const option = (move: TacticsMove, signature = false) => {
            const reason = availability(pet, move, battle.round + 1, signature);
            return { ...move, available: !reason, ...(reason ? { reason } : {}), ranges: active(battle.teams[move.target === 'foe' ? opposite(seat) : seat]).map(target => {
                const base = damageEstimate(battle, pet, target, move);
                const cap = signature ? signatureCap(battle, pet, target, move) : Infinity;
                return { slot: target.slot!, min: Math.min(cap, Math.floor(base * .98)), max: Math.min(cap, Math.ceil(base * 1.02)) };
            }) };
        };
        return { id: pet.id, speciesId: pet.speciesId, name: pet.name, element: pet.element, role: pet.role, rarity: pet.rarity,
            hp: pet.hp, maxHp: pet.maxHp, stamina: pet.stamina, meter: pet.meter, slot: pet.slot, ko: pet.ko,
            stats: { ...pet.stats }, allocation: { ...pet.allocation }, trait: pet.trait, item: pet.item, fieldRounds: pet.fieldRounds,
            guardCost: guardCost(pet), guardReduction: pet.guardChain === 0 ? 50 : pet.guardChain === 1 ? 30 : 15,
            conditions: [...Object.entries(pet.conditionsByKind).filter(([, c]) => c.until >= battle.round + 1).map(([kind]) => kind), ...(pet.controlImmuneUntil >= battle.round + 1 ? ['control immune'] : [])],
            moves: [...pet.moves.map(m => option(m)), option(TACTICS_BASIC)], signature: option(pet.signature, true) };
    });
}
export function cinematicView(battle: TacticsBattle, seat: TacticsSeat, opponent: string): ShowdownStateView {
    const project = (team: TacticsPet[]): ShowdownPetView[] => [...team].sort((a, b) => (a.slot ?? 10) - (b.slot ?? 10)).map(p => ({
        id: p.id, name: p.name, element: p.element, role: p.role, rarity: p.rarity, templateId: p.speciesId,
        level: 50, hp: p.hp, maxHp: p.maxHp, stamina: p.stamina, maxStamina: 100, meter: p.meter, ko: p.ko,
        guarding: p.guardMult < 1, benched: p.slot === null, speed: p.stats.speed * ((p.conditionsByKind.slow?.until ?? -1) > battle.round ? .75 : 1),
        skipsNextAction: p.stunned, canSwitchOut: true, statuses: Object.entries(p.conditionsByKind).filter(([, c]) => c.until > battle.round).map(([kind, c]) => ({ kind, rounds: c.until - battle.round, magnitude: c.amount })),
        readiness: p.fieldRounds, trait: p.trait, gearName: TACTICS_ITEMS.find(i => i.id === p.item)?.name,
        moves: [...p.moves, TACTICS_BASIC, p.signature].map(m => ({ ...m, signature: m.id === p.signature.id })),
    }));
    return { sessionId: battle.roomId, format: '2v2', tier: 'warrior', round: battle.round, attritionAt: 18, turnCap: TACTICS_MAX_ROUNDS,
        finished: battle.result !== null, outcome: battle.result === null ? null : battle.result === seat ? 'win' : 'loss',
        player: project(battle.teams[seat]), enemy: project(battle.teams[opposite(seat)]), enemyTeamName: opponent,
        ...(battle.weather && battle.weather.until > battle.round ? { weather: { element: battle.weather.element, roundsLeft: battle.weather.until - battle.round, effect: `${battle.weather.element} attacks +15%` } } : {}) };
}
export function seatEvents(events: ShowdownEvent[], seat: TacticsSeat, result: TacticsBattle['result']): ShowdownEvent[] {
    if (seat === 'a') return structuredClone(events);
    const flip = (value: 'player' | 'enemy') => value === 'player' ? 'enemy' : 'player';
    return events.map(event => {
        const copy = structuredClone(event);
        if ('actorSide' in copy) copy.actorSide = flip(copy.actorSide);
        if ('targetSide' in copy) copy.targetSide = flip(copy.targetSide);
        if ('side' in copy) copy.side = flip(copy.side);
        if (copy.t === 'end') copy.outcome = result === 'b' ? 'win' : 'loss';
        return copy;
    });
}

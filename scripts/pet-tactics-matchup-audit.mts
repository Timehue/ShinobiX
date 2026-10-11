/** Seeded coverage audit. Fixtures are authored here; production still accepts human orders only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TACTICS_ITEMS, TACTICS_ROSTER, tacticsPreset } from '../shared/pet-tactics-roster.js';
import { createTacticsBattle, damageEstimate, petSheets, resolveTacticsRound, validateBuilds } from '../api/_pet-tactics/engine.js';
import type { TacticsAllocation, TacticsBuild, TacticsMoveOption, TacticsOrder, TacticsPetSheet } from '../shared/pet-tactics-contract.js';
import { choose } from './pet-tactics-balance-audit.mjs';

const allocations: Record<string, TacticsAllocation> = {
    balanced: { vitality: 13, power: 12, guard: 12, agility: 12 },
    pressure: { vitality: 24, power: 25, guard: 0, agility: 0 },
    bulk: { vitality: 25, power: 0, guard: 24, agility: 0 },
    tempo: { vitality: 0, power: 24, guard: 0, agility: 25 },
    endurance: { vitality: 24, power: 0, guard: 25, agility: 0 },
    swiftBulk: { vitality: 24, power: 0, guard: 0, agility: 25 },
};
let fixtureRng = 581309;
const random = () => { fixtureRng = Math.imul(fixtureRng, 1664525) + 1013904223 | 0; return (fixtureRng >>> 0) / 4294967296; };
const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
function shuffled<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
}
function team(): TacticsBuild[] {
    const species = shuffled(TACTICS_ROSTER).slice(0, 4);
    return validateBuilds(species.map(p => {
        const build = tacticsPreset(p.id, Math.floor(random() * 2));
        if (random() < .4) {
            // Retry only legal custom pools; include one guaranteed repeatable elemental attack.
            const attack = pick([`${p.element.toLowerCase()}-strike`, `${p.element.toLowerCase()}-pulse`]);
            build.moveIds = [attack, ...shuffled(p.pool.filter(id => id !== attack)).slice(0, 3)];
        }
        build.allocation = { ...pick(Object.values(allocations)) }; build.item = pick(TACTICS_ITEMS).id;
        return build;
    }));
}
const meanDamage = (move: TacticsMoveOption, slot: number) => {
    const r = move.ranges.find(r => r.slot === slot); return r ? (r.min + r.max) / 2 : 0;
};
/** Extra support policy uses public information only; forecasts do not read the rival's draft. */
function tactical(own: TacticsPetSheet[], enemy: TacticsPetSheet[], round: number): TacticsOrder[] {
    const orders = choose(own, enemy, 'adaptive', round);
    const field = own.filter(p => p.slot !== null && !p.ko), foes = enemy.filter(p => p.slot !== null && !p.ko);
    const bestDamage = (p: TacticsPetSheet, slot: number) => Math.max(0, ...[...p.moves, p.signature].filter(m => m.available).map(m => meanDamage(m, slot)));
    let signatureUsed = orders.some(o => o.kind === 'signature');
    return orders.map(order => {
        if (order.kind === 'switch' || order.kind === 'signature') return order;
        const pet = field.find(p => p.id === order.actorId)!;
        const attack = order.kind === 'move' ? pet.moves.find(m => m.id === order.moveId) : order.kind === 'basic' ? pet.moves.find(m => m.id === 'basic') : undefined;
        const attackValue = attack?.target === 'foe' && 'targetSlot' in order ? Math.min(meanDamage(attack, order.targetSlot), foes.find(p => p.slot === order.targetSlot)!.hp) - attack.cost * .7 : 0;
        let candidate: { value: number; order: TacticsOrder } = { value: attackValue, order };
        const moves = [...pet.moves, ...(!signatureUsed ? [pet.signature] : [])].filter(m => m.available && m.power === 0);
        for (const move of moves) for (const target of move.target === 'foe' ? foes : field) {
            const isSignature = move.id === pet.signature.id;
            const recipients = move.target === 'team' ? field : [target];
            let value = 0;
            if (move.kind === 'heal') value = recipients.reduce((sum, p) => sum + Math.min(p.maxHp - p.hp,
                p.maxHp * (isSignature ? .20 : .18) * (pet.trait.includes('Healing') ? 1.1 : 1) * (p.conditions.includes('wound') ? .5 : 1) * Math.max(0, 1 - Math.max(0, round - 17) * .2)), 0);
            if (move.kind === 'shield') value = recipients.reduce((sum, p) => sum + (p.conditions.includes('shield') ? 0 : Math.min(p.maxHp * (isSignature ? .22 : .18), foes.reduce((s, f) => s + bestDamage(f, p.slot!), 0) * .6)), 0);
            if (move.kind === 'buff') value = recipients.reduce((sum, p) => sum + (p.conditions.includes('buff') ? 0 : Math.max(...foes.map(f => bestDamage(p, f.slot!))) * .4), 0);
            if (move.kind === 'mark' && !target.conditions.includes('mark')) value = field.reduce((sum, p) => sum + bestDamage(p, target.slot!) * (p.id !== pet.id && p.stats.speed < pet.stats.speed * move.priority ? .48 : .18), 0);
            if (move.kind === 'stun' && !target.conditions.includes('control immune')) value = Math.max(...field.map(p => bestDamage(target, p.slot!))) * .9;
            if (move.kind === 'protect' && target.id === pet.id) {
                const threat = foes.reduce((sum, p) => sum + bestDamage(p, pet.slot!), 0) * .65;
                if (pet.hp < threat) value = threat + 80;
            }
            value -= move.cost * .7;
            if (value > candidate.value + 5) candidate = { value, order: isSignature ? { kind: 'signature', actorId: pet.id, targetSlot: target.slot! } : { kind: 'move', actorId: pet.id, moveId: move.id, targetSlot: target.slot! } };
        }
        signatureUsed ||= candidate.order.kind === 'signature'; return candidate.order;
    });
}
const usage: Record<string, number> = {}, rounds: number[] = [], reasons: Record<string, number> = {};
let games = 0, seatAWins = 0, draws = 0;
function duel(a: TacticsBuild[], b: TacticsBuild[], seed: number, aPolicy = 'tactical', bPolicy = 'tactical') {
    const battle = createTacticsBattle('coverage-audit', a, b, seed);
    const policy = (own: TacticsPetSheet[], foe: TacticsPetSheet[], name: string) => name === 'tactical' ? tactical(own, foe, battle.round + 1) : choose(own, foe, name, battle.round + 1);
    while (!battle.result) {
        const aSheets = petSheets(battle, 'a'), bSheets = petSheets(battle, 'b');
        const aOrders = policy(aSheets, bSheets, aPolicy), bOrders = policy(bSheets, aSheets, bPolicy);
        for (const o of [...aOrders, ...bOrders]) { const key = o.kind === 'move' ? o.moveId : o.kind; usage[key] = (usage[key] ?? 0) + 1; }
        resolveTacticsRound(battle, aOrders, bOrders);
        for (const pet of [...battle.teams.a, ...battle.teams.b]) {
            assert.ok(pet.hp >= 0 && pet.hp <= pet.maxHp && pet.stamina >= 0 && pet.stamina <= 100 && pet.meter >= 0 && pet.meter <= 100, 'Resource bounds');
        }
        assert.ok(battle.round <= 30, 'Termination bound');
    }
    games++; rounds.push(battle.round); seatAWins += Number(battle.result === 'a'); draws += Number(battle.result === 'draw');
    reasons[battle.reason!] = (reasons[battle.reason!] ?? 0) + 1;
    return battle.result === 'draw' ? .5 : battle.result === 'a' ? 1 : 0;
}
const speciesResults = Object.fromEntries(TACTICS_ROSTER.map(p => [p.id, { name: p.name, pairedAppearances: 0, score: 0 }]));
const fixtures: { a: TacticsBuild[]; b: TacticsBuild[]; seed: number }[] = [];
for (let i = 0; i < 1200; i++) {
    const a = team(), b = team(), seed = (random() * 2147483647) | 0; fixtures.push({ a, b, seed });
    const score = (duel(a, b, seed) + 1 - duel(b, a, seed)) / 2;
    for (const [builds, result] of [[a, score], [b, 1 - score]] as const) for (const p of builds) {
        const row = speciesResults[p.speciesId]; row.pairedAppearances++; row.score += result;
    }
}
const selfPlay = { matches: games, independentSquadPairs: fixtures.length, seatAScore: (seatAWins + draws / 2) / games,
    species: Object.values(speciesResults).map(p => ({ name: p.name, pairedAppearances: p.pairedAppearances, conditionalTeamScore: p.score / p.pairedAppearances })) };
const comparison = [];
for (const opponent of ['highest-damage', 'ultimate-spam', 'guard-spam', 'sustain-loop']) {
    let score = 0;
    for (const { a, b, seed } of fixtures.slice(0, 180)) score += (duel(a, b, seed, 'tactical', opponent) + 1 - duel(b, a, seed, opponent, 'tactical')) / 2;
    comparison.push({ opponent, pairedSquadSamples: 180, matches: 360, tacticalScore: score / 180 });
}
// Hold teammates, rival squad, allocations, items and seed fixed; replace only the lead species/kit.
const substitutions = Object.fromEntries(TACTICS_ROSTER.map(p => [p.id, { name: p.name, fixtures: 0, delta: 0 }]));
for (let left = 0; left < TACTICS_ROSTER.length; left++) for (let right = left + 1; right < TACTICS_ROSTER.length; right++) for (let sample = 0; sample < 32; sample++) {
    const x = TACTICS_ROSTER[left], y = TACTICS_ROSTER[right];
    const allies = team().filter(p => p.speciesId !== x.id && p.speciesId !== y.id);
    while (allies.length < 3) {
        const extra = team().find(p => p.speciesId !== x.id && p.speciesId !== y.id && !allies.some(q => q.speciesId === p.speciesId));
        if (extra) allies.push(extra);
    }
    const opponent = team(), seed = (random() * 2147483647) | 0;
    const profile = pick(Object.values(allocations)), item = pick(TACTICS_ITEMS).id;
    const candidate = (id: string) => [{ ...tacticsPreset(id, sample % 2), allocation: { ...profile }, item }, ...allies.slice(0, 3)];
    const score = (build: TacticsBuild[]) => (duel(build, opponent, seed) + 1 - duel(opponent, build, seed)) / 2;
    const delta = score(candidate(x.id)) - score(candidate(y.id));
    substitutions[x.id].fixtures++; substitutions[x.id].delta += delta;
    substitutions[y.id].fixtures++; substitutions[y.id].delta -= delta;
}
const substitutionResults = { matches: 66 * 32 * 4, fixturesPerSpecies: 352,
    species: Object.values(substitutions).map(p => ({ name: p.name, fixtures: p.fixtures, meanTeamScoreDelta: p.delta / p.fixtures })) };
let mirrorScore = 0;
for (const { a, seed } of fixtures.slice(0, 240)) mirrorScore += duel(a, a, seed);

let signatureProbes = 0, unpreparedKos = 0, capViolations = 0, maxUnprepared = 0, maxPrepared = 0, maxGuarded = 0;
const squad = (build: TacticsBuild) => [build, ...TACTICS_ROSTER.filter(p => p.id !== build.speciesId).slice(0, 3).map(p => tacticsPreset(p.id))];
for (const actor of TACTICS_ROSTER.filter(p => p.signature.power > 0)) for (const target of TACTICS_ROSTER) for (const offense of Object.values(allocations)) for (const defense of Object.values(allocations)) for (const setup of ['none', 'rally', 'expose', 'sky', 'stacked', 'guard', 'stacked-guard']) {
    const a = tacticsPreset(actor.id), b = tacticsPreset(target.id); a.allocation = offense; b.allocation = defense;
    const battle = createTacticsBattle('signature-extremes', squad(a), squad(b), 713);
    battle.round = 3; const source = battle.teams.a[0], victim = battle.teams.b[0]; source.meter = 100; source.fieldRounds = 3;
    if (setup === 'rally' || setup.startsWith('stacked')) source.conditionsByKind.buff = { until: 6, born: 3, amount: 1 };
    if (setup === 'expose' || setup.startsWith('stacked')) victim.conditionsByKind.mark = { until: 6, born: 3, amount: 1 };
    if (setup === 'sky' || setup.startsWith('stacked')) battle.weather = { element: actor.element, until: 6 };
    const before = damageEstimate(battle, source, victim, source.signature);
    const script = resolveTacticsRound(battle, [{ kind: 'signature', actorId: 'a-0', targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }], [{ kind: setup.includes('guard') ? 'guard' : 'rest', actorId: 'b-0' }, { kind: 'rest', actorId: 'b-1' }]);
    const action = script.events.find(e => e.t === 'action' && e.super)!; assert.ok(action.t === 'action');
    assert.equal(action.targets.length, 1); assert.equal(battle.teams.b[1].hp, battle.teams.b[1].maxHp);
    assert.equal(source.stamina, 78 + Math.floor(offense.guard / 10));
    const damage = action.targets[0].damage, fraction = damage / victim.maxHp;
    const prepared = !['none', 'guard'].includes(setup), cap = prepared ? .75 : .6;
    signatureProbes++; capViolations += Number(damage > Math.floor(victim.maxHp * cap));
    if (setup.includes('guard')) assert.ok(damage <= Math.ceil(Math.floor(victim.maxHp * cap) * .5), 'Guard response bound');
    assert.ok(damage <= Math.ceil(before * 1.02));
    if (setup === 'none') { unpreparedKos += Number(victim.ko); maxUnprepared = Math.max(maxUnprepared, fraction); }
    else if (setup.includes('guard')) maxGuarded = Math.max(maxGuarded, fraction);
    else maxPrepared = Math.max(maxPrepared, fraction);
}
rounds.sort((a, b) => a - b);
const report = { ruleset: 'pet-tactics-v1', fixtureSeed: 581309, evidence: 'Controlled deterministic resolver simulations; public-state heuristics, not human playtesting.',
    sourceSha256: Object.fromEntries(await Promise.all(['api/_pet-tactics/engine.ts', 'shared/pet-tactics-roster.ts', 'shared/pet-tactics-contract.ts', 'scripts/pet-tactics-balance-audit.mts', 'scripts/pet-tactics-matchup-audit.mts']
        .map(async path => [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')]))),
    fixtureCoverage: { species: TACTICS_ROSTER.length, allocations: Object.keys(allocations), items: TACTICS_ITEMS.map(i => i.id), customMovePoolShare: .4, randomizedLeads: true, pairedSeats: true },
    selfPlay, controlledLeadSubstitutions: substitutionResults, mirror: { matches: 240, seatAScore: mirrorScore / 240 }, policyComparisons: comparison,
    signatures: { probes: signatureProbes, unpreparedFullHealthKos: unpreparedKos, capViolations, maxUnpreparedHpFraction: maxUnprepared, maxPreparedHpFraction: maxPrepared, maxGuardedHpFraction: maxGuarded },
    totals: { matches: games, medianRounds: rounds[Math.floor(rounds.length / 2)], p90Rounds: rounds[Math.floor(rounds.length * .9)], draws, reasons }, actionUsage: usage,
    limitations: 'Conditional species team scores include shared teammates. Controlled substitutions isolate the lead species/kit under two presets but not optimized team synergy. Randomized legal builds are not optimized human builds. Policy forecasts omit several utility combinations; no meta or full-roster certification is implied.' };
await writeFile(resolve(process.argv[2] ?? 'docs/audits/pet-tactics-prototype/matchup-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.equal(unpreparedKos, 0); assert.equal(capViolations, 0);
assert.ok(report.mirror.seatAScore >= .4 && report.mirror.seatAScore <= .6, 'Mirror seat bias exceeds audit threshold');
assert.ok(comparison.slice(0, 2).every(p => p.tacticalScore > .55), 'Tactical policy must outperform both damage and signature spam');

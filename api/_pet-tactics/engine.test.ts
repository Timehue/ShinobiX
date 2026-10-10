import test from 'node:test';
import assert from 'node:assert/strict';
import { TACTICS_MOVES, TACTICS_ROSTER, tacticsPreset } from '../../shared/pet-tactics-roster.js';
import type { TacticsOrder } from '../../shared/pet-tactics-contract.js';
import { cinematicView, createTacticsBattle, defaultOrders, resolveTacticsRound, validateBuilds, validateOrders, damageEstimate, petSheets, type TacticsBattle } from './engine.js';

const squad = (ids = ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth']) => ids.map(id => tacticsPreset(id));
const battle = () => createTacticsBattle('aabbccdd', squad(), squad(), 731);
const rest = (state: TacticsBattle, seat: 'a' | 'b'): TacticsOrder[] => state.teams[seat].filter(p => p.slot !== null && !p.ko).map(p => ({ actorId: p.id, kind: 'rest' }));
const equip = (state: TacticsBattle, id: string, moveId: string) => { state.teams[id[0] as 'a' | 'b'].find(p => p.id === id)!.moves[3] = { ...TACTICS_MOVES[moveId], available: true, ranges: [] }; };
const strike = (actorId: string, moveId = 'fire-pulse', targetSlot = 0): TacticsOrder => ({ kind: 'move', actorId, moveId, targetSlot });

test('all 12 species have two legal builds, independently authored combat axes and no rarity ladder', () => {
    assert.equal(TACTICS_ROSTER.length, 12);
    for (const p of TACTICS_ROSTER) {
        assert.ok(p.pool.length >= 6);
        assert.notDeepEqual(p.builds[0].moves, p.builds[1].moves);
        for (let i = 0; i < 2; i++) validateBuilds([tacticsPreset(p.id, i), ...TACTICS_ROSTER.filter(q => q.id !== p.id).slice(0, 3).map(q => tacticsPreset(q.id))]);
    }
    const a = battle();
    const source = a.teams.a[0], target = a.teams.b[0];
    const before = damageEstimate(a, source, target, TACTICS_MOVES['fire-pulse']);
    source.rarity = 'mythic'; target.rarity = 'standard';
    assert.equal(damageEstimate(a, source, target, TACTICS_MOVES['fire-pulse']), before);
});
test('rejects forged stats, illegal allocations, species, duplicate moves and teams', () => {
    for (const mutate of [
        (team: ReturnType<typeof squad>) => { team[1].speciesId = team[0].speciesId; },
        (team: ReturnType<typeof squad>) => { team[0].moveIds[0] = 'constructor'; },
        (team: ReturnType<typeof squad>) => { team[0].moveIds[1] = team[0].moveIds[0]; },
        (team: ReturnType<typeof squad>) => { team[0].allocation.power = 100; },
        (team: ReturnType<typeof squad>) => { team[0].allocation.agility = 6.5; },
    ]) { const team = squad(); mutate(team); assert.throws(() => validateBuilds(team)); }
    const team = squad(); (team[0] as unknown as Record<string, unknown>).attack = 999999;
    assert.ok(createTacticsBattle('test', team, squad(), 1).teams.a[0].stats.attack < 200);
});
test('Guard resolves before the fastest attack and repeated Guard becomes costly and weak', () => {
    const s = battle(); s.teams.a[0].stats.speed = 1; s.teams.b[0].stats.speed = 10000;
    const original = s.teams.a[0].hp;
    const { events } = resolveTacticsRound(s, defaultOrders(s, 'a'), [strike('b-0'), { kind: 'rest', actorId: 'b-1' }]);
    const actions = events.filter(e => e.t === 'action');
    assert.equal(actions[0].moveKind, 'guard');
    assert.ok(original - s.teams.a[0].hp < 120);
    const second = petSheets(s, 'a')[0]; assert.equal(second.guardCost, 18); assert.equal(second.guardReduction, 30);
});
test('slot-bound attacks hit the incoming reserve; reserve forfeits its action', () => {
    const s = battle();
    resolveTacticsRound(s, [{ kind: 'switch', actorId: 'a-0', reserveId: 'a-2' }, { kind: 'rest', actorId: 'a-1' }], [strike('b-0'), { kind: 'rest', actorId: 'b-1' }]);
    assert.equal(s.teams.a[0].hp, s.teams.a[0].maxHp); assert.ok(s.teams.a[2].hp < s.teams.a[2].maxHp);
    assert.equal(s.teams.a[2].slot, 0); assert.equal(s.teams.a[0].fieldRounds, 0);
});
test('focus fire does not retarget a dead slot; reinforcements arrive at round end', () => {
    const s = battle(); s.teams.b[0].hp = 1;
    const result = resolveTacticsRound(s, [strike('a-0'), strike('a-1', 'water-pulse')], rest(s, 'b'));
    const attacks = result.events.filter(e => e.t === 'action').filter(e => e.actorSide === 'player');
    assert.equal(attacks.filter(e => e.targets.length === 0).length, 1);
    assert.equal(s.teams.b[2].hp, s.teams.b[2].maxHp);
    assert.equal(result.events.at(-2)?.t, 'switch');
});
test('mark plus follow-up creates pressure; cleanse before the follow-up removes it', () => {
    const attack = (cleanse: boolean) => {
        const s = battle(); equip(s, 'a-1', 'expose'); equip(s, 'b-1', 'purify');
        s.teams.a[1].stats.speed = 200; s.teams.a[0].stats.speed = 50; s.teams.b[1].stats.speed = 100;
        const original = s.teams.b[0].hp;
        resolveTacticsRound(s, [strike('a-0'), strike('a-1', 'expose')], [
            { kind: 'rest', actorId: 'b-0' }, cleanse ? strike('b-1', 'purify') : { kind: 'rest', actorId: 'b-1' },
        ]);
        return original - s.teams.b[0].hp;
    };
    assert.ok(attack(false) > attack(true) * 1.15);
});
test('Intercept sacrifices the defender’s action to protect its partner; Protect can counter a signature', () => {
    const s = battle(); equip(s, 'a-0', 'intercept'); s.teams.a[0].stats.speed = 1;
    resolveTacticsRound(s, [strike('a-0', 'intercept'), { kind: 'rest', actorId: 'a-1' }], [strike('b-0', 'fire-pulse', 1), { kind: 'rest', actorId: 'b-1' }]);
    assert.equal(s.teams.a[1].hp, s.teams.a[1].maxHp); assert.ok(s.teams.a[0].hp < s.teams.a[0].maxHp);
    const protectedBattle = battle(); protectedBattle.round = 3; equip(protectedBattle, 'a-0', 'protect');
    protectedBattle.teams.b[0].meter = 100; protectedBattle.teams.b[0].fieldRounds = 3;
    resolveTacticsRound(protectedBattle, [strike('a-0', 'protect'), { kind: 'rest', actorId: 'a-1' }], [{ kind: 'signature', actorId: 'b-0', targetSlot: 0 }, { kind: 'rest', actorId: 'b-1' }]);
    assert.equal(protectedBattle.teams.a[0].hp, protectedBattle.teams.a[0].maxHp);
    assert.equal(protectedBattle.teams.b[0].signatureUsed, true);
});
test('bind denies one action, cleanse preserves immunity, and immunity cannot be evicted', () => {
    const s = battle(); equip(s, 'a-0', 'bind'); s.teams.a[0].fieldRounds = 1; s.teams.a[0].stats.speed = 1000;
    const { events } = resolveTacticsRound(s, [strike('a-0', 'bind'), { kind: 'rest', actorId: 'a-1' }], rest(s, 'b'));
    assert.equal(events.filter(e => e.t === 'skip' && e.actorId === 'b-0').length, 1);
    assert.equal(s.teams.b[0].stunned, false); assert.equal(s.teams.b[0].controlImmuneUntil, 4);
    s.teams.a[0].cooldowns = {}; s.teams.a[0].stamina = 100;
    const again = resolveTacticsRound(s, [strike('a-0', 'bind'), { kind: 'rest', actorId: 'a-1' }], rest(s, 'b'));
    assert.equal(again.events.filter(e => e.t === 'skip').length, 0); assert.ok(again.notes.some(n => n.includes('immune')));
});
test('stamina, signature charge, cooldowns, bench holds and team signature limit are real gates', () => {
    const s = battle();
    for (let r = 0; r < 3; r++) resolveTacticsRound(s, rest(s, 'a'), rest(s, 'b'));
    assert.equal(s.teams.a[0].meter, 45); assert.equal(s.teams.a[2].meter, 0); assert.equal(s.teams.a[2].fieldRounds, 0);
    assert.throws(() => validateOrders(s, 'a', [{ kind: 'signature', actorId: 'a-0', targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }]));
    for (const p of s.teams.a.slice(0, 2)) p.meter = 100;
    assert.throws(() => validateOrders(s, 'a', s.teams.a.slice(0, 2).map(p => ({ kind: 'signature', actorId: p.id, targetSlot: 0 }))));
    s.teams.a[0].stamina = 29;
    assert.throws(() => validateOrders(s, 'a', [{ kind: 'signature', actorId: 'a-0', targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }]));
    equip(s, 'a-1', 'mend');
    resolveTacticsRound(s, [{ kind: 'rest', actorId: 'a-0' }, strike('a-1', 'mend', 1)], rest(s, 'b'));
    assert.equal(petSheets(s, 'a')[1].moves.find(m => m.id === 'mend')?.available, false);
});
test('no unprepared signature one-shots any full-health species; signatures have no incidental splash', () => {
    for (const actor of TACTICS_ROSTER) for (const target of TACTICS_ROSTER) {
        const a = [tacticsPreset(actor.id), ...TACTICS_ROSTER.filter(p => p.id !== actor.id).slice(0, 3).map(p => tacticsPreset(p.id))];
        const b = [tacticsPreset(target.id), ...TACTICS_ROSTER.filter(p => p.id !== target.id).slice(0, 3).map(p => tacticsPreset(p.id))];
        const s = createTacticsBattle('probe', a, b, 123); s.round = 3; s.teams.a[0].meter = 100; s.teams.a[0].fieldRounds = 3;
        const result = resolveTacticsRound(s, [{ kind: 'signature', actorId: 'a-0', targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }], rest(s, 'b'));
        assert.ok(s.teams.b[0].hp > 0, `${actor.name} -> ${target.name}`);
        const ultimate = result.events.find(e => e.t === 'action' && e.super);
        assert.ok(ultimate?.t === 'action'); if (actor.signature.kind === 'damage') assert.equal(ultimate.targets.length, 1);
    }
});
test('resolver is deterministic and rejected rounds do not mutate the state', () => {
    const s = battle(), copy = structuredClone(s);
    const orders = [strike('a-0'), strike('a-1', 'water-pulse', 1)];
    assert.deepEqual(resolveTacticsRound(s, orders, rest(s, 'b')), resolveTacticsRound(copy, orders, rest(copy, 'b'))); assert.deepEqual(s, copy);
    const before = structuredClone(s);
    assert.throws(() => resolveTacticsRound(s, [{ kind: 'rest', actorId: 'b-0' }, { kind: 'rest', actorId: 'a-1' }], rest(s, 'b')));
    assert.deepEqual(s, before);
});
test('Power investment retains damage value; Guard buys defense and stamina income; Agility changes speed', () => {
    const lean = squad(), invested = squad();
    lean[0].allocation = { vitality: 25, power: 0, guard: 24, agility: 0 };
    invested[0].allocation = { vitality: 24, power: 25, guard: 0, agility: 0 };
    const low = createTacticsBattle('low', lean, squad(), 1), high = createTacticsBattle('high', invested, squad(), 1);
    const move = TACTICS_MOVES['fire-pulse'];
    const ratio = damageEstimate(high, high.teams.a[0], high.teams.b[0], move) / damageEstimate(low, low.teams.a[0], low.teams.b[0], move);
    assert.ok(ratio > 1.14 && ratio < 1.16);
    for (const s of [low, high]) { s.teams.a[0].stamina = 0; resolveTacticsRound(s, rest(s, 'a'), rest(s, 'b')); }
    assert.equal(low.teams.a[0].stamina, high.teams.a[0].stamina + 2);
    const fast = squad(); fast[0].allocation = { vitality: 24, power: 0, guard: 0, agility: 25 };
    assert.ok(createTacticsBattle('fast', fast, squad(), 1).teams.a[0].stats.speed > low.teams.a[0].stats.speed);
});
test('a faster cleanse enables a bound ally’s queued attack without removing control immunity', () => {
    const s = battle(); equip(s, 'a-1', 'purify');
    s.teams.a[0].stunned = true; s.teams.a[0].controlImmuneUntil = 3;
    s.teams.a[0].conditionsByKind.stun = { until: 2, born: 0, amount: 1 };
    s.teams.a[1].stats.speed = 200;
    const result = resolveTacticsRound(s, [strike('a-0'), strike('a-1', 'purify')], rest(s, 'b'));
    assert.ok(result.events.some(e => e.t === 'action' && e.actorId === 'a-0'));
    assert.ok(s.teams.b[0].hp < s.teams.b[0].maxHp); assert.equal(s.teams.a[0].controlImmuneUntil, 3);
});
test('Rally, Expose and Sky increase signature pressure but prepared signatures still leave a response window', () => {
    const s = createTacticsBattle('setup', squad(['starter-wind-r', 'starter-water', 'starter-fire', 'starter-earth']), squad(['starter-lightning', 'starter-water', 'starter-fire', 'starter-earth']), 1);
    s.round = 3; const actor = s.teams.a[0], target = s.teams.b[0]; actor.meter = 100; actor.fieldRounds = 3;
    const normal = damageEstimate(s, actor, target, actor.signature);
    actor.conditionsByKind.buff = { until: 6, born: 3, amount: 1 }; target.conditionsByKind.mark = { until: 6, born: 3, amount: 1 }; s.weather = { element: 'Wind', until: 6 };
    assert.ok(damageEstimate(s, actor, target, actor.signature) > normal);
    resolveTacticsRound(s, [{ kind: 'signature', actorId: actor.id, targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }], rest(s, 'b'));
    assert.ok(target.hp >= Math.ceil(target.maxHp * .25)); assert.ok(target.hp < target.maxHp * .5);
});

test('Undertow changes the next two initiative orders, without retroactively moving queued actions', () => {
    const s = battle(); equip(s, 'a-0', 'undertow');
    s.teams.a[0].stats.speed = 80; s.teams.b[0].stats.speed = 100;
    const turn = (slow: boolean) => resolveTacticsRound(s,
        [strike('a-0', slow ? 'undertow' : 'fire-pulse'), { kind: 'rest', actorId: 'a-1' }],
        [strike('b-0'), { kind: 'rest', actorId: 'b-1' }]).events.filter(e => e.t === 'action')[0].actorId;
    assert.equal(turn(true), 'b-0');
    assert.equal(turn(false), 'a-0');
    assert.equal(turn(false), 'a-0');
    assert.equal(turn(false), 'b-0');
});

test('Perfect Guard stops direct hits while existing burn and late attrition still deal damage', () => {
    const s = battle(); equip(s, 'a-0', 'protect'); s.round = 17;
    const pet = s.teams.a[0], hp = pet.hp;
    pet.conditionsByKind.burn = { until: 20, born: 17, amount: 1 };
    const script = resolveTacticsRound(s, [strike('a-0', 'protect'), { kind: 'rest', actorId: 'a-1' }],
        [strike('b-0'), { kind: 'rest', actorId: 'b-1' }]);
    const hit = script.events.find(e => e.t === 'action' && e.actorId === 'b-0');
    assert.ok(hit?.t === 'action'); assert.equal(hit.targets[0].damage, 0);
    assert.equal(hp - pet.hp, Math.round(pet.maxHp * .04) + Math.round(pet.maxHp * .02));
});

test('planning projection clears expired effects and weather while preserving active slow and shield amounts', () => {
    const s = battle(); s.round = 3;
    const p = s.teams.a[0];
    p.conditionsByKind.slow = { until: 3, born: 1, amount: 1 };
    p.conditionsByKind.shield = { until: 4, born: 3, amount: 73 };
    s.weather = { element: 'Water', until: 3 };
    const view = cinematicView(s, 'a', 'other');
    assert.equal(view.weather, undefined); assert.equal(view.player[0].speed, p.stats.speed);
    assert.deepEqual(view.player[0].statuses, [{ kind: 'shield', rounds: 1, magnitude: 73 }]);
    assert.deepEqual(petSheets(s, 'a')[0].conditions, ['shield']);
    p.conditionsByKind.slow.until = 4; s.weather.until = 4;
    const activeView = cinematicView(s, 'a', 'other');
    assert.equal(activeView.player[0].speed, p.stats.speed * .75); assert.equal(activeView.weather?.roundsLeft, 1);
});

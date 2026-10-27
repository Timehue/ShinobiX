/*
 * Role partner bonds (owner ruling 2026-10-26). Each bond applies only to a
 * session sealed with `partnerRules` and only while both partners are alive
 * and fielded. Every comparison runs two sessions that differ ONLY in that
 * flag, with the same seed and the same commands, so a difference can come
 * from nothing but the bond.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addStatus,
    createShowdownSession,
    estimateShowdownMoveDamage,
    resolveShowdownRound,
    showdownStateView,
    type ShowdownSession,
} from './engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { ShowdownCommand, ShowdownEvent } from '../../shared/pet-showdown-contract.js';
import { showdownPartnerLines } from '../../shared/pet-showdown-contract.js';

function makePet(id: string, overrides: Partial<Pet> = {}): Pet {
    return {
        id, name: id, rarity: 'standard', level: 40, xp: 0, maxLevel: 100,
        hp: 1500, attack: 120, defense: 90, speed: 60, unlockedForPve: true,
        element: 'None', role: 'tracker',
        jutsus: [{ name: 'Jab', power: 90, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
        ...overrides,
    } as Pet;
}

function session(partnerRules: boolean, player: Pet[], enemy: Pet[], seed = 2468): ShowdownSession {
    return createShowdownSession({
        rulesetVersion: 'progression-v3', partnerRules,
        sessionId: 'partner', playerName: 'A', enemyTeamName: 'B', format: '2v2', tier: 'warrior', seed,
        playerPets: player, enemyPets: enemy, rewardEligible: false,
    });
}

const actionOf = (events: ShowdownEvent[], actorId: string) =>
    events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === actorId)!;

const rest = (...ids: string[]): ShowdownCommand[] => ids.map(petId => ({ kind: 'rest', petId }));

test('Hunt: an Assassin beside a Tracker cashes a Mark harder, only under partner rules', () => {
    const hit = (partnerRules: boolean, allyRole: string) => {
        const battle = session(partnerRules,
            [makePet('a', { role: 'assassin', speed: 300 }), makePet('ally', { role: allyRole as Pet['role'], speed: 5 })],
            [makePet('b', { hp: 9000, speed: 4 }), makePet('b2', { hp: 9000, speed: 3 })]);
        addStatus(battle, battle.enemy[0], 'mark', 3, 1.25);
        const events = resolveShowdownRound(battle, [{ kind: 'move', petId: 'a', moveIndex: 0, targetId: 'b' }, ...rest('ally')], rest('b', 'b2'));
        return actionOf(events, 'a').targets[0];
    };
    const bonded = hit(true, 'tracker'), unbonded = hit(false, 'tracker'), wrongPartner = hit(true, 'sage');
    assert.ok(bonded.procs?.includes('Partner: Hunt'));
    assert.ok(!unbonded.procs?.includes('Partner: Hunt'), 'older sessions never see the bond');
    assert.ok(!wrongPartner.procs?.includes('Partner: Hunt'));
    assert.ok(bonded.damage > unbonded.damage);
    assert.equal(wrongPartner.damage, unbonded.damage, 'no Tracker, no bonus');
});

test('Bulwark: a guarding Defender covers its Assassin partner against direct hits', () => {
    const taken = (partnerRules: boolean, defenderGuards: boolean) => {
        const battle = session(partnerRules,
            [makePet('a', { role: 'assassin', speed: 5 }), makePet('d', { role: 'defender', speed: 6 })],
            [makePet('b', { speed: 300, attack: 200 }), makePet('b2', { speed: 4 })]);
        const player: ShowdownCommand[] = [{ kind: 'rest', petId: 'a' }, { kind: defenderGuards ? 'guard' : 'rest', petId: 'd' }];
        const events = resolveShowdownRound(battle, player, [{ kind: 'move', petId: 'b', moveIndex: 0, targetId: 'a' }, ...rest('b2')]);
        return actionOf(events, 'b').targets[0];
    };
    const covered = taken(true, true);
    assert.ok(covered.procs?.includes('Partner: Bulwark'));
    assert.ok(covered.damage < taken(false, true).damage);
    assert.ok(!taken(true, false).procs?.includes('Partner: Bulwark'), 'only while the Defender guards');
});

test('Sanctuary: a Sage heals more beside a fielded Defender, and the bond ends when the Defender is benched', () => {
    const healed = (partnerRules: boolean, benchDefender = false) => {
        const battle = session(partnerRules,
            [makePet('s', { role: 'sage', speed: 300 }), makePet('d', { role: 'defender', speed: 5 }), makePet('r', { role: 'tracker' })],
            [makePet('b', { speed: 4 }), makePet('b2', { speed: 3 })]);
        const sage = battle.player.find(p => p.id === 's')!;
        sage.moves[0] = { ...sage.moves[0], kind: 'heal', cost: 1 };
        const wounded = battle.player.find(p => p.id === 'd')!;
        wounded.hp = Math.round(wounded.maxHp * .3);
        if (benchDefender) {
            // The Defender steps out; the heal now lands on the Sage with no partner fielded.
            wounded.benched = true;
            battle.player.find(p => p.id === 'r')!.benched = false;
            sage.hp = Math.round(sage.maxHp * .3);
        }
        const target = benchDefender ? 's' : 'd';
        const events = resolveShowdownRound(battle,
            [{ kind: 'move', petId: 's', moveIndex: 0, targetId: target }, ...rest(benchDefender ? 'r' : 'd')], rest('b', 'b2'));
        return actionOf(events, 's').targets.find(t => t.id === target)!;
    };
    const bonded = healed(true), plain = healed(false);
    assert.ok(bonded.procs?.includes('Partner: Sanctuary'));
    assert.ok(bonded.heal > plain.heal);
    assert.ok(!healed(true, true).procs?.includes('Partner: Sanctuary'), 'a benched Defender is no partner');
});

test('partner rules are sealed only on progression sessions and are shown on the view', () => {
    const live = session(true, [makePet('a'), makePet('b')], [makePet('c'), makePet('d')]);
    assert.equal(live.partnerRules, true);
    assert.equal(showdownStateView(live).partnerRules, true);
    const legacy = createShowdownSession({ rulesetVersion: 'legacy-v2', partnerRules: true, sessionId: 'x', playerName: 'A', enemyTeamName: 'B',
        format: '2v2', tier: 'warrior', seed: 1, playerPets: [makePet('a'), makePet('b')], enemyPets: [makePet('c'), makePet('d')], rewardEligible: false });
    assert.equal(legacy.partnerRules, undefined, 'legacy sessions never take the bonds');
    assert.equal('partnerRules' in session(false, [makePet('a'), makePet('b')], [makePet('c'), makePet('d')]), false,
        'an un-flagged session is byte-for-byte what it was before');
});

test('under partner rules the AI forecast includes ally element synergy', () => {
    const forecast = (partnerRules: boolean) => {
        const battle = session(partnerRules,
            [makePet('a', { element: 'Fire', jutsus: [{ name: 'Flame', power: 120, cooldown: 1, currentCooldown: 0, kind: 'damage' }] }), makePet('w', { element: 'Wind' })],
            [makePet('b', { hp: 9000 }), makePet('b2', { hp: 9000 })]);
        const attacker = battle.player[0];
        const move = attacker.moves.find(m => m.synergyElement === 'Wind')!;
        assert.ok(move, 'a Fire technique partners with Wind');
        return estimateShowdownMoveDamage(battle, attacker, battle.enemy[0], move);
    };
    assert.ok(forecast(true) > forecast(false));
});

test('squad pickers describe each pairing once', () => {
    const lines = showdownPartnerLines([
        { name: 'Sora', role: 'sage', element: 'Water' },
        { name: 'Iwa', role: 'defender', element: 'Fire' },
        { name: 'Kaze', role: 'tracker', element: 'Wind' },
    ]);
    assert.ok(lines.some(line => line.startsWith('Sora + Iwa: Sanctuary.')));
    assert.ok(lines.some(line => line === 'Iwa powers up Sora\'s Water techniques by 10%.'), 'Water beats Fire, so a Fire ally powers Water moves');
    assert.ok(lines.some(line => line === 'Kaze powers up Iwa\'s Fire techniques by 10%.'));
    assert.equal(showdownPartnerLines([{ name: 'Solo', role: 'sage', element: 'Fire' }]).length, 0);
});

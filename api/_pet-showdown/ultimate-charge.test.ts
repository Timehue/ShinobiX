import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../pet/_catalog.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { createShowdownSession, resolveShowdownRound, sanitizeCommand, showdownStateView, type ShowdownSession } from './engine.js';
import { SHOWDOWN_METER_MAX, type ShowdownCommand } from '../../shared/pet-showdown-contract.js';

function fixture(templateId = 'standard-0', reserves = 0) {
    const pets = (side: string) => Array.from({ length: 1 + reserves }, (_, i) => ({ ...PET_CATALOG[templateId], templateId, id: `${side}-${i}`, level: 30 }) as Pet);
    const session = createShowdownSession({ sessionId: 'charge-test', playerName: 'A', enemyTeamName: 'B', format: '1v1', tier: 'warrior', seed: 54321,
        playerPets: pets('p'), enemyPets: pets('e'), rewardEligible: false });
    return session;
}

function quietRound(session: ShowdownSession, kind: 'guard' | 'rest' = 'guard') {
    const orders = (side: 'player' | 'enemy'): ShowdownCommand[] => session[side].filter(p => !p.ko && !p.benched).map(p => ({ kind, petId: p.id }));
    return resolveShowdownRound(session, orders('player'), orders('enemy'));
}

test('every roster pet can select its first ultimate after two field rounds without having to deal or take damage', () => {
    for (const [templateId, template] of Object.entries(PET_CATALOG)) {
        const session = fixture(templateId);
        const command: ShowdownCommand = { kind: 'super', petId: 'p-0', targetId: 'e-0' };
        assert.equal(sanitizeCommand(session, session.player[0], command).kind, 'guard');
        quietRound(session, 'guard');
        assert.equal(sanitizeCommand(session, session.player[0], command).kind, 'guard', `${template.name}: no round-two free ultimate`);
        quietRound(session, 'rest');
        for (const side of ['player', 'enemy'] as const) {
            const view = showdownStateView(session)[side][0];
            assert.equal(view.meter, SHOWDOWN_METER_MAX);
            assert.ok(view.readiness >= view.moves.find(m => m.signature)!.hold);
            assert.equal(session[side][0].hp, session[side][0].maxHp, 'charge does not require injury');
        }
        assert.equal(sanitizeCommand(session, session.player[0], command).kind, 'super');
        const events = resolveShowdownRound(session, [command], [{ kind: 'guard', petId: 'e-0' }]);
        assert.ok(events.some(e => e.t === 'action' && e.actorId === 'p-0' && e.super), `${template.name}: legal choice really executes`);
    }
});

test('spending the first ultimate ends its passive charge on a hit, absorption, or dodge, including after serialization', () => {
    for (const outcome of ['hit', 'absorbed', 'dodged']) {
        let session = fixture();
        quietRound(session); quietRound(session);
        const target = session.enemy[0];
        if (outcome === 'absorbed') target.statuses.push({ kind: 'shield', rounds: 5, magnitude: 100000, bornRound: session.round });
        if (outcome === 'dodged') target.consumable = { id: 'smoke', name: 'Smoke', dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
        const events = resolveShowdownRound(session, [{ kind: 'super', petId: 'p-0', targetId: 'e-0' }], [{ kind: 'guard', petId: 'e-0' }]);
        assert.ok(events.some(e => e.t === 'action' && e.super && e.actorId === 'p-0'));
        assert.equal(session.player[0].signatureUsed, true);
        assert.ok(session.player[0].meter <= 10, 'only actual landed damage can begin refilling after the cast');
        const charge = session.player[0].meter;
        session = JSON.parse(JSON.stringify(session)) as ShowdownSession;
        quietRound(session, 'rest'); quietRound(session, 'rest');
        assert.equal(session.player[0].meter, charge, `${outcome}: waiting cannot recharge repeated ultimates`);
    }
});

test('reserves earn first charge only while fielded, and switching cannot reset a spent first cast', () => {
    let session = fixture('standard-0', 1);
    quietRound(session); quietRound(session);
    assert.equal(session.player[1].meter, 0, 'bench hold time is not first-ultimate charge');
    resolveShowdownRound(session, [{ kind: 'switch', petId: 'p-0', benchPetId: 'p-1' }], [{ kind: 'guard', petId: 'e-0' }]);
    assert.equal(session.player[1].meter, 50);
    quietRound(session);
    assert.equal(session.player[1].meter, 100);
    resolveShowdownRound(session, [{ kind: 'super', petId: 'p-1', targetId: 'e-0' }], [{ kind: 'guard', petId: 'e-0' }]);
    const charge = session.player[1].meter;
    resolveShowdownRound(session, [{ kind: 'switch', petId: 'p-1', benchPetId: 'p-0' }], [{ kind: 'rest', petId: 'e-0' }]);
    session = JSON.parse(JSON.stringify(session)) as ShowdownSession;
    resolveShowdownRound(session, [{ kind: 'switch', petId: 'p-0', benchPetId: 'p-1' }], [{ kind: 'rest', petId: 'e-0' }]);
    quietRound(session, 'rest');
    assert.equal(session.player[1].meter, charge);
    assert.equal(session.player[1].signatureUsed, true);
});

test('an illegal early ultimate does not consume first-use charge', () => {
    const session = fixture();
    const events = resolveShowdownRound(session, [{ kind: 'super', petId: 'p-0', targetId: 'e-0' }], [{ kind: 'rest', petId: 'e-0' }]);
    assert.ok(events.some(e => e.t === 'action' && e.actorId === 'p-0' && e.moveKind === 'guard'));
    assert.equal(session.player[0].signatureUsed, undefined);
    quietRound(session);
    assert.equal(session.player[0].meter, 100);
});

test('extreme live ultimates preserve a full-health response, Guard halves each hit, and wounded targets can be finished', () => {
    for (const side of ['player', 'enemy'] as const) for (const level of [1, 25, 50, 100]) {
        const cast = (guarded: boolean, wounded = false) => {
            const make = (id: string) => ({ ...PET_CATALOG['standard-0'], id, templateId: 'standard-0', level }) as Pet;
            const session = createShowdownSession({ sessionId: 'ultimate-damage', playerName: 'A', enemyTeamName: 'B', format: '3v3', tier: 'warrior', seed: 7,
                playerPets: [0, 1, 2].map(i => make(`p-${i}`)), enemyPets: [0, 1, 2].map(i => make(`e-${i}`)), rewardEligible: false });
            const foes = session[side === 'player' ? 'enemy' : 'player'], actor = session[side][0];
            actor.meter = 100; actor.readiness = 2; actor.attack = actor.spAttack = 10000;
            for (const target of foes) { target.hp = wounded ? 200 : 400; target.maxHp = 400; target.defense = target.spDefense = 1; target.speed = 10000; }
            const attack: ShowdownCommand[] = session[side].map(p => p === actor ? { kind: 'super', petId: p.id, targetId: foes[0].id } : { kind: 'rest', petId: p.id });
            const defense: ShowdownCommand[] = foes.map(p => ({ kind: guarded ? 'guard' : 'rest', petId: p.id }));
            const events = resolveShowdownRound(session, side === 'player' ? attack : defense, side === 'enemy' ? attack : defense);
            const action = events.find(e => e.t === 'action' && e.actorId === actor.id && e.super);
            assert.ok(action?.t === 'action');
            assert.equal(action.targets.length, 3);
            return action.targets;
        };
        const hits = cast(false), guarded = cast(true), finishes = cast(false, true);
        for (let i = 0; i < hits.length; i++) {
            assert.ok(hits[i].damage <= 360 && !hits[i].ko);
            assert.equal(guarded[i].guarded, true);
            assert.ok(Math.abs(guarded[i].damage - hits[i].damage / 2) <= 1);
            assert.equal(finishes[i].ko, true);
        }
    }
});

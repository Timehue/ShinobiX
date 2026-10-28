import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShowdownSession, resolveShowdownRound, sealShowdownPet } from './engine.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { ShowdownEvent } from '../../shared/pet-showdown-contract.js';

function battle(trait?: string, partner = false) {
    const template = PET_CATALOG['standard-0'];
    const owned = (id: string) => ({ ...template, id, templateId: template.id, level: 50, trait: undefined } as Pet);
    const session = createShowdownSession({ sessionId: 'trait-audit', playerName: 'a', enemyTeamName: 'b',
        format: partner ? '2v2' : '1v1', tier: 'warrior', seed: 777, rewardEligible: false,
        rulesetVersion: 'progression-v3', playerPets: partner ? [owned('a'), owned('ally')] : [owned('a')], enemyPets: [owned('b')] });
    // Isolate the live trait behavior from the separately tested acquisition
    // stat bonuses. Exact same sealed stats, kit, seed and opponent every time.
    session.player[0].trait = trait;
    session.player[0].speed = 100;
    session.enemy[0].speed = 101;
    session.player[0].hp = Math.floor(session.player[0].maxHp / 2);
    return session;
}
function attack(trait?: string) {
    const session = battle(trait);
    const events = resolveShowdownRound(session, [{ kind: 'move', petId: 'a', moveIndex: 0, targetId: 'b' }], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a')!;
    return { session, action };
}

test('offensive traits change actual Colosseum damage with identical stats', () => {
    const baseline = attack().action.targets[0].damage;
    for (const trait of ['Aggressive', 'Fateweaver', 'Lucky']) assert.ok(attack(trait).action.targets[0].damage > baseline, trait);
});

test('Loyal gains signature charge and Hollowborn recovers health through real attacks', () => {
    const baseline = attack().session.player[0];
    assert.ok(attack('Loyal').session.player[0].meter > baseline.meter);
    assert.ok(attack('Hollowborn').session.player[0].hp > baseline.hp);
});

test('Swift crosses a real initiative breakpoint with identical base speed', () => {
    const first = (trait?: string) => {
        const session = battle(trait);
        const events = resolveShowdownRound(session, [{ kind: 'move', petId: 'a', moveIndex: 0, targetId: 'b' }], [{ kind: 'move', petId: 'b', moveIndex: 0, targetId: 'a' }]);
        return events.find(e => e.t === 'action') as Extract<ShowdownEvent, { t: 'action' }>;
    };
    assert.equal(first().actorId, 'b');
    assert.equal(first('Swift').actorId, 'a');
});

test('Guardian makes a chosen guard block more damage', () => {
    const received = (trait?: string) => {
        const session = battle(trait);
        const events = resolveShowdownRound(session, [{ kind: 'guard', petId: 'a' }], [{ kind: 'move', petId: 'b', moveIndex: 0, targetId: 'a' }]);
        const hit = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'b')!;
        return hit.targets[0].damage;
    };
    assert.ok(received('Guardian') < received());
});

test('Battleborn starts with a partial signature charge', () => {
    const template = PET_CATALOG['standard-0'];
    const pet = sealShowdownPet({ ...template, templateId: template.id, level: 50, trait: 'Battleborn' } as Pet, 'progression-v3');
    assert.equal(pet.meter, 25);
    assert.ok(pet.meter < 100);
});

test('Boonbringer amplifies an actual partner combination, not a solo hit', () => {
    const hit = (trait?: string, partner = true) => {
        const session = battle(trait, partner), actor = session.player[0];
        const index = actor.moves.findIndex(move => move.power > 0 && move.synergyElement);
        assert.ok(index >= 0, 'fixture needs an elemental attack');
        if (partner) session.player[1].element = actor.moves[index].synergyElement!;
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: index, targetId: 'b' },
            ...(partner ? [{ kind: 'rest' as const, petId: 'ally' }] : []),
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a')!;
        return action.targets[0].damage;
    };
    assert.ok(hit('Boonbringer') > hit());
    assert.equal(hit('Boonbringer', false), hit(undefined, false));
});

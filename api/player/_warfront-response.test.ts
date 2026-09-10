import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warfrontMatchFromNotice } from './_warfront-response.js';

const plan = { buyPolicy: 'balanced', stance: 'balanced', doctrine: 'vanguard' };
const pets = (prefix: string) => Array.from({ length: 4 }, (_, slot) => ({
    id: `${prefix}-${slot}`, name: `${prefix}-${slot}`, rarity: 'rare', level: 80,
    hp: 1800 + slot, attack: 240, defense: 180, speed: 120, role: 'tracker', subRole: 'kite',
    jutsus: [{ name: 'Sealed technique', kind: 'burn', power: 145, cooldown: 3, signature: true }],
}));
const notice = () => ({ arenaMatch: true, accepted: true, petBattleSeed: 42,
    challenger: { pets: pets('challenger') }, challengerTeamIds: pets('challenger').map((pet) => pet.id),
    responderTeam: pets('responder'), challengerWarfrontPlan: plan, responderWarfrontPlan: plan,
});

test('acceptance returns the exact refreshed server teams, stats, and seed to the responder', () => {
    const source = notice();
    source.challengerTeamIds = ['challenger-3', 'challenger-0', 'challenger-2', 'challenger-1'];
    const sealed = warfrontMatchFromNotice(source)!;
    const replay = JSON.parse(JSON.stringify(sealed)) as typeof sealed;
    assert.deepEqual(replay.blue.map((pet) => pet.id), source.challengerTeamIds);
    assert.deepEqual(replay.red, source.responderTeam);
    assert.equal(replay.blue[0].hp, 1803);
    assert.equal(replay.blue[0].level, 80);
    assert.deepEqual(replay.blue[0].jutsus, source.challenger.pets[3].jutsus);
    assert.equal(replay.seed, 42);
    assert.deepEqual(replay.plans, { blue: plan, red: plan });
});

test('incomplete or unsealed peer notices never return a playable match', () => {
    assert.equal(warfrontMatchFromNotice({ ...notice(), accepted: false }), null);
    assert.equal(warfrontMatchFromNotice({ ...notice(), responderTeam: [] }), null);
    assert.equal(warfrontMatchFromNotice({ ...notice(), petBattleSeed: undefined }), null);
});

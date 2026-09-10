import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLobby, resolveMatch } from '../api/arena/_lobby-core';
import { runWarfrontRite as serverRun } from '../api/_pet-sim/pet-warfront-rite';
import { runWarfrontRite as clientRun } from '../shinobij.client/src/lib/pet-warfront-rite';
import { normalizeCoopWarfrontMatch } from '../shinobij.client/src/lib/pet-coop-warfront';
import { parseAcceptedWarfrontMatch } from '../shinobij.client/src/lib/arena-challenge';
import { warfrontMatchFromNotice } from '../api/player/_warfront-response';

test('co-op payload keeps full kit and effective roles across serialization and both simulators', () => {
    const sealed = resolveMatch(newLobby('SYNC', 'host', 1), 21);
    const client = normalizeCoopWarfrontMatch(JSON.parse(JSON.stringify(sealed)));
    const serverBand = (side: 'blue' | 'red') => sealed[side].map((slot) => slot.pet) as unknown as Parameters<typeof serverRun>[0];
    assert.deepEqual(serverRun(serverBand('blue'), serverBand('red'), sealed.seed),
        clientRun(client.blue.map((slot) => slot.pet), client.red.map((slot) => slot.pet), sealed.seed));
    const legacy = JSON.parse(JSON.stringify(sealed));
    delete legacy.blue[0].pet.role;
    assert.equal(normalizeCoopWarfrontMatch(legacy).blue[0].pet.role, sealed.blue[0].role);
});

test('peer acceptance validates the server snapshot rather than substituting local stats', () => {
    const sealed = resolveMatch(newLobby('PEER', 'host', 1), 42);
    const plan = { buyPolicy: 'balanced', stance: 'balanced', doctrine: 'vanguard' };
    const blue = sealed.blue.map((slot, i) => ({ ...slot.pet, id: `blue-${i}` }));
    const red = sealed.red.map((slot, i) => ({ ...slot.pet, id: `red-${i}` }));
    const server = warfrontMatchFromNotice({ arenaMatch: true, accepted: true, petBattleSeed: 42,
        challenger: { pets: blue }, challengerTeamIds: blue.map((pet) => pet.id), responderTeam: red,
        challengerWarfrontPlan: plan, responderWarfrontPlan: plan })!;
    const parsed = parseAcceptedWarfrontMatch(JSON.parse(JSON.stringify(server)))!;
    assert.deepEqual(parsed, server);
    assert.equal(parseAcceptedWarfrontMatch({ ...server, seed: undefined }), null);
    assert.equal(parseAcceptedWarfrontMatch({ ...server, red: red.slice(0, 3) }), null);
    assert.equal(parseAcceptedWarfrontMatch({ ...server, blue: [blue[0], blue[0], blue[2], blue[3]] }), null);
    assert.equal(parseAcceptedWarfrontMatch({ ...server, blue: blue.map((pet) => ({ ...pet, attack: NaN })) }), null);
});

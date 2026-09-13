import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Character } from '../types/character';
import { firstContractPreparation } from './first-contract';
import { acknowledgeFirstContractMissionRequest, firstContractMissionRequest, hasFirstContractMissionRequest, openFirstContractActivity, subscribeFirstContractMissions } from './first-contract-navigation';
import { acknowledgeFirstContractLoadoutRequest, firstContractLoadoutRequest, hasFirstContractLoadoutRequest, subscribeFirstContractLoadout } from './first-contract-loadout-navigation';

const rookie = { name: 'ContractNavigationTest', hp: 80, hospitalized: false, equippedJutsuIds: ['strike'], jutsuMastery: [{ jutsuId: 'strike', level: 1 }], pets: [{ id: 'pet-1' }] } as Character;
test('first selection and resume share preparation routing', () => {
    for (const route of ['combat', 'discovery'] as const) {
        assert.equal(firstContractPreparation({ ...rookie, hp: 0 }, route)?.screen, 'hospital');
    }
    assert.equal(firstContractPreparation({ ...rookie, equippedJutsuIds: [] }, 'combat')?.screen, 'profile');
    assert.equal(firstContractPreparation({ ...rookie, equippedJutsuIds: [], jutsuMastery: [] }, 'combat')?.screen, 'jutsuTraining');
    assert.equal(firstContractPreparation(rookie, 'combat'), null);
    const destinations: string[] = [];
    openFirstContractActivity({ ...rookie, equippedJutsuIds: [] }, 'combat', (screen) => destinations.push(screen));
    openFirstContractActivity({ ...rookie, hp: 0 }, 'discovery', (screen) => destinations.push(screen));
    openFirstContractActivity(rookie, 'companion', (screen) => destinations.push(screen));
    assert.deepEqual(destinations, ['profile', 'hospital', 'pets']);
    assert.equal(hasFirstContractMissionRequest(rookie.name), false);
});
test('combat intent survives lazy mounting, is player-scoped, and does not pin manual tabs forever', () => {
    let notified = 0;
    const unsubscribe = subscribeFirstContractMissions(() => { notified++; });
    const destinations: string[] = [];
    openFirstContractActivity(rookie, 'combat', (screen) => destinations.push(screen));
    assert.equal(hasFirstContractMissionRequest(rookie.name.toUpperCase()), true);
    assert.equal(hasFirstContractMissionRequest('OtherPlayer'), false);
    assert.equal(notified, 1);
    const first = firstContractMissionRequest(rookie.name);
    acknowledgeFirstContractMissionRequest(rookie.name, first);
    assert.equal(hasFirstContractMissionRequest(rookie.name), false);
    openFirstContractActivity(rookie, 'combat', (screen) => destinations.push(screen));
    assert.equal(firstContractMissionRequest(rookie.name), first + 1);
    assert.equal(hasFirstContractMissionRequest(rookie.name), true);
    assert.deepEqual(destinations, ['missions', 'missions']);
    unsubscribe();
});

test('loadout intent reaches both tab levels independently and repeats on a new handoff', () => {
    const player = { ...rookie, name: 'LoadoutIntentTest', equippedJutsuIds: [] };
    let notified = 0;
    const unsubscribe = subscribeFirstContractLoadout(() => { notified++; });
    openFirstContractActivity(player, 'combat', (screen) => assert.equal(screen, 'profile'));
    const request = firstContractLoadoutRequest(player.name);
    assert.equal(hasFirstContractLoadoutRequest(player.name.toUpperCase(), 'profile'), true);
    assert.equal(hasFirstContractLoadoutRequest('OtherPlayer', 'workspace'), false);
    acknowledgeFirstContractLoadoutRequest(player.name, 'profile', request);
    assert.equal(hasFirstContractLoadoutRequest(player.name, 'profile'), false);
    assert.equal(hasFirstContractLoadoutRequest(player.name, 'workspace'), true);
    acknowledgeFirstContractLoadoutRequest(player.name, 'workspace', request);
    assert.equal(hasFirstContractLoadoutRequest(player.name, 'workspace'), false);
    openFirstContractActivity(player, 'combat', () => {});
    assert.equal(firstContractLoadoutRequest(player.name), request + 1);
    assert.equal(hasFirstContractLoadoutRequest(player.name, 'profile'), true);
    assert.equal(hasFirstContractLoadoutRequest(player.name, 'workspace'), true);
    assert.equal(notified, 2);
    unsubscribe();
});

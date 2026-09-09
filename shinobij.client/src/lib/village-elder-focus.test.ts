import assert from 'node:assert/strict';
import test from 'node:test';
import type { Character } from '../types/character';
import { activeElderFocus, cacheVillageElders, isSeatedVillageElder } from './village-elder-focus';
import { getTrainingXpBonus, getJutsuTrainingSpeedBonus, getShopDiscountPercent } from './village-upgrades';
import { effectiveCharacterXpGain } from './progression';
import { normalizeVillageState, hydrateSharedGameState, saveVillageState, loadVillageState } from './world-state';

test('legacy focus grants zero bonuses until its player seat is filled, and stops when cleared', () => {
    const village = 'Elder focus test village';
    const character = { village, elderFocus: 'training', villageUpgrades: {} } as Character;
    cacheVillageElders(village, [], Date.now() + 86400000);
    const baseXp = effectiveCharacterXpGain({}, 100);
    assert.equal(activeElderFocus(character), undefined);
    assert.equal(getTrainingXpBonus(character), 0);
    assert.equal(getJutsuTrainingSpeedBonus(character), 0);
    assert.equal(effectiveCharacterXpGain(character, 100), baseXp);
    cacheVillageElders('elderfocustestvillage', ['', '', 'Mei'], Date.now() + 86400000);
    assert.equal(getTrainingXpBonus(character), 10);
    assert.equal(getJutsuTrainingSpeedBonus(character), 10);
    assert.equal(effectiveCharacterXpGain(character, 100), baseXp + Math.floor(baseXp * 0.1));
    assert.equal(getShopDiscountPercent({ ...character, elderFocus: 'trade' }), 0);
    cacheVillageElders(village, ['', 'Rin', 'Mei'], Date.now() + 86400000);
    assert.equal(getShopDiscountPercent({ ...character, elderFocus: 'trade' }), 5);
    cacheVillageElders(village, [], Date.now() + 86400000);
    assert.equal(getTrainingXpBonus(character), 0);
    assert.equal(getShopDiscountPercent({ ...character, elderFocus: 'trade' }), 0);
    assert.equal(activeElderFocus({ ...character, village: 'Another village' }), undefined);
});

test('routine village normalization cannot overwrite freshly confirmed council seats', () => {
    const village = 'Frostfang Village';
    hydrateSharedGameState({ villageStates: { frostfangvillage: { elderAppointees: [] } } });
    cacheVillageElders(village, ['', 'Rin', ''], Date.now() + 86400000);
    normalizeVillageState(village, { elderAppointees: [] });
    assert.equal(activeElderFocus({ village, elderFocus: 'trade' }), 'trade');
    hydrateSharedGameState({ villageStates: { frostfangvillage: { elderAppointees: [] } } });
    assert.equal(activeElderFocus({ village, elderFocus: 'trade' }), undefined);
});

test('expired or undated cached seats grant no focus even when the next server poll is unavailable', () => {
    const village = 'Offline council';
    const character = { village, elderFocus: 'trade' as const };
    cacheVillageElders(village, ['', 'Rin', '']);
    assert.equal(activeElderFocus(character), undefined, 'a legacy cached roster has no term authority');
    assert.equal(isSeatedVillageElder({ village, name: 'Rin' }), false);
    cacheVillageElders(village, ['', 'Rin', ''], Date.now() - 1);
    assert.equal(activeElderFocus(character), undefined);
    assert.equal(getShopDiscountPercent(character as Character), 0);
    assert.equal(isSeatedVillageElder({ village, name: 'Rin' }), false);
    cacheVillageElders(village, ['', 'Rin', ''], Date.now() + 86400000);
    assert.equal(activeElderFocus(character), 'trade');
    assert.equal(isSeatedVillageElder({ village, name: 'Rin' }), true);
    const expired = normalizeVillageState(village, { elderAppointees: ['', 'Rin', ''], elderTerm: {
        version: 1, startedAt: Date.now() - 30 * 86400000, nextSelectionAt: Date.now(), seats: ['', 'Rin', ''], winningScores: [1, 0],
    } });
    assert.deepEqual(expired.elderAppointees, ['', '', '']);
});

test('village orders keep the server capacity and never ride ordinary village writes', async () => {
    const village = 'Orders client test';
    const noticePosts = Array.from({ length: 60 }, (_, index) => ({ id: String(index), title: 'Order', body: 'Hold the gate.' }));
    const state = normalizeVillageState(village, { noticePosts: noticePosts as never });
    assert.equal(state.noticePosts.length, 60);
    const oldFetch = globalThis.fetch;
    const sent: Array<{ state: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response('{}'); }) as typeof fetch;
    try {
        saveVillageState(village, state);
        assert.equal(sent.length, 1);
        assert.equal(Object.hasOwn(sent[0].state, 'noticePosts'), false);
        assert.equal(loadVillageState(village).noticePosts.length, 60);
    } finally { globalThis.fetch = oldFetch; }
});

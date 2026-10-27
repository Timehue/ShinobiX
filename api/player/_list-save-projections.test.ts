import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { projectKvValue } from '../_storage-projection.js';
import { buildPublicPlayerIndexEntry } from './_public-index.js';
import { ADMIN_PLAYER_SAVE_PROJECTION, PUBLIC_INDEX_SAVE_PROJECTION, readPublicIndexCharacters } from './_list-save-projections.js';

test('projected leaderboard inputs produce identical rows, including earned stats and all ratings', () => {
    const character = { name: 'Fixture', accountName: 'account', level: 80, village: 'Stormveil', specialty: 'Ninjutsu', clan: 'Test',
        rankedRating: 1201, rankedWins: 1, rankedLosses: 2, ranked2v2Rating: 1302, ranked2v2Wins: 3, ranked2v2Losses: 4,
        petRankedRating: 1403, petRankedWins: 5, petRankedLosses: 6, totalPvpKills: 7, monthlyPvpKills: 8,
        pvpKillMonth: '2026-10', xp: 999, stats: { strength: 40 }, unspentStats: 9,
        totalPetWins: 10, totalEndlessTowerWins: 11, totalVillageRaids: 12, professionXp: 13, battleTowerBestFloor: 14, battleTowerRating: 15,
        inventory: ['private-item'], ryo: 99999 };
    for (const original of [character, { ...character, stats: null }, { name: 'Legacy', xp: 120 }, {}]) {
        const projected = projectKvValue({ character: original }, PUBLIC_INDEX_SAVE_PROJECTION);
        assert.deepEqual(buildPublicPlayerIndexEntry(projected, 'fallback', 123, 100), buildPublicPlayerIndexEntry(original, 'fallback', 123, 100));
        assert.equal('inventory' in projected!, false);
        assert.equal('ryo' in projected!, false);
    }
});

test('projection batches preserve missing, empty and malformed legacy characters without reading normal saves', async () => {
    const store = _makeMemoryKv();
    const values = [{ character: { name: 'Normal', level: 3 }, privateBlob: 'private' }, { character: {} }, {}, { character: null }, null];
    const keys = values.map((_, i) => `fixture:${i}`);
    for (let i = 0; i < values.length; i++) await store.set(keys[i]!, values[i]);
    const fullBatches: string[][] = [];
    const full = store.mget.bind(store);
    store.mgetProjected = async (batch, projection) => (await full(...batch)).map(value => projectKvValue(value, projection));
    store.mget = async (...batch) => { fullBatches.push(batch); return full(...batch); };
    assert.deepEqual(await readPublicIndexCharacters(store, keys), [{ name: 'Normal', level: 3 }, {}, null, null, null]);
    assert.deepEqual(fullBatches, [[keys[1], keys[2], keys[3]]]);
});

test('admin projection keeps review details and identity but excludes unrelated private save fields', () => {
    const savedBloodlines = [{ id: 'owned', image: '/owner.webp', lore: 'lore', jutsus: [{ id: 'jutsu', tags: ['effect'] }] }];
    assert.deepEqual(projectKvValue({ character: { name: 'Fixture', level: 30, village: 'Stormveil', specialty: 'Genjutsu', ryo: 200 },
        savedBloodlines, creatorEvents: ['large content'], missionProgress: { mission: 1 } }, ADMIN_PLAYER_SAVE_PROJECTION),
    { name: 'Fixture', level: 30, village: 'Stormveil', specialty: 'Genjutsu', savedBloodlines });
});

import assert from 'node:assert/strict';
import { projectKvValue } from '../api/_storage-projection.ts';

// Synthetic byte accounting only: this does not connect to a database or claim
// production latency. Keep the fixture explicit so its result is reproducible.
const save = {
    _saveVersion: 4, _saveAt: 1_000, worldGeoV: 2, currentSector: 40,
    character: {
        name: 'ProjectionNinja', level: 40, village: 'Stormveil Village',
        inventory: Array.from({ length: 200 }, (_, i) => `item-${i}`),
        pets: [], hp: 300, maxHp: 500,
    },
    savedBloodlines: [{ id: 'demo', name: 'Demo Bloodline', jutsus: [], rank: 'B Rank' }],
    savedImages: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`item:${i}`, `/images/items/item-${i}.webp`])),
    creatorEvents: Array.from({ length: 20 }, (_, i) => ({ id: `scene-${i}`, text: 'Authored scene dialogue. '.repeat(100) })),
};
const gallery = projectKvValue(save, { ownerName: ['character', 'name'], savedBloodlines: ['savedBloodlines'] });
const roster = projectKvValue(save, {
    character: ['character'], currentSector: ['currentSector'], currentBiome: ['currentBiome'],
    pendingTravel: ['pendingTravel'], worldGeoV: ['worldGeoV'], _saveAt: ['_saveAt'], _regenAt: ['_regenAt'],
});
assert.deepEqual(gallery, { ownerName: save.character.name, savedBloodlines: save.savedBloodlines });
assert.deepEqual(roster.character, save.character);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
console.log(JSON.stringify({
    fixture: 'one synthetic authored player save; database-to-server JSON value bytes',
    fullSaveBytes: bytes(save), galleryProjectionBytes: bytes(gallery), rosterProjectionBytes: bytes(roster),
    note: 'Endpoint response bytes are unchanged; production savings depend on actual save contents.',
}, null, 2));

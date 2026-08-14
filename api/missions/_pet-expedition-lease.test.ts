import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { petExpeditionSealForToken } from './_pet-expedition-lease.js';

const character = {
    profession: 'petTamer',
    pets: [{
        id: 'pet-1', level: 30, maxLevel: 100,
        expedition: {
            type: 'scout', token: 'token123', startedAt: 1_000, endsAt: 2_701_000, durationMs: 2_700_000,
            serverSeal: { petLevel: 30, expRewardMult: 1.2, expMaterialMult: 1.1, rewardScale: 1, tamer: true },
        },
    }],
};

test('saved expedition seal survives cache loss only for its exact lease token', () => {
    assert.deepEqual(petExpeditionSealForToken(character, 'token123', 'Player'), {
        playerName: 'Player', petId: 'pet-1', expType: 'scout', durationMinutes: 45, petLevel: 30,
        endsAt: 2_701_000, expRewardMult: 1.2, expMaterialMult: 1.1, rewardScale: 1, tamer: true,
    });
    assert.equal(petExpeditionSealForToken(character, 'newerToken', 'Player'), null);
});

test('legacy protected leases recover conservatively and malformed leases do not', () => {
    const legacy = structuredClone(character);
    delete (legacy.pets[0].expedition as Record<string, unknown>).serverSeal;
    assert.equal(petExpeditionSealForToken(legacy, 'token123', 'Player')?.expRewardMult, 1);
    legacy.pets[0].expedition.endsAt = legacy.pets[0].expedition.startedAt;
    assert.equal(petExpeditionSealForToken(legacy, 'token123', 'Player'), null);
});

test('start persists fallback authority and settlement rechecks the exact saved token', () => {
    const start = readFileSync(join(process.cwd(), 'api', 'missions', 'expedition-start.ts'), 'utf8');
    const report = readFileSync(join(process.cwd(), 'api', 'missions', 'report-pet-event.ts'), 'utf8');
    assert.match(start, /serverSeal: \{[\s\S]*petLevel: sealedPetLevel/);
    assert.match(start, /expeditionStartAllowance: \{ date: today, count: startedToday \+ 1 \}/);
    assert.match(report, /lease\.token !== expeditionReceipt/);
    assert.match(report, /character: current\?\.character \?\? null/);
});

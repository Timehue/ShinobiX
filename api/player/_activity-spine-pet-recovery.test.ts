import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShowdownSession } from '../_pet-showdown/engine.js';
import { discoverActivityPetRecovery } from './_activity-spine-pet-recovery.js';

const SESSION_ID = 'abcdef1234567890';
const character = { petShowdownAdmission: { sessionId: SESSION_ID } };
const readers = (session: Partial<ShowdownSession> | null) => ({
    readSession: async (playerName: string, sessionId: string) => {
        assert.equal(playerName, 'rin');
        assert.equal(sessionId, SESSION_ID);
        return session as ShowdownSession | null;
    },
});

test('a live paid Coliseum bout surfaces a resume card', async () => {
    const recovery = await discoverActivityPetRecovery('Rin', character,
        readers({ playerName: 'rin', rewardEligible: true, finished: false }));
    assert.deepEqual(recovery, {
        title: 'Resume your Pet Coliseum bout',
        screen: 'petColiseum',
        runtimeModeId: 'pet-coliseum',
        context: 'companions',
    });
});

test('finished, practice, foreign, expired or missing sessions surface nothing', async () => {
    for (const session of [
        { playerName: 'rin', rewardEligible: true, finished: true },
        { playerName: 'rin', rewardEligible: false, finished: false },
        { playerName: 'mira', rewardEligible: true, finished: false },
        null,
    ]) {
        assert.equal(await discoverActivityPetRecovery('Rin', character, readers(session)), null);
    }
    assert.equal(await discoverActivityPetRecovery('Rin', {}, readers(null)), null, 'no admission pointer, no read');
});

test('a storage failure propagates instead of hiding a live fight', async () => {
    await assert.rejects(discoverActivityPetRecovery('Rin', character, {
        readSession: async () => { throw new Error('storage down'); },
    }), /storage down/);
});

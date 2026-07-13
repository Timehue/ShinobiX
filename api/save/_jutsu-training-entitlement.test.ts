import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

test('generic saves cannot forge a refundable jutsu-training descriptor or erase action receipts', () => {
    const stored = {
        character: { ryo: 5000, redeemedJutsuTrainingActions: [{ requestId: 'server-request-123', action: 'start' }] },
        activeJutsuTraining: { serverToken: 'server-token', jutsuId: 'fireball', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: 1, endsAt: 2 },
    };
    const incoming = {
        character: { ryo: 5000, redeemedJutsuTrainingActions: [] },
        activeJutsuTraining: { serverToken: 'forged', jutsuId: 'fireball', fromLevel: 1, toLevel: 2, ryoCost: 999999, startedAt: 1, endsAt: 2 },
    };
    const out = sanitizeCharacterSave(incoming, stored) as Record<string, any>;
    assert.deepEqual(out.activeJutsuTraining, stored.activeJutsuTraining);
    assert.deepEqual(out.character.redeemedJutsuTrainingActions, stored.character.redeemedJutsuTrainingActions);
});

test('generic saves cannot forge jutsu mastery levels or XP', () => {
    const stored = { character: { jutsuMastery: [{ jutsuId: 'fireball', level: 3, xp: 40 }] } };
    const incoming = { character: { jutsuMastery: [{ jutsuId: 'fireball', level: 50, xp: 999999 }, { jutsuId: 'forged', level: 50, xp: 999999 }] } };
    const out = sanitizeCharacterSave(incoming, stored) as Record<string, any>;
    assert.deepEqual(out.character.jutsuMastery, stored.character.jutsuMastery);
});

test('first save can only seed normalized level-one mastery rows', () => {
    const out = sanitizeCharacterSave({ character: { jutsuMastery: [{ jutsuId: 'Starter-Fire-1', level: 50, xp: 999999 }] } }, null) as Record<string, any>;
    assert.deepEqual(out.character.jutsuMastery, [{ jutsuId: 'starter-fire-1', level: 1, xp: 0 }]);
});

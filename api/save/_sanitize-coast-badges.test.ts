import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { COAST_ROUND_ACHIEVEMENT_IDS, eligibleAchievementIds } from '../achievements/_catalog.js';

// character.coastBadges proves the twenty coast Rounds achievements, and each
// one pays ryo. Only the quest-line claim writes it (api/quests/_engine.ts), so
// whatever a client save says, the STORED copy wins.

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave({ character: incoming }, existing ? { character: existing } : null).character as Record<string, unknown>;

const FORGED = [...COAST_ROUND_ACHIEVEMENT_IDS];
const EARNED = [COAST_ROUND_ACHIEVEMENT_IDS[0]];

test('coast badges: a forged list with none stored is deleted, on a first save too', () => {
    for (const existing of [{}, null]) {
        const out = sanitize({ coastBadges: FORGED }, existing);
        assert.equal('coastBadges' in out, false);
        assert.deepEqual(eligibleAchievementIds(out).filter(id => id.startsWith('coast-')), [], 'no coast achievement can be claimed from it');
    }
});

test('coast badges: a forged longer list is put back to what the server stored', () => {
    const out = sanitize({ coastBadges: FORGED }, { coastBadges: EARNED });
    assert.deepEqual(out.coastBadges, EARNED);
    assert.deepEqual(eligibleAchievementIds(out).filter(id => id.startsWith('coast-')), EARNED);
});

test('coast badges: a save from a client that has not seen the claim yet cannot drop them', () => {
    assert.deepEqual(sanitize({}, { coastBadges: EARNED }).coastBadges, EARNED);
    assert.deepEqual(sanitize({ coastBadges: [] }, { coastBadges: EARNED }).coastBadges, EARNED);
});

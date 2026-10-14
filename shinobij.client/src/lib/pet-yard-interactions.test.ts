import assert from 'node:assert/strict';
import test from 'node:test';
import { petCareReaction, petCareReactionKind, petCollarPreviewColor } from './pet-yard-interactions';
import { petCollars } from '../data/pet-config';

test('care cues require the committed action or a settled training receipt', () => {
    assert.equal(petCareReactionKind('pet'), 'pet');
    assert.equal(petCareReactionKind('feed'), 'feed');
    assert.equal(petCareReactionKind('complete-training'), null);
    assert.equal(petCareReactionKind('complete-training', 'strength'), 'training');
    assert.equal(petCareReactionKind('start-training', 'strength'), 'training');
    for (const action of ['equip', 'ranked-build', 'nickname', 'release']) assert.equal(petCareReactionKind(action), null);
});
test('care phrases settle to idle and never schedule an indefinite reaction', () => {
    for (const kind of ['pet', 'feed', 'training'] as const) {
        assert.equal(petCareReaction(kind, 0).active, true);
        for (const age of [-1, 3, Infinity, NaN]) {
            assert.deepEqual(petCareReaction(kind, age), { active: false, motion: 'idle', victorious: false });
        }
    }
    assert.equal(petCareReaction('training', .5).victorious, true);
    assert.equal(petCareReaction('feed', .5).motion, 'rest');
});
test('every catalog collar produces a Three-compatible color without discarded-alpha warnings', () => {
    for (const collar of petCollars) assert.match(petCollarPreviewColor(collar.glow), /^#[0-9a-f]{6}$/);
    assert.equal(petCollarPreviewColor('rgba(248, 113, 113, 0.95)'), '#f87171');
    assert.equal(petCollarPreviewColor('legacy'), '#facc15');
});

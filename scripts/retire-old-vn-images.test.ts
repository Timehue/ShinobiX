import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, plannedSlots, RETIRED_AVATAR_SLOTS } from './retire-old-vn-images.mts';
import { RETIRED_VN_ART } from '../shinobij.client/src/lib/vn-retired-artwork.ts';

test('only bytes that still equal a retired hash are deleted; newer uploads and missing slots are left alone', () => {
    const expected = new Set(['aaa']);
    assert.equal(classify(expected, { status: 200, sha: 'aaa' }), 'retire');
    assert.equal(classify(expected, { status: 200, sha: 'bbb' }), 'keep-newer-upload');
    assert.equal(classify(expected, { status: 404 }), 'already-gone');
    assert.equal(classify(expected, { status: 503 }), 'unreadable');
});

test('the plan covers every retired slot plus the four draft avatars, and avatars only match retired bytes', () => {
    const plan = plannedSlots();
    assert.equal(plan.length, Object.keys(RETIRED_VN_ART).length + RETIRED_AVATAR_SLOTS.length);
    const avatar = plan.find(p => p.slot === 'event:builtin-awakening-lv2:avatar')!;
    assert.ok([...avatar.expected].every(sha => Object.values(RETIRED_VN_ART).includes(sha)));
    assert.ok(plan.every(p => /^(?:vn|event):/.test(p.slot)), 'never targets non-VN image categories');
});

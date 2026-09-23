import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSealAttempt, sealCount } from './_wild-binding-seal.js';

const id = 'beast-seal-reinforced';

test('each successful or failed binding attempt consumes exactly one seal', () => {
    const initial = { inventory: [id, 'keepsake'], itemStacks: [{ itemId: id, count: 2 }] };
    assert.equal(sealCount(initial, id), 3);

    const failed = resolveSealAttempt(initial, id, 25, () => 0.9);
    assert.equal(failed?.success, false);
    assert.equal(sealCount(failed!.character, id), 2);
    assert.deepEqual(failed!.character.itemStacks, [{ itemId: id, count: 1 }]);

    const caught = resolveSealAttempt(failed!.character, id, 25, () => 0.1);
    assert.equal(caught?.success, true);
    assert.equal(sealCount(caught!.character, id), 1);
    assert.deepEqual(caught!.character.itemStacks, []);

    const legacy = resolveSealAttempt(caught!.character, id, 25, () => 0.9);
    assert.equal(legacy?.success, false);
    assert.equal(sealCount(legacy!.character, id), 0);
    assert.deepEqual(legacy!.character.inventory, ['keepsake']);

    let rolled = false;
    assert.equal(resolveSealAttempt(legacy!.character, id, 25, () => { rolled = true; return 0; }), null);
    assert.equal(rolled, false);
    assert.equal(sealCount(initial, id), 3, 'the original save remains unchanged');
});

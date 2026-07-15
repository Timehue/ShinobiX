import assert from 'node:assert/strict';
import test from 'node:test';
import { safeLogValue } from './_safe-log.js';

test('safeLogValue keeps request data on one bounded physical line', () => {
    assert.equal(safeLogValue('203.0.113.4\r\n[admin] forged'), '203.0.113.4??[admin] forged');
    assert.equal(safeLogValue('ok\u001b[31mred'), 'ok?[31mred');
    assert.equal(safeLogValue('abcdef', 4), 'abcd');
});

test('safeLogValue handles non-string and invalid bound values deterministically', () => {
    assert.equal(safeLogValue(undefined), '');
    assert.equal(safeLogValue(42), '42');
    assert.equal(safeLogValue('value', 0), 'value');
});

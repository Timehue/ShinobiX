import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual } from './_auth.js';

test('safeEqual matches only identical strings, whatever their lengths', () => {
    assert.equal(safeEqual('correct horse', 'correct horse'), true);
    assert.equal(safeEqual('correct horse', 'correct hors'), false, 'a prefix is not a match');
    assert.equal(safeEqual('correct hors', 'correct horse'), false);
    assert.equal(safeEqual('abc', 'abc\u0000'), false, 'zero padding never makes unequal lengths equal');
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual('', 'x'), false);
    assert.equal(safeEqual('ünïcødé', 'ünïcødé'), true);
    assert.equal(safeEqual('ünïcødé', 'unicode'), false);
});

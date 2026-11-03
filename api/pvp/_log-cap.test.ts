import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PVP_LOG_MAX_LINES, trimPvpLog } from './session.js';

test('a 15-round fight of busy rounds keeps every line', () => {
    const log = Array.from({ length: 15 * 20 }, (_, i) => `line ${i}`);
    assert.deepEqual(trimPvpLog(log), log);
});

test('a log over the cap keeps the newest lines behind one trim notice', () => {
    const log = Array.from({ length: PVP_LOG_MAX_LINES + 5 }, (_, i) => `line ${i}`);
    const trimmed = trimPvpLog(log);
    assert.equal(trimmed.length, PVP_LOG_MAX_LINES);
    assert.equal(trimmed[0], '… (6 earlier lines trimmed)');
    assert.equal(trimmed[1], 'line 6');
    assert.equal(trimmed.at(-1), log.at(-1));
});

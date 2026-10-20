import assert from 'node:assert/strict';
import test from 'node:test';
import { clanBossResult } from './clan-boss-result';

test('a team clear with remaining clan health records contribution without claiming the campaign is won', () => {
    const result = clanBossResult({ ok: true, pool: 500000, killed: false });
    assert.equal(result.confirmed, true);
    assert.equal(result.defeated, false);
    assert.match(result.detail, /500,000 HP/);
});
test('a replayed depleted pool confirms the clan victory without inventing a new reward', () => {
    assert.equal(clanBossResult({ ok: true, alreadySettled: true, pool: 0 }).defeated, true);
    assert.match(clanBossResult({ ok: true, pool: 0 }).detail, /clan has defeated/);
});
test('a refused, pending or malformed receipt never claims contribution was saved', () => {
    for (const receipt of [undefined, {}, { ok: true }, { ok: true, pool: NaN }, { ok: true, pool: -1 }, { error: 'That assault has expired.' }]) {
        assert.equal(clanBossResult(receipt).confirmed, false);
        assert.equal(clanBossResult(receipt).defeated, false);
        assert.doesNotMatch(clanBossResult(receipt).detail, /Contribution saved/);
    }
    assert.equal(clanBossResult({ error: 'That assault has expired.' }).detail, 'That assault has expired.');
});

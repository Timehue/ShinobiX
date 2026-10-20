import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAN_BOSS_V2_START, clanBossRules, newClanBossWeekTiming } from '../../shared/clan-boss-rules.js';
import { newClanBossProgress, reserveAttemptForRequest, clanBossAttemptsLeft } from './_storage.js';

const week = (version?: 1 | 2) => ({ weekId: '2026-W44', bossId: 'oni-warlord', spawnedAt: CLAN_BOSS_V2_START,
    endsAt: CLAN_BOSS_V2_START + 604800000, ...(version ? { rulesVersion: version } : {}) });
const receipt = (i: number, party: string[], host = party[0]!) => ({ requestId: `request-${i}`, host,
    party, runId: `cboss-${i}`, fingerprint: 'party', seed: i + 1, bossHp: 72000, at: i });

test('cutover is exactly next Monday UTC; delayed cron retains the canonical expiry', () => {
    const before = newClanBossWeekTiming(CLAN_BOSS_V2_START - 1);
    assert.equal('rulesVersion' in before, false);
    for (const offset of [0, 3 * 3600000, 2 * 86400000]) {
        assert.deepEqual(newClanBossWeekTiming(CLAN_BOSS_V2_START + offset), {
            rulesVersion: 2, spawnedAt: CLAN_BOSS_V2_START, endsAt: CLAN_BOSS_V2_START + 604800000,
        });
    }
});
test('missing versions remain legacy regardless of their dates; existing progress stays unchanged', () => {
    const legacy = newClanBossProgress('Legacy', week(), 20);
    assert.equal(legacy.poolMax, 174000);
    assert.equal(clanBossRules(legacy.rulesVersion).assaultHp, 24000);
    const next = newClanBossProgress('New', week(2), 20);
    assert.equal(next.poolMax, 528000);
    assert.equal(clanBossRules(next.rulesVersion).assaultHp, 72000);
    const original = { ...legacy, pool: 123456, memberAttempts: { a: 4 }, participants: ['a'], killedAt: 42 };
    const copy = structuredClone(original);
    clanBossRules(original.rulesVersion);
    assert.deepEqual(original, copy, 'reading the new rules cannot rewrite earned progress');
});
for (const size of [1, 2, 3, 4]) test(`v2 charges ${size} unique participants, replay is free`, () => {
    const party = Array.from({ length: size }, (_, i) => `hero${i}`);
    const p = newClanBossProgress('New', week(2), 20);
    const first = reserveAttemptForRequest(p, receipt(size, [...party, party[0]!]));
    assert.ok(first.ok);
    assert.deepEqual(first.progress.memberAttempts, Object.fromEntries(party.map(slug => [slug, 1])));
    const replay = reserveAttemptForRequest(first.progress, receipt(size, [...party, party[0]!]));
    assert.ok(replay.ok && replay.replayed);
    assert.deepEqual(replay.progress, first.progress);
});
test('rotating hosts gives the same trio exactly five joint assaults', () => {
    const party = ['a', 'b', 'c'];
    let p = newClanBossProgress('New', week(2), 20);
    for (let i = 0; i < 5; i++) {
        const next = reserveAttemptForRequest(p, receipt(i, party, party[i % 3]!));
        assert.ok(next.ok); p = next.progress;
    }
    assert.deepEqual(p.memberAttempts, { a: 5, b: 5, c: 5 });
    const denied = reserveAttemptForRequest(p, receipt(9, party, 'b'));
    assert.ok(!denied.ok);
    assert.deepEqual(denied.exhausted?.sort(), party);
    assert.equal(clanBossAttemptsLeft(p, 'c'), 0);
    const replay = reserveAttemptForRequest(p, receipt(0, party));
    assert.ok(replay.ok && replay.replayed, 'exhaustion does not obstruct an existing paid request');
});
test('an exhausted ally fails atomically without charging a fresh host', () => {
    const p = newClanBossProgress('New', week(2), 20);
    p.memberAttempts.ally = 5;
    const copy = structuredClone(p);
    const denied = reserveAttemptForRequest(p, receipt(1, ['host', 'ally']));
    assert.ok(!denied.ok);
    assert.deepEqual(denied.exhausted, ['ally']);
    assert.deepEqual(p, copy);
});
test('legacy reservations retain host-only attempts and allow exhausted allies', () => {
    const p = newClanBossProgress('Legacy', week(), 20);
    p.memberAttempts.ally = 5;
    const next = reserveAttemptForRequest(p, receipt(1, ['host', 'ally']));
    assert.ok(next.ok);
    assert.deepEqual(next.progress.memberAttempts, { ally: 5, host: 1 });
    assert.equal(next.progress.poolMax, 174000);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyOfflineNotices,
    buildOfflineNoticeDigest,
    offlineNoticeDigestLines,
    offlineNoticeMessage,
    parseOfflineNotices,
} from './offline-notices';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('parseOfflineNotices drops non-arrays and malformed entries', () => {
    assert.deepEqual(parseOfflineNotices(undefined), []);
    assert.deepEqual(parseOfflineNotices('nope'), []);
    assert.deepEqual(parseOfflineNotices([{ kind: 'other', by: 'x', sector: 1 }, { by: 'x' }]), []);
    assert.equal(parseOfflineNotices([{ kind: 'sleeper-kill', by: 'Raiden', sector: 17, at: 1 }]).length, 1);
});

test('offlineNoticeMessage names the attacker and the sector', () => {
    assert.equal(
        offlineNoticeMessage({ kind: 'sleeper-kill', by: 'Raiden', sector: 17, at: 1 }),
        '⚔️ While you slept in Sector 17, Raiden ambushed your camp. You were carried to the hospital.',
    );
    assert.equal(
        offlineNoticeMessage({ kind: 'merc-raid', by: 'Frostfang mercenaries', village: 'Frostfang', sector: 9, at: 1 }),
        '⚔️ Frostfang mercenaries raided your camp in Sector 9 while you were away. You were carried to the hospital.',
    );
});

test('the emoji vocabulary has no near-duplicates', () => {
    // `☠` (bounty collected) and `⚔️` (camp ambush) used to be two different
    // marks for "you were killed". One glyph per family now.
    const icon = (m: string) => m.split(' ')[0];
    assert.equal(icon(offlineNoticeMessage({ kind: 'sleeper-kill', by: 'A', sector: 1, at: 1 })), '⚔️');
    assert.equal(icon(offlineNoticeMessage({ kind: 'merc-raid', by: 'A', sector: 1, at: 1 })), '⚔️');
    assert.equal(icon(offlineNoticeMessage({ kind: 'bounty-placed', by: 'A', sector: 0, at: 1, amount: 1 })), '💰');
    assert.equal(icon(offlineNoticeMessage({ kind: 'bounty-claimed', by: 'A', sector: 0, at: 1, amount: 1 })), '💰');
    assert.equal(icon(offlineNoticeMessage({ kind: 'kage-seat-lost', by: 'inactivity', sector: 0, at: 1 })), '👑');
    assert.equal(icon(offlineNoticeMessage({ kind: 'kage-challenge-refunded', by: 'x', sector: 0, at: 1 })), '👑');
    assert.equal(icon(offlineNoticeMessage({ kind: 'village-unfed', by: 'V', sector: 3, at: 1 })), '🍚');
});

test('applyOfflineNotices shows ONE digest for the whole inbox', () => {
    // THE REGRESSION THIS EXISTS FOR: the inbox caps at ten and each notice used
    // to fire its own alert(), which GameAlert queues one-behind-another — a
    // player back from a week away clicked OK ten times before they could move.
    const shown: string[] = [];
    const inbox = Array.from({ length: 10 }, (_, i) => ({
        kind: 'sleeper-kill' as const, by: `Raider${i}`, sector: 10 + i, at: NOW - i * HOUR,
    }));
    const n = applyOfflineNotices(inbox, (m) => shown.push(m));
    assert.equal(n, 10, 'every notice is still accounted for');
    assert.equal(shown.length, 1, 'but the player is interrupted exactly once');
    for (const r of inbox) assert.ok(shown[0].includes(r.by), `${r.by} appears in the digest`);
    assert.match(shown[0], /^While you were away — Ten reports were waiting when you returned\./);
});

test('applyOfflineNotices ignores junk and an empty inbox', () => {
    const shown: string[] = [];
    const n = applyOfflineNotices(
        [
            { kind: 'merc-raid', by: 'Frostfang mercenaries', sector: 9, at: NOW - 2 * DAY },
            'junk',
            { kind: 'sleeper-kill', by: 'Raiden', sector: 17, at: NOW - HOUR },
        ],
        (m) => shown.push(m),
    );
    assert.equal(n, 2);
    assert.equal(shown.length, 1);
    assert.equal(applyOfflineNotices(null, (m) => shown.push(m)), 0);
    assert.equal(applyOfflineNotices([], (m) => shown.push(m)), 0);
    assert.equal(shown.length, 1, 'an empty inbox never opens a modal');
});

test('the digest sorts the actionable notice first, then newest first', () => {
    const digest = buildOfflineNoticeDigest([
        { kind: 'sleeper-kill', by: 'Oldest', sector: 1, at: NOW - 6 * DAY },
        { kind: 'bounty-claimed', by: 'Newest', sector: 0, at: NOW - 5 * MIN, amount: 12000 },
        // Queued in the middle, but it is the one that asks something of the
        // player, so it must be the first thing they read.
        { kind: 'village-unfed', by: 'Moonshadow Village', village: 'Moonshadow Village', sector: 12, at: NOW - 2 * DAY },
        { kind: 'merc-raid', by: 'Frostfang mercenaries', sector: 9, at: NOW - 3 * HOUR },
    ], NOW);
    assert.deepEqual(digest.entries.map((e) => e.kind), ['village-unfed', 'bounty-claimed', 'merc-raid', 'sleeper-kill']);
    assert.equal(digest.entries[0].actionable, true);
    assert.deepEqual(digest.entries.slice(1).map((e) => e.actionable), [false, false, false]);
    assert.equal(digest.title, 'While you were away');
    assert.equal(digest.subtitle, 'Four reports were waiting when you returned.');
});

test('every digest line is stamped with a relative time', () => {
    const lines = offlineNoticeDigestLines(buildOfflineNoticeDigest([
        { kind: 'sleeper-kill', by: 'Raiden', sector: 12, at: NOW - 2 * DAY },
        { kind: 'bounty-claimed', by: 'Kenji', sector: 0, at: NOW - 3 * HOUR, amount: 12000 },
        { kind: 'merc-raid', by: 'Frostfang mercenaries', sector: 9, at: NOW - 45 * MIN },
        { kind: 'bounty-placed', by: 'Rill', sector: 0, at: NOW - 20_000, amount: 5000, total: 12000 },
    ], NOW));
    assert.equal(lines[0], '💰 just now — Rill put 5,000 ryo on your head (total 12,000). You\'re on the bounty board.');
    assert.equal(lines[1], '⚔️ 45m ago — Frostfang mercenaries raided your camp in Sector 9 while you were away. You were carried to the hospital.');
    assert.equal(lines[2], '💰 3h ago — Kenji collected the 12,000-ryo bounty on you.');
    assert.equal(lines[3], '⚔️ 2d ago — While you slept in Sector 12, Raiden ambushed your camp. You were carried to the hospital.');
});

test('a notice with no usable stamp still renders, without a time prefix', () => {
    const [line] = offlineNoticeDigestLines(buildOfflineNoticeDigest(
        [{ kind: 'sleeper-kill', by: 'Raiden', sector: 4 }],
        NOW,
    ));
    assert.equal(line, '⚔️ While you slept in Sector 4, Raiden ambushed your camp. You were carried to the hospital.');
});

test('a single notice reads as one report, not "1 reports"', () => {
    const digest = buildOfflineNoticeDigest([{ kind: 'sleeper-kill', by: 'Raiden', sector: 4, at: NOW }], NOW);
    assert.equal(digest.subtitle, 'One report was waiting when you returned.');
});

test('bounty notices: placed + claimed copy', () => {
    assert.equal(
        offlineNoticeMessage({ kind: 'bounty-placed', by: 'Rill', sector: 0, at: 1, amount: 5000, total: 12000 }),
        "💰 Rill put 5,000 ryo on your head (total 12,000). You're on the bounty board.",
    );
    assert.equal(
        offlineNoticeMessage({ kind: 'bounty-claimed', by: 'Kenji', sector: 0, at: 1, amount: 12000 }),
        '💰 Kenji collected the 12,000-ryo bounty on you.',
    );
    // total never reads below the stake itself
    assert.match(offlineNoticeMessage({ kind: 'bounty-placed', by: 'Rill', sector: 0, at: 1, amount: 5000 }), /total 5,000/);
    assert.equal(parseOfflineNotices([{ kind: 'bounty-placed', by: 'Rill', sector: 0, at: 1, amount: 5000 }]).length, 1);
});

test('kage-seat-lost states the absence, the tenure, and the way back', () => {
    assert.equal(parseOfflineNotices([{ kind: 'kage-seat-lost', by: 'inactivity', village: 'Moonshadow Village', sector: 0, at: 1 }]).length, 1);
    assert.equal(
        offlineNoticeMessage({ kind: 'kage-seat-lost', by: 'inactivity', village: 'Moonshadow Village', sector: 0, at: 1, tenureMs: 41 * DAY }),
        '👑 Ten days passed without word from you, and the Moonshadow Village council declared the seat open. Your tenure lasted 41 days. The seat can be won back.',
    );
    // BACKWARD COMPATIBILITY: a notice queued before `tenureMs` existed is still
    // valid — it just drops the tenure sentence rather than claiming "0 days".
    assert.equal(
        offlineNoticeMessage({ kind: 'kage-seat-lost', by: 'inactivity', village: 'Moonshadow Village', sector: 0, at: 1 }),
        '👑 Ten days passed without word from you, and the Moonshadow Village council declared the seat open. The seat can be won back.',
    );
    assert.match(
        offlineNoticeMessage({ kind: 'kage-seat-lost', by: 'inactivity', sector: 0, at: 1, tenureMs: 5 * HOUR }),
        /the village council declared the seat open\. Your tenure lasted 5 hours\./,
    );
});

test('kage-challenge-refunded notice names the village and the refund', () => {
    assert.equal(
        offlineNoticeMessage({ kind: 'kage-challenge-refunded', by: 'inactivity', village: 'Moonshadow Village', sector: 0, at: 1, amount: 250000 }),
        '👑 Your Kage challenge in Moonshadow Village was cancelled — the Kage went absent. Your stake was refunded.',
    );
});

test('village-unfed notice names the village, the sector, and where to fix it', () => {
    assert.equal(parseOfflineNotices([{ kind: 'village-unfed', by: 'Moonshadow Village', village: 'Moonshadow Village', sector: 12, at: 1 }]).length, 1);
    assert.equal(
        offlineNoticeMessage({ kind: 'village-unfed', by: 'Moonshadow Village', village: 'Moonshadow Village', sector: 12, at: 1 }),
        '🍚 Moonshadow Village marched hungry: the siege of Sector 12 went unfed. Cook rations at the Cafeteria and donate them at the Town Hall.',
    );
    // `village` missing → falls back to `by` (the server stamps the village name there)
    assert.match(offlineNoticeMessage({ kind: 'village-unfed', by: 'Frostfang Village', sector: 3, at: 1 }), /^🍚 Frostfang Village marched hungry: the siege of Sector 3/);
});

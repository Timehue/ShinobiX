process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { kv } from './_storage.js';
import { TEXT_LIMITS } from './_text-moderation.js';
import { validateVillageStateWrite } from './_village-state-validate.js';

// The village treasury is server-owned. Items arrive through the atomic
// /api/village/treasury/donate endpoint (audit #16) and leave through
// /api/village/treasury/transfer; currencies and the stores move only through
// their endpoints (#17). A non-admin save blob may only RE-ASSERT the treasury:
// it cannot raise it (a mint) or lower it (a stale re-assert that would erase a
// donation made after the client's last poll).
//
// Treasury-only writes with kageState=null exercise no IO. A member's new
// activity line (`notices`) reads the caller's silence record, so the store is
// the in-memory QA backend.

const villager = { callerName: 'rin', isAdmin: false, village: 'Leaf' };
const admin = { callerName: '', isAdmin: true, village: 'Leaf' };

function stateWith(items: unknown, currency: Record<string, number> = {}) {
    return { treasury: { ...currency, items } };
}
function items(next: { treasury?: Record<string, unknown> }) {
    return (next.treasury as Record<string, unknown>).items;
}

describe('validateVillageStateWrite — treasury.items lockdown (#16)', () => {
    it('allows a verbatim re-assert of the existing items', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 2 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 2 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });

    it('blocks removing items through the blob (the transfer endpoint moves them)', async () => {
        // A villager whose last poll predates a donation re-asserts a list
        // without it. Accepting that would delete another villager's gift.
        const prev = stateWith([{ itemId: 'ration', count: 2 }, { itemId: 'gift', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 1 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 2 }, { itemId: 'gift', count: 1 }]);
        assert.ok(suppressed.some((s) => s.includes('treasury.items removal [ration,gift]')));
    });

    it('blocks removing items even for the seated Kage', async () => {
        const prev = stateWith([{ itemId: 'gift', count: 1 }]);
        const { next } = await validateVillageStateWrite(prev, stateWith([]), villager, { seatedKage: 'rin' });
        assert.deepEqual(items(next), [{ itemId: 'gift', count: 1 }]);
    });

    it('lets admin remove items (bypass)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([]), admin, null);
        assert.deepEqual(items(next), []);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });

    it('rejects a brand-new itemId (mint) and reverts to prev', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(
            prev,
            stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'forbidden-scroll', count: 1 }]),
            villager,
            null,
        );
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('forbidden-scroll')), true);
    });

    it('rejects raising an existing item count (mint) and reverts', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([{ itemId: 'ration', count: 50 }]), villager, null);
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), true);
    });

    it('lets admin add items (bypass)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await validateVillageStateWrite(
            prev,
            stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]),
            admin,
            null,
        );
        assert.deepEqual(items(next), [{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]);
        assert.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
});

describe('validateVillageStateWrite — currency lockdown (#17, step 1c)', () => {
    const admin = { callerName: '', isAdmin: true, village: 'Leaf' };

    it('blocks a non-admin village-treasury currency increase (credit-without-debit)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1_000_000 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 0); // kept at prev, not credited
        assert.equal(suppressed.some((s) => s.includes('treasury.ryo increase via save blob blocked')), true);
    });

    it('blocks the agenda-style honorSeals increase too (now credited via the endpoint)', async () => {
        const prev = stateWith([], { honorSeals: 0 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { honorSeals: 15 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).honorSeals, 0);
        assert.equal(suppressed.some((s) => s.includes('treasury.honorSeals increase via save blob blocked')), true);
    });

    it('allows a zero-delta re-assert (post-endpoint the client re-saves the credited value)', async () => {
        const prev = stateWith([], { ryo: 1500, honorSeals: 15 });
        const { next, suppressed } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1500, honorSeals: 15 }), villager, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 1500);
        assert.equal(suppressed.some((s) => s.includes('increase via save blob blocked')), false);
    });

    it('allows an admin to increase village currency (admin bypass)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next } = await validateVillageStateWrite(prev, stateWith([], { ryo: 1500 }), admin, null);
        assert.equal((next.treasury as Record<string, number>).ryo, 1500);
    });
});

describe('validateVillageStateWrite — Hollow Gate 30-day timed unlock', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const kage = { seatedKage: 'rin' };               // matches `villager.callerName`
    const notKage = { callerName: 'jin', isAdmin: false, village: 'Leaf' };

    it('requires the paid endpoint even for the seated Kage', async () => {
        const want = Date.now() + 30 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.equal(until, 0);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('rejects a tampered far-future expiry', async () => {
        const want = Date.now() + 3650 * DAY; // ~10 years
        const { next } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: want }, villager, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
    });

    it('does not extend an active window through a generic write', async () => {
        const prevUntil = Date.now() + 10 * DAY;
        const prev = { hollowGateUnlockedUntil: prevUntil };
        const { next } = await validateVillageStateWrite(prev, { hollowGateUnlockedUntil: prevUntil + 30 * DAY }, villager, kage);
        const until = next.hollowGateUnlockedUntil as number;
        assert.equal(until, prevUntil);
    });

    it('blocks a non-Kage from extending (pins to prev)', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, notKage, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('pins an active unlock when a non-admin write tries to lower it (immune to stale clobber)', async () => {
        const prevUntil = Date.now() + 20 * DAY;
        const { next, suppressed } = await validateVillageStateWrite({ hollowGateUnlockedUntil: prevUntil }, { hollowGateUnlockedUntil: 0 }, villager, kage);
        assert.equal(next.hollowGateUnlockedUntil, prevUntil);
        assert.equal(suppressed.some((s) => s.includes('paid unlock endpoint')), true);
    });

    it('lets an admin re-lock early (lower the expiry)', async () => {
        const { next, suppressed } = await validateVillageStateWrite({ hollowGateUnlockedUntil: Date.now() + 20 * DAY }, { hollowGateUnlockedUntil: 0 }, admin, kage);
        assert.equal(next.hollowGateUnlockedUntil, 0);
        assert.equal(suppressed.some((s) => s.includes('decrease')), false);
    });

    it('posts a one-time re-seal notice once the window lapses, then dedupes', async () => {
        const expired = Date.now() - 1000;
        const prev = { hollowGateUnlockedUntil: expired };
        const first = await validateVillageStateWrite(prev, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts1 = (first.next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts1.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
        assert.equal(first.next.hollowGateExpiryNoticedFor, expired);

        // A second write after the marker is set must not post a duplicate.
        const second = await validateVillageStateWrite(first.next, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts2 = (second.next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts2.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
    });

    it('does not post a re-seal notice after a paid reopening', async () => {
        const expired = Date.now() - 1000;
        const paidUntil = Date.now() + 30 * DAY;
        const { next } = await validateVillageStateWrite({ hollowGateUnlockedUntil: paidUntil }, { hollowGateUnlockedUntil: expired }, villager, kage);
        const posts = (next.noticePosts ?? []) as Array<Record<string, unknown>>;
        assert.equal(posts.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 0);
    });
});

// War morale stamps are set ONLY by settleVillageWar and only ever READ by the
// client, so a blob write may not move either one in either direction. They
// used to be guarded one way each, and the loss stamp's guard went stale when
// the stamp turned from a training debuff into the loser's comeback RALLY: an
// increase was then the dangerous direction, and it was accepted.
describe('validateVillageStateWrite — war morale stamps', () => {
    const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
    const DAY = 24 * 60 * 60 * 1000;

    it('blocks a villager EXTENDING the comeback rally (a permanent village-wide boost)', async () => {
        const prev = { warLossDebuffUntil: NOW + DAY };
        const { next, suppressed } = await validateVillageStateWrite(prev, { warLossDebuffUntil: NOW + 365 * DAY }, villager, null);
        assert.equal(next.warLossDebuffUntil, NOW + DAY, 'pinned to the server value');
        assert.ok(suppressed.some((s) => s.includes('warLossDebuffUntil')));
    });

    it('blocks a villager GRANTING a rally the village never earned', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { warLossDebuffUntil: NOW + 365 * DAY }, villager, null);
        assert.equal(next.warLossDebuffUntil, 0);
        assert.ok(suppressed.some((s) => s.includes('warLossDebuffUntil')));
    });

    it('blocks a client EXTENDING its victory stamp', async () => {
        const prev = { warWinBuffUntil: NOW + DAY };
        const { next, suppressed } = await validateVillageStateWrite(prev, { warWinBuffUntil: NOW + 400 * DAY }, villager, null);
        assert.equal(next.warWinBuffUntil, NOW + DAY, 'pinned to the server value');
        assert.ok(suppressed.some((s) => s.includes('warWinBuffUntil')));
    });

    it('blocks a client GRANTING itself a victory stamp it never earned', async () => {
        const { next, suppressed } = await validateVillageStateWrite({}, { warWinBuffUntil: NOW + 30 * DAY }, villager, null);
        assert.equal(next.warWinBuffUntil, 0);
        assert.ok(suppressed.some((s) => s.includes('warWinBuffUntil')));
    });

    it('pins a clear too, and re-asserting the stored value is silent', async () => {
        const prev = { warWinBuffUntil: NOW + DAY, warLossDebuffUntil: NOW + 2 * DAY };
        const cleared = await validateVillageStateWrite(prev, { warWinBuffUntil: 0, warLossDebuffUntil: 0 }, villager, null);
        assert.equal(cleared.next.warWinBuffUntil, NOW + DAY);
        assert.equal(cleared.next.warLossDebuffUntil, NOW + 2 * DAY);
        const same = await validateVillageStateWrite(prev, { ...prev }, villager, null);
        assert.equal(same.next.warWinBuffUntil, NOW + DAY);
        assert.equal(same.suppressed.some((s) => s.includes('warWinBuffUntil') || s.includes('warLossDebuffUntil')), false);
    });

    it('pins the war-spoils settlement receipts like every other server journal', async () => {
        const prev = { warSpoilsReceipts: { 'pair-g1': { side: 'loser', spoils: { ryo: 5, honorSeals: 0, fateShards: 0 }, at: NOW } } };
        const wiped = await validateVillageStateWrite(prev, { warSpoilsReceipts: {} }, villager, null);
        assert.deepEqual(wiped.next.warSpoilsReceipts, prev.warSpoilsReceipts);
        const forged = await validateVillageStateWrite({}, { warSpoilsReceipts: { 'pair-g2': { side: 'winner' } } }, villager, null);
        assert.equal(forged.next.warSpoilsReceipts, undefined);
    });

    it('admin may set either stamp (settlement / support tooling)', async () => {
        const prev = { warWinBuffUntil: NOW, warLossDebuffUntil: NOW + 3 * DAY };
        const { next } = await validateVillageStateWrite(prev, { warWinBuffUntil: NOW + 3 * DAY, warLossDebuffUntil: 0 }, admin, null);
        assert.equal(next.warWinBuffUntil, NOW + 3 * DAY);
        assert.equal(next.warLossDebuffUntil, 0);
    });
});

describe('validateVillageStateWrite - Village Stores (provisions / materialPoints)', () => {
    it('rejects a save-blob INCREASE of either store (keeps prev) for a villager', async () => {
        const prev = { treasury: { provisions: 10, materialPoints: 20 } };
        const { next, suppressed } = await validateVillageStateWrite(prev, { treasury: { provisions: 999, materialPoints: 999 } }, villager, null);
        assert.equal((next.treasury as Record<string, unknown>).provisions, 10);
        assert.equal((next.treasury as Record<string, unknown>).materialPoints, 20);
        assert.ok(suppressed.some((s) => s.includes('treasury.provisions increase')));
        assert.ok(suppressed.some((s) => s.includes('treasury.materialPoints increase')));
    });
    it('rejects a decrease from anyone but admin, the seated Kage included', async () => {
        const prev = { treasury: { provisions: 10, materialPoints: 20 } };
        const kage = { seatedKage: 'rin' };
        const villagerWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0 } }, { ...villager, callerName: 'someone' }, kage);
        assert.equal((villagerWrite.next.treasury as Record<string, unknown>).provisions, 10);
        assert.ok(villagerWrite.suppressed.some((s) => s.includes('treasury.provisions decrease')));
        const kageWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0, materialPoints: 5 } }, villager, kage);
        assert.equal((kageWrite.next.treasury as Record<string, unknown>).provisions, 10);
        assert.equal((kageWrite.next.treasury as Record<string, unknown>).materialPoints, 20);
        assert.ok(kageWrite.suppressed.some((s) => s.includes('treasury.materialPoints decrease')));
        const adminWrite = await validateVillageStateWrite(prev, { treasury: { provisions: 0, materialPoints: 5 } }, admin, kage);
        assert.equal((adminWrite.next.treasury as Record<string, unknown>).provisions, 0);
        assert.equal((adminWrite.next.treasury as Record<string, unknown>).materialPoints, 5);
    });
});

// The seated Kage's Town Hall re-posts the village blob after routine actions
// (a notice, an elder focus, a gift), built from a treasury it POLLED. If a
// villager donated after that poll, the blob is lower than the server — and
// the old seated-Kage withdrawal rule accepted it, erasing the donation.
describe('validateVillageStateWrite - a stale Kage re-assert cannot erase a donation', () => {
    it('keeps every currency, store and item a villager donated after the Kage last polled', async () => {
        const kage = { seatedKage: 'rin' };
        const afterDonation = { treasury: { ryo: 5_000, honorSeals: 201, fateShards: 2, boneCharms: 3, auraStones: 1, mythicSeals: 1, provisions: 41, materialPoints: 435, items: [{ itemId: 'gift', count: 1 }] } };
        const stalePoll = { treasury: { ryo: 1_000, honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, provisions: 1, materialPoints: 15, items: [] } };
        const { next } = await validateVillageStateWrite(afterDonation, { ...stalePoll, notices: ['rin selected the war focus.'] }, villager, kage);
        assert.deepEqual(next.treasury, afterDonation.treasury);
        assert.deepEqual(next.notices, ['rin selected the war focus.'], 'the rest of the write still lands');
    });
});

// The Town Hall activity log (`notices`) is plain lines, newest first. Each
// Town Hall action prepends ONE line and sends the whole list back (cut at 8),
// so a member's write may add one moderated line at the top. It can never
// rewrite, reorder or drop a line that is already stored.
describe('validateVillageStateWrite — notices (Town Hall activity log)', () => {
    const log = [
        'jin donated 500 ryo to the village treasury.',
        'mei joined the Village Guard queue with +2.0% defense.',
        'rin selected the war focus.',
    ];
    const added = 'rin donated 1,000 ryo to the village treasury.';
    const linked = 'rin found free ryo at www.example-scam.com/claim';
    const noticeSuppressions = (suppressed: string[]) => suppressed.filter((s) => s.startsWith('notices'));

    it('lets a member prepend the line their action adds', async () => {
        const { next, suppressed } = await validateVillageStateWrite({ notices: log }, { notices: [added, ...log] }, villager, null);
        assert.deepEqual(next.notices, [added, ...log]);
        assert.deepEqual(noticeSuppressions(suppressed), []);
    });

    it('keeps the stored log when a write leaves notices out or echoes it back', async () => {
        const omitted = await validateVillageStateWrite({ notices: log }, {}, villager, null);
        assert.deepEqual(omitted.next.notices, log);
        const echoed = await validateVillageStateWrite({ notices: log }, { notices: [...log] }, villager, null);
        assert.deepEqual(echoed.next.notices, log);
        assert.deepEqual(noticeSuppressions(echoed.suppressed), []);
        const none = await validateVillageStateWrite({}, {}, villager, null);
        assert.equal('notices' in none.next, false, 'a village with no log does not gain one');
    });

    it('never lets a member rewrite, reorder or drop a stored line', async () => {
        // The most any list can do is put one moderated line above the stored
        // ones, which every member's Town Hall action may do anyway.
        const tampered: string[][] = [
            [],                                                             // clear the log
            [log[0], log[2]],                                               // drop a line
            ['jin donated 5 ryo to the village treasury.', log[1], log[2]], // rewrite one
            [log[1], log[0], log[2]],                                       // reorder
            Array.from({ length: 12 }, (_, i) => `spam ${i}`),              // flood
        ];
        for (const notices of tampered) {
            const { next } = await validateVillageStateWrite({ notices: log }, { notices }, villager, null);
            const out = next.notices as string[];
            assert.ok(out.length <= log.length + 1, `at most one line is added: ${JSON.stringify(out)}`);
            assert.deepEqual(out.slice(out.length - log.length), log, `the stored lines survive, in order: ${JSON.stringify(out)}`);
        }
    });

    it('takes one new line per write and logs what it dropped', async () => {
        const flood = Array.from({ length: 12 }, (_, i) => `spam ${i}`);
        const { next, suppressed } = await validateVillageStateWrite({ notices: log }, { notices: flood }, villager, null);
        assert.deepEqual(next.notices, ['spam 0', ...log]);
        assert.ok(suppressed.some((s) => s.includes('7 line(s) matching nothing stored dropped')), JSON.stringify(suppressed));
    });

    it('adds only its own line for a client whose copy is a write or two stale', async () => {
        // kai's line landed after this client last read the log.
        const stored = ['kai donated 2 honorSeals to the village treasury.', ...log];
        const add = await validateVillageStateWrite({ notices: stored }, { notices: [added, ...log] }, villager, null);
        assert.deepEqual(add.next.notices, [added, ...stored]);
        const echo = await validateVillageStateWrite({ notices: stored }, { notices: [...log] }, villager, null);
        assert.deepEqual(echo.next.notices, stored, 'an echo of the older copy changes nothing');
    });

    it('caps the log at 8, so a full log drops its oldest line', async () => {
        const full = Array.from({ length: 8 }, (_, i) => `line ${8 - i}`); // newest first
        const fresh = await validateVillageStateWrite({ notices: full }, { notices: [added, ...full].slice(0, 8) }, villager, null);
        assert.deepEqual(fresh.next.notices, [added, ...full.slice(0, 7)]);
        // This client read the log before two more lines landed and pushed two
        // of its lines off the end. It still adds only its own line.
        const newer = ['line 10', 'line 9', ...full.slice(0, 6)];
        const stale = await validateVillageStateWrite({ notices: newer }, { notices: [added, ...full].slice(0, 8) }, villager, null);
        assert.deepEqual(stale.next.notices, [added, ...newer.slice(0, 7)]);
    });

    it('records the same line twice when the same action repeats', async () => {
        const repeat = await validateVillageStateWrite({ notices: [added] }, { notices: [added, added] }, villager, null);
        assert.deepEqual(repeat.next.notices, [added, added]);
        const echo = await validateVillageStateWrite({ notices: [added, added] }, { notices: [added, added] }, villager, null);
        assert.deepEqual(echo.next.notices, [added, added], 'an echo of the pair adds nothing');
    });

    it('starts an empty log with the one line the write adds', async () => {
        // With nothing stored, the client shows two placeholder lines and sends
        // them back under its new line. They are not activity, so they stay out.
        const placeholders = ['Town Hall upgrades are open for donation funding.', 'Village Guard queue is accepting defenders.'];
        const { next } = await validateVillageStateWrite({}, { notices: [added, ...placeholders] }, villager, null);
        assert.deepEqual(next.notices, [added]);
    });

    it('moderates the new line and caps its length', async () => {
        const redacted = await validateVillageStateWrite({ notices: log }, { notices: [linked, ...log] }, villager, null);
        const top = (redacted.next.notices as string[])[0];
        assert.match(top, /\[redacted link\]/);
        assert.doesNotMatch(top, /example-scam/);
        const long = await validateVillageStateWrite({ notices: log }, { notices: ['x'.repeat(5_000), ...log] }, villager, null);
        const out = long.next.notices as string[];
        assert.equal(out[0].length, TEXT_LIMITS.villageActivityLine);
        assert.deepEqual(out.slice(1), log);
    });

    it('recognises the writer\'s own unmoderated copy of a line it added', async () => {
        // The writer keeps its raw line until its next read, so its next write
        // sends the raw text where the server stored the moderated one.
        const stored = (await validateVillageStateWrite({ notices: log }, { notices: [linked, ...log] }, villager, null)).next.notices as string[];
        assert.notEqual(stored[0], linked);
        const echo = await validateVillageStateWrite({ notices: stored }, { notices: [linked, ...log] }, villager, null);
        assert.deepEqual(echo.next.notices, stored, 'an echo is not mistaken for a new line');
        const add = await validateVillageStateWrite({ notices: stored }, { notices: [added, linked, ...log] }, villager, null);
        assert.deepEqual(add.next.notices, [added, ...stored]);
        assert.deepEqual(noticeSuppressions(add.suppressed), []);
    });

    it('refuses a new line that is not text or is empty after moderation', async () => {
        for (const head of [42, { text: 'an object' }, '   ']) {
            const { next, suppressed } = await validateVillageStateWrite({ notices: log }, { notices: [head, ...log] as string[] }, villager, null);
            assert.deepEqual(next.notices, log);
            assert.ok(suppressed.includes('notices line rejected (empty after moderation)'), JSON.stringify(suppressed));
        }
    });

    it('refuses a new line from a silenced member, but still takes their echo', async () => {
        await kv.set('mod:silence:rin', { until: Date.now() + 60_000, reason: 'test', by: 'admin', at: Date.now() });
        try {
            const add = await validateVillageStateWrite({ notices: log }, { notices: [added, ...log] }, villager, null);
            assert.deepEqual(add.next.notices, log);
            assert.ok(add.suppressed.includes('notices line rejected (caller silenced)'), JSON.stringify(add.suppressed));
            const echo = await validateVillageStateWrite({ notices: log }, { notices: [...log] }, villager, null);
            assert.deepEqual(echo.next.notices, log);
            assert.deepEqual(noticeSuppressions(echo.suppressed), []);
            const other = await validateVillageStateWrite({ notices: log }, { notices: [added, ...log] }, { ...villager, callerName: 'jin' }, null);
            assert.deepEqual(other.next.notices, [added, ...log], 'the silence is rin\'s alone');
        } finally {
            await kv.del('mod:silence:rin');
        }
    });

    it('refuses a log that is not a list, from an admin too', async () => {
        for (const ctx of [villager, admin]) {
            const { next, suppressed } = await validateVillageStateWrite({ notices: log }, { notices: 'all quiet' as unknown as string[] }, ctx, null);
            assert.deepEqual(next.notices, log);
            assert.ok(suppressed.includes('notices rejected (expected a list of lines)'), JSON.stringify(suppressed));
        }
    });

    it('lets an admin replace the log unmoderated, keeping only text and 8 lines', async () => {
        const replaced = ['Patch notes: https://shinobijourney.com/news', ...Array.from({ length: 9 }, (_, i) => `admin line ${i}`)];
        const { next, suppressed } = await validateVillageStateWrite({ notices: log }, { notices: replaced }, admin, null);
        assert.deepEqual(next.notices, replaced.slice(0, 8));
        assert.deepEqual(noticeSuppressions(suppressed), []);
        const mixed = await validateVillageStateWrite({ notices: log }, { notices: ['kept', 7, null, 'also kept'] as string[] }, admin, null);
        assert.deepEqual(mixed.next.notices, ['kept', 'also kept']);
        const cleared = await validateVillageStateWrite({ notices: log }, { notices: [] }, admin, null);
        assert.deepEqual(cleared.next.notices, []);
    });
});

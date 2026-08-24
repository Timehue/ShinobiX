import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    kageEligibility,
    KAGE_CHALLENGE_RYO_COST,
    KAGE_CHALLENGE_MIN_LEVEL,
    KAGE_CHALLENGE_MIN_MERIT,
    KAGE_MIN_ACCOUNT_AGE_MS,
    kageActivityLines,
} from './kage-challenge-state';
import type { Character } from '../types/character';

/*
 * kageEligibility drives the requirement checklist in the Kage Challenge panel.
 * It is advisory — api/village/_kage-challenge.ts re-enforces every line — but it
 * must not disagree with the server, in either direction. Telling a player they
 * qualify when they do not wastes a declare; telling them they are blocked when
 * the server would accept them costs the challenge outright.
 */

const NOW = 1_760_000_000_000;

const eligible = {
    name: 'Sora',
    level: KAGE_CHALLENGE_MIN_LEVEL,
    ryo: KAGE_CHALLENGE_RYO_COST,
    villageMerit: KAGE_CHALLENGE_MIN_MERIT,
    createdAt: NOW - KAGE_MIN_ACCOUNT_AGE_MS,
} as unknown as Character;

const check = (over: Record<string, unknown>) =>
    kageEligibility({ ...eligible, ...over } as unknown as Character, NOW);
const failing = (over: Record<string, unknown>) => check(over).filter((r) => !r.ok).map((r) => r.label);

describe('kageEligibility', () => {
    it('passes a character sitting exactly on every threshold', () => {
        assert.deepEqual(failing({}), []);
    });

    it('flags each requirement independently, one short of the line', () => {
        assert.equal(failing({ level: KAGE_CHALLENGE_MIN_LEVEL - 1 }).length, 1);
        assert.equal(failing({ ryo: KAGE_CHALLENGE_RYO_COST - 1 }).length, 1);
        assert.equal(failing({ villageMerit: KAGE_CHALLENGE_MIN_MERIT - 1 }).length, 1);
        assert.equal(failing({ createdAt: NOW - KAGE_MIN_ACCOUNT_AGE_MS + 1 }).length, 1);
    });

    it('reads Village Merit, NOT village contribution points', () => {
        // The two are different records and the panel renders both. A save rich in
        // contribution points but short on merit must still read as blocked.
        const blocked = failing({ villageMerit: 0, contributionPoints: 99_999 });
        assert.deepEqual(blocked, [`${KAGE_CHALLENGE_MIN_MERIT} Village Merit`]);
    });

    it('treats a missing createdAt the way the server does — as old enough', () => {
        // api/village/kage-challenge.ts passes num(char.createdAt), which coerces a
        // missing field to 0 and therefore ACCEPTS. Defaulting to `now` here would
        // show an age blocker the server does not apply.
        assert.deepEqual(failing({ createdAt: undefined }), []);
    });

    it('shows the player their own standing, not just the threshold', () => {
        const merit = check({ villageMerit: 12 }).find((r) => r.label.includes('Village Merit'));
        assert.equal(merit?.detail, `12/${KAGE_CHALLENGE_MIN_MERIT}`);
    });

    it('is junk-safe on an empty save', () => {
        const rows = kageEligibility({} as unknown as Character, NOW);
        assert.equal(rows.length, 4);
        assert.ok(rows.every((r) => typeof r.ok === 'boolean'));
    });
});

describe('kageActivityLines (inactivity visibility)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 22);
    it('returns null when there is no seat or no activity stamp', () => {
        assert.equal(kageActivityLines(null, now), null);
        assert.equal(kageActivityLines({ seatedKage: 'A' }, now), null);
        assert.equal(kageActivityLines({ seatedKage: undefined, kageLastActiveAt: now }, now), null);
    });
    it('reports days since last activity with no warning while far from the deadline', () => {
        const lines = kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 2 * DAY, kageInactiveAt: now + 8 * DAY }, now);
        assert.deepEqual(lines, { lastActive: 'The Kage has not been seen in two days.' });
        assert.equal(kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 1000 }, now)?.lastActive, 'The Kage walked the village today.');
        // A log line ("Kage last active 4 days ago") does not belong in the
        // Council register; these are whole sentences, and small counts are words.
        assert.equal(
            kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 4 * DAY, kageInactiveAt: now + 6 * DAY }, now)?.lastActive,
            'The Kage has not been seen in four days.',
        );
        assert.equal(
            kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 1 * DAY, kageInactiveAt: now + 9 * DAY }, now)?.lastActive,
            'The Kage has not been seen since yesterday.',
        );
    });
    it('warns within 3 days of the deadline (and derives the deadline when the server omits it)', () => {
        assert.equal(
            kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 7 * DAY, kageInactiveAt: now + 3 * DAY }, now)?.warning,
            'Should the silence hold, the council opens the seat in three days.',
        );
        assert.equal(
            kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 9 * DAY }, now)?.warning,
            'Should the silence hold, the council opens the seat in one day.',
        );
        assert.equal(
            kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 11 * DAY }, now)?.warning,
            'Should the silence hold, the council opens the seat at the next daily pass.',
        );
        assert.equal(kageActivityLines({ seatedKage: 'A', kageLastActiveAt: now - 6 * DAY }, now)?.warning, undefined);
    });
});

describe('kageEligibility ids (vacant-seat claim filter)', () => {
    const now = Date.UTC(2026, 7, 22);
    // Old enough to clear the account-age gate, so the only open blockers are
    // level, merit — and the ryo the claim must NOT ask for.
    const poor = { level: 12, villageMerit: 4, ryo: 0, createdAt: now - 30 * 24 * 60 * 60 * 1000 } as unknown as Character;

    it('tags every requirement with a stable id', () => {
        assert.deepEqual(kageEligibility(poor, now).map((r) => r.id), ['level', 'account-age', 'ryo', 'merit']);
    });

    it('lets the claim drop the ryo stake WITHOUT matching on the label', () => {
        // The Council Hall used to filter with `!req.label.endsWith("ryo")` — a
        // string test that would silently start demanding 250,000 ryo for a free
        // claim the moment the label or the cost was retuned.
        const blockers = kageEligibility(poor, now).filter((r) => !r.ok && r.id !== 'ryo');
        assert.deepEqual(blockers.map((r) => r.id), ['level', 'merit']);
        assert.ok(blockers.every((r) => !r.label.endsWith('ryo')));
    });

    it('carries the standing the UI shows next to each requirement', () => {
        const rows = kageEligibility(poor, now);
        assert.equal(rows.find((r) => r.id === 'merit')?.detail, `4/${KAGE_CHALLENGE_MIN_MERIT}`);
        assert.equal(rows.find((r) => r.id === 'level')?.detail, 'Lv. 12');
        // "250 Village Merit (4/250)" — label + detail, both present.
        const merit = rows.find((r) => r.id === 'merit')!;
        assert.equal(`${merit.label} (${merit.detail})`, `${KAGE_CHALLENGE_MIN_MERIT} Village Merit (4/${KAGE_CHALLENGE_MIN_MERIT})`);
    });
});

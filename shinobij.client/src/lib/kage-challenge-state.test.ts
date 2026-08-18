import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    kageEligibility,
    KAGE_CHALLENGE_RYO_COST,
    KAGE_CHALLENGE_MIN_LEVEL,
    KAGE_CHALLENGE_MIN_MERIT,
    KAGE_MIN_ACCOUNT_AGE_MS,
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

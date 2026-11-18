import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
    adoptHashedField,
    LEGACY_SHADOWGUARD_SEAT_FIELD_HASH,
    SHADOWGUARD_SEAT_FIELD,
    withShadowguardSeatField,
} from './_shadowguard-seat-field.js';

// The seats' earlier field name is stored only as a hash. These tests drive
// the same mechanism with an invented earlier name ('velmoraSeats').
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const CANARY = sha256('velmoraSeats');

describe('Shadowguard seat field compatibility', () => {
    it('moves a hashed earlier field onto the current field', () => {
        const row = { seatedKage: 'kage', velmoraSeats: ['a', 'b', ''], treasury: { ryo: 5 } };
        assert.deepEqual(adoptHashedField(row, 'seats', CANARY), { seatedKage: 'kage', seats: ['a', 'b', ''], treasury: { ryo: 5 } });
    });

    it('keeps the current field when both are present, and still drops the earlier one', () => {
        const row = { velmoraSeats: ['old', '', ''], seats: ['new', '', ''] };
        assert.deepEqual(adoptHashedField(row, 'seats', CANARY), { seats: ['new', '', ''] });
    });

    it('keeps an explicitly empty current field over the earlier list', () => {
        const row = { velmoraSeats: ['old', '', ''], seats: ['', '', ''] };
        assert.deepEqual(adoptHashedField(row, 'seats', CANARY), { seats: ['', '', ''] });
    });

    it('returns rows without the earlier field, and non-rows, unchanged', () => {
        const row = { seats: ['x', '', ''], other: 1 };
        assert.equal(adoptHashedField(row, 'seats', CANARY), row);
        assert.equal(adoptHashedField(null, 'seats', CANARY), null);
        assert.equal(adoptHashedField(undefined, 'seats', CANARY), undefined);
        assert.equal(withShadowguardSeatField({ [SHADOWGUARD_SEAT_FIELD]: [] })[SHADOWGUARD_SEAT_FIELD].length, 0);
    });

    it('matches the field name exactly, not a look-alike', () => {
        for (const key of ['VelmoraSeats', 'velmoraseats', 'velmoraSeats ', 'velmora_seats']) {
            assert.deepEqual(adoptHashedField({ [key]: ['a'] }, 'seats', CANARY), { [key]: ['a'] }, key);
        }
    });

    it('pins the earlier seat field hash', () => {
        assert.equal(SHADOWGUARD_SEAT_FIELD, 'shadowguardAppointees');
        assert.equal(LEGACY_SHADOWGUARD_SEAT_FIELD_HASH, '275e9266718ca0ad4b5d0b8cbffbd7a23d37fcadc6de432ad0dbba23c4149359');
    });
});

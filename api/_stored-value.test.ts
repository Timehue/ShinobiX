import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import { storedValueEquals } from './_stored-value.js';

/** What a Postgres read hands back for a value that was written as-is. */
const fromPostgres = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test('a written value matches its own Postgres read-back even where a plain deep-equal does not', () => {
    const intended = {
        character: { name: 'Rill', title: undefined, ryo: 500, shield: -0 },
        drift: NaN,
        at: new Date(1_800_000_000_000),
        slots: [undefined, 1],
    };
    const stored = fromPostgres(intended);
    assert.equal(isDeepStrictEqual(stored, intended), false, 'the plain comparison calls this landed write lost');
    assert.equal(storedValueEquals(stored, intended), true);
});

test('a different stored value still does not match', () => {
    assert.equal(storedValueEquals({ ryo: 500 }, { ryo: 501 }), false);
    assert.equal(storedValueEquals({ ryo: 500 }, { ryo: 500, title: 'Genin' }), false);
    assert.equal(storedValueEquals([1, 2], [2, 1]), false, 'arrays keep their order, as jsonb does');
    assert.equal(storedValueEquals(null, { ryo: 500 }), false);
});

test('object key order does not matter, as jsonb reorders keys', () => {
    assert.equal(storedValueEquals({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
});

test('a missing row reads as null', () => {
    assert.equal(storedValueEquals(null, null), true);
    assert.equal(storedValueEquals(undefined, null), true);
});

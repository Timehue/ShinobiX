/*
 * Reset-coverage guard: the full server reset must wipe the story-rebuild
 * keys with the world they belong to. A stale `story:<player>` record would
 * hand a pre-reset player's lane tally and interlude history to whoever
 * re-registers that name; a surviving `hall:nx:kage-first-liberation:*`
 * dedup would make the new era's first liberator seat silently (no
 * announcement, no Hall entry). Protected accounts keep their saves, so
 * they must keep their story records too — wiping one side desyncs them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIPE_PATTERNS, authNamesRequiringRevocation, deleteFirstPactBeforePlayerSaves, deleteResetTargets, isProtectedKey } from './server-reset.js';

test('full reset wipes story records, announcements, and first-only dedup keys', () => {
    for (const pattern of ['story:*', 'first-pact:*', 'game:announcements', 'game:announcements-seq', 'hall:nx:*', 'village:kage:*', 'world:crisis:*', 'pet:showdown:*', 'sd-wcr80:*']) {
        assert.ok(WIPE_PATTERNS.includes(pattern), `WIPE_PATTERNS must include ${pattern}`);
    }
});

test('protected accounts keep save, auth, AND story record together', () => {
    assert.equal(isProtectedKey('save:rill'), true);
    assert.equal(isProtectedKey('auth:rill'), true);
    assert.equal(isProtectedKey('story:rill'), true);
    assert.equal(isProtectedKey('first-pact:rill'), true);
    // Ordinary players are wiped clean across the save and both story stores.
    assert.equal(isProtectedKey('save:someplayer'), false);
    assert.equal(isProtectedKey('story:someplayer'), false);
    assert.equal(isProtectedKey('first-pact:someplayer'), false);
});

test('First Pact reset selection preserves only the reserved account', () => {
    const keys = ['first-pact:rill', 'first-pact:someplayer', 'first-pact:another'];
    assert.deepEqual(keys.filter((key) => !isProtectedKey(key)), [
        'first-pact:someplayer',
        'first-pact:another',
    ]);
});

test('First Pact reset targets compose the serialized account cleanup', async () => {
    const names: string[] = [];
    await deleteResetTargets(
        'first-pact:*',
        ['first-pact:someplayer', 'first-pact:another'],
        async (name) => { names.push(name); return `first-pact:${name}`; },
    );
    assert.deepEqual(names.sort(), ['another', 'someplayer']);
});

test('full reset clears First Pact state before deleting player saves', async () => {
    const calls: string[] = [];
    await deleteFirstPactBeforePlayerSaves(
        ['first-pact:someplayer', 'first-pact:another'],
        ['save:someplayer', 'save:another'],
        async (name) => { calls.push(`pact:${name}`); return `first-pact:${name}`; },
        async (key) => { calls.push(key); },
    );
    assert.deepEqual(calls.slice(0, 2).sort(), ['pact:another', 'pact:someplayer']);
    assert.deepEqual(calls.slice(2).sort(), ['save:another', 'save:someplayer']);
});

test('a First Pact cleanup failure aborts reset before any player save deletion', async () => {
    const deletedSaves: string[] = [];
    await assert.rejects(() => deleteFirstPactBeforePlayerSaves(
        ['first-pact:someplayer'],
        ['save:someplayer'],
        async () => { throw new Error('story lock unavailable'); },
        async (key) => { deletedSaves.push(key); },
    ), /story lock unavailable/);
    assert.deepEqual(deletedSaves, []);
});

test('full reset revokes sessions for deleted auth rows and preserves protected accounts', () => {
    assert.deepEqual(
        authNamesRequiringRevocation(['auth:someplayer', 'auth:Rill', 'save:not-auth', 'auth:another']),
        ['someplayer', 'another'],
    );
    assert.equal(WIPE_PATTERNS.includes('auth-session:*'), false, 'rotated epochs must survive reset');
});

test('full reset wipes every credential that POINTS AT an account, not just auth rows', () => {
    // These live beside `auth:<slug>` rather than under it, so the `auth:*`
    // pattern does not reach them (a LIKE 'auth:%' scan stops at the colon).
    // Each one left behind becomes a credential to whoever claims that name
    // after the wipe — slugs are reusable. Adding a new credential key of this
    // shape without adding it here is the mistake this guard exists to catch.
    for (const pattern of ['auth:*', 'auth-google:*', 'guest-resume:*', 'auth-recovery:*']) {
        assert.ok(WIPE_PATTERNS.includes(pattern), `WIPE_PATTERNS must include ${pattern}`);
    }
    // The one deliberate exception: rotated epochs must OUTLIVE the reset, or a
    // token minted before it would authenticate as the next holder of the name.
    assert.equal(WIPE_PATTERNS.includes('auth-session:*'), false);
});

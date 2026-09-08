import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyClanSuccession, resolveClanSuccession } from './_succession.js';

/*
 * A clan must never be left headless.
 *
 * Before this, `founderName` could only change by admin action, so a founder who
 * left kept the title forever: dissolution, doctrine changes and seal-pool
 * distribution became permanently unreachable for the members still in the clan,
 * which could still hold territory, a treasury and war commitments.
 *
 * The successor is COMPUTED from the roster, never claimed, so there is no race
 * to win and no takeover surface — a member only becomes eligible by outranking
 * or outlasting everyone else.
 */

const member = (name: string, joinedAt?: number) => ({ name, ...(joinedAt ? { joinedAt } : {}) });

const clan = (over: Record<string, unknown> = {}) => ({
    founderName: 'Kaze',
    members: [member('Kaze', 1_000), member('Rin', 2_000), member('Toshi', 3_000)],
    ...over,
});

describe('resolveClanSuccession', () => {
    it('promotes the longest-tenured member when the founder leaves', () => {
        const out = resolveClanSuccession(clan(), 'kaze');
        assert.equal(out.kind, 'succeeded');
        assert.equal(out.kind === 'succeeded' && out.successorSlug, 'rin');
    });

    it('prefers a Leader over a longer-tenured ordinary member', () => {
        const out = resolveClanSuccession(clan({ roleOverrides: { Toshi: 'Leader' } }), 'kaze');
        assert.equal(out.kind === 'succeeded' && out.successorSlug, 'toshi', 'declared leadership outranks tenure');
    });

    it('prefers a Leader over an Officer', () => {
        const out = resolveClanSuccession(
            clan({ roleOverrides: { Rin: 'Officer', Toshi: 'Leader' } }),
            'kaze',
        );
        assert.equal(out.kind === 'succeeded' && out.successorSlug, 'toshi');
    });

    it('still promotes when nobody holds a rank — rank is a preference, not a gate', () => {
        const out = resolveClanSuccession(clan({ roleOverrides: {} }), 'kaze');
        assert.equal(out.kind, 'succeeded', 'a clan of plain members must still get an owner');
    });

    it('leaves ownership alone when a non-founder leaves', () => {
        assert.equal(resolveClanSuccession(clan(), 'rin').kind, 'not-founder');
    });

    it('reports an empty clan rather than inventing a successor', () => {
        const out = resolveClanSuccession(clan({ members: [member('Kaze', 1_000)] }), 'kaze');
        assert.equal(out.kind, 'clan-empty');
    });

    it('is deterministic and idempotent for one roster', () => {
        const rec = clan({ members: [member('Kaze', 1_000), member('Bo'), member('Ai')] });
        const first = resolveClanSuccession(rec, 'kaze');
        for (let i = 0; i < 5; i += 1) {
            assert.deepEqual(resolveClanSuccession(rec, 'kaze'), first, 'the same roster must always name the same successor');
        }
    });

    it('does not let a member with no joinedAt jump the queue', () => {
        // A missing timestamp must not read as "joined at the dawn of time".
        const out = resolveClanSuccession(
            clan({ members: [member('Kaze', 1_000), member('Ghost'), member('Rin', 5_000)] }),
            'kaze',
        );
        assert.equal(out.kind === 'succeeded' && out.successorSlug, 'rin', 'a real tenure beats an unknown one');
    });

    it('matches a role override keyed by display name or by slug', () => {
        const bySlug = resolveClanSuccession(clan({ roleOverrides: { toshi: 'Leader' } }), 'kaze');
        assert.equal(bySlug.kind === 'succeeded' && bySlug.successorSlug, 'toshi');
    });
});

describe('applyClanSuccession', () => {
    it('removes the departing founder and installs the successor', () => {
        const rec = clan({ roleOverrides: { Rin: 'Leader' } });
        const out = applyClanSuccession(rec, 'kaze', resolveClanSuccession(rec, 'kaze'));
        assert.equal(out.founderName, 'Rin');
        assert.deepEqual(out.members.map((m) => m.name), ['Rin', 'Toshi']);
        assert.equal(out.roleOverrides.Rin, undefined, 'the new founder does not also keep a Leader stripe');
    });

    it('drops the departing member from members and from roleOverrides', () => {
        const rec = clan({ roleOverrides: { Rin: 'Officer' } });
        const out = applyClanSuccession(rec, 'rin', resolveClanSuccession(rec, 'rin'));
        assert.deepEqual(out.members.map((m) => m.name), ['Kaze', 'Toshi']);
        assert.equal(out.roleOverrides.Rin, undefined);
        assert.equal(out.founderName, 'Kaze', 'an ordinary departure never moves ownership');
    });

    it('keeps the founder name on an emptied clan rather than blanking it', () => {
        const rec = clan({ members: [member('Kaze', 1_000)] });
        const out = applyClanSuccession(rec, 'kaze', resolveClanSuccession(rec, 'kaze'));
        assert.deepEqual(out.members, []);
        assert.equal(out.founderName, 'Kaze', 'an empty clan has nothing left to administer');
    });
});

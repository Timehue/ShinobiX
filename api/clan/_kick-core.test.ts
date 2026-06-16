/**
 * Decision-logic guard for the clan kick endpoint (api/clan/kick.ts).
 * Tests the pure resolveClanKick helper — permission gates, founder protection,
 * leadership protection, "not a member", and the resulting roster.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveClanKick, clanSlugBare } from './_kick-core.js';

function clan() {
    return {
        founderName: 'Rill',
        members: [
            { name: 'Rill' },
            { name: 'Kenji' },
            { name: 'Mira' },
        ],
        roleOverrides: { Kenji: 'Officer' } as Record<string, string>,
        joinRequests: [{ name: 'Mira' }],
    };
}

describe('resolveClanKick', () => {
    it('a leader kicks a rank-and-file member — removed from members + join requests', () => {
        const r = resolveClanKick(clan(), 'leader', 'rill', 'mira');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.deepEqual(r.nextMembers.map((m) => m.name), ['Rill', 'Kenji']);
        assert.equal(r.nextJoinRequests.length, 0, 'stale join request for the kicked player is dropped');
    });

    it('the founder can never be kicked', () => {
        const r = resolveClanKick(clan(), 'leader', 'mira', 'rill');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.status, 403);
    });

    it('you cannot kick yourself (use Leave)', () => {
        const r = resolveClanKick(clan(), 'founder', 'rill', 'rill');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.status, 400);
    });

    it('a non-leadership member cannot kick anyone', () => {
        const r = resolveClanKick(clan(), 'member', 'mira', 'kenji');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.status, 403);
    });

    it('only the founder can remove another leader/officer', () => {
        // An officer (kenji) trying to kick a fellow officer is rejected...
        const data = { ...clan(), roleOverrides: { Kenji: 'Officer', Mira: 'Officer' } as Record<string, string> };
        const denied = resolveClanKick(data, 'officer', 'kenji', 'mira');
        assert.equal(denied.ok, false);
        if (denied.ok) return;
        assert.equal(denied.status, 403);
        // ...but the founder can.
        const allowed = resolveClanKick(data, 'founder', 'rill', 'mira');
        assert.equal(allowed.ok, true);
    });

    it('kicking a non-member is a 404', () => {
        const r = resolveClanKick(clan(), 'founder', 'rill', 'ghost');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.status, 404);
    });

    it('clanSlugBare strips to [a-z0-9]', () => {
        assert.equal(clanSlugBare('Storm Veil-01!'), 'stormveil01');
    });
});

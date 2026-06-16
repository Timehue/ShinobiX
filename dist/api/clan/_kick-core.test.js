"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Decision-logic guard for the clan kick endpoint (api/clan/kick.ts).
 * Tests the pure resolveClanKick helper — permission gates, founder protection,
 * leadership protection, "not a member", and the resulting roster.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _kick_core_js_1 = require("./_kick-core.js");
function clan() {
    return {
        founderName: 'Rill',
        members: [
            { name: 'Rill' },
            { name: 'Kenji' },
            { name: 'Mira' },
        ],
        roleOverrides: { Kenji: 'Officer' },
        joinRequests: [{ name: 'Mira' }],
    };
}
(0, node_test_1.describe)('resolveClanKick', () => {
    (0, node_test_1.it)('a leader kicks a rank-and-file member — removed from members + join requests', () => {
        const r = (0, _kick_core_js_1.resolveClanKick)(clan(), 'leader', 'rill', 'mira');
        node_assert_1.strict.equal(r.ok, true);
        if (!r.ok)
            return;
        node_assert_1.strict.deepEqual(r.nextMembers.map((m) => m.name), ['Rill', 'Kenji']);
        node_assert_1.strict.equal(r.nextJoinRequests.length, 0, 'stale join request for the kicked player is dropped');
    });
    (0, node_test_1.it)('the founder can never be kicked', () => {
        const r = (0, _kick_core_js_1.resolveClanKick)(clan(), 'leader', 'mira', 'rill');
        node_assert_1.strict.equal(r.ok, false);
        if (r.ok)
            return;
        node_assert_1.strict.equal(r.status, 403);
    });
    (0, node_test_1.it)('you cannot kick yourself (use Leave)', () => {
        const r = (0, _kick_core_js_1.resolveClanKick)(clan(), 'founder', 'rill', 'rill');
        node_assert_1.strict.equal(r.ok, false);
        if (r.ok)
            return;
        node_assert_1.strict.equal(r.status, 400);
    });
    (0, node_test_1.it)('a non-leadership member cannot kick anyone', () => {
        const r = (0, _kick_core_js_1.resolveClanKick)(clan(), 'member', 'mira', 'kenji');
        node_assert_1.strict.equal(r.ok, false);
        if (r.ok)
            return;
        node_assert_1.strict.equal(r.status, 403);
    });
    (0, node_test_1.it)('only the founder can remove another leader/officer', () => {
        // An officer (kenji) trying to kick a fellow officer is rejected...
        const data = { ...clan(), roleOverrides: { Kenji: 'Officer', Mira: 'Officer' } };
        const denied = (0, _kick_core_js_1.resolveClanKick)(data, 'officer', 'kenji', 'mira');
        node_assert_1.strict.equal(denied.ok, false);
        if (denied.ok)
            return;
        node_assert_1.strict.equal(denied.status, 403);
        // ...but the founder can.
        const allowed = (0, _kick_core_js_1.resolveClanKick)(data, 'founder', 'rill', 'mira');
        node_assert_1.strict.equal(allowed.ok, true);
    });
    (0, node_test_1.it)('kicking a non-member is a 404', () => {
        const r = (0, _kick_core_js_1.resolveClanKick)(clan(), 'founder', 'rill', 'ghost');
        node_assert_1.strict.equal(r.ok, false);
        if (r.ok)
            return;
        node_assert_1.strict.equal(r.status, 404);
    });
    (0, node_test_1.it)('clanSlugBare strips to [a-z0-9]', () => {
        node_assert_1.strict.equal((0, _kick_core_js_1.clanSlugBare)('Storm Veil-01!'), 'stormveil01');
    });
});

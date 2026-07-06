"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _public_index_js_1 = require("./_public-index.js");
(0, node_test_1.describe)('public player index', () => {
    (0, node_test_1.it)('builds a compact public leaderboard row with safe defaults', () => {
        const entry = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({
            name: 'Akira',
            level: 12.8,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            rankedRating: 1450,
            xp: 12345,
            ryo: 999999,
            inventory: [{ id: 'secret' }],
        }, 'akira', 5000, 4000);
        node_assert_1.strict.equal(entry._publicIndexVersion, _public_index_js_1.PUBLIC_INDEX_VERSION);
        node_assert_1.strict.equal(entry.name, 'Akira');
        node_assert_1.strict.equal(entry.level, 12);
        node_assert_1.strict.equal(entry.rankedRating, 1450);
        node_assert_1.strict.equal(entry.xp, 12345);
        node_assert_1.strict.equal(entry.lastSeen, 4000);
        node_assert_1.strict.equal('ryo' in entry, false);
        node_assert_1.strict.equal('inventory' in entry, false);
    });
    (0, node_test_1.it)('detects only public-index-visible changes', () => {
        const next = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
        }, 'akira');
        node_assert_1.strict.equal((0, _public_index_js_1.publicPlayerIndexChanged)({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            inventory: [{ id: 'hidden-change' }],
        }, next), false);
        node_assert_1.strict.equal((0, _public_index_js_1.publicPlayerIndexChanged)({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            rankedRating: 1100,
        }, next), true);
    });
    (0, node_test_1.it)('parses legacy rows and marks them for one-time backfill', () => {
        const legacy = { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu', lastSeen: 123 };
        const parsed = (0, _public_index_js_1.parsePublicPlayerIndexEntry)(legacy, 'akira');
        node_assert_1.strict.equal(parsed?.rankedRating, 1000);
        node_assert_1.strict.equal(parsed?.lastSeen, 123);
        node_assert_1.strict.equal((0, _public_index_js_1.needsPublicPlayerIndexBackfill)(legacy), true);
        node_assert_1.strict.equal((0, _public_index_js_1.needsPublicPlayerIndexBackfill)(parsed), false);
    });
    (0, node_test_1.it)('projects into the existing StartScreen roster shape', () => {
        const entry = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            rankedRating: 1337,
            clan: 'Crimson Moon',
        }, 'akira', 5000, 4000);
        const row = (0, _public_index_js_1.publicIndexToLeaderboardRosterEntry)(entry, true);
        node_assert_1.strict.equal(row.online, true);
        node_assert_1.strict.equal(row.name, 'Akira');
        node_assert_1.strict.equal(row.character.rankedRating, 1337);
        node_assert_1.strict.equal(row.character.clan, 'Crimson Moon');
    });
});

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
    (0, node_test_1.it)('builds ranked public boards without admin or clan bookkeeping rows', () => {
        const akira = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({
            name: 'Akira',
            level: 14,
            village: 'Stormveil',
            clan: 'Crimson Moon',
            rankedRating: 1200,
            rankedWins: 1,
            totalPvpKills: 8,
        }, 'akira', 5000, 4000);
        const boro = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({
            name: 'Boro',
            level: 18,
            village: 'Ashvale',
            clan: 'Crimson Moon',
            rankedRating: 1320,
            rankedWins: 2,
        }, 'boro', 5000, 4500);
        const admin = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({ name: 'admin1', rankedRating: 9999 }, 'admin1');
        node_assert_1.strict.equal((0, _public_index_js_1.isPublicPlayerIndexKey)('admin1'), false);
        node_assert_1.strict.equal((0, _public_index_js_1.isPublicPlayerIndexKey)('clan-crimson-moon'), false);
        const boards = (0, _public_index_js_1.buildPublicLeaderboards)([akira, boro, admin], ['akira'], 10);
        const ranked = boards.find((board) => board.id === 'ranked');
        const online = boards.find((board) => board.id === 'online');
        const clans = boards.find((board) => board.id === 'clans');
        node_assert_1.strict.deepEqual(ranked?.rows.map((row) => row.name), ['Boro', 'Akira']);
        node_assert_1.strict.deepEqual(online?.rows.map((row) => row.name), ['Akira']);
        node_assert_1.strict.equal(clans?.rows[0]?.name, 'Crimson Moon');
        node_assert_1.strict.equal(clans?.rows[0]?.members, 2);
        node_assert_1.strict.equal(clans?.rows[0]?.value, 11);
    });
    (0, node_test_1.it)('summarizes registry health and optional save-key parity', () => {
        const akira = (0, _public_index_js_1.buildPublicPlayerIndexEntry)({ name: 'Akira', level: 10 }, 'akira', 5000, 4000);
        const legacy = { name: 'Legacy', level: 2, village: 'Stormveil', specialty: 'Ninjutsu', lastSeen: 3000 };
        const health = (0, _public_index_js_1.summarizePublicIndexHealth)({
            akira,
            legacy,
            broken: '{nope',
            admin1: (0, _public_index_js_1.buildPublicPlayerIndexEntry)({ name: 'admin1' }, 'admin1'),
            'clan-crimson-moon': { name: 'clan-crimson-moon' },
        }, ['save:akira', 'save:legacy', 'save:missing', 'save:admin1', 'save:clan-crimson-moon'], 6000);
        node_assert_1.strict.equal(health.totalRegistryEntries, 5);
        node_assert_1.strict.equal(health.publicRegistryEntries, 3);
        node_assert_1.strict.equal(health.validEntries, 2);
        node_assert_1.strict.equal(health.malformedEntries, 1);
        node_assert_1.strict.equal(health.staleEntries, 1);
        node_assert_1.strict.equal(health.adminEntries, 1);
        node_assert_1.strict.equal(health.clanEntries, 1);
        node_assert_1.strict.equal(health.saveKeyCount, 3);
        node_assert_1.strict.equal(health.missingRegistryCount, 1);
        node_assert_1.strict.equal(health.orphanRegistryCount, 1);
        node_assert_1.strict.deepEqual(health.missingRegistryKeys, ['missing']);
        node_assert_1.strict.deepEqual(health.orphanRegistryKeys, ['broken']);
    });
});

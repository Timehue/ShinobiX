import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    PUBLIC_INDEX_VERSION,
    buildPublicPlayerIndexEntry,
    needsPublicPlayerIndexBackfill,
    parsePublicPlayerIndexEntry,
    publicIndexToLeaderboardRosterEntry,
    publicPlayerIndexChanged,
} from './_public-index.js';

describe('public player index', () => {
    it('builds a compact public leaderboard row with safe defaults', () => {
        const entry = buildPublicPlayerIndexEntry({
            name: 'Akira',
            level: 12.8,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            rankedRating: 1450,
            xp: 12345,
            ryo: 999999,
            inventory: [{ id: 'secret' }],
        }, 'akira', 5000, 4000);

        assert.equal(entry._publicIndexVersion, PUBLIC_INDEX_VERSION);
        assert.equal(entry.name, 'Akira');
        assert.equal(entry.level, 12);
        assert.equal(entry.rankedRating, 1450);
        assert.equal(entry.xp, 12345);
        assert.equal(entry.lastSeen, 4000);
        assert.equal('ryo' in entry, false);
        assert.equal('inventory' in entry, false);
    });

    it('detects only public-index-visible changes', () => {
        const next = buildPublicPlayerIndexEntry({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
        }, 'akira');

        assert.equal(publicPlayerIndexChanged({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            inventory: [{ id: 'hidden-change' }],
        }, next), false);

        assert.equal(publicPlayerIndexChanged({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            specialty: 'Ninjutsu',
            rankedRating: 1100,
        }, next), true);
    });

    it('parses legacy rows and marks them for one-time backfill', () => {
        const legacy = { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu', lastSeen: 123 };
        const parsed = parsePublicPlayerIndexEntry(legacy, 'akira');

        assert.equal(parsed?.rankedRating, 1000);
        assert.equal(parsed?.lastSeen, 123);
        assert.equal(needsPublicPlayerIndexBackfill(legacy), true);
        assert.equal(needsPublicPlayerIndexBackfill(parsed), false);
    });

    it('projects into the existing StartScreen roster shape', () => {
        const entry = buildPublicPlayerIndexEntry({
            name: 'Akira',
            level: 5,
            village: 'Stormveil',
            rankedRating: 1337,
            clan: 'Crimson Moon',
        }, 'akira', 5000, 4000);
        const row = publicIndexToLeaderboardRosterEntry(entry, true);

        assert.equal(row.online, true);
        assert.equal(row.name, 'Akira');
        assert.equal(row.character.rankedRating, 1337);
        assert.equal(row.character.clan, 'Crimson Moon');
    });
});

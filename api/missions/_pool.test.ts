import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { canPlayerReceiveMission } from './_eligibility.js';
import { pickDailyMissions, getMissionPool, pickNewbieMissions, pickDailyMissionsForPlayer } from './_pool.js';

describe('getMissionPool', () => {
    it('healer pool has at least 8 missions', () => {
        assert.ok(getMissionPool('healer').length >= 8);
    });
    it('vanguard pool has at least 8 missions', () => {
        assert.ok(getMissionPool('vanguard').length >= 8);
    });
    it('petTamer pool has at least 3 missions', () => {
        assert.ok(getMissionPool('petTamer').length >= 3);
    });
    it('every petTamer mission is profession=petTamer', () => {
        for (const m of getMissionPool('petTamer')) assert.equal(m.profession, 'petTamer');
    });
    it('every healer mission is profession=healer', () => {
        for (const m of getMissionPool('healer')) assert.equal(m.profession, 'healer');
    });
    it('every vanguard mission is profession=vanguard', () => {
        for (const m of getMissionPool('vanguard')) assert.equal(m.profession, 'vanguard');
    });
});

describe('pickDailyMissions', () => {
    it('returns 3 missions by default', () => {
        const picks = pickDailyMissions('healer', 'alice', '2026-05-25');
        assert.equal(picks.length, 3);
    });

    it('is deterministic per (player, date)', () => {
        const a = pickDailyMissions('vanguard', 'bob', '2026-05-25');
        const b = pickDailyMissions('vanguard', 'bob', '2026-05-25');
        assert.deepEqual(a.map(m => m.templateId), b.map(m => m.templateId));
    });

    it('picks are unique within a day (no duplicates)', () => {
        const picks = pickDailyMissions('healer', 'carol', '2026-05-25');
        const ids = picks.map(m => m.templateId);
        assert.equal(new Set(ids).size, ids.length);
    });

    it('returns 3 missions for petTamer', () => {
        const picks = pickDailyMissions('petTamer', 'dave', '2026-05-25');
        assert.equal(picks.length, 3);
        for (const m of picks) assert.equal(m.profession, 'petTamer');
    });

    it('different players on the same day usually get different picks', () => {
        const a = pickDailyMissions('healer', 'alice', '2026-05-25').map(m => m.templateId);
        const b = pickDailyMissions('healer', 'eve', '2026-05-25').map(m => m.templateId);
        assert.notDeepEqual(a, b);
    });
});

describe('pickDailyMissionsForPlayer eligibility filtering', () => {
    it('level 1 players cannot receive profession daily objectives', () => {
        const picks = pickDailyMissionsForPlayer({
            profession: 'healer',
            playerName: 'academy',
            dateKey: '2026-05-25',
            character: { level: 1, profession: 'healer', professionRank: 1 },
        });
        assert.equal(picks.length, 0);
    });

    it('rank 1 healers get eligible fallback picks instead of high-rank objectives', () => {
        const character = { level: 13, profession: 'healer', professionRank: 1 };
        const picks = pickDailyMissionsForPlayer({
            profession: 'healer',
            playerName: 'jun',
            dateKey: '2026-05-25',
            character,
            count: 3,
        });
        assert.equal(picks.length, 3);
        for (const pick of picks) {
            assert.equal(canPlayerReceiveMission(character, pick).ok, true);
            assert.equal(pick.eligibility.minProfessionRank ?? 1, 1);
        }
    });

    it('players without pets cannot receive pet-training missions', () => {
        const picks = pickDailyMissionsForPlayer({
            profession: 'petTamer',
            playerName: 'no-pet',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'petTamer', professionRank: 10, pets: [] },
            context: { systems: { expedition: true } },
            count: 8,
        });
        assert.ok(picks.length > 0);
        assert.equal(picks.some((pick) => pick.kind === 'pet-tamer-pet-train'), false);
    });

    it('players without PvP unlock cannot receive Vanguard missions', () => {
        const picks = pickDailyMissionsForPlayer({
            profession: 'vanguard',
            playerName: 'no-pvp',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'vanguard', professionRank: 10 },
            context: { systems: { pvp: false } },
            count: 4,
        });
        assert.equal(picks.length, 0);
    });

    it('profession mismatch cannot receive another profession pool', () => {
        const picks = pickDailyMissionsForPlayer({
            profession: 'healer',
            playerName: 'wrong-job',
            dateKey: '2026-05-25',
            character: { level: 30, profession: 'vanguard', professionRank: 10 },
            count: 3,
        });
        assert.equal(picks.length, 0);
    });
});

describe('pickNewbieMissions', () => {
    it('returns exactly one battle task and one mission task', () => {
        const picks = pickNewbieMissions('alice', '2026-05-25');
        assert.equal(picks.length, 2);
        const kinds = picks.map(m => m.kind).sort();
        assert.deepEqual(kinds, ['newbie-battle-wins', 'newbie-missions']);
    });

    it('is deterministic per (player, date)', () => {
        const a = pickNewbieMissions('bob', '2026-05-25');
        const b = pickNewbieMissions('bob', '2026-05-25');
        assert.deepEqual(a.map(m => m.templateId), b.map(m => m.templateId));
    });

    it('every newbie mission pays ryo (> 0) and has a positive target', () => {
        for (const m of pickNewbieMissions('carol', '2026-05-25')) {
            assert.ok(m.ryoReward > 0);
            assert.ok(m.target > 0);
        }
    });

    it('can vary across days for the same player', () => {
        // Sample a span of days; the seeded pick should not be frozen to a
        // single template per kind for all dates.
        const battleIds = new Set<string>();
        const missionIds = new Set<string>();
        for (let d = 1; d <= 28; d += 1) {
            const date = `2026-05-${String(d).padStart(2, '0')}`;
            const picks = pickNewbieMissions('dave', date);
            battleIds.add(picks.find(m => m.kind === 'newbie-battle-wins')!.templateId);
            missionIds.add(picks.find(m => m.kind === 'newbie-missions')!.templateId);
        }
        assert.ok(battleIds.size >= 2);
        assert.ok(missionIds.size >= 2);
    });
});

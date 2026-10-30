import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addClanContrib, clanContribForMonth, nextMissionTotal } from './_clan-contrib-month.js';
import { markHuntCompletedFields, markMissionCompletedFields } from './missions/_mission-catalog.js';
import { applyVillageWarMissionClaim } from './village/_war-mission.js';

const october = { clanBattleContrib: 30, clanEventContrib: 12, clanMissionContrib: 48, clanContribMonth: '2026-10' };

describe('monthly clan contribution counters', () => {
    it('zeroes all three counters when the first write of a new month lands', () => {
        assert.deepEqual(addClanContrib(october, 'clanMissionContrib', '2026-11'), {
            clanBattleContrib: 0, clanEventContrib: 0, clanMissionContrib: 1, clanContribMonth: '2026-11',
        });
    });

    it('adds within the same month and keeps the other counters', () => {
        assert.deepEqual(addClanContrib(october, 'clanEventContrib', '2026-10', 5), {
            clanBattleContrib: 30, clanEventContrib: 17, clanMissionContrib: 48, clanContribMonth: '2026-10',
        });
    });

    it('lets a late settlement from an earlier month count toward no month', () => {
        assert.equal(clanContribForMonth(october, '2026-09'), null);
        assert.deepEqual(addClanContrib(october, 'clanMissionContrib', '2026-09'), {});
    });

    it('treats a save with no stamp as a fresh month', () => {
        assert.deepEqual(addClanContrib({ clanMissionContrib: 7 }, 'clanMissionContrib', '2026-11'), {
            clanBattleContrib: 0, clanEventContrib: 0, clanMissionContrib: 1, clanContribMonth: '2026-11',
        });
    });

    it('folds an old save\'s clan-only mission history into the lifetime total before a month roll zeroes it', () => {
        // The exam reads max(totalMissionsCompleted, clanMissionContrib); a legacy
        // save kept its history only in the clan counter.
        const legacy = { totalMissionsCompleted: 0, clanMissionContrib: 50, clanContribMonth: '2026-09' };
        const fields = markMissionCompletedFields({ ...legacy }, '2026-11-01', '2026-11');
        assert.equal(fields.clanMissionContrib, 1);
        assert.equal(fields.totalMissionsCompleted, 51, 'exam progress survives the roll');
        assert.equal(nextMissionTotal({ totalMissionsCompleted: 70, clanMissionContrib: 3 }), 71);
    });

    it('is what the daily mission, hunt and war mission claims apply', () => {
        const mission = markMissionCompletedFields({ ...october }, '2026-11-01', '2026-11');
        assert.equal(mission.clanMissionContrib, 1);
        assert.equal(mission.clanBattleContrib, 0);
        assert.equal(mission.clanEventContrib, 0);
        const hunt = markHuntCompletedFields({ ...october }, '2026-11-01', '2026-11');
        assert.equal(hunt.clanMissionContrib, 1);
        assert.equal(hunt.clanBattleContrib, 0);
        const war = applyVillageWarMissionClaim(
            { ...october, village: 'Leaf', villageWarMissionDate: '2026-11-01', villageWarRaidProgress: 3, villageWarMissionsCompleted: 0 },
            0, '2026-11-01', '2026-11',
        );
        assert.ok(war.ok);
        if (war.ok) {
            assert.equal(war.character.clanMissionContrib, 1);
            assert.equal(war.character.clanBattleContrib, 0);
            assert.equal(war.character.clanContribMonth, '2026-11');
        }
    });
});

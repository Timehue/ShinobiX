import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyVillageWarMissionClaim,
    VILLAGE_WAR_DAILY_MISSIONS,
    VILLAGE_WAR_RAIDS_PER_MISSION,
} from './_war-mission.js';

const TODAY = '2026-07-30';
const MONTH = '2026-07';

const raider = (over: Record<string, unknown> = {}) => ({
    village: 'Ashen',
    villageWarMissionDate: TODAY,
    villageWarRaidProgress: 6,
    villageWarMissionsCompleted: 0,
    clanMissionContrib: 4,
    totalMissionsCompleted: 11,
    ...over,
});

describe('village-war daily mission settlement', () => {
    it('commits the counters the save sanitizer freezes', () => {
        const out = applyVillageWarMissionClaim(raider(), 0, TODAY, MONTH);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.villageWarMissionsCompleted, 1);
        assert.equal(out.character.clanMissionContrib, 5);
        assert.equal(out.character.totalMissionsCompleted, 12);
        assert.equal(out.character.clanContribMonth, MONTH);
        assert.equal(out.character.villageWarMissionDate, TODAY);
    });

    it('does not consume the shared daily mission allowance', () => {
        const out = applyVillageWarMissionClaim(raider({ dailyMissionsCompleted: 3 }), 0, TODAY, MONTH);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal((out.character as Record<string, unknown>).dailyMissionsCompleted, 3);
    });

    it('is idempotent — a replay of the same index refuses once completed advances', () => {
        const first = applyVillageWarMissionClaim(raider(), 0, TODAY, MONTH);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        const replay = applyVillageWarMissionClaim(first.character, 0, TODAY, MONTH);
        assert.equal(replay.ok, false);
        if (replay.ok) return;
        assert.equal(replay.reason, 'out-of-order');
    });

    it('requires the raids for THIS mission, counted cumulatively', () => {
        // Mission 1 needs 2 x RAIDS_PER_MISSION total, not another full block.
        const atSix = applyVillageWarMissionClaim(
            raider({ villageWarMissionsCompleted: 1, villageWarRaidProgress: VILLAGE_WAR_RAIDS_PER_MISSION }), 1, TODAY, MONTH);
        assert.equal(atSix.ok, false);
        if (atSix.ok) return;
        assert.equal(atSix.reason, 'not-enough-raids');
        assert.equal(atSix.remaining, VILLAGE_WAR_RAIDS_PER_MISSION);

        const ready = applyVillageWarMissionClaim(
            raider({ villageWarMissionsCompleted: 1, villageWarRaidProgress: 2 * VILLAGE_WAR_RAIDS_PER_MISSION }), 1, TODAY, MONTH);
        assert.equal(ready.ok, true);
    });

    it('refuses claims out of order and past the daily mission count', () => {
        assert.equal(applyVillageWarMissionClaim(raider(), 1, TODAY, MONTH).ok, false);
        const past = applyVillageWarMissionClaim(raider(), VILLAGE_WAR_DAILY_MISSIONS, TODAY, MONTH);
        assert.equal(past.ok, false);
        if (past.ok) return;
        assert.equal(past.reason, 'invalid-mission');
    });

    it('treats a stale date as a fresh day, so yesterday cannot fund today', () => {
        const stale = applyVillageWarMissionClaim(
            raider({ villageWarMissionDate: '2026-07-29', villageWarRaidProgress: 99 }), 0, TODAY, MONTH);
        assert.equal(stale.ok, false);
        if (stale.ok) return;
        assert.equal(stale.reason, 'not-enough-raids');
    });

    it('refuses a villageless character', () => {
        const out = applyVillageWarMissionClaim(raider({ village: '' }), 0, TODAY, MONTH);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.equal(out.reason, 'no-village');
    });
});

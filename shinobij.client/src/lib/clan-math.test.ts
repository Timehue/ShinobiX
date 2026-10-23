import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLAN_POINTS_WEEKLY_CAP as SERVER_CLAN_POINTS_WEEKLY_CAP, clanPointWeekKey } from "../../../api/_clan-points";
import { CLAN_DONATION_XP_WEEKLY_CAP as SERVER_DONATION_XP_WEEKLY_CAP } from "../../../api/clan/treasury/_donation-xp";
import { clanMissionProgressServer } from "../../../api/clan/_mission-catalog";
import {
    CLAN_DONATION_XP_WEEKLY_CAP, CLAN_POINTS_WEEKLY_CAP, clanDonationXpThisWeek, clanMissionProgress,
    clanPointsThisWeek, clanWeekKey, enhanceClanData, memberMonthCounters,
} from "./clan-math";
import type { ClanMemberEntry } from "../types/clan";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");

function member(over: Partial<ClanMemberEntry>): ClanMemberEntry {
    return { name: "m", village: "Leaf", level: 40, specialty: "Ninjutsu", battleContrib: 0, eventContrib: 0, missionContrib: 0, isFounder: false, month: "2026-10", ...over };
}
function clan(members: ClanMemberEntry[], ryo = 0) {
    return enhanceClanData({ name: "Mist", village: "Leaf", founderName: "m0", createdAt: 1, members, treasury: { ryo } } as never);
}

describe("clan weekly limits shown in the Clan Hall", () => {
    it("quote the server's caps", () => {
        assert.equal(CLAN_DONATION_XP_WEEKLY_CAP, SERVER_DONATION_XP_WEEKLY_CAP);
        assert.equal(CLAN_POINTS_WEEKLY_CAP, SERVER_CLAN_POINTS_WEEKLY_CAP);
    });

    it("key the week exactly as the server does, across year boundaries", () => {
        for (let t = Date.parse("2020-12-20T00:00:00Z"); t < Date.parse("2027-01-20T00:00:00Z"); t += 11 * 3_600_000) {
            assert.equal(clanWeekKey(t), clanPointWeekKey(new Date(t)), new Date(t).toISOString());
        }
    });

    it("read only this week's stamped usage", () => {
        assert.equal(clanDonationXpThisWeek({ clanDonationXp: { day: "2026-10-21", used: 400, week: "2026-W43", weekUsed: 1_400 } }, NOW), 1_400);
        assert.equal(clanDonationXpThisWeek({ clanDonationXp: { week: "2026-W42", weekUsed: 2_000 } }, NOW), 0, "last week's budget is spent history");
        assert.equal(clanDonationXpThisWeek({}, NOW), 0);
        assert.equal(clanPointsThisWeek({ weeklyClanPoints: 640, weeklyClanPointsWeek: "2026-W43" }, NOW), 640);
        assert.equal(clanPointsThisWeek({ weeklyClanPoints: 1_000, weeklyClanPointsWeek: "2026-W42" }, NOW), 0);
    });
});

describe("clan mission progress mirrors the server (I-15)", () => {
    it("month-gates the roster counters", () => {
        assert.deepEqual(memberMonthCounters(member({ battleContrib: 2, eventContrib: 25 }), NOW), { battle: 2, mission: 0, event: 25 });
        assert.deepEqual(memberMonthCounters(member({ battleContrib: 2, eventContrib: 25, month: "2026-09" }), NOW), { battle: 0, mission: 0, event: 0 });
    });

    it("agrees with the server on every mission for fresh, stale and idle rosters", () => {
        const rosters: ClanMemberEntry[][] = [
            [member({ name: "giver", eventContrib: 25 })],
            [member({ name: "alt", eventContrib: 25, month: "2026-09" })],
            Array.from({ length: 10 }, (_, i) => member({ name: `idle-${i}` })),
            Array.from({ length: 10 }, (_, i) => member({ name: `busy-${i}`, missionContrib: 1 })),
            Array.from({ length: 3 }, (_, i) => member({ name: `vet-${i}`, battleContrib: 30, missionContrib: 40, eventContrib: 20 })),
        ];
        for (const members of rosters) {
            const data = clan(members, 1_000_000);
            for (const key of ["battle", "mission", "guard", "anbu", "donation", "training", "raid"] as const) {
                assert.equal(clanMissionProgress(data, key, NOW), clanMissionProgressServer(data as never, "Mist", [], key, NOW), `${members[0].name}: ${key}`);
            }
        }
        assert.equal(clanMissionProgress(clan(rosters[0], 1_000_000), "donation", NOW), 25_000);
        assert.equal(clanMissionProgress(clan(rosters[2], 1_000_000), "guard", NOW), 0, "ten idle L5+ members no longer complete guard");
    });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    RANK_BANDS,
    rankBandIndexForLevel,
    rankBandForLevel,
    nextRankBand,
    cappedStatCount,
} from "./rank-progression";
import { rankFromLevel } from "./stats";
import { statCapForLevel, STAT_CAP_FIELDS } from "../constants/game";

// These pins guarantee the player-facing rank ladder NEVER drifts from the two
// authorities it mirrors: rankFromLevel (display rank) and statCapForLevel (the
// combat clamp). If someone retunes a band threshold or a cap, this fails first.

describe("RANK_BANDS mirror the combat authorities", () => {
    it("each band's name + cap match rankFromLevel + statCapForLevel at its minLevel", () => {
        for (const band of RANK_BANDS) {
            assert.equal(band.rank, rankFromLevel(band.minLevel), `rank name @L${band.minLevel}`);
            assert.equal(band.statCap, statCapForLevel(band.minLevel), `stat cap @L${band.minLevel}`);
        }
    });
    it("bands are ascending, contiguous, and 5 wide (Academy…Special Jonin)", () => {
        assert.equal(RANK_BANDS.length, 5);
        for (let i = 0; i < RANK_BANDS.length; i++) assert.equal(RANK_BANDS[i].index, i);
        for (let i = 1; i < RANK_BANDS.length; i++) {
            assert.ok(RANK_BANDS[i].minLevel > RANK_BANDS[i - 1].minLevel, "minLevel ascending");
            assert.ok(RANK_BANDS[i].statCap > RANK_BANDS[i - 1].statCap, "statCap ascending");
        }
    });
});

describe("rankBandIndexForLevel matches rankFromLevel across the whole range", () => {
    it("agrees on the rank name for every level 1..120", () => {
        for (let L = 1; L <= 120; L++) {
            assert.equal(rankBandForLevel(L).rank, rankFromLevel(L), `L${L}`);
        }
    });
    it("clamps junk input to Academy", () => {
        assert.equal(rankBandIndexForLevel(0), 0);
        assert.equal(rankBandIndexForLevel(-5), 0);
        assert.equal(rankBandIndexForLevel(NaN), 0);
    });
});

describe("nextRankBand", () => {
    it("points at the next band, with the right unlock level", () => {
        assert.equal(nextRankBand(1)?.rank, "Genin");
        assert.equal(nextRankBand(1)?.minLevel, 15);
        assert.equal(nextRankBand(29)?.rank, "Chunin");
        assert.equal(nextRankBand(50)?.rank, "Special Jonin");
    });
    it("is null at the top band (Special Jonin)", () => {
        assert.equal(nextRankBand(80), null);
        assert.equal(nextRankBand(100), null);
    });
});

describe("cappedStatCount — legibility of the anti-twink clamp", () => {
    const all = (v: number) => Object.fromEntries(STAT_CAP_FIELDS.map((k) => [k, v])) as Record<string, number>;
    it("counts stats stored above the rank ceiling", () => {
        // An Academy twink (cap 350) with everything at 500 → all 12 clamped.
        assert.equal(cappedStatCount(all(500), 1), STAT_CAP_FIELDS.length);
        // Same stats at Chunin (cap 1300) → none clamped.
        assert.equal(cappedStatCount(all(500), 30), 0);
    });
    it("is 0 at the endgame band (cap == MAX_STAT) and for missing stats", () => {
        assert.equal(cappedStatCount(all(2500), 80), 0);
        assert.equal(cappedStatCount(undefined, 1), 0);
    });
});

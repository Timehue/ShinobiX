import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    resolveWarMorale,
    WAR_DEBUFF_TRAINING_XP_MULT,
    WAR_DEBUFF_JUTSU_TIME_MULT,
    WAR_BUFF_TRAINING_XP_MULT,
    WAR_BUFF_JUTSU_TIME_MULT,
} from "./war-debuff";

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("village war morale", () => {
    it("is neutral with no stamps at all", () => {
        const m = resolveWarMorale({}, NOW);
        assert.equal(m.morale, "none");
        assert.equal(m.xpMult, 1);
        assert.equal(m.jutsuTimeMult, 1, "callers multiply blind, so neutral must be exactly 1");
        assert.equal(m.until, 0);
    });

    it("is neutral once both windows have expired", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW - DAY, warWinBuffUntil: NOW - 2 * DAY }, NOW);
        assert.equal(m.morale, "none");
        assert.equal(m.jutsuTimeMult, 1);
    });

    it("applies the winner's buff — the thing that used to be stamped and ignored", () => {
        const m = resolveWarMorale({ warWinBuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "triumphant");
        assert.equal(m.xpMult, WAR_BUFF_TRAINING_XP_MULT);
        assert.equal(m.jutsuTimeMult, WAR_BUFF_JUTSU_TIME_MULT);
        assert.ok(m.jutsuTimeMult < 1, "a win must make training FASTER");
        assert.equal(m.until, NOW + 3 * DAY);
    });

    it("applies the loser's debuff unchanged", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "demoralized");
        assert.equal(m.active, true, "back-compat flag still means DEMORALIZED");
        assert.equal(m.xpMult, WAR_DEBUFF_TRAINING_XP_MULT);
        assert.equal(m.jutsuTimeMult, WAR_DEBUFF_JUTSU_TIME_MULT);
        assert.ok(m.jutsuTimeMult > 1, "a loss must make training SLOWER");
    });

    it("lets a fresh defeat override an older victory", () => {
        // Won three days ago (buff nearly done), lost just now.
        const m = resolveWarMorale({ warWinBuffUntil: NOW + HOUR, warLossDebuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "demoralized", "the most recent settlement is what counts");
    });

    it("lets a fresh victory override an older defeat", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW + HOUR, warWinBuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "triumphant");
    });

    it("ignores an expired buff sitting beside a live debuff", () => {
        const m = resolveWarMorale({ warWinBuffUntil: NOW - DAY, warLossDebuffUntil: NOW + DAY }, NOW);
        assert.equal(m.morale, "demoralized");
    });

    it("ignores an expired debuff sitting beside a live buff", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW - DAY, warWinBuffUntil: NOW + DAY }, NOW);
        assert.equal(m.morale, "triumphant");
    });

    it("treats a window ending exactly now as over", () => {
        assert.equal(resolveWarMorale({ warWinBuffUntil: NOW }, NOW).morale, "none");
        assert.equal(resolveWarMorale({ warLossDebuffUntil: NOW }, NOW).morale, "none");
    });

    it("survives garbage stamps", () => {
        const m = resolveWarMorale({ warWinBuffUntil: NaN, warLossDebuffUntil: undefined }, NOW);
        assert.equal(m.morale, "none");
        assert.equal(m.jutsuTimeMult, 1);
    });

    it("keeps the win gentler than the loss, so a victor cannot snowball", () => {
        const winGain = 1 - WAR_BUFF_JUTSU_TIME_MULT;   // 0.10 faster
        const lossCost = WAR_DEBUFF_JUTSU_TIME_MULT - 1; // 0.20 slower
        assert.ok(winGain > 0 && winGain < lossCost, "a win helps, but less than a loss hurts");
    });
});

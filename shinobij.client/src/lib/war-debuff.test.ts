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

    it("keeps a legacy winner stamp progression-neutral", () => {
        const m = resolveWarMorale({ warWinBuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "triumphant");
        assert.equal(m.xpMult, WAR_BUFF_TRAINING_XP_MULT);
        assert.equal(m.jutsuTimeMult, WAR_BUFF_JUTSU_TIME_MULT);
        assert.equal(m.jutsuTimeMult, 1);
        assert.equal(m.until, NOW + 3 * DAY);
    });

    it("turns a loss into a short comeback rally", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "rallying");
        assert.equal(m.active, true, "back-compat flag still marks the loss window");
        assert.equal(m.xpMult, WAR_DEBUFF_TRAINING_XP_MULT);
        assert.equal(m.jutsuTimeMult, WAR_DEBUFF_JUTSU_TIME_MULT);
        assert.ok(m.jutsuTimeMult < 1, "a loss now activates comeback training");
    });

    it("lets a fresh defeat override an older victory", () => {
        // Won three days ago (buff nearly done), lost just now.
        const m = resolveWarMorale({ warWinBuffUntil: NOW + HOUR, warLossDebuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "rallying", "the most recent settlement is what counts");
    });

    it("lets a fresh victory override an older defeat", () => {
        const m = resolveWarMorale({ warLossDebuffUntil: NOW + HOUR, warWinBuffUntil: NOW + 3 * DAY }, NOW);
        assert.equal(m.morale, "triumphant");
    });

    it("ignores an expired buff sitting beside a live debuff", () => {
        const m = resolveWarMorale({ warWinBuffUntil: NOW - DAY, warLossDebuffUntil: NOW + DAY }, NOW);
        assert.equal(m.morale, "rallying");
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

    it("gives progression help only to the comeback side", () => {
        assert.equal(WAR_BUFF_JUTSU_TIME_MULT, 1);
        assert.equal(WAR_BUFF_TRAINING_XP_MULT, 1);
        assert.ok(WAR_DEBUFF_JUTSU_TIME_MULT < 1);
        assert.ok(WAR_DEBUFF_TRAINING_XP_MULT > 1);
    });
});

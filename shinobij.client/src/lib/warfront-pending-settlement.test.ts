import test from "node:test";
import assert from "node:assert/strict";
import {
    PENDING_WARFRONT_SETTLEMENT_MAX_AGE_MS,
    WARFRONT_EARLY_RETRY_CUSHION_MS,
    WARFRONT_EARLY_RETRY_MAX_MS,
    coachMasteryReceiptLine,
    isSafeExpiredWarfrontExit,
    parsePendingWarfrontSettlement,
    parseWarfrontTerminalReceipt,
    warfrontEarlyRetryDelay,
    warfrontTerminalReceiptMatchesPlayer,
    warfrontTerminalReceiptMessage,
    type PendingWarfrontSettlement,
} from "./warfront-pending-settlement.ts";

const now = 1_800_000_000_000;
const pending: PendingWarfrontSettlement = {
    version: 1,
    playerName: "Kakashi",
    seed: 4242,
    reportKey: "4242:tactical",
    battleToken: "abcdef0123456789abcdef0123456789",
    prepareToken: "0123456789abcdef0123456789abcdef",
    rewardEligible: false,
    outcome: "win",
    warfrontChoices: [{ round: 1, choices: [] }],
    createdAt: now - 1_000,
};

test("pending Warfront settlement survives a route/reload with its exact receipt identity", () => {
    assert.deepEqual(parsePendingWarfrontSettlement(JSON.parse(JSON.stringify(pending)), pending.playerName, now), pending);
});

test("pending settlement recovery rejects another player, altered report identity, and stale records", () => {
    assert.equal(parsePendingWarfrontSettlement(pending, "Obito", now), null);
    assert.equal(parsePendingWarfrontSettlement({ ...pending, reportKey: "999:tactical" }, pending.playerName, now), null);
    assert.equal(parsePendingWarfrontSettlement({ ...pending, battleToken: "not-a-token" }, pending.playerName, now), null);
    assert.equal(parsePendingWarfrontSettlement({ ...pending, rewardEligible: "yes" }, pending.playerName, now), null);
    assert.equal(parsePendingWarfrontSettlement({ ...pending, createdAt: now - PENDING_WARFRONT_SETTLEMENT_MAX_AGE_MS - 1 }, pending.playerName, now), null);
});

test("forfeit recovery accepts the normal terminal receipt when settlement wins the race", () => {
    const receipt = parseWarfrontTerminalReceipt({
        ok: true,
        outcome: "win",
        reward: 750,
        firstWinOfDay: true,
        capped: false,
        unranked: false,
        idempotentReplay: true,
        character: { name: "Kakashi", ryo: 1750 },
    });
    assert.ok(receipt);
    assert.equal(receipt.forfeited, undefined);
    assert.equal(receipt.outcome, "win");
    assert.equal(receipt.reward, 750);
    assert.match(warfrontTerminalReceiptMessage(receipt, true), /finished before Exit.*First Warfront victory/s);
});

test("result recovery accepts the zero-reward forfeit receipt when Exit wins the race", () => {
    const receipt = parseWarfrontTerminalReceipt({
        ok: true,
        forfeited: true,
        outcome: "loss",
        reward: 0,
        unranked: true,
        idempotentReplay: true,
        rerollLockedUntil: now + 120_000,
        retryAfterSeconds: 120,
        coachMastery: { earned: 0, completedToday: 2, dailyCap: 3, capped: false },
        character: { name: "Kakashi", ryo: 1000 },
    });
    assert.ok(receipt);
    assert.equal(receipt.forfeited, true);
    assert.equal(receipt.outcome, "loss");
    assert.equal(receipt.retryAfterSeconds, 120);
    assert.match(warfrontTerminalReceiptMessage(receipt), /Forfeits do not earn Coach mastery.*2\/3.*2m/s);
});

test("terminal receipt parser rejects non-terminal and contradictory forfeit responses", () => {
    assert.equal(parseWarfrontTerminalReceipt({ ok: true, forfeited: false, reward: 0 }), null);
    assert.equal(parseWarfrontTerminalReceipt({
        ok: true,
        forfeited: true,
        outcome: "win",
        reward: 10,
        character: { name: "Kakashi" },
    }), null);
});

test("receipt-less exit accepts only the explicit safe expired-authorization contract", () => {
    const safe = {
        ok: true, outcome: "loss", reward: 0, forfeited: true, safeToExit: true,
        expiredAuthorization: true, settlementReceipt: null,
        reason: "warfront-authorization-expired", idempotentReplay: true,
    };
    assert.equal(isSafeExpiredWarfrontExit(safe), true);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, safeToExit: false }), false);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, reason: "warfront-active-authorization-mismatch" }), false);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, settlementReceipt: {} }), false);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, activeMatch: true }), false);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, code: "warfront-active-authorization-mismatch" }), false);
    assert.equal(isSafeExpiredWarfrontExit({ ...safe, code: "warfront-active-authorization-mismatch", activeMatch: true }), false);
    assert.equal(isSafeExpiredWarfrontExit({ error: "different lease", code: "warfront-active-authorization-mismatch", activeMatch: true, safeToExit: false }), false);
});

test("a terminal receipt can only update the player that owns the request", () => {
    const receipt = parseWarfrontTerminalReceipt({
        ok: true,
        outcome: "win",
        reward: 750,
        character: { name: " Kakashi ", ryo: 1750 },
    });
    assert.ok(receipt);
    assert.equal(warfrontTerminalReceiptMatchesPlayer(receipt, "kakashi"), true);
    assert.equal(warfrontTerminalReceiptMatchesPlayer(receipt, "Obito"), false);

    const missingIdentity = parseWarfrontTerminalReceipt({
        ok: true,
        outcome: "draw",
        reward: 0,
        character: {},
    });
    assert.ok(missingIdentity);
    assert.equal(warfrontTerminalReceiptMatchesPlayer(missingIdentity, "Kakashi"), false);
});

test("accelerated playback 425 schedules one bounded retry after the sealed clock", () => {
    assert.equal(warfrontEarlyRetryDelay({ code: "warfront-result-too-early", retryAfterMs: 42_000 }), 42_000 + WARFRONT_EARLY_RETRY_CUSHION_MS);
    assert.equal(warfrontEarlyRetryDelay({ code: "another-error", retryAfterMs: 42_000 }), null);
    assert.equal(warfrontEarlyRetryDelay({ code: "warfront-result-too-early", retryAfterMs: WARFRONT_EARLY_RETRY_MAX_MS + 1 }), null);
    assert.equal(warfrontEarlyRetryDelay({ code: "warfront-result-too-early", retryAfterMs: -1 }), null);
});

test("Coach mastery receipt copy reports earned progress and a reached daily cap", () => {
    assert.equal(coachMasteryReceiptLine({ earned: 1, completedToday: 2, dailyCap: 3, capped: false }), " Coach mastery 2/3.");
    assert.equal(coachMasteryReceiptLine({ earned: 0, completedToday: 3, dailyCap: 3, capped: true }), " Coach mastery 3/3; daily cap reached.");
    assert.equal(coachMasteryReceiptLine({ earned: 0, completedToday: 2, dailyCap: 3, capped: false }, true), " Forfeits do not earn Coach mastery. Daily progress 2/3.");
    const coachMastery = { day: "2030-01-01", earned: 1, completedToday: 2, dailyCap: 3, capped: false };
    const coachReward = { kind: "coach-completion", currency: "ryo", day: "2030-01-01", baseAmount: 60, amount: 60, completedToday: 2, dailyCap: 3, capped: false };
    const unranked = parseWarfrontTerminalReceipt({
        ok: true, outcome: "win", reward: 60, unranked: true, reason: "coach-completion", coachMastery, coachReward, character: {},
        settlementReceipt: {
            version: 1, battleToken: "abcdef0123456789", reportKey: "7:tactical", outcome: "win", reward: 60,
            rewardEligible: false, firstWinOfDay: false, firstWinBonus: 0, capped: false,
            coachMastery, coachReward, settledAt: now,
        },
    });
    assert.ok(unranked);
    assert.match(warfrontTerminalReceiptMessage(unranked, true), /finished before Exit.*\+60 ryo.*identical for a win, loss, or draw.*Coach mastery 2\/3/s);

    const cappedMastery = { day: "2030-01-01", earned: 0, completedToday: 3, dailyCap: 3, capped: true };
    const cappedReward = { ...coachReward, amount: 0, completedToday: 3, capped: true };
    const capped = parseWarfrontTerminalReceipt({
        ok: true, outcome: "loss", reward: 0, unranked: true, capped: true, reason: "coach-completion", coachMastery: cappedMastery, coachReward: cappedReward, character: {},
        settlementReceipt: {
            version: 1, battleToken: "abcdef0123456789", reportKey: "8:tactical", outcome: "loss", reward: 0,
            rewardEligible: false, firstWinOfDay: false, firstWinBonus: 0, capped: true,
            coachMastery: cappedMastery, coachReward: cappedReward, settledAt: now,
        },
    });
    assert.ok(capped);
    assert.match(warfrontTerminalReceiptMessage(capped), /3-completion UTC daily cap.*no ryo.*Coach mastery 3\/3/s);
});

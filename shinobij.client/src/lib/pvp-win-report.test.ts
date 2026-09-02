import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportPvpWin } from "./pvp-win-report";

/*
 * Same rule as the bounty claim, one call further down App.handlePvpWin: a
 * refusal this battle can never talk its way out of must not reject, because
 * the PvP completion turns a rejection into "Battle settlement callbacks did
 * not finish" with Retry as the only forward control.
 *
 * The reachable case is a window mismatch. report-pvp-win rejects a session
 * older than 24h (SESSION_REPLAY_WINDOW_MS) and 404s once the live row and its
 * sealed snapshot are gone, but pvp:rewarded:<name>:<battleId> — the receipt
 * that makes the completion replay at all — lives 48h. Everything in between
 * used to be a permanent lockout.
 */

const respond = (status: number, body: Record<string, unknown>) =>
    (async () => new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

const REQUEST = { playerName: "rill", battleId: "pvp-1", opponentName: "dopey" };
const signal = () => new AbortController().signal;

describe("Vanguard PvP win report", () => {
    it("returns the server's mission completions on success", async () => {
        const completions = await reportPvpWin(REQUEST, signal(), respond(200, {
            ok: true,
            vanguard: true,
            missionsCompleted: [{ id: "m1", name: "Duelist", xpReward: 40 }],
        }));

        assert.deepEqual(completions, [{ id: "m1", name: "Duelist", xpReward: 40 }]);
    });

    it("treats the endpoint's own no-credit 200s as zero completions", async () => {
        // same-ip / account-too-young / quick-surrender / not-a-vanguard all
        // answer 200 with no missions. None of them is an error.
        for (const body of [
            { ok: true, vanguard: false },
            { ok: true, vanguard: true, reason: "same-ip", missionsCompleted: [] },
            { ok: true, alreadyReported: true },
        ]) {
            assert.deepEqual(await reportPvpWin(REQUEST, signal(), respond(200, body)), []);
        }
    });

    it("settles instead of trapping when the battle outlived the report window", async () => {
        const tooOld = await reportPvpWin(REQUEST, signal(), respond(409, {
            error: "Battle session is too old to report.",
        }));
        assert.deepEqual(tooOld, [], "a 24h-old battle must not wedge a 48h-live settlement");

        const gone = await reportPvpWin(REQUEST, signal(), respond(404, {
            error: "Battle session not found or expired.",
        }));
        assert.deepEqual(gone, [], "an expired session must not wedge the settlement");
    });

    it("keeps every answer a later attempt could change retryable", async () => {
        const retryable: Array<[number, Record<string, unknown>]> = [
            [401, { error: "Authentication required." }],
            [429, { error: "Too many requests." }],
            [503, { error: "The battle result is safe, but its Legacy record is still being sealed. Retry the same battle.", code: "legacy-delivery-pending" }],
            [500, { error: "Internal server error." }],
        ];
        for (const [status, body] of retryable) {
            await assert.rejects(
                reportPvpWin(REQUEST, signal(), respond(status, body)),
                (error: unknown) => error instanceof Error && error.message === String(body.error),
                `HTTP ${status} must stay retryable rather than silently forfeit mission credit`,
            );
        }
    });
});

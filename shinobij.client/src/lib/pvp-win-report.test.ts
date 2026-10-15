import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { pvpOwnerSaveRefreshRequired, pvpWinReportRequired, reportPvpWin } from "./pvp-win-report";

/*
 * Same rule as the bounty claim, one call further down App.handlePvpWin: a
 * refusal this battle can never talk its way out of must not reject, because
 * the PvP completion turns a rejection into "Your result is not recorded
 * yet" with Retry as the only forward control.
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

/*
 * The winner's result card waits for every completion call in series. On
 * 2026-10-13 a non-Vanguard winner spent ~1.9s of a 6.5s settle on a win
 * report that could do nothing (the server answers `vanguard: false`) and on
 * re-reading a save the claim had just returned.
 */
describe("trimming the winner's completion chain", () => {
    it("reports only for a Vanguard, or when the claim carried no save", () => {
        assert.equal(pvpWinReportRequired({ profession: "vanguard" }), true);
        assert.equal(pvpWinReportRequired(undefined), true, "no authoritative snapshot keeps the old behavior");
        assert.equal(pvpWinReportRequired({ profession: "medic" }), false);
        assert.equal(pvpWinReportRequired({}), false, "a save with no profession is not a Vanguard");
    });

    it("re-reads the owner save only when something after the claim wrote it", () => {
        assert.equal(pvpOwnerSaveRefreshRequired({ claimSnapshotAdopted: true, saveChangedSinceClaim: false }), false);
        assert.equal(pvpOwnerSaveRefreshRequired({ claimSnapshotAdopted: true, saveChangedSinceClaim: true }), true);
        assert.equal(pvpOwnerSaveRefreshRequired({ claimSnapshotAdopted: false, saveChangedSinceClaim: false }), true);
    });

    it("the skipped report is the one the claim's terminal barrier already covers", () => {
        // The claim must await the terminal saga, and the saga must settle
        // Legacy, before a claim can confirm. If either link breaks, a
        // non-Vanguard winner would silently lose the Legacy repair.
        const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
        const claim = read("../../../api/pvp/claim-rewards.ts");
        const saga = read("../../../api/pvp/_committed-terminal-effects.ts");
        const report = read("../../../api/missions/report-pvp-win.ts");
        assert.match(claim, /committedTerminalReplay = await replayCommittedPvpTerminalEffects\(session, SEALED_TERMINAL_REPLAY\);\s*\}\s*\} catch \(error\) \{[\s\S]{0,400}?status\(503\)/);
        assert.match(saga, /await settlePvpLegacyProgress\(session\);/);
        assert.match(report, /await settlePvpLegacyProgress\(session\);[\s\S]*if \(char\?\.profession !== 'vanguard'\) \{[\s\S]{0,200}?vanguard: false/,
            "a non-Vanguard report does nothing beyond the Legacy replay");
    });
});

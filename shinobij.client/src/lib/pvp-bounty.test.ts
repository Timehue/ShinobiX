import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimBountyOnWin } from "./pvp-bounty";

function response(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("PvP bounty completion callback", () => {
    it("treats a legacy shared-connection 403 as a successful no-payout result", async () => {
        const result = await claimBountyOnWin(
            "Rill",
            "pvp-rill-dopey-shared-connection",
            undefined,
            async () => response(403, {
                error: "Bounty not paid: you and that player share a connection.",
            }),
        );

        assert.equal(result, null);
    });

    it("keeps unrelated authorization failures retryable", async () => {
        await assert.rejects(
            claimBountyOnWin(
                "Rill",
                "pvp-wrong-winner",
                undefined,
                async () => response(403, {
                    error: "Only the winner of that battle can claim its bounty.",
                }),
            ),
            /Only the winner of that battle can claim its bounty/,
        );
    });

    it("accepts the current server's explicit shared-connection no-payout response", async () => {
        const result = await claimBountyOnWin(
            "Rill",
            "pvp-rill-dopey-current-server",
            undefined,
            async () => response(200, {
                ok: true,
                amount: 0,
                voided: "shared-connection",
            }),
        );

        assert.equal(result, null);
    });
});

/*
 * A 409 after the sealed recovery window is a final no-payout answer about an
 * optional bounty. It must not re-trap the winner's durable PvP completion.
 * This call is the first remote step of App.handlePvpWin, so throwing here
 * previously kept the rest of battle completion pending.
 */
describe("PvP bounty claims that outlived their window", () => {
    it("settles a battle that is past the bounty recovery window", async () => {
        const result = await claimBountyOnWin(
            "Rill",
            "pvp-too-old-for-a-bounty",
            undefined,
            async () => response(409, { error: "That battle is too old to claim a bounty." }),
        );

        assert.equal(result, null);
    });

    it("settles a battle whose session and sealed snapshot have both expired", async () => {
        const result = await claimBountyOnWin(
            "Rill",
            "pvp-session-long-gone",
            undefined,
            async () => response(404, { error: "Battle session not found or expired." }),
        );

        assert.equal(result, null);
    });

    it("still rejects a throttle, an expired login and a server fault", async () => {
        for (const status of [429, 401, 500]) {
            await assert.rejects(
                claimBountyOnWin(
                    "Rill",
                    "pvp-retryable",
                    undefined,
                    async () => response(status, { error: `transient ${status}` }),
                ),
                new RegExp(`transient ${status}`),
                `HTTP ${status} can still succeed on the Retry the result screen offers`,
            );
        }
    });
});

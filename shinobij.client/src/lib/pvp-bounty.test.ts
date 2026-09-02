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

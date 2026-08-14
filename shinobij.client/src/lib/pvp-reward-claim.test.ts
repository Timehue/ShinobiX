import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postPvpRewardClaim } from "./pvp-reward-claim";

function response(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

describe("pvp-reward-claim", () => {
    it("authorizes callbacks only after an explicit successful first claim", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: false,
            rating: { field: "rankedRating", value: 1016, delta: 16 },
            base: { ryo: 175, xp: 250, level: 3 },
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

        assert.equal(result.status, "confirmed");
        if (result.status === "confirmed") {
            assert.equal(result.alreadyClaimed, false);
            assert.equal(result.rewardAuthorized, true);
            assert.deepEqual(result.rating, { field: "rankedRating", value: 1016, delta: 16 });
            assert.equal(result.base?.ryo, 175);
        }
    });

    it("confirms an authoritative replay without authorizing duplicate callbacks", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: true,
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

        assert.deepEqual(result, { status: "confirmed", alreadyClaimed: true, rewardAuthorized: false });
    });

    it("keeps non-2xx receipt failures retryable", async () => {
        const result = await postPvpRewardClaim(async () => response(503, {
            error: "Could not reserve the battle reward receipt. Please retry.",
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

        assert.deepEqual(result, {
            status: "retry",
            message: "Could not reserve the battle reward receipt. Please retry.",
        });
    });

    it("fails closed on malformed 2xx responses", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            alreadyClaimed: false,
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

        assert.equal(result.status, "retry");
    });

    it("keeps network failures retryable", async () => {
        const result = await postPvpRewardClaim(async () => {
            throw new Error("offline");
        }, { playerName: "rin", battleId: "battle-1", outcome: "loss" });

        assert.deepEqual(result, {
            status: "retry",
            message: "Could not reach the reward service. Your battle result is safe; retry to apply rewards.",
        });
    });
});

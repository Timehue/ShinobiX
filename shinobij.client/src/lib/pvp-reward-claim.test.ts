import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

    it("preserves the versioned character and exact raid projection on first claim and replay", async () => {
        const character = {
            name: "rin",
            profession: "vanguard",
            professionXp: 44,
            serverFieldMissionRuns: { "fetch-b": { missionId: "fetch-b", runId: "field-run-1", acceptedAt: 10 } },
            raidProgressionSettlements: [{
                version: 1 as const,
                proofId: "battle-1",
                proofAt: 19,
                fetchMissionsCredited: ["fetch-b"],
                xpAwarded: 30,
                missionsCompleted: [],
                bonusRyo: 50,
                bonusSeals: 2,
                territoryDamage: 250,
                sector: 44,
                settledAt: 20,
            }],
        };
        for (const alreadyClaimed of [false, true]) {
            const result = await postPvpRewardClaim(async () => response(200, {
                ok: true,
                alreadyClaimed,
                rewardAuthorized: true,
                character,
                _saveVersion: 51,
                raidProgression: {
                    fetchMissionsCredited: ["fetch-b", "fetch-b", ""],
                    missionsCompleted: [{ id: "vanguard-1", name: "Break the Line", xpReward: 30 }],
                    xpAwarded: 30,
                    bonusRyo: 50,
                    bonusSeals: 2,
                    territoryDamage: 250,
                    sector: 44,
                    replayed: alreadyClaimed,
                },
            }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

            assert.equal(result.status, "confirmed");
            if (result.status === "confirmed") {
                assert.equal(result.character?.professionXp, 44);
                assert.deepEqual(result.character?.serverFieldMissionRuns, character.serverFieldMissionRuns);
                assert.deepEqual(result.character?.raidProgressionSettlements, character.raidProgressionSettlements);
                assert.equal(result._saveVersion, 51);
                assert.deepEqual(result.raidProgression?.fetchMissionsCredited, ["fetch-b"]);
                assert.equal(result.raidProgression?.territoryDamage, 250);
                assert.equal(result.raidProgression?.sector, 44);
            }
        }
    });

    it("adopts a replay snapshot before returning and does not invoke legacy raid authority", () => {
        const screen = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const adopt = screen.indexOf("onRewardClaim?.(result)");
        const replayReturn = screen.indexOf("if (result.alreadyClaimed) return", adopt);
        assert.ok(adopt >= 0 && replayReturn > adopt, "lost-ACK replay must adopt the authoritative snapshot before exiting");
        assert.match(app, /const authoritativeCharacter = serverClaim\?\.character \?\? character/,
            "the win/loss callbacks must not overwrite a claim snapshot from a stale render");
        assert.match(app, /!serverClaim\?\.raidProgression/,
            "legacy raid reports must be suppressed when canonical claim progression exists");
        assert.ok(!screen.includes("damageSectorTerritory("), "the PvP claim UI must not write territory locally");
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

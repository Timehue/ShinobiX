import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    beginPvpRewardCompletion,
    completePvpRewardCompletion,
    postPvpRewardCompletionAck,
    postPvpRewardClaim,
    pvpBattleRewardSummary,
    pvpRewardSettlementNotice,
    readPvpOwnerSaveForContinuation,
    shouldRunPvpRewardCompletion,
    type PvpRewardCompletionStorage,
} from "./pvp-reward-claim";

function response(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

function memoryStorage(): PvpRewardCompletionStorage {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
    };
}

describe("pvp-reward-claim", () => {
    it("authorizes callbacks only after an explicit successful first claim", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: false,
            completionPending: true,
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
            completionPending: false,
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" });

        assert.deepEqual(result, {
            status: "confirmed",
            alreadyClaimed: true,
            completionPending: false,
            rewardAuthorized: false,
            // claim-rewards now reports progression authority alongside reward
            // authority. A replay authorizes neither, which is the point of this
            // case: an already-claimed battle must not re-run either callback.
            progressionAuthorized: false,
        });
    });

    it("preserves the authoritative Clan War scroll roll and explains both outcomes", async () => {
        for (const awarded of [0, 1] as const) {
            const result = await postPvpRewardClaim(async () => response(200, {
                ok: true,
                alreadyClaimed: false,
                completionPending: true,
                rewardAuthorized: true,
                progressionAuthorized: true,
                clanWarScrollDrop: { awarded, chancePercent: 20 },
            }), { playerName: "rin", battleId: `clan-war-${awarded}`, outcome: "win" });

            assert.equal(result.status, "confirmed");
            if (result.status !== "confirmed") continue;
            assert.deepEqual(result.clanWarScrollDrop, { awarded, chancePercent: 20 });
            const notice = pvpRewardSettlementNotice(result, { draw: false, spar: false });
            if (awarded === 1) {
                assert.match(notice, /Scroll dropped.*\+1 added to your inventory/i);
            } else {
                assert.match(notice, /no Territory Control Scroll.*20% chance/i);
            }
        }
    });

    it("projects exact server rewards for the battle result panel", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: false,
            completionPending: true,
            rewardAuthorized: true,
            progressionAuthorized: true,
            rating: { field: "rankedRating", value: 1016, delta: 16 },
            base: {
                ryo: 175,
                reward: { ryo: 75, combatGrowth: 4, auraDust: 6 },
            },
            warGroundReward: {
                fresh: true,
                bountyCredited: true,
                raidProgress: 1,
                ryoAwarded: 500,
                fateShardsAwarded: 1,
            },
            raidProgression: {
                fetchMissionsCredited: [],
                missionsCompleted: [],
                xpAwarded: 30,
                bonusRyo: 50,
                bonusSeals: 2,
                territoryDamage: 250,
                sector: 44,
                replayed: false,
            },
            warPoints: { awarded: 50, kind: "clan" },
            clanWarScrollDrop: { awarded: 1, chancePercent: 20 },
        }), { playerName: "rin", battleId: "reward-panel", outcome: "win" });

        assert.equal(result.status, "confirmed");
        if (result.status !== "confirmed") return;
        assert.deepEqual(pvpBattleRewardSummary(result), {
            ryo: 625,
            combatGrowth: 4,
            professionXp: 30,
            auraDust: 6,
            fateShards: 1,
            honorSeals: 2,
            territoryScrolls: 1,
            warPoints: 50,
            warPointKind: "clan",
            ratingDelta: 16,
        });
    });

    it("rejects malformed Clan War scroll projections instead of inventing reward copy", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: false,
            completionPending: true,
            rewardAuthorized: true,
            progressionAuthorized: true,
            clanWarScrollDrop: { awarded: 2, chancePercent: 20 },
        }), { playerName: "rin", battleId: "clan-war-malformed", outcome: "win" });

        assert.equal(result.status, "confirmed");
        if (result.status === "confirmed") assert.equal(result.clanWarScrollDrop, undefined);
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
                completionPending: !alreadyClaimed,
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

    it("replays lost-ack callbacks exactly once for the bound account, battle, and outcome", async () => {
        const storage = memoryStorage();
        const request = { playerName: " Rin ", battleId: "battle-1", outcome: "win" as const };
        const now = Date.now();
        beginPvpRewardCompletion(storage, request, now);

        const lostAck = await postPvpRewardClaim(async () => {
            // The server may already have committed its receipt; the browser
            // observes only the dropped acknowledgement.
            throw new Error("response lost after commit");
        }, request);
        assert.equal(lostAck.status, "retry");
        const replay = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: true,
            completionPending: true,
            rewardAuthorized: true,
        }), request);
        assert.equal(replay.status, "confirmed");
        if (replay.status === "confirmed") assert.equal(replay.alreadyClaimed, true);

        assert.equal(shouldRunPvpRewardCompletion(storage, request, true, now + 1), true,
            "an alreadyClaimed retry must repair callbacks skipped with the lost acknowledgement");
        assert.equal(shouldRunPvpRewardCompletion(storage, { ...request, playerName: "other" }, false, now + 1), false);
        assert.equal(shouldRunPvpRewardCompletion(storage, { ...request, battleId: "battle-2" }, false, now + 1), false);
        assert.equal(shouldRunPvpRewardCompletion(storage, { ...request, outcome: "loss" }, false, now + 1), false);

        completePvpRewardCompletion(storage, request, now + 2);
        assert.equal(shouldRunPvpRewardCompletion(storage, request, true, now + 2), false,
            "a completed browser continuation must not replay again");
        beginPvpRewardCompletion(storage, request, now + 3);
        assert.equal(shouldRunPvpRewardCompletion(storage, request, true, now + 3), false,
            "an ordinary remount must preserve, not overwrite, the completed fence");
        assert.equal(shouldRunPvpRewardCompletion(null, request, false, now + 2), false,
            "a completed server continuation never runs callbacks");
        assert.equal(shouldRunPvpRewardCompletion(null, request, true, now + 2), true,
            "server-pending completion repairs callbacks even when localStorage is unavailable");

        const ackBodies: Array<Record<string, unknown>> = [];
        const ack = await postPvpRewardCompletionAck(async (_input, init) => {
            ackBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
            return response(200, { ok: true, completionPending: false });
        }, request);
        assert.deepEqual(ack, { status: "confirmed" });
        assert.equal(ackBodies[0]?.completionAck, true);
        assert.equal(ackBodies[0]?.completionVersion, 1);
    });

    it("treats a participant draw as a durable completion obligation without a win or loss payout", async () => {
        const result = await postPvpRewardClaim(async () => response(200, {
            ok: true,
            alreadyClaimed: false,
            completionPending: true,
            rewardAuthorized: false,
            progressionAuthorized: false,
        }), { playerName: "rin", battleId: "battle-draw", outcome: "draw" });
        assert.deepEqual(result, {
            status: "confirmed",
            alreadyClaimed: false,
            completionPending: true,
            rewardAuthorized: false,
            progressionAuthorized: false,
        });
    });

    it("adopts a replay snapshot before durable completion and does not invoke legacy raid authority", () => {
        const screen = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
        const resultPanel = readFileSync(new URL("../components/PvpBattleResultPanel.tsx", import.meta.url), "utf8");
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const serverClaim = readFileSync(new URL("../../../api/pvp/claim-rewards.ts", import.meta.url), "utf8");
        const adopt = screen.indexOf("await bounded(onRewardClaim?.(result, continuationContext))");
        const complete = screen.indexOf("completePvpRewardCompletion(completionStorage, claimRequest)", adopt);
        assert.ok(adopt >= 0 && complete > adopt,
            "lost-ACK replay must adopt the authoritative snapshot before sealing callback completion");
        assert.match(screen, /beginPvpRewardCompletion\(completionStorage, claimRequest\)[\s\S]*claimTimeout[\s\S]*postPvpRewardClaim/,
            "completion intent must be durable before a bounded claim can abort or lose acknowledgement");
        assert.match(screen, /completePvpRewardCompletion\(completionStorage, claimRequest\)[\s\S]*postPvpRewardCompletionAck/,
            "the server completion receipt must be acknowledged only after callbacks finish");
        assert.match(serverClaim, /reservePvpRewardCompletion\([\s\S]*completionPending: out\.completionPending/,
            "claim success must expose the durable callback obligation");
        assert.match(serverClaim, /if \(completionAck\)[\s\S]*acknowledgePvpRewardCompletion/,
            "the authenticated claim route must own completion acknowledgement");
        assert.match(app, /if \(claim\.character[\s\S]*commitVersionedCharacter\(claim\.character, claim\._saveVersion\)/,
            "the claim callback must adopt the exact authoritative snapshot before later continuations");
        assert.match(app, /context\?\.raidKind === "raidPlayer"[\s\S]*!serverClaim\?\.raidProgression/,
            "legacy raid repair is attacker-only; a defending winner without progression must still ACK");
        assert.match(app, /const pvpSettlementScopeKey = `\$\{playerSlug\(pvpOriginatingPlayerName\)\}:\$\{pvpOriginatingSessionEpoch\}:\$\{pvpRole\}:\$\{pvpBattleId\}`/,
            "same-browser participant switches must not share a completion projection fence");
        assert.match(app, /pvpCompletionUiRef\.current\.has\(pvpSettlementScopeKey\)/);
        assert.match(app, /appliedRaidReportUiRef\.current\.has\(pvpSettlementScopeKey\)/);
        assert.match(app, /pvpContinuationResultRef\.current\.get\(pvpSettlementScopeKey\)/);
        assert.match(screen, /const outcome: "win" \| "loss" \| "draw" = isDrawNow \? "draw"/,
            "participant draws must use the same durable claim protocol");
        assert.match(resultPanel, /if \(state === "failed"\)[\s\S]*onClick=\{onRetry\}>Retry/,
            "draw failures must expose the retry UI instead of silently enabling exit");
        assert.match(screen, /settlementState=\{pvpRewardClaimState\}[\s\S]*onRetrySettlement=\{\(\) => \{ void claimResolvedPvpReward\(\); \}\}/,
            "the result panel retry must resubmit the authoritative claim");
        assert.match(resultPanel, /const exitsEnabled = isSpectator \|\| settlementState === "confirmed"/,
            "every participant outcome, including draw, must stay fenced until completion ACK");
        assert.match(resultPanel, /onClick=\{onReturnToBattlefield\} disabled=\{!exitsEnabled\}/,
            "only the contextual battlefield return is settlement-gated");
        assert.match(screen, /battleTabs\.setTab\("log"\);[\s\S]*setShowResultPanel\(false\)/,
            "the Battle Log action must reveal the final inline log instead of navigating away");
        assert.ok(!resultPanel.includes("Return to Village"),
            "the result panel must not offer a generic village escape");
        assert.match(serverClaim, /if \(terminalIsDraw\)[\s\S]*await replayCommittedPvpTerminalEffects\(session\)/,
            "draw claims must help forward official terminal effects before completion");
        const pvpMount = app.slice(
            app.indexOf('{screen === "pvpBattle"'),
            app.indexOf('{!activeTriggeredEvent && screen === "bloodlineMaker"'),
        );
        assert.ok(!pvpMount.includes("autoReportClanWarBattleResult"),
            "server-owned Clan War PvP must not invoke the legacy browser report after claim");
        // The Clan War settlement moved into the shared terminal-effects replay,
        // which claim-rewards invokes for either participant. Asserting it there
        // keeps the guarantee — one terminal row settles the accepted challenge
        // regardless of which side claims — while following the call.
        const terminalEffects = readFileSync(
            new URL("../../../api/pvp/_committed-terminal-effects.ts", import.meta.url), "utf8");
        assert.match(terminalEffects, /await settlePvpClanWarContinuation\(session\)/,
            "either participant claim must help the sealed Clan War result forward");
        assert.match(serverClaim, /replayCommittedPvpTerminalEffects\(session\)/,
            "the claim must route through the replay that owns that settlement");
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

    it("forwards cancellation so a replaced account or unmounted screen cannot leave a claim hanging", async () => {
        const abort = new AbortController();
        let receivedSignal: AbortSignal | null = null;
        const pending = postPvpRewardClaim((_input, init) => new Promise((_resolve, reject) => {
            receivedSignal = init.signal ?? null;
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        }), { playerName: "rin", battleId: "battle-1", outcome: "win" }, { signal: abort.signal });

        abort.abort();
        assert.equal(receivedSignal, abort.signal);
        assert.deepEqual(await pending, {
            status: "retry",
            message: "Could not reach the reward service. Your battle result is safe; retry to apply rewards.",
        });
    });

    it("keeps extracted save continuations abortable and owner-bound", async () => {
        const abort = new AbortController();
        const continuation = { signal: abort.signal, isCurrentScope: () => true };
        await assert.rejects(
            readPvpOwnerSaveForContinuation("rin", continuation, (async () => new Response(JSON.stringify({
                character: { name: "foreign" },
                _saveVersion: 4,
            }), { status: 200 })) as typeof fetch),
            /foreign save/,
        );
        abort.abort();
        await assert.rejects(readPvpOwnerSaveForContinuation("rin", continuation, fetch), /PvP completion scope changed/);
    });
});

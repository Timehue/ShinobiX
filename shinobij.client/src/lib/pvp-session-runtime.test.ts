import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PvpSessionState } from "../types/pvp-ui";
import {
    abortableDelay,
    createPvpContinuationFence,
    decidePvpSessionRevision,
    fetchInitialPvpProjection,
    parsePvpSessionProjection,
    pvpRuntimeScopeKey,
    splitPvpMoveResponse,
} from "./pvp-session-runtime";
import { bindPvpSessionCreateIntent, clearPvpSessionCreateIntent } from "./pvp-session-intent";

function fighter(name: string, pos: number) {
    return {
        name,
        hp: 100,
        maxHp: 100,
        chakra: 80,
        maxChakra: 80,
        stamina: 60,
        maxStamina: 60,
        shield: 0,
        statuses: [],
        character: { name, jutsu: [] },
        pos,
    };
}

function projection(stateRevision: number, patch: Partial<PvpSessionState> = {}): PvpSessionState {
    return {
        battleId: "battle-1",
        stateRevision,
        p1: fighter("Kaya", 0),
        p2: fighter("Ren", 1),
        round: 1,
        activePlayer: "p1",
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ["Battle begins."],
        status: "active",
        winner: null,
        ...patch,
    };
}

describe("PvP live-session projection authority", () => {
    it("accepts only a structurally valid, exactly bound, revisioned session", () => {
        const parsed = parsePvpSessionProjection(projection(4), "battle-1");
        assert.equal(parsed.kind, "session");
        if (parsed.kind === "session") assert.equal(parsed.session.stateRevision, 4);

        assert.equal(parsePvpSessionProjection(projection(4), "battle-2").kind, "invalid");
        assert.equal(parsePvpSessionProjection({ ...projection(4), stateRevision: 0 }, "battle-1").kind, "invalid");
        const { stateRevision: _removed, ...legacy } = projection(4);
        const legacyParsed = parsePvpSessionProjection(legacy, "battle-1");
        assert.equal(legacyParsed.kind, "session");
        if (legacyParsed.kind === "session") assert.equal(legacyParsed.session.stateRevision, 0);
        assert.equal(parsePvpSessionProjection({ ...projection(4), p1: { name: "Kaya" } }, "battle-1").kind, "invalid");
        assert.equal(parsePvpSessionProjection({ error: "not a session" }, "battle-1").kind, "invalid");
    });

    it("classifies ranked close records as terminal control data, never renderable combat", () => {
        for (const version of [
            "player-ranked-session-close-tombstone-v1",
            "player-ranked-session-orphan-tombstone-v1",
        ]) {
            const parsed = parsePvpSessionProjection({ version, battleId: "battle-1" }, "battle-1");
            assert.deepEqual(parsed, {
                kind: "terminal",
                message: "This ranked battle ended as a no-contest.",
            });
        }
        const fenced = parsePvpSessionProjection({
            ...projection(9),
            ranked: false,
            rankedKind: "player",
            playerRankedAuthorityVersion: 2,
            rankedMatchId: "player-ranked-fenced",
            rankedSeasonId: 4,
            rankedSeasonEpoch: 6,
            rewardAuthority: "ranked",
            baseRewards: false,
            rankedCloseFence: {
                version: "player-ranked-session-close-fence-v1",
                matchId: "player-ranked-fenced",
                seasonId: 4,
                seasonEpoch: 6,
                transitionId: "ranked-season-4-5",
                fencedAt: 100,
            },
        }, "battle-1");
        assert.equal(fenced.kind, "terminal", "a close fence is already no-contest authority before tombstone cleanup");
    });

    it("rejects late, duplicate, and foreign transport frames", () => {
        const current = projection(8);
        assert.equal(decidePvpSessionRevision(current, projection(9)), "accept");
        assert.equal(decidePvpSessionRevision(current, projection(8)), "duplicate");
        assert.equal(decidePvpSessionRevision(current, projection(7)), "stale");
        assert.equal(decidePvpSessionRevision(current, projection(9, { battleId: "battle-2" })), "foreign");
        assert.equal(decidePvpSessionRevision(null, projection(1)), "accept");
        assert.equal(decidePvpSessionRevision(current, projection(8, { round: 2 })), "conflict");
        assert.equal(decidePvpSessionRevision(
            projection(0),
            projection(0, { status: "done", winner: "p1" }),
        ), "accept", "a legacy equal-revision terminal must replace its active predecessor");
    });

    it("compares a same-revision soft rejection without response-only envelope metadata", () => {
        const current = projection(8);
        const envelope = splitPvpMoveResponse({
            ...current,
            rejected: { applied: false, reason: "Target is out of range.", serverRound: 1, activePlayer: "p1" },
        });
        const parsed = parsePvpSessionProjection(envelope.projection, current.battleId);
        assert.equal(parsed.kind, "session");
        if (parsed.kind === "session") assert.equal(decidePvpSessionRevision(current, parsed.session), "duplicate");
        assert.equal(envelope.rejected?.reason, "Target is out of range.");
    });

    it("bounded-retries an initial 404 until the authoritative session is observed", async () => {
        const statuses = [404, 404, 200];
        const waits: number[] = [];
        let calls = 0;
        const result = await fetchInitialPvpProjection({
            battleId: "battle-1",
            attempts: 5,
            wait: async (ms) => { waits.push(ms); },
            fetchSession: async () => {
                const status = statuses[calls++] ?? 500;
                return {
                    ok: status === 200,
                    status,
                    async json() { return projection(3); },
                };
            },
        });

        assert.equal(calls, 3);
        assert.deepEqual(waits, [350, 700]);
        assert.equal(result.kind, "session");
        if (result.kind === "session") assert.equal(result.session.stateRevision, 3);
    });

    it("treats 409 as immediate terminal authority but only accepts 404 after the retry bound", async () => {
        let conflictCalls = 0;
        const conflict = await fetchInitialPvpProjection({
            battleId: "battle-1",
            attempts: 5,
            wait: async () => undefined,
            fetchSession: async () => {
                conflictCalls += 1;
                return { ok: false, status: 409, async json() { return {}; } };
            },
        });
        assert.equal(conflictCalls, 1);
        assert.equal(conflict.kind, "terminal");

        let missingCalls = 0;
        const missing = await fetchInitialPvpProjection({
            battleId: "battle-1",
            attempts: 4,
            wait: async () => undefined,
            fetchSession: async () => {
                missingCalls += 1;
                return { ok: false, status: 404, async json() { return {}; } };
            },
        });
        assert.equal(missingCalls, 4);
        assert.equal(missing.kind, "missing");
    });
});

describe("PvP create retry authority", () => {
    it("reuses one unguessable battle capability for an ambiguous create response", () => {
        clearPvpSessionCreateIntent();
        const payload = { p1Character: { name: "Kaya" }, p2Character: { name: "Ren" } };
        const first = bindPvpSessionCreateIntent(payload) as Record<string, unknown>;
        const retry = bindPvpSessionCreateIntent({ ...payload }) as Record<string, unknown>;
        assert.match(String(first.battleId), /^pvp-[0-9a-f-]{36}$/);
        assert.equal(retry.battleId, first.battleId);

        const different = bindPvpSessionCreateIntent({
            p1Character: { name: "Kaya" },
            p2Character: { name: "Mio" },
        }) as Record<string, unknown>;
        assert.notEqual(different.battleId, first.battleId);
        clearPvpSessionCreateIntent();
    });
});

describe("PvP async continuation scope", () => {
    it("fences account replacement, Strict Mode reactivation, and unmount", () => {
        const fence = createPvpContinuationFence();
        const firstScope = pvpRuntimeScopeKey(" Kaya ", 4, "battle-1", "p1");
        fence.activate(firstScope);
        const firstRequest = fence.capture();
        assert.equal(firstRequest(), true);

        fence.activate(firstScope);
        assert.equal(firstRequest(), false, "a discarded Strict Mode setup must stay discarded");
        const strictReplay = fence.capture();
        assert.equal(strictReplay(), true);

        fence.activate(pvpRuntimeScopeKey("Kaya", 5, "battle-1", "p1"));
        assert.equal(strictReplay(), false, "same-account reauthentication must replace the old authority epoch");
        const replacement = fence.capture();
        fence.invalidate();
        assert.equal(replacement(), false, "an unmounted screen cannot resume an async callback");
    });

    it("aborts backoff immediately when its lifecycle scope is retired", async () => {
        const controller = new AbortController();
        const started = Date.now();
        const pending = abortableDelay(5_000, controller.signal);
        controller.abort();
        await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
        assert.ok(Date.now() - started < 500);
    });
});

describe("PvP reliability source wiring", () => {
    it("threads revision, terminal parsing, and account epoch through every authority boundary", () => {
        const screen = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const serverSession = readFileSync(new URL("../../../api/pvp/session.ts", import.meta.url), "utf8");
        const serverMove = readFileSync(new URL("../../../api/pvp/move.ts", import.meta.url), "utf8");
        const mutation = readFileSync(new URL("../../../api/pvp/_session-mutation.ts", import.meta.url), "utf8");
        const terminalEffects = readFileSync(new URL("../../../api/pvp/_committed-terminal-effects.ts", import.meta.url), "utf8");
        const stream = readFileSync(new URL("../../../api/pvp/stream.ts", import.meta.url), "utf8");

        assert.match(serverSession, /stateRevision: INITIAL_PVP_STATE_REVISION/);
        assert.match(serverSession, /pvpSessionHasRankedCloseFence\(sessionRaw\)/,
            "the authoritative GET must expose a close-fenced row as terminal no-contest");
        assert.match(serverSession, /session\.status === 'done'[\s\S]*ensurePvpTerminalRecoveryPublication\(kv, battleId, session\)[\s\S]*status\(503\)/,
            "terminal GET must help-forward mandatory storage-independent recovery before returning success");
        assert.match(serverMove, /withPvpActionReceiptReplay\(session, result,[\s\S]*commitPvpSessionMutation\(kv, key, session, receiptCandidate/);
        assert.match(serverMove, /const persisted = write\.session;[\s\S]*replayCommittedPvpActionReceipt\(kv, persisted\)[\s\S]*helpCommittedTerminal\(persisted\)/,
            "terminal effects must consume only an acknowledged exact-CAS winner");
        assert.match(serverMove, /if \(!isPvpSessionRow\(sessionMaybe, battleId\)\)[\s\S]*let session: PvpSession = sessionMaybe/,
            "tombstones must be rejected before fighter ownership dereferences");
        assert.match(mutation, /JSON\.parse\(JSON\.stringify\(candidate\)\)/,
            "the exact-CAS candidate must match remote JSON readback bytes");
        assert.match(terminalEffects, /buildBattleReceipt\(session, committedTerminalAt\(session\)\)/,
            "terminal receipt replay must use an immutable timestamp");
        assert.match(terminalEffects, /await ensurePvpTerminalRecoveryPublication\(kv, session\.battleId, session\)/,
            "terminal move success must wait for the recovery snapshot and player discovery pointers");
        assert.match(terminalEffects, /recordPendingKageSettle\(pointer\.village, session, pointer\.challengeId\)[\s\S]*settleKageDuelFromSession/,
            "an official Kage pointer must be durably settled from the committed terminal row");
        assert.match(terminalEffects, /if \(!settled\.ok\)[\s\S]*throw new Error\(`kage-settlement-unconfirmed/,
            "Kage settlement refusal must keep reward completion retryable");
        assert.ok(!serverMove.includes("async function saveSession("),
            "no move path may retain an unconditional session overwrite helper");

        assert.match(screen, /acceptSession\(JSON\.parse\(\(e as MessageEvent\)\.data\)\)/);
        assert.match(screen, /subscribeKvKey<unknown>/);
        assert.match(screen, /acceptRevision\(current, parsed\.session\)/,
            "every parsed authority frame must pass through the conflict-aware revision fence");
        assert.match(screen, /endSession\("The battle session is unavailable or expired\."\)/);
        assert.match(screen, /function stopLiveTransports\(\): void \{[\s\S]*?transportAbort\.abort\(\)/,
            "terminal and unmount paths must stop stale transport continuations");
        assert.match(stream, /sendEvent\('end', \{ reason: 'ranked-no-contest' \}\)/);
        assert.match(stream, /pvpSessionHasRankedCloseFence/,
            "the live stream must not keep rendering a close-fenced active row");
        assert.match(screen, /A seed is first-paint data, not current authority\.[\s\S]*void fetchInitial\(\);/,
            "a seed must never suppress the authoritative mount GET");
        // fetchPendingPvpRecovery gained an abort/timeout options argument, so the
        // call no longer closes immediately after character.name. The ordering
        // this pins — probe first, allow exit only on proof — is unchanged.
        assert.match(screen, /verifyPendingSessionBeforeExit[\s\S]*fetchPendingPvpRecovery\(fetch, character\.name[,)][\s\S]*setSessionExitCheck\("safe"\)/,
            "an unavailable battle may expose destructive exit only after authenticated pending-session proof");
        assert.match(screen, /sessionExitCheck === "safe"[\s\S]*Return Safely/,
            "transient GET failure must keep the same-mount retry/recovery controller alive");
        const sectorCreate = app.slice(
            app.indexOf("sectorAttackPlayer={async"),
            app.indexOf('{!activeTriggeredEvent && screen === "sunscarFestival"'),
        );
        // The reconciliation moved into lib/pvp-session-create.ts: it derives the
        // stable battle id, probes the authenticated pending index when a create
        // is ambiguous, and only reports "created" when the pointer matches. App
        // installs whatever that helper recovered, in the same mount.
        const creator = readFileSync(new URL("./pvp-session-create.ts", import.meta.url), "utf8");
        assert.match(creator, /const stableBattleId = pvpStableBattleIdFromRequestBody\(requestBody\)[\s\S]*fetchPendingPvpRecovery\(fetchFn, playerName[\s\S]*pending\?\.battleId === stableBattleId/,
            "an ambiguous create must reconcile against the authenticated pending pointer");
        assert.match(sectorCreate, /createPvpSessionWithRecovery\([\s\S]*createResult\.kind === "recovered"[\s\S]*installPvpRecovery\(createResult\.pending\)/,
            "the sector create must install the reconciled pointer in the same mount");
        // This invariant is implemented inline in the creator rather than through
        // decidePvpCreateRecovery (which is currently exported and unit-tested but
        // has no production caller). When the pending lookup throws — offline —
        // the creator still returns ambiguous carrying the stable battle id, and
        // App installs it, which is what keeps bounded GET recovery possible.
        assert.match(creator, /catch \(error\) \{[\s\S]{0,200}return \{ kind: "ambiguous", battleId: stableBattleId, error: lastError \};/,
            "an offline pending lookup must retain the stable create identity for bounded GET recovery");
        assert.match(sectorCreate, /createResult\.kind === "ambiguous"[\s\S]{0,120}setPvpBattleId\(battleId\)/,
            "the sector create must install that retained identity");
        const notification = sectorCreate.slice(sectorCreate.indexOf("fetch('/api/player/challenge'"));
        assert.ok(!notification.includes("setPvpBattleId('')") && !notification.includes('setScreen("worldMap")'),
            "post-publication defender notification failure must not abandon the live session");

        // The remount key tightened: it now also carries the originating player
        // and role, so a different account or side cannot reuse a mounted battle
        // screen. Strictly narrower than the old battleId:epoch pair.
        assert.match(app, /key=\{`\$\{playerSlug\(pvpOriginatingPlayerName\)\}:\$\{pvpOriginatingSessionEpoch\}:\$\{pvpRole\}:\$\{pvpBattleId\}`\}/);
        assert.match(app, /accountSessionEpoch=\{saveSessionEpochRef\.current\}/);
        assert.match(screen, /postPvpRewardClaim\(fetch,[\s\S]*?\{ signal: claimAbort\.signal \}\)/);
        assert.match(screen, /beginPvpRewardCompletion\(completionStorage, claimRequest\)[\s\S]*claimTimeout/,
            "a bounded reward abort must have durable lost-ack replay intent first");
        assert.match(screen, /completePvpRewardCompletion\(completionStorage, claimRequest\)[\s\S]*postPvpRewardCompletionAck/,
            "server completion is ACKed only after awaited App callbacks finish");
        assert.match(screen, /if \(!isCurrentScope\(\)\) return;/);
    });
});

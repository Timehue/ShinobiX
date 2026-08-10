import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    arenaSelectionCount,
    assignArenaSelectionSlot,
    clearArenaSelectionSlot,
    isExactAvailableArenaSelection,
    normalizeArenaSelection,
} from "./arena-selection.ts";
import { PlayerRequestOwner } from "./player-request-owner.ts";
import {
    arenaPvpRecoveryKey,
    clearArenaPvpRecovery,
    ingestChallengeInboxEntry,
    parseOpaqueAcceptedArenaNotice,
    readArenaPvpRecovery,
    recoveredChallengeMatches,
    recoveryFromOpaqueArenaNotice,
    writeArenaPvpRecovery,
    type ArenaPvpRecovery,
} from "./arena-pvp-recovery.ts";
import {
    arenaCoopRecoveryKey,
    clearArenaCoopRecovery,
    readArenaCoopRecovery,
    shouldRetainArenaCoopRecovery,
    writeArenaCoopRecovery,
} from "./arena-coop-recovery.ts";

test("co-op reconnect codes are account-scoped and expire without crossing identities", () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
    const createdAt = Date.now();
    assert.equal(writeArenaCoopRecovery({ version: 1, normalizedPlayerName: "kakashi", code: "ABCDEFGH", createdAt }, storage), true);
    assert.notEqual(arenaCoopRecoveryKey("Kakashi"), arenaCoopRecoveryKey("Obito"));
    assert.equal(readArenaCoopRecovery("Obito", storage, createdAt + 1_000), null);
    assert.equal(readArenaCoopRecovery("KAKASHI", storage, createdAt + 1_000)?.code, "ABCDEFGH");
    assert.equal(readArenaCoopRecovery("Kakashi", storage, createdAt + 46 * 60_000), null);
    assert.equal(values.has(arenaCoopRecoveryKey("Kakashi")!), false, "expired recovery is removed");

    assert.equal(writeArenaCoopRecovery({ version: 1, normalizedPlayerName: "kakashi", code: "ABCDEFGH", createdAt }, storage), true);
    clearArenaCoopRecovery("Kakashi", "OTHER123", storage);
    assert.ok(readArenaCoopRecovery("Kakashi", storage, createdAt + 1_000));
    clearArenaCoopRecovery("Kakashi", "ABCDEFGH", storage);
    assert.equal(readArenaCoopRecovery("Kakashi", storage, createdAt + 1_000), null);
});

test("co-op recovery survives an interrupted replay but not a completed result exit", () => {
    assert.equal(shouldRetainArenaCoopRecovery("running", false), true);
    assert.equal(shouldRetainArenaCoopRecovery("running", true), false);
    assert.equal(shouldRetainArenaCoopRecovery("lobby", false), false);
    assert.equal(shouldRetainArenaCoopRecovery(null, false), false);

    const lobbySource = readFileSync(new URL("../components/ArenaCoopLobby.tsx", import.meta.url), "utf8");
    assert.match(lobbySource, /onResult=\{\(\) => \{[\s\S]{0,220}clearArenaCoopRecovery\(myName, lobby\.code\)/,
        "a completed result must clear recovery immediately, even if the tab closes before Exit");
});

test("the exact server opaque notice bypasses Character normalization and begins authenticated recovery", () => {
    const notice = {
        id: "arena-private-1",
        arenaMatch: true,
        accepted: true,
        declined: false,
        fromName: "Obito",
        toName: "Kakashi",
        challengerSetupSealed: true,
        recoveryRequired: true,
    } as const;
    let normalizerCalls = 0;
    const ingested = ingestChallengeInboxEntry(notice, () => {
        normalizerCalls += 1;
        throw new Error("opaque notices have no challenger to normalize");
    });
    assert.deepEqual(ingested, notice);
    assert.equal(normalizerCalls, 0);
    assert.deepEqual(recoveryFromOpaqueArenaNotice(ingested, " KAKASHI ", 1234), {
        version: 1,
        challengeId: "arena-private-1",
        playerName: " KAKASHI ",
        counterpartName: "Obito",
        role: "challenger",
        createdAt: 1234,
    });
    assert.equal(parseOpaqueAcceptedArenaNotice({ ...notice, petBattleSeed: 99 }), null,
        "a public notice with leaked or unexpected reveal fields is not accepted as the minimal wake-up shape");
});

test("slot assignments swap in place and clearing a lane never shifts another lane", () => {
    const original = ["top-pet", "mid-pet", "bottom-pet", "flex-pet"];
    assert.deepEqual(assignArenaSelectionSlot(original, 0, "bottom-pet", 4),
        ["bottom-pet", "mid-pet", "top-pet", "flex-pet"]);
    assert.deepEqual(clearArenaSelectionSlot(original, 1, 4),
        ["top-pet", "", "bottom-pet", "flex-pet"]);
    assert.deepEqual(original, ["top-pet", "mid-pet", "bottom-pet", "flex-pet"]);
});

test("start eligibility requires exactly four unique ids from the current available roster", () => {
    const available = new Set(["a", "b", "c", "d", "e"]);
    assert.equal(isExactAvailableArenaSelection(["a", "b", "c", "d"], available, 4), true);
    assert.equal(isExactAvailableArenaSelection(["a", "b", "c", "c"], available, 4), false);
    assert.equal(isExactAvailableArenaSelection(["a", "b", "c", "gone"], available, 4), false);
    assert.equal(isExactAvailableArenaSelection(["a", "b", "c", ""], available, 4), false);
    assert.equal(isExactAvailableArenaSelection(["a", "b", "c", "d", "e"], available, 4), false);
    assert.equal(arenaSelectionCount(normalizeArenaSelection(["a", "a", "c"], 4)), 2);
});

test("an account swap aborts a delayed request and prevents its stale settlement", async () => {
    const owner = new PlayerRequestOwner();
    owner.activate("Kakashi");
    const oldAttempt = owner.begin("arena-accept", "Kakashi");
    assert.ok(oldAttempt);

    let resolveResponse!: () => void;
    const delayedResponse = new Promise<void>((resolve) => { resolveResponse = resolve; });
    let appliedTo = "";
    const settle = delayedResponse.then(() => {
        if (owner.isCurrent(oldAttempt)) appliedTo = oldAttempt.playerName;
    });

    owner.activate("Obito");
    const newAttempt = owner.begin("arena-accept", "Obito");
    assert.ok(newAttempt);
    assert.equal(oldAttempt.controller.signal.aborted, true);
    resolveResponse();
    await settle;
    assert.equal(appliedTo, "");
    assert.equal(owner.isCurrent(newAttempt), true);

    // An old finally block cannot finish or clear the newer attempt.
    assert.equal(owner.finish(oldAttempt), false);
    assert.equal(owner.current("arena-accept"), newAttempt);
});

test("PvP recovery is account-scoped and validates both challenger and responder seats", () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
    const createdAt = Date.now();
    const challenger: ArenaPvpRecovery = { version: 1, challengeId: "match-1", playerName: "Kakashi", counterpartName: "Obito", role: "challenger", createdAt };
    const responder: ArenaPvpRecovery = { version: 1, challengeId: "match-1", playerName: "Obito", counterpartName: "Kakashi", role: "responder", createdAt };
    const accepted = {
        id: "match-1", accepted: true, fromName: "Obito", toName: "Kakashi",
        challenger: { name: "Kakashi" }, challengerWarfrontSetup: {}, responderWarfrontSetup: {},
    };
    assert.equal(writeArenaPvpRecovery(challenger, storage), true);
    assert.equal(writeArenaPvpRecovery(responder, storage), true);
    assert.notEqual(arenaPvpRecoveryKey("Kakashi"), arenaPvpRecoveryKey("Obito"));
    assert.deepEqual(readArenaPvpRecovery("KAKASHI", storage, createdAt + 1_000), challenger);
    assert.deepEqual(readArenaPvpRecovery("obito", storage, createdAt + 1_000), responder);
    assert.equal(recoveredChallengeMatches(challenger, accepted), true);
    assert.equal(recoveredChallengeMatches(responder, accepted), true);
    assert.equal(recoveredChallengeMatches(challenger, {
        id: "match-1", accepted: true, fromName: "Obito", toName: "Kakashi",
    }), false, "an opaque anon-readable notice is never mistaken for the authenticated reveal");
    assert.equal(recoveredChallengeMatches({ ...responder, playerName: "Sakura" }, accepted), false);
    clearArenaPvpRecovery("Kakashi", "another-match", storage);
    assert.ok(readArenaPvpRecovery("Kakashi", storage, createdAt + 1_000));
    clearArenaPvpRecovery("Kakashi", "match-1", storage);
    assert.equal(readArenaPvpRecovery("Kakashi", storage, createdAt + 1_000), null);

    const corruptKey = arenaPvpRecoveryKey("Sakura")!;
    values.set(corruptKey, "{not-json");
    assert.equal(readArenaPvpRecovery("Sakura", storage, createdAt + 1_000), null);
    assert.equal(values.has(corruptKey), false, "malformed scoped recovery is removed once");
});

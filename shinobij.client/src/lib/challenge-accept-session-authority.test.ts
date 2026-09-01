import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `missing source-contract start: ${startNeedle}`);
    assert.ok(end > start, `missing source-contract end: ${endNeedle}`);
    return source.slice(start, end);
}

function assertOrdered(source: string, needles: readonly string[], label: string): void {
    let cursor = 0;
    for (const needle of needles) {
        const next = source.indexOf(needle, cursor);
        assert.ok(next >= cursor, `${label}: ${needle} must follow offset ${cursor}`);
        cursor = next + needle.length;
    }
}

const petAccept = sliceBetween(
    appSource,
    "async function acceptPetChallengeGlobal",
    "// Fetch full server player list",
);
const playerAccept = sliceBetween(
    appSource,
    "async function acceptChallengeGlobal",
    "useEffect(() => {",
);

const captureSequence = [
    "if (!character) return;",
    "const acceptanceAccountKey = saveConflictAccountKey(character.name);",
    "const acceptanceSessionEpoch = saveSessionEpochRef.current;",
    "const acceptanceIsCurrent = () => isCurrentSaveSession(acceptanceAccountKey, acceptanceSessionEpoch);",
] as const;

describe("challenge acceptance save-session authority", () => {
    it("captures the originating account and epoch before either handler can mutate UI", () => {
        for (const [label, handler] of [["pet", petAccept], ["player", playerAccept]] as const) {
            assertOrdered(handler, captureSequence, `${label} acceptance capture`);
            const capture = handler.indexOf(captureSequence.at(-1)!);
            const firstMutation = Math.min(
                ...["retireStalePetDuel(", "setProcessingChallengeIds(", "dismissChallengeLocally(", "alert("]
                    .map((needle) => handler.indexOf(needle))
                    .filter((offset) => offset >= 0),
            );
            const firstGuard = handler.indexOf("if (!acceptanceIsCurrent()", capture);
            assert.ok(firstGuard > capture && firstGuard < firstMutation, `${label} acceptance must fence its first mutation`);
        }
    });

    it("rechecks pet acceptance after every suspension before persisting or routing", () => {
        assertOrdered(petAccept, [
            'const smart = await import("./lib/pet-battle-sim")',
            "if (!acceptanceIsCurrent()) return;",
            "setProcessingChallengeIds(prev => [...prev, challenge.id]);",
            "await clearChallengeOnServer(challenge);",
            "if (!acceptanceIsCurrent()) return;",
            "const acceptedNotice: DuelChallenge",
            // player-api is imported lazily so it (and pvp-session-runtime, which
            // it pulls in) stay off the startup graph; the ordering it sits in —
            // and the fact that THIS path awaits the notice before routing — is
            // unchanged. Same shape as loadPvpSessionCreate/loadOwnSaveRead below.
            "const notified = await (await loadPlayerApi()).postPlayerChallengeNotice(challenge.fromName, acceptedNotice, { shouldContinue: acceptanceIsCurrent });",
            "if (!acceptanceIsCurrent()) return;",
            "localStorage.setItem(PENDING_PET_PVP_KEY",
            "setPendingPetBattleOpponent(opponentForResume);",
            'setScreen("petArena");',
        ], "pet acceptance");
    });

    it("routes the accepter on publication, before the advisory notice can hang", () => {
        assertOrdered(playerAccept, [
            "const { captureOwnSaveRead } = await loadOwnSaveRead();",
            "if (!acceptanceIsCurrent()) return;",
            "const [p1CombatSave, p2CombatSave] = await Promise.all([",
            "if (!acceptanceIsCurrent()) return;",
            "const ownSaveReadResult = await adoptOwnSaveRead(",
            'if (!acceptanceIsCurrent() || ownSaveReadResult === "foreign") return;',
            // The creator is imported lazily so it stays off the startup graph;
            // the ordering it sits in is unchanged.
            "const createResult = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, acceptingCharacter.name, createBody",
            "if (!acceptanceIsCurrent()) return;",
            "const battleId = createResult.battleId;",
            "setPvpSeedSession(createResult.session);",
            "setPvpBattleId(battleId);",
            'setPvpRole("p2");',
            'setScreen("pvpBattle");',
            "void loadPlayerApi().then(({ postPlayerChallengeNotice }) => postPlayerChallengeNotice(challenge.fromName, acceptedNotice, {",
        ], "player acceptance");

        // This ordering is deliberate and is the opposite of what this test used
        // to pin. Publication is authoritative: once the server has the session,
        // the accepter must reach it. Awaiting the opponent notice first meant a
        // hung or slow notice could strand a live battle behind a blank screen.
        // The notice still fires, is scope-guarded, and falls back to telling the
        // player their opponent may need to reopen the game.
        const publication = playerAccept.indexOf("const battleId = createResult.battleId;");
        const routed = playerAccept.indexOf('setScreen("pvpBattle");', publication);
        const notice = playerAccept.indexOf("postPlayerChallengeNotice", routed);
        assert.ok(publication >= 0 && routed > publication && notice > routed,
            "a published session must route before the advisory notice is sent");
        // Both the direct call and the lazy-loader form count as awaiting: going
        // through loadPlayerApi() must not become a way to smuggle an await back
        // onto this path (it would add a chunk fetch to the hang, not remove it).
        assert.doesNotMatch(
            playerAccept.slice(routed, notice + 400),
            /const notified = await (?:\(await loadPlayerApi\(\)\)\.)?postPlayerChallengeNotice/,
            "the notice must not be awaited on the routing path — a hung notice cannot strand a live session",
        );
        assert.match(playerAccept, /may not be pulled in automatically/,
            "a failed notice must still tell the accepter their opponent needs to reopen the game");
    });

    it("silences stale failures while preserving exact processing-id cleanup", () => {
        const playerCatch = sliceBetween(playerAccept, "} catch {", "} finally {");
        assertOrdered(playerCatch, [
            "if (!acceptanceIsCurrent()) return;",
            "setDuelChallenges(",
            "if (!acceptanceIsCurrent()) return;",
            "alert(",
        ], "stale player catch");

        for (const [label, handler] of [["pet", petAccept], ["player", playerAccept]] as const) {
            assert.match(
                handler,
                /} finally \{\s*setProcessingChallengeIds\(prev => prev\.filter\(id => id !== challenge\.id\)\);\s*}/,
                `${label} acceptance must always remove only its own processing id`,
            );
        }
    });
});

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
            "const notified = await postPlayerChallengeNotice(challenge.fromName, acceptedNotice, { shouldContinue: acceptanceIsCurrent });",
            "if (!acceptanceIsCurrent()) return;",
            "localStorage.setItem(PENDING_PET_PVP_KEY",
            "setPendingPetBattleOpponent(opponentForResume);",
            'setScreen("petArena");',
        ], "pet acceptance");
    });

    it("stages the player session response until the final notification fence", () => {
        assertOrdered(playerAccept, [
            "const { captureOwnSaveRead } = await loadOwnSaveRead();",
            "if (!acceptanceIsCurrent()) return;",
            "const [p1CombatSave, p2CombatSave] = await Promise.all([",
            "if (!acceptanceIsCurrent()) return;",
            "const ownSaveReadResult = await adoptOwnSaveRead(",
            'if (!acceptanceIsCurrent() || ownSaveReadResult === "foreign") return;',
            "const res = await fetch('/api/pvp/session'",
            "if (!acceptanceIsCurrent()) return;",
            "const acceptData = await res.json()",
            "if (!acceptanceIsCurrent()) return;",
            "const battleId = acceptData.battleId;",
            "const notified = await postPlayerChallengeNotice(challenge.fromName, acceptedNotice, { shouldContinue: acceptanceIsCurrent });",
            "if (!acceptanceIsCurrent()) return;",
            "if (acceptData.session) setPvpSeedSession(acceptData.session);",
            "setPvpBattleId(battleId);",
            'setPvpRole("p2");',
            'setScreen("pvpBattle");',
        ], "player acceptance");

        const parsed = playerAccept.indexOf("const acceptData = await res.json()");
        const finalFence = playerAccept.indexOf("if (!acceptanceIsCurrent()) return;", playerAccept.indexOf("await postPlayerChallengeNotice", parsed));
        assert.doesNotMatch(
            playerAccept.slice(parsed, finalFence),
            /setPvp(?:SeedSession|BattleId|Role|BattleContext)\(/,
            "the response must remain staged until the last awaited notification settles",
        );
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

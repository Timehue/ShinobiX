import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const clientRoot = process.cwd().endsWith("shinobij.client") ? process.cwd() : join(process.cwd(), "shinobij.client");
const arena = readFileSync(join(clientRoot, "src", "screens", "PetArena.tsx"), "utf8");

test("Warfront requests belong to the current normalized player lifecycle", () => {
    assert.match(arena, /useLayoutEffect\(\(\) => \{[\s\S]*?epoch: epoch \+ 1[\s\S]*?attempt\.controller\.abort\(\)/,
        "a name transition must invalidate and abort work from the prior epoch before paint");
    assert.ok((arena.match(/attempt\.controller\.signal\)/g) ?? []).length >= 5,
        "prepare, start, Council, forfeit, and settlement must all own abortable requests");
    assert.ok((arena.match(/if \(!isCurrentWarfrontAttempt\(attempt\)\)/g) ?? []).length >= 5,
        "every Warfront response must validate its lifecycle before mutating state");
    assert.match(arena, /warfrontTerminalReceiptMatchesPlayer\(receipt, attempt\.playerName\)/,
        "a terminal receipt must identify the player that owns the request");
    assert.match(arena, /updateCharacter\(\(current\) => current && normalizeWarfrontPlayerName\(current\.name\) === attempt\.normalizedPlayerName/,
        "the final React state update must re-check the live character identity");
});

test("settlement retry ownership cannot be stolen by an older attempt", () => {
    assert.match(arena, /if \(warfrontSettlementAttempt\.current === attempt\) warfrontSettlementAttempt\.current = null/,
        "an old finally block may release only its own attempt");
    assert.match(arena, /warfrontSettlementEarlyRetryUsed\.current !== pending\.battleToken/,
        "a 425 may schedule only one automatic retry for the current battle token");
    assert.match(arena, /warfrontSettlementRetryTimer\.current !== retryOwner[\s\S]*?isCurrentWarfrontIdentity\(retryOwner\)[\s\S]*?settlePendingWarfrontReward\(pending\)/,
        "the timer callback must still own the timer and the active player epoch before retrying");
});

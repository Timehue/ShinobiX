import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    CANONICAL_SOLO_ACTION_REJECTION_CODES,
    SOLO_ACTION_REJECTION_COPY,
    presentSoloActionRejection,
} from "./solo-action-rejection";

function quotedMatches(source: string, pattern: RegExp): string[] {
    return [...source.matchAll(pattern)].flatMap((match) => match.slice(1).filter(Boolean));
}

test("the presenter covers every rejection code emitted by Solo PvE", () => {
    const engine = readFileSync(new URL("../../../api/solo-pve/_engine.ts", import.meta.url), "utf8");
    const planner = readFileSync(new URL("../../../api/combat-core/resolve-jutsu-action.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("../../../api/solo-pve/_action-service.ts", import.meta.url), "utf8");

    const emittedCodes = new Set([
        ...quotedMatches(engine, /reason:\s*'([^']+)'/g),
        ...quotedMatches(engine, /reason:\s*session\.companion\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g),
        ...quotedMatches(engine, /reason:\s*result\.reason\s*\?\?\s*'([^']+)'/g),
        ...quotedMatches(planner, /rejection:\s*'([^']+)'/g),
        ...quotedMatches(planner, /rejection:\s*move\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g),
        ...quotedMatches(service, /reason:\s*'([^']+)'/g),
    ]);

    assert.deepEqual(
        [...CANONICAL_SOLO_ACTION_REJECTION_CODES].sort(),
        [...emittedCodes].sort(),
        "new Solo rejection codes need player-facing copy before they ship",
    );
    assert.deepEqual(Object.keys(SOLO_ACTION_REJECTION_COPY).sort(), [...emittedCodes].sort());
});

test("canonical codes become useful player-facing explanations", () => {
    for (const code of CANONICAL_SOLO_ACTION_REJECTION_CODES) {
        const copy = presentSoloActionRejection(code);
        assert.equal(copy, SOLO_ACTION_REJECTION_COPY[code]);
        assert.notEqual(copy.toLowerCase(), code);
        assert.ok(copy.length >= 20, `${code} needs a useful explanation`);
    }

    assert.equal(
        presentSoloActionRejection("Combat server timed out. Try again."),
        "Combat server timed out. Try again.",
        "already-readable errors should survive",
    );
    assert.equal(
        presentSoloActionRejection("future-engine-code"),
        "That action is not available right now.",
        "unknown protocol codes must not leak to players",
    );
});

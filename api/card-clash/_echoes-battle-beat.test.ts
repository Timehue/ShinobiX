import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChronicleMatch, ChroniclePresentationEvent } from "../../shared/chronicle-duel.js";
import { echoesBattleBeatForMatch } from "./_echoes-battle-beat.js";

const event = (value: Partial<ChroniclePresentationEvent> & Pick<ChroniclePresentationEvent, "kind">, index: number): ChroniclePresentationEvent => ({
    id: `e${index}`, turnNumber: 1, at: index, ...value,
});
const match = (events?: ChroniclePresentationEvent[]) => ({ events } as Pick<ChronicleMatch, "events">);

test("battle callbacks derive only from structured authoritative events", () => {
    assert.equal(echoesBattleBeatForMatch(match([
        event({ kind: "trap-activated", actor: "p1", cardId: "chronicle-smoke-bomb" }, 1),
    ])), "denied-attack");
    assert.equal(echoesBattleBeatForMatch(match([
        event({ kind: "damage", side: "p1", amount: 300 }, 1),
        event({ kind: "healing", side: "p1", amount: 200 }, 2),
    ])), "recovered-ground");
    assert.equal(echoesBattleBeatForMatch(match([
        event({ kind: "card-destroyed", side: "p1" }, 1),
        event({ kind: "monster-summoned", actor: "p1" }, 2),
    ])), "rebuilt-line");
});

test("missing, opponent-only, and ambiguous histories use the neutral callback", () => {
    assert.equal(echoesBattleBeatForMatch(match()), "unrecorded");
    assert.equal(echoesBattleBeatForMatch(match([
        event({ kind: "damage", side: "p2" }, 1),
        event({ kind: "healing", side: "p2" }, 2),
    ])), "unrecorded");
});

/*
 * battle-log-history — builders + rolling append/caps for the Profile Battles
 * reflection log. Covers the exact shapes the two engines feed in (PvE Arena's
 * newest-first structured entries; the PvP server's flat round-marked log).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    buildActionsFromPveHistory,
    buildActionsFromPvpLog,
    appendBattleHistory,
    capBattleActions,
    makeBattleEntry,
    MAX_BATTLES,
} from "./battle-log-history";
import type { BattleHistoryAction, BattleHistoryEntry } from "../types/character";

describe("buildActionsFromPveHistory", () => {
    it("reverses newest-first → chronological, splits head/effect lines, maps role", () => {
        // Arena stores newest-first (prepended). Two actions, newest first.
        const entries = [
            { round: 2, actor: "Sasuke", actorRole: "enemy", actionNumber: 2, description: "Fireball: Flames roar.\nDamage Dealt: Naruto takes 300 damage." },
            { round: 1, actor: "Naruto", actorRole: "player", actionNumber: 1, description: "Chidori: Lightning pierces.\nDamage Dealt: Sasuke takes 450 damage." },
        ];
        const actions = buildActionsFromPveHistory(entries);
        assert.equal(actions.length, 2);
        // chronological: Naruto (round 1) first
        assert.equal(actions[0]!.actor, "Naruto");
        assert.equal(actions[0]!.role, "player");
        assert.equal(actions[0]!.round, 1);
        assert.equal(actions[0]!.headline, "Chidori: Lightning pierces.");
        assert.deepEqual(actions[0]!.effectLines, ["Damage Dealt: Sasuke takes 450 damage."]);
        assert.equal(actions[1]!.actor, "Sasuke");
        assert.equal(actions[1]!.role, "enemy");
    });

    it("maps unknown actor roles to system", () => {
        const [a] = buildActionsFromPveHistory([{ round: 1, actor: "Fluffy", actorRole: "pet", description: "Bite: chomp." }]);
        assert.equal(a!.role, "system");
    });
});

describe("buildActionsFromPvpLog", () => {
    it("tags rounds, groups actions, numbers casts continuously, and counts rounds", () => {
        const log = [
            "--- Round 1 ---",
            "Naruto uses Chidori: Lightning pierces.",
            "Damage Dealt: Sasuke takes 450 damage.",
            "--- Round 2 ---",
            "Sasuke uses Fireball: Flames roar.",
            "Damage Dealt: Naruto takes 300 damage.",
        ];
        const { actions, rounds } = buildActionsFromPvpLog(log, "Naruto", "Sasuke");
        assert.equal(rounds, 2);
        assert.equal(actions.length, 2);
        assert.equal(actions[0]!.round, 1);
        assert.equal(actions[0]!.actionNumber, 1);
        assert.equal(actions[0]!.actor, "Naruto");
        assert.equal(actions[1]!.round, 2);
        assert.equal(actions[1]!.actionNumber, 2); // numbering carries across rounds
        assert.equal(actions[1]!.actor, "Sasuke");
    });
});

describe("appendBattleHistory", () => {
    const mk = (id: string): BattleHistoryEntry => ({ id, ts: 0, mode: "PvP", opponent: "x", outcome: "win", rounds: 1, self: "me", actions: [] });

    it("prepends newest and de-dupes by id (re-record on refresh is a no-op)", () => {
        const a = appendBattleHistory([mk("a")], mk("b"));
        assert.deepEqual(a.map(e => e.id), ["b", "a"]);
        const dup = appendBattleHistory(a, mk("b")); // same id again → replaces, still one
        assert.deepEqual(dup.map(e => e.id), ["b", "a"]);
    });

    it(`caps at ${MAX_BATTLES}`, () => {
        let hist: BattleHistoryEntry[] = [];
        for (let i = 0; i < MAX_BATTLES + 5; i++) hist = appendBattleHistory(hist, mk(`b${i}`));
        assert.equal(hist.length, MAX_BATTLES);
        assert.equal(hist[0]!.id, `b${MAX_BATTLES + 4}`); // newest kept
    });
});

describe("capBattleActions / makeBattleEntry — payload bounds", () => {
    it("drops the oldest actions past the per-battle cap and truncates long strings", () => {
        const many: BattleHistoryAction[] = Array.from({ length: 200 }, (_, i) => ({
            round: 1, role: "player", actor: "Naruto", headline: `A${i}`, effectLines: [],
        }));
        const capped = capBattleActions(many);
        assert.ok(capped.length <= 100);
        // keeps the most recent (end of fight)
        assert.equal(capped[capped.length - 1]!.headline, "A199");

        const longActor: BattleHistoryAction = { round: 1, role: "enemy", actor: "z".repeat(500), headline: "x", effectLines: ["e".repeat(500)] };
        const [c] = capBattleActions([longActor]);
        assert.ok(c!.actor.length <= 240);
        assert.ok(c!.effectLines[0]!.length <= 240);
    });

    it("makeBattleEntry floors rounds at 1", () => {
        const e = makeBattleEntry({ id: "x", ts: 1, mode: "Arena", opponent: "y", outcome: "loss", rounds: 0, self: "me", actions: [] });
        assert.equal(e.rounds, 1);
    });
});

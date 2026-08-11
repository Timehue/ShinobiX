import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Battle Tower live-session authority polling", () => {
    it("continues polling during the local player's turn so a remote AFK auto-pass cannot strand stale UI", () => {
        const source = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
        const start = source.indexOf("// Poll every active turn");
        const end = source.indexOf("// Auto-settle", start);
        assert.ok(start >= 0 && end > start, "live co-op polling effect must remain identifiable");

        const pollingEffect = source.slice(start, end);
        assert.match(pollingEffect, /if \(session\.status !== ["']active["']\) return;/);
        assert.doesNotMatch(
            pollingEffect,
            /session\.status !== ["']active["']\s*\|\|\s*myTurn|if \(myTurn\) return/,
            "another member's state poll can auto-pass this turn, so local-turn state must still reconcile",
        );
    });
});

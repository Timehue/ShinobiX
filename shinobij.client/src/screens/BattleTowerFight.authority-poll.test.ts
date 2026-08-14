import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Battle Tower live-session authority polling", () => {
    it("continues realtime-led reconciliation during the local player's turn so a remote AFK auto-pass cannot strand stale UI", () => {
        const source = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
        const start = source.indexOf("// Reconcile on every authenticated socket revision hint");
        const end = source.indexOf("// Auto-settle", start);
        assert.ok(start >= 0 && end > start, "live reconciliation effect must remain identifiable");

        const pollingEffect = source.slice(start, end);
        assert.match(pollingEffect, /if \(session\.status !== ["']active["']\) return;/);
        assert.match(pollingEffect, /onTowerKick\(kick =>/);
        assert.match(pollingEffect, /visiblePoll\(poll, realtimeConnected \? 20_000 : 2_500/);
        assert.doesNotMatch(
            pollingEffect,
            /session\.status !== ["']active["']\s*\|\|\s*myTurn|if \(myTurn\) return/,
            "another member's state poll can auto-pass this turn, so local-turn state must still reconcile",
        );
    });
});

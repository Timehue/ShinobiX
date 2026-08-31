import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
    COMBAT_MS,
    FIELD_MS,
    HIDDEN_TAB_MS,
    SOCKET_RECONCILE_MS,
    VILLAGE_MS,
    heartbeatIntervalMs,
    type HeartbeatCadenceInput,
} from "./heartbeat-cadence";

const VISIBLE_IDLE: HeartbeatCadenceInput = {
    tabVisible: true,
    socketConnected: false,
    inBattleFlow: false,
    guardQueued: false,
    sector: 12,
};

describe("heartbeat cadence", () => {
    it("keeps a hidden tab beating, whatever else is true of it", () => {
        // The regression this pins: the effect used to return early on a hidden
        // tab and stop beating entirely. Because presence-socket.ts pings its own
        // frame on a timer that is NOT visibility-gated, that left the player
        // present and attackable but unreachable — the beat is the only carrier
        // of pendingChallenges, so a sector attack on them produced a session
        // they never joined, which can neither pay out nor be forfeited.
        const hiddenVariants: HeartbeatCadenceInput[] = [
            { ...VISIBLE_IDLE, tabVisible: false },
            { ...VISIBLE_IDLE, tabVisible: false, socketConnected: true },
            { ...VISIBLE_IDLE, tabVisible: false, inBattleFlow: true },
            { ...VISIBLE_IDLE, tabVisible: false, guardQueued: true },
            { ...VISIBLE_IDLE, tabVisible: false, sector: 0 },
        ];
        for (const input of hiddenVariants) {
            const interval = heartbeatIntervalMs(input);
            assert.ok(
                Number.isFinite(interval) && interval > 0,
                `a hidden tab must still beat (got ${interval} for ${JSON.stringify(input)})`,
            );
            assert.equal(interval, HIDDEN_TAB_MS);
        }
    });

    it("stays inside the sleeper-sweep window so a hidden tab is never a ghost", () => {
        // api/_realtime/online-store.ts OFFLINE_AFTER_MS. A hidden tab either
        // keeps its presence fresh AND drains its inbox, or goes offline and
        // becomes an honest sleeper camp — never fresh-but-unreachable.
        const OFFLINE_AFTER_MS = 90_000;
        assert.ok(HIDDEN_TAB_MS < OFFLINE_AFTER_MS,
            "the hidden-tab beat must land inside the presence TTL");
    });

    it("leaves the visible cadences exactly as they were", () => {
        assert.equal(heartbeatIntervalMs({ ...VISIBLE_IDLE, socketConnected: true }), SOCKET_RECONCILE_MS);
        assert.equal(heartbeatIntervalMs({ ...VISIBLE_IDLE, inBattleFlow: true }), COMBAT_MS);
        assert.equal(heartbeatIntervalMs({ ...VISIBLE_IDLE, guardQueued: true }), COMBAT_MS);
        assert.equal(heartbeatIntervalMs({ ...VISIBLE_IDLE, sector: 0 }), VILLAGE_MS);
        assert.equal(heartbeatIntervalMs(VISIBLE_IDLE), FIELD_MS);
        // A live socket outranks combat: it kicks an off-cycle beat on an
        // incoming attack, so the poll stays a slow reconcile even mid-fight.
        assert.equal(
            heartbeatIntervalMs({ ...VISIBLE_IDLE, socketConnected: true, inBattleFlow: true }),
            SOCKET_RECONCILE_MS,
        );
    });

    it("is the only place App.tsx decides the interval", () => {
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        assert.match(app, /setInterval\(heartbeat, heartbeatIntervalMs\(\{/u,
            "App must arm the heartbeat interval through the shared cadence helper");
        assert.doesNotMatch(app, /const SOCKET_RECONCILE_MS/u,
            "the cadence constants belong to lib/heartbeat-cadence, not App.tsx");
    });
});

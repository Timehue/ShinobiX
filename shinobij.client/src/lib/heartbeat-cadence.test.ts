import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
    COMBAT_MS,
    FIELD_MS,
    HEARTBEAT_JITTER_PCT,
    HEARTBEAT_RECONNECT_STAGGER_MS,
    HIDDEN_TAB_MS,
    SOCKET_RECONCILE_MS,
    VILLAGE_MS,
    heartbeatIntervalMs,
    jitterHeartbeatMs,
    scheduleHeartbeat,
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
        assert.match(app, /scheduleHeartbeat\(heartbeat, \{/u,
            "App must arm the heartbeat through the shared cadence scheduler");
        // The regression this pins: a bare setInterval gives every client the
        // same period AND the same phase, so a deploy bounce (which drops every
        // socket at once) turns the beat into a synchronized stampede. The
        // scheduler exists to jitter that apart — going back to setInterval here
        // would silently undo it.
        assert.doesNotMatch(app, /setInterval\(\s*heartbeat\b/u,
            "the heartbeat must not be armed with a bare, unjittered setInterval");
        assert.doesNotMatch(app, /const SOCKET_RECONCILE_MS/u,
            "the cadence constants belong to lib/heartbeat-cadence, not App.tsx");
    });
});

describe("heartbeat jitter", () => {
    it("spreads an interval ±10% around the cadence and never returns 0", () => {
        // random() at its extremes maps to the edges of the band, and the
        // midpoint maps back to the cadence itself.
        assert.equal(jitterHeartbeatMs(COMBAT_MS, () => 0), COMBAT_MS * (1 - HEARTBEAT_JITTER_PCT));
        assert.equal(jitterHeartbeatMs(COMBAT_MS, () => 1), COMBAT_MS * (1 + HEARTBEAT_JITTER_PCT));
        assert.equal(jitterHeartbeatMs(COMBAT_MS, () => 0.5), COMBAT_MS);
        // A timer of 0 would busy-loop the beat; the floor forbids it even if a
        // cadence constant is ever lowered to something tiny.
        assert.ok(jitterHeartbeatMs(1, () => 0) >= 1);
    });

    it("keeps every draw inside the band for every cadence", () => {
        for (const base of [COMBAT_MS, FIELD_MS, VILLAGE_MS, SOCKET_RECONCILE_MS, HIDDEN_TAB_MS]) {
            for (let i = 0; i <= 20; i++) {
                const ms = jitterHeartbeatMs(base, () => i / 20);
                assert.ok(ms >= base * (1 - HEARTBEAT_JITTER_PCT) && ms <= base * (1 + HEARTBEAT_JITTER_PCT),
                    `jitter escaped the band for base ${base} (got ${ms})`);
            }
        }
    });

    it("de-synchronises two clients that armed on the same tick", () => {
        // The point of the whole change: same cadence, different draws, so the
        // two clients' beats drift apart instead of landing together forever.
        const a = jitterHeartbeatMs(COMBAT_MS, () => 0.1);
        const b = jitterHeartbeatMs(COMBAT_MS, () => 0.9);
        assert.notEqual(a, b);
    });
});

describe("heartbeat scheduling", () => {
    const VISIBLE_FIGHT: HeartbeatCadenceInput = { ...VISIBLE_IDLE, inBattleFlow: true };

    it("beats immediately, then on the jittered chain", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let beats = 0;
        const stop = scheduleHeartbeat(() => { beats++; }, VISIBLE_FIGHT, { random: () => 0.5 });
        assert.equal(beats, 1, "the first beat is synchronous — a sector move must propagate now");
        t.mock.timers.tick(COMBAT_MS);
        assert.equal(beats, 2);
        t.mock.timers.tick(COMBAT_MS);
        assert.equal(beats, 3, "the chain re-arms itself after every beat");
        stop();
    });

    it("staggers the first beat when the socket state flipped", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let beats = 0;
        // The box says "socket was up"; the input says it is now down — a deploy
        // bounce. Every client hits this branch in the same instant, so this is
        // the one first-beat that must NOT be synchronous.
        const box = { current: true };
        const stop = scheduleHeartbeat(() => { beats++; }, VISIBLE_FIGHT, { lastSocketConnected: box, random: () => 1 });
        assert.equal(beats, 0, "a connectivity flip must not beat synchronously");
        t.mock.timers.tick(HEARTBEAT_RECONNECT_STAGGER_MS);
        assert.equal(beats, 1);
        assert.equal(box.current, false, "the box adopts the state it was compared against");
        stop();
    });

    it("keeps beating immediately for the triggers that carry player state", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let beats = 0;
        // Same socket state as last run — this re-run came from a sector/screen/
        // travel change, whose whole point is instant propagation to sector-mates.
        const box = { current: false };
        const stop = scheduleHeartbeat(() => { beats++; }, VISIBLE_FIGHT, { lastSocketConnected: box, random: () => 1 });
        assert.equal(beats, 1, "a non-connectivity re-run must still beat synchronously");
        stop();
    });

    it("never skips a beat while the tab is hidden", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        // The invariant the file header exists to defend: visiblePoll would gate
        // this on document.hidden and strand the attacker in an unjoinable
        // session. The scheduler borrows the jitter and NOT the visibility gate.
        let beats = 0;
        const stop = scheduleHeartbeat(() => { beats++; }, { ...VISIBLE_IDLE, tabVisible: false }, { random: () => 0.5 });
        assert.equal(beats, 1);
        t.mock.timers.tick(HIDDEN_TAB_MS);
        assert.equal(beats, 2, "a hidden tab must keep draining its challenge inbox");
        stop();
    });

    it("stops the chain, idempotently", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let beats = 0;
        const stop = scheduleHeartbeat(() => { beats++; }, VISIBLE_FIGHT, { random: () => 0.5 });
        assert.equal(beats, 1);
        stop();
        stop(); // effect cleanup can double-fire in StrictMode
        t.mock.timers.tick(COMBAT_MS * 10);
        assert.equal(beats, 1, "a cancelled schedule must not beat again");
    });

    it("uses the cadence the input asks for", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let beats = 0;
        // Socket up outranks combat (see the cadence test above), so this chain
        // must sit on the slow reconcile, not COMBAT_MS.
        const stop = scheduleHeartbeat(() => { beats++; },
            { ...VISIBLE_FIGHT, socketConnected: true }, { random: () => 0.5 });
        t.mock.timers.tick(COMBAT_MS);
        assert.equal(beats, 1, "still only the immediate beat");
        t.mock.timers.tick(SOCKET_RECONCILE_MS - COMBAT_MS);
        assert.equal(beats, 2);
        stop();
    });
});

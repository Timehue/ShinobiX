import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    RECONNECT_DELAY_MAX_MS,
    RECONNECT_IN_BATTLE_MS,
    RECONNECT_SPREAD_MS,
    reconnectBaseDelayMs,
} from "./reconnect-spread";

test("a player outside a fight reconnects after a spread of a few seconds", () => {
    assert.equal(reconnectBaseDelayMs(false, () => 0), RECONNECT_SPREAD_MS.min);
    assert.equal(reconnectBaseDelayMs(false, () => 1), RECONNECT_SPREAD_MS.max);
    assert.equal(reconnectBaseDelayMs(false, () => 0.5), 3_000);
});

test("a player mid-fight comes back within about a second", () => {
    assert.equal(reconnectBaseDelayMs(true, () => 0), RECONNECT_IN_BATTLE_MS.min);
    assert.equal(reconnectBaseDelayMs(true, () => 1), RECONNECT_IN_BATTLE_MS.max);
    assert.ok(RECONNECT_IN_BATTLE_MS.max <= 1_000);
});

test("a broken random source is clamped into the window", () => {
    assert.equal(reconnectBaseDelayMs(false, () => -5), RECONNECT_SPREAD_MS.min);
    assert.equal(reconnectBaseDelayMs(false, () => 9), RECONNECT_SPREAD_MS.max);
    assert.ok(RECONNECT_SPREAD_MS.max < RECONNECT_DELAY_MAX_MS, "the doubled delay cap stays above the spread");
});

test("the presence socket re-spreads its delay on every drop and rebuilds auth on every handshake", () => {
    const source = readFileSync(new URL("./presence-socket.ts", import.meta.url), "utf8");
    const disconnect = source.slice(source.indexOf("socket.on('disconnect'"));
    const body = disconnect.slice(0, disconnect.indexOf("});") + 3);
    assert.match(body, /socket\?\.io\.reconnectionDelay\(reconnectBaseDelayMs\(!!latestFrame\?\.inBattle\)\)/);
    assert.match(source, /auth: \(cb: \(auth: Record<string, unknown>\) => void\) => cb\(buildAuth\(\)\)/);
    assert.match(source, /reconnectionDelay: reconnectBaseDelayMs\(!!initialFrame\.inBattle\)/);
    assert.match(source, /reconnectionDelayMax: RECONNECT_DELAY_MAX_MS/);
});

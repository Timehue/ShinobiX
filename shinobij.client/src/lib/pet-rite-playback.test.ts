import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    advanceRitePlaybackTick,
    boundedRitePlaybackDelta,
    RITE_PLAYBACK_WATCHDOG_MS,
    startRitePlaybackPulses,
    type RitePlaybackScheduler,
} from "./pet-rite-playback";

test("watchdog advances playback when WebGL pressure starves every rAF", () => {
    let now = 0;
    let nextHandle = 1;
    const frames = new Map<number, (timestamp: number) => void>();
    const timers = new Map<number, { callback: () => void; due: number }>();
    const scheduler: RitePlaybackScheduler = {
        now: () => now,
        requestFrame: (callback) => { const id = nextHandle++; frames.set(id, callback); return id; },
        cancelFrame: (id) => { frames.delete(id); },
        setTimer: (callback, delayMs) => { const id = nextHandle++; timers.set(id, { callback, due: now + delayMs }); return id; },
        clearTimer: (id) => { timers.delete(id); },
    };
    let tick = 0;
    let last = 0;
    const stop = startRitePlaybackPulses(scheduler, (timestamp) => {
        const delta = boundedRitePlaybackDelta(timestamp - last);
        last = timestamp;
        tick = advanceRitePlaybackTick(tick, 100, delta, 30, 1, 0.78);
    });

    // No frame callback is ever delivered. Execute only scheduled timer wakes.
    for (let pulse = 0; pulse < 30; pulse += 1) {
        const next = [...timers.values()].sort((a, b) => a.due - b.due)[0];
        assert.ok(next);
        now = next.due;
        next.callback();
    }
    stop();

    assert.ok(tick >= 33, `first-hit tick was not reached: ${tick}`);
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
});

test("rAF wins without double-pulsing and cleanup cancels both sources", () => {
    let nextHandle = 1;
    const frames = new Map<number, (timestamp: number) => void>();
    const timers = new Map<number, () => void>();
    const scheduler: RitePlaybackScheduler = {
        now: () => 16,
        requestFrame: (callback) => { const id = nextHandle++; frames.set(id, callback); return id; },
        cancelFrame: (id) => { frames.delete(id); },
        setTimer: (callback) => { const id = nextHandle++; timers.set(id, callback); return id; },
        clearTimer: (id) => { timers.delete(id); },
    };
    let pulses = 0;
    const stop = startRitePlaybackPulses(scheduler, () => { pulses += 1; });
    const frame = [...frames.values()][0];
    assert.ok(frame);
    frame(16);
    assert.equal(pulses, 1);
    assert.equal(frames.size, 1, "one successor frame should be armed");
    assert.equal(timers.size, 1, "one successor watchdog should be armed");
    stop();
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
});

test("elapsed steps preserve the original fifty-millisecond displacement bound", () => {
    assert.equal(boundedRitePlaybackDelta(16), 0.016);
    assert.equal(boundedRitePlaybackDelta(3_330), RITE_PLAYBACK_WATCHDOG_MS / 1000);
    assert.equal(boundedRitePlaybackDelta(-1), 0);
});

test("renderer lifecycle keeps one WebGL context and exposes real recovery", () => {
    const rite = readFileSync(new URL("../components/PetWarfrontRite.tsx", import.meta.url), "utf8");
    const stage = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const blind = readFileSync(new URL("../../public/kage-blind.html", import.meta.url), "utf8");

    assert.doesNotMatch(rite, /PetWarfrontRiteStage3D\s+key=\{clash\.index\}/u);
    assert.match(rite, /sceneKey=\{clash\.index\}/u);
    assert.match(stage, /<Scene key=\{sceneKey\}/u);
    assert.match(stage, /addEventListener\("webglcontextlost"/u);
    assert.match(stage, /removeEventListener\("webglcontextlost"/u);
    assert.match(stage, /RESTORING BATTLE VIEW/u);
    assert.match(rite, /onTransitionCancel=\{handleCurtainTransitionEnd\}/u);
    assert.match(rite, /setTimeout\(\(\) => setFormationRevealed\(true\)/u);

    assert.doesNotMatch(blind, /order\.map\(\(src, index\) =>/u);
    assert.match(blind, /activeFrame\.src = "about:blank"/u);
    assert.match(blind, /activeFrame\.remove\(\)/u);
    assert.match(blind, /show\(0\)/u);
});

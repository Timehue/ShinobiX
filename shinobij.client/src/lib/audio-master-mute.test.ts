import assert from "node:assert/strict";
import { test } from "node:test";
import {
    isAudioMuted,
    setAudioMuted,
    startBattleMusic,
    stopBattleMusic,
    subscribeAudioMute,
} from "./pet-music";
import { startVnScore, stopVnScore } from "./vn-cinematic-score";

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

class MockAudio {
    static instances: MockAudio[] = [];

    src = "";
    loop = false;
    preload = "";
    volume = 1;
    playbackRate = 1;
    currentTime = 0;
    muted = false;
    playCount = 0;
    pauseCount = 0;

    constructor() {
        MockAudio.instances.push(this);
    }

    play(): Promise<void> {
        this.playCount += 1;
        return Promise.resolve();
    }

    pause(): void {
        this.pauseCount += 1;
    }
}

Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
});
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
});
Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: MockAudio,
});
Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        hidden: false,
        addEventListener: () => {},
    },
});
Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => {},
});

test("the master switch hard-mutes every audio owner without reviving stopped music", async () => {
    setAudioMuted(false);
    let healthyListenerCalls = 0;
    const unsubscribeBroken = subscribeAudioMute(() => {
        throw new Error("optional subsystem failure");
    });
    const unsubscribeHealthy = subscribeAudioMute(() => {
        healthyListenerCalls += 1;
    });

    startBattleMusic("standard");
    const battleMusic = MockAudio.instances[0];
    assert.ok(battleMusic);
    assert.equal(battleMusic.playCount, 1);

    startVnScore("stormveil");
    const storyDecks = MockAudio.instances.slice(1);
    assert.equal(storyDecks.length, 2);
    assert.equal(storyDecks.reduce((total, deck) => total + deck.playCount, 0), 1);

    setAudioMuted(true);
    assert.equal(isAudioMuted(), true);
    assert.equal(battleMusic.muted, true);
    assert.ok(battleMusic.pauseCount >= 1);
    assert.ok(storyDecks.every((deck) => deck.muted && deck.pauseCount >= 1));
    assert.equal(healthyListenerCalls, 1);

    setAudioMuted(false);
    assert.equal(isAudioMuted(), false);
    assert.equal(battleMusic.muted, false);
    assert.equal(battleMusic.playCount, 2);
    assert.ok(storyDecks.every((deck) => !deck.muted));
    assert.equal(storyDecks.reduce((total, deck) => total + deck.playCount, 0), 2);
    assert.equal(healthyListenerCalls, 2);

    stopBattleMusic();
    stopVnScore(0);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const playsAfterStop = battleMusic.playCount;
    const storyPlaysAfterStop = storyDecks.reduce((total, deck) => total + deck.playCount, 0);
    setAudioMuted(true);
    setAudioMuted(false);
    assert.equal(
        battleMusic.playCount,
        playsAfterStop,
        "unmuting must not restart a battle score that was already stopped",
    );
    assert.equal(
        storyDecks.reduce((total, deck) => total + deck.playCount, 0),
        storyPlaysAfterStop,
        "unmuting must not restart a story score that was already stopped",
    );

    unsubscribeBroken();
    unsubscribeHealthy();
    setAudioMuted(true);
});

test("each battle theme routes to its OWN track, and none silently falls back to the pool", () => {
    // Pet Showdown is the flagship mode and shipped for months playing the same
    // three-track pool as every other fight, so "the headline battle sounds
    // generic" is a regression this codebase has already had once. The failure
    // mode is quiet: drop the `showdown` branch and it falls through to the
    // random pool, still plays music, and nothing else complains.
    setAudioMuted(false);

    startBattleMusic("showdown");
    const el = MockAudio.instances[0];
    assert.ok(el, "battle music element exists");
    assert.equal(el.src, "/music/showdown-lantern-duel.mp3", "showdown plays its commissioned theme");

    startBattleMusic("hollow-gate");
    const hollowSrc = el.src;
    assert.notEqual(hollowSrc, "/music/showdown-lantern-duel.mp3", "hollow-gate is not the showdown theme");

    // The pooled theme must land on a track that is neither dedicated theme —
    // this is what actually catches a mis-ordered branch.
    startBattleMusic("standard");
    assert.notEqual(el.src, "/music/showdown-lantern-duel.mp3", "standard never grabs the showdown theme");
    assert.notEqual(el.src, hollowSrc, "standard never grabs the hollow-gate theme");

    stopBattleMusic();
    setAudioMuted(true);
});

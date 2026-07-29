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

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    isAudioMuted,
    getAudioVolume,
    BATTLE_MUSIC_TRACKS,
    setAudioVolume,
    setAudioMuted,
    startBattleMusic,
    stopBattleMusic,
    subscribeAudioMute,
} from "./pet-music";
import { startVnScore, stopVnScore } from "./vn-cinematic-score";
import { isPetSfxMuted, setPetSfxMuted } from "./pet-sfx";
import { chronicleSfxMuted, setChronicleSfxMuted } from "./chronicle-sfx";

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

test("Settings mute remains authoritative over retired pet and card preferences", () => {
    localStorage.setItem("petSfxMuted", "1");
    localStorage.setItem("chronicleSfx.v1", "off");
    setAudioMuted(false);
    assert.equal(isPetSfxMuted(), false);
    assert.equal(chronicleSfxMuted(), false);
    setAudioMuted(true);
    assert.equal(isPetSfxMuted(), true);
    assert.equal(chronicleSfxMuted(), true);
    // Compatibility callers also update the same preference, never a hidden override.
    setPetSfxMuted(false);
    assert.equal(isAudioMuted(), false);
    assert.equal(chronicleSfxMuted(), false);
    setChronicleSfxMuted(true);
    assert.equal(isAudioMuted(), true);
    assert.equal(isPetSfxMuted(), true);
});

class MockAudio {
    static instances: MockAudio[] = [];

    src = "";
    loop = false;
    preload = "";
    volume = 1;
    playbackRate = 1;
    currentTime = 0;
    muted = false;
    onended: (() => void) | null = null;
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

const windowEvents = new EventTarget();
Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        setInterval, clearInterval, setTimeout, clearTimeout,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    },
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

test("Pet Coliseum and PvP/PvE rotate both combat tracks", () => {
    setAudioMuted(false);

    startBattleMusic("showdown");
    const el = MockAudio.instances[0];
    assert.ok(el, "battle music element exists");
    assert.ok(BATTLE_MUSIC_TRACKS.some((track) => track === el.src));
    assert.equal(el.loop, false);
    const firstShowdownTrack = el.src;
    el.onended?.();
    assert.notEqual(el.src, firstShowdownTrack);

    startBattleMusic("hollow-gate");
    assert.equal(el.src, "/music/world/wind-blade-jutsu.mp3");
    assert.equal(el.loop, true);

    const standardTracks = new Set<string>();
    for (let i = 0; i < 4; i++) {
        startBattleMusic("standard");
        standardTracks.add(el.src);
    }
    assert.deepEqual(standardTracks, new Set(BATTLE_MUSIC_TRACKS));

    stopBattleMusic();
    setAudioMuted(true);
});

test('master volume scales live battle and story music and keeps mute independent', () => {
    setAudioMuted(false);
    setAudioVolume(1);
    startBattleMusic('standard');
    startVnScore('ashen');
    // Muting settles the story crossfade in this no-animation-frame fixture.
    setAudioMuted(true);
    setAudioMuted(false);
    const battle = MockAudio.instances[0];
    const story = MockAudio.instances.slice(1).find(deck => deck.volume > 0)!;
    const battleFull = battle.volume;
    const storyFull = story.volume;
    assert.ok(storyFull > 0);
    setAudioVolume(0.25);
    assert.equal(getAudioVolume(), 0.25);
    assert.equal(battle.volume, battleFull * 0.25);
    assert.equal(story.volume, storyFull * 0.25);
    setAudioMuted(true);
    setAudioVolume(0.5);
    assert.equal(isAudioMuted(), true);
    assert.equal(battle.muted, true);
    setAudioMuted(false);
    assert.equal(story.volume, storyFull * 0.5);
    setAudioVolume(0);
    assert.equal(battle.volume, 0);
    assert.equal(story.volume, 0);
    setAudioVolume(NaN);
    assert.equal(getAudioVolume(), 0);
    setAudioVolume(3);
    assert.equal(getAudioVolume(), 1);
    stopVnScore(0);
    setAudioMuted(true);
    stopBattleMusic();
});

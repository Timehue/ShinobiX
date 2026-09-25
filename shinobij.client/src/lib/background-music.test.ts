import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_MUSIC_VOLUME, setBackgroundMusicScene } from "./background-music";
import { setAudioMuted, setAudioVolume, startBattleMusic, stopBattleMusic } from "./pet-music";

class MockAudio {
    static instances: MockAudio[] = [];
    src = ""; loop = false; preload = ""; volume = 1; muted = false; currentTime = 0; paused = true;
    onended: (() => void) | null = null;
    playCount = 0;
    constructor() { MockAudio.instances.push(this); }
    play() { this.playCount += 1; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
}

const documentEvents = Object.assign(new EventTarget(), { hidden: false });
const windowEvents = new EventTarget();
const storage = new Map<string, string>();
Object.defineProperties(globalThis, {
    document: { configurable: true, value: documentEvents },
    window: { configurable: true, value: {
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
        // The battle score fades out on a short interval.
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
    } },
    Audio: { configurable: true, value: MockAudio },
    localStorage: { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    } },
});

test("village music rotates through all tracks while combat uses the pet battle playlist", () => {
    const random = Math.random;
    const picks = [0, 0.26, 0.51, 0.76];
    Math.random = () => picks.shift() ?? 0;
    try {
        setAudioMuted(false);
        setAudioVolume(1);
        setBackgroundMusicScene("village");
        const music = MockAudio.instances.at(-1)!;
        assert.equal(music.src, "/music/world/wind-of-the-ninja-village.mp3");
        assert.equal(music.volume, BACKGROUND_MUSIC_VOLUME);
        assert.equal(music.loop, false);

        music.currentTime = 42;
        const playCount = music.playCount;
        setBackgroundMusicScene("village"); // Village-to-sector travel keeps the same scene.
        assert.equal(music.src, "/music/world/wind-of-the-ninja-village.mp3");
        assert.equal(music.currentTime, 42);
        assert.equal(music.playCount, playCount);

        music.onended?.();
        assert.equal(music.src, "/music/world/ninja-night.mp3");
        music.onended?.();
        assert.equal(music.src, "/music/world/ninja-wind-melody.mp3");
        music.onended?.();
        assert.equal(music.src, "/music/world/village-background-sj.mp3");

        setBackgroundMusicScene("combat");
        assert.equal(music.src, "/music/world/wind-blade-jutsu.mp3");
        assert.equal(music.loop, false);
        music.onended?.();
        assert.equal(music.src, "/music/showdown-lantern-duel.mp3");
        music.onended?.();
        assert.equal(music.src, "/music/world/wind-blade-jutsu.mp3");

        setAudioVolume(0.5);
        assert.equal(music.volume, BACKGROUND_MUSIC_VOLUME * 0.5);
        setAudioMuted(true);
        assert.equal(music.paused, true);
        setAudioMuted(false);
        assert.equal(music.muted, false);
        assert.ok(music.playCount >= 2);

        setBackgroundMusicScene(null);
        assert.equal(music.paused, true);
    } finally {
        Math.random = random;
        setBackgroundMusicScene(null);
        setAudioMuted(true);
        setAudioVolume(1);
    }
});

test("the world score pauses under any battle score and resumes where it stopped", () => {
    // A pet battle can be shown on screens that never tell App to silence the
    // world score (the world-map wild binding, dungeon and event pet fights,
    // Pet Ladder replays). Both scores used to play at once there.
    try {
        setAudioMuted(false);
        setAudioVolume(1);
        setBackgroundMusicScene("village");
        const world = MockAudio.instances.find((el) => el.src.includes("/music/world/") && !el.src.includes("wind-blade"))
            ?? MockAudio.instances.at(-1)!;
        assert.equal(world.paused, false);
        world.currentTime = 37;

        startBattleMusic("showdown");
        const battle = MockAudio.instances.at(-1)!;
        assert.notEqual(battle, world, "the battle score has its own element");
        assert.equal(battle.paused, false, "the battle score plays");
        assert.equal(world.paused, true, "the world score yields to it");

        setBackgroundMusicScene("combat");
        assert.equal(world.paused, true, "a scene change during the battle does not break through");

        stopBattleMusic();
        assert.equal(world.paused, false, "the world score resumes when the battle score stops");
        assert.equal(world.muted, false);
    } finally {
        stopBattleMusic();
        setBackgroundMusicScene(null);
        setAudioMuted(true);
        setAudioVolume(1);
    }
});

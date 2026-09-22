import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_MUSIC_VOLUME, setBackgroundMusicScene } from "./background-music";
import { setAudioMuted, setAudioVolume } from "./pet-music";

class MockAudio {
    static instances: MockAudio[] = [];
    src = ""; loop = false; preload = ""; volume = 1; muted = false; currentTime = 0; paused = true;
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
    } },
    Audio: { configurable: true, value: MockAudio },
    localStorage: { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    } },
});

test("world music follows village, sector, and combat context at a quiet master-scaled level", () => {
    setAudioMuted(false);
    setAudioVolume(1);
    setBackgroundMusicScene("village");
    const music = MockAudio.instances.at(-1)!;
    assert.ok(["/music/world/wind-of-the-ninja-village.mp3", "/music/world/ninja-night.mp3"].includes(music.src));
    assert.equal(music.volume, BACKGROUND_MUSIC_VOLUME);
    assert.equal(music.loop, true);

    setBackgroundMusicScene("sector");
    assert.equal(music.src, "/music/world/ninja-wind-melody.mp3");
    setBackgroundMusicScene("combat");
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
    setAudioMuted(true);
    setAudioVolume(1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { setAudioMuted, startBattleMusic, stopBattleMusic } from "./pet-music";
import { startVnScore, stopVnScore } from "./vn-cinematic-score";
import { playGameSfx, startGameAmbience, stopGameAmbience } from "./game-audio";

class Media {
    static instances: Media[] = [];
    src = ""; loop = false; preload = ""; volume = 1; playbackRate = 1;
    currentTime = 0; muted = false; paused = true; plays = 0;
    constructor() { Media.instances.push(this); }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
}

class Param {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value: number) { this.value = value; }
    exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class AudioNodeMock {
    gain = new Param();
    connect() {}
    disconnect() {}
}
class Source extends AudioNodeMock {
    buffer: { duration: number } | null = null;
    loop = false; playbackRate = new Param(); started = false; stopped = false;
    start() { this.started = true; }
    stop() { this.stopped = true; }
    addEventListener() {}
}
class Context {
    static instance: Context;
    sources: Source[] = [];
    gains: AudioNodeMock[] = [];
    state = "running"; currentTime = 0; destination = new AudioNodeMock();
    constructor() { Context.instance = this; }
    createGain() { const gain = new AudioNodeMock(); this.gains.push(gain); return gain; }
    createDynamicsCompressor() {
        return Object.assign(new AudioNodeMock(), {
            threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param(),
        });
    }
    createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
    decodeAudioData() { return Promise.resolve({ duration: 20 }); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    resume() { this.state = "running"; return Promise.resolve(); }
}

const documentEvents = Object.assign(new EventTarget(), { hidden: false });
const windowEvents = new EventTarget();
const storage = new Map<string, string>();
const pending: Array<() => void> = [];
let deferLoads = false;
Object.defineProperties(globalThis, {
    document: { configurable: true, value: documentEvents },
    window: { configurable: true, value: {
        setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, AudioContext: Context,
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    } },
    Audio: { configurable: true, value: Media },
    localStorage: { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    } },
    fetch: { configurable: true, value: () => new Promise((resolve) => {
        const deliver = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
        if (deferLoads) pending.push(deliver); else deliver();
    }) },
});

function hide(hidden: boolean) {
    documentEvents.hidden = hidden;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("music pauses on hide/pagehide, respects mute, and never revives a departed scene", () => {
    setAudioMuted(false);
    startBattleMusic("showdown");
    startVnScore("stormveil");
    const [battle, ...story] = Media.instances;
    assert.equal(battle.paused, false);
    hide(true);
    assert.ok(Media.instances.every((el) => el.paused && el.muted));
    assert.equal(storage.get("audioMuted"), "0", "backgrounding preserves the preference");
    const plays = Media.instances.reduce((total, el) => total + el.plays, 0);
    setAudioMuted(true);
    setAudioMuted(false);
    startBattleMusic("hollow-gate");
    startVnScore("ashen");
    assert.equal(Media.instances.reduce((total, el) => total + el.plays, 0), plays, "hidden starts/unmute cannot play");
    hide(false);
    assert.equal(battle.paused, false);
    assert.equal(story.filter((el) => !el.paused).length, 1, "only the current story deck resumes");

    windowEvents.dispatchEvent(new Event("pagehide"));
    assert.ok(Media.instances.every((el) => el.paused && el.muted));
    hide(false);
    assert.ok(Media.instances.every((el) => el.paused), "visibility alone cannot undo pagehide");
    windowEvents.dispatchEvent(new Event("pageshow"));
    assert.equal(battle.paused, false);

    hide(true);
    stopBattleMusic();
    stopVnScore();
    const stoppedPlays = Media.instances.reduce((total, el) => total + el.plays, 0);
    hide(false);
    assert.equal(Media.instances.reduce((total, el) => total + el.plays, 0), stoppedPlays);
    assert.ok(Media.instances.every((el) => el.paused));

    startBattleMusic();
    hide(true);
    setAudioMuted(true);
    hide(false);
    assert.equal(battle.paused, true, "returning must honor a muted preference");
    stopBattleMusic();
});

test("backgrounding stops SFX and every ambience source, including a fading scene", async () => {
    setAudioMuted(false);
    startGameAmbience("ambience-village");
    await settle();
    startGameAmbience("ambience-road");
    playGameSfx("impact-light");
    await settle();
    const ctx = Context.instance;
    assert.equal(ctx.sources.filter((source) => source.started && !source.stopped).length, 3);
    hide(true);
    assert.equal(ctx.gains[0].gain.value, 0);
    assert.equal(ctx.state, "suspended");
    assert.ok(ctx.sources.every((source) => source.stopped));
    const before = ctx.sources.length;
    playGameSfx("guard");
    setAudioMuted(true);
    setAudioMuted(false);
    await settle();
    assert.equal(ctx.sources.length, before, "hidden callbacks cannot create playback");
    hide(false);
    await settle();
    assert.equal(ctx.sources.length, before + 1, "only current ambience resumes, never old SFX");
    assert.equal(ctx.sources.at(-1)?.loop, true);
    assert.equal(ctx.state, "running");
    hide(true);
    stopGameAmbience();
    hide(false);
    await settle();
    assert.ok(ctx.sources.every((source) => source.stopped), "leaving while hidden clears the resume request");
});

test("late decodes cannot replay stale effects or duplicate resumed ambience", async () => {
    const ctx = Context.instance;
    const before = ctx.sources.length;
    deferLoads = true;
    playGameSfx("reveal");
    startGameAmbience("ambience-shrine");
    hide(true);
    hide(false);
    for (const resolve of pending.splice(0)) resolve();
    await settle();
    assert.equal(ctx.sources.length, before + 1);
    assert.equal(ctx.sources.at(-1)?.loop, true, "the resumed ambience owns the pending load");
    hide(true);
    startGameAmbience("ambience-hollow");
    assert.equal(pending.length, 0, "hidden scenes defer new loads until foregrounded");
    stopGameAmbience();
    hide(false);
    deferLoads = false;
    setAudioMuted(true);
});

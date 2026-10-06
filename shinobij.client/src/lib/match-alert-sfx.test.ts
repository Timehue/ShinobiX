import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchFoundStep, playFightNotificationSfx } from "./match-alert-sfx";

// Feeds [found, searching] renders through the arming rule and counts cues.
function cues(renders: Array<[boolean, boolean]>): number {
    let armed = false;
    let played = 0;
    for (const [found, searching] of renders) {
        const [play, next] = matchFoundStep(armed, found, searching);
        armed = next;
        if (play) played += 1;
    }
    return played;
}

test("a queue that pairs after searching plays the cue once", () => {
    assert.equal(cues([[false, false], [false, true], [false, true], [true, false], [true, false]]), 1);
});

test("a join that pairs at once still plays the cue", () => {
    // The join request is the only "searching" render before the match.
    assert.equal(cues([[false, false], [false, true], [true, false]]), 1);
});

test("a match restored on mount or after navigation stays quiet", () => {
    assert.equal(cues([[false, false], [true, false], [true, true], [true, false]]), 0);
});

test("leaving the queue disarms, and a later search can sound again", () => {
    assert.equal(cues([[false, true], [false, false], [true, false]]), 0);
    assert.equal(cues([[false, true], [true, false], [false, false], [false, true], [true, false]]), 2);
});

// A hidden tab parks the game bus, so the PvP notification plays on its own <audio>.
function hiddenTabPlays(storage: Record<string, string>): Array<{ src: string; volume: number }> {
    const played: Array<{ src: string; volume: number }> = [];
    const globals = globalThis as Record<string, unknown>;
    const saved = { document: globals.document, localStorage: globals.localStorage, Audio: globals.Audio };
    globals.document = { hidden: true, visibilityState: "hidden" };
    globals.localStorage = { getItem: (key: string) => storage[key] ?? null };
    globals.Audio = class {
        volume = 1;
        constructor(public src: string) {}
        play() { played.push({ src: this.src, volume: this.volume }); return Promise.resolve(); }
    };
    try {
        playFightNotificationSfx();
    } finally {
        Object.assign(globals, saved);
    }
    return played;
}

test("the PvP notification still sounds in a hidden tab when audio is on", () => {
    const played = hiddenTabPlays({ audioMuted: "0", "audioVolume.v1": "0.5" });
    assert.equal(played.length, 1);
    assert.equal(played[0].src, "/sfx/production/fight-notification.mp3");
    assert.equal(played[0].volume, 0.2 * 0.5, "cue gain times the player's volume");
});

test("the fight notification sound ships with the client", () => {
    const file = new URL("../../public/sfx/production/fight-notification.mp3", import.meta.url);
    const head = readFileSync(file).subarray(0, 3).toString("latin1");
    assert.ok(head === "ID3" || head.charCodeAt(0) === 0xff, "an MP3 file, tagged or bare");
});

test("the PvP notification stays silent in a hidden tab while audio is muted", () => {
    assert.equal(hiddenTabPlays({ audioMuted: "1" }).length, 0);
    assert.equal(hiddenTabPlays({}).length, 0, "audio is muted by default");
});

test("the solo ranked queue keeps polling in a hidden tab", () => {
    // The server drops a queue entry 3 min after its last poll.
    assert.doesNotMatch(read("../features/arena/hooks/use-ranked-queue.ts"), /visibilityState === "hidden"/);
});

// Each queue and the challenge modal must actually call into the cue module.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const wiring: Array<[string, RegExp]> = [
    ["../features/arena/hooks/use-ranked-queue.ts", /consumeMatch\(session\);\s*if \(!launchingSession\) return;\s*playFightNotificationSfx\(\);/],
    ["../components/Ranked2v2Panel.tsx", /useMatchFoundSfx\(Boolean\(state\.match\)/],
    ["../components/TowerPvpPanel.tsx", /useMatchFoundSfx\(presence\.state === "matched"/],
    ["../components/PetLadderQueuePanel.tsx", /useMatchFoundSfx\(matchFound,/],
    ["../screens/CardHall.tsx", /playFightNotificationSfx\(\);\s*onStart\(outcome\.matchId\);/],
    ["../components/IncomingChallengeModal.tsx", /if \(fresh\) playFightNotificationSfx\(\);/],
];
for (const [file, pattern] of wiring) {
    test(`${file} plays the PvP notification`, () => {
        assert.match(read(file), pattern);
    });
}

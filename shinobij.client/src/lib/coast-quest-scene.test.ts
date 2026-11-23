import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COAST_SCENE_ID, castPortrait, coastSceneEvent } from "./coast-quest-scene";
import type { QuestLine } from "./quest-lines-api";
import { resolveVnScoreKey } from "./vn-cinematic-score";
import { resolveVnPresentation } from "./vn-presentation";
import { wandererAvatar } from "./wanderer-art";
import type { WandererArchetypeId } from "./wanderers";
import { castFaceOf, REGION_SCORES } from "../../../api/quests/_views";
import { COAST_CAST, coastCastPortrait } from "../../../shared/coast-cast";

const quest = (over: Partial<QuestLine>): QuestLine => ({
    id: "first-footing", series: "crossing", title: "First Footing", world: "coast", marks: 1, stages: 6,
    state: "open", needLevel: 75, needMarks: 0, giver: "urabe", giverName: "Urabe", art: "first-footing", backdrop: "first-footing", ...over,
});

test("a quest's lines become a scene with one page per speaker and the player's own name", () => {
    const event = coastSceneEvent(quest({ talk: [
        { speaker: "", text: "The slip smells of tar." },
        { speaker: "Urabe", text: "You came over on the old boat.", face: "angler" },
        { speaker: "You", text: "I did." },
        { speaker: "Urabe", text: "Then the keeper will want a word.", face: "angler" },
        { speaker: "Orito", text: "Then sign here.", face: "courier" },
    ] }), "Kaede", "Saltstair Slip");

    assert.ok(event.id.startsWith(COAST_SCENE_ID));
    assert.equal(event.eventKind, "visualNovel");
    assert.deepEqual([event.ryoReward, event.xpReward, event.staminaReward], [0, 0, 0], "a scene pays nothing; the quest does");
    assert.equal(event.image, "/scenes/story/coast-first-footing-v1.webp");
    const pages = event.vnPages!;
    assert.deepEqual(pages.map(page => page.rightName), ["Urabe", "Orito"]);
    assert.deepEqual(pages.map(page => page.rightImage), [castPortrait("angler"), castPortrait("courier")]);
    assert.deepEqual(pages[0].lines!.map(line => line.speaker), ["Narrator", "Urabe", "Kaede", "Urabe"]);
    assert.equal(pages[0].scene, "Saltstair Slip");
    for (const page of pages) assert.equal(page.dialogue.length, page.lines!.length, "the reader counts lines from `dialogue`");
    assert.equal(pages.some(page => page.choices), false);
});

test("a choice step ends on its options, each carrying the server's key", () => {
    const options = [{ key: "boardwalk", label: "Tell him the Reedmarsh Boardwalk", blurb: "The knot wound with reed." }, { key: "piers", label: "Tell him the Western Piers", blurb: "The knot stiff with tar." }];
    const prompt = "Three knots, tied in the order he walks. Where is he going?";
    const event = coastSceneEvent(quest({ id: "shuttered-boat", title: "The Shuttered Boat",
        stage: { index: 6, kind: "choice", text: "Read the tally.", choice: { prompt, options } },
        talk: [{ speaker: "Funade", text: "Read me the third.", face: "merchant" }],
    }), "Kaede", "The Boatwright's Slip");
    const last = event.vnPages!.at(-1)!;
    assert.deepEqual(last.lines!.at(-1), { speaker: "Narrator", text: prompt });
    assert.equal(last.dialogue.length, last.lines!.length);
    assert.deepEqual(last.choices!.map(choice => choice.id), ["boardwalk", "piers"]);
    assert.equal(last.choices![0].text, "Tell him the Reedmarsh Boardwalk. The knot wound with reed.");
    // Pointing at its own page is how the reader ends a scene on a choice.
    assert.ok(last.choices!.every(choice => choice.nextPage === event.vnPages!.length - 1));
});

test("a scene stands in front of the painting the server names, and of none when it names none", () => {
    // A side tale has no painting of its own; the server sends its region's as `backdrop` (api/quests/_views.test.ts).
    const tale = (backdrop?: string) => coastSceneEvent(quest({ id: "tale-runners-cord", title: "The Runner's Cord", art: undefined, backdrop, talk: [{ speaker: "", text: "A cord hangs from the tree." }] }), "Kaede", "").image;
    assert.equal(tale("beast-bond"), "/scenes/story/coast-beast-bond-v1.webp");
    assert.equal(tale(undefined), undefined);
});

test("every face the server can name is a painting the client has", () => {
    // The server maps a cast member's world model to a face (castFaceOf); the client only looks the painting up.
    const faces = new Set(Object.values(COAST_CAST).map(member => castFaceOf(member.model)));
    assert.ok(faces.size >= 8);
    // A name the client does not know falls back to the bandit, so "it returned something" proves nothing:
    // each named face must be its own painting.
    for (const face of faces) {
        if (face === "boss") continue;
        assert.equal(castPortrait(face), wandererAvatar(face as WandererArchetypeId), face);
        assert.ok(face === "bandit" || castPortrait(face) !== castPortrait("bandit"), `${face} is not the fallback`);
    }
    assert.equal(castFaceOf("bounty-hunter"), "bountyHunter");
    assert.equal(castFaceOf("a-model-nobody-mapped"), "bandit", "an unmapped model still gets a face");
    assert.notEqual(castPortrait("boss"), castPortrait("bandit"), "the warlord keeps his own portrait");
    assert.equal(castPortrait("not-a-face"), castPortrait("bandit"), "an unknown name still shows someone");
    // A member with their own cut-out is sent as its path, and the path is the picture.
    assert.equal(castPortrait("/portraits/cinematic/coast/quay-defector-v1.webp"), "/portraits/cinematic/coast/quay-defector-v1.webp");
    for (const id of Object.keys(COAST_CAST)) {
        const path = coastCastPortrait(id);
        if (path) assert.equal(castPortrait(path), path, id);
    }
});

test("a coast scene is scored: the theme the server named for its region, over open-ground weather instead of the village bed", () => {
    const talk = [{ speaker: "Urabe", text: "You came over on the old boat.", face: "angler" }];
    const event = coastSceneEvent(quest({ talk, score: "frostfang" }), "Kaede", "Saltstair Slip");
    assert.equal(resolveVnScoreKey(event.id, event.name), "frostfang");
    // Every theme the server can name is one the client has a track for; a scene with none named still has music.
    for (const score of REGION_SCORES) assert.equal(resolveVnScoreKey(coastSceneEvent(quest({ talk, score }), "Kaede", "").id), score);
    assert.equal(resolveVnScoreKey(coastSceneEvent(quest({ talk }), "Kaede", "").id), "stormveil");
    assert.equal(resolveVnScoreKey(coastSceneEvent(quest({ talk, title: "The Hollow Gate", score: "hollow" }), "Kaede", "").id, "The Hollow Gate"), "stormveil",
        "the coast never borrows the Hollow Gate's theme");
    const shown = resolveVnPresentation({ event, page: event.vnPages![0], pageIndex: 0, lineIndex: 0, speaker: "Urabe", speakingSide: "right", pageImage: event.image ?? "" });
    assert.equal(shown.ambience, "road");
});

test("a finished quest's story, read back from the server, plays as one scene from its first line", () => {
    // What the journal does on "Hear it again": the card's own line, with the server's `talk` and `backdrop` laid over it.
    const done = quest({ state: "done", talk: [{ speaker: "", text: "You chose: By day." }], backdrop: undefined });
    const reply = { ok: true, id: done.id, title: done.title, backdrop: "bitter-tide", score: "moonshadow", talk: [
        { speaker: "Urabe", text: "You came over on the old boat.", face: "angler" },
        { speaker: "", text: "You chose: By day." },
        { speaker: "Orito", text: "She let me write her name.", face: "courier" },
    ] };
    const event = coastSceneEvent({ ...done, ...reply } as QuestLine, "Kaede", done.title);
    assert.equal(event.image, "/scenes/story/coast-bitter-tide-v1.webp");
    assert.equal(resolveVnScoreKey(event.id), "moonshadow");
    assert.deepEqual(event.vnPages!.map(page => page.rightName), ["Urabe", "Orito"]);
    assert.deepEqual(event.vnPages!.flatMap(page => page.lines!.map(line => line.text)), reply.talk.map(say => say.text));
    assert.equal(event.vnPages!.some(page => page.choices), false, "a story told again asks nothing");

    const panel = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "components", "QuestLinesPanel.tsx"), "utf8");
    assert.match(panel, /questLineAction\(playerName, "recall", line\.id\)/);
    assert.match(panel, /line\.state === "done" && mode === "journal"[^\n]*Hear it again/);
});

test("the reader ends a coast scene on its last line, under its own label", () => {
    // The prefix is a literal in the reader (importing it there would be a cycle), so the two are pinned together here.
    const reader = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "components", "TriggeredVisualNovel.tsx"), "utf8");
    assert.ok(reader.includes(`event.id.startsWith("${COAST_SCENE_ID}")`));
    assert.match(reader, /isCoastScene\s*\?\s*"Coast Quest"/);
});

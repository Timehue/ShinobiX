import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// Story-boss fights must render through the SAME arena shell as combat missions
// (MissionArenaFight), NOT the tactical Battle Tower rail (BattleTowerFight). Both
// are solo defeat-boss TowerSessions, so the screen is shared; only the theme +
// settle endpoint differ. This guards the migration from silently regressing back
// to the tower shell (which showed "Floor 9200 · defeat boss" tower chrome).
const host = readFileSync(new URL("./StoryBossFightHost.tsx", import.meta.url), "utf8");
const missionFight = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");

test("StoryBossFightHost renders MissionArenaFight, not the tower shell", () => {
    assert.match(host, /<MissionArenaFight/, "the host must render MissionArenaFight");
    assert.match(host, /import\(["']\.\.\/screens\/MissionArenaFight["']\)/, "the host must code-split MissionArenaFight");
    // Guard the actual import/render, not the word — the header comment names the
    // retired shell to explain the migration, which is fine.
    assert.doesNotMatch(host, /<BattleTowerFight|screens\/BattleTowerFight/, "the host must not import or render the Battle Tower shell");
});

test("StoryBossFightHost wires the story theme + server settle into the arena shell", () => {
    // A CHAPTER fight must still receive the theme (backdrop / label / barks).
    // The host now also carries the Academy spar, which is deliberately themeless
    // — it has no chapter, and the theme layer is what fires the chapter-seal and
    // victory stings — so the theme is passed conditionally rather than always.
    // What must never happen is the theme not reaching a chapter boss at all.
    assert.match(host, /storyTheme=\{(theme|isSpar \? undefined : theme)\}/, "the chapter theme (backdrop/label/barks) must reach a chapter fight");
    assert.doesNotMatch(host, /storyTheme=\{undefined\}/, "a chapter boss must never be stripped of its theme outright");
    assert.match(host, /settleFn=\{settle\}/, "the server-authoritative story settle must reach the fight");
    assert.match(host, /settleStoryBossCombat\(/, "settle must call the /api/story/settle wrapper");
});

test("MissionArenaFight accepts the story presentation props the host passes", () => {
    assert.match(missionFight, /storyTheme\?:\s*StoryFightTheme/, "the arena shell must accept a storyTheme");
    assert.match(missionFight, /renderResult\?:/, "the arena shell must accept a result-overlay override");
    // Display-only invariant: the story flavor never touches the reward path.
    assert.match(missionFight, /storyTheme\?\.backdropImage/, "the story backdrop must be display-only chrome");
});

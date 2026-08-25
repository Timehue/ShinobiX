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
const storyApi = readFileSync(new URL("../lib/story-combat-api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const battleCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const immediateResultConsumers = [
    ["wandering AI", readFileSync(new URL("./AiFightHost.tsx", import.meta.url), "utf8")],
    ["Hollow Gate", readFileSync(new URL("../screens/HollowGateFight.tsx", import.meta.url), "utf8")],
    ["Endless Tower", readFileSync(new URL("../screens/EndlessTowerFight.tsx", import.meta.url), "utf8")],
] as const;

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

test("story wins keep the sealed run open until the authoritative reward settles", () => {
    assert.match(
        host,
        /renderResult=\{\(\{ won, settleState, settleResult, retry \}\) =>/,
        "the story renderer must retain MissionArenaFight's run-scoped retry callback",
    );
    assert.match(host, /settleState === "failed"[\s\S]*?<button onClick=\{retry\}>Retry Reward<\/button>/);
    assert.match(
        host,
        /disabled=\{settleState !== "settled" \|\| !result\} onClick=\{closeFight\}>Continue<\/button>/,
        "a chapter win must not discard its runId while settlement is pending or failed",
    );
    assert.match(
        host,
        /disabled=\{won && \(settleState !== "settled" \|\| !result\)\} onClick=\{closeFight\}>Continue<\/button>/,
        "the Academy spar must preserve its sealed run until its reward settles too",
    );
});

test("story settlement surfaces newly pressed Living Chronicle records", () => {
    assert.match(storyApi, /chronicleCards\?:\s*string\[\]/);
    assert.match(host, /result\.chronicleCards\?\.length/);
    assert.match(host, /Living Chronicle \u00b7 Ihara records the witnessed fall of \{theme\.bossName\}/);
});

test("story result overlays expose modal semantics", () => {
    assert.equal((host.match(/<RequiredStoryResultDialog/g) ?? []).length, 3);
    assert.match(host, /role=\{revealed \? "dialog" : undefined\}/);
    assert.match(host, /aria-modal=\{revealed \? "true" : undefined\}/);
    assert.match(host, /dialog\.closest<HTMLElement>\("\.combat-instance"\)/);
    assert.match(host, /Array\.from\(document\.body\.children\)/);
    assert.match(host, /element\.inert = true/);
    assert.match(host, /event\.key !== "Tab"/);
    assert.match(host, /event\.key === "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)/);
    assert.match(host, /returnFocus\?\.isConnected/);
    assert.match(battleCss, /\.story-fight-complete \{[\s\S]*?align-items: flex-start;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(battleCss, /\.story-fight-complete-card \{[\s\S]*?box-sizing: border-box;[\s\S]*?margin: auto 0;/);
});

test("only authored story results keep the cinematic final-bark delay", () => {
    assert.match(host, /className=\{`story-fight-complete\$\{cinematic \? " story-fight-complete--cinematic" : ""\}`\}/,
        "the shared result dialog must require an explicit cinematic opt-in");
    const sparResult = host.slice(host.indexOf("if (isSpar)"), host.indexOf("// WIN — the chapter-complete reward card"));
    const chapterVictory = host.slice(host.indexOf("// WIN — the chapter-complete reward card"), host.indexOf("// LOSS / DRAW"));
    const chapterDefeat = host.slice(host.indexOf("// LOSS / DRAW"), host.indexOf("            />\n        </Suspense>"));
    assert.doesNotMatch(sparResult, /<RequiredStoryResultDialog[\s\S]*?\scinematic(?:\s|>)/,
        "the Academy spar has no final story bark and must appear immediately");
    assert.match(chapterVictory, /<RequiredStoryResultDialog[\s\S]*?\scinematic(?:\s|>)/,
        "an authored chapter victory must explicitly opt into its final-bark beat");
    assert.doesNotMatch(chapterDefeat, /<RequiredStoryResultDialog[\s\S]*?\scinematic(?:\s|>)/,
        "a chapter defeat has no authored final bark and must appear immediately");
    for (const [mode, source] of immediateResultConsumers) {
        assert.match(source, /className="story-fight-complete"/,
            `${mode} must remain on the immediate shared result surface`);
        assert.doesNotMatch(source, /story-fight-complete--cinematic/,
            `${mode} must never opt into the story-only result delay`);
    }
    const sharedRule = battleCss.match(/\.story-fight-complete\s*\{([^}]*)\}/);
    assert.ok(sharedRule, "shared combat result rule is missing");
    assert.doesNotMatch(sharedRule[1], /2\.2s/,
        "wandering AI, Hollow Gate, and Tower results must not inherit a story-only pause");
    assert.match(battleCss, /\.story-fight-complete--cinematic\s*\{[^}]*animation-delay:\s*2\.2s;/s);
});

test("story starts and settlements stay bound to their originating account", () => {
    assert.match(host, /originatingPlayerName:\s*string/);
    assert.match(host, /startRequestIdRef\.current !== requestId/,
        "an invalidated start response must not open a fight for the next account");
    assert.match(host, /activePlayerKeyRef\.current !== originatingPlayerKey/,
        "every async phase must compare against the currently mounted player");
    assert.match(host, /startStoryBossCombat\(\{ playerName: originatingPlayerName \}\)/);
    assert.match(host, /settleStoryBossCombat\(\{ playerName: originatingPlayerName, runId \}\)/);
    assert.match(host, /reportPveFightOutcome\(runId, originatingPlayerName\)/);
    assert.doesNotMatch(host, /playerName:\s*settlingPlayer|reportPveFightOutcome\(runId, settlingPlayer\)/,
        "the arena child must not be able to retarget an old run at the current account");

    const finale = app.slice(
        app.indexOf("function handleServerStoryBossSettled"),
        app.indexOf("function startTriggeredEventArenaBattle"),
    );
    assert.match(finale, /saveConflictAccountKey\(finaleCharacter\.name\) !== saveConflictAccountKey\(result\.character\.name\)/,
        "a rejected old-account result must never run finale effects against characterRef.current");
    assert.ok(finale.indexOf("saveConflictAccountKey(finaleCharacter.name)") < finale.indexOf("unlockVillageKageSystem("));
});

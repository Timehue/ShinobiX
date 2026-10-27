import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFirstPactProgress } from "../../../shared/first-pact-contract.js";
import { FIRST_PACT_NPCS } from "./first-pact-world.js";
import { firstPactReactiveDialogue } from "../screens/first-pact/narrative.js";
import {
    FIRST_PACT_ANCHOR_QUALITIES,
    FIRST_PACT_BALANCING_STANDING,
    FIRST_PACT_FINDING_COST,
    FIRST_PACT_MAIN_BEATS,
    FIRST_PACT_TOURNAMENT,
    FIRST_PACT_VOWS,
} from "../../../shared/first-pact-contract.js";

const screen = ["../screens/FirstPact.tsx", "../screens/first-pact/narrative.ts", "../screens/first-pact/FirstPactCrossingPanel.tsx"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const apiCopy = readFileSync(new URL("./first-pact-api.ts", import.meta.url), "utf8");
const aftermath = readFileSync(new URL("./first-pact-aftermath.ts", import.meta.url), "utf8");
const productionSpec = readFileSync(new URL("../../../docs/first-pact-production-spec.md", import.meta.url), "utf8");

test("companion reactions switch from the NPC's speech to narration", () => {
    const progress = createFirstPactProgress(1);
    progress.mainStep = "challenge-court-echo";
    progress.mainQuest.pactVow = "open-road";
    progress.mainQuest.pactCompanionIds = ["a", "b", "c", "d"];
    progress.finalTrial.wins = 1;
    const companions = ["a", "b", "c", "d"].map(id => ({ id, historicalName: id, currentName: id, available: true }));
    for (const id of ["registrar-orin", "scribe-vey", "keeper-sena"]) {
        const npc = FIRST_PACT_NPCS.find(npc => npc.id === id)!;
        const dialogue = firstPactReactiveDialogue(npc, progress, companions);
        assert.ok(dialogue.narrationStartsAt !== undefined && dialogue.narrationStartsAt > 0);
        assert.ok(dialogue.narrationStartsAt < dialogue.lines.length);
    }
    const plain = firstPactReactiveDialogue(FIRST_PACT_NPCS.find(npc => npc.id === "scribe-vey")!, createFirstPactProgress(1), []);
    assert.equal(plain.narrationStartsAt, undefined);
});

test("First Pact copy uses the main story's plain, zero-dash voice", () => {
    assert.doesNotMatch(`${screen}\n${apiCopy}\n${aftermath}`, /[\u2013\u2014]/u);
    assert.doesNotMatch(screen, /historical echo|living echo/i);
    assert.match(screen, /This is the past, not a reconstructed refuge\./);
});

test("First Pact states the Sunken Court chronology without rewriting the main story", () => {
    assert.match(screen, /crossed the Celestial Tower threshold from another age/i);
    assert.match(screen, /I cannot test the crossing\. I can test the seal/i);
    assert.match(screen, /cut and alloy match the oldest intake plate/i);
    assert.doesNotMatch(screen, /four village anchors do not exist yet/i);
    assert.match(screen, /withheld handlers: people who refused the Court's demand to surrender that choice/i);
    assert.match(screen, /cannot prevent the Sunken Court from falling/i);
    assert.match(screen, /The ruins are unchanged/i);

    /*
     * The ruling this enforces is about the WITHHELD, not about a noun: "they
     * are not ancestors living inside the player, a bloodline, or a source of
     * chosen-one power" (docs/first-pact-production-spec.md). Banning the words
     * across the whole screen is the cheap proxy for that, and it holds for
     * every line the campaign SPEAKS.
     *
     * Reward copy is the one place that legitimately names live game systems --
     * a currency, and the forge it is spent at -- and naming them cannot reframe
     * the Withheld as anything. That block is delimited explicitly and scanned
     * out here, so the exemption is visible in both files rather than hiding as
     * a softened regex. Everything outside the markers, which is all of the
     * narrative, still cannot say it.
     */
    const rewardCopy = /\/\* first-pact:reward-copy \*\/[\s\S]*?\/\* end first-pact:reward-copy \*\//g;
    const exempt = screen.match(rewardCopy) ?? [];
    assert.ok(exempt.length <= 2, "reward copy should be one or two short blocks, not a general escape hatch");
    for (const block of exempt) {
        assert.ok(block.length <= 1_200, `an exempt reward block is ${block.length} chars; keep it to the payout lines`);
        assert.doesNotMatch(block, /\b(?:reincarnation|chosen one|trapped soul)\b/i, "the destiny tropes are never exempt");
        assert.doesNotMatch(block, /Withheld/i, "reward copy must not reach for the Withheld to explain a payout");
    }
    const narrative = screen.replace(rewardCopy, "");
    assert.doesNotMatch(narrative, /\b(?:bloodline|reincarnation|chosen one|trapped soul)\b/i);
});

test("the remembered pact gives three costly answers spanning all four anchor qualities", () => {
    assert.equal(FIRST_PACT_VOWS.length, 3);
    const covered = new Set(FIRST_PACT_VOWS.flatMap((vow) => [...vow.anchors]));
    assert.deepEqual([...covered].sort(), [...FIRST_PACT_ANCHOR_QUALITIES].sort());
    for (const vow of FIRST_PACT_VOWS) {
        assert.ok(FIRST_PACT_MAIN_BEATS.includes(`forge-first-pact-${vow.id}`));
        assert.ok(vow.consequence.length > 40);
        assert.ok(vow.returnCopy.length > 40);
    }
    assert.match(screen, /The Court has issued a finding on your companions/);
});

test("the production spec and runtime tournament use the same names", () => {
    for (const encounter of FIRST_PACT_TOURNAMENT) {
        assert.match(productionSpec, new RegExp(encounter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(productionSpec, new RegExp(encounter.opponent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
});

test("the return walk renders every proven result and remains optional", () => {
    for (const detail of ["writ-silencing", "writ-audit", "writ-pruning", "writ-impound", "vale-stable"]) {
        assert.match(aftermath, new RegExp(`"${detail}"`));
    }
    assert.match(screen, /Walk back: \{nextAftermath\.title\}/);
    assert.match(screen, /Complete the crossing/);
    assert.match(screen, /visitFirstPactAftermath\(character\.name, aftermathId\)/);
    assert.match(screen, /The four who answered/);
});

test("after the crossing the Arbiter offers the Standing Court AND the findings it pays for", () => {
    // The Standing Court never closes once the crossing is complete, and it
    // used to return before the findings branch, so the standing every clear
    // paid had nothing left to buy.
    const arbiter = FIRST_PACT_NPCS.find(npc => npc.id === "court-arbiter")!;
    const progress = createFirstPactProgress(1);
    progress.mainStep = "complete";
    progress.writs = ["writ-silencing"];
    progress.courtStanding = FIRST_PACT_FINDING_COST;
    const dialogue = firstPactReactiveDialogue(arbiter, progress, []);
    const choices = dialogue.choices ?? [];
    assert.ok(choices.some(choice => "encounterId" in choice), "the docket must stay open beside the findings");
    assert.ok(choices.some(choice => "writId" in choice && choice.writId === "writ-silencing"));

    // With nothing affordable, the docket stays first, beside the Court Replays.
    progress.courtStanding = FIRST_PACT_FINDING_COST - 1;
    const poor = firstPactReactiveDialogue(arbiter, progress, []);
    assert.ok(!(poor.choices ?? []).some(choice => "writId" in choice));
    assert.ok("encounterId" in (poor.choices?.[0] ?? {}), "the docket leads the list");
    assert.deepEqual((poor.choices ?? []).flatMap(choice => "postgame" in choice ? [choice.postgame] : []),
        ["unbroken", "unbroken-hard", "replays"]);
});

test("the postgame doors open only after the crossing, and an Unbroken attempt offers to continue", () => {
    const arbiter = FIRST_PACT_NPCS.find(npc => npc.id === "court-arbiter")!;
    const orin = FIRST_PACT_NPCS.find(npc => npc.id === "registrar-orin")!;
    const progress = createFirstPactProgress(1);
    progress.mainStep = "return-to-threshold";
    progress.chapter = 4;
    for (const npc of [arbiter, orin]) {
        assert.ok(!(firstPactReactiveDialogue(npc, progress, []).choices ?? []).some(choice => "postgame" in choice));
    }
    progress.mainStep = "complete";
    const ledger = firstPactReactiveDialogue(orin, progress, []);
    assert.ok((ledger.choices ?? []).some(choice => "postgame" in choice && choice.postgame === "exhibition"));
    progress.replays = { ...progress.replays, run: { hard: true, round: 2 } };
    const docket = firstPactReactiveDialogue(arbiter, progress, []).choices ?? [];
    const resume = docket.find(choice => "postgame" in choice && choice.postgame === "unbroken-continue");
    assert.match(resume?.label ?? "", /on Hard: round 3 of 4/);
    assert.ok(!docket.some(choice => "postgame" in choice && choice.postgame === "unbroken"), "one attempt at a time");
    assert.ok(docket.some(choice => "postgame" in choice && choice.postgame === "unbroken-abandon"), "an attempt can be withdrawn");
});

test("Orin keeps Vale Stable's entry slate open while the player is short of standing", () => {
    // The tournament is one of the roads to the Balancing threshold, and the
    // side-quest tracker sends the player to Orin for it.
    const orin = FIRST_PACT_NPCS.find(npc => npc.id === "registrar-orin")!;
    const progress = createFirstPactProgress(1);
    progress.chapter = 4;
    progress.mainStep = "challenge-court-echo";
    progress.courtStanding = FIRST_PACT_BALANCING_STANDING - 500;
    progress.stableQuest = { status: "accepted", tournamentWins: 0, battleProofs: [] };
    const dialogue = firstPactReactiveDialogue(orin, progress, []);
    assert.match(dialogue.lines.join(" "), /short of the required/);
    assert.equal(dialogue.action?.kind, "stable-battle");
    assert.equal(dialogue.action?.kind === "stable-battle" ? dialogue.action.encounterId : null, FIRST_PACT_TOURNAMENT[0].id);

    progress.stableQuest = { status: "complete", tournamentWins: 3, battleProofs: [] };
    assert.equal(firstPactReactiveDialogue(orin, progress, []).action, undefined);
});

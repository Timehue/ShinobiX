import assert from "node:assert/strict";
import test from "node:test";
import {
    FIRST_PACT_TEAM_SIZE,
    FIRST_PACT_VOWS,
    acceptStableQuest,
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    expectedFirstPactMainEncounter,
    expectedFirstPactTournamentEncounter,
    normalizeFirstPactProgress,
    settleFirstPactTournamentEncounter,
    settleFirstPactMainEncounter,
} from "./first-pact-contract.js";

test("The First Pact fixes its flagship party at two field pets plus two reserves", () => {
    assert.equal(FIRST_PACT_TEAM_SIZE, 4);
});

test("main campaign cannot be skipped and advances through all three premier battles", () => {
    let progress = createFirstPactProgress(10);
    progress = { ...progress, mainStep: "meet-scribe-vey", flags: ["crossed-celestial-threshold"] };

    assert.equal(advanceFirstPactMainBeat(progress, "report-omens", 20).advanced, false);
    progress = advanceFirstPactMainBeat(progress, "meet-scribe", 21).progress;
    progress = advanceFirstPactMainBeat(progress, "omen-bell", 22).progress;
    progress = advanceFirstPactMainBeat(progress, "omen-aqueduct", 23).progress;
    progress = advanceFirstPactMainBeat(progress, "omen-gardens", 24).progress;
    assert.equal(progress.mainStep, "return-to-vey");

    progress = advanceFirstPactMainBeat(progress, "report-omens", 25).progress;
    assert.equal(expectedFirstPactMainEncounter(progress)?.id, "court-menagerie");
    progress = settleFirstPactMainEncounter(progress, "court-menagerie", "win", "main-proof-1", 26).progress;
    progress = advanceFirstPactMainBeat(progress, "recover-record", 27).progress;
    progress = advanceFirstPactMainBeat(progress, "meet-engineer", 28).progress;
    progress = settleFirstPactMainEncounter(progress, "lattice-guardian", "win", "main-proof-2", 29).progress;
    progress = advanceFirstPactMainBeat(progress, "forge-first-pact-shared-reason", 30).progress;
    progress = settleFirstPactMainEncounter(progress, "court-echo", "win", "main-proof-3", 31).progress;
    progress = advanceFirstPactMainBeat(progress, "complete-crossing", 32).progress;

    assert.equal(progress.mainStep, "complete");
    assert.equal(progress.mainQuest.battleProofs.length, 3);
    assert.ok(progress.flags.includes("first-pact-complete"));
    assert.equal(progress.mainQuest.pactVow, "shared-reason");
    assert.equal(progress.courtStanding, 2150);
});

test("the pact choice covers all four Court qualities and records exactly one costly answer", () => {
    const covered = new Set(FIRST_PACT_VOWS.flatMap((vow) => [...vow.anchors]));
    assert.deepEqual([...covered].sort(), ["exit", "future", "reason", "trust"]);
    assert.equal(FIRST_PACT_VOWS.length, 3);
    for (const vow of FIRST_PACT_VOWS) {
        assert.ok(vow.choice.length > 20, `${vow.id} must be a player-voiced choice`);
        assert.ok(vow.consequence.length > 40, `${vow.id} must carry a visible later cost`);
        assert.ok(vow.returnCopy.length > 40, `${vow.id} must be acknowledged on the return`);
    }

    let progress = { ...createFirstPactProgress(10), mainStep: "make-first-pact" as const };
    assert.equal(advanceFirstPactMainBeat(progress, "complete-crossing", 11).advanced, false);
    progress = advanceFirstPactMainBeat(progress, "forge-first-pact-open-road", 12).progress;
    assert.equal(progress.mainQuest.pactVow, "open-road");
    assert.equal(progress.flags.filter((flag) => flag.startsWith("pact-vow-")).length, 1);
    assert.equal(advanceFirstPactMainBeat(progress, "forge-first-pact-kept-future", 13).advanced, false);
    assert.equal(progress.mainQuest.pactVow, "open-road");
});

test("the stable tournament never overwrites main-campaign routing", () => {
    const campaign = advanceFirstPactMainBeat(
        { ...createFirstPactProgress(10), mainStep: "meet-scribe-vey" },
        "meet-scribe",
        20,
    ).progress;
    const accepted = acceptStableQuest(campaign, 21);
    const won = settleFirstPactTournamentEncounter(accepted, "stable-qualifier", "win", "side-proof", 22).progress;
    assert.equal(won.mainStep, "investigate-city-omens");
});

test("Vale Stable cannot be accepted before the Celestial threshold is crossed", () => {
    const sealed = createFirstPactProgress(10);
    assert.equal(acceptStableQuest(sealed, 20), sealed);
    assert.equal(expectedFirstPactTournamentEncounter(sealed), null);
});

test("stable tournament advances in order and is exact-once", () => {
    let progress = acceptStableQuest({
        ...createFirstPactProgress(10),
        mainStep: "meet-scribe-vey",
        flags: ["crossed-celestial-threshold"],
    }, 20);
    assert.equal(expectedFirstPactTournamentEncounter(progress)?.id, "stable-qualifier");

    const wrong = settleFirstPactTournamentEncounter(progress, "stable-final", "win", "wrong", 30);
    assert.equal(wrong.advanced, false);

    const first = settleFirstPactTournamentEncounter(progress, "stable-qualifier", "win", "proof-1", 40);
    assert.equal(first.advanced, true);
    assert.equal(first.progress.stableQuest.tournamentWins, 1);

    const replay = settleFirstPactTournamentEncounter(first.progress, "stable-semifinal", "win", "proof-1", 50);
    assert.equal(replay.advanced, false);
    assert.equal(replay.progress.stableQuest.tournamentWins, 1);

    const second = settleFirstPactTournamentEncounter(first.progress, "stable-semifinal", "win", "proof-2", 60);
    const final = settleFirstPactTournamentEncounter(second.progress, "stable-final", "win", "proof-3", 70);
    assert.equal(final.progress.stableQuest.status, "complete");
    assert.equal(final.progress.courtStanding, 500);
    assert.ok(final.progress.flags.includes("stable-saved"));
});

test("normalizer bounds untrusted stored campaign data", () => {
    const progress = normalizeFirstPactProgress({
        chapter: 90,
        courtStanding: -20,
        flags: ["heard-bell", "heard-bell", 4],
        lastPosition: { x: 999, y: -8, district: "nowhere" },
        stableQuest: { status: "accepted", tournamentWins: 50, battleProofs: ["p", "p"] },
    }, 100);
    assert.equal(progress.chapter, 4);
    assert.equal(progress.courtStanding, 0);
    assert.deepEqual(progress.flags, ["heard-bell"]);
    assert.deepEqual(progress.lastPosition, { x: 83, y: 0, district: "bell-quarter" });
    assert.equal(progress.stableQuest.status, "complete");
    assert.deepEqual(progress.stableQuest.battleProofs, ["p"]);
});

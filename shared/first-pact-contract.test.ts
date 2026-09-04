import assert from "node:assert/strict";
import test from "node:test";
import {
    FIRST_PACT_BALANCING_STANDING,
    FIRST_PACT_DISTRICT_WRITS,
    FIRST_PACT_MAIN_ENCOUNTERS,
    FIRST_PACT_PROGRESS_VERSION,
    FIRST_PACT_TEAM_SIZE,
    FIRST_PACT_TRIAL_ROUNDS,
    FIRST_PACT_TOURNAMENT,
    FIRST_PACT_VOWS,
    acceptStableQuest,
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    expectedFirstPactMainEncounter,
    expectedFirstPactTournamentEncounter,
    normalizeFirstPactProgress,
    firstPactBalancingOwed,
    FIRST_PACT_STANDING_COURT_LENGTH,
    FIRST_PACT_STANDING_COURT_ROUNDS,
    FIRST_PACT_STANDING_COURT_STANDING,
    expectedFirstPactStandingCourtRound,
    firstPactEncounter,
    firstPactMirrorRoster,
    firstPactRosterOf,
    firstPactStandingCourtOpen,
    settleFirstPactStandingCourtRound,
    FIRST_PACT_FINDING_COST,
    enterFirstPactFinding,
    firstPactStandingReserve,
    firstPactStandingSpendable,
    firstPactTrialWinsRequired,
    FIRST_PACT_AURA_BASE,
    firstPactAuraStoneReward,
    firstPactEarnedTitleKeys,
    firstPactTrialRound,
    firstPactWritOpen,
    settleFirstPactTournamentEncounter,
    settleFirstPactWritEncounter,
    settleFirstPactMainEncounter,
} from "./first-pact-contract.js";

test("The First Pact fixes its flagship party at two field pets plus two reserves", () => {
    assert.equal(FIRST_PACT_TEAM_SIZE, 4);
});

test("main campaign cannot be skipped and advances through both premier battles and the Balancing", () => {
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

    // The corridor alone does not oblige the Court to sit. Standing does, and
    // the districts are where it is earned.
    assert.equal(progress.courtStanding, 1050);
    assert.ok(firstPactBalancingOwed(progress) > 0, "the Court must still be owed an answer");
    assert.equal(expectedFirstPactMainEncounter(progress), null, "the Balancing cannot open on the corridor alone");

    FIRST_PACT_DISTRICT_WRITS.forEach((writ, index) => {
        assert.equal(firstPactWritOpen(progress, writ.id), true, `${writ.id} must be servable`);
        progress = settleFirstPactWritEncounter(progress, writ.id, "win", `writ-proof-${index}`, 31 + index).progress;
        assert.equal(firstPactWritOpen(progress, writ.id), false, `${writ.id} must not be answerable twice`);
    });
    assert.equal(progress.courtStanding, 1750);
    assert.equal(firstPactBalancingOwed(progress), 0, "four writs must be enough to be heard");

    // The Balancing: four rounds in order, each refusing to be skipped.
    assert.deepEqual(firstPactTrialRound(progress), { round: 1, of: 4 });
    assert.equal(settleFirstPactMainEncounter(progress, "court-echo", "win", "skip", 40).advanced, false,
        "the Echo cannot be reached before the three rounds in front of it");

    const rounds = ["court-assessors", "court-chorus", "court-wall", "court-echo"] as const;
    rounds.forEach((id, index) => {
        assert.equal(expectedFirstPactMainEncounter(progress)?.id, id);
        assert.deepEqual(firstPactTrialRound(progress), { round: index + 1, of: FIRST_PACT_TRIAL_ROUNDS });
        assert.equal(progress.mainStep, "challenge-court-echo");
        progress = settleFirstPactMainEncounter(progress, id, "win", `trial-proof-${index}`, 41 + index).progress;
    });

    assert.equal(progress.mainStep, "return-to-threshold");
    assert.equal(progress.finalTrial.wins, 4);
    assert.equal(firstPactTrialRound(progress), null, "the trial closes once the Echo is answered");
    progress = advanceFirstPactMainBeat(progress, "complete-crossing", 50).progress;

    assert.equal(progress.mainStep, "complete");
    assert.equal(progress.mainQuest.battleProofs.length, 2, "trial proofs are kept apart from the main-path proofs");
    assert.equal(progress.finalTrial.battleProofs.length, 4);
    assert.ok(progress.flags.includes("first-pact-complete"));
    assert.equal(progress.mainQuest.pactVow, "shared-reason");
    // 2,150 as before, plus 700 from the four writs and 200 + 250 + 300 for the
    // three rounds now standing in front of the Echo.
    assert.equal(progress.courtStanding, 3600);
    assert.equal(progress.writs.length, 4);
});

test("the Court reconsiders once, at the door, and never mid-trial", () => {
    let progress = createFirstPactProgress(10);
    progress = { ...progress, chapter: 4, mainStep: "challenge-court-echo", courtStanding: FIRST_PACT_BALANCING_STANDING };
    assert.equal(expectedFirstPactMainEncounter(progress)?.id, "court-assessors");

    progress = settleFirstPactMainEncounter(progress, "court-assessors", "win", "round-1", 11).progress;
    // Standing cannot fall, but the check must not be re-run between sittings
    // either: a trial already under way is not something the Court can adjourn.
    const impoverished = { ...progress, courtStanding: 0 };
    assert.equal(expectedFirstPactMainEncounter(impoverished)?.id, "court-chorus",
        "a trial in progress keeps sitting");
});

test("writs are the city's own, answered once each and only once the claim exists", () => {
    const districts = new Set(FIRST_PACT_DISTRICT_WRITS.map((writ) => writ.district));
    assert.equal(districts.size, FIRST_PACT_DISTRICT_WRITS.length, "two writs cannot contest one quarter");
    const givers = new Set(FIRST_PACT_DISTRICT_WRITS.map((writ) => writ.giver));
    assert.equal(givers.size, FIRST_PACT_DISTRICT_WRITS.length, "each writ is answered by its own citizen");

    let progress = createFirstPactProgress(10);
    for (const writ of FIRST_PACT_DISTRICT_WRITS) {
        assert.equal(firstPactWritOpen(progress, writ.id), false, "no writ before the Court has a claim to answer");
    }
    progress = { ...progress, chapter: 2 };
    const [first] = FIRST_PACT_DISTRICT_WRITS;
    const won = settleFirstPactWritEncounter(progress, first.id, "win", "proof", 11);
    assert.equal(won.advanced, true);
    assert.ok(won.progress.flags.includes(`answered-${first.id}`));
    assert.equal(settleFirstPactWritEncounter(won.progress, first.id, "win", "another", 12).advanced, false,
        "a district cannot be liberated twice");
    assert.equal(settleFirstPactWritEncounter(progress, first.id, "loss", "lost", 13).advanced, false);
    assert.equal(settleFirstPactWritEncounter(progress, "writ-imaginary", "win", "fake", 14).advanced, false);
});

test("there is more than one road to being heard", () => {
    // The threshold must not be reachable by the corridor alone, and must not
    // demand every errand either -- otherwise it is a wall, not a choice.
    const corridor = 1050;
    const writs = FIRST_PACT_DISTRICT_WRITS.reduce((sum, writ) => sum + writ.standing, 0);
    const tournament = 100 + 100 + 300;
    assert.ok(corridor < FIRST_PACT_BALANCING_STANDING, "the corridor alone cannot open the trial");
    assert.ok(corridor + writs >= FIRST_PACT_BALANCING_STANDING, "the writs alone must be a road");
    assert.ok(corridor + tournament + writs - Math.min(...FIRST_PACT_DISTRICT_WRITS.map((w) => w.standing)) >= FIRST_PACT_BALANCING_STANDING,
        "no single errand may be mandatory");
});

test("a replayed trial round cannot be banked twice", () => {
    let progress = createFirstPactProgress(10);
    progress = { ...progress, chapter: 4, mainStep: "challenge-court-echo", courtStanding: FIRST_PACT_BALANCING_STANDING };
    const first = settleFirstPactMainEncounter(progress, "court-assessors", "win", "same-proof", 11);
    assert.equal(first.advanced, true);
    const again = settleFirstPactMainEncounter(first.progress, "court-assessors", "win", "same-proof", 12);
    assert.equal(again.advanced, false, "the same proof cannot bank a second round");
    assert.equal(first.progress.finalTrial.wins, 1);
});

test("every encounter fields a distinct authored roster, and difficulty only climbs", () => {
    const all = [...FIRST_PACT_TOURNAMENT, ...FIRST_PACT_MAIN_ENCOUNTERS];
    const shapes = new Set<string>();
    for (const encounter of all) {
        const roster = encounter.roster;
        assert.equal(roster.roles.length, FIRST_PACT_TEAM_SIZE, `${encounter.id} must field ${FIRST_PACT_TEAM_SIZE}`);
        assert.equal(roster.elements.length, FIRST_PACT_TEAM_SIZE, `${encounter.id} must field ${FIRST_PACT_TEAM_SIZE}`);
        for (const role of roster.roles) {
            assert.ok(["defender", "sage", "assassin", "tracker"].includes(role), `${encounter.id} names an unknown role ${role}`);
        }
        for (const element of roster.elements) {
            assert.ok(["Fire", "Water", "Wind", "Earth", "Lightning"].includes(element), `${encounter.id} names an unknown element ${element}`);
        }
        const shape = `${roster.roles.join(",")}|${roster.elements.join(",")}`;
        assert.equal(shapes.has(shape), false, `${encounter.id} fields the same four pets as an earlier encounter`);
        shapes.add(shape);
    }

    // A lesson that names a mechanic must be backed by the role that brings it.
    const bringing = (encounter: { roster: { roles: readonly string[] } }, role: string) => encounter.roster.roles.includes(role);
    const byId = Object.fromEntries(all.map((entry) => [entry.id, entry]));
    assert.ok(bringing(byId["stable-semifinal"], "sage"), "the weather lesson needs a sage to bring weather");
    assert.ok(bringing(byId["stable-final"], "defender"), "the protection lesson needs a defender to bring protect");
    assert.ok(bringing(byId["court-menagerie"], "defender"), "the restraint lesson needs a defender");
    assert.ok(bringing(byId["court-chorus"], "sage"), "the standing-weather round needs sages");
    assert.ok(bringing(byId["court-wall"], "defender"), "the wall round needs defenders");

    // The campaign only ever gets harder, never easier, fight to fight.
    const path = ["court-menagerie", "lattice-guardian", "court-assessors", "court-chorus", "court-wall", "court-echo"];
    let previous = -1;
    for (const id of path) {
        const bonus = byId[id].roster.growthShareBonus ?? 0;
        assert.ok(bonus > previous, `${id} must be harder than the fight before it`);
        previous = bonus;
    }
    assert.ok(previous <= .3, "the Court must not out-scale a fully trained roster");
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

test("no save can reach the Balancing and be unable to earn its way in", () => {
    // The migration risk that matters: a player mid-campaign on the old save
    // shape, standing at a step whose trial did not exist when they last played.
    // Every legitimate route to that step banks at least the corridor's 1,050,
    // and both optional roads stay open to them afterwards.
    const corridor = 1050;
    const writs = FIRST_PACT_DISTRICT_WRITS.reduce((sum, writ) => sum + writ.standing, 0);
    const tournament = 100 + 100 + 300;
    assert.ok(corridor + writs + tournament >= FIRST_PACT_BALANCING_STANDING,
        "a player who does everything must be able to be heard");

    for (const legacy of [
        { version: 3, chapter: 3, mainStep: "challenge-court-echo", courtStanding: corridor },
        { version: 3, chapter: 4, mainStep: "challenge-court-echo", courtStanding: corridor + tournament },
        { version: 4, chapter: 4, mainStep: "challenge-court-echo", courtStanding: 0 },
    ]) {
        let progress = normalizeFirstPactProgress(legacy, 1);
        assert.equal(progress.version, FIRST_PACT_PROGRESS_VERSION);
        // Whatever standing the save carries, the writs are open to it, and
        // answering them all must be enough to be heard.
        FIRST_PACT_DISTRICT_WRITS.forEach((writ, index) => {
            assert.equal(firstPactWritOpen(progress, writ.id), true,
                `a resumed save must be able to answer ${writ.id}`);
            progress = settleFirstPactWritEncounter(progress, writ.id, "win", `resume-${index}`, 2 + index).progress;
        });
        if (progress.courtStanding >= FIRST_PACT_BALANCING_STANDING) {
            assert.equal(expectedFirstPactMainEncounter(progress)?.id, "court-assessors",
                "once the standing is there, the trial must open");
        } else {
            // Below the threshold the tournament is the remaining road, and it
            // must still be walkable from the resumed save.
            assert.equal(progress.stableQuest.status !== "complete", true,
                "a save short of the threshold must still have a road left");
        }
    }
});

test("an unfinished crossing earns nothing, and a finished one earns what it actually did", () => {
    let progress = createFirstPactProgress(10);
    assert.deepEqual(firstPactEarnedTitleKeys(progress), [], "an untouched save has earned nothing");
    progress = { ...progress, mainStep: "challenge-court-echo", chapter: 4 };
    assert.deepEqual(firstPactEarnedTitleKeys(progress), [], "standing at the last door is not finishing");

    // The corridor alone: the crossing, and the vow that closed it.
    const bare = { ...progress, mainStep: "complete" as const, mainQuest: { ...progress.mainQuest, pactVow: "open-road" as const } };
    assert.deepEqual(firstPactEarnedTitleKeys(bare), ["complete", "open-road"]);

    // Each vow is its own record, which is what makes a second run worth it.
    for (const vow of FIRST_PACT_VOWS) {
        const run = { ...bare, mainQuest: { ...bare.mainQuest, pactVow: vow.id } };
        assert.deepEqual(firstPactEarnedTitleKeys(run), ["complete", vow.id]);
    }

    // The thorough run: every writ answered and Vale Stable kept.
    const thorough = {
        ...bare,
        writs: FIRST_PACT_DISTRICT_WRITS.map((writ) => writ.id),
        stableQuest: { ...bare.stableQuest, status: "complete" as const, tournamentWins: 3 as const },
    };
    assert.deepEqual(firstPactEarnedTitleKeys(thorough), ["complete", "open-road", "thorough"]);

    // One writ short, or the stable lost, and it is not the thorough run.
    assert.equal(firstPactEarnedTitleKeys({ ...thorough, writs: thorough.writs.slice(1) }).includes("thorough"), false);
    assert.equal(firstPactEarnedTitleKeys({ ...thorough, stableQuest: { ...thorough.stableQuest, status: "accepted" } }).includes("thorough"), false);
});

test("Aura Stones are paid for finishing, weighted to the optional roads, and stay scarce", () => {
    let progress = createFirstPactProgress(10);
    assert.equal(firstPactAuraStoneReward(progress), 0, "an untouched save is owed nothing");
    progress = { ...progress, mainStep: "challenge-court-echo", chapter: 4 };
    assert.equal(firstPactAuraStoneReward(progress), 0, "standing at the last door pays nothing");

    const bare = { ...progress, mainStep: "complete" as const };
    assert.equal(firstPactAuraStoneReward(bare), FIRST_PACT_AURA_BASE);

    const everyWrit = { ...bare, writs: FIRST_PACT_DISTRICT_WRITS.map((writ) => writ.id) };
    assert.ok(firstPactAuraStoneReward(everyWrit) > firstPactAuraStoneReward(bare),
        "answering every writ must be worth more than skipping them");

    const thorough = { ...everyWrit, stableQuest: { ...bare.stableQuest, status: "complete" as const, tournamentWins: 3 as const } };
    const most = firstPactAuraStoneReward(thorough);
    assert.ok(most > firstPactAuraStoneReward(everyWrit), "keeping Vale Stable must be worth something");

    // The guard that matters. An A Rank bloodline costs 100 and the ranked
    // season podium -- the competitive faucet -- pays 10 for first place across
    // thirty days. A one-time campaign must contribute to that ladder, never
    // replace it.
    assert.ok(most <= 25, `a full crossing pays ${most}; more than a quarter of an A Rank undercuts ranked`);
    assert.ok(most >= 20, "a full crossing should still be worth the detour");
    const optional = most - FIRST_PACT_AURA_BASE;
    assert.ok(optional / most >= .3, "the optional roads must carry a real share of the reward");
});




test("every encounter answers a loss in the opponent's own voice", () => {
    const all = [...FIRST_PACT_TOURNAMENT, ...FIRST_PACT_MAIN_ENCOUNTERS, ...FIRST_PACT_DISTRICT_WRITS];
    const seen = new Set<string>();
    for (const entry of all) {
        assert.ok(
            entry.defeat.length > 60,
            `${entry.id} needs real defeat copy, not a stub (${entry.defeat.length} chars)`,
        );
        // The result panel is a passage, not a paragraph of exposition.
        assert.ok(entry.defeat.length < 400, `${entry.id} defeat copy is too long for the result panel`);
        assert.ok(!seen.has(entry.defeat), `${entry.id} reuses another encounter's defeat copy`);
        seen.add(entry.defeat);
        // A loss is retryable everywhere in this campaign, so the copy may not
        // narrate an irreversible outcome the player can still go and prevent.
        assert.doesNotMatch(
            entry.defeat,
            /\b(?:forever|never again|for good|permanently)\b/i,
            `${entry.id} promises a finality the retry loop then contradicts`,
        );
    }
    assert.equal(seen.size, all.length);
});

test("Court Standing is spendable, and the sink cannot lock the Balancing shut", () => {
    const answered = FIRST_PACT_DISTRICT_WRITS.map((writ) => writ.id);
    const base = { ...createFirstPactProgress(1), mainStep: "challenge-court-echo" as const, writs: answered };

    // Exactly at the threshold, before the Court has sat: nothing is spendable,
    // because spending here is what would strand the player.
    const atGate = { ...base, courtStanding: FIRST_PACT_BALANCING_STANDING };
    assert.equal(firstPactStandingSpendable(atGate), 0);
    assert.equal(enterFirstPactFinding(atGate, answered[0]).advanced, false);

    // Surplus above the threshold is the player's to spend.
    const rich = { ...base, courtStanding: FIRST_PACT_BALANCING_STANDING + FIRST_PACT_FINDING_COST };
    const bought = enterFirstPactFinding(rich, answered[0]);
    assert.equal(bought.advanced, true);
    assert.equal(bought.progress.courtStanding, FIRST_PACT_BALANCING_STANDING);
    assert.deepEqual(bought.progress.findings, [answered[0]]);
    assert.ok(bought.progress.flags.includes(`entered-${answered[0]}`));
    // Still enough to be heard, which is the whole point of the reserve.
    assert.equal(firstPactBalancingOwed(bought.progress), 0);

    // Once the Court has sat, the gate is behind them and the reserve lifts.
    const sitting = { ...base, courtStanding: 900, finalTrial: { wins: 1, battleProofs: [] } };
    assert.equal(firstPactStandingReserve(sitting), 0);
    assert.equal(enterFirstPactFinding(sitting, answered[1]).advanced, true);

    // No double entry, and no entry for a writ this character never answered.
    assert.equal(enterFirstPactFinding(bought.progress, answered[0]).advanced, false);
    const unanswered = { ...rich, writs: [] };
    assert.equal(enterFirstPactFinding(unanswered, answered[0]).advanced, false);
    assert.equal(enterFirstPactFinding(rich, "writ-does-not-exist").advanced, false);
});

test("a completionist can afford the sink, and it consumes most of the surplus", () => {
    // Standing actually reachable: every story beat, both confrontations, all
    // four writs, Vale Stable, and all four rounds of the Balancing.
    const beats = 50 + (25 * 3) + 75 + 100 + 150 + 400;
    const confrontations = 250 + 350;
    const writs = FIRST_PACT_DISTRICT_WRITS.reduce((sum, writ) => sum + writ.standing, 0);
    const stable = 100 + 100 + 300;
    const balancing = FIRST_PACT_MAIN_ENCOUNTERS
        .filter((entry) => firstPactTrialWinsRequired(entry) !== undefined)
        .reduce((sum, entry) => sum + entry.standing, 0);
    const total = beats + confrontations + writs + stable + balancing;

    const everything = FIRST_PACT_DISTRICT_WRITS.length * FIRST_PACT_FINDING_COST;
    assert.ok(everything <= total, "a player who did everything must be able to enter everything");
    // The sink has to be big enough to matter. Before it existed, all of this
    // bought nothing at all.
    assert.ok(everything / total > .5, `the sink only absorbs ${Math.round((everything / total) * 100)}% of reachable standing`);
});

test("normalize refuses a finding for a writ that was never answered", () => {
    const restored = normalizeFirstPactProgress({
        version: 6,
        writs: ["writ-audit"],
        findings: ["writ-audit", "writ-impound", "not-a-writ"],
    });
    assert.deepEqual(restored.findings, ["writ-audit"]);
    // A save written before findings existed simply has none.
    assert.deepEqual(normalizeFirstPactProgress({ version: 5, writs: ["writ-audit"] }).findings, []);
});

test("no encounter can ask for a tier the Showdown engine does not have", () => {
    // `tier: "legend"` type-checked against the old union and threw inside
    // buildShowdownAiTeam, because TIER_RARITIES has no entry to read. It is
    // the obvious thing to reach for when authoring a bigger boss, so the
    // union is narrowed and this holds the line at runtime too.
    const engineTiers = new Set(["scrapper", "warrior", "champion"]);
    for (const entry of [...FIRST_PACT_TOURNAMENT, ...FIRST_PACT_MAIN_ENCOUNTERS, ...FIRST_PACT_DISTRICT_WRITS]) {
        assert.ok(engineTiers.has(entry.tier), `${entry.id} asks for tier "${entry.tier}", which the engine cannot build`);
    }
});


/** A finished crossing, standing in the square with a run not yet begun. */
function completedCrossing() {
    return {
        ...createFirstPactProgress(1),
        mainStep: "complete" as const,
        chapter: 4 as const,
        courtStanding: 4_100,
    };
}

test("the Standing Court is shut until the crossing is closed, then never shuts again", () => {
    const midCampaign = { ...createFirstPactProgress(1), mainStep: "challenge-court-echo" as const };
    assert.equal(firstPactStandingCourtOpen(midCampaign), false);
    assert.equal(expectedFirstPactStandingCourtRound(midCampaign), null);
    // Even naming a sitting directly settles nothing before the crossing closes.
    assert.equal(settleFirstPactStandingCourtRound(midCampaign, "standing-court-assessors", "win", "p1").advanced, false);

    const done = completedCrossing();
    assert.equal(firstPactStandingCourtOpen(done), true);
    assert.equal(expectedFirstPactStandingCourtRound(done)?.id, FIRST_PACT_STANDING_COURT_ROUNDS[0].id);
});

test("the rerun re-argues the Balancing and then adds the one fight that is new", () => {
    assert.equal(FIRST_PACT_STANDING_COURT_LENGTH, 5);
    const balancing = FIRST_PACT_MAIN_ENCOUNTERS.filter((entry) => firstPactTrialWinsRequired(entry) !== undefined);
    // Every Balancing round is re-argued. Adding a fifth story round without a
    // matching sitting would silently leave it out of the rerun.
    assert.equal(FIRST_PACT_STANDING_COURT_LENGTH, balancing.length + 1);
    for (const [index, sitting] of FIRST_PACT_STANDING_COURT_ROUNDS.slice(0, balancing.length).entries()) {
        const source = balancing[index];
        assert.equal(sitting.title, source.title, "a sitting must re-argue its round, not a copy of it");
        assert.equal(sitting.lesson, source.lesson);
        assert.equal(sitting.defeat, source.defeat);
        assert.equal(sitting.round, index);
        const rerun = firstPactRosterOf(sitting).growthShareBonus ?? 0;
        const story = firstPactRosterOf(source).growthShareBonus ?? 0;
        assert.ok(rerun > story, `${sitting.id} must be heavier than the round it re-argues`);
    }
    const champion = FIRST_PACT_STANDING_COURT_ROUNDS[FIRST_PACT_STANDING_COURT_LENGTH - 1];
    assert.equal(champion.id, "standing-court-arbiter");
    assert.equal(champion.opponent, "The Arbiter");
    // .35 is the engine's hard clamp on growthShareBonus. The last fight in the
    // campaign sits on it, so nothing authored later can be built heavier.
    assert.equal(firstPactRosterOf(champion).growthShareBonus, .35);
    assert.equal(firstPactRosterOf(champion).mirrorsPlayer, true);
    assert.equal(firstPactRosterOf(champion).roles, undefined, "a mirrored roster must not also carry fixed roles");
    // Every sitting resolves through the shared lookup, or the session
    // breadcrumb and the defeat copy both fail to find it.
    for (const sitting of FIRST_PACT_STANDING_COURT_ROUNDS) {
        assert.equal(firstPactEncounter(sitting.id)?.id, sitting.id);
    }
});

test("a run advances one sitting at a time and a loss sends it back to the top", () => {
    let progress = completedCrossing();
    for (let round = 0; round < FIRST_PACT_STANDING_COURT_LENGTH - 1; round += 1) {
        const expected = expectedFirstPactStandingCourtRound(progress);
        assert.equal(expected?.round, round);
        progress = settleFirstPactStandingCourtRound(progress, expected!.id, "win", `win-${round}`).progress;
        assert.equal(progress.standingCourt.round, round + 1);
        assert.equal(progress.standingCourt.best, round + 1);
        assert.equal(progress.standingCourt.clears, 0);
    }

    // Losing the Arbiter costs the whole run, and nothing else.
    const standingBefore = progress.courtStanding;
    const bestBefore = progress.standingCourt.best;
    const lost = settleFirstPactStandingCourtRound(progress, "standing-court-arbiter", "loss", "lose-1");
    assert.equal(lost.advanced, true, "a loss must be recorded: it is the entire difficulty of this mode");
    assert.equal(lost.progress.standingCourt.round, 0);
    assert.equal(lost.progress.standingCourt.best, bestBefore, "a loss never takes back the furthest reached");
    assert.equal(lost.progress.courtStanding, standingBefore, "a loss must not cost standing");
    assert.equal(lost.progress.standingCourt.clears, 0);
    assert.equal(lost.progress.mainStep, "complete", "a rerun can never touch the story record");
});

test("clearing the gauntlet pays standing once and starts the next run at the top", () => {
    let progress = completedCrossing();
    for (let round = 0; round < FIRST_PACT_STANDING_COURT_LENGTH; round += 1) {
        const expected = expectedFirstPactStandingCourtRound(progress);
        progress = settleFirstPactStandingCourtRound(progress, expected!.id, "win", `clear-${round}`).progress;
    }
    assert.equal(progress.standingCourt.clears, 1);
    assert.equal(progress.standingCourt.round, 0);
    assert.equal(progress.standingCourt.best, FIRST_PACT_STANDING_COURT_LENGTH);
    assert.equal(progress.courtStanding, 4_100 + FIRST_PACT_STANDING_COURT_STANDING);
    assert.ok(progress.flags.includes("answered-standing-court"));
    // A replayed finishing response must not pay twice.
    const replay = settleFirstPactStandingCourtRound(progress, "standing-court-assessors", "win", "clear-4");
    assert.equal(replay.advanced, false);
});

test("a rerun never disturbs the story's own record of the Balancing", () => {
    let progress = { ...completedCrossing(), finalTrial: { wins: 4, battleProofs: ["story-proof"] } };
    for (let round = 0; round < FIRST_PACT_STANDING_COURT_LENGTH; round += 1) {
        const expected = expectedFirstPactStandingCourtRound(progress);
        progress = settleFirstPactStandingCourtRound(progress, expected!.id, "win", `sep-${round}`).progress;
    }
    assert.deepEqual(progress.finalTrial, { wins: 4, battleProofs: ["story-proof"] });
    assert.deepEqual(progress.mainQuest.battleProofs, []);
});

test("the mirror roster is the player's own four, and is always complete", () => {
    const team = [
        { role: "tracker", element: "Wind" },
        { role: "tracker", element: "Wind" },
        { role: "tracker", element: "Lightning" },
        { role: "sage", element: "Water" },
    ];
    const mirrored = firstPactMirrorRoster(team, .35);
    assert.deepEqual(mirrored.roles, ["tracker", "tracker", "tracker", "sage"]);
    assert.deepEqual(mirrored.elements, ["Wind", "Wind", "Lightning", "Water"]);
    assert.equal(mirrored.growthShareBonus, .35);

    // A pet with no stored role still has to field something, or the Court
    // arrives a member short against a save that predates role backfill.
    const unroled = firstPactMirrorRoster([{}, {}, {}, {}]);
    assert.equal(unroled.roles?.length, 4);
    assert.equal(unroled.elements?.length, 4);
    assert.equal(new Set(unroled.roles).size, 4, "an unroled team should meet one of everything");
    assert.equal(unroled.growthShareBonus, undefined);

    // Short and junk input still yields four filled slots rather than holes.
    const ragged = firstPactMirrorRoster([{ role: "defender", element: "Earth" }] as never);
    assert.equal(ragged.roles?.length, 4);
    assert.ok(ragged.roles?.every((role) => typeof role === "string" && role.length > 0));
});

test("a stored run is clamped to a sitting that exists", () => {
    const restored = normalizeFirstPactProgress({
        version: 7,
        mainStep: "complete",
        standingCourt: { round: 99, best: 99, clears: -3, battleProofs: ["a", "a", ""] },
    });
    assert.equal(restored.standingCourt.round, FIRST_PACT_STANDING_COURT_LENGTH - 1);
    assert.equal(restored.standingCourt.best, FIRST_PACT_STANDING_COURT_LENGTH);
    assert.equal(restored.standingCourt.clears, 0);
    assert.deepEqual(restored.standingCourt.battleProofs, ["a"]);
    // A save written before the rerun existed simply has no run.
    const legacy = normalizeFirstPactProgress({ version: 6, mainStep: "complete" });
    assert.deepEqual(legacy.standingCourt, { round: 0, best: 0, clears: 0, battleProofs: [] });
});

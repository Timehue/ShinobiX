import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pet } from "../types/pet";
import {
    DEFAULT_SHARED_WARFRONT_SETUP,
    arenaMatchOwnedByPlayer,
    buildAcceptedArenaMatch,
    buildResponderArenaMatch,
    ownArenaMatch,
    parseWarfrontSetup,
    parseVersionedWarfrontSetup,
    sharedWarfrontSetup,
    type ArenaChallengeLike,
} from "./arena-challenge.ts";

const pet = (id: string): Pet => ({ id, name: id } as Pet);

function challenge(): ArenaChallengeLike {
    return {
        arenaSize: 2,
        petBattleSeed: 98765,
        challenger: { pets: [pet("blue-1"), pet("blue-2")] },
        challengerTeamIds: ["blue-2", "blue-1"],
        responderTeam: [pet("red-1"), pet("red-2")],
        challengerWarfrontSetup: { stance: "siege", doctrine: "vanguard", buyPolicy: "offense", deployment: ["top", "mid", "bottom", "flex"], buildPackage: "blood-hunt", coachOrder: "ambush", objectiveTechnique: "hijack", counterstrike: "bounty-hunt" },
        responderWarfrontSetup: { stance: "turtle", doctrine: "bulwark", buyPolicy: "defense", deployment: ["top", "mid", "bottom", "flex"], buildPackage: "hold-line", coachOrder: "contest", objectiveTechnique: "zone", counterstrike: "fortify" },
    };
}

test("accepted PvP payload seals both coaches' setup and the challenger's perspective", () => {
    const match = buildAcceptedArenaMatch(challenge());
    assert.ok(match);
    assert.deepEqual(match.blue.map((entry) => entry.id), ["blue-2", "blue-1"]);
    assert.deepEqual(match.red.map((entry) => entry.id), ["red-1", "red-2"]);
    assert.deepEqual(match.blueSetup, challenge().challengerWarfrontSetup);
    assert.deepEqual(match.redSetup, challenge().responderWarfrontSetup);
    assert.equal(match.localTeam, "blue");
});

test("responder builds the identical simulation inputs from the red perspective", () => {
    const source = challenge();
    const red = source.responderTeam!;
    const challenger = buildAcceptedArenaMatch(source);
    const responder = buildResponderArenaMatch(source, red);
    assert.ok(challenger && responder);
    assert.deepEqual(
        { ...responder, localTeam: "blue" },
        challenger,
        "perspective is the only client-local field",
    );
    assert.equal(responder.localTeam, "red");
});

test("shared matches convert Manual Council to a deterministic auto policy", () => {
    assert.deepEqual(
        sharedWarfrontSetup("headhunt", "zealot", "off"),
        { ...DEFAULT_SHARED_WARFRONT_SETUP, stance: "headhunt", doctrine: "zealot" },
    );
});

test("accepted PvP reveals fail closed on seed, roster, and authored-setup corruption", () => {
    const missingSeed = challenge();
    delete missingSeed.petBattleSeed;
    assert.equal(buildAcceptedArenaMatch(missingSeed), null);
    assert.equal(buildAcceptedArenaMatch({ ...challenge(), petBattleSeed: 0 }), null);

    assert.equal(buildAcceptedArenaMatch({ ...challenge(), challengerTeamIds: ["blue-1"] }), null);
    assert.equal(buildAcceptedArenaMatch({ ...challenge(), challengerTeamIds: ["blue-1", "blue-1"] }), null);
    assert.equal(buildAcceptedArenaMatch({ ...challenge(), responderTeam: [pet("red-1")] }), null);
    assert.equal(buildAcceptedArenaMatch({ ...challenge(), responderTeam: [pet("red-1"), pet("red-1")] }), null);
    assert.equal(buildAcceptedArenaMatch({ ...challenge(), challenger: undefined }), null,
        "an opaque accepted inbox notice never dereferences a missing challenger");

    const invalidDoctrine = challenge();
    invalidDoctrine.challengerWarfrontSetup = { ...invalidDoctrine.challengerWarfrontSetup!, doctrine: "forged" as never };
    assert.equal(buildAcceptedArenaMatch(invalidDoctrine), null);
    const invalidDeployment = challenge();
    invalidDeployment.responderWarfrontSetup = { ...invalidDeployment.responderWarfrontSetup!, deployment: ["top", "top", "bottom", "flex"] as never };
    assert.equal(buildResponderArenaMatch(invalidDeployment, invalidDeployment.responderTeam!), null);

    const incomplete = { ...challenge().challengerWarfrontSetup } as Partial<NonNullable<ArenaChallengeLike["challengerWarfrontSetup"]>>;
    delete incomplete.counterstrike;
    assert.equal(parseWarfrontSetup(incomplete), null);
});

test("a routed accepted reveal is consumed only by its normalized player owner", () => {
    const match = buildAcceptedArenaMatch(challenge());
    assert.ok(match);
    const pending = ownArenaMatch(match, "  Kakashi ", "arena-1");
    assert.ok(pending);
    assert.equal(arenaMatchOwnedByPlayer(pending, "KAKASHI"), true);
    assert.equal(arenaMatchOwnedByPlayer(pending, "Obito"), false,
        "an account swap before the launch effect cannot start the prior account's match");
});

test("co-op consumes the same strict versioned server setup on both clients", () => {
    const wire = { version: 1, ...DEFAULT_SHARED_WARFRONT_SETUP };
    const blueClient = parseVersionedWarfrontSetup(JSON.parse(JSON.stringify(wire)));
    const redClient = parseVersionedWarfrontSetup(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(blueClient, wire);
    assert.deepEqual(redClient, blueClient);
    assert.equal(parseVersionedWarfrontSetup({ ...wire, version: 2 }), null);
    assert.equal(parseVersionedWarfrontSetup({ ...wire, deployment: ["top", "top", "bottom", "flex"] }), null);
    assert.equal(parseVersionedWarfrontSetup(DEFAULT_SHARED_WARFRONT_SETUP), null, "unversioned local defaults fail closed");

    const source = readFileSync(new URL("../components/ArenaCoopLobby.tsx", import.meta.url), "utf8");
    const pairs = [
        ["deployment", "opponentDeployment"],
        ["buildPackage", "opponentBuildPackage"],
        ["coachOrder", "opponentCoachOrder"],
        ["objectiveTechnique", "opponentObjectiveTechnique"],
        ["counterstrike", "opponentCounterstrike"],
    ] as const;
    for (const [blueProp, redProp] of pairs) {
        assert.match(source, new RegExp(`${blueProp}=\\{blueSetup\\.`));
        assert.match(source, new RegExp(`${redProp}=\\{redSetup\\.`));
    }
    assert.match(source, /parseVersionedWarfrontSetup\(lobby\.match\.blueSetup\)/);
    assert.match(source, /parseVersionedWarfrontSetup\(lobby\.match\.redSetup\)/);
    assert.doesNotMatch(source, /DEFAULT_SHARED_WARFRONT_SETUP/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    isPetArenaPlayerScopeActive,
    normalizePetArenaVersionDecision,
    parseWarfrontRewardSeal,
    responseBelongsToPetArenaPlayer,
} from "./pet-arena-settlement";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const arenaSource = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");

test("Pet Arena settlement scope expires on unmount or an in-place account swap", () => {
    const origin = { playerName: "Kakashi", generation: 4 };

    assert.equal(isPetArenaPlayerScopeActive(origin, origin, true), true);
    assert.equal(isPetArenaPlayerScopeActive(origin, { playerName: "Sakura", generation: 5 }, true), false);
    assert.equal(isPetArenaPlayerScopeActive(origin, origin, false), false);
});

test("stale same-account snapshots remain distinct from foreign-account responses", () => {
    assert.equal(normalizePetArenaVersionDecision(false), "stale");
    assert.equal(normalizePetArenaVersionDecision("stale"), "stale");
    assert.equal(normalizePetArenaVersionDecision("foreign"), "foreign");
    assert.equal(normalizePetArenaVersionDecision(true), "accepted");
    assert.equal(normalizePetArenaVersionDecision(undefined), "accepted");
});

test("authoritative character receipts cannot cross player identities", () => {
    const origin = { playerName: "Kakashi", generation: 2 };

    assert.equal(responseBelongsToPetArenaPlayer(origin, "kAkAsHi"), true);
    assert.equal(responseBelongsToPetArenaPlayer(origin), true);
    assert.equal(responseBelongsToPetArenaPlayer(origin, "Obito"), false);
});

test("Warfront proofs bind the token and report identity to the server-minted seed", () => {
    const now = 1_000_000;
    const canonicalConfig = {
        stance: "balanced",
        doctrine: "none",
        buyPolicy: "balanced",
        opponentStance: "balanced",
        opponentDoctrine: "vanguard",
    } as const;
    const bluePets = Array.from({ length: 4 }, (_, index) => ({
        id: `pet-${index}`,
        name: `Pet ${index}`,
        rarity: "standard",
        level: 20,
        xp: 0,
        maxLevel: 100,
        hp: 300,
        attack: 50,
        defense: 40,
        speed: 30,
        jutsus: [],
        unlockedForPve: true,
    }));
    const authority = {
        ...canonicalConfig,
        bluePets,
        redPets: bluePets.map((pet, index) => ({ ...pet, id: `rival-${index}`, name: `Rival ${index}` })),
        expiresAt: now + 30 * 60_000,
        matchDurationMs: 10 * 60_000,
        settleAfter: now + 10 * 60_000,
        safePlaybackForMs: 30 * 60_000,
    };
    assert.deepEqual(
        parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority }),
        { token: "sealed-proof", seed: 7301, reportKey: "7301:tactical", ...authority },
    );
    assert.deepEqual(
        parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, reportKey: "7301:tactical", ...authority }),
        { token: "sealed-proof", seed: 7301, reportKey: "7301:tactical", ...authority },
    );
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: "7301", ...authority }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, reportKey: "1:tactical", ...authority }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "", seed: 7301, ...authority }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301 }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority, opponentStance: "adaptive", opponentDoctrine: "none" }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority, bluePets: bluePets.slice(0, 3) }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority, redPets: authority.redPets.slice(0, 3) }), null);
    assert.equal(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority, safePlaybackForMs: 19 * 60_000 }), null);

    const realDateNow = Date.now;
    Date.now = () => now + 24 * 60 * 60_000;
    try {
        assert.ok(parseWarfrontRewardSeal({ token: "sealed-proof", seed: 7301, ...authority }), "a fast device clock must not reject server-relative playback authority");
    } finally {
        Date.now = realDateNow;
    }
});

test("Pet Arena's App boundary reports foreign and stale responses separately", () => {
    assert.match(appSource, /screen === "petArena"[\s\S]*onServerVersion=\{acceptExternalSaveVersion\}/);
    assert.match(appSource, /onVersionedCharacter=\{\(next, version, origin\) => saveConflictAccountKey\(next\.name\) === saveConflictAccountKey\(origin\)/);
    assert.match(appSource, /commitVersionedCharacter\(next, version\) \? "accepted" : "stale"\) : "foreign"/);
    assert.match(arenaSource, /if \(decision === "foreign"\)[\s\S]*return false;/);
    assert.match(arenaSource, /if \(decision === "stale"\)[\s\S]*clearSpentConsumables/);
});

test("every authoritative Pet Arena result exposes an idempotent retry receipt", () => {
    for (const kind of ["tactical", "party", "ranked", "casual"] as const) {
        assert.match(arenaSource, new RegExp(`kind: "${kind}"`));
    }
    assert.match(arenaSource, /Retry Settlement/);
    assert.match(arenaSource, /const inputLog = livePartyDuel\?\.inputLog\(\)/);
    assert.match(arenaSource, /const inputLog = liveDuel\?\.inputLog\(\)/);
    assert.doesNotMatch(arenaSource, /unrewarded:\$\{/);
    assert.match(arenaSource, /if \(petSettlementBlocksExit\)/);
});

test("a rewarded Warfront keeps authoritative Witness progress and its final Chronicle ceremony on the result screen", () => {
    const warfront = readFileSync(new URL("../components/PetWarfrontMatch.tsx", import.meta.url), "utf8");
    assert.match(arenaSource, /resultSupplement=\{chronicleProgress \|\| chronicleCeremony \? \([\s\S]*chronicleProgress \? <PetChronicleProgress receipt=\{chronicleProgress\} \/> : null[\s\S]*chronicleCeremony \? \([\s\S]*<PetChronicleCeremony/);
    assert.match(arenaSource, /resultActionsLocked=\{warfrontResultActionsLocked\}/);
    assert.match(arenaSource, /arenaMatch\?\.vsAi[\s\S]*activeSettlementAttempt\.status !== "settled"/);
    assert.match(warfront, /\{resultSupplement \? \([\s\S]*\{resultSupplement\}/);
    assert.match(warfront, /disabled=\{resultActionsLocked\}/);
    assert.match(warfront, /disabled=\{settlementPending\}/);
    // Fight Again is withheld while a result is still being recorded, and for
    // the fights that cannot honestly be repeated. `battleOpponent?.hollowGate`
    // used to lead this list; a sealed Gate duel no longer reaches this screen
    // at all (it runs run-bound on the shrine), so the term went with it.
    assert.match(arenaSource, /onFightAgain=\{battleOpponent\?\.ranked \|\| petSettlementBlocksExit \|\| chronicleCeremony \? undefined/);
});

test("rewarded Warfronts render and settle only the server-minted seed", () => {
    const mintStart = arenaSource.indexOf("function mintWarfrontToken");
    const reportStart = arenaSource.indexOf("function reportTacticalArenaResult", mintStart);
    const queueStart = arenaSource.indexOf("function queueSealedWarfront");
    const startMatchStart = arenaSource.indexOf("async function startArenaMatch", queueStart);
    assert.ok(mintStart >= 0 && reportStart > mintStart);
    assert.ok(queueStart >= 0 && startMatchStart > queueStart);
    const mintSource = arenaSource.slice(mintStart, reportStart);
    const queueSource = arenaSource.slice(queueStart, startMatchStart);

    assert.doesNotMatch(mintSource, /\bseed\b/);
    assert.doesNotMatch(mintSource, /\breportKey\b/);
    assert.match(arenaSource, /const sealRequest = mintWarfrontToken\(blue\.slice\(0, n\), scope, matchConfig\)/);
    assert.match(arenaSource, /const blue = seal\.bluePets\.map/);
    assert.match(arenaSource, /const red = seal\.redPets\.map/);
    assert.match(arenaSource, /localPetsById\.get\(pet\.id\)[\s\S]*cosmetic\?\.image[\s\S]*cosmetic\?\.bodyImage/);
    assert.match(queueSource, /blue: autoRoleTeam\(blue, blue\.length\)[\s\S]*red: autoRoleTeam\(red, red\.length\)[\s\S]*seed: seal\.seed[\s\S]*buyPolicy: seal\.buyPolicy/);
    assert.doesNotMatch(queueSource, /Math\.random|Date\.now|seed\s*=/,
        "the queued rewarded replay must freeze the server seal's seed without local derivation or mutation");
    assert.match(arenaSource, /startArenaMatch\(selectedTacticalPets, \[\], [^\n]+true\)/);
    assert.match(arenaSource, /playerPetIds: bluePets\.map\(\(p\) => p\.id\),[\s\S]*stance: config\.stance/);
    assert.match(arenaSource, /autoBuy=\{arenaMatch\.buyPolicy\}/);
    assert.match(arenaSource, /opponentStance=\{arenaMatch\.opponentStance\}/);
    assert.match(arenaSource, /opponentDoctrine=\{arenaMatch\.opponentDoctrine\}/);
    assert.doesNotMatch(arenaSource, /allowReseed=/);
    assert.match(arenaSource, /seal\.seed !== m\.seed[\s\S]*seal\.reportKey !== reportKey[\s\S]*seal\.stance !== m\.stance[\s\S]*seal\.doctrine !== m\.doctrine[\s\S]*seal\.buyPolicy !== m\.buyPolicy[\s\S]*seal\.opponentStance !== m\.opponentStance/);
    assert.match(arenaSource, /seal\.redPets\.map\(\(pet\) => pet\.id\)[\s\S]*rivalPetIds/);
    assert.match(arenaSource, /battleToken: seal\.token/);
    assert.match(arenaSource, /if \(!r\.ok\)[\s\S]*payload\?\.error[\s\S]*Retry-After[\s\S]*warfrontSetupErrorRef\.current/);
    assert.match(arenaSource, /Retry to recover any existing battle seal safely/);
    assert.match(arenaSource, /resumeOnly: true/);
    assert.match(arenaSource, /warfrontResumeProbeScopeRef[\s\S]*void resumeOwnedWarfront\(scope\)/);
    assert.match(arenaSource, />Warfront needs attention</);

    const setupSource = arenaSource.slice(arenaSource.indexOf("War Council (every 90s)"), arenaSource.indexOf("Full-screen game-mode overlays"));
    assert.doesNotMatch(setupSource, /Manual/);
    assert.match(setupSource, /Rewarded AI uses the automatic policy you seal at kickoff/);
    assert.match(setupSource, /Fixed rival plan: Balanced formation · Vanguard doctrine/);
});

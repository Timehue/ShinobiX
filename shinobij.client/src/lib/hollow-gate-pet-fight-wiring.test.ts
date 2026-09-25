/*
 * The Hollow Gate pet duel runs on Showdown, and only on Showdown.
 *
 * The server side of this shipped and then sat unused for a while:
 * /api/pet/showdown's arena entry accepted a Hollow Gate binding, validated the
 * run claim and minted the run's `hg-pet-result` receipt — and nothing called
 * it, because `launchPetFight` still routed the player to the Pet Arena screen,
 * which minted a battle-start token and fought the legacy client sim. A server
 * port with no caller looks exactly like a finished port from the outside,
 * which is why this is a gate and not a comment.
 *
 * Source-reading, deliberately: the thing to protect is the WIRING, and the
 * wiring is what a refactor silently reverts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const root = join(process.cwd(), "shinobij.client", "src");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

/** Drop comments so these gates match CODE — the files explain the retired
 *  path in prose, and a gate that cannot tell an explanation from a call would
 *  forbid documenting the fix. */
const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the Hollow Gate pet duel is bound to its run", () => {
    const flow = stripComments(read("lib", "hollow-gate-app-flow.ts"));

    it("launches a run-bound Showdown encounter, not a Pet Arena detour", () => {
        assert.ok(flow.includes("setPetFight("), "it must open the run-bound fight");
        assert.equal(/setScreen\("petArena"\)/.test(flow), false,
            "a sealed duel must not hand the player to the Pet Arena screen");
        assert.equal(/buildHollowHoundOpponent/.test(flow), false,
            "the Hound is built by the SERVER from the run binding, never here");
    });

    it("sends only the run's identifiers, never a format, a team or an opponent", () => {
        const host = stripComments(read("components", "HollowGatePetFight.tsx"));
        assert.equal(/startArenaBout\(/.test(host), false,
            "the paid arena entry takes a caller-chosen format and pets; the Gate duel must not use it");
        const call = /startHollowGatePetDuel\(playerName, \{([\s\S]*?)\}\)/.exec(host);
        assert.ok(call, "the duel is the Gate's own entry, called with the run binding");
        // The server draws the format and both teams, the way a road beast
        // does. Not one pet id, format or number about a Hound crosses the wire.
        const keys = [...call[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
        assert.deepEqual(keys, ["runId", "token"], "only run identifiers may cross the wire");
        const api = stripComments(read("lib", "pet-showdown-api.ts"));
        assert.match(api, /action: "hollow-gate", playerName, hollowGate: \{ token: hollowGate\.token, runId: hollowGate\.runId \}/);
    });

    it("fields the pets the server drew, not the active pet alone", () => {
        const host = stripComments(read("components", "HollowGatePetFight.tsx"));
        assert.match(host, /started\.petIds\s*\.map\(\(id\) => \(character\.pets \?\? \[\]\)\.find/);
        assert.match(host, /playerPets=\{fielded\}/);
        assert.equal(/activePet/.test(host), false, "a 2v2 or 3v3 renders every fielded pet");
    });

    it("settles the Gate with a SHOWDOWN SESSION ID as the receipt", () => {
        const host = stripComments(read("components", "HollowGatePetFight.tsx"));
        assert.ok(host.includes("settleHollowGateCombat("), "the Gate handshake is unchanged");
        assert.ok(/petReceipt:\s*id\b/.test(host),
            "the receipt is the settle function's session-id parameter");
        // ...and every caller feeds it a session the SERVER named: the live one,
        // the one a reload resumed, or a decided duel's receipt. Nothing else may
        // become a receipt.
        const callers = [...host.matchAll(/settleSession\(([^)]*)\)/g)]
            .map((m) => m[1].trim())
            .filter((arg) => !arg.includes(":")); // skip the declaration itself
        assert.ok(callers.length > 0, "settleSession must be called");
        assert.deepEqual([...new Set(callers)].sort(),
            ["decidedReceipt", "sessionId", "started.decided.petReceipt", "started.state.sessionId"],
            "the bout the player fought is the handle they settle with");
    });
});

describe("a pet duel that cannot open never seals the run", () => {
    it("App hands the refused duel to the shinobi fallback instead of dropping it", () => {
        const app = stripComments(read("App.tsx"));
        assert.match(app, /onUnavailable=\{onHollowGatePetFightUnavailable\}/);
        // Dropping the fight while the encounter still said "pet" made the
        // resume effect reopen the refused duel in a loop.
        assert.equal(/The seal refused the duel/.test(app), false);
        // The resume effect must carry the encounter's CURRENT mode, which is
        // what lets combat-start swap the untouched pet duel for a PvE fight,
        // and must re-run when only that mode changes (launchPetFight falls
        // back from inside the effect's own continuation).
        assert.match(app, /mode: active\.mode,/);
        assert.match(app, /hollowGateRun\?\.activeCombat\?\.runId, hollowGateRun\?\.activeCombat\?\.mode, hollowGatePveFight, hollowGatePetFight\]\);/);
        const flow = stripComments(read("lib", "hollow-gate-app-flow.ts"));
        assert.match(flow, /function onPetFightUnavailable\(\)[\s\S]*?setRun\(hollowGateShinobiFallback\);[\s\S]*?setPetFight\(null\);/);
        // Whether the companion can fight is the SERVER's call. A local
        // readiness gate would send a begun duel to the shinobi fallback (which
        // the server must refuse) whenever the lead pet went busy mid-duel, so
        // an unavailable companion now falls back through the refused start.
        const launch = /function launchPetFight\([\s\S]*?\n {4}\}/.exec(flow)?.[0] ?? "";
        assert.ok(launch.includes("setPetFight("), "launchPetFight opens the run-bound duel");
        assert.equal(/isPetOnExpedition|unlockedForPve/.test(launch), false);
        assert.equal(/houndId/.test(flow), false, "the Hounds are named by the server");
        // ...and App renders the duel without requiring the active pet, whose
        // absence must not hide a begun duel behind a blank shrine.
        assert.doesNotMatch(app, /hollowGatePetFight\s*&&\s*\(character\.pets \?\? \[\]\)\.some/);
    });
});

describe("the Pet Arena screen no longer knows about the Gate", () => {
    const arena = stripComments(read("screens", "PetArena.tsx"));

    it("carries no Hollow Gate settlement path", () => {
        for (const dead of ["settleHollowGateCombat", "hollowGateSettlement", "onHollowGatePetBattleEnd", "opponent.hollowGate"]) {
            assert.equal(arena.includes(dead), false, `${dead} is unreachable and must be gone`);
        }
    });

    it("and the opponent shape no longer carries a run binding", () => {
        const opponents = stripComments(read("data", "pet-arena-opponents.ts"));
        assert.equal(/hollowGate\?:/.test(opponents), false,
            "a PetArenaOpponent can no longer be a sealed Gate encounter");
    });
});

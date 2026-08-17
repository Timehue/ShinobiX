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

    it("sends only the run's identifiers, never an opponent", () => {
        const host = stripComments(read("components", "HollowGatePetFight.tsx"));
        const call = /startArenaBout\([^)]*\{([\s\S]*?)\}\s*\)/.exec(host);
        assert.ok(call, "the bout is the arena entry, called with a binding");
        // The binding may name the run and the encounter. It may not carry one
        // number about the creature — that is the whole reason this entry could
        // be built at all.
        const keys = [...call[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
        assert.deepEqual(keys, ["houndId", "runId", "token"],
            "only run/encounter identifiers may cross the wire");
    });

    it("settles the Gate with a SHOWDOWN SESSION ID as the receipt", () => {
        const host = stripComments(read("components", "HollowGatePetFight.tsx"));
        assert.ok(host.includes("settleHollowGateCombat("), "the Gate handshake is unchanged");
        assert.ok(/petReceipt:\s*id\b/.test(host),
            "the receipt is the settle function's session-id parameter");
        // ...and every caller feeds it a real session: the live one, or the one
        // the resume crumb points at. Nothing else may become a receipt.
        const callers = [...host.matchAll(/settleSession\(([^)]*)\)/g)]
            .map((m) => m[1].trim())
            .filter((arg) => !arg.includes(":")); // skip the declaration itself
        assert.ok(callers.length > 0, "settleSession must be called");
        assert.deepEqual([...new Set(callers)].sort(), ["resumed", "sessionId"],
            "the bout the player fought is the handle they settle with");
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

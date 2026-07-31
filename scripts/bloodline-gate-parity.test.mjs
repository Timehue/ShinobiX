/*
 * Drift guard: the server's built-in bloodline mirror
 * (api/pvp/_bloodline-gate.ts BUILTIN_BLOODLINES) MUST match the client's live
 * starterSavedBloodlines (shinobij.client/src/data/jutsu.ts) — id, name,
 * special element, and the exact jutsu-id set. The mirror drives the
 * server-side bloodline access gate (learn + combat loadout resolution); drift
 * would either strip a legit bloodline kit or re-open the "field a bloodline
 * kit without the bloodline" hole.
 *
 * Lives in scripts/ (excluded from both build roots) so importing the client
 * data never pulls client files into the server dist — same mechanism as
 * jutsu-catalog.test.mjs.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { starterSavedBloodlines } from "../shinobij.client/src/data/jutsu.ts";

const require = createRequire(import.meta.url);
const { BUILTIN_BLOODLINES } = require("../api/pvp/_bloodline-gate.ts");

describe("bloodline gate parity (server ⇄ client)", () => {
    it("mirrors every built-in bloodline: id, name, special element, jutsu ids", () => {
        const fromClient = starterSavedBloodlines.map((bloodline) => ({
            id: bloodline.id,
            name: bloodline.name,
            specialElement: bloodline.specialElement,
            jutsuIds: bloodline.jutsus.map((jutsu) => jutsu.id),
        }));
        const fromServer = BUILTIN_BLOODLINES.map((bloodline) => ({
            id: bloodline.id,
            name: bloodline.name,
            specialElement: bloodline.specialElement,
            jutsuIds: [...bloodline.jutsuIds],
        }));
        // Order-insensitive: sort both sides by id (and jutsu ids within).
        const norm = (list) => list
            .map((entry) => ({ ...entry, jutsuIds: [...entry.jutsuIds].sort() }))
            .sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(
            norm(fromServer),
            norm(fromClient),
            "api/pvp/_bloodline-gate.ts BUILTIN_BLOODLINES is stale — update it to match starterSavedBloodlines",
        );
    });
});

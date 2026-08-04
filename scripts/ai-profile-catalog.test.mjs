/*
 * Drift guard: the committed server AI profile catalog (api/_ai-profile-catalog.ts)
 * MUST equal what the client's live `builtinAis` (shinobij.client/src/lib/combat-ai.ts)
 * resolves to. A server-authoritative AI fight seals its opponent from this
 * mirror, so any drift means the player fights a DIFFERENT opponent than the one
 * the server resolved the outcome against. If a built-in AI's level, HP, stats,
 * armor or loadout changes on the client, `npm test` fails here until the
 * catalog is regenerated with:
 *
 *   node --import tsx scripts/ai-profile-catalog-gen.mjs
 *
 * Same cross-build-root parity mechanism as scripts/jutsu-catalog.test.mjs, and
 * it lives in scripts/ — excluded from both build roots — for the same reason.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { buildAiProfileCatalog } from "./ai-profile-catalog-gen.mjs";
import { JUTSU_CATALOG } from "../api/pvp/_jutsu-catalog.ts";

// The catalog lives under api/ (CommonJS package context), so it can't be a
// static ESM named import from this .mjs file — load it via createRequire (tsx
// hooks the .ts require), exactly like the jutsu catalog drift test.
const require = createRequire(import.meta.url);
const { AI_PROFILE_CATALOG, builtinAiProfile } = require("../api/_ai-profile-catalog.ts");
const { validateServerAiRules } = require("../api/combat-core/ai-authoring.ts");

describe("AI profile catalog parity (server ⇄ client)", () => {
    it("committed catalog matches the freshly-derived client data", () => {
        assert.deepEqual(
            AI_PROFILE_CATALOG,
            buildAiProfileCatalog(),
            "api/_ai-profile-catalog.ts is stale — run: node --import tsx scripts/ai-profile-catalog-gen.mjs",
        );
    });

    it("the derivation is deterministic (no random rule ids leaked into the mirror)", () => {
        // `rules[].id` is a fresh UUID on every client import, which is exactly
        // why `rules` is not mirrored. Re-deriving twice must be byte-identical
        // or the drift test above would fail at random in CI.
        assert.deepEqual(buildAiProfileCatalog(), buildAiProfileCatalog());
        for (const profile of Object.values(buildAiProfileCatalog())) {
            assert.ok(profile.rules.every((rule) => !Object.prototype.hasOwnProperty.call(rule, 'id')));
        }
    });

    it("covers the AI ids the generic AI fight actually uses", () => {
        const ids = Object.keys(AI_PROFILE_CATALOG);
        assert.ok(ids.length >= 60, `expected >=60 AI profiles, got ${ids.length}`);
        for (const id of [
            "builtin-ai-academy-sparring", // Arena practice / E-rank drill
            "builtin-ai-central-champion",
            "hunt-ai-wild-boar",           // hunt encounter
            "apex-ai-ember-drake",         // apex contract
            "boss-hollow-gate-warden",     // Hollow Gate
            "rift-boss-legacy-echo",       // Hollow Gate rift
            "story-ai-stormveil-village-4",
            "ashen-dragon",                // weekly boss
        ]) {
            assert.ok(builtinAiProfile(id), `missing AI profile ${id}`);
        }
    });

    it("every profile is combat-usable (finite HP, a level, non-empty stats)", () => {
        for (const [id, profile] of Object.entries(AI_PROFILE_CATALOG)) {
            assert.ok(Number.isFinite(profile.hp) && profile.hp > 0, `${id}: bad hp ${profile.hp}`);
            assert.ok(profile.level >= 1 && profile.level <= 100, `${id}: bad level ${profile.level}`);
            assert.ok(Object.keys(profile.stats).length === 12, `${id}: expected 12 stat keys`);
            assert.ok(
                Object.values(profile.stats).some((v) => v > 0),
                `${id}: every stat is zero — the mirror lost the stat sheet`,
            );
            assert.ok(Array.isArray(profile.jutsuIds), `${id}: jutsuIds must be an array`);
            assert.ok(Array.isArray(profile.rules) && profile.rules.length > 0, `${id}: rules must be mirrored`);
        }
    });

    it("every mirrored jutsu id resolves in the server jutsu catalog", () => {
        // The opponent's loadout is resolved server-side against JUTSU_CATALOG
        // (∪ admin content). A built-in AI referencing an id the server catalog
        // does not carry would silently fall back to a generic signature, so the
        // sealed fight would not be the authored one.
        for (const [id, profile] of Object.entries(AI_PROFILE_CATALOG)) {
            for (const jutsuId of profile.jutsuIds) {
                assert.ok(
                    JUTSU_CATALOG[jutsuId],
                    `${id}: jutsu ${jutsuId} is not in api/pvp/_jutsu-catalog.ts`,
                );
            }
        }
    });

    it("every mirrored rule program passes the server authoring validator", () => {
        for (const [id, profile] of Object.entries(AI_PROFILE_CATALOG)) {
            const result = validateServerAiRules(profile.rules, profile.jutsuIds);
            assert.equal(result.ok, true, `${id}: ${result.issues.map((issue) => issue.message).join('; ')}`);
            assert.deepEqual(result.rules, profile.rules, `${id}: generated rules must already be normalized`);
        }
    });

    it("builtinAiProfile rejects unknown and malformed ids", () => {
        assert.equal(builtinAiProfile("no-such-ai"), null);
        assert.equal(builtinAiProfile(""), null);
        assert.equal(builtinAiProfile(null), null);
        assert.equal(builtinAiProfile(123), null);
        // Must not walk the prototype chain into Object.prototype.
        assert.equal(builtinAiProfile("constructor"), null);
        assert.equal(builtinAiProfile("toString"), null);
    });
});

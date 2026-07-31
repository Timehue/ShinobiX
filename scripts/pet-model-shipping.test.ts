import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PET_COMBAT_MODEL_IDS } from "../shinobij.client/src/lib/pet-3d-models";
import { APPROVED_ROSTER_MODEL_IDS, approvedRosterCombatModel } from "../shinobij.client/src/lib/pet-3d-roster";
import { HOLLOW_HOUND_MODEL_SOURCE_ID } from "../shared/hollow-gate-contract";

/*
 * Pet-model SHIPPING contract.
 *
 * shinobij.client/public/pet-models/ holds generated work products (QA renders,
 * concepts, sources) next to the handful of reviewed runtime GLBs, so both
 * .gitignore and .dockerignore exclude the whole directory and then re-include
 * an explicit allowlist. That allowlist is hand-maintained, and a model missing
 * from it does not fail the build — it 404s at runtime, in production only,
 * inside an r3f Suspense boundary, which takes the whole screen down to the
 * "This screen hit a snag" card.
 *
 * That is exactly how the five STAGE-0 starters shipped broken: the -r and -l
 * evolutions were allowlisted and the base models were not, so the Pet Coliseum
 * crashed for every brand-new player and worked for everyone who had evolved.
 *
 * This asserts every model the client can ask for is (a) present on disk and
 * (b) re-included in BOTH ignore files. Docker is the load-bearing one — git
 * keeps already-tracked files regardless of a later ignore rule, so .gitignore
 * drift is silent until someone re-clones.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelsDir = join(repoRoot, "shinobij.client", "public", "pet-models");

/** Lines of an ignore file that re-include a path (`!path`), comments stripped. */
function allowedPaths(ignoreFile: string): Set<string> {
    const text = readFileSync(join(repoRoot, ignoreFile), "utf8");
    return new Set(
        text.split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("!"))
            .map((line) => line.slice(1)),
    );
}

/** Every top-level runtime model URL petCombatModel() can produce, as a repo path. */
const starterModelPaths = PET_COMBAT_MODEL_IDS.map((id) => `shinobij.client/public/pet-models/${id}.glb`);

test("every starter combat model exists on disk", () => {
    // 15 = 5 elements x (base, -r, -l). A renamed/missing file would otherwise
    // only surface as a runtime 404.
    assert.equal(starterModelPaths.length, 15);
    for (const path of starterModelPaths) {
        assert.ok(existsSync(join(repoRoot, path)), `missing model file: ${path}`);
    }
});

test("every starter combat model is allowlisted in .dockerignore and .gitignore", () => {
    const docker = allowedPaths(".dockerignore");
    const git = allowedPaths(".gitignore");
    for (const path of starterModelPaths) {
        assert.ok(docker.has(path), `${path} is excluded from the Docker build context — it will 404 in production`);
        assert.ok(git.has(path), `${path} is not re-included in .gitignore — a fresh clone would drop it`);
    }
});

test("the approved roster models are allowlisted and present", () => {
    // The roster ships as a wildcard (`roster/*.glb`) rather than per-file, so
    // the contract here is that the wildcard survives and every approved id
    // behind it actually has a file.
    const docker = allowedPaths(".dockerignore");
    const git = allowedPaths(".gitignore");
    const wildcard = "shinobij.client/public/pet-models/roster/*.glb";
    assert.ok(docker.has(wildcard), "roster GLB wildcard missing from .dockerignore");
    assert.ok(git.has(wildcard), "roster GLB wildcard missing from .gitignore");

    // 140 = 50 standard + 50 rare + 30 legendary + 10 mythic. `approvedRosterCombatModel`
    // returns a config for exactly these ids, so a missing file here is a 404
    // crash — unlike an UNapproved id, which correctly returns null and falls
    // back to the 2D standee.
    assert.equal(APPROVED_ROSTER_MODEL_IDS.size, 140);
    for (const id of APPROVED_ROSTER_MODEL_IDS) {
        assert.ok(
            existsSync(join(modelsDir, "roster", `${id}.glb`)),
            `approved roster id ${id} has no GLB — it resolves to a config and will 404`,
        );
    }

    const manifest = JSON.parse(readFileSync(join(modelsDir, "roster-manifest.json"), "utf8")) as Record<string, unknown>;
    const entries = Array.isArray(manifest) ? manifest : Object.values(manifest);
    assert.ok(entries.length > 0, "roster-manifest.json is empty");
});

test("the Coliseum model aliases resolve to a model that exists", () => {
    // The three legacy AI opponents predate the 140-pet roster and borrow another
    // species' model; the Hollow Hound does the same. Driven through the real
    // resolver, so an alias that stops resolving shows up as a null config (silent
    // 2D drop) and one that resolves to a missing file shows up as a 404 crash.
    const aliased = ["generic-ai-pet-sparrow", "generic-ai-pet-guardhound", "generic-ai-pet-emberlynx"];
    for (const id of aliased) {
        const config = approvedRosterCombatModel({ id, name: id });
        assert.ok(config, `${id} no longer resolves to a model — it would fall back to the 2D standee`);
        assert.ok(existsSync(join(repoRoot, "shinobij.client", "public", config.url.split("?")[0])), `${id} resolves to a missing file: ${config.url}`);
    }
    assert.ok(APPROVED_ROSTER_MODEL_IDS.has(HOLLOW_HOUND_MODEL_SOURCE_ID), "the Hollow Hound source model is not an approved roster id");
    assert.ok(existsSync(join(modelsDir, "roster", `${HOLLOW_HOUND_MODEL_SOURCE_ID}.glb`)), "the Hollow Hound source model has no GLB");
});

test("Hollow Warfront prop and boss models are allowlisted and present", () => {
    // Loaded unconditionally by the Warfront 3D stage (useGLTF.preload at module
    // scope), so a missing one takes the stage down the same way the starters
    // took the Coliseum down.
    const docker = allowedPaths(".dockerignore");
    const git = allowedPaths(".gitignore");
    const props = ["gate-warden-rigged.glb", "ward-totem.glb", "wf-boulder.glb", "wf-lantern.glb"];
    for (const file of props) {
        const path = `shinobij.client/public/pet-models/${file}`;
        assert.ok(existsSync(join(repoRoot, path)), `missing Warfront model: ${file}`);
        assert.ok(docker.has(path), `${file} is excluded from the Docker build context — it will 404 in production`);
        assert.ok(git.has(path), `${file} is not re-included in .gitignore`);
    }
});

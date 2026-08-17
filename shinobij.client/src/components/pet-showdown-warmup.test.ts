/*
 * Every entry into a Showdown must warm its models first.
 *
 * PetShowdownBattle renders each fighter's GLB inside `<Suspense fallback=
 * {null}>`. That is the right choice for a warmed model and a trap for a cold
 * one: an unresolved model does not draw a placeholder or the 2D standee, it
 * draws NOTHING. So a caller that mounts the battle without warming puts the
 * player in an arena where the opponent is invisible for its first seconds —
 * and the opponent is exactly the half that is never warm, because it is
 * chosen by the server and only named by the response that starts the fight.
 *
 * This is a SOURCE-SHAPE guard for the same reason api/pet/_showdown-rewards
 * .test.ts is one: the failure is invisible in review (the code looks complete;
 * only the first-frame timing is wrong), it is a one-line omission, and there
 * are now five call sites. A behavioural test cannot see it without standing up
 * WebGL and a network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname` — this repo lives under a path with a space
// in it, which `.pathname` hands back percent-encoded.
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Only the renderer itself. The dev harness is deliberately NOT exempt: it
 *  fields real pets with real templateIds, so it resolves real GLBs and shows
 *  the same empty arena — in the tool used to review the battle's visuals. */
const EXEMPT = new Set(["PetShowdownBattle.tsx"]);

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
        return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
}

test("every module that mounts PetShowdownBattle warms its models first", () => {
    const mounters = walk(SRC)
        .map((file) => ({ file, src: readFileSync(file, "utf8") }))
        // An import of the component is the mount signal — it covers the lazy
        // and the direct forms alike.
        .filter(({ src }) => /import\s*\(?\s*["'][^"']*PetShowdownBattle["']|from\s+["'][^"']*PetShowdownBattle["']/.test(src))
        .filter(({ file }) => !EXEMPT.has(file.split(/[\\/]/).pop() ?? ""));

    assert.ok(mounters.length >= 4, `expected the known Showdown entries, found ${mounters.length}`);

    const cold = mounters
        .filter(({ src }) => !src.includes("warmShowdownModels"))
        .map(({ file }) => file.split(/[\\/]/).pop());

    assert.deepEqual(cold, [], `these mount a Showdown without warming its models: ${cold.join(", ")}`);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/*
 * Architectural gate: lib/, data/, constants/ and types/ must not VALUE-import
 * App.tsx.
 *
 * App.tsx imports a .webp and a pile of components that import .css. Node's test
 * runner cannot load either, so a single `import { x } from "../App"` anywhere in
 * these folders makes that module — and everything downstream of it — impossible
 * to unit-test, failing with ERR_UNKNOWN_FILE_EXTENSION. Nothing else breaks:
 * the bundler resolves it happily, so the cost is invisible until someone tries
 * to write a test and gives up.
 *
 * That is exactly how it spread. pvp-session, combat-math, bloodline and
 * duel-challenge each reached back for one symbol, and between them made save
 * hydration, the damage formula, the duel builder and the whole sector-attack
 * flow untestable. Three of the four were importing something App itself only
 * re-exports from data/, so the detour bought nothing at all.
 *
 * `import type` is fine and deliberately allowed — types are erased before
 * anything runs. If a value genuinely lives in App.tsx, drain it into a module
 * rather than reaching for it from here.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SCANNED = ["lib", "data", "constants", "types"];

/** `from "../App"` / `"../../App"` etc., ignoring anything inside a comment. */
const APP_IMPORT = /^\s*import\s+(?<clause>[^;]*?)\s+from\s+["'](?:\.\.\/)+App["']\s*;?\s*$/gm;

export function appValueImports(source: string): string[] {
    const offenders: string[] = [];
    for (const match of source.matchAll(APP_IMPORT)) {
        const clause = match.groups?.clause ?? "";
        if (/^type\s/.test(clause)) continue; // import type { … } from "../App"
        const named = clause.match(/^\{([\s\S]*)\}$/);
        if (named) {
            // `import { type A, type B }` is still type-only.
            const specifiers = named[1].split(",").map((s) => s.trim()).filter(Boolean);
            if (specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s))) continue;
        }
        offenders.push(match[0].trim());
    }
    return offenders;
}

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(abs));
        else if (/\.tsx?$/.test(entry.name)) out.push(abs);
    }
    return out;
}

describe("lib/ does not reach back into App", () => {
    it("the detector separates value imports from type-only imports", () => {
        assert.deepEqual(appValueImports('import { normalizeCharacter } from "../App";'), [
            'import { normalizeCharacter } from "../App";',
        ]);
        assert.deepEqual(appValueImports('import { getPvpJutsuLoadout, type DuelChallenge } from "../App";'), [
            'import { getPvpJutsuLoadout, type DuelChallenge } from "../App";',
        ]);
        assert.deepEqual(appValueImports('import type { Profession } from "../App";'), []);
        assert.deepEqual(appValueImports('import { type A, type B } from "../App";'), []);
        assert.deepEqual(appValueImports('import { x } from "../data/jutsu";'), []);
        assert.deepEqual(appValueImports(' * imported back from "../App" because …'), []);
    });

    for (const folder of SCANNED) {
        it(`src/${folder} value-imports nothing from App.tsx`, () => {
            const offenders = walk(path.join(SRC, folder)).flatMap((file) =>
                appValueImports(readFileSync(file, "utf8")).map(
                    (line) => `${path.relative(SRC, file).split(path.sep).join("/")}: ${line}`,
                ),
            );
            assert.deepEqual(
                offenders,
                [],
                `these files value-import App.tsx, which makes them and everything downstream `
                    + `unloadable under node:test:\n  ${offenders.join("\n  ")}\n`
                    + `Drain the symbol into a module instead, or use \`import type\` if it is only a type.`,
            );
        });
    }
});

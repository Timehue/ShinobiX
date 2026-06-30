import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// ─── Font-token guard (locks in the display-font unification) ───────────────────
// The Cinzel display font must always be referenced through the var(--font-display)
// token — defined ONCE in styles/tokens.css — never a hardcoded `font-family: Cinzel`
// or `font: … Cinzel` literal. Hardcoded literals reintroduce the exact bug this
// guard locks down: the same display font declared with several different fallback
// chains (`Cinzel, serif` vs `"Cinzel","Trajan Pro","Times New Roman",serif` vs …),
// so a failed Cinzel load fell back to a different face per element.
//
// The one legitimate "Cinzel" mention is the Google-Fonts `@import url(…)` that
// actually loads the face: it is an at-rule, not a font declaration, so the
// declaration-only check below never trips on it. The `--font-display:` token
// definition is likewise skipped (it is a custom property, not `font`/`font-family`).
const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // src/styles/<this> → src/styles → src

function cssFiles(dir: string): string[] {
    const out: string[] = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...cssFiles(p));
        else if (ent.name.endsWith(".css")) out.push(p);
    }
    return out;
}

test("CSS references the Cinzel display font only via var(--font-display)", () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC_DIR)) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
            // Inspect `font` / `font-family` DECLARATIONS only — this skips the
            // @import that loads the face and the --font-display token definition.
            if (!/^\s*font(-family)?\s*:/i.test(line)) return;
            if (/cinzel/i.test(line)) offenders.push(`${relative(SRC_DIR, file)}:${i + 1}  ${line.trim()}`);
        });
    }
    assert.deepEqual(
        offenders, [],
        `Hardcoded Cinzel font literal(s) — route the display font through var(--font-display):\n${offenders.join("\n")}`,
    );
});

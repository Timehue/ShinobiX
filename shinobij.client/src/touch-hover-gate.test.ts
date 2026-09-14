import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Touch :hover ratchet ────────────────────────────────────────────────────
// A touch browser keeps :hover on whatever a tap last hit, so a control's hover
// style stays painted until the player touches somewhere else. Control hovers
// are therefore mouse-and-trackpad only: they sit inside @media (hover: hover).
// This test fails if the number of :hover rules OUTSIDE such a block grows.
//
// The ones still outside are deliberate. Most are hovers on things that are not
// buttons: rows, article cards, links, inputs, a wandering NPC. A few target
// classes that nothing renders any more. Two sit on buttons on purpose: a shrine
// standee's name, which is hidden until hover or focus, so a tap has to reveal
// it, and the disabled VN choice's reset of its own hover.
//
// Adding a :hover rule? Wrap it in @media (hover: hover). If it has to apply on
// touch as well, raise MAX_UNGATED and say why in the commit. If you gate or
// remove one, lower MAX_UNGATED to lock the gain in.
const MAX_UNGATED = 70;

const srcDir = fileURLToPath(new URL(".", import.meta.url));

function cssFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) cssFiles(path, out);
        else if (name.endsWith(".css")) out.push(path);
    }
    return out;
}

/** Line numbers of rules whose selector carries :hover (outside :not()) and
 *  that no enclosing @media (hover: hover) block gates. */
function ungatedHoverRules(css: string): number[] {
    // Blank out comments but keep their newlines, so line numbers stay true.
    const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const gates: boolean[] = [];
    const found: number[] = [];
    let prelude = "";
    let preludeLine = 1;
    let line = 1;
    let quote = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") line++;
        if (quote) {
            if (c === quote && text[i - 1] !== "\\") quote = "";
            continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === "{") {
            const head = prelude.trim();
            const isAtRule = head.startsWith("@");
            const gate = isAtRule && /^@media\b/.test(head) && /\(\s*(any-)?hover\s*:\s*hover\s*\)/.test(head);
            if (!isAtRule && /:hover/.test(head.replace(/:not\([^()]*\)/g, "")) && !gates.includes(true)) found.push(preludeLine);
            gates.push(gate);
            prelude = "";
        } else if (c === "}") {
            gates.pop();
            prelude = "";
        } else if (c === ";") {
            prelude = "";
        } else {
            if (!prelude.trim() && /\S/.test(c)) preludeLine = line;
            prelude += c;
        }
    }
    return found;
}

test("the scanner sees only ungated :hover rules", () => {
    const css = [
        ".a:hover { color: red; }",
        "@media (hover: hover) { .b:hover { color: red; } }",
        "@media (max-width: 800px) { @media (hover: hover) { .c:hover { color: red; } } .d:hover { color: red; } }",
        ".e:not(:hover) { color: red; }",
        "/* .f:hover { } */ .g { content: \"{:hover}\"; }",
        "@media (hover: hover) and (min-width: 1024px) { .h:hover { color: red; } }",
    ].join("\n");
    assert.deepEqual(ungatedHoverRules(css), [1, 3]);
});

test(`at most ${MAX_UNGATED} :hover rules apply on touch screens`, () => {
    const hits = cssFiles(srcDir).flatMap((file) => ungatedHoverRules(readFileSync(file, "utf8"))
        .map((line) => `${relative(srcDir, file).replace(/\\/g, "/")}:${line}`));
    assert.ok(hits.length <= MAX_UNGATED,
        `${hits.length} :hover rules sit outside @media (hover: hover), over the budget of ${MAX_UNGATED}. `
        + `A touch browser keeps :hover after a tap, so a new control hover belongs inside @media (hover: hover). `
        + `Every ungated :hover rule, to find the new one:\n${hits.join("\n")}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The sector landmarks (shrine, stronghold, rift) and the village entrance are <button>s
// placed with `transform: translate(-50%, ...)`. The global `button:hover` sets
// `transform: translateY(-1px)` at a higher specificity, which would throw that anchor
// away: the button jumps out from under the pointer and the hover flickers. Each must
// restate its own anchor on :hover.
const css = readFileSync(fileURLToPath(new URL("./styles/index/39-sector-world.css", import.meta.url)), "utf8");
const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");

const pins: [selector: string, anchor: string][] = [
    [".sector-ground-landmark", "translate(-50%, -100%)"],
    [".sector-village-entrance", "translate(-50%, -50%)"],
];

for (const [selector, anchor] of pins) {
    test(`${selector} keeps its ${anchor} anchor on :hover`, () => {
        const hover = new RegExp(`@media \\(hover: hover\\) \\{[^@]*?${selector.replace(/\./g, "\\.")}:hover \\{([^}]*)\\}`).exec(flat);
        assert.ok(hover, `${selector}:hover must be pinned inside @media (hover: hover)`);
        assert.ok(hover[1].includes(`transform: ${anchor}`), `${selector}:hover must keep transform: ${anchor}`);
        assert.ok(hover[1].includes("box-shadow: none"), `${selector}:hover must not paint the global shadow box`);
    });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// window.prompt renders what the user types in CLEAR TEXT, and some browsers
// retain the value, so it must never be used to collect a credential. The
// delete-character flow used to do exactly that; it now uses
// gamePasswordPrompt() from components/GameAlert.tsx, which renders a masked
// <input type="password">.
//
// This scans source rather than importing anything, so it keeps working no
// matter which module the call site lives in.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "dist") sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

test("no source file calls window.prompt", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
        const text = readFileSync(file, "utf8");
        // strip comments so the explanatory note in GameAlert.tsx does not trip this
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (/\bwindow\s*\.\s*prompt\s*\(/.test(code)) offenders.push(relative(SRC, file).replace(/\\/g, "/"));
    }
    assert.deepEqual(
        offenders,
        [],
        `window.prompt() shows typed input in clear text and must not collect credentials. ` +
            `Use gamePasswordPrompt() (masked) for passwords, or gameConfirm()/a themed field for ` +
            `anything else. Offending file(s): ${offenders.join(", ")}`,
    );
});

test("the delete-character flow collects its password through the masked prompt", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const deleteFn = app.slice(app.indexOf("async function deleteCharacter("));
    assert.ok(deleteFn.startsWith("async function deleteCharacter("), "deleteCharacter must still exist in App.tsx");
    const raw = deleteFn.slice(0, deleteFn.indexOf("\n    }") + 6);
    // Strip comments before asserting, exactly as above -- the call site's own
    // comment explains why window.prompt is wrong, and that prose is not a call.
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    assert.match(body, /gamePasswordPrompt\(/, "deleteCharacter must use the masked password prompt");
    assert.ok(!/window\s*\.\s*prompt/.test(body), "deleteCharacter must not use window.prompt");
    // A cancelled prompt resolves null and must bail out silently -- without this
    // check, `null` would fall through to the empty-string branch and scold the
    // player for pressing Cancel.
    assert.match(body, /=== null\) return/, "a cancelled password prompt must return early");
});

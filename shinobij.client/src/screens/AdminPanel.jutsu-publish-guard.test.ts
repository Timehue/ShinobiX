import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Regression guard for the "Blitz" → "Overload" bug: creating, editing, or
// deleting an admin-authored jutsu MUST publish through the guarded,
// version-checked /api/admin/content-publish endpoint (publishAuthoredContent)
// before the plain onSaveRef save. Skipping the publish step and only calling
// onSaveRef writes straight to this admin's own save slot with no lock and no
// version check — so a second admin tab (or a stale reload) can silently
// overwrite a genuinely different concurrent edit to the SAME jutsu id with no
// warning. That is exactly how a real "Blitz" jutsu was clobbered by an
// unrelated "Overload" jutsu that happened to reuse its id.

const source = readFileSync(
    join(process.cwd(), "shinobij.client", "src", "screens", "AdminPanel.tsx"),
    "utf8",
);

function functionBody(name: string): string {
    const startMarker = `async function ${name}(`;
    const startIndex = source.indexOf(startMarker);
    assert.ok(startIndex >= 0, `missing function: ${name}`);
    // Find the closing brace at depth 0 starting from the function's opening brace.
    const openBraceIndex = source.indexOf("{", startIndex);
    assert.ok(openBraceIndex >= 0, `missing opening brace for: ${name}`);
    let depth = 0;
    let i = openBraceIndex;
    for (; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    assert.ok(depth === 0, `unbalanced braces while scanning: ${name}`);
    return source.slice(startIndex, i + 1);
}

describe("AdminPanel jutsu editor publishes through the guarded content endpoint", () => {
    for (const name of ["createAdminJutsu", "saveAdminJutsuEdit", "deleteAdminJutsu"]) {
        it(`${name} calls publishAuthoredContent before the auto-persist save`, () => {
            const body = functionBody(name);
            const publishIndex = body.indexOf("await publishAuthoredContent(");
            assert.ok(publishIndex >= 0, `${name} must call publishAuthoredContent — see the "Blitz"/"Overload" postmortem above`);

            const onSaveIndex = body.indexOf("onSaveRef.current()");
            assert.ok(onSaveIndex >= 0, `${name} should still auto-persist via onSaveRef`);
            assert.ok(publishIndex < onSaveIndex, `${name} must publish BEFORE the plain onSaveRef save, not after`);

            // The published creatorJutsus must be the freshly computed value, not
            // a snapshot of the pre-update state — otherwise the guarded publish
            // would just re-publish stale content and the bug resurfaces one
            // level up.
            const publishCall = body.slice(publishIndex, body.indexOf(")", body.indexOf("creatorJutsus:", publishIndex)) + 1);
            assert.doesNotMatch(
                publishCall,
                /creatorJutsus: creatorJutsus[,\s]/,
                `${name} must publish the updated jutsu list, not the stale "creatorJutsus" closure variable`,
            );
        });
    }
});

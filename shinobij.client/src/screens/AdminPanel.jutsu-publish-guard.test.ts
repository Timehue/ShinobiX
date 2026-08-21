import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Regression guard for the "Blitz" → "Overload" bug: creating, editing, or
// deleting an admin-authored jutsu MUST publish through the guarded,
// version-checked /api/admin/content-publish endpoint (publishAuthoredContent)
// before the deferred auto-persist save. Skipping the publish step writes
// straight to this admin's own save slot with no lock and no version check —
// so a second admin tab (or a stale reload) can silently overwrite a genuinely
// different concurrent edit to the SAME jutsu id with no warning. That is
// exactly how a real "Blitz" jutsu was clobbered by an unrelated "Overload"
// jutsu that happened to reuse its id.

const screensDirectory = join(process.cwd(), "shinobij.client", "src", "screens");
const actionsSource = readFileSync(join(screensDirectory, "admin-jutsu-actions.ts"), "utf8");
const panelSource = readFileSync(join(screensDirectory, "AdminPanel.tsx"), "utf8");

function functionBody(source: string, name: string): string {
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

describe("admin jutsu editor publishes through the guarded content endpoint", () => {
    it("the shared publish helper hits publishAuthoredContent with the fresh jutsu list", () => {
        const helper = functionBody(actionsSource, "publishJutsuCatalog");
        assert.match(helper, /await publishAuthoredContent\(/, "publishJutsuCatalog must await the guarded publish");
        assert.match(
            helper,
            /creatorJutsus: nextCreatorJutsus/,
            "publishJutsuCatalog must publish the updated jutsu list, not a stale closure snapshot",
        );
    });

    for (const name of ["createAdminJutsu", "saveAdminJutsuEdit", "deleteAdminJutsu"]) {
        it(`${name} publishes via the guard before the auto-persist save`, () => {
            const body = functionBody(actionsSource, name);
            const publishIndex = body.indexOf("await publishJutsuCatalog(");
            assert.ok(publishIndex >= 0, `${name} must call publishJutsuCatalog — see the "Blitz"/"Overload" postmortem above`);

            const autoSaveIndex = body.indexOf("scheduleAutoSave()");
            assert.ok(autoSaveIndex >= 0, `${name} should still auto-persist via scheduleAutoSave`);
            assert.ok(publishIndex < autoSaveIndex, `${name} must publish BEFORE the plain auto-persist save, not after`);

            // A failed publish must stop the flow (the helper alerts; the caller
            // must bail rather than proceed to the unguarded save).
            const guardedCall = body.slice(publishIndex - 40, autoSaveIndex);
            assert.match(guardedCall, /if \(!.*publishJutsuCatalog|\)\)\) return/s, `${name} must bail when the publish fails`);
        });
    }

    it("AdminPanel wires the extracted actions instead of re-inlining unguarded copies", () => {
        assert.match(panelSource, /import \{ makeAdminJutsuActions \} from "\.\/admin-jutsu-actions";/);
        assert.match(panelSource, /const \{ createAdminJutsu, saveAdminJutsuEdit, deleteAdminJutsu \} = makeAdminJutsuActions\(/);
        for (const name of ["createAdminJutsu", "saveAdminJutsuEdit", "deleteAdminJutsu"]) {
            assert.doesNotMatch(
                panelSource,
                new RegExp(`async function ${name}\\(`),
                `${name} must live in admin-jutsu-actions.ts (guarded), not be re-inlined into AdminPanel.tsx`,
            );
        }
    });
});

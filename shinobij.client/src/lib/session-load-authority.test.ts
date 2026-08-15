import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("session-load response authority", () => {
    it("retires timed-out and unmounted boot restores before stale continuations can repaint", () => {
        const boot = source.slice(source.indexOf("useEffect(() => {", source.indexOf("function applySnapshot")), source.indexOf("async function pullSaveFromServer"));
        assert.match(boot, /const restoreLoad = beginSessionLoad\(sessionLoadGenerationRef, localAccountName\)/);
        assert.match(boot, /if \(!restoreLoad\.isCurrent\(\)\) return;[\s\S]*?saveConflictAccountKey\(snap\.character\.name\) === restoreLoad\.accountKey[\s\S]*?applySnapshot/);
        assert.match(boot, /const revertRestoreToLogin = \(\) => \{[\s\S]*?restoreLoad\.retire\(\)/);
        assert.match(boot, /return \(\) => \{\s*sessionLoadGenerationRef\.current \+= 1;\s*if \(!restoreCompleted\) bootRestoreStartedRef\.current = false;\s*\};/,
            "cleanup must retire stale continuations and let an interrupted capability-gated restore retry");
    });

    it("binds manual login JSON and save responses to one request generation and account", () => {
        const login = source.slice(source.indexOf("async function loginPlayerAccount"), source.indexOf("async function deleteCharacter"));
        assert.match(login, /const loginLoad = beginSessionLoad\(sessionLoadGenerationRef, name\)/);
        assert.ok((login.match(/if \(!loginLoad\.isCurrent\(\)\) return;/g) ?? []).length >= 6);
        assert.match(login, /saveConflictAccountKey\(serverSnapshot\.character\.name\) !== loginLoad\.accountKey/);
        const logout = source.slice(source.indexOf("function endLocalSession"), source.indexOf("async function logoutPlayer"));
        assert.match(logout, /sessionLoadGenerationRef\.current \+= 1/);
    });

    it("retires account creation before any post-await session mutation", () => {
        const create = source.slice(source.indexOf("async function createPlayerAccount"), source.indexOf("function applyServerSnapshot"));
        assert.match(create, /const createLoad = beginSessionLoad\(sessionLoadGenerationRef, newCharacter\.name\)/);
        assert.ok((create.match(/if \(!createLoad\.isCurrent\(\)\) return;/g) ?? []).length >= 5);
        assert.ok(create.indexOf("if (!createLoad.isCurrent()) return;") < create.indexOf("setActivePlayer(newCharacter.name"));
        assert.match(create, /await pushSaveToServer[\s\S]*?if \(!createLoad\.isCurrent\(\)\) return;/);
    });
});

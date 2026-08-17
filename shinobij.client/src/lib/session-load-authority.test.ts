import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
// The credential half of signing in lives here; the save-loading half stays in
// App. Both are part of one login and both must honour the same generation.
const loginSource = readFileSync(new URL("./player-login.ts", import.meta.url), "utf8");

describe("session-load response authority", () => {
    it("retires timed-out and unmounted boot restores before stale continuations can repaint", () => {
        const boot = source.slice(source.indexOf("useEffect(() => {", source.indexOf("function applySnapshot")), source.indexOf("async function pullSaveFromServer"));
        assert.match(boot, /const restoreLoad = beginSessionLoad\(sessionLoadGenerationRef, localAccountName\)/);
        assert.match(boot, /if \(!restoreLoad\.isCurrent\(\)\) return;[\s\S]*?saveConflictAccountKey\(snap\.character\.name\) === restoreLoad\.accountKey[\s\S]*?applySnapshot/);
        assert.match(boot, /const revertRestoreToLogin = \(\) => \{[\s\S]*?restoreLoad\.retire\(\)/);
        assert.match(boot, /return \(\) => \{ sessionLoadGenerationRef\.current \+= 1; \}/);
    });

    it("binds manual login JSON and save responses to one request generation and account", () => {
        // Signing in is now two halves — verify the credential, then load the
        // save — and four entry points share the second half (password, Google,
        // guest resume, and picking a remembered shinobi). The generation check
        // has to survive that split, so this asserts across both halves rather
        // than inside one function.
        const login = source.slice(source.indexOf("async function loginPlayerAccount"), source.indexOf("async function deleteCharacter"));
        assert.match(login, /const loginLoad = beginSessionLoad\(sessionLoadGenerationRef, name\)/);
        assert.match(
            login,
            /const verdict = await verifyPlayerCredentials\(name, password, loginLoad\.isCurrent\);[\s\S]*?if \(!loginLoad\.isCurrent\(\) \|\| verdict\.status === "superseded"\) return;/,
            "the credential verdict must be discarded when a newer session load started",
        );
        // Each of the three awaits that can outlive a newer login is guarded.
        // Asserted by shape rather than by counting, because the count moves
        // whenever an await is extracted — the guard is what must not move.
        assert.match(
            login,
            /const saveRes = await fetchPlayerSave\(name, loginLoad\.isCurrent\);\s*\n\s*if \(!loginLoad\.isCurrent\(\)\) return;/,
            "the save fetch must be followed by a generation check before its result is used",
        );
        assert.match(
            login,
            /await saveRes\.json\(\)[\s\S]{0,200}?if \(!loginLoad\.isCurrent\(\) \|\| saveConflictAccountKey\(serverSnapshot\.character\.name\) !== loginLoad\.accountKey\) return;/,
            "a decoded snapshot must be bound to both the generation and the account before it paints",
        );

        // Every other way into the game routes through the same second half, so
        // none of them can skip the binding.
        assert.match(
            source,
            /async function enterWithToken\(name: string, token\?: string\) \{[\s\S]*?await enterGameAsPlayer\(name, beginSessionLoad\(sessionLoadGenerationRef, name\)\)/,
            "token sign-in must open its own session load rather than reuse a stale one",
        );

        // The extracted half takes the predicate as an argument and bails on
        // every await, including between the two retry attempts.
        assert.match(loginSource, /isCurrent: \(\) => boolean/);
        assert.ok(
            (loginSource.match(/if \(!isCurrent\(\)\) return/g) ?? []).length >= 5,
            "player-login must re-check the generation after every await",
        );
        assert.match(loginSource, /return \{ status: "superseded" \}/);

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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { beginSessionLoad, sessionLoadMatchesAccount } from "./session-load-authority";

const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const restoreSource = readFileSync(new URL("./boot-restore.ts", import.meta.url), "utf8");
// The credential half of signing in lives here; the save-loading half stays in
// App. Both are part of one login and both must honour the same generation.
const loginSource = readFileSync(new URL("./player-login.ts", import.meta.url), "utf8");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

describe("shared metadata session ownership", () => {
    it("accepts the still-current normalized account and retains its generation", () => {
        const generation = { current: 0 };
        const scope = beginSessionLoad(generation, " Kaya ");
        assert.equal(sessionLoadMatchesAccount(scope, "kAyA"), true);
        assert.equal(generation.current, 1);
        assert.equal(sessionLoadMatchesAccount(scope, "Ren"), false);
    });

    it("discards a delayed response after the account is cleared without starting another load", async () => {
        const generation = { current: 0 };
        const scope = beginSessionLoad(generation, "Kaya");
        const response = deferred<string>();
        let account = "Kaya";
        const adopted: string[] = [];
        const pending = response.promise.then((value) => {
            if (sessionLoadMatchesAccount(scope, account)) adopted.push(value);
        });
        account = "";
        response.resolve("old metadata");
        await pending;
        assert.deepEqual(adopted, []);
        assert.equal(scope.isCurrent(), true);
    });

    it("rejects a delayed A response after A to B to A replacement", async () => {
        const generation = { current: 0 };
        const original = beginSessionLoad(generation, "Kaya");
        const response = deferred<string>();
        let account = "Kaya";
        const adopted: string[] = [];
        const pending = response.promise.then((value) => {
            if (sessionLoadMatchesAccount(original, account)) adopted.push(value);
        });
        beginSessionLoad(generation, "Ren"); account = "Ren";
        const replacement = beginSessionLoad(generation, " KAYA "); account = "kaya";
        response.resolve("original metadata");
        await pending;
        assert.deepEqual(adopted, []);
        assert.equal(sessionLoadMatchesAccount(original, account), false);
        assert.equal(sessionLoadMatchesAccount(replacement, account), true);
    });

    it("predicate contract refuses a modeled updater after same-account replacement", () => {
        const generation = { current: 0 };
        const original = beginSessionLoad(generation, "Kaya");
        const currentAccount = { current: "Kaya" };
        const isCurrent = () => sessionLoadMatchesAccount(original, currentAccount.current);
        const update = (current: string) => isCurrent() ? "old metadata" : current;
        assert.equal(isCurrent(), true);
        beginSessionLoad(generation, "Kaya");
        assert.equal(update("replacement metadata"), "replacement metadata");
    });
});

describe("session-load response authority", () => {
    it("retires timed-out and unmounted boot restores before stale continuations can repaint", () => {
        const boot = source.slice(source.indexOf("useEffect(() => {", source.indexOf("function applySnapshot")), source.indexOf("async function pullSaveFromServer"));
        assert.match(boot, /const restoreLoad = beginSessionLoad\(sessionLoadGenerationRef, localAccountName\)/);
        assert.match(boot, /restoreAccountFromServer\(\{[\s\S]*?accountName: localAccountName,[\s\S]*?scope: restoreLoad,[\s\S]*?applySnapshot,/);
        assert.match(restoreSource, /if \(!scope\.isCurrent\(\)\) return;[\s\S]*?saveConflictAccountKey\(snapshot\.character\.name\) === scope\.accountKey[\s\S]*?applySnapshot\(snapshot, lock\)/);
        assert.match(boot, /if \(!restoreLoad\.isCurrent\(\) \|\| !guest\) return null;[\s\S]*?setActiveToken/);
        assert.match(boot, /const revertRestoreToLogin = \(\) => \{[\s\S]*?restoreLoad\.retire\(\)/);
        // Deadlock regression (2026-08-19): retire() bumps the generation, so the
        // .finally()'s isCurrent() guard skips its own setRestoringSession(false)
        // — and the 12s backstop timer is already cleared by then. Unless the
        // revert drops the gate itself, a failed pull (expired 24h token → 401 on
        // /api/save/<name>) pins every returning player on the "Restoring…"
        // screen forever instead of the pre-filled login form.
        assert.match(
            boot,
            /const revertRestoreToLogin = \(\) => \{[\s\S]*?restoreLoad\.retire\(\);[\s\S]*?setRestoringSession\(false\);[\s\S]*?setRestoreFailed\(true\);/,
            "revertRestoreToLogin must drop the restoring gate itself — after retire(), the finally's generation guard will not",
        );
        assert.match(boot, /return \(\) => \{\s*sessionLoadGenerationRef\.current \+= 1;\s*if \(!restoreCompleted\) bootRestoreStartedRef\.current = false;\s*\};/,
            "cleanup must retire stale continuations and let an interrupted capability-gated restore retry");
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
            // The bail may carry an outcome back to the caller ("superseded") — what
            // must not move is the check itself sitting between the await and any use.
            /const saveRes = await fetchPlayerSave\(name, loginLoad\.isCurrent\);\s*\n\s*if \(!loginLoad\.isCurrent\(\)\) return[^;]*;/,
            "the save fetch must be followed by a generation check before its result is used",
        );
        assert.match(
            login,
            /await saveRes\.json\(\)[\s\S]{0,200}?if \(!loginLoad\.isCurrent\(\) \|\| saveConflictAccountKey\(serverSnapshot\.character\.name\) !== loginLoad\.accountKey\) return[^;]*;/,
            "a decoded snapshot must be bound to both the generation and the account before it paints",
        );

        // Every other way into the game routes through the same second half, so
        // none of them can skip the binding.
        assert.match(
            source,
            /async function enterWithToken\(name: string, token\?: string[^)]*\) \{[\s\S]*?enterGameAsPlayer\(name, beginSessionLoad\(sessionLoadGenerationRef, name\)/,
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

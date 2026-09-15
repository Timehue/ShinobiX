import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Character, HollowGateShrineRun } from "../types/character";
import { createCharacter } from "./create-character";
import { createPlayerSaveCoordinator } from "./player-save-coordinator";
import { finalizeHollowGateRunEnd, settleHollowGateRunOnly, type HollowGateOutcome } from "./hollow-gate-server";
import { useHollowGateAppFlow } from "./hollow-gate-app-flow";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function fixture() {
    const notices: string[] = [];
    Object.defineProperty(globalThis, "window", { configurable: true, value: { alert: (text: string) => notices.push(text) } });
    const run = { runToken: "sealed-run-a", floor: 1, tiles: [] } as unknown as HollowGateShrineRun;
    const initial = { ...createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "Ashen Eyes"), ryo: 500, hollowGateRun: run };
    const characterRef = { current: initial as Character | null };
    const currentAccountNameRef = { current: initial.name };
    const liveRun = { current: run as HollowGateShrineRun | null };
    const storage = new Map<string, string>();
    const owner = createPlayerSaveCoordinator({
        characterRef, currentAccountNameRef, saveSessionEpochRef: { current: 0 },
        pvpCreateScopeAbortRef: { current: new AbortController() },
        setCharacter: update => { characterRef.current = typeof update === "function" ? update(characterRef.current) : update; },
        setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot: () => true,
        storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } as Storage,
    });
    owner.saveAuthority.scopeToAccount(initial.name);
    owner.latestSaveVersionRef.current = 5;
    let adoptionCalls = 0;
    const commitCharacter = (character: Character, version: unknown) => {
        adoptionCalls += 1;
        return owner.commitVersionedCharacter(character, version);
    };
    const requests: Array<{ body: { playerName: string; token: string; action: string }; reply: (body: unknown, status?: number) => void; reject: () => void }> = [];
    globalThis.fetch = async (url, init) => {
        assert.equal(url, "/api/hollow-gate/settle");
        return new Promise<Response>((resolve, reject) => {
            requests.push({
                body: JSON.parse(String(init?.body)),
                reply: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })),
                reject: () => reject(new Error("offline")),
            });
        });
    };
    function adoption() {
        return { commitCharacter, isCurrent: owner.saveAuthority.captureCreateScope(initial.name).isCurrent, currentRunToken: () => liveRun.current?.runToken };
    }
    function finish(outcome: HollowGateOutcome = "extract") {
        return finalizeHollowGateRunEnd({ run, outcome, character: initial, adoption: adoption() });
    }
    function switchSession(name: string) {
        owner.saveAuthority.reset();
        const next = { ...initial, name, ryo: 900 };
        currentAccountNameRef.current = name;
        characterRef.current = next;
        owner.saveAuthority.scopeToAccount(name);
        owner.commitVersionedCharacter(next, 20);
        return characterRef.current;
    }
    function mountFlow() {
        let flow!: ReturnType<typeof useHollowGateAppFlow>;
        const effects: string[] = [];
        function Probe() {
            flow = useHollowGateAppFlow({
                character: initial, run, sharedImages: {}, commitCharacter,
                captureSessionScope: owner.saveAuthority.captureCreateScope,
                setRun: update => { liveRun.current = typeof update === "function" ? update(liveRun.current) : update; effects.push("run"); },
                setEvent: () => effects.push("event"), setHiddenChamber: () => effects.push("chamber"), setPetFight: () => effects.push("pet"),
                setScreen: screen => effects.push(`screen:${screen}`), clearRunState: () => effects.push("expired"),
                clearLog: () => effects.push("log"), pushLog: text => effects.push(text), buildRunSummary: () => "summary",
            });
            return null;
        }
        renderToString(createElement(Probe));
        return { flow, effects };
    }
    return { initial, run, owner, characterRef, currentAccountNameRef, liveRun, requests, notices,
        finish, adoption, switchSession, mountFlow, adoptionCalls: () => adoptionCalls };
}

test("a delayed terminal reply cannot overwrite a newer accepted wallet and external-credit ledger", async () => {
    const f = fixture(), pending = f.finish();
    const newer = { ...f.initial, ryo: 700, hollowGateExternalCredits: { runToken: f.run.runToken, currencies: { ryo: 200 } } };
    assert.equal(f.owner.commitVersionedCharacter(newer, 7), true);
    const accepted = f.characterRef.current;
    f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateExternalCredits: null }, _saveVersion: 6 });
    assert.equal((await pending).adopted, false);
    assert.equal(f.characterRef.current, accepted);
    assert.equal(f.owner.latestSaveVersionRef.current, 7);
});

for (const accountName of ["Other", "Rookie"]) {
    test(`a delayed terminal reply is ignored after logout/relogin to ${accountName}`, async () => {
        const f = fixture(), pending = f.finish(), next = f.switchSession(accountName);
        // A high version and the same run token cannot bypass the captured epoch.
        f.requests[0].reply({ ok: true, character: { ...f.initial, ryo: 1 }, _saveVersion: 99 });
        assert.equal((await pending).adopted, false);
        assert.deepEqual(f.characterRef.current, next);
        assert.equal(f.owner.latestSaveVersionRef.current, 20);
        assert.equal(f.adoptionCalls(), 0);
    });
}

for (const token of ["sealed-run-b", undefined]) {
    test(`a delayed reply cannot replace a ${token ? "new run" : "cleared run"} even at a higher version`, async () => {
        const f = fixture(), pending = f.finish();
        f.liveRun.current = token ? { ...f.run, runToken: token } : null;
        const newer = { ...f.initial, ryo: 700, hollowGateRun: f.liveRun.current };
        f.owner.commitVersionedCharacter(newer, 7);
        const accepted = f.characterRef.current;
        f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 99 });
        assert.equal((await pending).adopted, false);
        assert.equal(f.characterRef.current, accepted);
        assert.equal(f.adoptionCalls(), 0);
    });
}

for (const outcome of ["extract", "death"] as const) {
    test(`current ${outcome} adopts the complete committed snapshot exactly once`, async () => {
        const f = fixture(), pending = f.finish(outcome);
        const committed = { ...f.initial, ryo: 630, hp: outcome === "death" ? 0 : 20, nindo: "committed", hollowGateRun: null, hollowGateExternalCredits: null };
        f.requests[0].reply({ ok: true, character: committed, _saveVersion: 6 });
        assert.equal((await pending).adopted, true);
        assert.deepEqual(f.requests[0].body, { playerName: "Rookie", token: "sealed-run-a", action: outcome === "death" ? "abandon" : "extract" });
        assert.equal(f.characterRef.current?.name, committed.name);
        assert.equal(f.characterRef.current?.ryo, committed.ryo);
        assert.equal(f.characterRef.current?.hp, committed.hp);
        assert.equal(f.characterRef.current?.nindo, "committed");
        assert.equal(f.characterRef.current?.hollowGateRun, null);
        assert.equal((f.characterRef.current as Character & { hollowGateExternalCredits?: unknown }).hollowGateExternalCredits, null);
        assert.equal(f.owner.latestSaveVersionRef.current, 6);
        assert.equal(f.adoptionCalls(), 1);
    });
}

test("interrupted-battle settlement uses the same authority once without requiring a navigation callback", async () => {
    const f = fixture();
    const pending = settleHollowGateRunOnly(f.run, "death", f.initial, f.adoption());
    f.requests[0].reply({ ok: true, character: { ...f.initial, hp: 0, hollowGateRun: null }, _saveVersion: 6 });
    assert.equal((await pending)?.adopted, true);
    assert.equal(f.characterRef.current?.hp, 0);
    assert.equal(f.adoptionCalls(), 1);
});

test("malformed committed replies and failures do not adopt a character", async () => {
    const f = fixture(), pending = f.finish();
    f.requests[0].reply({ ok: true, _saveVersion: 6 });
    await assert.rejects(pending, /no committed character/);
    assert.equal(f.characterRef.current, f.initial);
    assert.equal(f.adoptionCalls(), 0);
});

for (const outcome of ["extract", "death"] as const) {
    test(`the actual ${outcome} flow clears and navigates once after accepted settlement`, async () => {
        const f = fixture(), { flow, effects } = f.mountFlow();
        const pending = flow.leave({ death: outcome === "death" });
        // A same-frame duplicate cannot bypass React's not-yet-published state.
        await flow.leave();
        assert.equal(f.requests.length, 1);
        f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 6 });
        await pending;
        assert.deepEqual(effects, ["run", "event", "chamber", "log", `screen:${outcome === "death" ? "hospital" : "worldMap"}`]);
        assert.equal(f.adoptionCalls(), 1);
        assert.deepEqual(f.notices, []);
    });
}

test("the actual flow honors coordinator rejection without clearing or navigating", async () => {
    const f = fixture(), { flow, effects } = f.mountFlow(), pending = flow.leave();
    const newer = { ...f.initial, ryo: 700 };
    f.owner.commitVersionedCharacter(newer, 7);
    const accepted = f.characterRef.current;
    f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 6 });
    await pending;
    assert.equal(f.characterRef.current, accepted);
    assert.deepEqual(effects, []);
    assert.deepEqual(f.notices, []);
});

for (const accountName of ["Other", "Rookie"]) {
    for (const response of ["success", "expired", "network"] as const) {
        test(`the actual flow ignores late ${response} UI effects after relogin to ${accountName}`, async () => {
            const f = fixture(), { flow, effects } = f.mountFlow(), pending = flow.leave(), next = f.switchSession(accountName);
            if (response === "success") f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 99 });
            else if (response === "expired") f.requests[0].reply({ ok: false, error: "Hollow Gate run has expired" }, 409);
            else f.requests[0].reject();
            await pending;
            assert.deepEqual(f.characterRef.current, next);
            assert.deepEqual(effects, []);
            assert.deepEqual(f.notices, []);
        });
    }
}

test("overlapping ordinary exit and forced forfeit cannot adopt or navigate twice", async () => {
    const f = fixture(), { flow, effects } = f.mountFlow();
    const pending = flow.leave(), forced = flow.leave({ death: true, force: true });
    assert.equal(f.requests.length, 2);
    f.requests[1].reply({ ok: true, character: { ...f.initial, hp: 0, hollowGateRun: null }, _saveVersion: 6 });
    await forced;
    f.requests[0].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 6 });
    await pending;
    assert.equal(f.adoptionCalls(), 1);
    assert.deepEqual(effects, ["run", "event", "chamber", "log", "screen:hospital"]);
});

test("a current expired run still reports the error and releases its stale UI", async () => {
    const f = fixture(), { flow, effects } = f.mountFlow(), pending = flow.leave();
    f.requests[0].reply({ ok: false, error: "Hollow Gate run has expired" }, 409);
    await pending;
    assert.deepEqual(effects, ["expired"]);
    assert.match(f.notices[0], /released its hold/);
    assert.equal(f.adoptionCalls(), 0);
});

test("a current network failure retains the run and releases the pending guard for retry", async () => {
    const f = fixture(), { flow, effects } = f.mountFlow(), pending = flow.leave();
    f.requests[0].reject();
    await pending;
    assert.deepEqual(effects, []);
    assert.match(f.notices[0], /unreachable/);
    const retry = flow.leave();
    assert.equal(f.requests.length, 2);
    f.requests[1].reply({ ok: true, character: { ...f.initial, hollowGateRun: null }, _saveVersion: 6 });
    await retry;
    assert.equal(f.adoptionCalls(), 1);
});

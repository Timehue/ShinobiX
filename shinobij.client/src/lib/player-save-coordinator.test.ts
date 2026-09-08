import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Character } from "../types/character";
import type { PlayerSavePayload } from "./player-save-types";
import { createCharacter } from "./create-character";
import { createPlayerSaveCoordinator } from "./player-save-coordinator";
import { usePlayerSaveState } from "./use-player-save-state";
import { refreshPlayerSaveSnapshot, trackPlayerMissionChange, trackPlayerSectorChange } from "./player-save-tracking";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (version: number) => new Response(JSON.stringify({ ok: true, _saveVersion: version }), { status: 200 });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    let fields!: ReturnType<typeof usePlayerSaveState>;
    function Probe() { fields = usePlayerSaveState(); return null; }
    renderToString(createElement(Probe));
    const initial = createCharacter("Rookie", "Stormveil Village", "Ninjutsu", "Ashen Eyes");
    const characterRef = { current: initial as Character | null };
    const currentAccountNameRef = { current: initial.name };
    const saveSessionEpochRef = { current: 0 };
    const pvpCreateScopeAbortRef = { current: new AbortController() };
    const storage = new Map<string, string>();
    const owner = createPlayerSaveCoordinator({
        characterRef, currentAccountNameRef, saveSessionEpochRef, pvpCreateScopeAbortRef,
        setCharacter: update => { characterRef.current = typeof update === "function" ? update(characterRef.current) : update; },
        setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot: () => true,
        storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } as Storage,
    });
    owner.saveAuthority.scopeToAccount(initial.name);
    owner.latestSaveVersionRef.current = 5;
    owner.prevCharRef.current = initial;
    refreshPlayerSaveSnapshot(initial, initial.name, fields, owner);
    return { owner, fields, initial, characterRef, currentAccountNameRef, saveSessionEpochRef, pvpCreateScopeAbortRef };
}

test("restoration publishes a clean snapshot; identical renders neither dirty it nor create another revision", () => {
    const f = fixture();
    assert.equal(f.owner.charDirtyRef.current, false);
    const revision = f.owner.savePayloadRevisionRef.current;
    refreshPlayerSaveSnapshot(f.initial, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.savePayloadRevisionRef.current, revision);
    assert.equal(f.owner.latestSaveRef.current?.character, f.initial);
    assert.equal(f.owner.charDirtyRef.current, false);
});

test("idle regeneration refreshes the payload without dirtying, while a player edit does dirty it", () => {
    const f = fixture();
    const before = { ...f.initial, hp: 40, chakra: 40, stamina: 40 };
    f.owner.prevCharRef.current = before;
    const idle = { ...before, hp: 41, chakra: 41, stamina: 41 };
    refreshPlayerSaveSnapshot(idle, idle.name, f.fields, f.owner);
    assert.equal(f.owner.charDirtyRef.current, false);
    assert.equal(f.owner.latestSaveRef.current?.character, idle);
    refreshPlayerSaveSnapshot({ ...idle, nindo: "Protect the village" }, idle.name, f.fields, f.owner);
    assert.equal(f.owner.charDirtyRef.current, true);
});

test("standalone saved content receives a new revision even when the character reference stays the same", () => {
    const f = fixture(), before = f.owner.savePayloadRevisionRef.current;
    refreshPlayerSaveSnapshot(f.initial, f.initial.name, { ...f.fields, creatorCards: [] }, f.owner);
    assert.equal(f.owner.savePayloadRevisionRef.current, before + 1);
    assert.equal(f.owner.charDirtyRef.current, false, "retain existing content dirty ownership");
    refreshPlayerSaveSnapshot(null, "", f.fields, f.owner);
    assert.equal(f.owner.latestSaveRef.current, null);
    assert.equal(f.owner.savePayloadIdentityRef.current, null);
});

test("snapshot tags suppress dirty/flush once; subsequent local travel requests a flush", () => {
    const f = fixture(), guard = { lastSnapshotAppliedSectorRef: { current: 40 as number | null }, lastLocalSectorChangeRef: { current: 0 } };
    trackPlayerSectorChange(f.initial, f.initial.name, 40, f.owner, guard);
    assert.equal(f.owner.charDirtyRef.current, false);
    assert.equal(guard.lastSnapshotAppliedSectorRef.current, null);
    trackPlayerSectorChange(f.initial, f.initial.name, 41, f.owner, guard);
    assert.equal(f.owner.charDirtyRef.current, true);
    assert.ok(guard.lastLocalSectorChangeRef.current > 0);
    f.owner.charDirtyRef.current = false;
    f.fields.lastSnapshotMissionSigRef.current = JSON.stringify([[], {}, [], "central", null]);
    trackPlayerMissionChange(f.initial, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.charDirtyRef.current, false);
    assert.equal(f.owner.flushSaveRef.current, false);
    trackPlayerMissionChange(f.initial, f.initial.name, { ...f.fields, pendingTravel: { destinationSector: 42, arrivalAt: Date.now() + 30_000 } }, f.owner);
    assert.equal(f.owner.charDirtyRef.current, true);
    assert.equal(f.owner.flushSaveRef.current, true);
});

test("versioned commits reject stale or foreign characters and synchronously publish an accepted character", () => {
    const f = fixture();
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, level: 2 }, 4), false);
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, name: "Other" }, 6), false);
    assert.equal(f.characterRef.current, f.initial);
    assert.equal(f.owner.latestSaveVersionRef.current, 5);
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, level: 2 }, 6), true);
    assert.equal(f.owner.latestSaveVersionRef.current, 6);
    assert.equal(f.owner.latestSaveRef.current?.character.level, 2);
    assert.equal(f.characterRef.current?.level, 2);
});

test("required saves queue behind autosave and read the latest edited payload at execution when requested", async () => {
    const f = fixture(), first = deferred<Response>(), bodies: PlayerSavePayload[] = [];
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return bodies.length === 1 ? first.promise : json(7); };
    const automatic = f.owner.persistSave(f.owner.latestSaveRef.current!);
    await tick();
    const required = f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, f.initial, f.initial.name, undefined, { useLatestAtExecution: true });
    const edited = { ...f.initial, nindo: "New resolve" };
    refreshPlayerSaveSnapshot(edited, edited.name, f.fields, f.owner);
    assert.equal(bodies.length, 1);
    first.resolve(json(6));
    await Promise.all([automatic, required]);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].character.nindo, f.initial.nindo);
    assert.equal(bodies[1].character.nindo, "New resolve");
    assert.equal((bodies[1] as Record<string, unknown>)._baseSaveVersion, 6);
    assert.equal(f.owner.latestSaveVersionRef.current, 7);
    assert.equal(f.owner.charDirtyRef.current, false);
});

test("a captured required save retains its caller's snapshot while a later edit stays dirty", async () => {
    const f = fixture(), first = deferred<Response>(), bodies: PlayerSavePayload[] = [];
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return bodies.length === 1 ? first.promise : json(7); };
    const automatic = f.owner.persistSave(f.owner.latestSaveRef.current!);
    await tick();
    const required = f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, f.initial, f.initial.name);
    refreshPlayerSaveSnapshot({ ...f.initial, nindo: "Later edit" }, f.initial.name, f.fields, f.owner);
    first.resolve(json(6));
    await Promise.all([automatic, required]);
    assert.equal(bodies[1].character.nindo, f.initial.nindo);
    assert.equal(f.owner.latestSaveRef.current?.character.nindo, "Later edit");
    assert.equal(f.owner.charDirtyRef.current, true);
});

test("a delayed save acknowledgement cannot adopt a version into the next account or retain its PvP create scope", async () => {
    const f = fixture(), response = deferred<Response>();
    globalThis.fetch = async () => response.promise;
    const scope = f.owner.saveAuthority.captureCreateScope(f.initial.name);
    const saving = f.owner.persistSave(f.owner.latestSaveRef.current!);
    await tick();
    const next = { ...f.initial, name: "Other" };
    f.currentAccountNameRef.current = next.name; f.characterRef.current = next;
    f.owner.saveAuthority.scopeToAccount(next.name);
    refreshPlayerSaveSnapshot(next, next.name, f.fields, f.owner);
    response.resolve(json(99)); await saving;
    assert.equal(f.owner.latestSaveVersionRef.current, 0);
    assert.equal(f.owner.latestSaveRef.current?.character.name, "Other");
    assert.equal(scope.isCurrent(), false); assert.equal(scope.signal.aborted, true);
});

test("a failed autosave arms retry; a successful required save clears the pending debounce timer", async () => {
    const f = fixture();
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    await f.owner.persistSave(f.owner.latestSaveRef.current!);
    assert.equal(f.owner.charDirtyRef.current, true);
    assert.equal(f.owner.saveFailCountRef.current, 1);
    const timer = setTimeout(() => assert.fail("committed debounce was not cleared"), 30_000);
    f.owner.saveSoonTimerRef.current = timer;
    try {
        globalThis.fetch = async () => json(6);
        await f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, f.initial, f.initial.name);
        assert.equal(f.owner.saveSoonTimerRef.current, null);
        assert.equal(f.owner.charDirtyRef.current, false);
        assert.equal(f.owner.saveFailCountRef.current, 0);
    } finally { clearTimeout(timer); }
});

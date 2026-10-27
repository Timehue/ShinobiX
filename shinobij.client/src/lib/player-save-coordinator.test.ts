import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Character } from "../types/character";
import type { PlayerSavePayload } from "./player-save-types";
import { createCharacter } from "./create-character";
import { regenerateIdleVitals } from "./loaded-vitals";
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
function fixture(applyServerSnapshot: (snapshot: PlayerSavePayload) => boolean = () => true) {
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
        setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot,
        storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } as Storage,
    });
    owner.saveAuthority.scopeToAccount(initial.name);
    owner.latestSaveVersionRef.current = 5;
    owner.prevCharRef.current = initial;
    refreshPlayerSaveSnapshot(initial, initial.name, fields, owner);
    return { owner, fields, initial, characterRef, currentAccountNameRef, saveSessionEpochRef, pvpCreateScopeAbortRef, storage };
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

test("an idle-regen tick re-running the trackers leaves the save clean; real changes still dirty it", () => {
    const f = fixture();
    const guard = { lastSnapshotAppliedSectorRef: { current: 40 as number | null }, lastLocalSectorChangeRef: { current: 0 } };
    const sectorTracked = { current: null as string | null }, missionTracked = { current: null as string | null };
    // The restore applies the server snapshot (sector and mission tags), then
    // the lifecycle effects run once.
    f.fields.lastSnapshotMissionSigRef.current = JSON.stringify([[], {}, [], "central", null]);
    trackPlayerSectorChange(f.initial, f.initial.name, 40, f.owner, guard, sectorTracked);
    trackPlayerMissionChange(f.initial, f.initial.name, f.fields, f.owner, missionTracked);
    assert.equal(f.owner.charDirtyRef.current, false);

    // A minute of idle regen: `character` changes every second, nothing else does.
    let character = { ...f.initial, hp: 1 };
    f.owner.prevCharRef.current = character;
    for (let second = 1; second <= 60; second += 1) {
        character = regenerateIdleVitals(character, 1);
        refreshPlayerSaveSnapshot(character, character.name, f.fields, f.owner);
        trackPlayerSectorChange(character, character.name, 40, f.owner, guard, sectorTracked);
        trackPlayerMissionChange(character, character.name, f.fields, f.owner, missionTracked);
    }
    assert.equal(f.owner.charDirtyRef.current, false, "regen alone must not schedule saves");
    assert.equal(guard.lastLocalSectorChangeRef.current, 0, "and must not keep the local-sector guard armed");

    trackPlayerSectorChange(character, character.name, 41, f.owner, guard, sectorTracked);
    assert.equal(f.owner.charDirtyRef.current, true, "a real sector change still saves");
    f.owner.charDirtyRef.current = false;

    const travelling = { ...f.fields, pendingTravel: { destinationSector: 42, arrivalAt: Date.now() + 30_000 } };
    trackPlayerMissionChange(character, character.name, travelling, f.owner, missionTracked);
    assert.equal(f.owner.charDirtyRef.current, true, "starting a journey still saves");
    assert.equal(f.owner.flushSaveRef.current, true, "and flushes immediately");
    f.owner.charDirtyRef.current = false;
    f.owner.flushSaveRef.current = false;
    trackPlayerMissionChange(regenerateIdleVitals(character, 1), character.name, travelling, f.owner, missionTracked);
    assert.equal(f.owner.charDirtyRef.current, false, "a regen tick mid-journey does not re-dirty");
    assert.equal(f.owner.flushSaveRef.current, false, "nor force another flush");

    trackPlayerMissionChange(character, character.name, { ...travelling, acceptedMissionIds: ["fetch-d-supply-trail"] }, f.owner, missionTracked);
    assert.equal(f.owner.charDirtyRef.current, true, "accepting a mission still saves");
});

test("the save lifecycle passes the trackers their last-tracked refs", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./use-player-save-lifecycle.ts", import.meta.url), "utf8");
    assert.match(source, /trackPlayerSectorChange\([^;]*, lastTrackedSectorRef\)/);
    assert.match(source, /trackPlayerMissionChange\([^;]*, lastTrackedMissionRef\)/);
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

test("accepted recovery refreshes the preview before autosave and rejected replies cannot rewind it", async () => {
    const f = fixture(() => false);
    const previews = f.storage;
    const admitted = { ...f.initial, hp: 0, hospitalized: true, ryo: 10000 };
    const recovered = { ...admitted, hp: admitted.maxHp, hospitalized: false, ryo: 9925 };
    f.characterRef.current = admitted;
    refreshPlayerSaveSnapshot(admitted, admitted.name, f.fields, f.owner);
    const stale = { ...f.owner.latestSaveRef.current!.payload, _saveVersion: 5 };
    previews.set("ninjav-save-preview-v1:rookie", JSON.stringify(stale));
    const requests: string[] = [];
    globalThis.fetch = async url => {
        requests.push(String(url));
        return new Response(JSON.stringify(stale), { status: 200 });
    };

    // An achievement reply can recover the character before the boot save GET.
    // That older GET is rejected, so it cannot be relied on to refresh the cache.
    assert.equal(f.owner.commitVersionedCharacter(recovered, 6), true);
    const preview = () => JSON.parse(previews.get("ninjav-save-preview-v1:rookie")!);
    assert.equal(preview()._saveVersion, 6);
    assert.equal(preview().character.hospitalized, false);
    assert.equal(preview().character.hp, recovered.hp);
    assert.equal(preview().character.ryo, recovered.ryo);
    assert.deepEqual(preview().acceptedMissionIds, f.fields.acceptedMissionIds);
    assert.deepEqual(requests, [], "cache adoption must not wait for a server write");

    const acceptedPreview = previews.get("ninjav-save-preview-v1:rookie");
    assert.equal(f.owner.commitVersionedCharacter(admitted, 5), false);
    assert.equal(f.owner.commitVersionedCharacter({ ...admitted, name: "Other" }, 7), false);
    assert.equal(f.owner.commitVersionedCharacter(admitted, undefined), false);
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(previews.get("ninjav-save-preview-v1:rookie"), acceptedPreview);
    assert.equal(previews.has("ninjav-save-preview-v1:other"), false);
});

// Reproduced live on 2026-10-09 (e2e-live/resource-gathering.spec.ts): a tool
// purchase stored at v6, then the boot achievement sync stored v7 and its reply
// landed first. The sync adopts the local character plus the stored wallet, so
// v7 here had no tool, the v6 purchase reply was refused, and the next autosave
// (base v7) stored an inventory without the tool the player had paid for.
test("a refused stale reply reads the stored save back once, so an autosave cannot erase what it settled", async () => {
    const applied: PlayerSavePayload[] = [], urls: string[] = [];
    const f = fixture(snapshot => { applied.push(snapshot); f.characterRef.current = snapshot.character; return true; });
    const paid = { ...f.initial, ryo: f.initial.ryo - 150, inventory: [...f.initial.inventory, "tool-basic-pickaxe"] };
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ ...f.owner.latestSaveRef.current!.payload, character: paid, _saveVersion: 7 }), { status: 200 });
    };
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, ryo: paid.ryo }, 7), true, "the overtaking wallet patch");
    assert.equal(f.owner.commitVersionedCharacter(paid, 6), false, "the purchase reply is still refused as stale");
    for (let i = 0; i < 5 && applied.length === 0; i++) await tick();
    assert.deepEqual(urls, ["/api/save/rookie"]);
    assert.deepEqual(applied.map(snapshot => snapshot.character.inventory), [paid.inventory]);
    assert.equal(f.owner.latestSaveVersionRef.current, 7);
    assert.ok(f.owner.latestSaveRef.current?.payload.character.inventory.includes("tool-basic-pickaxe"), "the next autosave carries the tool");
    // A reply the read-back already covers costs nothing more; neither does an unversioned or foreign one.
    assert.equal(f.owner.commitVersionedCharacter(paid, 6), false);
    assert.equal(f.owner.commitVersionedCharacter(paid, undefined), false);
    assert.equal(f.owner.commitVersionedCharacter({ ...paid, name: "Other" }, 3), false);
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(urls.length, 1);
});

test("an unrelated authoritative mutation preserves an unsaved cinematic handoff and saves it at the new version", async (t) => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => {} } });
    t.after(() => { if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });
    const f = fixture(), bodies: PlayerSavePayload[] = [];
    f.characterRef.current = { ...f.initial, onboardingStep: "training", academyVow: "unbound" };
    refreshPlayerSaveSnapshot(f.characterRef.current, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, onboardingStep: "companionIntro", ryo: 123 }, 6), true);
    refreshPlayerSaveSnapshot(f.characterRef.current, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.charDirtyRef.current, true);
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return json(7); };
    f.owner.charDirtyRef.current = false; // the autosave scheduler consumes the dirty flag before dispatch
    await f.owner.persistSave(f.owner.latestSaveRef.current!);
    assert.equal(bodies[0].character.onboardingStep, "training");
    assert.equal(bodies[0].character.academyVow, "unbound");
    assert.equal(bodies[0].character.ryo, 123);
    assert.equal((bodies[0] as Record<string, unknown>)._baseSaveVersion, 6);
    assert.equal(f.owner.charDirtyRef.current, false);
});

test("travel settlement keeps an earned unsaved field scene open and queues its handoff for persistence", () => {
    const f = fixture();
    f.characterRef.current = { ...f.initial, onboardingStep: "sectorReturn", academyTrialClaimed: true, academyFieldSeal: true };
    refreshPlayerSaveSnapshot(f.characterRef.current, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.commitVersionedCharacter({ ...f.initial, onboardingStep: "logbook", academyTrialClaimed: true, ryo: 123 }, 6), true);
    assert.equal(f.characterRef.current?.onboardingStep, "sectorReturn");
    assert.equal(f.characterRef.current?.academyFieldSeal, undefined);
    assert.equal(f.characterRef.current?.ryo, 123);
    refreshPlayerSaveSnapshot(f.characterRef.current!, f.initial.name, f.fields, f.owner);
    assert.equal(f.owner.charDirtyRef.current, true);
    assert.equal(f.owner.latestSaveRef.current?.payload.character.onboardingStep, "sectorReturn");
    assert.equal(f.owner.latestSaveVersionRef.current, 6);
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

test("a save acknowledgement's stored ryo patches only the wallet, and only when it differs", async () => {
    const f = fixture();
    const ack = (version: number, ryo: number) => new Response(JSON.stringify({ ok: true, _saveVersion: version, ryo }), { status: 200 });
    assert.notEqual(f.initial.ryo, 777);
    globalThis.fetch = async () => ack(6, 777);
    await f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, f.initial, f.initial.name);
    assert.equal(f.characterRef.current?.ryo, 777, "a drifted local wallet converges on the stored balance");
    assert.deepEqual({ ...f.characterRef.current, ryo: f.initial.ryo }, f.initial, "nothing but the wallet changes");
    const converged = f.characterRef.current!;
    globalThis.fetch = async () => ack(7, 777);
    await f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, converged, converged.name);
    assert.equal(f.characterRef.current, converged, "an agreeing wallet does not replace the character (no extra autosave)");
});

test("required bloodline save exposes the server's stored roster acknowledgement", async () => {
    const f = fixture();
    let equipIntent = "";
    let writeIntent = "";
    globalThis.fetch = async (_url, init) => { equipIntent = new Headers(init?.headers).get("x-bloodline-equip-intent") ?? "";
        writeIntent = new Headers(init?.headers).get("x-bloodline-write-intent") ?? ""; return new Response(JSON.stringify({
        ok: true, _saveVersion: 6, savedBloodlineIds: ["bl-new"], savedBloodlineRanks: { "bl-new": "A Rank" }, equippedBloodlineId: "bl-new",
    }), { status: 200 }); };
    const result = await f.owner.pushSaveToServer(
        f.fields.buildPlayerSavePayload,
        { ...f.initial, equippedBloodlineId: "bl-new" },
        f.initial.name,
        undefined,
        { bloodlineEquipIntent: "bl-new", bloodlineWriteIntent: "bl-new" },
    );
    assert.equal(equipIntent, "bl-new");
    assert.equal(writeIntent, "bl-new");
    assert.deepEqual(result.value?.savedBloodlineIds, ["bl-new"]);
    assert.equal(result.value?.equippedBloodlineId, "bl-new");
});

test("a rejected bloodline save surfaces the server reason and does not advance local authority", async () => {
    const f = fixture();
    globalThis.fetch = async () => new Response(JSON.stringify({
        code: "BLOODLINE_SAVE_REJECTED",
        error: "Bloodline was not saved. Refresh the game and retry the Awakening ritual.",
    }), { status: 422 });
    await assert.rejects(
        f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, f.initial, f.initial.name,
            undefined, { bloodlineEquipIntent: "bl-new", bloodlineWriteIntent: "bl-new" }),
        /Bloodline was not saved\. Refresh the game/,
    );
    assert.equal(f.owner.latestSaveVersionRef.current, 5);
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


test("idle ticks during a required save cannot keep its acknowledged progress dirty", async () => {
    const f = fixture(), response = deferred<Response>();
    let character = { ...f.initial, hp: 40, chakra: 40, stamina: 40, maxHp: 100, maxChakra: 100, maxStamina: 100 };
    refreshPlayerSaveSnapshot(character, character.name, f.fields, f.owner);
    const revision = f.owner.savePayloadRevisionRef.current;
    globalThis.fetch = async () => response.promise;
    const saving = f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, character, character.name, undefined, { useLatestAtExecution: true });
    await tick();
    for (let i = 0; i < 4; i++) {
        character = regenerateIdleVitals(character, 1);
        refreshPlayerSaveSnapshot(character, character.name, f.fields, f.owner);
    }
    response.resolve(json(6));
    await saving;
    assert.equal(f.owner.latestSaveRef.current?.character, character, "the latest preview still receives regenerated vitals");
    assert.equal(f.owner.savePayloadRevisionRef.current, revision, "passive ticks are not unsaved player progress");
    assert.equal(f.owner.charDirtyRef.current, false, "logout can finish after the durable acknowledgement");
});

test("a player edit or standalone change alongside regeneration still invalidates a save acknowledgement", async () => {
    for (const change of ["character", "sector"] as const) {
        const f = fixture(), response = deferred<Response>();
        const before = { ...f.initial, hp: 40, chakra: 40, stamina: 40, maxHp: 100, maxChakra: 100, maxStamina: 100 };
        refreshPlayerSaveSnapshot(before, before.name, f.fields, f.owner);
        const revision = f.owner.savePayloadRevisionRef.current;
        globalThis.fetch = async () => response.promise;
        const saving = f.owner.pushSaveToServer(f.fields.buildPlayerSavePayload, before, before.name, undefined, { useLatestAtExecution: true });
        await tick();
        const regenerated = regenerateIdleVitals(before, 1);
        refreshPlayerSaveSnapshot(change === "character" ? { ...regenerated, nindo: "Keep this edit" } : regenerated,
            before.name, change === "sector" ? { ...f.fields, currentSector: f.fields.currentSector + 1 } : f.fields, f.owner);
        response.resolve(json(6));
        await saving;
        assert.ok(f.owner.savePayloadRevisionRef.current > revision, change);
        assert.equal(f.owner.charDirtyRef.current, true, change + " must still be saved before logout");
    }
});

test("incubation and hatch background sync preserve pending edits across repeated updates", async () => {
    const f = fixture();
    const egg = { sessionId: `breed-${'a'.repeat(32)}`, state: 'egg' as const,
        parentIds: ['one', 'two'] as [string, string], parentNames: ['One', 'Two'] as [string, string],
        parentElement: 'Fire', startedAt: 1, readyAt: 1, rulesVersion: 3, incubationRemainingMs: 43_200_000 };
    const baseline = { ...f.initial, petBreeding: egg };
    f.owner.recordCharacterBaseline(baseline);
    f.characterRef.current = { ...baseline, nindo: 'Keep my pending edit' };
    refreshPlayerSaveSnapshot(f.characterRef.current, f.initial.name, f.fields, f.owner);
    for (let tick = 1; tick <= 2; tick++) {
        const sync = await f.owner.beginCharacterSync(f.initial.name);
        const server = { ...baseline, ryo: 777, petBreeding: { ...egg, incubationRemainingMs: 43_200_000 - tick * 15_000 } };
        assert.equal(sync.commit(server, 5 + tick), true);
        assert.equal(f.characterRef.current?.nindo, 'Keep my pending edit');
        assert.equal(f.characterRef.current?.ryo, 777, 'wallet stays authoritative');
        assert.equal(f.characterRef.current?.petBreeding?.incubationRemainingMs, server.petBreeding.incubationRemainingMs);
    }
    const hatch = await f.owner.beginCharacterSync(f.initial.name);
    assert.equal(hatch.commit({ ...baseline, petBreeding: null, petBreedingHatchReceipts: [
        { sessionId: egg.sessionId, petId: 'newborn', destination: 'sanctuary', revealPending: true },
    ] }, 8), true);
    assert.equal(f.characterRef.current?.nindo, 'Keep my pending edit');
    assert.equal(f.characterRef.current?.petBreeding, null);
    assert.equal(f.characterRef.current?.petBreedingHatchReceipts?.[0].revealPending, true);
    assert.equal(f.owner.latestSaveRef.current?.character.nindo, 'Keep my pending edit');
});

test("a delayed incubation sync cannot roll back a newer save or enter a reconnected account", async () => {
    const f = fixture();
    const reads: string[] = [];
    globalThis.fetch = async url => {
        reads.push(String(url));
        return new Response(JSON.stringify({ character: { ...f.initial, ryo: 777 }, _saveVersion: 10 }));
    };
    f.owner.recordCharacterBaseline(f.initial);
    const sync = await f.owner.beginCharacterSync(f.initial.name);
    f.owner.commitVersionedCharacter({ ...f.initial, ryo: 777 }, 10);
    assert.equal(sync.commit({ ...f.initial, ryo: 1 }, 9), false);
    assert.equal(f.characterRef.current?.ryo, 777);
    for (let tickNo = 0; tickNo < 5; tickNo++) await tick();
    assert.equal(reads.length, 1, 'a settled pairing or hatch cannot remain hidden behind a newer observed save version');
    f.saveSessionEpochRef.current++;
    assert.equal(sync.isCurrent(), false);
    assert.equal(sync.commit({ ...f.initial, ryo: 1 }, 11), false);
    assert.equal(f.owner.latestSaveVersionRef.current, 10);
});

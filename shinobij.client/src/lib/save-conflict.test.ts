import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
    loadSaveOwnershipClassifier,
    MAX_SAVE_CONFLICT_REVISIONS,
    SAVE_CONFLICT_DRAFT_TTL_MS,
    buildSaveConflictRestorePayload,
    createSaveConflictDraftStore,
    createSaveConflictRevision,
    detectSaveConflictAreas,
    latestSaveConflictRevision,
    loadSaveConflictDraft,
    mergeSaveConflictRevisions,
    sanitizeSaveConflictPayload,
    saveConflictAccountKey,
    serializeSaveConflictDownload,
    writeSaveConflictRevision,
    type SaveConflictStorage,
} from "./save-conflict";

class MemoryStorage implements SaveConflictStorage {
    readonly values = new Map<string, string>();

    get length(): number { return this.values.size; }
    key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    removeItem(key: string): void { this.values.delete(key); }
}

describe("save-conflict drafts", () => {
    // The ownership mirror is code-split out of the boot bundle, so classification
    // is only correct once it is resident. Production awaits it at both call
    // sites (pinned by the contract test below); the tests do the same.
    before(async () => { await loadSaveOwnershipClassifier(); });

    it("strips embedded images recursively while preserving gameplay data", () => {
        const sanitized = sanitizeSaveConflictPayload({
            character: {
                name: "Kaya",
                level: 17,
                portrait: "data:image/png;base64,AAAA",
                nested: ["ok", "  DATA:IMAGE/webp;base64,BBBB"],
                remoteImage: "https://cdn.example/avatar.webp",
            },
        });
        assert.deepEqual(sanitized, {
            character: {
                name: "Kaya",
                level: 17,
                portrait: "",
                nested: ["ok", ""],
                remoteImage: "https://cdn.example/avatar.webp",
            },
        });
    });

    it("keeps every near-simultaneous conflict as a separate 24-hour revision", () => {
        const storage = new MemoryStorage();
        const detectedAt = 1_700_000_000_000;
        const first = createSaveConflictRevision({
            id: "flight-a",
            accountName: "Kaya",
            detectedAt,
            payload: { character: { name: "Kaya", level: 8 }, _baseSaveVersion: 10 },
        });
        const second = createSaveConflictRevision({
            id: "flight-b",
            accountName: "KAYA",
            detectedAt: detectedAt + 1,
            payload: { character: { name: "Kaya", level: 9 }, _baseSaveVersion: 10 },
        });
        assert.equal(first.expiresAt, detectedAt + SAVE_CONFLICT_DRAFT_TTL_MS);
        writeSaveConflictRevision(storage, first);
        writeSaveConflictRevision(storage, second);
        assert.equal(storage.length, 2, "a second 409 must not overwrite the first recovery copy");

        const loaded = loadSaveConflictDraft(storage, "kaya", detectedAt + 100);
        assert.deepEqual(loaded.draft?.revisions.map((revision) => revision.id), ["flight-a", "flight-b"]);
        assert.deepEqual(loaded.draft?.revisions.map((revision) => (revision.payload.character as { level: number }).level), [8, 9]);
    });

    it("keeps only the newest revisions so a conflict loop cannot grow without bound", () => {
        const detectedAt = 1_700_000_000_000;
        const revisions = Array.from({ length: MAX_SAVE_CONFLICT_REVISIONS + 3 }, (_unused, index) =>
            createSaveConflictRevision({
                id: `conflict-${index}`,
                accountName: "Kaya",
                detectedAt: detectedAt + index,
                payload: { character: { name: "Kaya", level: index } },
            }));

        const draft = mergeSaveConflictRevisions("Kaya", revisions, detectedAt + 100);
        assert.ok(draft);
        assert.equal(draft.revisions.length, MAX_SAVE_CONFLICT_REVISIONS);
        // The OLDEST go. Restore rebuilds from latestSaveConflictRevision, so
        // capping the other end would silently rewind the player to the first
        // conflict of the run instead of their most recent local progress.
        assert.equal(latestSaveConflictRevision(draft).id, `conflict-${revisions.length - 1}`);
        assert.ok(!draft.revisions.some((revision) => revision.id === "conflict-0"));
    });

    it("evicts the storage keys the cap drops instead of orphaning them", () => {
        const storage = new MemoryStorage();
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: () => undefined,
            reportStorageFailure: assert.fail,
        });
        const conflicts = MAX_SAVE_CONFLICT_REVISIONS + 5;
        const originalNow = Date.now;
        Date.now = () => 1_000;
        try {
            for (let index = 0; index < conflicts; index += 1) {
                store.capture("Kaya", { character: { name: "Kaya", level: index } });
            }
        } finally { Date.now = originalNow; }

        // The leak this pins: every 409 captured a full save payload (two on the
        // paths that also protect a newer in-flight snapshot) and every dirty
        // beforeunload captured a guard the keepalive POST could not discard in
        // time, while nothing ever removed one. The account's localStorage
        // footprint grew until every write threw QuotaExceededError — taking the
        // session token and the boot account marker down with it.
        assert.equal(storage.length, MAX_SAVE_CONFLICT_REVISIONS, "durable storage stays bounded across a conflict loop");
        const reloaded = loadSaveConflictDraft(storage, "Kaya", 1_000);
        assert.equal(reloaded.draft?.revisions.length, MAX_SAVE_CONFLICT_REVISIONS);
        assert.equal(
            (latestSaveConflictRevision(reloaded.draft!).payload.character as { level: number }).level,
            conflicts - 1,
            "and the newest capture is the one that survives",
        );
    });

    it("reclaims the surplus an uncapped client already wrote", () => {
        // Players arrive at this build with a store an earlier client filled, so
        // the cap has to reclaim retroactively, not just stop adding.
        const storage = new MemoryStorage();
        const detectedAt = Date.now();
        const written = Array.from({ length: MAX_SAVE_CONFLICT_REVISIONS + 2 }, (_unused, index) =>
            createSaveConflictRevision({
                id: `legacy-${index}`,
                accountName: "Kaya",
                detectedAt: detectedAt + index,
                payload: { character: { name: "Kaya", level: index } },
            }));
        for (const revision of written) writeSaveConflictRevision(storage, revision);
        assert.equal(storage.length, MAX_SAVE_CONFLICT_REVISIONS + 2);

        const loaded = loadSaveConflictDraft(storage, "Kaya", detectedAt + 100);
        assert.equal(loaded.draft?.revisions.length, MAX_SAVE_CONFLICT_REVISIONS);
        assert.equal(loaded.staleKeys.length, 2, "the surplus is named for deletion, not just hidden from the draft");

        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: () => undefined,
            reportStorageFailure: assert.fail,
        });
        assert.equal(store.load("Kaya")?.revisions.length, MAX_SAVE_CONFLICT_REVISIONS);
        assert.equal(storage.length, MAX_SAVE_CONFLICT_REVISIONS, "load() is what actually frees the leaked quota");
    });

    it("orders same-millisecond captures by capture sequence instead of random UUID", () => {
        const storage = new MemoryStorage();
        const store = createSaveConflictDraftStore({ storage, activeAccountKey: () => "kaya", onVisibleDraft: () => undefined, reportStorageFailure: assert.fail });
        const originalNow = Date.now;
        Date.now = () => 1_000;
        try {
            store.capture("Kaya", { character: { name: "Kaya", level: 1 } });
            const draft = store.capture("Kaya", { character: { name: "Kaya", level: 2 } });
            assert.equal((latestSaveConflictRevision(draft).payload.character as { level: number }).level, 2);
            assert.ok(draft.revisions[1].detectedAt > draft.revisions[0].detectedAt);

            const reloadedStore = createSaveConflictDraftStore({ storage, activeAccountKey: () => "kaya", onVisibleDraft: () => undefined, reportStorageFailure: assert.fail });
            const afterReload = reloadedStore.capture("Kaya", { character: { name: "Kaya", level: 3 } });
            assert.equal((latestSaveConflictRevision(afterReload).payload.character as { level: number }).level, 3);
            assert.ok(afterReload.revisions[2].detectedAt > afterReload.revisions[1].detectedAt,
                "a fresh store instance must order after revisions it discovers in durable storage");
        } finally { Date.now = originalNow; }
    });

    it("expires old revisions and never crosses account boundaries", () => {
        const storage = new MemoryStorage();
        const now = 2_000_000;
        const expired = createSaveConflictRevision({ id: "old", accountName: "Kaya", detectedAt: now - SAVE_CONFLICT_DRAFT_TTL_MS, payload: { character: { name: "Kaya" } } });
        const other = createSaveConflictRevision({ id: "other", accountName: "Ren", detectedAt: now, payload: { character: { name: "Ren" } } });
        writeSaveConflictRevision(storage, expired);
        writeSaveConflictRevision(storage, other);

        const kaya = loadSaveConflictDraft(storage, "Kaya", now);
        assert.equal(kaya.draft, null);
        assert.equal(kaya.staleKeys.length, 1);
        assert.equal(loadSaveConflictDraft(storage, "Ren", now).draft?.revisions[0].id, "other");
    });

    it("restores the newest revision with the latest authoritative base version", () => {
        const first = createSaveConflictRevision({ id: "one", accountName: "Kaya", detectedAt: 100, payload: { character: { name: "Kaya", level: 3 }, _baseSaveVersion: 4 } });
        const latest = createSaveConflictRevision({ id: "two", accountName: "Kaya", detectedAt: 200, payload: { character: { name: "Kaya", level: 5 }, _baseSaveVersion: 6 } });
        const draft = mergeSaveConflictRevisions("Kaya", [first, latest], 250);
        assert.ok(draft);
        const restored = buildSaveConflictRestorePayload(draft, 19);
        assert.equal(restored._baseSaveVersion, 19);
        assert.equal((restored.character as { level: number }).level, 5);
        assert.equal(latest.payload._baseSaveVersion, 6, "building a restore must not mutate the protected original");
    });

    it("exports all revisions without embedded image data", () => {
        const revision = createSaveConflictRevision({
            id: "download",
            accountName: "Kaya",
            detectedAt: 100,
            payload: { character: { name: "Kaya", avatarImage: "data:image/png;base64,SECRET" } },
        });
        const draft = mergeSaveConflictRevisions("Kaya", [revision], 101);
        assert.ok(draft);
        const exported = serializeSaveConflictDownload(draft, 150);
        assert.doesNotMatch(exported, /data:image|SECRET/i);
        assert.equal((JSON.parse(exported) as { revisionCount: number }).revisionCount, 1);
    });

    it("collapses a server-owned divergence instead of offering it as recoverable", () => {
        // storyProgress, pets, and tileCards are all server-owned: the sanitizer
        // copies the stored value back over whatever a generic save sends, so a
        // restore of these is guaranteed to be discarded. Reporting them as
        // recoverable is what left the banner unclearable.
        const local = {
            character: {
                storyProgress: { chapter: 4 },
                pets: [{ id: "fox", level: 7 }],
                tileCards: ["legacy-fox"],
            },
        };
        const server = {
            character: {
                storyProgress: { chapter: 3 },
                pets: [{ id: "fox", level: 6 }],
                tileCards: [],
            },
        };
        assert.deepEqual(detectSaveConflictAreas(local, server), ["Server-managed progress"]);
    });

    it("reports cohesive story, pet, and Chronicle areas for client-owned divergence", () => {
        const local = {
            character: {
                storyTraits: ["stoic"],
                activePetId: "fox",
                cardClashDeck: ["tc-001"],
            },
        };
        const server = {
            character: {
                storyTraits: [],
                activePetId: "owl",
                cardClashDeck: [],
            },
        };
        assert.deepEqual(detectSaveConflictAreas(local, server), ["Story & Legacy", "Companions", "Living Chronicle"]);
    });

    it("names only the restorable half of a mixed divergence", () => {
        const local = { character: { level: 40, rank: "jonin", nindo: "walk softly" }, currentSector: 12 };
        const server = { character: { level: 38, rank: "chunin", nindo: "" }, currentSector: 9 };
        // level and rank are server-owned; the sector is not.
        assert.deepEqual(detectSaveConflictAreas(local, server), ["Travel & world position"]);
    });

    it("treats a vitals-only divergence as nothing to recover", () => {
        // settleSaveRecordForRead re-projects vitals from `_saveAt` on every read,
        // so a device copy of them is never observable.
        const local = { character: { name: "Kaya", hp: 900, chakra: 400, stamina: 120 } };
        const server = { character: { name: "Kaya", hp: 1000, chakra: 500, stamina: 200 } };
        assert.deepEqual(detectSaveConflictAreas(local, server), ["Server-managed progress"]);
    });

    it("recognizes an unload guard that the server already persisted", () => {
        const local = { character: { name: "Kaya", level: 9, portrait: "" }, _baseSaveVersion: 12 };
        const server = { character: { name: "Kaya", level: 9, portrait: "https://cdn/avatar.webp" }, _saveVersion: 13, _saveAt: 123_456 };
        assert.deepEqual(detectSaveConflictAreas(local, server), ["Save timing only"]);
    });

    it("keeps a recoverable in-memory draft when browser storage fails", async () => {
        const storage = new MemoryStorage();
        storage.setItem = () => { throw new Error("quota unavailable"); };
        const visible: Array<string[] | null> = [];
        const failures: unknown[] = [];
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: (draft) => visible.push(draft?.revisions.map((revision) => revision.id) ?? null),
            reportStorageFailure: (error) => failures.push(error),
        });

        const captured = store.capture("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 20 });
        assert.equal(captured.revisions.length, 1);
        assert.equal(failures.length, 1, "the storage failure remains observable");
        assert.equal(storage.length, 0);
        assert.deepEqual(store.load("Kaya")?.revisions.map((revision) => revision.id), [captured.revisions[0].id]);
        // Capture is silent by contract, so prove recoverability through the path
        // the player actually reaches it by: classification against authority.
        await store.rehydrate("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 9 });
        assert.deepEqual(visible.at(-1), [captured.revisions[0].id], "the active account can still restore from memory");
    });

    it("captures silently — a protected draft is never shown before it is classified", async () => {
        // The banner used to appear the instant a save was rejected, before
        // recovery ran and before the payload had been compared to the server.
        // Most conflicts heal a round-trip later, so the player saw a recovery
        // banner mid-play that dismissed itself seconds afterwards.
        const storage = new MemoryStorage();
        const visible: Array<number | null> = [];
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: (draft) => visible.push(draft?.revisions.length ?? null),
            reportStorageFailure: assert.fail,
        });

        const captured = store.capture("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 20 });
        assert.equal(captured.revisions.length, 1, "the draft is still protected");
        assert.equal(storage.length, 1, "and still written to storage");
        assert.deepEqual(visible, [], "but nothing is shown to the player yet");

        // A divergence that survives classification DOES surface.
        await store.rehydrate("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 9 });
        assert.deepEqual(visible, [1], "a real, still-unresolved divergence is announced");
    });

    it("never announces a conflict that recovery resolved", async () => {
        const storage = new MemoryStorage();
        const visible: Array<number | null> = [];
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: (draft) => visible.push(draft?.revisions.length ?? null),
            reportStorageFailure: assert.fail,
        });

        store.capture("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 20 });
        // The refetch lands and the server already has everything the draft held.
        await store.rehydrate("Kaya", { character: { name: "Kaya", level: 12 }, currentSector: 20 });
        assert.deepEqual(visible, [null], "the player is never shown a self-healing conflict");
        assert.equal(storage.length, 0, "and the resolved guard is cleaned up");
    });

    it("rehydrates against authority and removes timing-only guards", async () => {
        const storage = new MemoryStorage();
        const visible: Array<number | null> = [];
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => saveConflictAccountKey("Kaya"),
            onVisibleDraft: (draft) => visible.push(draft?.revisions.length ?? null),
            reportStorageFailure: assert.fail,
        });
        store.capture("Kaya", {
            character: { name: "Kaya", level: 9, portrait: "" },
            _baseSaveVersion: 12,
        });
        assert.equal(storage.length, 1);

        const remaining = await store.rehydrate("Kaya", {
            character: { name: "Kaya", level: 9, portrait: "https://cdn/avatar.webp" },
            _saveVersion: 13,
            _saveAt: 123_456,
        });
        assert.equal(remaining, null);
        assert.equal(storage.length, 0, "an acknowledged unload guard must not become a false conflict banner");
        assert.equal(store.load("Kaya"), null);
        assert.equal(visible.at(-1), null);
    });
});

describe("save-conflict App and accessibility contracts", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const persistenceSource = readFileSync(new URL("./save-persistence.ts", import.meta.url), "utf8");
    const unloadSource = readFileSync(new URL("./save-unload.ts", import.meta.url), "utf8");
    const petArenaSource = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");
    const cardHallSource = readFileSync(new URL("../screens/CardHall.tsx", import.meta.url), "utf8");

    it("wires every full-save path to protect the exact rejected payload", () => {
        const immediate = appSource.slice(appSource.indexOf("async function pushSaveToServer"), appSource.indexOf("async function reauthKeepState"));
        assert.match(immediate, /return savePersistenceRef\.current!\.persistRequired\(\(\) => \{/);

        assert.match(appSource, /captureConflict: captureSaveConflictDraft/);
        assert.match(appSource, /installSnapshot: installAuthoritativeSaveRef/);
        assert.match(appSource, /const persistSave = savePersistenceRef\.current\.persistAutosave/);
        assert.ok(
            persistenceSource.indexOf("params.captureConflict(snapshot.name, body)")
                < persistenceSource.indexOf("await refetchAfterConflict(snapshot.name, snapshot.revision"),
            "an ordinary autosave conflict must persist its recovery draft before the authoritative GET",
        );
        assert.ok(
            persistenceSource.indexOf("params.captureConflict(save.name, body)")
                < persistenceSource.indexOf("await refetchAfterConflict(save.name, save.revision"),
            "an ordinary required-save conflict must persist its recovery draft before the authoritative GET",
        );
        const ryoRepair = persistenceSource.indexOf("const repaired = withAuthoritativeRyo(payload, currencyRecovery.authoritativeRyo)");
        const ryoClassify = persistenceSource.indexOf("detectSaveConflictAreas(repaired, snapshot)", ryoRepair);
        const ryoProtect = persistenceSource.indexOf("params.captureConflict(accountName, repaired)", ryoClassify);
        assert.ok(ryoRepair > 0 && ryoRepair < ryoClassify && ryoClassify < ryoProtect,
            "a Ryo rejection must compare the repaired atomic body to server authority before protecting recoverable fields");
        assert.ok(unloadSource.indexOf("params.captureConflict(name, body)") < unloadSource.indexOf("params.request ?? fetch"));
        assert.match(unloadSource, /acknowledgement\?\.persisted !== false/);
        assert.match(unloadSource, /params\.discardRevision\(guard\)/);
    });

    // The player-facing recovery banner was removed (it fired on ordinary
    // unsaved progress, which is the normal state between autosaves). The
    // restore/download ACTIONS went with it; capture, rehydrate and the unload
    // guard below still run, silently. lib/save-conflict-restore.ts is retained
    // and still covered by its own suite, in case a deliberate, non-interrupting
    // recovery entry point is ever wanted.

    it("protects the exact latest revision on unload even while autosave is in flight", () => {
        const unloadStart = appSource.indexOf("function handleBeforeUnload()", appSource.indexOf("Save on page unload"));
        const unload = appSource.slice(unloadStart, appSource.indexOf("window.addEventListener('beforeunload'", unloadStart));
        assert.match(unload, /protectSaveOnUnload\(\{/);
        assert.match(unload, /unresolved: savePersistenceRef\.current\?\.getUnresolvedPost\(\) \?\? null/);
        assert.match(unload, /send: capabilityAdmissionAllowed\(mutationAvailability\(\)\)/);
        assert.match(unloadSource, /if \(!params\.dirty && !params\.flightBusy && !activeUnresolved\) return/);
        assert.ok(unloadSource.indexOf("const guard = latestSaveConflictRevision") < unloadSource.indexOf("if (params.send === false) return"),
            "mutation freeze must preserve the durable local guard before suppressing the network write");
        assert.ok(unloadSource.indexOf("const guard = latestSaveConflictRevision") < unloadSource.indexOf("params.request ?? fetch"),
            "unload must synchronously protect the chosen immutable body before attempting keepalive");
    });

    it("uses account epochs, version ordering, and full-payload revisions", () => {
        assert.match(appSource, /saveSessionEpochRef/);
        assert.match(appSource, /isCurrentSession: isCurrentSaveSession/);
        assert.match(appSource, /currentSessionEpoch: \(\) => saveSessionEpochRef\.current/);
        assert.match(appSource, /latestVersion: latestSaveVersionRef/);
        assert.match(appSource, /latestPayloadRevision: savePayloadRevisionRef/);
        const externalVersion = appSource.slice(appSource.indexOf("function acceptExternalSaveVersion"), appSource.indexOf("function commitVersionedCharacter"));
        assert.match(externalVersion, /accountKey !== saveAuthorityAccountKeyRef\.current/);
        assert.match(externalVersion, /activeSaveAccountKey\(\) !== accountKey/);
        assert.match(appSource, /detail\.source !== "full-save"[\s\S]*acceptExternalSaveVersion\(version, detail\.accountName\)/);
        assert.match(persistenceSource, /isCurrentSavePayloadRevision\(snapshot\.revision, params\.latestPayloadRevision\.current\)/);
        assert.match(persistenceSource, /isCurrentSavePayloadRevision\(save\.revision, params\.latestPayloadRevision\.current\)/);
        assert.match(persistenceSource, /acceptVersionedSnapshot\(params\.latestVersion\.current, snapshot\._saveVersion\)/);
        assert.match(persistenceSource, /acknowledgement\?\.persisted === false/);
        assert.match(persistenceSource, /runRequired\(async \(\) =>/);
        assert.match(persistenceSource, /runAutosave\(async \(\) =>/);
        const reset = appSource.slice(appSource.indexOf("function resetSaveAuthorityScope"), appSource.indexOf("function isCurrentSaveSession"));
        assert.match(reset, /latestSaveVersionRef\.current = 0/);
        assert.match(reset, /saveSessionEpochRef\.current \+= 1/);
    });

    it("does not finish logout before a required save and conflict recovery settle", () => {
        const push = appSource.slice(appSource.indexOf("async function pushSaveToServer"), appSource.indexOf("async function reauthKeepState"));
        assert.match(push, /return savePersistenceRef\.current!\.persistRequired/);
        assert.match(persistenceSource, /params\.flight\.runRequired/);
        assert.match(persistenceSource, /if \(!await refetchAfterConflict\(save\.name, save\.revision,/);
        const logout = appSource.slice(appSource.indexOf("async function logoutPlayer"), appSource.indexOf("function recordBuiltInMissionProgress"));
        assert.ok(logout.indexOf("await pushSaveToServer") < logout.indexOf("endLocalSession()"));
        assert.match(logout, /if \(charDirtyRef\.current && latestSaveRef\.current\)/);
    });

    it("lets Pet Arena and Card Hall reject stale authoritative replies", () => {
        const petArenaMount = appSource.slice(
            appSource.indexOf('screen === "petArena" && character && <PetArena'),
            appSource.indexOf('screen === "petLadder" && character'),
        );
        assert.match(petArenaMount, /onServerVersion=\{acceptExternalSaveVersion\}/);
        assert.match(petArenaMount, /saveConflictAccountKey\(next\.name\) === saveConflictAccountKey\(origin\)/);
        assert.match(petArenaMount, /commitVersionedCharacter\(next, version\) \? "accepted" : "stale"/);
        assert.match(petArenaSource, /playerScopeIsActive\(scope\)/);
        assert.match(petArenaSource, /responseBelongsToPetArenaPlayer\(scope, data\.character\?\.name\)/);
        assert.match(petArenaSource, /onServerVersion\?\.\(data\._saveVersion, scope\.playerName\)/);

        const cardHallMount = appSource.slice(
            appSource.indexOf('screen === "shinobiTiles" && character && <CardHall'),
            appSource.indexOf('screen === "guides" &&'),
        );
        assert.match(cardHallMount, /onVersionedCharacter=\{commitVersionedCharacter\}/);
        assert.match(cardHallMount, /acceptExternalSaveVersion\(version, character\.name\) === "accepted"/);
        assert.match(cardHallSource, /activePlayerName: activeProgressionPlayerRef\.current/);
        assert.match(cardHallSource, /originatingPlayerName/);
        assert.match(cardHallSource, /progressionVersionedCharacterHandlerRef\.current\(result\.character, version\)/);
    });

    it("never paints an older story or combat character response", () => {
        const commit = appSource.slice(appSource.indexOf("function commitVersionedCharacter"), appSource.indexOf("const {", appSource.indexOf("function commitVersionedCharacter")));
        assert.match(commit, /acceptVersionedSnapshot\(latestSaveVersionRef\.current, incomingVersion\)/);
        assert.ok(commit.indexOf("if (!decision.accepted) return false") < commit.indexOf("setCharacter(mergedCharacter)"));
        assert.ok(commit.indexOf("preserveNarrativeState(nextCharacter, characterRef.current)") < commit.indexOf("setCharacter(mergedCharacter)"));
        assert.match(appSource, /onOutcome=\{commitVersionedCharacter\}/);
        assert.match(appSource, /const accepted = commitVersionedCharacter\(settledCharacter, result\._saveVersion\)/);
        assert.doesNotMatch(appSource, /onOutcome=\{\(character, version\) => \{ latestSaveVersionRef\.current = adoptSaveVersion/);
    });

    it("rehydrates conflict state after authoritative snapshots", () => {
        assert.match(appSource, /rehydrateSaveConflictDraft\(snap\.character\.name, snap\)/);
        assert.match(appSource, /createSaveConflictDraftStore\(\{/);
    });

    it("never classifies a protected draft against the localStorage preview cache", () => {
        // The optimistic boot paint applies the preview cache through
        // applyServerSnapshot. Classifying a draft against it compares the client
        // to its own stale copy, which reliably "finds" a divergence — that is
        // what flashed the recovery banner on every refresh and then dismissed it
        // once the real save landed.
        assert.match(
            appSource,
            /applyServerSnapshot\(preview as ReturnType<typeof buildPlayerSavePayload>, \{ authoritative: false \}\)/,
            "the optimistic preview paint must declare itself non-authoritative",
        );
        assert.match(
            appSource,
            /if \(opts\.authoritative !== false\) void rehydrateSaveConflictDraft\(snap\.character\.name, snap\)/,
            "conflict rehydration must be gated on the snapshot being authoritative",
        );
        // Every other caller stays authoritative by default.
        assert.match(appSource, /function applyServerSnapshot\([^)]*opts: \{ authoritative\?: boolean \} = \{\}\)/);
    });

    it("adopts the save version from every read of the player's OWN combat save", () => {
        // An own-character combat-save read settles elapsed state — a completed
        // journey, an expired Hollow Gate run — and can bump `_saveVersion`.
        // App intentionally reads through the account captured at challenge
        // acceptance; WorldMap has no suspension before it captures character.
        // Dropping either receipt strands the client on a stale base version.
        const sources: Array<[string, string, RegExp]> = [
            ["App.tsx", appSource, /fetchPlayerCombatSave\(acceptingCharacter\.name\)/g],
            ["WorldMap.tsx", readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8"), /fetchPlayerCombatSave\(character\.name\)/g],
        ];
        const adopts = /(?:(?:acceptExternalSaveVersion|onServerVersion\?\.)\(\s*[A-Za-z0-9_]+\?\._saveVersion|(?:adoptOwnSaveRead|onOwnSaveRead)\([^\n]+\._saveVersion\))/;

        for (const [name, source, ownReadPattern] of sources) {
            const ownReads = [...source.matchAll(ownReadPattern)];
            assert.ok(ownReads.length > 0, `${name} should still read its own combat save`);
            for (const match of ownReads) {
                assert.match(
                    source.slice(match.index, match.index + 900),
                    adopts,
                    `${name} reads its own combat save without adopting the version it was served at`,
                );
            }
        }
    });

    it("loads the ownership mirror before classifying, at every classification site", () => {
        // The mirror is code-split, and detectSaveConflictAreas degrades to
        // "everything is restorable" without it. That degradation is the exact
        // shape of the original bug — a draft of purely server-owned fields
        // offered as recoverable — so both sites must await the load first.
        const conflictSource = readFileSync(new URL("./save-conflict.ts", import.meta.url), "utf8");
        const restoreSource = readFileSync(new URL("./save-conflict-restore.ts", import.meta.url), "utf8");

        const rehydrateBody = conflictSource.slice(conflictSource.indexOf("const rehydrate = async"));
        const load = rehydrateBody.indexOf("await loadSaveOwnershipClassifier()");
        const classify = rehydrateBody.indexOf("updateSaveConflictAreas(draft, serverSnapshot)");
        assert.ok(load > 0 && classify > 0, "rehydrate must load the mirror and classify");
        assert.ok(load < classify, "the mirror must be resident BEFORE areas are recomputed");

        const restoreLoad = restoreSource.indexOf("await loadSaveOwnershipClassifier()");
        const restoreExclusive = restoreSource.indexOf("await params.runExclusive");
        assert.ok(restoreLoad > 0, "restore must load the mirror");
        assert.ok(restoreLoad < restoreExclusive, "load the mirror before the exclusive restore body runs");
    });

    it("keeps the save-recovery banner OUT of the player-facing shell", () => {
        // It fired on ordinary unsaved progress — the normal state between
        // autosaves — so it warned about healthy behaviour and could not be
        // acted on. Removed deliberately; do not reintroduce a blocking surface
        // without a signal that distinguishes "not saved yet" from "at risk".
        assert.doesNotMatch(appSource, /SaveConflictBanner/);
        assert.doesNotMatch(appSource, /restoreLocalConflictDraft|downloadLocalConflictDraft/);
        // The silent protection stays wired.
        assert.match(appSource, /createSaveConflictDraftStore\(\{/);
        assert.match(appSource, /captureConflict: captureSaveConflictDraft/);
    });
});

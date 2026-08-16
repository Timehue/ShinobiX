import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
    loadSaveOwnershipClassifier,
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

    it("keeps a recoverable in-memory draft when browser storage fails", () => {
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

        const captured = store.capture("Kaya", { character: { name: "Kaya", level: 12 } });
        assert.equal(captured.revisions.length, 1);
        assert.equal(failures.length, 1, "the storage failure remains observable");
        assert.equal(storage.length, 0);
        assert.deepEqual(store.load("Kaya")?.revisions.map((revision) => revision.id), [captured.revisions[0].id]);
        assert.deepEqual(visible.at(-1), [captured.revisions[0].id], "the active account can still restore from memory");
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
    const bannerSource = readFileSync(new URL("../components/SaveConflictBanner.tsx", import.meta.url), "utf8");
    const bannerCss = readFileSync(new URL("../styles/save-conflict-banner.css", import.meta.url), "utf8");
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
                < persistenceSource.indexOf("await refetchAfterConflict(snapshot.name, snapshot.revision)"),
            "the extracted autosave must persist its recovery draft before the authoritative GET",
        );
        assert.ok(
            persistenceSource.indexOf("params.captureConflict(save.name, body)")
                < persistenceSource.indexOf("await refetchAfterConflict(save.name, save.revision)"),
            "the extracted required save must persist its recovery draft before the authoritative GET",
        );
        assert.ok(unloadSource.indexOf("params.captureConflict(name, body)") < unloadSource.indexOf("params.request ?? fetch"));
        assert.match(unloadSource, /acknowledgement\?\.persisted !== false/);
        assert.match(unloadSource, /params\.discardRevision\(guard\)/);
    });

    it("keeps restore server-authoritative and retains the draft on a second 409", () => {
        const restoreStart = appSource.indexOf("async function restoreLocalConflictDraft");
        const restore = appSource.slice(restoreStart, appSource.indexOf("\n    useEffect(() => {", restoreStart));
        assert.ok(restore.indexOf("await gameConfirm") < restore.indexOf("beginBlockingRestore()"));
        assert.ok(restore.indexOf("beginBlockingRestore()") < restore.indexOf("restoreSaveConflictRevision({"));
        assert.match(restore, /visibleDraft, sessionEpoch: restoreSessionEpoch/);
        assert.match(restore, /captureConflict: captureSaveConflictDraft, applySnapshot: applyServerSnapshot/);
        assert.match(restore, /discardRevision: discardSaveConflictRevision/);
    });

    it("runs restore through the account-scoped FIFO instead of an independent save POST", () => {
        const restoreStart = appSource.indexOf("async function restoreLocalConflictDraft");
        const restore = appSource.slice(restoreStart, appSource.indexOf("\n    useEffect(() => {", restoreStart));
        assert.match(restore, /runExclusive: savePersistenceRef\.current!\.runExclusive/);
        assert.match(restore, /isCurrentSession: isCurrentSaveSession/);
        assert.match(restore, /loadDraft: loadConflictDraftForAccount/);
    });

    it("protects the exact latest revision on unload even while autosave is in flight", () => {
        const unloadStart = appSource.indexOf("function handleBeforeUnload()", appSource.indexOf("Save on page unload"));
        const unload = appSource.slice(unloadStart, appSource.indexOf("window.addEventListener('beforeunload'", unloadStart));
        assert.match(unload, /protectSaveOnUnload\(\{/);
        assert.match(unload, /unresolved: savePersistenceRef\.current\?\.getUnresolvedPost\(\) \?\? null/);
        assert.match(unloadSource, /if \(!params\.dirty && !params\.flightBusy && !activeUnresolved\) return/);
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
        assert.match(persistenceSource, /if \(!await refetchAfterConflict\(save\.name, save\.revision\)\)/);
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
        assert.ok(commit.indexOf("if (!decision.accepted) return false") < commit.indexOf("setCharacter(nextCharacter)"));
        assert.match(appSource, /onOutcome=\{commitVersionedCharacter\}/);
        assert.match(appSource, /const accepted = commitVersionedCharacter\(result\.character, result\._saveVersion\)/);
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
        // fetchPlayerCombatSave(character.name) reads YOUR save, and the server
        // settles elapsed state on an owner read — a completed journey, an expired
        // Hollow Gate run — which bumps `_saveVersion`. Dropping it strands the
        // client on a stale base version, so its next autosave 409s and conflict
        // recovery raises a banner for a divergence that never happened.
        const sources: Array<[string, string]> = [
            ["App.tsx", appSource],
            ["Arena.tsx", readFileSync(new URL("../screens/Arena.tsx", import.meta.url), "utf8")],
            ["WorldMap.tsx", readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8")],
        ];
        const adopts = /(?:acceptExternalSaveVersion|onServerVersion\?\.)\(\s*[A-Za-z0-9_]+\?\._saveVersion/;

        for (const [name, source] of sources) {
            const ownReads = [...source.matchAll(/fetchPlayerCombatSave\(character\.name\)/g)];
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

    it("renders a nonmodal, keyboard-native, busy and error-announcing banner", () => {
        assert.match(bannerSource, /<aside/);
        assert.doesNotMatch(bannerSource, /role=["']dialog["']/);
        assert.match(bannerSource, /aria-busy=\{busy\}/);
        assert.match(bannerSource, /role="alert" tabIndex=\{-1\}/);
        assert.match(bannerSource, /<button type="button"/);
        assert.match(bannerSource, /errorRef\.current\?\.focus\(\)/);
        assert.match(bannerSource, /createPortal\(recoveryUi, document\.body\)/);
        assert.match(bannerSource, /backdropClassName="save-conflict-restore-backdrop"/);
        assert.match(bannerCss, /\.ui-modal-backdrop\.save-conflict-restore-backdrop\s*\{[\s\S]*z-index: 100001/);
    });
});

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Character } from "../types/character";
import type { PlayerSaveOverrides, PlayerSavePayload } from "./player-save-types";
import { normalizeAdminCharacter } from "./admin-character";
import { preserveNarrativeState } from "./story-history";
import { preserveAcademyCinematicState } from "./academy-cinematic-state";
import { createSaveFlightCoordinator, nextSavePayloadRevision } from "./save-flight";
import { createSavePersistence } from "./save-persistence";
import { createSaveAuthorityScope } from "./save-authority-scope";
import { createSaveConflictDraftStore, saveConflictAccountKey, type SaveConflictDraft } from "./save-conflict";
import { acceptVersionedSnapshot } from "./versioned-snapshot";
import { writeSavePreview } from "./save-preview";

function box<T>(current: T): RefObject<T> { return { current }; }

/** Owns the existing persistence refs and one write coordinator. Session and
 * character refs remain shared with PvP admission and the application; delayed
 * saves and required writes observe the same authority as autosave. */
export function createPlayerSaveCoordinator({
    characterRef, currentAccountNameRef, saveSessionEpochRef, pvpCreateScopeAbortRef,
    setCharacter, setSaveConflictDraft, setSaveBlocked, storage, applyServerSnapshot,
}: {
    characterRef: RefObject<Character | null>;
    currentAccountNameRef: RefObject<string>;
    saveSessionEpochRef: RefObject<number>;
    pvpCreateScopeAbortRef: RefObject<AbortController>;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    setSaveConflictDraft: Dispatch<SetStateAction<SaveConflictDraft | null>>;
    setSaveBlocked: Dispatch<SetStateAction<boolean>>;
    storage: Storage;
    applyServerSnapshot: (snapshot: PlayerSavePayload) => boolean;
}) {
    const latestSaveRef = box<{
        character: Character;
        name: string;
        payload: PlayerSavePayload;
        revision: number;
    } | null>(null);
    const savePayloadRevisionRef = box(0);
    const savePayloadIdentityRef = box<readonly unknown[] | null>(null);
    const prevCharRef = box<Character | null>(null);
    const charDirtyRef = box(false);
    // Server-issued monotonic version of the last save we loaded or wrote.
    // We echo this back as `_baseSaveVersion` in autosave POSTs so the server
    // can detect when a second tab/device wrote in between and reject the
    // stale overwrite (HTTP 409). On 409 we refetch + reapply the server's
    // newer snapshot. The value is reset per account/session; once a stored
    // save exists the server requires this base to equal its version exactly.
    const latestSaveVersionRef = box<number>(0);
    const saveAuthorityAccountKeyRef = box("");
    const saveConflictStoreRef = box<ReturnType<typeof createSaveConflictDraftStore> | null>(null);
    const saveFlightRef = box(createSaveFlightCoordinator());
    // #23: surface a banner when a save is persistently rejected (a payload too
    // large [413] or a sustained 5xx) so the player knows before they refresh —
    // persistSave otherwise retries silently forever. Cleared on the next success.
    const saveFailCountRef = box(0);
    const savePersistenceRef = box<ReturnType<typeof createSavePersistence<PlayerSavePayload>> | null>(null);
    const flushSaveRef = box(false);
    const saveSoonTimerRef = box<ReturnType<typeof setTimeout> | null>(null);
    const characterBaselineRef = box<{ character: Character; epoch: number } | null>(null);

    function recordCharacterBaseline(nextCharacter: Character): void {
        if (saveConflictAccountKey(nextCharacter.name) !== activeSaveAccountKey()) return;
        characterBaselineRef.current = { character: nextCharacter, epoch: saveSessionEpochRef.current };
    }

    function installAuthoritativeSaveRef(snapshot: { name: string; payload: PlayerSavePayload; revision: number }, baselineCharacter?: Character) {
        if (baselineCharacter) recordCharacterBaseline(baselineCharacter);
        const normalized = normalizeAdminCharacter(snapshot.payload.character);
        latestSaveRef.current = { ...snapshot, character: normalized, payload: { ...snapshot.payload, character: normalized } };
    }

    function activeSaveAccountKey(): string {
        return saveConflictAccountKey(currentAccountNameRef.current || characterRef.current?.name || "");
    }

    function reportConflictStorageFailure(error: unknown): void {
        // Never interrupt a battle with a storage alert. The in-memory copy and
        // banner remain usable for the current session.
        console.warn("[save-conflict] Browser storage unavailable; recovery remains in memory.", error);
    }

    function commitVersionedCharacter(nextCharacter: Character, incomingVersion: unknown): boolean {
        const accountKey = saveConflictAccountKey(nextCharacter.name);
        if (!accountKey || accountKey !== saveAuthorityAccountKeyRef.current || accountKey !== activeSaveAccountKey()) return false;
        const decision = acceptVersionedSnapshot(latestSaveVersionRef.current, incomingVersion);
        if (!decision.accepted) return false; latestSaveVersionRef.current = decision.latestVersion;
        recordCharacterBaseline(nextCharacter);
        savePersistenceRef.current?.invalidateAuthority();
        savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
        const mergedCharacter = preserveAcademyCinematicState(preserveNarrativeState(nextCharacter, characterRef.current), characterRef.current);
        const current = latestSaveRef.current;
        if (current && saveConflictAccountKey(current.name) === accountKey) installAuthoritativeSaveRef({ ...current, revision: savePayloadRevisionRef.current, payload: { ...current.payload, character: mergedCharacter } });
        setCharacter(mergedCharacter); return true;
    }

    // Ryo is server-owned, and every save acknowledgement carries the stored
    // balance. Patch only the wallet, and only when it differs, so a client that
    // already agrees with the server does not schedule another autosave.
    function applyAuthoritativeRyo(accountName: string, ryo: number): void {
        const accountKey = saveConflictAccountKey(accountName);
        if (!accountKey || accountKey !== activeSaveAccountKey()) return;
        if (characterRef.current?.ryo === ryo) return;
        setCharacter((prev) => (prev && saveConflictAccountKey(prev.name) === accountKey && prev.ryo !== ryo ? { ...prev, ryo } : prev));
    }

    function applyAuthoritativeFateShards(accountName: string, fateShards: number): void {
        const accountKey = saveConflictAccountKey(accountName);
        if (!accountKey || accountKey !== activeSaveAccountKey() || characterRef.current?.fateShards === fateShards) return;
        setCharacter(prev => prev && saveConflictAccountKey(prev.name) === accountKey && prev.fateShards !== fateShards
            ? { ...prev, fateShards } : prev);
    }

    function pushSaveToServer(
        buildPlayerSavePayload: (character: Character, overrides?: PlayerSaveOverrides) => PlayerSavePayload,
        characterToSave: Character,
        name: string,
        overrides?: Parameters<typeof buildPlayerSavePayload>[1],
        opts?: { echoVersion?: boolean; useLatestAtExecution?: boolean },
    ) {
        const captured = opts?.useLatestAtExecution ? null : {
            character: characterToSave, payload: buildPlayerSavePayload(characterToSave, overrides), revision: savePayloadRevisionRef.current,
        };
        return savePersistenceRef.current!.persistRequired(() => {
            const executionSnapshot = opts?.useLatestAtExecution ? latestSaveRef.current : captured;
            const effectiveCharacter = executionSnapshot?.character ?? characterToSave;
            return { name, payload: executionSnapshot?.payload ?? buildPlayerSavePayload(effectiveCharacter, overrides),
                revision: executionSnapshot?.revision ?? savePayloadRevisionRef.current, echoVersion: opts?.echoVersion ?? true,
                isStillCurrent: () => latestSaveRef.current?.character === effectiveCharacter,
                onCommitted: () => { if (saveSoonTimerRef.current) { clearTimeout(saveSoonTimerRef.current); saveSoonTimerRef.current = null; } },
            };
        });
    }
    const saveAuthority = createSaveAuthorityScope({
        accountKey: saveAuthorityAccountKeyRef, latestVersion: latestSaveVersionRef,
        payloadRevision: savePayloadRevisionRef, payloadIdentity: savePayloadIdentityRef,
        failureCount: saveFailCountRef, sessionEpoch: saveSessionEpochRef,
        createAbort: pvpCreateScopeAbortRef, activeAccountKey: activeSaveAccountKey,
        setBlocked: setSaveBlocked,
        invalidateAuthority: () => savePersistenceRef.current?.invalidateAuthority(),
    });

    async function beginDailyLogin(accountName: string) {
        const scope = saveAuthority.captureCreateScope(accountName);
        // Daily reconciliation and ownership metadata stay off the boot path.
        const { reconcileDailyLoginCharacter } = await import("./daily-login-reconcile");
        return { ...scope, commit: (nextCharacter: Character, incomingVersion: unknown): boolean => {
            const baseline = characterBaselineRef.current;
            const local = characterRef.current;
            if (!scope.isCurrent() || !local || !baseline || baseline.epoch !== saveSessionEpochRef.current
                || saveConflictAccountKey(nextCharacter.name) !== activeSaveAccountKey()
                || !acceptVersionedSnapshot(latestSaveVersionRef.current, incomingVersion).accepted) return false;
            const reconciled = reconcileDailyLoginCharacter(baseline.character, local, nextCharacter);
            if (reconciled.conflicts.length && latestSaveRef.current) {
                captureSaveConflictDraft(accountName, { ...latestSaveRef.current.payload, character: local });
            }
            if (!commitVersionedCharacter(reconciled.character, incomingVersion)) return false;
            // Keep pending local changes distinct from the raw server baseline.
            recordCharacterBaseline(nextCharacter);
            if (reconciled.conflicts.length && latestSaveRef.current) {
                void rehydrateSaveConflictDraft(accountName, latestSaveRef.current.payload);
            }
            return true;
        } };
    }

    if (!saveConflictStoreRef.current) {
        saveConflictStoreRef.current = createSaveConflictDraftStore({
            storage,
            activeAccountKey: activeSaveAccountKey,
            onVisibleDraft: setSaveConflictDraft,
            reportStorageFailure: reportConflictStorageFailure,
        });
    }
    const captureSaveConflictDraft = saveConflictStoreRef.current.capture;
    const discardSaveConflictRevision = saveConflictStoreRef.current.discard;
    const rehydrateSaveConflictDraft = saveConflictStoreRef.current.rehydrate;

    if (!savePersistenceRef.current) {
        savePersistenceRef.current = createSavePersistence({
            flight: saveFlightRef.current,
            latestVersion: latestSaveVersionRef,
            latestPayloadRevision: savePayloadRevisionRef,
            dirty: charDirtyRef,
            failureCount: saveFailCountRef,
            isCurrentSession: isCurrentSaveSession,
            currentSessionEpoch: () => saveSessionEpochRef.current,
            captureConflict: captureSaveConflictDraft,
            currentSnapshot: () => latestSaveRef.current,
            installSnapshot: installAuthoritativeSaveRef,
            onConflictSnapshot: (snapshot) => applyServerSnapshot(snapshot),
            writePreview: writeSavePreview,
            setBlocked: setSaveBlocked,
            onAuthoritativeRyo: applyAuthoritativeRyo,
            onAuthoritativeFateShards: applyAuthoritativeFateShards,
            onAcknowledgedSnapshot: snapshot => recordCharacterBaseline(snapshot.payload.character),
        });
    }
    const persistSave = savePersistenceRef.current.persistAutosave;

    function isCurrentSaveSession(accountKey: string, sessionEpoch: number): boolean {
        return saveAuthority.isCurrent(accountKey, sessionEpoch);
    }

    return {
        latestSaveRef,
        savePayloadRevisionRef,
        savePayloadIdentityRef,
        prevCharRef,
        charDirtyRef,
        latestSaveVersionRef,
        saveAuthorityAccountKeyRef,
        setSaveConflictDraft,
        saveConflictStoreRef,
        saveFlightRef,
        saveFailCountRef,
        setSaveBlocked,
        savePersistenceRef,
        flushSaveRef,
        saveSoonTimerRef,
        saveAuthority, captureSaveConflictDraft, discardSaveConflictRevision, rehydrateSaveConflictDraft, persistSave,
        installAuthoritativeSaveRef, activeSaveAccountKey, commitVersionedCharacter, pushSaveToServer,
        recordCharacterBaseline, beginDailyLogin,
    };
}

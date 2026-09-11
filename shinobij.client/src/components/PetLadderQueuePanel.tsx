import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { activeCarriedPets } from "../lib/entitlements";
import { fetchRankedPetDuel, type RankedPetWatch } from "../lib/pet-ranked-watch-api";
import {
    petRankedQueue,
    fetchRankedPetCharacter,
    settleRankedPetMatch,
    startRankedPetMatch,
    type PetRankedQueueState,
} from "../lib/pet-ranked-queue-api";
import { PetShowdownReplay } from "./PetShowdownReplay";

/*
 * Live ranked pet matchmaking.
 *
 * This panel used to be an explicit retired-state notice: the old queue launched
 * an ordinary no-reward realtime duel, so what a player watched and what their
 * Elo did were unrelated. That is fixed upstream — the server resolves the fight
 * ONCE and /api/pet/ranked-watch replays that exact resolution to both players.
 *
 * The panel therefore never simulates anything. It drives the handshake:
 *   join → queued → paired → (initiator mints the token) → active → watch.
 * The winner it reports is the server's own verdict, read back off the watch
 * response, and the server re-derives it anyway before rating.
 */
export function PetLadderQueuePanel({ character, sharedImages = {}, onVersionedCharacter }: {
    character: Character;
    sharedImages?: Record<string, string>;
    onVersionedCharacter: (character: Character, version: number) => boolean;
}) {
    const [state, setState] = useState<PetRankedQueueState>({ state: "idle" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [watch, setWatch] = useState<RankedPetWatch | null>(null);
    const [checking, setChecking] = useState(true);
    const [retryAttempt, setRetryAttempt] = useState(0);
    const [closingToken, setClosingToken] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const startedRef = useRef<string | null>(null);
    const refreshIdRef = useRef(0);
    const playerPets = activeCarriedPets<Pet>(character);
    // Read the current App commit callback without restarting playback when
    // adoption itself rerenders the parent. App rejects older/foreign saves.
    const receiveCharacter = useEffectEvent(onVersionedCharacter);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; refreshIdRef.current += 1; };
    }, []);

    const refresh = useCallback(async () => {
        const requestId = ++refreshIdRef.current;
        try {
            const next = await petRankedQueue("poll", character.name);
            if (mountedRef.current && requestId === refreshIdRef.current) {
                if (next.state === "idle") startedRef.current = null;
                setError(null); setState(next);
            }
        } catch (cause) {
            if (mountedRef.current && requestId === refreshIdRef.current) setError(String((cause as Error)?.message ?? cause));
        } finally { if (mountedRef.current && requestId === refreshIdRef.current) setChecking(false); }
    }, [character.name]);

    // Recover active and completed matches after navigation or a reload.
    useEffect(() => {
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    // Completed-match discovery survives settlement, regardless of poll timing.
    useEffect(() => {
        if (busy || (state.state !== "queued" && state.state !== "paired")) return;
        const id = window.setInterval(() => { void refresh(); }, state.state === "paired" ? 800 : 2_500);
        return () => window.clearInterval(id);
    }, [refresh, state.state, busy]);

    // The initiator mints the sealed token once both sides are paired.
    useEffect(() => {
        if (state.state !== "paired" || !state.initiator) return;
        if (startedRef.current === state.opponent) return;
        startedRef.current = state.opponent;
        void startRankedPetMatch(state.opponent)
            .then(refresh)
            .catch(startError => {
                if (mountedRef.current) setError(String((startError as Error)?.message ?? startError));
                startedRef.current = null;
            });
    }, [refresh, state]);

    // Keep failed watch/settlement requests retryable. A successful peer may
    // already have rated this match; completed receipts remain watchable.
    useEffect(() => {
        if ((state.state !== "active" && state.state !== "completed") || closingToken) return;
        const token = state.matchToken;
        const opponent = state.opponent;
        let cancelled = false;
        // StrictMode's discarded effect must not start a second request chain.
        const timer = window.setTimeout(() => { void (async () => {
            setBusy(true); setError(null);
            try {
                const watched = await fetchRankedPetDuel(token);
                if (cancelled) return;
                if (!watched) throw new Error("The ranked match could not be loaded. Retry to recover its recorded result.");
                const outcome = watched.winnerName.toLowerCase() === character.name.toLowerCase() ? "win" : "loss";
                const snapshot = state.state === "active"
                    ? await settleRankedPetMatch({ playerName: character.name, matchToken: token, opponentName: opponent, outcome })
                    : await fetchRankedPetCharacter(character.name);
                if (cancelled) return;
                receiveCharacter(snapshot.character, snapshot._saveVersion);
                setWatch(watched);
            } catch (cause) {
                if (!cancelled) setError(String((cause as Error)?.message ?? cause));
            } finally { if (!cancelled) setBusy(false); }
        })(); }, 0);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [character.name, state, retryAttempt, closingToken]);

    const closeReplay = async (token: string) => {
        refreshIdRef.current += 1;
        setWatch(null); setClosingToken(token); setBusy(true); setError(null);
        try {
            const next = await petRankedQueue("acknowledge", character.name, token);
            if (!mountedRef.current) return;
            startedRef.current = null;
            setState(next); setClosingToken(null);
        } catch (cause) {
            if (mountedRef.current) setError(String((cause as Error)?.message ?? cause));
        } finally { if (mountedRef.current) setBusy(false); }
    };

    const act = (action: "join" | "leave") => async () => {
        refreshIdRef.current += 1;
        setBusy(true);
        setError(null);
        try {
            const next = await petRankedQueue(action, character.name);
            if (mountedRef.current) setState(next);
        } catch (actionError) {
            setError(String((actionError as Error)?.message ?? actionError));
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    if (watch) {
        return (
            <PetShowdownReplay
                script={watch.script}
                playerPets={playerPets}
                sharedImages={sharedImages}
                onExit={() => { if (state.state === "active" || state.state === "completed") void closeReplay(state.matchToken); }}
            />
        );
    }

    return (
        <div className="summary-box" data-testid="pet-ladder-queue" style={{ padding: "0.9rem", marginBottom: "0.9rem" }}>
            <h3 className="pl-h" style={{ marginTop: 0 }}>Ranked live queue</h3>
            {error && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}
            {error && !busy && <button type="button" onClick={() => {
                if (closingToken) void closeReplay(closingToken);
                else if (state.state === "active" || state.state === "completed") setRetryAttempt((value) => value + 1);
                else void refresh();
            }}>{closingToken ? "Return to queue" : "Retry ranked match"}</button>}
            {error && !busy && !closingToken && state.state === "completed" && <button type="button" onClick={() => void closeReplay(state.matchToken)}>Dismiss replay</button>}

            {state.state === "idle" && (
                <>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Face another shinobi's pet for rating. The server resolves the duel and both of you watch that
                        exact fight — no client ever decides a ranked result.
                    </p>
                    <button type="button" disabled={busy || checking} onClick={() => void act("join")()}>
                        {checking ? "Checking ranked matches…" : busy ? "Joining…" : "Find ranked match"}
                    </button>
                </>
            )}

            {state.state === "queued" && (
                <div role="status">
                    <p className="hint" style={{ marginTop: 0 }}>
                        Searching for an opponent near your rating · position {state.queuePosition} of {state.waiting}.
                    </p>
                    <button type="button" disabled={busy} onClick={() => void act("leave")()}>
                        {busy ? "Leaving…" : "Cancel"}
                    </button>
                </div>
            )}

            {state.state === "paired" && (
                <p className="hint" role="status" style={{ marginTop: 0 }}>
                    Matched against <strong>{state.opponent}</strong> ({state.opponentElo}) · sealing the duel…
                </p>
            )}

            {(state.state === "active" || state.state === "completed") && (
                <p className="hint" role="status" style={{ marginTop: 0 }}>
                    {closingToken ? "Returning to the queue…" : error ? "Your ranked match is available to retry." : <>Loading your rated duel against <strong>{state.opponent}</strong>…</>}
                </p>
            )}
        </div>
    );
}

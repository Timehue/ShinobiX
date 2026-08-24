import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { activeCarriedPets } from "../lib/entitlements";
import { fetchRankedPetDuel, type RankedPetWatch } from "../lib/pet-ranked-watch-api";
import {
    petRankedQueue,
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
export function PetLadderQueuePanel({ character, sharedImages = {} }: {
    character: Character;
    sharedImages?: Record<string, string>;
}) {
    const [state, setState] = useState<PetRankedQueueState>({ state: "idle" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [watch, setWatch] = useState<RankedPetWatch | null>(null);
    const mountedRef = useRef(true);
    const startedRef = useRef<string | null>(null);
    const settledRef = useRef<string | null>(null);
    const playerPets = activeCarriedPets<Pet>(character);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        try {
            const next = await petRankedQueue("poll", character.name);
            if (mountedRef.current) setState(next);
        } catch { /* transient; the next tick retries */ }
    }, [character.name]);

    // Poll only while the handshake is in flight. Idle costs nothing.
    //
    // `paired` polls fast on purpose. A single settle call rates BOTH players
    // and then clears both active pointers, so the slower client can find the
    // queue already idle and never learn its match token. Their rating is still
    // correct — it was applied by the same call — but they would miss watching
    // the fight, so the window is kept narrow.
    useEffect(() => {
        if (state.state === "idle" || state.state === "active") return;
        const id = window.setInterval(() => { void refresh(); }, state.state === "paired" ? 800 : 2_500);
        return () => window.clearInterval(id);
    }, [refresh, state.state]);

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

    // Fetch the rated fight, settle it, then play it. Settling BEFORE the replay
    // means a player who closes the tab mid-animation still has their match rated.
    useEffect(() => {
        if (state.state !== "active" || settledRef.current === state.matchToken) return;
        const token = state.matchToken;
        const opponent = state.opponent;
        settledRef.current = token;
        void (async () => {
            const watched = await fetchRankedPetDuel(token);
            if (!mountedRef.current) return;
            if (!watched) {
                // No local fallback, deliberately: a locally simulated ranked
                // fight is the exact bug this mode was retired for.
                setError("The ranked match could not be loaded. Your rating is untouched — retry when the connection is stable.");
                return;
            }
            const outcome = watched.winnerName === character.name ? "win" : "loss";
            await settleRankedPetMatch({ playerName: character.name, matchToken: token, opponentName: opponent, outcome });
            if (mountedRef.current) setWatch(watched);
        })();
    }, [character.name, state]);

    const act = (action: "join" | "leave") => async () => {
        setBusy(true);
        setError(null);
        try {
            setState(await petRankedQueue(action, character.name));
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
                onExit={() => {
                    setWatch(null);
                    setState({ state: "idle" });
                    startedRef.current = null;
                    void refresh();
                }}
            />
        );
    }

    return (
        <div className="summary-box" data-testid="pet-ladder-queue" style={{ padding: "0.9rem", marginBottom: "0.9rem" }}>
            <h3 className="pl-h" style={{ marginTop: 0 }}>Ranked live queue</h3>
            {error && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}

            {state.state === "idle" && (
                <>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Face another shinobi's pet for rating. The server resolves the duel and both of you watch that
                        exact fight — no client ever decides a ranked result.
                    </p>
                    <button type="button" disabled={busy} onClick={() => void act("join")()}>
                        {busy ? "Joining…" : "Find ranked match"}
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

            {state.state === "active" && (
                <p className="hint" role="status" style={{ marginTop: 0 }}>
                    Loading your rated duel against <strong>{state.opponent}</strong>…
                </p>
            )}
        </div>
    );
}

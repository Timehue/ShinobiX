import { Suspense, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Character } from "../types/character";
import { activeCarriedPets } from "../lib/entitlements";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { rankedLevelEligible } from "../../../shared/ranked-eligibility";
import { fetchRankedPetDuel, type RankedPetWatch } from "../lib/pet-ranked-watch-api";
import { useMatchFoundSfx } from "../lib/match-alert-sfx";
import {
    petRankedQueue,
    fetchRankedPetCharacter,
    settleRankedPetMatch,
    type PetRankedQueueState,
} from "../lib/pet-ranked-queue-api";

// The replay carries PetShowdownBattle, react-three-fiber, drei and the
// three-vendor chunk. Imported statically, that whole stack had to arrive
// before this panel could paint or send its first discovery poll. It is
// fetched once a match exists instead, which is still well before playback.
const loadShowdownReplay = () => import("./PetShowdownReplay");
const preloadShowdownReplay = () => { void loadShowdownReplay().catch(() => undefined); };
const PetShowdownReplay = lazyWithRetry(() => loadShowdownReplay().then((m) => ({ default: m.PetShowdownReplay })));
const PetArenaCommands = lazyWithRetry(() => import('./PetTacticsArena').then(m => ({ default: m.PetTacticsArena })));

/** New Colosseum matches accept player commands; old receipts retain their original replay. */
export function PetLadderQueuePanel(props: {
    character: Character; sharedImages?: Record<string, string>;
    onVersionedCharacter: (character: Character, version: number) => boolean;
    onBattleActiveChange?: (active: boolean) => void; onFullscreenActiveChange?: (active: boolean) => void;
}) {
    const [legacy, setLegacy] = useState<boolean | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const finishLegacy = useCallback(() => setLegacy(false), []);
    useEffect(() => {
        let cancelled = false;
        void petRankedQueue('poll', props.character.name).then(next => {
            if (!cancelled) { setLegacy((next.state === 'active' || next.state === 'completed') && !next.control); setError(''); }
        }).catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
        return () => { cancelled = true; };
    }, [props.character.name, retry]);
    if (legacy === null) return <div role="status">{error || 'Checking ranked Pet Arena matches…'}{error && <button type="button" onClick={() => setRetry(n => n + 1)}>Reconnect</button>}</div>;
    if (legacy) return <LegacyPetLadderQueuePanel {...props} onLegacyComplete={finishLegacy} />;
    return <Suspense fallback={<div role="status">Preparing Pet Arena…</div>}><PetArenaCommands playerName={props.character.name}
        sharedImages={props.sharedImages} ranked rankedEligible={rankedLevelEligible(props.character.level)}
        onVersionedCharacter={props.onVersionedCharacter} onActiveChange={props.onBattleActiveChange}
        onFullscreenChange={props.onFullscreenActiveChange} onExit={() => {}} /></Suspense>;
}

/** Recovery only: historical sealed receipts never admit another match. */
function LegacyPetLadderQueuePanel({ character, sharedImages = {}, onVersionedCharacter, onLegacyComplete }: {
    character: Character;
    sharedImages?: Record<string, string>;
    onVersionedCharacter: (character: Character, version: number) => boolean;
    onLegacyComplete: () => void;
}) {
    const [state, setState] = useState<PetRankedQueueState>({ state: "idle" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [watch, setWatch] = useState<RankedPetWatch | null>(null);
    const [checking, setChecking] = useState(true);
    const [retryAttempt, setRetryAttempt] = useState(0);
    const [closingToken, setClosingToken] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const refreshIdRef = useRef(0);
    const playerPets = activeCarriedPets(character);
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
                if (next.state === "idle" || ((next.state === "active" || next.state === "completed") && next.control)) {
                    onLegacyComplete();
                    return;
                }
                setError(null); setState(next);
            }
        } catch (cause) {
            if (mountedRef.current && requestId === refreshIdRef.current) setError(String((cause as Error)?.message ?? cause));
        } finally { if (mountedRef.current && requestId === refreshIdRef.current) setChecking(false); }
    }, [character.name, onLegacyComplete]);

    // Recover active and completed matches after navigation or a reload.
    useEffect(() => {
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    // Only a match can reach playback, so start fetching the renderer as soon
    // as one exists. The token handshake and the watch request then cover
    // most of its download.
    const matchFound = state.state === "active" || state.state === "completed";
    useEffect(() => { if (matchFound) preloadShowdownReplay(); }, [matchFound]);
    useMatchFoundSfx(matchFound, busy);

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
            setState(next); setClosingToken(null);
            if (next.state === 'idle') onLegacyComplete();
        } catch (cause) {
            if (mountedRef.current) setError(String((cause as Error)?.message ?? cause));
        } finally { if (mountedRef.current) setBusy(false); }
    };

    const queueBox = (
        <div className="summary-box" data-testid="pet-ladder-queue" style={{ padding: "0.9rem", marginBottom: "0.9rem" }}>
            <h3 className="pl-h" style={{ marginTop: 0 }}>Recorded Pet Colosseum result</h3>
            {checking && <p className="hint" role="status">Recovering your recorded match…</p>}
            {error && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}
            {error && !busy && <button type="button" onClick={() => {
                if (closingToken) void closeReplay(closingToken);
                else if (state.state === "active" || state.state === "completed") setRetryAttempt((value) => value + 1);
                else void refresh();
            }}>{closingToken ? "Return to queue" : "Retry ranked match"}</button>}
            {error && !busy && !closingToken && state.state === "completed" && <button type="button" onClick={() => void closeReplay(state.matchToken)}>Dismiss replay</button>}

            {(state.state === "active" || state.state === "completed") && (
                <p className="hint" role="status" style={{ marginTop: 0 }}>
                    {closingToken ? "Returning to the queue…" : error ? "Your ranked match is available to retry." : <>Loading your rated duel against <strong>{state.opponent}</strong>…</>}
                </p>
            )}
        </div>
    );

    if (watch) {
        // If the renderer is still arriving, the box keeps showing the
        // "Loading your rated duel" line it showed a moment ago.
        return (
            <Suspense fallback={queueBox}>
                <PetShowdownReplay
                    script={watch.script}
                    playerPets={playerPets}
                    sharedImages={sharedImages}
                    onExit={() => { if (state.state === "active" || state.state === "completed") void closeReplay(state.matchToken); }}
                />
            </Suspense>
        );
    }

    return queueBox;
}

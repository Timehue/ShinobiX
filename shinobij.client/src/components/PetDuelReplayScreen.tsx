import { useState, useEffect, useCallback } from "react";
import type { Pet } from "../types/pet";
import { visiblePoll } from "../lib/poll";
import { PetShowdownReplay } from "./PetShowdownReplay";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";

/*
 * Shared shell for a SERVER-RESOLVED pet duel.
 *
 * Both the Sector War "Pet" win-condition and the Clan War pet challenge work the
 * same way: you field a pet, the server runs a DETERMINISTIC duel the moment the
 * other side answers, and this screen REPLAYS the identical (pets, seed, params)
 * so the fight you watch is byte-identical to what the server recorded. Neither
 * screen ever reports a winner.
 *
 * Only the wording, the endpoints and the engine call differ, so those are config
 * and the shell — picker, submit, poll, replay mount — lives here once. Same
 * pattern as CardClashDuelScreen, which backs both card duels.
 */
/* The resolved branch used to lazy-load PetColiseumDuel and RE-RUN the fight
 * locally through the mirrored legacy sim. On Showdown there is no client
 * mirror: the server re-derives the decided match into a script and this
 * screen only plays it. The fight a viewer watches is the fight the war
 * record settled on, byte for byte, because both came from the same inputs. */

export type PetDuelReplayConfig<S> = {
    title: string;
    /** Shown above the pet picker. */
    intro: string;
    /** Shown when the screen has no duel to work with (missing ids). */
    missingText: string;
    backLabel: string;
    onBack: () => void;
    /** False when the ids are missing — renders `missingText` instead. */
    ready: boolean;
    /** Read the current session; resolves null when none exists yet. */
    fetchState: () => Promise<S | null>;
    /** Field a pet. */
    submit: (petId: string) => Promise<{ session?: S; error?: string }>;
    /** True once the server has decided the duel. */
    resolved: (session: S) => boolean;
    /** Fetch the watchable script for a decided duel. Null = not watchable
     *  (e.g. the session was decided by the retired engine before the cutover);
     *  the banner still tells the result. */
    watch: () => Promise<ShowdownReplayScript | null>;
    /** Result banner shown above the replay. */
    banner: (session: S) => string;
    /** Non-null once THIS player has fielded their pets: the waiting-room copy. */
    waiting: (session: S) => { headline: string; detail: string } | null;
    submitLabel: string;
    submitErrorText: string;
    /**
     * Optional: the label of a control that leaves a DECIDED duel for the next
     * one (back to the picker), or null when this viewer has none. A screen
     * that sets it shows a duel that was already decided when the viewer
     * arrived as a result card (watch it, or move on) rather than replaying
     * it on every visit — the server keeps a decided Sector War duel for half
     * an hour and accepts the next one over it, but the screen only replayed
     * it, so the table read as locked. Absent → the shell behaves as it always
     * has (the Clan War pet challenge leaves it unset).
     */
    nextDuel?: (session: S) => string | null;
    /**
     * Optional: the duel was fought before this screen opened (an open-world
     * Sector War pet battle, decided by both sides' sealed teams the moment one
     * attacked the other), so there is no pet to pick. The screen never shows
     * the picker: `loading` until the session arrives, `missing` if it cannot.
     */
    pickerless?: { loading: string; missing: string };
};

export function PetDuelReplayScreen<S>({ pets, config }: { pets: Pet[]; config: PetDuelReplayConfig<S> }) {
    const { ready, fetchState, submit, resolved: isResolved, watch, banner, waiting, onBack, nextDuel, pickerless } = config;
    const [selectedPetId, setSelectedPetId] = useState(pets[0]?.id ?? "");
    const [session, setSession] = useState<S | null>(null);
    /** The mount read found no session (only shown for a `pickerless` screen). */
    const [sessionMissing, setSessionMissing] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    /** undefined = not fetched yet · null = decided but unwatchable · script = play it */
    const [script, setScript] = useState<ShowdownReplayScript | null | undefined>(undefined);
    /** The duel was ALREADY decided when this screen opened (only tracked when
     *  `nextDuel` is configured): show its result card, not an automatic replay. */
    const [arrivedDecided, setArrivedDecided] = useState(false);
    /** The replay on screen was opened from that result card: leaving it goes
     *  back to the card, not off the screen. */
    const [replayFromCard, setReplayFromCard] = useState(false);

    const resolved = session ? isResolved(session) : false;

    // Fetch the script ONCE per decided duel. The server re-derives it
    // deterministically from the stored inputs, so there is nothing to poll.
    useEffect(() => {
        if (!resolved || script !== undefined) return;
        let alive = true;
        void watch()
            .then((s) => { if (alive) setScript(s); })
            .catch(() => { if (alive) setScript(null); });
        return () => { alive = false; };
    }, [resolved, script]); // eslint-disable-line react-hooks/exhaustive-deps

    // Adopt an already-open session on mount, so a refresh mid-duel (or the second
    // player arriving after the first has fielded a pet) lands in the right state
    // instead of back on the picker.
    useEffect(() => {
        if (!ready) return;
        let alive = true;
        void fetchState().then((s) => {
            if (!alive) return;
            if (!s) return void setSessionMissing(true);
            setSession(s);
            if (nextDuel && isResolved(s) && nextDuel(s)) setArrivedDecided(true);
        }).catch(() => { if (alive) setSessionMissing(true); /* none yet */ });
        return () => { alive = false; };
    }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

    // Poll until the duel resolves. The server settles the instant the last pet is
    // in — the sim is deterministic, so there are no turns to wait through. Keyed
    // on `resolved` (not the whole session) so the interval isn't rebuilt per tick.
    useEffect(() => {
        if (!ready || !session || resolved) return;
        let alive = true;
        const stop = visiblePoll(() => {
            void fetchState().then((s) => { if (alive && s) setSession(s); }).catch(() => { /* best-effort */ });
        }, 4000);
        return () => { alive = false; stop(); };
    }, [ready, !!session, !!resolved]); // eslint-disable-line react-hooks/exhaustive-deps

    const send = useCallback(async () => {
        if (!ready || !selectedPetId) return;
        setBusy(true); setError("");
        try {
            const d = await submit(selectedPetId);
            if (d.session) setSession(d.session); else setError(d.error ?? config.submitErrorText);
        } catch (e) { setError(String((e as Error).message || e)); }
        finally { setBusy(false); }
    }, [ready, selectedPetId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Leave a decided duel for the next one: back to the picker. The decided
    // session is dropped locally; the server replaces it when the next duel
    // opens (or, for a defender, answers one an attacker has opened).
    const startNextDuel = useCallback(() => {
        setSession(null);
        setScript(undefined);
        setArrivedDecided(false);
        setReplayFromCard(false);
        setError("");
    }, []);

    const card = (body: React.ReactNode) => (
        <div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}>{body}</div>
    );

    if (!ready) {
        return card(<><p>{config.missingText}</p><button onClick={onBack}>{config.backLabel}</button></>);
    }

    // Resolved → play the server's own script through the Showdown arena.
    if (session && resolved) {
        const nextLabel = nextDuel ? nextDuel(session) : null;
        // A configured screen shows a duel that was decided before the viewer
        // arrived (or one that cannot be replayed) as a result card with a way
        // on to the next duel. One decided while the viewer watched still plays.
        if (nextLabel && (arrivedDecided || script === null)) {
            return card(
                <>
                    <h3>{config.title}</h3>
                    <p style={{ fontWeight: 700 }}>{banner(session)}</p>
                    {script === null && <p className="hint">This battle cannot be replayed, but its result is recorded above.</p>}
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        {script !== null && (
                            <button onClick={() => { setArrivedDecided(false); setReplayFromCard(true); }} disabled={script === undefined}>
                                {script === undefined ? "Loading the duel…" : "Watch the duel"}
                            </button>
                        )}
                        <button onClick={startNextDuel}>{nextLabel}</button>
                        <button onClick={onBack}>{config.backLabel}</button>
                    </div>
                </>,
            );
        }
        if (script === undefined) {
            return card(<><h3>{config.title}</h3><p className="hint">Recovering the battle…</p></>);
        }
        if (script === null) {
            // Decided, but not watchable (a session from before the engine
            // cutover, or the fetch failed). The verdict still stands.
            return card(
                <>
                    <h3>{config.title}</h3>
                    <p style={{ fontWeight: 700 }}>{banner(session)}</p>
                    <p className="hint">This battle cannot be replayed, but its result is recorded above.</p>
                    <button onClick={onBack}>{config.backLabel}</button>
                </>,
            );
        }
        return (
            <div>
                <div style={{ textAlign: "center", padding: 8, fontWeight: 700 }}>{banner(session)}</div>
                <PetShowdownReplay script={script} playerPets={pets} onExit={replayFromCard ? () => setArrivedDecided(true) : onBack} />
            </div>
        );
    }

    // A battle fought before the screen opened has no picker to fall back to:
    // until its decided session arrives, there is nothing else to show.
    if (pickerless) {
        return card(<><h3>{config.title}</h3><p className="hint">{sessionMissing ? pickerless.missing : pickerless.loading}</p><button onClick={onBack}>{config.backLabel}</button></>);
    }

    // My pets are in; waiting on the other side.
    const wait = session ? waiting(session) : null;
    if (wait) {
        return card(
            <>
                <h3>{config.title}</h3>
                <p className="hint">{wait.headline}</p>
                <p style={{ fontSize: ".85rem" }}>{wait.detail}</p>
                <button onClick={onBack}>{config.backLabel}</button>
            </>,
        );
    }

    // Pet selection.
    return card(
        <>
            <h3>{config.title}</h3>
            <p className="hint">{config.intro}</p>
            {pets.length === 0 ? <p>You have no pets to send into battle.</p> : (
                <>
                    <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)} disabled={busy} style={{ margin: "8px 0" }}>
                        {pets.map((p) => <option key={p.id} value={p.id}>{p.name} · Lv {p.level} · {p.element}</option>)}
                    </select>
                    <div><button onClick={send} disabled={busy || !selectedPetId}>{busy ? "…" : config.submitLabel}</button></div>
                </>
            )}
            {error && <p style={{ color: "var(--red-400)" }}>{error}</p>}
            <div style={{ marginTop: 10 }}><button onClick={onBack}>{config.backLabel}</button></div>
        </>,
    );
}

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
};

export function PetDuelReplayScreen<S>({ pets, config }: { pets: Pet[]; config: PetDuelReplayConfig<S> }) {
    const { ready, fetchState, submit, resolved: isResolved, watch, banner, waiting, onBack } = config;
    const [selectedPetId, setSelectedPetId] = useState(pets[0]?.id ?? "");
    const [session, setSession] = useState<S | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    /** undefined = not fetched yet · null = decided but unwatchable · script = play it */
    const [script, setScript] = useState<ShowdownReplayScript | null | undefined>(undefined);

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
        void fetchState().then((s) => { if (alive && s) setSession(s); }).catch(() => { /* none yet */ });
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

    const card = (body: React.ReactNode) => (
        <div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}>{body}</div>
    );

    if (!ready) {
        return card(<><p>{config.missingText}</p><button onClick={onBack}>{config.backLabel}</button></>);
    }

    // Resolved → play the server's own script through the Showdown arena.
    if (session && resolved) {
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
                <PetShowdownReplay script={script} playerPets={pets} onExit={onBack} />
            </div>
        );
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

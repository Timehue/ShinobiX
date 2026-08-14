import { useState, useEffect, useCallback, Suspense, lazy } from "react";
import type { Pet } from "../types/pet";
import { type DuelResult } from "../lib/pet-duel-sim";

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
const PetColiseumDuel = lazy(() => import("./PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));

/** What the replay needs once the server has resolved the duel. */
export type PetDuelReplayView = {
    playerPet: Pet;
    enemyPet: Pet;
    seed: number;
    result: DuelResult;
};

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
    /** Resolved → build the replay inputs (null while still pending). */
    replay: (session: S) => PetDuelReplayView | null;
    /** Result banner shown above the replay. */
    banner: (session: S) => string;
    /** Non-null once THIS player has fielded their pets: the waiting-room copy. */
    waiting: (session: S) => { headline: string; detail: string } | null;
    submitLabel: string;
    submitErrorText: string;
};

export function PetDuelReplayScreen<S>({ pets, config }: { pets: Pet[]; config: PetDuelReplayConfig<S> }) {
    const { ready, fetchState, submit, replay, banner, waiting, onBack } = config;
    const [selectedPetId, setSelectedPetId] = useState(pets[0]?.id ?? "");
    const [session, setSession] = useState<S | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const resolved = session ? replay(session) : null;

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
        const id = setInterval(() => {
            void fetchState().then((s) => { if (alive && s) setSession(s); }).catch(() => { /* best-effort */ });
        }, 4000);
        return () => { alive = false; clearInterval(id); };
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

    // Resolved → replay the deterministic duel and show the result.
    if (session && resolved) {
        return (
            <div>
                <div style={{ textAlign: "center", padding: 8, fontWeight: 700 }}>{banner(session)}</div>
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the arena…</div>}>
                    <PetColiseumDuel
                        key={resolved.seed}
                        playerPet={resolved.playerPet}
                        enemyPet={resolved.enemyPet}
                        seed={resolved.seed}
                        result={resolved.result}
                        sharedImages={{}}
                        onExit={onBack}
                    />
                </Suspense>
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

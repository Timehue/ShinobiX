import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import { BattleTowerFight } from "../screens/BattleTowerFight";
import {
    fetchTowerPvpSession,
    submitTowerPvpActionWithLostResponseRetry,
    type TowerPvpMatch,
} from "../lib/tower-pvp-api";
import {
    ranked2v2,
    settleRanked2v2,
    type Ranked2v2Action,
    type Ranked2v2State,
} from "../lib/ranked-2v2-api";
import { setTowerPvpMatchId } from "../lib/screen-guards";
import { gameConfirm } from "./GameAlert";

/*
 * Ranked 2v2 — pair up, queue together, climb your own ladder.
 *
 * The flow is deliberately explicit rather than automatic: you choose a partner,
 * they accept, and only then can the pair queue. Teams are therefore never a
 * matchmaking shuffle — your result belongs to the two of you.
 *
 * The board is the shared four-player session on the canonical PvP grid, so a
 * ranked 2v2 plays by exactly the rules 1v1 ranked does. Rating is applied by
 * the server from ratings sealed at match time; this panel reports nothing it
 * decided itself.
 */
export function Ranked2v2Panel({ character, sharedImages }: {
    character: Character;
    sharedImages?: Record<string, string>;
}) {
    const me = character.name;
    const [state, setState] = useState<Ranked2v2State>({ duo: null, queue: { state: "idle" }, match: null });
    const [partner, setPartner] = useState("");
    const [busy, setBusy] = useState<Ranked2v2Action | null>(null);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        try {
            const next = await ranked2v2("status", me);
            if (mountedRef.current) setState(next);
        } catch { /* transient; the next tick retries */ }
    }, [me]);

    // Inlined rather than calling refresh(): the setState must be provably AFTER
    // an await, and the local `alive` latch drops a response that lands after a
    // partner change or unmount instead of writing stale duo state.
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const next = await ranked2v2("status", me);
                if (alive && mountedRef.current) setState(next);
            } catch { /* transient; the poll below retries */ }
        })();
        return () => { alive = false; };
    }, [me]);

    // Poll only while something is pending. An idle panel costs nothing, and a
    // live board polls through the fight screen instead.
    const phase = state.match ? "match" : state.queue.state === "queued" ? "queued" : state.duo?.status ?? "idle";
    useEffect(() => {
        if (phase === "match" || phase === "idle") return;
        const id = window.setInterval(() => { void refresh(); }, phase === "queued" ? 2_000 : 4_000);
        return () => window.clearInterval(id);
    }, [phase, refresh]);

    // Mirror the live match into the nav lock so the shell knows a fight is on.
    useEffect(() => {
        setTowerPvpMatchId(state.match ? state.match.matchId : null);
    }, [state.match]);

    const act = useCallback(async (action: Ranked2v2Action, extra: Record<string, unknown> = {}) => {
        setBusy(action);
        setError(null);
        try {
            const next = await ranked2v2(action, me, extra);
            if (mountedRef.current) setState(next);
        } catch (actionError) {
            if (mountedRef.current) setError(String((actionError as Error)?.message ?? actionError));
        } finally {
            if (mountedRef.current) setBusy(null);
        }
    }, [me]);

    const duo = state.duo;
    const mine = duo?.members.find(member => member.slug.toLowerCase() === me.toLowerCase());
    const other = duo?.members.find(member => member.slug.toLowerCase() !== me.toLowerCase());
    const pendingInvite = Boolean(duo && mine && !mine.accepted);
    const ready = Boolean(duo && duo.members.length === 2 && duo.members.every(member => member.accepted));
    const rating = character.ranked2v2Rating ?? 1000;

    if (state.match) {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                runId={state.match.matchId}
                initialSession={(state.match as TowerPvpMatch).combat}
                stateFn={fetchTowerPvpSession}
                actionRetryFn={submitTowerPvpActionWithLostResponseRetry}
                // Ranked settlement, not the zero-reward Team Arena acknowledgement.
                // /api/towers/pvp-settle refuses this match outright, so the ladder
                // can only ever move through here.
                settleFn={settleRanked2v2(me)}
                settleOnAnyDone
                variant="team-pvp"
                onExit={() => { setTowerPvpMatchId(null); void refresh(); }}
            />
        );
    }

    return (
        <section className="summary-box" data-testid="ranked-2v2-panel">
            <h3>Ranked 2v2</h3>
            <p>
                Rating: <strong>{rating}</strong> Elo | Wins {character.ranked2v2Wins ?? 0} | Losses {character.ranked2v2Losses ?? 0}
            </p>
            <p className="hint">
                Pair with one partner, then queue together against another pair. Your own ladder — separate from solo
                ranked, because a duo result says nothing about solo skill.
            </p>
            {error && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}

            {!duo && (
                <form
                    onSubmit={event => { event.preventDefault(); if (partner.trim()) void act("invite", { target: partner.trim() }); }}
                >
                    <label htmlFor="ranked-2v2-partner">Invite a partner</label>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <input
                            id="ranked-2v2-partner"
                            value={partner}
                            maxLength={32}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Player name"
                            onChange={event => setPartner(event.target.value)}
                        />
                        <button type="submit" disabled={Boolean(busy) || !partner.trim()}>
                            {busy === "invite" ? "Inviting…" : "Invite"}
                        </button>
                    </div>
                </form>
            )}

            {pendingInvite && other && (
                <div role="status">
                    <p><strong>{other.displayName}</strong> invited you to a ranked duo.</p>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" disabled={Boolean(busy)} onClick={() => void act("accept")}>
                            {busy === "accept" ? "Accepting…" : "Accept"}
                        </button>
                        <button type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => void act("leave")}>
                            Decline
                        </button>
                    </div>
                </div>
            )}

            {duo && !pendingInvite && other && (
                <div>
                    <p>
                        Duo with <strong>{other.displayName}</strong> ({other.rating} Elo)
                        {other.accepted ? "" : " — waiting for them to accept…"}
                    </p>
                    {state.queue.state === "queued" ? (
                        <div role="status">
                            <p className="hint">
                                Searching for a pair near {state.queue.rating} Elo · position {state.queue.position} of {state.queue.waiting}.
                            </p>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void act("unqueue")}>
                                {busy === "unqueue" ? "Leaving…" : "Cancel search"}
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" disabled={Boolean(busy) || !ready} onClick={() => void act("queue")}>
                                {busy === "queue" ? "Queueing…" : "Find ranked match"}
                            </button>
                            <button
                                type="button"
                                className="danger-button"
                                disabled={Boolean(busy)}
                                onClick={() => { void (async () => {
                                    if (await gameConfirm("Leave this ranked duo? Your partner will be freed to pair again.")) {
                                        await act("leave");
                                    }
                                })(); }}
                            >
                                Leave duo
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

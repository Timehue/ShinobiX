import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { PetShowdownBattle } from "./PetShowdownBattle";
import {
    fetchShowdownState,
    forfeitShowdown,
    startArenaBout,
    submitShowdownTurn,
    type ShowdownCommand,
    type ShowdownStateView,
} from "../lib/pet-showdown-api";
import {
    settleHollowGateCombat,
    type HollowGateCombatKind,
    type HollowGateCombatSettleResult,
} from "../lib/hollow-gate-combat-api";

/*
 * A Hollow Gate pet encounter, fought on the Showdown engine.
 *
 * The server side of this shipped first and then sat unused: /api/pet/showdown's
 * arena entry has always accepted a Hollow Gate binding, validated the run claim
 * and minted the run's `hg-pet-result` receipt — but nothing called it. The Gate
 * kept routing pet fights through the Pet Arena screen, which minted a
 * battle-start token and fought the legacy client sim. This component is the
 * caller that closes that gap.
 *
 * THE HANDSHAKE IS UNCHANGED, because it is the anti-cheat boundary:
 * /api/hollow-gate/combat-settle reads `hg-pet-result:<player>:<receipt>` and
 * checks playerName + runId. Only the PRODUCER moved. The receipt is keyed by
 * SESSION ID, so the bout the player actually fought is the handle they settle
 * with, and nothing client-supplied sits in between.
 *
 * The opponent is not sent from here. The request carries the run token, the run
 * id and the encounter id; the server builds the Hound.
 *
 * SETTLEMENT IS NOT OPTIONAL, and that shapes the exits. A decided encounter
 * that never reaches combat-settle leaves the run stuck on an unresolved node,
 * so this screen will not hand control back until the Gate has answered: Exit
 * retries a failed settle rather than walking away from it, and the Gate's own
 * Emergency Forfeit remains the escape hatch for a genuinely broken encounter.
 */

export type HollowGatePetFightRef = {
    token: string;
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
    /** Encounter identity, minted with the run — the server checks its shape. */
    houndId: string;
};

type Phase = "starting" | "fighting" | "settling" | "settled" | "error";

const crumbKeyFor = (runId: string) => `showdown.hollowGate.v1.${runId}`;

function crumbSessionId(runId: string): string {
    try {
        return localStorage.getItem(crumbKeyFor(runId)) ?? "";
    } catch {
        return "";
    }
}

function writeCrumb(runId: string, sessionId: string | null): void {
    try {
        if (sessionId) localStorage.setItem(crumbKeyFor(runId), sessionId);
        else localStorage.removeItem(crumbKeyFor(runId));
    } catch { /* storage disabled — a refresh simply restarts the duel */ }
}

export function HollowGatePetFight({ character, fight, activePet, sharedImages, onSettled, onUnavailable }: {
    character: Character;
    fight: HollowGatePetFightRef;
    /** The pet the run sends in. Sealed server-side from the roster by id. */
    activePet: Pet;
    sharedImages: Record<string, string>;
    onSettled: (result: HollowGateCombatSettleResult) => void;
    /** The bout could not start at all — nothing was decided, nothing settled. */
    onUnavailable: (reason: string) => void;
}) {
    const [state, setState] = useState<ShowdownStateView | null>(null);
    const [phase, setPhase] = useState<Phase>("starting");
    const [message, setMessage] = useState("");
    const startedRef = useRef(false);
    const settleInFlight = useRef(false);
    const settledResult = useRef<HollowGateCombatSettleResult | null>(null);

    /*
     * RESUME BEFORE STARTING — otherwise a refresh is a reroll.
     *
     * The shrine re-launches this encounter whenever the run still has an
     * `activeCombat`, so a player losing a sealed duel could reload and be
     * handed a brand-new bout. (The retired client-local duel had the same
     * hole; it is not a regression, but it is not something to carry forward
     * either.) The crumb is keyed by RUN ID and lives in localStorage, like
     * every other resume pointer in this client — sessionStorage dies with the
     * tab, which is exactly the case it exists for.
     *
     * A crumb pointing at a FINISHED session is not resumed but settled: that is
     * where a decided fight whose settle call was lost to the network sits.
     */
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        let cancelled = false;
        void (async () => {
            const resumed = crumbSessionId(fight.runId);
            if (resumed) {
                const existing = await fetchShowdownState(character.name, resumed);
                if (cancelled) return;
                if (existing) {
                    setState(existing);
                    setPhase(existing.finished ? "settling" : "fighting");
                    if (existing.finished) void settleSession(resumed);
                    return;
                }
                writeCrumb(fight.runId, null);
            }
            const started = await startArenaBout(character.name, "1v1", [activePet.id], {
                token: fight.token,
                runId: fight.runId,
                houndId: fight.houndId,
            });
            if (cancelled) return;
            if ("error" in started) {
                onUnavailable(started.error);
                return;
            }
            writeCrumb(fight.runId, started.state.sessionId);
            setState(started.state);
            setPhase("fighting");
        })();
        return () => { cancelled = true; };
        // Mount-only: this is a one-shot kickoff, not a subscription.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sessionId = state?.sessionId ?? "";

    const submitTurn = useCallback(
        async (commands: ShowdownCommand[]) => (sessionId ? submitShowdownTurn(character.name, sessionId, commands) : null),
        [character.name, sessionId],
    );

    /* These are plain functions, not useCallback: they close over refs and
     * state the React Compiler cannot prove stable, and a hand-written dep list
     * it disagrees with is worse than no memo at all. PetShowdownBattle does not
     * memo on these props, so identity churn costs nothing. */

    /** Redeem a bout's receipt against the Gate. Idempotent on the server (the
     *  receipt is `nx` and combat-settle dedupes), so retrying is safe. Takes
     *  the session id explicitly because the resume path settles a session it
     *  has only just read, before it is in state. */
    async function settleSession(id: string) {
        if (settleInFlight.current || !id) return;
        if (settledResult.current) { onSettled(settledResult.current); return; }
        settleInFlight.current = true;
        setPhase("settling");
        setMessage("");
        try {
            const result = await settleHollowGateCombat({
                playerName: character.name,
                token: fight.token,
                runId: fight.runId,
                petReceipt: id,
            });
            settledResult.current = result;
            writeCrumb(fight.runId, null);
            setPhase("settled");
            onSettled(result);
        } catch (error) {
            setPhase("error");
            setMessage(error instanceof Error
                ? `The Gate did not answer: ${error.message}`
                : "The Gate did not answer.");
        } finally {
            settleInFlight.current = false;
        }
    }

    /** Concede, then settle. The concession is what DECIDES the session and
     *  mints the receipt, so the order matters — settling first would redeem a
     *  receipt that does not exist yet. Conceding an already-finished session is
     *  a server-side no-op, so this is safe to call from Exit too. */
    async function concede() {
        if (!sessionId) return;
        if (settledResult.current) { onSettled(settledResult.current); return; }
        setPhase("settling");
        await forfeitShowdown(character.name, sessionId);
        await settleSession(sessionId);
    }

    if (!state) {
        return (
            <div className="card cinematic-card">
                <h2>Sealed Duel</h2>
                <p className="hint">The seal is opening…</p>
            </div>
        );
    }

    return (
        <>
            <PetShowdownBattle
                initialState={state}
                playerPets={[activePet]}
                sharedImages={sharedImages}
                submitTurn={submitTurn}
                // A forfeit is a real Hollow Gate outcome, so it must still be
                // settled — conceding and walking away would leave the run on an
                // unresolved node with nothing to redeem. The endpoint decides a
                // forfeited session as a LOSS and mints the same receipt the
                // finishing turn would, so conceding lands here and settles like
                // any other defeat.
                onForfeit={() => { void concede(); }}
                onFinished={() => { void settleSession(sessionId); }}
                // Exit is the retry, and it concedes rather than settling
                // blind: a bout the player leaves mid-fight has no receipt yet,
                // so settling it would fail forever. Conceding a session that
                // already finished is a server-side no-op, so this is the safe
                // call in both cases.
                onExit={() => {
                    if (settledResult.current) { onSettled(settledResult.current); return; }
                    void concede();
                }}
                onRematch={() => { /* a sealed encounter is fought once */ }}
            />
            {(phase === "settling" || phase === "error") && createPortal(
                <div className="hollow-gate-settle-banner" role="status">
                    {phase === "settling"
                        ? "Sealing the result with the Gate…"
                        : `${message} Press Exit to try again — your run is intact.`}
                </div>,
                document.body,
            )}
        </>
    );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { PetShowdownBattle } from "./PetShowdownBattle";
import {
    forfeitShowdown,
    startHollowGatePetDuel,
    submitShowdownTurn,
    type HollowGatePetDuelStart,
    type ShowdownCommand,
    type ShowdownStateView,
} from "../lib/pet-showdown-api";
import {
    settleHollowGateCombat,
    type HollowGateCombatKind,
    type HollowGateCombatSettleResult,
} from "../lib/hollow-gate-combat-api";
import { warmShowdownModels } from "../lib/pet-model-preload";

/*
 * A Hollow Gate pet encounter, fought as the road beasts' Colosseum duel.
 *
 * "Send pet" opens a server-authoritative Showdown bout drawn exactly like a
 * road-beast challenge: a random 1v1, 2v2 or 3v3, capped by the ready carried
 * pets, led by the pet the player sent, against the run's own Hounds. The
 * server draws the format and both teams. The request carries the run token
 * and the run id, nothing about either side.
 *
 * THE SERVER IS THE RESUME POINTER. The encounter's binding names one Showdown
 * session, so asking to open the duel again after a reload returns that same
 * session: same format, same pets, same round. A duel that already finished is
 * settled rather than resumed, which is where a result whose settle call was
 * lost to the network sits.
 *
 * THE HANDSHAKE IS THE ANTI-CHEAT BOUNDARY. The finishing turn (or a
 * concession) mints `hg-pet-result:<player>:<session>`, and
 * /api/hollow-gate/combat-settle pays from the run's own reward table after
 * checking that receipt against the encounter's binding. The session the player
 * fought is the handle they settle with.
 *
 * SETTLEMENT IS NOT OPTIONAL, and that shapes the exits. A decided encounter
 * that never reaches combat-settle leaves the run on an unresolved node, so
 * this screen will not hand control back until the Gate has answered: Exit
 * retries a failed settle rather than walking away from it. A duel that cannot
 * open at all goes to `onUnavailable`, and the shrine fights the same node as a
 * shinobi instead.
 */

export type HollowGatePetFightRef = {
    token: string;
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
};

type Phase = "starting" | "fighting" | "settling" | "settled" | "error";

/** One retry for a busy or unreachable server before the duel is given up. */
async function openDuel(playerName: string, fight: HollowGatePetFightRef): Promise<HollowGatePetDuelStart> {
    const open = () => startHollowGatePetDuel(playerName, { token: fight.token, runId: fight.runId });
    const first = await open();
    if (!("error" in first) || !first.retryable) return first;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return open();
}

export function HollowGatePetFight({ character, fight, sharedImages, onSettled, onUnavailable }: {
    character: Character;
    fight: HollowGatePetFightRef;
    sharedImages: Record<string, string>;
    onSettled: (result: HollowGateCombatSettleResult) => void;
    /** The duel could not open at all — nothing was decided, nothing settled. */
    onUnavailable: (reason: string) => void;
}) {
    const [state, setState] = useState<ShowdownStateView | null>(null);
    /** The pets the server fielded, for the renderer's models and art. */
    const [fielded, setFielded] = useState<Pet[]>([]);
    const [phase, setPhase] = useState<Phase>("starting");
    const [message, setMessage] = useState("");
    /** A decided duel with no session left to show: only its receipt remains. */
    const [decidedReceipt, setDecidedReceipt] = useState("");
    const startedRef = useRef(false);
    const settleInFlight = useRef(false);
    const settledResult = useRef<HollowGateCombatSettleResult | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        let cancelled = false;
        void (async () => {
            const started = await openDuel(character.name, fight);
            if (cancelled) return;
            if ("error" in started) {
                onUnavailable(started.error);
                return;
            }
            if ("decided" in started) {
                setDecidedReceipt(started.decided.petReceipt);
                void settleSession(started.decided.petReceipt);
                return;
            }
            const pets = started.petIds
                .map((id) => (character.pets ?? []).find((pet) => pet.id === id))
                .filter((pet): pet is Pet => Boolean(pet));
            // Warm every body before the fight shows. An unwarmed GLB suspends
            // against a null fallback, so a cold Hound is an empty arena.
            if (!started.state.finished) await warmShowdownModels(started.state, pets);
            if (cancelled) return;
            setFielded(pets);
            setState(started.state);
            setPhase(started.state.finished ? "settling" : "fighting");
            if (started.state.finished) void settleSession(started.state.sessionId);
        })();
        return () => { cancelled = true; };
        // Mount-only: this is a one-shot kickoff, not a subscription.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sessionId = state?.sessionId ?? "";

    const submitTurn = useCallback(
        async (commands: ShowdownCommand[], expectedRound: number) => (sessionId ? submitShowdownTurn(character.name, sessionId, commands, expectedRound) : null),
        [character.name, sessionId],
    );

    /* These are plain functions, not useCallback: they close over refs and
     * state the React Compiler cannot prove stable, and a hand-written dep list
     * it disagrees with is worse than no memo at all. PetShowdownBattle does not
     * memo on these props, so identity churn costs nothing. */

    /** Redeem a duel's receipt against the Gate. Idempotent on the server (the
     *  receipt is exact and combat-settle dedupes), so retrying is safe. Takes
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
     *  receipt that does not exist yet. Conceding an already-finished session
     *  re-seals its real result, so this is safe to call from Exit too. */
    async function concede() {
        if (!sessionId) return;
        if (settledResult.current) { onSettled(settledResult.current); return; }
        setPhase("settling");
        await forfeitShowdown(character.name, sessionId);
        await settleSession(sessionId);
    }

    if (!state) {
        return (
            <div className="card cinematic-card" role={phase === "error" ? "alert" : "status"}>
                <h2>Sealed Duel</h2>
                <p className="hint">{phase === "error"
                    ? `${message} Your run is intact.`
                    : phase === "settling" ? "Sealing the result with the Gate…" : "The seal is opening…"}</p>
                {phase === "error" && decidedReceipt && (
                    <button type="button" className="admin-button" onClick={() => { void settleSession(decidedReceipt); }}>Try Again</button>
                )}
            </div>
        );
    }

    return (
        <>
            <PetShowdownBattle
                initialState={state}
                playerPets={fielded}
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
                // blind: a duel the player leaves mid-fight has no receipt yet,
                // so settling it would fail forever. Conceding a session that
                // already finished only re-seals its result, so this is the safe
                // call in both cases.
                onExit={() => {
                    if (settledResult.current) { onSettled(settledResult.current); return; }
                    void concede();
                }}
                // A sealed encounter is fought once.
                hideRematch
                onRematch={() => undefined}
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

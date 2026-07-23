// ─────────────────────────────────────────────────────────────────────────────
// PetLadderQueuePanel.tsx — live matchmaking for the Pet Coliseum ladder
// (docs/pet-coliseum-player-control-plan.md §12).
//
// The ladder used to be asynchronous: challenge a stored defense, the server
// resolved it, you watched a replay. Now it queues you against another player who
// is also queued, and you both fight it live under lockstep.
//
// Two things fall out of that which are worth stating:
//   • There is no reroll window. The old shape let a challenger see the fight go
//     badly and abandon before it committed; here the fight only exists once two
//     live players are matched, and the server owns the result either way.
//   • The `initiator` flag from the queue decides who sends the challenge. Without
//     it both sides would challenge each other at once and one invite would be
//     refused as "already in a duel".
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import {
    joinPetLadderQueue, pollPetLadderQueue, leavePetLadderQueue,
    LADDER_POLL_MS, type LadderQueueMatch,
} from "../lib/pet-ladder-queue";
import { challengeToDuel, canDuelLive } from "../lib/pet-duel-transport";
import type { Pet } from "../types/pet";

export type PetLadderQueuePanelProps = {
    playerName: string;
    level: number;
    elo: number;
    /** The pet this player is queuing with. */
    pets: Pet[];
    /** Set when a match pairs us — the caller arms its live host to auto-accept. */
    onMatched: (opponent: string) => void;
    /** True while a duel is on screen, so the panel stops polling. */
    duelActive: boolean;
};

export function PetLadderQueuePanel({ playerName, level, elo, pets, onMatched, duelActive }: PetLadderQueuePanelProps) {
    const [queued, setQueued] = useState(false);
    const [size, setSize] = useState(0);
    const [note, setNote] = useState<string | null>(null);
    const [waitedSec, setWaitedSec] = useState(0);
    const matchedRef = useRef(false);
    const petsRef = useRef(pets);
    useEffect(() => { petsRef.current = pets; }, [pets]);

    const handleMatch = useCallback((match: LadderQueueMatch) => {
        if (matchedRef.current) return;
        matchedRef.current = true;
        setQueued(false);
        onMatched(match.opponent);
        // Exactly one side sends. The other is already armed to auto-accept.
        if (match.initiator) {
            if (!challengeToDuel(match.opponent, "1v1", petsRef.current)) {
                setNote("Lost the connection before the match could start. Try again.");
                matchedRef.current = false;
            } else {
                setNote(`Matched with ${match.opponent} — starting…`);
            }
        } else {
            setNote(`Matched with ${match.opponent} — waiting for them to open the duel…`);
        }
    }, [onMatched]);

    // Poll while queued. Stops the moment a duel is on screen so a long fight
    // cannot age the queue entry out underneath it.
    useEffect(() => {
        if (!queued || duelActive) return;
        const timer = window.setInterval(() => {
            void (async () => {
                const state = await pollPetLadderQueue(playerName);
                setSize(state.queueSize);
                setWaitedSec((s) => s + LADDER_POLL_MS / 1000);
                if (state.match) handleMatch(state.match);
                else if (!state.inQueue && !matchedRef.current) {
                    // The entry aged out (60 s without a poll) — say so rather than
                    // leaving a spinner that will never resolve.
                    setQueued(false);
                    setNote("Your queue spot expired. Join again to keep searching.");
                }
            })();
        }, LADDER_POLL_MS);
        return () => window.clearInterval(timer);
    }, [queued, duelActive, playerName, handleMatch]);

    const join = async () => {
        if (!canDuelLive()) { setNote("Ranked pet duels are live — you need a realtime connection."); return; }
        if (pets.length === 0) { setNote("Pick a pet to queue with."); return; }
        matchedRef.current = false;
        setNote(null);
        setWaitedSec(0);
        const state = await joinPetLadderQueue(playerName, level, elo);
        setQueued(state.inQueue);
        setSize(state.queueSize);
        if (!state.inQueue) setNote("Could not join the queue. Try again in a moment.");
    };

    const leave = async () => {
        setQueued(false);
        setNote(null);
        await leavePetLadderQueue(playerName);
    };

    if (duelActive) return null;

    return (
        <div className="summary-box" data-testid="pet-ladder-queue" style={{ padding: "0.9rem", marginBottom: "0.9rem" }}>
            <h3 className="pl-h" style={{ marginTop: 0 }}>⚔ Ranked queue</h3>
            <p className="hint" style={{ marginTop: 2 }}>
                Ranked pet duels are fought live — you and your opponent each command your own pet.
            </p>
            {queued ? (
                <>
                    <p style={{ margin: "8px 0 0", fontWeight: 700 }}>
                        Searching… {size > 1 ? `${size} in queue` : "you are first in line"}
                        {waitedSec >= 15 ? " · widening the skill range" : ""}
                    </p>
                    <div className="menu" style={{ marginTop: 8 }}>
                        <button className="danger-button" onClick={() => void leave()}>Leave queue</button>
                    </div>
                </>
            ) : (
                <div className="menu" style={{ marginTop: 8 }}>
                    <button className="admin-button" onClick={() => void join()} disabled={pets.length === 0}>
                        Find a match
                    </button>
                </div>
            )}
            {note && <p className="hint" style={{ marginTop: 6 }}>{note}</p>}
        </div>
    );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pet } from "../types/pet";
import { PetShowdownBattle } from "./PetShowdownBattle";
import { warmShowdownModels } from "../lib/pet-model-preload";
import type { ShowdownCommand, ShowdownTurnResult } from "../lib/pet-showdown-api";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";

/*
 * A watchable Showdown match — the client side of the replay doctrine.
 *
 * The server re-derives a decided fight into a ShowdownReplayScript (pre-fight
 * view, event log, post-fight view) and this component plays it through the
 * SAME battle component a live match uses, in spectator mode. One cinematic
 * layer for everything: a war duel you watch gets the identical cameras,
 * beats, weather sky and KO ritual as a fight you command. There is no second
 * playback engine to drift.
 *
 * The driver is one-shot: the spectator auto-submit fires once, receives the
 * ENTIRE script, and the battle component plays it through to the end event —
 * round banners, actions, the verdict. Subsequent auto-submits (there are none
 * in practice, since the script ends the match) would receive an empty turn.
 */
export function PetShowdownReplay({ script, playerPets, sharedImages = {}, onExit }: {
    script: ShowdownReplayScript;
    /** The viewer's roster, for model/art resolution of any pets they own.
     *  Pets that are not theirs resolve from the state view like AI enemies. */
    playerPets: Pet[];
    sharedImages?: Record<string, string>;
    onExit: () => void;
}) {
    // "Watch again" is a remount (key) plus an explicit serving-flag reset in
    // onRematch — never a render-time ref write, which the compiler forbids.
    const [runKey, setRunKey] = useState(0);
    const served = useRef(false);

    const submitTurn = useCallback(async (_commands: ShowdownCommand[]): Promise<ShowdownTurnResult> => {
        if (served.current) {
            // The script has already been handed over; there is nothing left.
            // (Unreachable in practice: the script's end event finishes the
            // match before a second command phase can open.)
            return { ok: true, events: [], state: script.finalState };
        }
        served.current = true;
        return { ok: true, events: script.events, state: script.finalState };
    }, [script]);

    // A defensive clone of the pre-fight view: the battle component seeds its
    // mutable display from this object, and a rewatch must start from the same
    // untouched snapshot. `runKey` remounts the child, so the clone only needs
    // to track the script itself.
    const initialState = useMemo(
        () => JSON.parse(JSON.stringify(script.initialState)) as ShowdownReplayScript["initialState"],
        [script],
    );

    /*
     * Warm both rosters before the first frame.
     *
     * This gate lives HERE rather than in the three screens that render a
     * replay (the ranked/ladder cinematics and the war record) because all
     * three hand over a finished script and mount straight into playback — and
     * an unwarmed model suspends against a null fallback, so a cold fighter is
     * not late, it is missing. One gate on the component every caller shares is
     * the only version of this that a fourth caller cannot forget.
     */
    // Gated on WHICH state was warmed rather than a boolean, so a new script
    // re-arms the gate by identity alone — no synchronous reset to false inside
    // the effect, which is both a lint error and a wasted render.
    const [warmedFor, setWarmedFor] = useState<object | null>(null);
    const warm = warmedFor === initialState;
    useEffect(() => {
        let cancelled = false;
        void warmShowdownModels(initialState, playerPets).then(() => {
            if (!cancelled) setWarmedFor(initialState);
        });
        return () => { cancelled = true; };
        // Keyed on the SCRIPT only. `playerPets` is read for art identity, and
        // a roster cannot meaningfully change mid-replay — while its array
        // identity churns on every parent render (PetLadder rebuilds it inline),
        // which would re-arm this warm-up continuously.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialState]);

    if (!warm) {
        // Styled inline deliberately: components in this repo do not import
        // stylesheets (screens own them), and this element is rendered under
        // three different screens whose sheets do not overlap.
        return (
            <div
                role="status"
                aria-live="polite"
                style={{
                    position: "fixed", inset: 0, zIndex: 1000000,
                    display: "grid", placeContent: "center", gap: "10px",
                    background: "radial-gradient(circle at 50% 40%, #101a2e, #05070e 70%)",
                    color: "#c9b98d", font: "600 12px/1.6 Inter, sans-serif",
                    letterSpacing: "0.22em", textTransform: "uppercase", textAlign: "center",
                }}
            >
                <span>Preparing the arena</span>
                <span style={{ color: "#5f6b80", fontSize: "10px", letterSpacing: "0.14em" }}>
                    Bringing both fighters to the field
                </span>
            </div>
        );
    }

    return (
        <PetShowdownBattle
            key={runKey}
            spectator
            initialState={initialState}
            playerPets={playerPets}
            sharedImages={sharedImages}
            submitTurn={submitTurn}
            onForfeit={onExit}
            onFinished={() => { /* verdict is already on the war record; nothing settles from a replay */ }}
            onExit={onExit}
            onRematch={() => { served.current = false; setRunKey((k) => k + 1); }}
        />
    );
}

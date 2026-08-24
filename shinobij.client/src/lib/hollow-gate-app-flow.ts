import { useRef, useState } from "react";
import { gameConfirm } from "../components/GameAlert";
import type { HollowGatePetFightRef } from "../components/HollowGatePetFight";
import type { Character, HollowGateShrineRun, HollowGateTile } from "../types/character";
import type { Screen } from "../types/core";
import { hollowGateHoundName, hollowHoundEncounterId } from "../../../shared/hollow-gate-contract";
import { applyAttunementToRun } from "./hollow-gate-attunement";
import type { HollowGateCombatSettleResult } from "./hollow-gate-combat-api";
// The procedural floor generator is loaded on demand — see
// ./hollow-gate-generator-loader. hollowGatePetEncounterSeed is a pure hash and
// stays eagerly available (it lives in ./hollow-gate-run).
import { loadHollowGateGenerator } from "./hollow-gate-generator-loader";
import { hollowGatePetEncounterSeed } from "./hollow-gate-run";
import type { HollowGatePveFightRef } from "./hollow-gate-pve";
import { hollowGateAlphaCinematicImage } from "./hollow-gate-presentation";
import {
    finalizeHollowGateRunEnd,
    reportHollowGateRunError,
} from "./hollow-gate-server";
import type { HiddenChamberState, HollowGateEventModal } from "./hollow-gate-tile";
import {
    hollowGateBossDisplayName,
    hollowGateRunMaxFloor,
} from "./hollow-gate-variant";
import { isPetOnExpedition } from "./pet";

type SetState<T> = (value: T | ((previous: T) => T)) => void;

/** The identity of the floor a descend was started from. */
export type HollowGateFloorRef = { runToken?: string; floor: number };

/**
 * True when `live` is still the very floor `from` was captured on.
 *
 * A descend generates the next floor behind an await, and anything can happen
 * during it: the player can Leave (which SETTLES the run token server-side),
 * hit Emergency Forfeit, or start a whole new run. Writing floor N+1 after any
 * of those resurrects a run the server considers finished — the mirror effect
 * persists it to character.hollowGateRun, and the next boot resumes a phantom
 * floor whose every step is rejected, with no way out but Emergency Forfeit.
 */
export function isSameHollowGateFloor(
    live: HollowGateShrineRun | null | undefined,
    from: HollowGateFloorRef,
): boolean {
    if (!live) return false;
    return live.runToken === from.runToken && live.floor === from.floor;
}

/**
 * The guarded functional update a completed descend commits with. Returns
 * `previous` UNCHANGED whenever the live run is no longer the floor the
 * descend started from, so a late write can never clobber live state.
 *
 * The carried-forward values come from the `from` snapshot, exactly as the
 * unguarded version used them — the board is locked for the duration of the
 * descend, so no step can have altered them in between.
 */
export function hollowGateDescendUpdate(
    previous: HollowGateShrineRun | null,
    from: HollowGateShrineRun,
    next: HollowGateShrineRun,
): HollowGateShrineRun | null {
    if (!isSameHollowGateFloor(previous, from)) return previous;
    return {
        ...next,
        keys: from.keys,
        torch: Math.min(10, from.torch + 4),
        entryCurrencies: from.entryCurrencies,
        runToken: from.runToken,
        serverSeed: from.serverSeed,
        augmentOffers: from.augmentOffers,
        chosenAugment: from.chosenAugment,
        secondWindArmed: from.secondWindArmed,
        earnedXp: from.earnedXp,
        earnedFragments: from.earnedFragments,
        earnedVeils: from.earnedVeils,
    };
}

export function useHollowGateAppFlow(params: {
    character: Character | null;
    run: HollowGateShrineRun | null;
    sharedImages: Record<string, string>;
    setCharacter: SetState<Character | null>;
    setRun: SetState<HollowGateShrineRun | null>;
    setEvent: SetState<HollowGateEventModal>;
    setHiddenChamber: SetState<HiddenChamberState>;
    /** The run-bound Showdown pet encounter, or null when none is open. */
    setPetFight: SetState<HollowGatePetFightRef | null>;
    setScreen: SetState<Screen>;
    clearRunState: (exit?: boolean) => void;
    clearLog: () => void;
    pushLog: (line: string) => void;
    buildRunSummary: () => string;
}) {
    const {
        character,
        run,
        sharedImages,
        setCharacter,
        setRun,
        setEvent,
        setHiddenChamber,
        setPetFight,
        setScreen,
        clearRunState,
        clearLog,
        pushLog,
        buildRunSummary,
    } = params;
    const [exitPending, setExitPending] = useState(false);
    // Locks the board while a post-boss descend is in flight. The next floor is
    // built behind an await, and floor N must not be walkable during it: a step
    // taken in that window is discarded by the write that lands after it, and an
    // in-flight step drain can stamp floor-N coordinates onto the floor-N+1
    // board. App threads this into moveHollowGatePlayer's early return.
    const [descending, setDescending] = useState(false);
    // Latest-run ref: `run` is captured per render, so an async continuation
    // cannot ask it whether the run is still the one it started from.
    const runRef = useRef(run);
    runRef.current = run;
    // Tracks a forfeit specifically, so abandon() can't double-fire while its
    // own forced leave is settling — without re-blocking it behind exitPending.
    const forfeitInFlight = useRef(false);

    const clearRunUi = () => {
        setRun(null);
        setEvent(null);
        setHiddenChamber(null);
        clearLog();
    };

    async function leave(opts?: { death?: boolean; force?: boolean }) {
        // `force` lets the Emergency Forfeit escape past an in-flight ordinary
        // leave; both settles hit the same run token, so the server decides.
        if ((exitPending && !opts?.force) || !run || !character) return;
        setExitPending(true);
        try {
            if (!run.runToken) {
                throw new Error("This Hollow Gate run has no valid server settlement token.");
            }
            await finalizeHollowGateRunEnd({
                run,
                outcome: opts?.death ? "death" : "extract",
                character,
                setCharacter,
            });
            clearRunUi();
            setScreen(opts?.death ? "hospital" : "worldMap");
        } catch (error) {
            reportHollowGateRunError(
                error,
                "The Hollow Gate could not settle this run. Your run remains intact; retry when the connection is stable.",
                () => clearRunState(true),
            );
        } finally {
            setExitPending(false);
        }
    }

    async function abandon() {
        if (!run || forfeitInFlight.current) return;
        const confirmed = await gameConfirm(
            "Forfeit this Hollow Gate run?\n\nThis emergency exit works even if an encounter is broken. The run ends as a defeat, unbanked loot takes the normal death penalty, and you are sent to the hospital.",
            { title: "Emergency Forfeit", confirmLabel: "Forfeit Run" },
        );
        if (!confirmed) return;
        forfeitInFlight.current = true;
        try {
            await leave({ death: true, force: true });
        } finally {
            forfeitInFlight.current = false;
        }
    }

    /*
     * A sealed pet duel now runs on the SHOWDOWN engine, bound to this run.
     *
     * It used to hand the Pet Arena screen a hand-built Hound and a client seed;
     * the arena minted a battle-start token and fought the legacy sim. The
     * server has accepted a run-bound Showdown bout — with the identical
     * `hg-pet-result` receipt — since the Gate port landed, but nothing called
     * it. This is that caller, and it stays on the shrine screen rather than
     * detouring through the arena, because the encounter belongs to the run.
     *
     * Nothing about the Hound is decided here any more. `houndId` is only the
     * encounter's IDENTITY (its shape is checked server-side); the creature
     * itself is built by the server from the run's own binding.
     */
    function launchPetFight(fight: HollowGatePveFightRef) {
        if (!character) return;
        const token = run?.runToken ?? character.hollowGateRun?.runToken;
        const activePet = (character.pets ?? []).find((pet) => pet.id === character.activePetId);
        if (!token || !activePet || !activePet.unlockedForPve || isPetOnExpedition(activePet)) {
            window.alert("The active pet for this sealed duel is unavailable. Use Emergency Forfeit if the pet cannot be restored.");
            return;
        }
        pushLog(`[Pet Duel] ${activePet.name} enters the seal against ${hollowGateHoundName(fight.floor, fight.kind)}.`);
        setPetFight({
            token,
            runId: fight.runId,
            nodeId: fight.nodeId,
            floor: fight.floor,
            kind: fight.kind,
            houndId: hollowHoundEncounterId(hollowGatePetEncounterSeed(fight.runId)),
        });
    }

    function markResolvedTile(tiles: HollowGateTile[], nodeId?: string): HollowGateTile[] {
        const match = /^floor:\d+:tile:(\d+)$/.exec(nodeId ?? "");
        const index = match ? Number(match[1]) : -1;
        if (index < 0 || index >= tiles.length) return tiles;
        const next = tiles.slice();
        next[index] = { ...next[index], resolved: true };
        return next;
    }

    /**
     * Build and commit the floor below `from` after its boss has fallen.
     *
     * Kept out of onBattleWin so the failure path can offer a real retry: the
     * boss tile is already marked resolved, so without this there is no way back
     * to the staircase and a dropped chunk would strand the run on a cleared
     * floor with nothing but Emergency Forfeit.
     */
    async function descendAfterBoss(from: HollowGateShrineRun) {
        setDescending(true);
        try {
            const { generateHollowGateShrineRun } = await loadHollowGateGenerator();
            const generated = generateHollowGateShrineRun(from.floor + 1, from.variant, from.serverSeed);
            const next = character ? applyAttunementToRun(generated, character, false) : generated;
            if (!isSameHollowGateFloor(runRef.current, from)) {
                // Left / forfeited / already advanced while this was building.
                pushLog(`The stair below Floor ${from.floor} closes — that descent no longer belongs to this run.`);
                return;
            }
            setRun((previous) => hollowGateDescendUpdate(previous, from, next));
            pushLog(`You descend to Floor ${next.floor}. Torch flares: +4.`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "the connection dropped";
            pushLog(`The stair below Floor ${from.floor} will not open: ${detail}`);
            if (!isSameHollowGateFloor(runRef.current, from)) return;
            setEvent({
                title: "The Stair Will Not Open",
                body: `The shrine cannot draw the floor below ${from.floor}.\n\n${detail}\n\nYour run and its haul are intact. Try the stair again, or hold position and leave to bank what you carry.`,
                kind: "descend",
                choices: [
                    { label: "Try the Stair Again", tone: "primary", onSelect: () => { setEvent(null); void descendAfterBoss(from); } },
                    { label: "Hold Position", onSelect: () => setEvent(null) },
                ],
            });
        } finally {
            setDescending(false);
        }
    }
    function onBattleWin(resolved?: { isBoss?: boolean; isAmbush?: boolean; nodeId?: string }) {
        if (!run) return;
        const isBoss = Boolean(resolved?.isBoss);
        const isAmbush = Boolean(resolved?.isAmbush);
        if (isBoss) {
            const tiles = markResolvedTile(
                run.tiles.map((tile) => tile.kind === "boss" ? { ...tile, resolved: true } : tile),
                resolved?.nodeId,
            );
            const isFinalFloor = run.floor >= hollowGateRunMaxFloor(run);
            setRun({ ...run, activeCombat: undefined, tiles, completed: isFinalFloor, threat: 0 });
            pushLog(`${hollowGateBossDisplayName(run)} falls on Floor ${run.floor}. ${isFinalFloor ? "The shrine is cleared!" : "A staircase opens below."}`);
            if (isFinalFloor) {
                setEvent({
                    title: run.variant?.label ? `${run.variant.label} Cleared` : "Hollow Gate Shrine Cleared",
                    eyebrow: "ALPHA SEAL BROKEN · SHRINE RECLAIMED",
                    presentation: "boss-victory",
                    image: hollowGateAlphaCinematicImage(sharedImages),
                    body: `The Alpha's howl breaks into a thousand violet sparks. For the first time in generations, clean moonlight reaches the shrine floor.\n\nYou did not destroy its old oath—you released it.\n\n— RUN SUMMARY —\n${buildRunSummary()}`,
                    kind: "boss",
                    choices: [{
                        label: "Take Final Rewards + Leave",
                        tone: "primary",
                        onSelect: () => {
                            setEvent(null);
                            void leave();
                        },
                    }],
                });
                return;
            }
            // The floor generator is loaded on demand (see
            // ./hollow-gate-generator-loader). It is warmed the moment the shrine
            // screen mounts, so by the time a boss falls the module is normally
            // already resident and this resolves on a microtask.
            //
            // "Normally" is not "always", so the descend below is fully guarded:
            // the board is LOCKED for its duration (setDescending), the commit is a
            // guarded functional update that drops a stale floor rather than
            // overwriting live state, and a chunk failure is reported with a
            // retry instead of leaving the player on a cleared floor in silence.
            void descendAfterBoss(run);
            return;
        }
        setRun({
            ...run,
            activeCombat: undefined,
            tiles: markResolvedTile(run.tiles, resolved?.nodeId),
            threat: 0,
        });
        pushLog(isAmbush
            ? "The ambush ends. Threat dissipates — but the Torch of Reiki keeps burning down. Find a chest or shrine to rekindle it."
            : "Hollow Hound defeated. Threat dissipates — the Torch of Reiki, though, keeps burning down.");
    }

    function onPetBattleEnd(result: HollowGateCombatSettleResult, gate: HollowGatePetFightRef) {
        setPetFight(null);
        if (result.won) {
            onBattleWin({
                isBoss: gate.kind === "boss",
                isAmbush: gate.kind === "ambush",
                nodeId: gate.nodeId,
            });
            pushLog(`${hollowGateHoundName(gate.floor, gate.kind)} is driven back by your pet. The sealed path opens.`);
            return;
        }
        setRun((previous) => {
            const authoritative = result.character?.hollowGateRun;
            const current = authoritative ?? previous;
            return current ? { ...current, activeCombat: undefined, threat: 0 } : null;
        });
        const recoil = Math.max(1, Math.floor((result.character?.maxHp ?? character?.maxHp ?? 1) * 0.20));
        pushLog(`The Hollow Hound wins the pet duel. ${recoil} HP recoils through the seal; the encounter remains unresolved.`);
    }

    return {
        exitPending,
        descending,
        leave,
        abandon,
        launchPetFight,
        onBattleWin,
        onPetBattleEnd,
    };
}

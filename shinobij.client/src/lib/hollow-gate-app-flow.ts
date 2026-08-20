import { useRef, useState } from "react";
import { gameConfirm } from "../components/GameAlert";
import type { HollowGatePetFightRef } from "../components/HollowGatePetFight";
import type { Character, HollowGateShrineRun, HollowGateTile } from "../types/character";
import type { Screen } from "../types/core";
import { hollowGateHoundName, hollowHoundEncounterId } from "../../../shared/hollow-gate-contract";
import { applyAttunementToRun } from "./hollow-gate-attunement";
import type { HollowGateCombatSettleResult } from "./hollow-gate-combat-api";
import {
    generateHollowGateShrineRun,
    hollowGatePetEncounterSeed,
} from "./hollow-gate-dungeon";
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
            const generated = generateHollowGateShrineRun(run.floor + 1, run.variant, run.serverSeed);
            const next = character ? applyAttunementToRun(generated, character, false) : generated;
            setRun({
                ...next,
                keys: run.keys,
                torch: Math.min(10, run.torch + 4),
                entryCurrencies: run.entryCurrencies,
                runToken: run.runToken,
                serverSeed: run.serverSeed,
                augmentOffers: run.augmentOffers,
                chosenAugment: run.chosenAugment,
                secondWindArmed: run.secondWindArmed,
                earnedXp: run.earnedXp,
                earnedFragments: run.earnedFragments,
                earnedVeils: run.earnedVeils,
            });
            pushLog(`You descend to Floor ${next.floor}. Torch flares: +4.`);
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
        leave,
        abandon,
        launchPetFight,
        onBattleWin,
        onPetBattleEnd,
    };
}

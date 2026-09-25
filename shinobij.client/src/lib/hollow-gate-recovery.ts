import type { Dispatch, SetStateAction } from "react";
import { hollowGateFlavorFor } from "../data/hollow-gate-flavor";
import { weatherForBiome } from "../data/sectors";
import type {
    Character,
    HollowGateAugmentOffer,
    HollowGateShrineRun,
    HollowGateTile,
    HollowGateTileKind,
    HollowGateVariant,
} from "../types/character";
import type { Screen, WeatherType } from "../types/core";
import { applyAttunementToRun } from "./hollow-gate-attunement";
import { loadHollowGateGenerator } from "./hollow-gate-generator-loader";
import { resumeHollowGateServerRun } from "./hollow-gate-server";
import type { HiddenChamberState, HollowGateEventModal } from "./hollow-gate-tile";
import { computeHollowGateVisible } from "./hollow-gate-visibility";

/*
 * Hollow Gate — rebuild a live run's board after a reload.
 *
 * The drawn board never reaches the save. The autosave does not run inside the
 * shrine, and a real save is too large for the unload save, so the save holds
 * only the server's board-less projection of the run. That projection cannot
 * be drawn (normalize-character drops it), so a reload used to land on the
 * village, and re-entering rebuilt floor 1 from the start marker: the augment
 * picker again, a forgotten board, and no way back to a deeper floor.
 *
 * The server holds everything the board needs (api/hollow-gate/resume): the
 * floor and its sealed manifest, the position, resources, chosen augment,
 * resolved encounters and events, the tiles already stepped on, and any open
 * fight with its mode. The floor itself is regenerated from the run's seed,
 * exactly as the descend does, and checked against the sealed manifest; a
 * floor the current generator no longer reproduces is rebuilt from the
 * manifest instead. Nothing is trusted from a client-saved board.
 */

type SetState<T> = Dispatch<SetStateAction<T>>;

export type HollowGateSealedManifest = {
    floor: number;
    width: number;
    height: number;
    spawn: { x: number; y: number };
    walkable: string;
    nodes: Record<string, string>;
};

/** api/hollow-gate/resume's view of one live run, limited to its current floor. */
export type HollowGateResumeState = {
    token: string;
    seed: string;
    floorDepth: number;
    floor: number;
    variantId?: string;
    floorWidth?: number;
    floorHeight?: number;
    bossProfileId?: string;
    bossName?: string;
    chosenAugmentId: string | null;
    augmentOffers: HollowGateAugmentOffer[];
    position: { x: number; y: number } | null;
    keys: number;
    torch: number;
    threat: number;
    wardSteps: number;
    divinerUsed: boolean;
    secondWindArmed: boolean;
    resolvedEncounterIds: string[];
    resolvedEventIds: string[];
    visited: string | null;
    manifest: HollowGateSealedManifest | null;
    activeCombat: HollowGateShrineRun["activeCombat"] | null;
    pendingAmbush: { nodeId: string; kind: "ambush" | "boss" | "card" } | null;
    entryCurrencies: Partial<Record<string, number>>;
};

export type HollowGateResumeResult =
    | { kind: "live"; state: HollowGateResumeState }
    | { kind: "gone" }
    | { kind: "error"; error: string };

export async function fetchHollowGateResume(playerName: string): Promise<HollowGateResumeResult> {
    try {
        const response = await fetch("/api/hollow-gate/resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; live?: boolean; run?: HollowGateResumeState; error?: string };
        if (!response.ok || !data.ok) return { kind: "error", error: data.error || `Hollow Gate resume failed (${response.status}).` };
        return data.live && data.run ? { kind: "live", state: data.run } : { kind: "gone" };
    } catch {
        return { kind: "error", error: "The Hollow Gate resume service is unreachable." };
    }
}

/** The variant a run was generated with. Generation reads only its floor count
 *  and dimensions, so these rebuild the same floor the run started with. */
export function hollowGateResumeVariant(state: HollowGateResumeState): HollowGateVariant | undefined {
    if (!state.variantId) return undefined;
    return {
        id: state.variantId,
        maxFloor: state.floorDepth,
        width: state.floorWidth,
        height: state.floorHeight,
        bossAiId: state.bossProfileId,
        bossName: state.bossName,
    };
}

/** The walkable mask and node kinds floor-seal derives from a board. */
export function hollowGateBoardManifest(tiles: HollowGateTile[]): { walkable: string; nodes: Record<string, string> } {
    const nodes: Record<string, string> = {};
    let walkable = "";
    tiles.forEach((tile, index) => {
        const kind = String(tile?.kind ?? "");
        walkable += kind !== "wall" && tile?.terrain !== "wall" ? "1" : "0";
        if (kind !== "empty" && kind !== "wall") nodes[String(index)] = kind;
    });
    return { walkable, nodes };
}

/** True when a freshly generated board is the one the server sealed. */
export function hollowGateBoardMatchesManifest(run: HollowGateShrineRun, manifest: HollowGateSealedManifest): boolean {
    if (run.width !== manifest.width || run.height !== manifest.height || run.tiles.length !== manifest.width * manifest.height) return false;
    if (run.playerX !== manifest.spawn.x || run.playerY !== manifest.spawn.y) return false;
    const derived = hollowGateBoardManifest(run.tiles);
    if (derived.walkable !== manifest.walkable) return false;
    const keys = Object.keys(derived.nodes);
    return keys.length === Object.keys(manifest.nodes).length && keys.every((key) => manifest.nodes[key] === derived.nodes[key]);
}

/**
 * A playable board from the sealed manifest alone, for a floor the current
 * generator no longer reproduces. Every open cell is corridor, so visibility
 * still floods along it; the rooms' look is lost, the gameplay is not, because
 * every endpoint judges the run against this same manifest.
 */
export function hollowGateBoardFromManifest(manifest: HollowGateSealedManifest): Pick<HollowGateShrineRun, "width" | "height" | "tiles" | "playerX" | "playerY"> {
    const tiles = Array.from({ length: manifest.width * manifest.height }, (_, index): HollowGateTile => (
        manifest.walkable[index] === "1"
            ? { kind: (manifest.nodes[String(index)] ?? "empty") as HollowGateTileKind, terrain: "corridor_floor", roomId: null, revealed: false, resolved: false }
            : { kind: "wall", terrain: "wall", roomId: null, revealed: false, resolved: false }
    ));
    return { width: manifest.width, height: manifest.height, tiles, playerX: manifest.spawn.x, playerY: manifest.spawn.y };
}

/** The board tile a resolved encounter or event id names on `floor`, or -1. */
export function hollowGateResolvedTileIndex(id: string, floor: number): number {
    const match = /^(?:event:)?(\d+):[a-z-]+:floor:(\d+):tile:(\d+)$/.exec(id);
    return match && Number(match[1]) === floor && Number(match[2]) === floor ? Number(match[3]) : -1;
}

/**
 * The live run rebuilt onto `generated`, the floor regenerated from the run's
 * seed. Pure: the caller loads the generator.
 */
export function rebuildHollowGateRun(
    state: HollowGateResumeState,
    generated: HollowGateShrineRun,
    variant?: HollowGateVariant,
): HollowGateShrineRun {
    const board: HollowGateShrineRun = !state.manifest || hollowGateBoardMatchesManifest(generated, state.manifest)
        ? generated
        : { ...generated, ...hollowGateBoardFromManifest(state.manifest), roomThemes: undefined, wingThemes: undefined };
    const width = board.width;
    const tiles = board.tiles.slice();
    const onBoard = (index: number) => Number.isInteger(index) && index >= 0 && index < tiles.length;

    for (const id of [...state.resolvedEncounterIds, ...state.resolvedEventIds]) {
        const index = hollowGateResolvedTileIndex(id, state.floor);
        if (onBoard(index)) tiles[index] = { ...tiles[index], resolved: true, revealed: true };
    }

    const spawn = state.manifest?.spawn ?? { x: board.playerX, y: board.playerY };
    const position = state.position ?? spawn;
    const stepped = new Set<number>([position.y * width + position.x]);
    if (state.visited && state.visited.length === tiles.length) {
        for (let index = 0; index < state.visited.length; index += 1) if (state.visited[index] === "1") stepped.add(index);
    }
    for (const index of stepped) {
        if (!onBoard(index)) continue;
        tiles[index] = { ...tiles[index], revealed: true, flavor: tiles[index].flavor ?? hollowGateFlavorFor(tiles[index].kind) };
    }

    // Map memory: everything the room-flood lit from any tile stood on.
    const walked: HollowGateShrineRun = { ...board, tiles, playerX: position.x, playerY: position.y };
    const seen = new Set<number>();
    for (const index of stepped) {
        if (!onBoard(index)) continue;
        for (const lit of computeHollowGateVisible({ ...walked, playerX: index % width, playerY: Math.floor(index / width) })) seen.add(lit);
    }
    const remembered = tiles.map((tile, index) => (seen.has(index) && !tile.seen ? { ...tile, seen: true } : tile));

    // Wing gating: a player can enter only one detour, which seals the others.
    let wings: Pick<HollowGateShrineRun, "committedDetour" | "sealedWings"> = {};
    const themes = board.wingThemes;
    if (themes) {
        const detour = [...stepped].map((index) => remembered[index]?.wing)
            .find((wing): wing is number => wing !== undefined && themes[wing] !== "trial");
        wings = detour === undefined
            ? { committedDetour: null, sealedWings: [] }
            : { committedDetour: detour, sealedWings: Object.keys(themes).map(Number).filter((wing) => wing !== detour && themes[wing] !== "trial") };
    }

    return {
        ...walked,
        ...wings,
        tiles: state.divinerUsed ? remembered.map((tile) => (tile.revealed ? tile : { ...tile, revealed: true })) : remembered,
        floor: state.floor,
        keys: state.keys,
        torch: state.torch,
        threat: state.threat,
        wardSteps: state.wardSteps,
        secondWindArmed: state.secondWindArmed,
        diviner: state.divinerUsed || undefined,
        completed: false,
        runToken: state.token,
        serverSeed: state.seed,
        augmentOffers: state.augmentOffers,
        chosenAugment: state.augmentOffers.find((offer) => offer.id === state.chosenAugmentId) ?? null,
        entryCurrencies: state.entryCurrencies,
        activeCombat: state.activeCombat ?? undefined,
        ...(variant ? { variant } : {}),
    };
}

export type HollowGateRecoveryParams = {
    character: Character;
    setHollowGateRun: SetState<HollowGateShrineRun | null>;
    setHollowGateLog: SetState<string[]>;
    setHollowGateEvent: SetState<HollowGateEventModal>;
    setHollowGateHiddenChamber: SetState<HiddenChamberState>;
    setCharacter: SetState<Character | null>;
    setCurrentBiome: (value: "shadow") => void;
    setCurrentWeather: (value: WeatherType) => void;
    setScreen: (value: Screen) => void;
    pushHollowGateLog: (line: string) => void;
};

/**
 * Rebuild the live run from the server and return the player to the shrine.
 * "gone" means the save's run has ended; "error" means it could not be read or
 * drawn right now. Neither starts a run or spends anything.
 */
export async function recoverHollowGateRun(params: HollowGateRecoveryParams): Promise<"recovered" | "gone" | "error"> {
    const resumed = await fetchHollowGateResume(params.character.name);
    if (resumed.kind !== "live") return resumed.kind;
    const state = resumed.state;
    const variant = hollowGateResumeVariant(state);
    let run: HollowGateShrineRun;
    try {
        const { generateHollowGateShrineRun } = await loadHollowGateGenerator();
        run = applyAttunementToRun(rebuildHollowGateRun(state, generateHollowGateShrineRun(state.floor, variant, state.seed), variant), params.character, false);
    } catch {
        return "error";
    }
    params.setHollowGateRun(run);
    params.setHollowGateLog(["You return to your unfinished run. The floor, your path and every cleared tile are as you left them."]);
    params.setHollowGateEvent(null);
    params.setHollowGateHiddenChamber(null);
    params.setCharacter((previous) => (previous ? { ...previous, hollowGateRun: run } : previous));
    params.setCurrentBiome("shadow");
    params.setCurrentWeather(weatherForBiome("shadow"));
    params.setScreen("hollowGateShrine");
    // An augment still unchosen (a reload during the pick) is offered again.
    resumeHollowGateServerRun({
        playerName: params.character.name,
        run,
        setRun: params.setHollowGateRun,
        setCharacter: params.setCharacter,
        setEvent: params.setHollowGateEvent,
        pushLog: params.pushHollowGateLog,
    });
    return "recovered";
}

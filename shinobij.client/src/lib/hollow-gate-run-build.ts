import type { Character, HollowGateShrineRun, HollowGateVariant } from "../types/character";
import { applyAttunementToRun } from "./hollow-gate-attunement";
// The procedural floor generator is loaded on demand — see
// ./hollow-gate-generator-loader for why that costs nothing here (every caller
// already sits behind the /hollow-gate/start round-trip).
import { loadHollowGateGenerator } from "./hollow-gate-generator-loader";
import { snapshotHollowGateCurrencies } from "./hollow-gate-run";
import type { HollowGateStartResult } from "./hollow-gate-server";

/**
 * Shown when the first floor cannot be built after the server has already
 * started the run — i.e. after the Hollow Gate Key was debited. The key is NOT
 * lost: the start is durable and replays from character.lastHollowGateStart,
 * so re-entering the shrine recovers this exact run without spending another.
 */
export const HOLLOW_GATE_FLOOR_LOAD_FAILED =
    "The Hollow Gate opened, but its first floor could not be drawn — the connection dropped while loading it. Your key was NOT lost: re-enter the shrine to recover this run (it replays the same start request rather than spending another key).";

/**
 * Turn a server start response into the local run state.
 *
 * Moved verbatim out of App.tsx (2026-08-23): it closes over nothing App owns,
 * and App.tsx is on a line-budget ratchet. The only change is that the callers
 * now handle its rejection — see HOLLOW_GATE_FLOOR_LOAD_FAILED.
 */
export async function buildHollowGateRunFromStart(
    start: HollowGateStartResult,
    requestedVariant: HollowGateVariant | undefined,
    baseCharacter: Character,
): Promise<HollowGateShrineRun> {
    const { generateHollowGateShrineRun } = await loadHollowGateGenerator();
    const sealedVariant: HollowGateVariant | undefined = start.variantId ? {
        ...(requestedVariant ?? { id: start.variantId }),
        id: start.variantId,
        maxFloor: start.floorDepth,
        width: start.floorWidth,
        height: start.floorHeight,
        bossAiId: start.bossProfileId,
        bossName: start.bossName,
    } : undefined;
    const generated = applyAttunementToRun({
        ...generateHollowGateShrineRun(1, sealedVariant, start.seed),
        entryCurrencies: snapshotHollowGateCurrencies(baseCharacter),
    }, baseCharacter, true);
    const projection = start.character?.hollowGateRun;
    const chosenAugment = start.augmentOffers?.find((offer) => offer.id === start.chosenAugmentId);
    return {
        ...generated,
        runToken: start.token ?? undefined,
        serverSeed: start.seed,
        augmentOffers: start.augmentOffers ?? [],
        ...(chosenAugment ? { chosenAugment } : {}),
        entryCurrencies: projection?.entryCurrencies ?? generated.entryCurrencies,
        keys: projection?.keys ?? generated.keys,
        torch: projection?.torch ?? generated.torch,
        threat: projection?.threat ?? generated.threat,
        wardSteps: projection?.wardSteps ?? generated.wardSteps,
    };
}

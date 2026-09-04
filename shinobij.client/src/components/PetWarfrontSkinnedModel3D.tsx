import { Suspense, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Pet } from "../types/pet";
import { petCombatModel } from "../lib/pet-3d-models";
import { preloadPetColiseumModels } from "../lib/pet-model-preload";
import {
    warfrontPetLodEnabled,
    warfrontPetLodEntry,
    warfrontPetModelConfig,
} from "../lib/pet-warfront-model-lod";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { PetModel3D, type PetModelFrame } from "./PetModel3D";
import type {
    WarfrontSkinnedMetrics,
    WarfrontSkinnedModelComponent,
} from "./PetWarfrontRiteStage3D";

/** This module is an intentional async boundary. Nothing in it may be imported
 * by the default exact-impostor scene except through `import()`: PetModel3D,
 * Drei's GLTF loader, meshopt, and the 159-entry LOD manifest belong here. */
export const WARFRONT_SKINNED_RIG_CHUNK = true;

function ModelReadySignal({ onReady }: { onReady: () => void }) {
    const paintedFrames = useRef(0);
    const reported = useRef(false);
    useFrame(() => {
        if (reported.current || ++paintedFrames.current < 2) return;
        reported.current = true;
        onReady();
    });
    return null;
}

export const PetWarfrontSkinnedModel3D: WarfrontSkinnedModelComponent = ({ pet, frame, quality, onReady }) => {
    const config = useMemo(() => warfrontPetModelConfig(petCombatModel(pet)), [pet]);
    if (!config) return null;
    return (
        <Suspense fallback={null}>
            <PetModel3D
                config={config}
                frame={frame as MutableRefObject<PetModelFrame>}
                element={pet.element}
                surfaceTreatment={petModelVariantSurface(pet)}
                quality={quality}
                silhouette="surface-ink"
            />
            <ModelReadySignal onReady={onReady} />
        </Suspense>
    );
};

export async function preloadWarfrontSkinnedPetModels(pets: readonly Pet[]): Promise<void> {
    await preloadPetColiseumModels(pets, warfrontPetModelConfig);
}

export function warfrontSkinnedMetrics(pets: readonly Pet[]): WarfrontSkinnedMetrics {
    const lodEnabled = warfrontPetLodEnabled();
    let mappedActors = 0;
    let missingActors = 0;
    let sourceTriangles = 0;
    let selectedTriangles = 0;
    for (const pet of pets) {
        const source = petCombatModel(pet);
        const entry = source ? warfrontPetLodEntry(source.url) : null;
        if (!entry) {
            missingActors += 1;
            continue;
        }
        mappedActors += 1;
        sourceTriangles += entry.sourceTriangles;
        selectedTriangles += lodEnabled ? entry.lodTriangles : entry.sourceTriangles;
    }
    return { lodEnabled, mappedActors, missingActors, sourceTriangles, selectedTriangles };
}

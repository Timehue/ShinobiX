import { Suspense, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { PetModelBoundary } from "./PetModelBoundary";
import { supportsPetWebGl2 } from "../lib/pet-webgl-capability";

const Stage = lazyWithRetry(() => import("./PetYardModelStage").then(module => ({ default: module.PetYardModelStage })));

/** The model chunk is requested when a preview opens. */
export function PetPreviewStage({ fallback, ...props }: ComponentProps<typeof Stage> & { fallback: ReactNode }) {
    const [supported] = useState(() => supportsPetWebGl2());
    const { onFail } = props;
    useEffect(() => { if (!supported) onFail(); }, [supported, onFail]);
    if (!supported) return fallback;
    return <PetModelBoundary onFail={props.onFail}>
        <Suspense fallback={fallback}><Stage {...props} /></Suspense>
    </PetModelBoundary>;
}

/*
 * Per-device pet-arena render flags. The HD-2D coliseum is now THE arena
 * renderer for every pet-battle call site (Pet Arena, Hollow Gate dungeon duels)
 * — there is no longer a classic-battlefield toggle, so the only knobs left here
 * are the optional postprocessing/cutscene preferences below.
 */

/*
 * Experimental BLOOM (HDR glow) postprocessing flag for the HD-2D coliseum/arena
 * Canvases. When ON, an EffectComposer + threshold Bloom pass makes the bright,
 * additive signature / ultimate / KO effects GLOW so big moves read bigger; basic
 * hits stay below the luminance threshold and don't bloom. DEFAULT OFF: bloom adds
 * a fullscreen render pass (a real mobile/low-end cost) and needs a visual + perf
 * review before it can be a default — and on a TRANSPARENT canvas (the arena
 * composites over a DOM backdrop) it must be eyeballed for alpha correctness.
 * AUTO default: ON for desktop (fine pointer), OFF on touch/mobile to spare the
 * extra fullscreen pass. Force either way: localStorage.setItem("petBloom.v1","1"|"0").
 * Per-device persisted.
 */
const BLOOM_KEY = "petBloom.v1";

export function petBloomEnabled(): boolean {
    try {
        const v = localStorage.getItem(BLOOM_KEY);
        if (v === "1") return true;
        if (v === "0") return false;
        // Auto: glow on real-pointer desktops; skip the pass on touch/mobile for perf.
        return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    } catch { return false; }
}

export function setPetBloomEnabled(on: boolean): void {
    try { localStorage.setItem(BLOOM_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Pet EVOLUTION cutscene flag (the Digimon-style reveal — see
 * docs/pet-starter-evolution-plan.md §4). When ON, evolving a starter in the Pet
 * Yard plays a short cinematic (old name → tube of light + silhouette morph →
 * burst → new name → 360° hero spin) before returning to the yard. The
 * evolution itself is server-authoritative and already persisted before the
 * cutscene plays, so it is purely celebratory and always skippable — flipping
 * this OFF just replaces it with the inline "Evolved into X!" toast. DEFAULT ON.
 * Per-device persisted.
 */
const EVOLVE_CUTSCENE_KEY = "petEvolveCutscene.v1";

export function petEvolveCutsceneEnabled(): boolean {
    try { return localStorage.getItem(EVOLVE_CUTSCENE_KEY) !== "0"; } catch { return true; }
}

export function setPetEvolveCutsceneEnabled(on: boolean): void {
    try { localStorage.setItem(EVOLVE_CUTSCENE_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

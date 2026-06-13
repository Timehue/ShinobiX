/*
 * Cinematic-arena (HD-2D coliseum) flag — shared by every pet-battle call site
 * (Pet Arena, Hollow Gate dungeon duels) so the choice is consistent.
 *
 * Defaults ON. The classic DOM battlefield (PetArenaBattlefield) is kept fully
 * intact as the fallback: any player can flip back with the in-arena toggle,
 * and turning the default off again is this one constant. Per-device persisted.
 */
const KEY = "petColiseum.v1";

export function petColiseumEnabled(): boolean {
    try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setPetColiseumEnabled(on: boolean): void {
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Experimental CONTINUOUS-DUEL renderer flag (the combat redesign — see
 * docs/pet-combat-redesign-plan.md). When ON (and the cinematic arena is on too)
 * the arena PREVIEWS the new real-time duel engine (runPetDuel / runPetPartyDuel)
 * for the visuals only — the actual battle outcome + rewards still come from the
 * shipped round engine, so this is a pure look-and-feel preview with no
 * gameplay/ranked impact. DEFAULT OFF until the feel is approved (Phase C) and
 * the balance pass lands (Phase D). Per-device persisted.
 */
const DUEL_KEY = "petDuel.v1";

export function petDuelEnabled(): boolean {
    try { return localStorage.getItem(DUEL_KEY) === "1"; } catch { return false; }
}

export function setPetDuelEnabled(on: boolean): void {
    try { localStorage.setItem(DUEL_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Experimental BLOOM (HDR glow) postprocessing flag for the HD-2D coliseum/arena
 * Canvases. When ON, an EffectComposer + threshold Bloom pass makes the bright,
 * additive signature / ultimate / KO effects GLOW so big moves read bigger; basic
 * hits stay below the luminance threshold and don't bloom. DEFAULT OFF: bloom adds
 * a fullscreen render pass (a real mobile/low-end cost) and needs a visual + perf
 * review before it can be a default — and on a TRANSPARENT canvas (the arena
 * composites over a DOM backdrop) it must be eyeballed for alpha correctness.
 * Per-device persisted. Toggle in the console: localStorage.setItem("petBloom.v1","1").
 */
const BLOOM_KEY = "petBloom.v1";

export function petBloomEnabled(): boolean {
    try { return localStorage.getItem(BLOOM_KEY) === "1"; } catch { return false; }
}

export function setPetBloomEnabled(on: boolean): void {
    try { localStorage.setItem(BLOOM_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

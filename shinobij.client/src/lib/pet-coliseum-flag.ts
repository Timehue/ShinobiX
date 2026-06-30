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

/*
 * Pet move ACCURACY / miss-chance flag. Pet moves carry an authored accuracy
 * (pet-moves.ts KIND_SPECS: 85–95 for offensive/control kinds, 100 for support)
 * that the battle engines historically never rolled against — so moves never
 * missed. When ON, the engines roll `rng() < accuracy/100` when a jutsu is cast;
 * a miss consumes the turn with no effect. DEFAULT OFF: this is a balance change
 * that wants playtesting/tuning before it ships, and it must be rolled out to
 * every pet engine before it's flipped on. Per-device persisted; flip with
 * localStorage.setItem("petAccuracy.v1","1"). Passed INTO the sims as a param so
 * the deterministic engines stay pure/testable.
 */
const PET_ACCURACY_KEY = "petAccuracy.v1";

export function petAccuracyEnabled(): boolean {
    try { return localStorage.getItem(PET_ACCURACY_KEY) === "1"; } catch { return false; }
}

export function setPetAccuracyEnabled(on: boolean): void {
    try { localStorage.setItem(PET_ACCURACY_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Account-level RANKED PET challenge flag. The dormant System-B path
 * (api/pet/ranked-start + the ranked branch of api/pet/battle-result, which
 * settles both players' `petRankedRating`) is fully built on the accept/resolve
 * side, but the SEND button (challengePlayer(opponent, "rankedPet")) was never
 * wired. When ON, a "Ranked Pet Duel" send button appears in the Arena player
 * list. DEFAULT OFF: this direct-challenge mode has had no two-client testing and
 * overlaps the already-live Pet Ladder, so it ships dark until a controlled test.
 * (The Pet Ladder — Arena → Pet Battles tab — is the primary, live pet-ranked
 * experience and is unaffected by this flag.) Per-device persisted; flip with
 * localStorage.setItem("petRankedChallenge.v1","1").
 */
const PET_RANKED_CHALLENGE_KEY = "petRankedChallenge.v1";

export function petRankedChallengeEnabled(): boolean {
    try { return localStorage.getItem(PET_RANKED_CHALLENGE_KEY) === "1"; } catch { return false; }
}

export function setPetRankedChallengeEnabled(on: boolean): void {
    try { localStorage.setItem(PET_RANKED_CHALLENGE_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Authoritative PvE combat engine flag — the kill-switch for the pet-combat
 * redesign (docs/pet-combat-redesign-plan.md). When ON, NON-RANKED pet battles
 * (Pet Arena 1v1 + 2v2, Hollow Gate / dungeon duels, clan-war pet2v2) resolve
 * with the new CONTINUOUS duel engine (lib/pet-duel-sim.ts) rendered by
 * PetColiseumDuel — pets approach, hold spacing, kite, trade homing elemental
 * projectiles, dodge, and unleash ultimates. When OFF, those fights fall back to
 * the old round-based resolver (lib/pet-battle-sim.ts) + the PetColiseum renderer.
 *
 * RANKED pet battles are NOT affected by this flag — they stay on the old engine
 * until balance + server-side validation are proven (plan Phases E/F). Flipping
 * this OFF is the instant rollback for the PvE engine. DEFAULT ON: the continuous
 * duel is now THE Pet Coliseum experience; the balance pass + dramatic-pacing work
 * continues on this engine. Per-device persisted; force either way with
 * localStorage.setItem("petDuelEngine.v1", "1"|"0").
 */
const DUEL_ENGINE_KEY = "petDuelEngine.v1";

export function petDuelEngineEnabled(): boolean {
    try {
        const v = localStorage.getItem(DUEL_ENGINE_KEY);
        if (v === "1") return true;
        if (v === "0") return false;
        return true; // DEFAULT ON — the continuous duel is the default Pet Coliseum combat.
    } catch { return true; }
}

export function setPetDuelEngineEnabled(on: boolean): void {
    try { localStorage.setItem(DUEL_ENGINE_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

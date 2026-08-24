/*
 * Pet-arena flags. Two kinds live here and the split is load-bearing:
 *   - COSMETIC preferences (bloom, evolution cutscene, the true-3D stage) are
 *     per-device localStorage toggles — they change what you see, never who wins.
 *   - COMBAT RULES (accuracy, duel engine, arena V2, player control) are CONSTANTS.
 *     They used to be localStorage switches, which meant two browsers — or a
 *     browser and the server's Node replay — could resolve the same seeded fight
 *     under different rules. Never reintroduce a localStorage read for those.
 * The HD-2D coliseum is THE arena renderer for every pet-battle call site (Pet
 * Arena, Hollow Gate dungeon duels) — there is no classic-battlefield toggle.
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
 * Pet move ACCURACY / miss-chance. Pet moves carry an authored accuracy
 * (pet-moves.ts KIND_SPECS: 85–95 for offensive/control kinds, 100 for support)
 * that the engines roll against when a jutsu is cast (`rng() < accuracy/100`);
 * a miss consumes the turn with no effect.
 *
 * This is a COMBAT RULE, not a preference, so it is a CONSTANT — never read from
 * localStorage. A per-device switch here let two browsers (or a browser and the
 * server's Node replay, where localStorage does not exist) resolve the SAME
 * seeded fight to different winners. The value is identical in every
 * environment: ON. The sims take it as an explicit parameter (defaulting to this
 * constant) so tests can still exercise the OFF path deterministically, and the
 * server-side engine copies (api/_pet-sim, scripts/gen-pet-sim.mjs) pin the same
 * default so client render and server replay cannot desync.
 */
export const PET_ACCURACY_DEFAULT = true;

export function petAccuracyEnabled(): boolean {
    return PET_ACCURACY_DEFAULT;
}

/*
 * Direct ranked-pet challenges are locked off until their outcome is resolved
 * by the deterministic server engine. A client-controlled feature flag would
 * let a modified browser revive the old local-Elo path even though the API now
 * refuses it. The server-authoritative Pet Ladder remains available.
 */
export function petRankedChallengeEnabled(): boolean {
    return false;
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
 * continues on this engine. NOT per-device: which engine resolves a fight is a
 * combat rule, so this is a constant (a localStorage switch let one browser run a
 * different ruleset from everyone else — and from the server replay).
 */
export function petDuelEngineEnabled(): boolean {
    return true; // combat rule, not a preference — constant in every environment
}

/*
 * Tactical Pet Arena "V2" ruleset — now the LIVE arena experience (the excitement
 * pass; see the pet-arena-excitement plan). V2 runs: a rising-threat enraging Warden
 * (real damage + shield-pierce + aftershock), an OVERDRIVE momentum meter that combat
 * charges (captures stay the ONLY score), carry-as-fight-through, a relic-pool shrine,
 * a Collapse-Call focus telegraph, a late-match closing ring, tighter respawn/scroll
 * pacing, and a per-match seeded modifier.
 *
 * DEFAULT ON — the game is in testing and V2 is the intended arena; balance is tuned
 * via the V2_* knobs in pet-arena-sim.ts, not by hiding it behind a flag. It is a
 * CONSTANT (not per-device): the ruleset is a combat rule, and a localStorage switch
 * let one browser play a different arena from everyone else. The value is passed INTO
 * the deterministic sim as a param (never read inside it) so replays stay pure/testable;
 * the sim's own default is still v2=false so its golden/back-compat tests stay green.
 */
/*
 * Tactical Arena TRUE-3D stage (PetArena3DStage) — the LoL-style spectator
 * renderer: approved roster GLBs on a walkmask-generated 3D floor with a
 * pitched broadcast follow-camera + corner PiP chase cam. Applies only when
 * EVERY pet in the match has an approved 3D model (petCombatModel) — otherwise
 * the match falls back to the classic top-down diorama regardless of this flag.
 * Purely presentational: the deterministic sim, seed, rewards and replays are
 * identical either way, so flipping this is always safe. DEFAULT ON; instant
 * rollback with localStorage.setItem("petArena3d.v1","0"). Per-device persisted.
 */
const ARENA_3D_KEY = "petArena3d.v1";

export function petArena3dEnabled(): boolean {
    try {
        const v = localStorage.getItem(ARENA_3D_KEY);
        if (v === "0") return false;   // explicit kill-switch → classic diorama stage
        return true;                   // DEFAULT ON — the true-3D stage is the Tactical Arena
    } catch { return true; }
}

export function setPetArena3dEnabled(on: boolean): void {
    try { localStorage.setItem(ARENA_3D_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * PLAYER CONTROL for the Pet Coliseum (docs/pet-coliseum-player-control-plan.md).
 * When ON, a casual coliseum duel runs LIVE — the deterministic sim is stepped a
 * beat ahead of playback instead of being resolved up front — and the player gets
 * a command deck: order a move, set a stance, and spend the Bond meter on a
 * Bond Break signature. Not commanding anything reproduces the AI fight exactly,
 * and an in-fight "Auto" toggle hands the pet back to its brain at any time.
 *
 * Applies ONLY to casual PvE (Pet Arena 1v1 + 2v2 vs AI). That path is no longer
 * client-authoritative: since the §9.6 fix the client posts its INPUT LOG and
 * api/pet/battle-result.ts replays the seeded sim server-side to derive the
 * outcome, so the reported win/loss is ignored. Turning this flag OFF stays safe —
 * a watch-only duel posts no log, and an empty log replays as exactly the
 * uncommanded AI fight. Ranked, the
 * pet ladder, sector war, clan war and every replay screen keep the precomputed
 * one-shot path (runPetDuelCinematic), so no competitive outcome can shift and
 * there is no client/server desync. DEFAULT ON — the game is in testing and the
 * whole point of the feature is that players stop watching and start playing.
 * NOT per-device: it changes which fight rules apply, so it is a constant rather
 * than a localStorage switch.
 */
export function petPlayerControlEnabled(): boolean {
    return true; // combat rule, not a preference — constant in every environment (Node included)
}

/*
 * Pet Showdown had a `petShowdown.v1` client flag here whose only job was to
 * fall BACK to the legacy Coliseum as the headline mode. It is gone (owner
 * ruling): the turn-based battle is not an alternative to the old sim, it IS
 * the Coliseum, so a per-device switch between two battle systems was exactly
 * the split-brain this work exists to remove.
 *
 * The server keeps its ops kill switch (DISABLE_PET_SHOWDOWN=1, ships ON) —
 * that turns the endpoint off in an incident, it does not resurrect a second
 * engine.
 */

export function petArenaV2Enabled(): boolean {
    return true; // V2 is the live Tactical Arena — constant, not per-device
}

/*
 * The five COMBAT-RULE flags above (accuracy, ranked challenge, duel engine,
 * player control, arena V2) each used to ship a `set…Enabled(on)` twin whose
 * `on` argument was ignored: the value is a constant, so the setter's only real
 * job was scrubbing the retired localStorage key it replaced. Five no-op
 * setters with no production caller read as five live switches, so they are
 * gone — one scrub, run once at module load, does the whole job.
 *
 * Scrubbing here (rather than on a call nobody made) is what actually clears a
 * stale opt-out from an older build. Nothing reads these keys any more, so the
 * removal is purely hygienic and can never change which rules a fight runs
 * under.
 */
const RETIRED_PET_FLAG_KEYS = [
    "petAccuracy.v1",
    "petRankedChallenge.v1",
    "petDuelEngine.v1",
    "petPlayerControl.v1",
    "petArenaV2.v1",
] as const;

/** Delete every retired per-device pet-flag key. Idempotent; safe where there
 *  is no localStorage at all (the Node test runner, the server replay). */
export function scrubRetiredPetFlagKeys(): void {
    try {
        for (const key of RETIRED_PET_FLAG_KEYS) localStorage.removeItem(key);
    } catch { /* storage disabled or absent — nothing to scrub */ }
}

scrubRetiredPetFlagKeys();

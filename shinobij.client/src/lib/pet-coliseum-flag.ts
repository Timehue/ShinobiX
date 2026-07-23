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
 * a miss consumes the turn with no effect. NOW DEFAULT ON (rolled out to every
 * pet engine) — opt OUT with localStorage.setItem("petAccuracy.v1","0"). The
 * authored accuracy values may still want tuning. Passed INTO the sims as a param
 * so the deterministic engines stay pure/testable. (Node/no-localStorage falls
 * back to OFF so the engine golden tests stay deterministic; tests pass explicit
 * flags to exercise the ON path.)
 */
const PET_ACCURACY_KEY = "petAccuracy.v1";

export function petAccuracyEnabled(): boolean {
    try { return localStorage.getItem(PET_ACCURACY_KEY) !== "0"; } catch { return false; }
}

export function setPetAccuracyEnabled(on: boolean): void {
    try { localStorage.setItem(PET_ACCURACY_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

/*
 * Direct ranked-pet challenges are locked off until their outcome is resolved
 * by the deterministic server engine. A client-controlled feature flag would
 * let a modified browser revive the old local-Elo path even though the API now
 * refuses it. The server-authoritative Pet Ladder remains available.
 */
const PET_RANKED_CHALLENGE_KEY = "petRankedChallenge.v1";

export function petRankedChallengeEnabled(): boolean {
    return false;
}

export function setPetRankedChallengeEnabled(_on: boolean): void {
    // Remove stale opt-ins from pre-authority builds. Intentionally cannot be
    // enabled by client state.
    try { localStorage.removeItem(PET_RANKED_CHALLENGE_KEY); } catch { /* storage disabled — ignore */ }
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

/*
 * CINEMATIC coliseum engine flag — the redesigned combat AI (lib/pet-duel-cinematic.ts).
 * When ON, CASUAL coliseum duels (Pet Arena 1v1 + 2v2 PvE / clan-war, dungeon pet fights)
 * resolve with the new context-steering + utility-AI engine: pets KITE, reposition,
 * circle, dodge telegraphs (speed-gated), and their ROLE / ELEMENT-matchup / STATS /
 * equipped ITEMS drive a distinct fighting style — instead of the old orbit-then-lunge.
 * Emits the same DuelResult contract so the whole PetColiseumDuel renderer + spectacle
 * layer is reused. When OFF, casual duels fall back to the previous planted engine
 * (pet-duel-sim.ts, plantedMotion=true).
 *
 * RANKED / ladder / sector-war are NOT affected — they stay on pet-duel-sim.ts
 * (plantedMotion=false, server-mirrored + parity-tested) until this engine is
 * balance-signed-off and promoted (its own future step).
 *
 * STALE — this flag is VESTIGIAL: nothing reads petColiseumCinematicEnabled() any
 * more, the cinematic engine is the casual coliseum unconditionally, and setting
 * it to "0" is NOT a rollback. Its old claim that the casual reward is "keyed only
 * off the win/loss string, so the swap is reward-safe" is also no longer true: as
 * of the §9.6 input-log replay the server resolves the casual PvE reward on this
 * very engine, so the client's win/loss string is not what pays out.
 * Per-device: localStorage.setItem("petColiseumCinematic.v1","1"|"0").
 */
const CINEMATIC_KEY = "petColiseumCinematic.v1";

export function petColiseumCinematicEnabled(): boolean {
    try {
        const v = localStorage.getItem(CINEMATIC_KEY);
        if (v === "0") return false;   // explicit kill-switch → old planted engine
        return true;                   // DEFAULT ON — the redesigned engine is the casual coliseum
    } catch { return true; }
}

export function setPetColiseumCinematicEnabled(on: boolean): void {
    try { localStorage.setItem(CINEMATIC_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
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
 * via the V2_* knobs in pet-arena-sim.ts, not by hiding it behind a flag. The flag is
 * kept only as a one-key kill-switch: force the old v1 arena back with
 * localStorage.setItem("petArenaV2.v1","0") (e.g. to A/B a balance change mid-playtest).
 * When OFF, the sim path is byte-identical to the pre-V2 arena. The flag is passed INTO
 * the deterministic sim as a param (never read inside it) so replays stay pure/testable;
 * the sim's own default is still v2=false so its golden/back-compat tests stay green.
 * Per-device persisted.
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
 * Instant rollback: localStorage.setItem("petPlayerControl.v1","0") returns the
 * mode to the shipped watch-only duel. Per-device persisted.
 */
const PLAYER_CONTROL_KEY = "petPlayerControl.v1";

export function petPlayerControlEnabled(): boolean {
    try {
        const v = localStorage.getItem(PLAYER_CONTROL_KEY);
        if (v === "0") return false;   // explicit kill-switch → watch-only duel
        return true;                   // DEFAULT ON
    } catch { return false; }          // no localStorage (tests/Node) → the pure precomputed path
}

export function setPetPlayerControlEnabled(on: boolean): void {
    try { localStorage.setItem(PLAYER_CONTROL_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

const ARENA_V2_KEY = "petArenaV2.v1";

export function petArenaV2Enabled(): boolean {
    try {
        const v = localStorage.getItem(ARENA_V2_KEY);
        if (v === "0") return false;   // explicit opt-out only (kill-switch)
        return true;                   // DEFAULT ON — V2 is the live Tactical Arena
    } catch { return true; }
}

export function setPetArenaV2Enabled(on: boolean): void {
    try { localStorage.setItem(ARENA_V2_KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}

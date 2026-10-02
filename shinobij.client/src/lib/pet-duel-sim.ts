// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-sim.ts — the shared contract of the pet duel engines.
//
// The tick rate and arena footprint, the element and terrain multipliers, the
// per-kind accuracy table, and the snapshot/event types that the live engine
// (pet-duel-cinematic.ts), the Warfront Rite, the doctrine/lockstep/replay
// layers and the coliseum renderers all share.
//
// The legacy orbit-and-lunge engine that used to live below this contract
// (`simulate`, `runPetDuel`, `runPetPartyDuel`) was retired on 2026-10-02: no
// live mode resolved on it any more. Everything left is a constant, a type or
// a pure function, so the client and its generated server mirror
// (api/_pet-sim/) stay byte-identical.
// ─────────────────────────────────────────────────────────────────────────────
import type { PetJutsu } from "../types/pet";

export const DUEL_TPS = 30;                 // sim ticks per second

// Arena footprint (world units) — a BIG tactical battlefield: the pets spawn at
// opposite ends and TRAVERSE across the map to meet (small units on a big map,
// not two sprites bonking in a tight ring). The renderer frames the whole thing.
// Exported so the renderer can map sim field coords → the painted battle-map's
// battle-area rectangle (the diorama backdrop). Field is [-ARENA_X,ARENA_X] ×
// [-ARENA_Y,ARENA_Y]; the renderer projects it into the SpriteFlow spec rect.
export const ARENA_X = 14.0;
export const ARENA_Y = 7.5;

// Element type chart: Fire > Wind > Lightning > Earth > Water > Fire.
const ELEMENT_BEATS: Record<string, string> = {
    Fire: "Wind", Wind: "Lightning", Lightning: "Earth", Earth: "Water", Water: "Fire",
};
export function elementMult(att?: string | null, def?: string | null): number {
    if (!att || !def || att === "None" || def === "None") return 1;
    if (ELEMENT_BEATS[att] === def) return 1.15;   // +15% super-effective (was 25%)
    if (ELEMENT_BEATS[def] === att) return 0.85;   // −15% resisted
    return 1;
}

// War-terrain home-ground bonus for sector-war Pet duels (mirrors the Combat +10%
// jutsu-school buff, §17.3): a pet whose element matches the sector's terrain hits
// 10% harder. volcano→Fire, snow→Water, forest→Earth, shadow→Lightning; central and
// any unset/other terrain are neutral (×1). Pure + deterministic, so the server
// resolve and the client replay apply the same bonus and stay byte-identical.
const TERRAIN_ELEMENT: Record<string, string> = {
    volcano: "Fire", snow: "Water", forest: "Earth", shadow: "Lightning",
};
export function terrainPetMult(terrain?: string | null, element?: string | null): number {
    return terrain && element && TERRAIN_ELEMENT[terrain] === element ? 1.1 : 1;
}

// Per-kind hit chance (0–100). MUST mirror pet-moves.ts KIND_SPECS accuracy —
// inlined (not imported) so the generated server mirror (api/_pet-sim/) needs no
// pet-moves import. pet-duel-sim.test.ts asserts this matches pet-moves.
// Support kinds are 100 (never miss); offensive/control kinds are lower.
export const KIND_ACCURACY: Record<PetJutsu["kind"], number> = {
    damage: 95, lifesteal: 95, crush: 90, wound: 95, push: 90, pull: 90,
    dot: 90, burn: 90, debuff: 90, movelock: 90, slow: 90,
    freeze: 85, confuse: 85, stun: 85,
    heal: 100, buff: 100, barrier: 100, shield: 100, absorb: 100,
    move: 100, mark: 100, haste: 100, taunt: 100,
};

// ── Output ───────────────────────────────────────────────────────────────────
export type DuelState = "idle" | "dash" | "windup" | "strike" | "recover" | "stagger" | "dodge" | "dead";
export interface DuelActorSnap {
    id: string; team: "player" | "enemy"; slot: number;
    x: number; y: number; faceX: number; faceY: number;
    /** Current combat assignment. Public because replay presentation needs to
     * show focus/peel causality even when developer AI traces are disabled. */
    targetId?: string | null;
    hp: number; maxHp: number; stamina: number; state: DuelState; statuses: string[];
    /** Present only when a developer explicitly requests an AI trace. */
    ai?: DuelAiDebug;
}
export interface DuelProjSnap { id: number; x: number; y: number; team: "player" | "enemy"; kind: PetJutsu["kind"]; element?: string | null; }
export type DuelObjectiveId = "forbidden-scroll" | "seal-veil" | "seal-tide" | "seal-cinder" | "player-extraction" | "enemy-extraction";
export interface DuelObjectiveSnap {
    id: DuelObjectiveId;
    kind: "scroll" | "seal" | "extraction";
    owner: "player" | "enemy" | null;
    x: number; y: number;
    homeX: number; homeY: number;
    carrierId: string | null;
    state: "sealed" | "neutral" | "contested" | "captured" | "available" | "carried" | "dropped" | "inactive" | "active";
    /** Signed control meter for seals: +1 player, -1 enemy. */
    progress: number;
    active: boolean;
}
export interface DuelSnapshot {
    t: number;
    actors: DuelActorSnap[];
    projectiles: DuelProjSnap[];
    /** Present only for objective modes such as Beastbound Warfront. */
    objectives?: DuelObjectiveSnap[];
}

export type DuelAiState = "engage" | "attack" | "kite" | "flank" | "retreat" | "regroup" | "burst" | "hold position" | "reposition" | "prepare combo" | "execute combo" | "escape danger" | "eliminated";
export interface DuelAiDebug {
    state: DuelAiState;
    targetId: string | null;
    desiredRange: number;
    plan: string;
    reason: string;
    path?: Array<{ x: number; y: number }>;
    cooldownPriorities?: string[];
    elementalSetup?: string;
}

export type DuelEventType = "dash" | "maneuver" | "dodge" | "windup" | "cast" | "hit" | "whiff" | "stagger" | "heal" | "shield" | "buff" | "ultimate" | "ko"
    | "seal_capture" | "vault_open" | "relic_pickup" | "relic_drop" | "relic_return" | "capture";
export type DuelPerfectRole = "punish" | "counter" | "rally" | "shift";
export interface DuelEvent { t: number; type: DuelEventType; side: "player" | "enemy"; actorId: string; targetId?: string; dmg?: number; shieldHp?: number; crit?: boolean; element?: string | null; kind?: PetJutsu["kind"]; ranged?: boolean; move?: string; signature?: boolean; combo?: string; perfect?: DuelPerfectRole; verdict?: string; }

export interface DuelResult {
    result: "win" | "loss" | "draw";   // from the PLAYER team's perspective
    winner: "player" | "enemy" | null;
    ticks: number;
    snapshots: DuelSnapshot[];
    events: DuelEvent[];
}

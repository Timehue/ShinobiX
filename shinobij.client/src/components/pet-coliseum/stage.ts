// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { lerp } from "../../lib/pet-coliseum-scene";
import { ARENA_X, ARENA_Y } from "../../lib/pet-duel-sim";


export type Vec3 = [number, number, number];

export const FLOOR_Y = 0;

export const FX_Y = 1.0;


// Camera framing — fairly LEVEL (Z-A-style over-the-arena view) so the coliseum
// backdrop's stands/crowd/sky fill the upper frame while the floor + grounded
// pets sit lower. Shared so the Canvas, onCreated, CameraRig + preview controls
// all agree on the same look target.
// Pulled back + raised to frame the ENLARGED arena (7.0×4.0 footprint) so the
// whole tactical battlefield + four pets fit without cropping. Scales with the
// footprint so pets stay readable. Tunable — nudge y/z if it's too wide/tight.
// High three-quarter "tactical broadcast" view. A literal overhead camera makes
// the pets read like board-game pieces; this angle still shows their faces and
// silhouettes while making the depth lanes, flanks, and breakaways obvious.
export const CAM_POS: Vec3 = [0, 8.6, 14.6];

export const CAM_LOOK: Vec3 = [0, 0.5, -1.9];

export const CAM_FOV = 38;


// Generated coliseum scene art (OpenAI gpt-image-1 → WebP, bundled). Resolved
// via new URL(...) so Vite rewrites them to hashed asset URLs at build time —
// no .webp module-type declaration needed.
export const COLISEUM_FLOOR_URL = new URL("../../assets/coliseum/coliseum-floor.webp", import.meta.url).href;

export const COLISEUM_BG_URL = new URL("../../assets/coliseum/coliseum-bg.webp", import.meta.url).href;



// Base visible-content height in world units — every creature is grounded to
// this VISIBLE height (consistent silhouettes; padding no longer varies size).
// Trimmed from 2.6 so pets sit IN the full-screen arena instead of looming over it.
export const TARGET_SPRITE_H = 2.3;

// 3D coliseum: hold OPPOSING combatants this far apart (screen-x, world units) so a
// melee strike reads as a DASH across the gap, not a point-blank poke. The gap-aware
// lunge (lungeReach) auto-scales to cross it. Render-only / tunable.
export const COLISEUM_ENGAGE_GAP = 3.2;


// Element → a bright tint for idle aura wisps + dash-trail streaks (mirrors the
// particle palette). Falls back to chakra-cyan for None/unknown.
const ELEMENT_TINT: Record<string, string> = {
    fire: "#fb923c", water: "#38bdf8", wind: "#a7f3d0", lightning: "#fde047",
    earth: "#d6a45a", ice: "#bae6fd", lava: "#fb923c", blood: "#ef4444",
    shadow: "#a78bfa", iron: "#cbd5e1",
};

export const elementTint = (el?: string | null) => ELEMENT_TINT[String(el ?? "").toLowerCase()] ?? "#a5f3fc";


export type PetBattleSettlementStatus = "idle" | "pending" | "error" | "settled";


export const resultBtn: React.CSSProperties = { padding: "8px 14px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 8, cursor: "pointer", font: "700 13px Inter, system-ui, sans-serif" };

export const duelBtn: React.CSSProperties = { padding: "5px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" };

export type DuelClock = { t: number; playing: boolean; intro?: number };

// ── Tactical STAGE: a fixed painted diorama backdrop (Final-Fantasy-style
// pre-rendered background) with the fighters composited on top. The diorama is a
// CSS `cover` background; the sprites live in a TRANSPARENT, orthographic r3f
// layer whose cover-fit projection stays pixel-locked to that background at every
// viewport — because both cover the SAME logical rect and worldW:worldH ==
// imgW:imgH, a sim field point lands on the same screen pixel as the painting it
// represents. (No 3D floor: the painting already has all the depth.)
export const DIORAMA_URL = new URL("../../assets/coliseum/tactics-diorama.webp", import.meta.url).href;

// The diorama is a fixed 1536×1024 MAP-SPACE reference (the SpriteFlow arena).
// All pet positions are computed in map-space, then projected to the world layer
// — which cover-fits the SAME image as the CSS backdrop, so map-space (mx,my)
// lands on the exact painted pixel at any viewport. worldW:worldH == image aspect.
const MAP_W = 1536, MAP_H = 1024;

export const STAGE = { worldW: 30, worldH: 20 };

// The forward strike-pulse duration (s): the sim's `strike` state is a single
// ~33ms tick, so the render thrust is self-timed off the windup→exit edge instead.
export const STRIKE_PULSE_S = 0.26;

// Perspective scale for the TACTICAL ARENA's top-down diorama (front bigger, back
// smaller). The duel no longer uses this — it stands its fighters on a real 3D floor.
function getPerspectiveScale(my: number, mapH: number = MAP_H): number {
    const t = Math.min(1, Math.max(0, my / mapH));
    return 0.65 + (1.15 - 0.65) * t;
}

type StagePos = { wx: number; wy: number; depth: number; zo: number };


// The ARENA mode uses the FULL inner arena (reaches all four corner seals), not
// the lower band — must match gen-walkmask.mjs --full (pet-arena-fullmask.ts).
const ARENA_PLAY = { x0: 150, x1: 1386, y0: 96, y1: 930 };

export function arenaPlace(sx: number, sy: number): StagePos {
    const u = (sx + ARENA_X) / (2 * ARENA_X), v = (sy + ARENA_Y) / (2 * ARENA_Y);
    const mx = lerp(ARENA_PLAY.x0, ARENA_PLAY.x1, u), my = lerp(ARENA_PLAY.y0, ARENA_PLAY.y1, v);
    return { wx: (mx / MAP_W - 0.5) * STAGE.worldW, wy: (0.5 - my / MAP_H) * STAGE.worldH, depth: getPerspectiveScale(my), zo: (my / MAP_H) * 8 };
}

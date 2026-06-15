/*
 * Pet-battle PROJECTILE visual mapping — the pure spec that turns a flying
 * attack into a distinct travelling silhouette. It backs BOTH pet battle modes:
 *   • the Coliseum duel (pet-duel-sim spawns real homing projectiles), and
 *   • the Tactical Arena (the renderer synthesises a cosmetic streak from the
 *     shooter to the victim on each ranged hit — the sim has no projectiles).
 *
 * Design (from the VFX-readability rule: an attack must read by SILHOUETTE +
 * COLOR + MOTION, not color alone):
 *   ELEMENT  decides WHAT it is — fireball / water ball / wind cut / rock throw
 *            / lightning bolt: the texture, the palette, and the motion feel
 *            (fire flickers, water undulates, wind spins, earth tumbles,
 *             lightning snaps).
 *   ROLE     decides HOW it is delivered (the arena's 4 roles) — the defender
 *            lobs a heavy slug, the tracker fires a precise dart, the assassin
 *            throws a piercing lance, the sage floats a soft support comet —
 *            WITHOUT erasing the element identity (colours/texture are kept).
 *   CHARGED  is the signature / specialty tier — bigger, longer-tailed, with a
 *            pulsing aura ring.
 *
 * IMPORTANT: cosmetic-only + PURE. No THREE / DOM / rng here, so it is
 * node-testable and can never touch balance, rewards, or ranked-replay
 * determinism (the renderer applies it; the sim never reads it). Must NOT
 * import from ../App.
 */

/** Which generated head texture the renderer draws (all white-luminance so the
 *  material `color` fully controls the hue). */
export type ProjTexKind = "round" | "crescent" | "bolt" | "rock";

/** A resolved travelling-projectile visual. All sizes are in world units
 *  (pre depth-scale); angles/spin in rad & rad/sec. */
export interface ProjectileVisual {
    /** Head texture / silhouette. */
    tex: ProjTexKind;
    /** Bright center color. */
    core: string;
    /** Outer glow + tail tint. */
    glow: string;
    /** Base head radius (world units, before the stage depth-scale). */
    size: number;
    /** Length:width of the head (1 = round, >1 = a streak/lance/dart). */
    stretch: number;
    /** Billboard z-spin in rad/sec (crescents/rocks tumble; balls don't). */
    spin: number;
    /** Size flicker 0..1 — fire pulses, lightning crackles. */
    flicker: number;
    /** Lateral wobble amplitude (world units) — water undulates in flight. */
    wobble: number;
    /** Tail length multiplier (comet / charged are longer). */
    tail: number;
    /** Travel-speed multiplier for the arena spawner (1 = base; the sim drives
     *  the duel so it ignores this). Assassin lances are fast, defenders slow. */
    speedMul: number;
    /** Signature / specialty tier → adds a pulsing aura ring + extra size. */
    charged: boolean;
}

export type ProjectileVisualInput = {
    /** The cast/attacker element (incl. bloodline natures Lava/Iron/Blood/Shadow). */
    element?: string | null;
    /** The arena role of the shooter (defender/tracker/assassin/sage), if any.
     *  The Coliseum duel has no named role → element silhouette is used as-is. */
    role?: string | null;
    /** The ability kind (heal/shield/buff/crush/…), used for support tinting + a
     *  little heavy/charged flavour. */
    kind?: string | null;
    /** Force the support (heal-green) palette regardless of element. */
    support?: boolean;
    /** Signature / crit / specialty → the charged tier. */
    charged?: boolean;
};

// ── Element bases — the 5 cores + bloodline natures + a neutral fallback ──────
// Colours mirror the particle PALETTES (pet-vfx-particles.ts) so the travelling
// projectile and its impact burst read as the same element.
const ELEMENT_BASE: Record<string, ProjectileVisual> = {
    // Fireball — a molten core that flickers, with a trailing ember comet.
    fire: { tex: "round", core: "#fff3d6", glow: "#fb7a2c", size: 0.42, stretch: 1.18, spin: 0, flicker: 0.38, wobble: 0, tail: 1.3, speedMul: 1, charged: false },
    // Water ball — a rounded droplet that undulates in flight, soft spray tail.
    water: { tex: "round", core: "#eaf8ff", glow: "#2aa9f5", size: 0.40, stretch: 1.05, spin: 0, flicker: 0.12, wobble: 0.5, tail: 1.0, speedMul: 0.95, charged: false },
    // Wind cut — a spinning crescent blade, pale and fast.
    wind: { tex: "crescent", core: "#ffffff", glow: "#7ef0c7", size: 0.48, stretch: 2.1, spin: 13, flicker: 0.1, wobble: 0, tail: 0.7, speedMul: 1.15, charged: false },
    // Rock throw — a tumbling faceted boulder under a gravity-ish arc, dust tail.
    earth: { tex: "rock", core: "#ffe6a8", glow: "#c98a3c", size: 0.46, stretch: 1.0, spin: 6.5, flicker: 0, wobble: 0, tail: 0.6, speedMul: 0.85, charged: false },
    // Lightning bolt — a long jagged streak that snaps, crackling.
    lightning: { tex: "bolt", core: "#ffffff", glow: "#ffe24a", size: 0.40, stretch: 2.7, spin: 0, flicker: 0.7, wobble: 0, tail: 1.5, speedMul: 1.35, charged: false },
};

// Bloodline / extra natures reuse the closest core, recoloured where it helps.
const NATURE_BASE: Record<string, ProjectileVisual> = {
    lava: { ...ELEMENT_BASE.fire, core: "#ffd9a0", glow: "#f0552a" },
    iron: { ...ELEMENT_BASE.earth, core: "#e6edf5", glow: "#9aa7b8", spin: 4 },
    blood: { ...ELEMENT_BASE.fire, core: "#ffd9d9", glow: "#e0394a", flicker: 0.2, tail: 1.1 },
    shadow: { tex: "round", core: "#e9d5ff", glow: "#7c3aed", size: 0.42, stretch: 1.1, spin: 0, flicker: 0.18, wobble: 0.3, tail: 1.2, speedMul: 1, charged: false },
};

// Neutral / chakra fallback — a soft violet orb so every cast still has a body.
const NEUTRAL: ProjectileVisual = { tex: "round", core: "#ffffff", glow: "#a5b4fc", size: 0.40, stretch: 1.1, spin: 0, flicker: 0.15, wobble: 0.2, tail: 1.0, speedMul: 1, charged: false };

// Heal / support palette — overrides the element hue so a heal-comet reads green.
const SUPPORT_TINT = { core: "#dcfce7", glow: "#34d399" };

const SUPPORT_KINDS = new Set(["heal", "shield", "barrier", "absorb", "buff", "haste"]);

/** Apply the arena role's DELIVERY feel on top of the element body — silhouette
 *  size/length/spin/speed only, so the element colours + texture survive. */
function applyRole(v: ProjectileVisual, role: string): ProjectileVisual {
    switch (role) {
        case "defender": // heavy lobbed slug — big, rounder, slow, short tail
            return { ...v, size: v.size * 1.4, stretch: Math.max(0.9, v.stretch * 0.9), spin: v.spin * 0.6, tail: v.tail * 0.8, speedMul: v.speedMul * 0.75 };
        case "tracker": // precise dart — small, sharp, elongated, steady
            return { ...v, size: v.size * 0.82, stretch: Math.max(v.stretch, 1.9), flicker: v.flicker * 0.6, wobble: 0, tail: v.tail * 0.9, speedMul: v.speedMul * 1.15 };
        case "assassin": // piercing lance — fast, very elongated, white-hot edge
            return { ...v, size: v.size * 0.92, stretch: Math.max(v.stretch, 2.4), core: "#ffffff", tail: v.tail * 1.3, speedMul: v.speedMul * 1.35 };
        case "sage": // soft support comet — a touch bigger with a long gentle tail
            return { ...v, size: v.size * 1.12, stretch: Math.min(v.stretch, 1.2), tail: v.tail * 1.6, speedMul: v.speedMul * 0.9 };
        default:
            return v;
    }
}

/**
 * Resolve the travelling-projectile visual for one shot. Element picks the
 * silhouette + palette + motion; role (arena only) restyles the delivery; a
 * support kind recolours it heal-green; charged (signature/crit) bumps it to the
 * specialty tier. Pure — safe to unit test without a DOM.
 */
export function projectileVisual(input: ProjectileVisualInput): ProjectileVisual {
    const el = String(input.element ?? "").toLowerCase();
    let v: ProjectileVisual =
        ELEMENT_BASE[el] ? { ...ELEMENT_BASE[el] } :
        NATURE_BASE[el] ? { ...NATURE_BASE[el] } :
        { ...NEUTRAL };

    const role = String(input.role ?? "").toLowerCase();
    if (role) v = applyRole(v, role);

    const kind = String(input.kind ?? "").toLowerCase();
    if (input.support || SUPPORT_KINDS.has(kind)) {
        v = { ...v, core: SUPPORT_TINT.core, glow: SUPPORT_TINT.glow };
    }

    // A heavy "crush" hit reads a notch bigger even when not a full signature.
    if (kind === "crush") v = { ...v, size: v.size * 1.18, tail: v.tail * 1.1 };

    if (input.charged) {
        v = { ...v, size: v.size * 1.5, tail: v.tail * 1.4, charged: true };
    }
    return v;
}

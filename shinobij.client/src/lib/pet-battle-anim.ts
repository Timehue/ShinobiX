/*
 * Pet-battle PRESENTATION logic — pure functions that turn a single
 * (already-resolved, deterministic) simulator frame into:
 *   1. a sprite-mode + image source decision  (petBattleSprite)
 *   2. an ordered animation-event queue        (buildPetAnimationEvents)
 *   3. a per-sprite visual pose                 (petPoseForAvatar)
 *
 * IMPORTANT: this module must NOT import from ../App. It depends only on the
 * pet types + the presentation types, so it is node-testable (npm test) and
 * can't create a circular import with the App.tsx renderer that consumes it.
 * It also performs NO randomness and reads NO clock — every output is a pure
 * function of its inputs, so ranked replays (which run an identical canonical
 * sim on both clients) animate identically.
 */

import type { Pet } from "../types/pet";
import type { JutsuElement } from "../types/core";
import { petVisualId } from "../data/pet-evolutions";
import type {
    PetSpriteMode,
    PetVfxKey,
    PetVisualState,
    PetBattleAnimationEvent,
    PetBattleAnimationEventType,
} from "../types/pet-battle";

// Shared-image key prefixes. `pet:` is the existing circular portrait the
// admin pipeline already publishes; `petbody:` is the new namespace for a
// future transparent full-body sprite. Both are looked up by full id first,
// then by the variant-stripped base id (encounter clones append a timestamp).
const PET_IMG_PREFIX = "pet:";
const PET_BODY_PREFIX = "petbody:";
// Depth-sliced parallax layers (Phase B). Key form: `petlayers:<id>:<band>`
// where band ∈ {far, mid, near}. Produced offline by
// scripts/derive-pet-battle-sprites.mjs; all three must exist to use the mode.
const PET_LAYER_PREFIX = "petlayers:";
// Baked animation sprite STRIP (Phase C). `petsheet:<id>` is a horizontal strip
// of N square frames; `petsheet:<id>:frames` is N (defaults to 8 if absent).
// The renderer plays it with a CSS steps() animation — the slot a real AI-3D
// baked animation drops into for flagship pets.
const PET_SHEET_PREFIX = "petsheet:";
const PET_SHEET_DEFAULT_FRAMES = 8;

/** Strip the per-encounter `-<timestamp>` suffix to recover the template id. */
export function petStripVariant(id: string): string {
    return id.replace(/-\d{10,}$/, "");
}

/**
 * Resolve a pet's depth-sliced parallax layers (Phase B), if all three bands
 * are published. Looked up by full id first, then the variant-stripped base id
 * (encounter clones append a timestamp). Returns null unless every band exists,
 * so the renderer cleanly falls back to the full-body sprite / circle. Pure.
 */
export function petBattleLayers(
    pet: Pet,
    sharedImages: Record<string, string> = {},
): { far: string; mid: string; near: string } | null {
    const baseId = petStripVariant(pet.id);
    const visualId = petVisualId(pet);
    const pick = (band: "far" | "mid" | "near"): string =>
        sharedImages[`${PET_LAYER_PREFIX}${visualId}:${band}`] ||
        sharedImages[`${PET_LAYER_PREFIX}${pet.id}:${band}`] ||
        sharedImages[`${PET_LAYER_PREFIX}${baseId}:${band}`] ||
        "";
    const far = pick("far"), mid = pick("mid"), near = pick("near");
    return far && mid && near ? { far, mid, near } : null;
}

/**
 * Resolve a pet's baked animation sprite sheet (Phase C), if published — the
 * `petsheet:<id>` strip plus its `:frames` count (clamped to 1..24, default 8).
 * Looked up by full id then variant-stripped base id. Returns null when no
 * sheet exists so the renderer falls back to layers / full-body / circle. Pure.
 */
export function petBattleSheet(
    pet: Pet,
    sharedImages: Record<string, string> = {},
): { src: string; frames: number } | null {
    const baseId = petStripVariant(pet.id);
    const visualId = petVisualId(pet);
    const src =
        sharedImages[`${PET_SHEET_PREFIX}${visualId}`] ||
        sharedImages[`${PET_SHEET_PREFIX}${pet.id}`] ||
        sharedImages[`${PET_SHEET_PREFIX}${baseId}`] ||
        "";
    if (!src) return null;
    const framesRaw =
        sharedImages[`${PET_SHEET_PREFIX}${visualId}:frames`] ||
        sharedImages[`${PET_SHEET_PREFIX}${pet.id}:frames`] ||
        sharedImages[`${PET_SHEET_PREFIX}${baseId}:frames`] ||
        "";
    const parsed = parseInt(framesRaw, 10);
    const frames = Math.max(1, Math.min(24, Number.isFinite(parsed) && parsed > 0 ? parsed : PET_SHEET_DEFAULT_FRAMES));
    return { src, frames };
}

/**
 * Decide how a pet is drawn in battle and which image to use.
 *
 * A transparent full-body sprite (shared-image key `petbody:<id>` or an
 * inline `pet.bodyImage`) wins → "fullBodySprite", rendered un-clipped and
 * larger. Otherwise we fall back to the legacy circular portrait
 * (`pet:<id>` / `pet.image`) → "circleFallback". A pet with no image at all
 * still reports circleFallback (the renderer shows initials).
 */
export function petBattleSprite(
    pet: Pet,
    sharedImages: Record<string, string> = {},
): { mode: PetSpriteMode; src: string } {
    const baseId = petStripVariant(pet.id);
    // Evolved starters keep their base id but carry a stage `visualId`
    // (starter-fire-r / -l). Try the stage art FIRST, then fall back to the base
    // art — so an evolved pet shows its own form once that art is published, and
    // the unchanged base art until then (no regression). See data/pet-evolutions.
    const visualId = petVisualId(pet);
    const body =
        sharedImages[PET_BODY_PREFIX + visualId] ||
        sharedImages[PET_BODY_PREFIX + pet.id] ||
        sharedImages[PET_BODY_PREFIX + baseId] ||
        pet.bodyImage ||
        "";
    if (body) return { mode: "fullBodySprite", src: body };
    const circle =
        sharedImages[PET_IMG_PREFIX + visualId] ||
        sharedImages[PET_IMG_PREFIX + pet.id] ||
        sharedImages[PET_IMG_PREFIX + baseId] ||
        pet.image ||
        "";
    return { mode: "circleFallback", src: circle };
}

/** Map a pet's chakra element to its VFX tint. */
export function elementVfxKey(element?: JutsuElement | string | null): PetVfxKey {
    switch (String(element ?? "").toLowerCase()) {
        case "fire": return "fire";
        case "water": return "water";
        case "wind": return "wind";
        case "lightning": return "lightning";
        case "earth": return "earth";
        default: return "none";
    }
}

// ── Animation-event builder ─────────────────────────────────────────────────

/** The subset of a simulator frame the builder reads (structural, so the real
 *  PetArenaFrame from App.tsx is assignable without exporting it / coupling). */
export type PetFrameLike = {
    actor: "player" | "enemy" | "system";
    actionKind?: string;
    damage?: number;
    crit?: boolean;
    isKO?: boolean;
    isPrefight?: boolean;
    message?: string;
    signatureMove?: { name: string; petName: string; side: "player" | "enemy" } | null;
};

export type BuildPetAnimInput = {
    frame: PetFrameLike;
    /** Tile distance between the acting pet and its target this frame. */
    dist: number;
    /** Resolved pet id of the acting side/slot (frame.actor). */
    actorId: string;
    /** Resolved pet id of the opposing side/slot. */
    targetId: string;
    /** Element/flavor tint for the acting pet (renderer pre-resolves). */
    vfxKey?: PetVfxKey;
    /** True only on the final outcome frame (actionKind "result", not a KO). */
    isResultFrame?: boolean;
    /** Pet id of the match winner (used on the result frame). */
    winnerId?: string | null;
    /** Pet id of the pet that just dropped (used on a KO frame). */
    loserId?: string | null;
};

// Render-level actionKinds (what the frame carries) grouped by how they animate.
// Note these are the SIM's emitted actionKinds, not jutsu.kind — e.g. a freeze
// jutsu is emitted as "movelock", a confuse as "debuff", a burn as "dot".
const OFFENSE_KINDS = new Set(["damage", "basic", "lifesteal"]);
const RANGED_STATUS_KINDS = new Set(["debuff", "movelock"]);
const SELF_CHARGE_KINDS = new Set(["buff", "heal"]);
const SELF_GUARD_KINDS = new Set(["barrier", "shield", "absorb"]);

// Defender slipped the attack entirely. The sim logs these from the DEFENDER's
// side (frame.actor is the dodger), so the builder swaps actor/target for them.
const DODGE_RE = /dodges|evades|blurs out of reach|slips aside|Lucky instinct|shakes off the ice|sees through it|shrugs it off/i;
// A poison/burn over-time TICK (vs. the cast that applies it) carries damage
// and reads as the sufferer writhing — we animate it on frame.actor directly.
const BURN_RE = /🔥|burns? /i;

/**
 * Turn one resolved simulator frame into an ordered animation-event queue.
 * Pure + deterministic. Returns [] for frames with nothing to choreograph
 * (the renderer then holds every pet at idle).
 */
export function buildPetAnimationEvents(input: BuildPetAnimInput): PetBattleAnimationEvent[] {
    const { frame, dist, actorId, targetId } = input;
    const vfx: PetVfxKey = input.vfxKey ?? "none";
    const events: PetBattleAnimationEvent[] = [];
    let seq = 0;
    const ev = (
        type: PetBattleAnimationEventType,
        durationMs: number,
        extra: Partial<PetBattleAnimationEvent> = {},
    ): PetBattleAnimationEvent => ({
        id: `${seq++}-${type}`,
        actorId,
        targetId,
        type,
        durationMs,
        vfxKey: vfx,
        ...extra,
    });

    // Match end — the winner celebrates, everyone else holds.
    if (input.isResultFrame) {
        if (input.winnerId) {
            events.push({ id: `${seq++}-victory`, actorId: input.winnerId, type: "victory", durationMs: 1600, vfxKey: "none" });
        } else {
            events.push(ev("idle", 200));
        }
        return events;
    }

    // Dedicated KO frame — the downed pet topples (frame.actor is the killer).
    if (frame.isKO) {
        const downed = input.loserId ?? targetId;
        events.push({ id: `${seq++}-ko`, actorId: downed, targetId: actorId, type: "ko", durationMs: 1400, vfxKey: vfx });
        return events;
    }

    const kind = frame.actionKind ?? "";
    const message = frame.message ?? "";

    // Nothing to choreograph — intro / round-summary / relocation frames.
    // (Relocation is drawn by the renderer's tile-to-tile glide, not a pose.)
    if (frame.isPrefight || frame.actor === "system" || kind === "" || kind === "move") {
        return events;
    }

    // Control SKIP frames — the afflicted pet loses its turn (stunned / frozen /
    // rooted). These reuse the "movelock" actionKind but are NOT an attack, so
    // hold idle rather than firing a phantom cast. (Distinct from the cast that
    // APPLIES a root, whose message reads "movement-locked for N rounds".)
    if (/cannot advance|turn skipped/i.test(message)) {
        return events;
    }

    // Confusion self-hit — the pet strikes itself; it reuses the "damage"
    // actionKind but must react in place, never lunge across the lane.
    if (kind === "damage" && /hits itself/i.test(message)) {
        events.push(ev("statusApply", 220, { vfxKey: "shadow" }));
        if (typeof frame.damage === "number") {
            events.push(ev("damageNumber", 1, { amount: frame.damage, text: `-${frame.damage}`, vfxKey: "shadow" }));
        }
        return events;
    }

    // ── Whiffed attack: the defender dodged/evaded. ─────────────────────────
    // frame.actor is the DODGER here, so the attacker is the other id.
    if (DODGE_RE.test(message) && (OFFENSE_KINDS.has(kind) || RANGED_STATUS_KINDS.has(kind) || kind === "dot")) {
        const dodgerId = actorId;
        const attackerId = targetId;
        // Same range rule as a landed hit: ranged status, DoTs, far strikes, OR an
        // elemental blast are fired (so the dodged attack reads as a projectile
        // whiffing past), else a melee lunge that the defender slips.
        const elemental = vfx !== "none" && vfx !== "chakra";
        const ranged = RANGED_STATUS_KINDS.has(kind) || kind === "dot" || ((kind === "damage" || kind === "lifesteal") && (dist > 2 || elemental));
        if (ranged) {
            events.push({ id: `${seq++}-rangedCast`, actorId: attackerId, targetId: dodgerId, type: "rangedCast", durationMs: 200, vfxKey: vfx });
            events.push({ id: `${seq++}-projectile`, actorId: attackerId, targetId: dodgerId, type: "projectile", durationMs: 300, vfxKey: vfx });
        } else {
            events.push({ id: `${seq++}-windup`, actorId: attackerId, targetId: dodgerId, type: "windup", durationMs: 160, vfxKey: vfx });
            events.push({ id: `${seq++}-lunge`, actorId: attackerId, targetId: dodgerId, type: "lunge", durationMs: 280, vfxKey: vfx });
        }
        events.push({ id: `${seq++}-dodge`, actorId: dodgerId, targetId: attackerId, type: "dodge", durationMs: 420, vfxKey: "none" });
        return events;
    }

    // ── Landed offense (basic / damage / lifesteal). ────────────────────────
    if (OFFENSE_KINDS.has(kind)) {
        // A non-basic move fires from RANGE if it's thrown from afar OR it's an
        // ELEMENTAL move — an elemental pet HURLS its element as a projectile
        // instead of running in to bonk, even at close range. (The grid is small,
        // so most fights sit at dist≤2 and elemental blasts were wrongly animating
        // as melee lunges — the "no range, they just bonk" complaint.) Plain
        // (non-elemental) strikes and basics still lunge to melee. Renderer-only:
        // the engine's outcome is untouched; this only changes how it's drawn.
        const elemental = vfx !== "none" && vfx !== "chakra";
        const ranged = kind !== "basic" && (dist > 2 || elemental);
        const vk: PetVfxKey = kind === "lifesteal" ? "blood" : vfx;
        const moveName = extractPetMoveName(message);
        const signature = !!frame.signatureMove;
        // Timeline step 1 — move-name callout. The signature cut-in announces
        // its own name, so skip the small callout there to avoid doubling up.
        if (moveName && !signature) events.push(ev("moveCallout", 340, { text: moveName }));
        // Signature / "charge attack" — a longer wind-up glow before release
        // (the renderer dims + zooms the camera while this beat plays).
        if (signature) events.push(ev("charge", 620, { text: frame.signatureMove?.name }));
        if (ranged) {
            events.push(ev("rangedCast", 200, { vfxKey: vk }));
            events.push(ev("projectile", 280, { vfxKey: vk }));
        } else {
            events.push(ev("windup", 130)); // snappier anticipation
            events.push(ev("lunge", 230));  // faster dash-in
        }
        // ── Multi-hit FLURRY (anime exchange) ───────────────────────────────
        // Split the engine's single damage into a rapid STRING of sub-hits
        // (jab-jab-LAUNCHER) — presentation only, the displayed numbers sum to
        // frame.damage exactly. Short impacts read as a flurry; the FINAL hit is
        // the big launcher that carries the knockback + shake. Bigger attacks
        // (crit / signature) get more hits.
        const totalDmg = typeof frame.damage === "number" ? frame.damage : 0;
        const baseHits = signature ? 5 : frame.crit ? 4 : ranged ? 2 : 3;
        const hits = totalDmg > 0 ? Math.max(1, Math.min(baseHits, totalDmg)) : baseHits;
        const per = Math.max(1, Math.floor(totalDmg / hits));
        for (let h = 0; h < hits; h++) {
            const last = h === hits - 1;
            events.push(ev("impact", last ? 200 : 90, { vfxKey: vk })); // rapid jabs, big final
            if (totalDmg > 0) {
                const dmg = last ? totalDmg - per * (hits - 1) : per; // remainder on the launcher
                events.push(ev("damageNumber", 1, {
                    amount: dmg,
                    text: frame.crit && last ? `CRIT -${dmg}` : `-${dmg}`,
                    vfxKey: vk,
                }));
            }
        }
        if (frame.crit) events.push(ev("screenShake", 220, { vfxKey: vk }));
        events.push(ev("recoil", 340, { vfxKey: vk }));
        return events;
    }

    // ── Damage-over-time. Tick (carries damage) vs. the cast that applies it. ─
    if (kind === "dot") {
        const vk: PetVfxKey = BURN_RE.test(message) ? "fire" : "poison";
        if (typeof frame.damage === "number") {
            // Over-time tick — the sufferer (frame.actor) reacts in place.
            events.push(ev("statusApply", 240, { vfxKey: vk }));
            events.push(ev("damageNumber", 1, { amount: frame.damage, text: `-${frame.damage}`, vfxKey: vk }));
            return events;
        }
        // Application cast — the caster lobs the affliction at the target.
        const dotName = extractPetMoveName(message);
        if (dotName) events.push(ev("moveCallout", 300, { text: dotName }));
        events.push(ev("rangedCast", 200, { vfxKey: vk }));
        events.push(ev("projectile", 300, { vfxKey: vk }));
        events.push(ev("statusApply", 260, { vfxKey: vk }));
        return events;
    }

    // ── Ranged control / debuff (debuff, confuse, movelock, freeze, stun). ──
    if (RANGED_STATUS_KINDS.has(kind)) {
        const freeze = /freez|🧊|ice/i.test(message);
        const stun = /stun|💤/i.test(message);
        const vk: PetVfxKey = freeze ? "ice" : stun ? "lightning" : "shadow";
        const ctrlName = extractPetMoveName(message);
        if (ctrlName) events.push(ev("moveCallout", 300, { text: ctrlName }));
        events.push(ev("rangedCast", 200, { vfxKey: vk }));
        events.push(ev(freeze || stun ? "beam" : "projectile", 320, { vfxKey: vk }));
        events.push(ev("statusApply", 260, { vfxKey: vk }));
        return events;
    }

    // ── Self buffs / heals — gather chakra in place. ────────────────────────
    if (SELF_CHARGE_KINDS.has(kind)) {
        const vk: PetVfxKey = kind === "heal" ? "chakra" : vfx;
        events.push(ev("charge", 500, { vfxKey: vk }));
        if (kind === "heal") events.push(ev("healNumber", 1, { vfxKey: "chakra" }));
        return events;
    }

    // ── Self defense (barrier / shield / absorb) — brace and ward. ──────────
    if (SELF_GUARD_KINDS.has(kind)) {
        events.push(ev("guard", 420, { vfxKey: "chakra" }));
        events.push(ev("shieldNumber", 1, { vfxKey: "chakra" }));
        return events;
    }

    return events;
}

// ── Per-sprite pose resolution ──────────────────────────────────────────────

/**
 * The pose a specific pet sprite should hold given the event the queue is
 * currently playing. Resolved by matching the sprite's id against the event's
 * actorId / targetId, so it works for 1v1 and 2v2 alike (each event names its
 * own participants). A fainted pet always reads "ko".
 */
export function petPoseForAvatar(
    activeEvent: PetBattleAnimationEvent | undefined,
    petId: string,
    isWinner: boolean,
    fainted: boolean,
): PetVisualState {
    if (fainted) return "ko";
    if (!activeEvent) return isWinner ? "victory" : "idle";
    const isActor = activeEvent.actorId === petId;
    const isTarget = activeEvent.targetId === petId;
    switch (activeEvent.type) {
        case "windup": return isActor ? "windup" : "idle";
        case "lunge": return isActor ? "lunge" : "idle";
        case "rangedCast": return isActor ? "rangedCast" : "idle";
        case "beam": return isActor ? "rangedCast" : "idle";
        case "projectile": return isActor ? "projectileFire" : "idle";
        case "charge": return isActor ? "charge" : "idle";
        case "guard": return isActor ? "guard" : "idle";
        case "block": return isTarget ? "guard" : "idle";
        case "impact":
        case "recoil": return isTarget ? "recoil" : "idle";
        case "statusApply": return isTarget ? "hit" : "idle";
        case "dodge": return isActor ? "dodge" : "idle";
        case "ko": return isActor ? "ko" : "idle";
        case "victory": return isActor ? "victory" : "idle";
        default: return isWinner ? "victory" : "idle";
    }
}

/**
 * Map a pet's pose + side onto the directional CSS pose class. Player sprites
 * face/lunge right and recoil left; enemy sprites are mirrored. Ranged casts
 * and dedicated charges share the glow pose. Returns one of the Phase-3 pose
 * classes (pet-idle / pet-windup / pet-lunge-{left,right} / pet-recoil-{left,
 * right} / pet-guard / pet-dodge / pet-charge / pet-ko / pet-victory).
 */
export function petAvatarStateClass(state: PetVisualState, side: "player" | "enemy"): string {
    const facingRight = side === "player";
    switch (state) {
        case "windup": return "pet-windup";
        case "lunge": return facingRight ? "pet-lunge-right" : "pet-lunge-left";
        case "rangedCast":
        case "projectileFire":
        case "charge": return "pet-charge";
        case "recoil":
        case "hit": return facingRight ? "pet-recoil-left" : "pet-recoil-right"; // shoved away from the foe
        case "guard": return "pet-guard";
        case "dodge": return "pet-dodge";
        case "ko": return "pet-ko";
        case "victory": return "pet-victory";
        case "idle":
        default: return "pet-idle";
    }
}

/**
 * Pull the move name out of a battle-log line ("… uses Ember Lash for 40 …" →
 * "Ember Lash"). Returns undefined for basic attacks and anything that doesn't
 * fit, so the renderer simply skips the callout.
 */
export function extractPetMoveName(message: string | undefined): string | undefined {
    if (!message) return undefined;
    const m = /\buses\s+(.+?)(?:\s+for\b|\s+—|,|\.|!|$)/i.exec(message);
    const name = m?.[1]?.trim();
    return name && name.length > 0 && name.length <= 40 ? name : undefined;
}

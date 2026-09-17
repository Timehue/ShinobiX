/*
 * battlefield-reactions — the short body motions a combat actor plays when
 * something happens to it: a flinch on a hit, a firmer reel on a heavy one, a
 * brace when a shield takes the blow, a lift on a heal, a nudge toward the
 * target on an attack, and a sag on a KO.
 *
 * Runs on the Web Animations API against the actor ANCHOR (`.battlefield-actor`)
 * so it never touches React state, never reflows (transform / opacity only),
 * and never changes the anchor's `left` / `top` — the fighter's board tile is
 * untouched before, during and after every reaction. Finished animations are
 * released by the browser; the one `ko` reaction keeps its final frame until
 * the actor unmounts.
 *
 * Honors prefers-reduced-motion: with it on, nothing moves (the floating number
 * and the plate still show the outcome). Cosmetic only.
 */
import { prefersReducedMotion } from "./device-tier";
import type { CombatActorReactionKind } from "./combat-presentation";

export type ReactionVector = { x: number; y: number };

type ReactionSpec = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * Keyframes for one reaction, aimed along `dir` (a unit vector: for a hit, the
 * direction the blow travels — the fighter is pushed AWAY along it; for a lunge,
 * toward the target). Pure so a test can assert every frame stays on
 * transform / opacity and every duration stays sub-second.
 */
export function battlefieldReactionSpec(kind: CombatActorReactionKind, dir: ReactionVector = { x: 1, y: 0 }): ReactionSpec {
    const sx = dir.x >= 0 ? 1 : -1;
    const rest = "translate(0px, 0px) rotate(0deg) scale(1)";
    switch (kind) {
        case "hit":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: `translate(${px(dir.x * 5)}, ${px(dir.y * 5)}) rotate(${-3 * sx}deg) scale(1)`, offset: 0.28 },
                    { transform: rest },
                ],
                options: { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
            };
        case "heavy":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: `translate(${px(dir.x * 9)}, ${px(dir.y * 9)}) rotate(${-5 * sx}deg) scale(0.96)`, offset: 0.24 },
                    { transform: `translate(${px(dir.x * 3)}, ${px(dir.y * 3)}) rotate(${-1.5 * sx}deg) scale(1)`, offset: 0.62 },
                    { transform: rest },
                ],
                options: { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
            };
        case "guard":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: `translate(${px(dir.x * 3)}, ${px(dir.y * 3)}) rotate(0deg) scale(0.985)`, offset: 0.35 },
                    { transform: rest },
                ],
                options: { duration: 220, easing: "ease-out" },
            };
        case "heal":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: "translate(0px, -3px) rotate(0deg) scale(1.04)", offset: 0.4 },
                    { transform: rest },
                ],
                options: { duration: 320, easing: "ease-in-out" },
            };
        case "cast":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: "translate(0px, -2px) rotate(0deg) scale(1.06)", offset: 0.35 },
                    { transform: rest },
                ],
                options: { duration: 260, easing: "ease-out" },
            };
        case "lunge":
            return {
                keyframes: [
                    { transform: rest },
                    { transform: `translate(${px(dir.x * 10)}, ${px(dir.y * 10)}) rotate(0deg) scale(1.02)`, offset: 0.38 },
                    { transform: rest },
                ],
                options: { duration: 300, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" },
            };
        case "ko":
            return {
                keyframes: [
                    { transform: rest, opacity: 1 },
                    { transform: `translate(${px(dir.x * 3)}, 5px) rotate(${7 * sx}deg) scale(0.95)`, opacity: 0.45 },
                ],
                options: { duration: 520, easing: "ease-in", fill: "forwards" },
            };
    }
}

/** The most recent non-final reaction on each actor, so a new one replaces it. */
const active = new WeakMap<Element, Animation>();

type Animatable = Element & { animate?: (keyframes: Keyframe[], options?: KeyframeAnimationOptions) => Animation };

/**
 * Play one reaction on an actor anchor. Returns the Animation, or null when
 * there is nothing to animate (no element, no WAAPI, reduced motion, or the
 * actor is already down — a KO frame is never overwritten by a later flinch).
 */
export function playBattlefieldReaction(
    el: Element | null | undefined,
    kind: CombatActorReactionKind,
    dir?: ReactionVector,
): Animation | null {
    if (!el) return null;
    const target = el as Animatable;
    if (typeof target.animate !== "function") return null;
    if (prefersReducedMotion()) return null;
    if (target.getAttribute("data-battlefield-down") === "true") return null;
    const previous = active.get(target);
    if (previous) {
        try { previous.cancel(); } catch { /* already released */ }
        active.delete(target);
    }
    const spec = battlefieldReactionSpec(kind, dir);
    let animation: Animation;
    try {
        animation = target.animate(spec.keyframes, spec.options);
    } catch {
        return null;
    }
    if (kind === "ko") {
        // Persist the down state on the element so a later poll / re-render
        // cannot restart a flinch on a fighter that is already on the floor.
        target.setAttribute("data-battlefield-down", "true");
    } else {
        active.set(target, animation);
        const release = () => { if (active.get(target) === animation) active.delete(target); };
        animation.addEventListener?.("finish", release);
        animation.addEventListener?.("cancel", release);
    }
    return animation;
}

/** Find an actor anchor by the id the screens stamp on it. */
export function findBattlefieldActor(root: ParentNode | null | undefined, actorId: string): Element | null {
    if (!root || typeof root.querySelector !== "function") return null;
    const safe = String(actorId).replace(/["\\]/g, "");
    return root.querySelector(`[data-battlefield-actor-id="${safe}"]`);
}

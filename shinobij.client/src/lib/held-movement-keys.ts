/**
 * The movement key a player is physically holding, for the lazy tile
 * interiors (strongholds, the village and clan golden shrines). Hollow Gate
 * keeps its own copy in use-hollow-gate-walk.ts, because App loads that hook
 * eagerly and importing this module there split it into its own startup chunk.
 *
 * Those screens used to walk a held key on the OS key repeat. The repeat waits
 * about half a second (the Windows default) before its first event, so
 * holding W took one step, stood still, and only then walked. The open world
 * reads keydown/keyup instead, which is why it felt more responsive. Now a
 * screen steps on the first press and then walks on its own cadence for as
 * long as the key is down. Like the open world, one key is held at a time:
 * a new press takes over, and letting go of it ends the hold.
 *
 * Only trusted (real keyboard) events start a hold. The controller layer
 * (gamepad-navigation.ts) re-sends a held stick as synthetic presses, and
 * those keep their old meaning: each one is a single step.
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Lowercased WASD / arrow key → [dx, dy]. */
const UP: [number, number] = [0, -1], DOWN: [number, number] = [0, 1], LEFT: [number, number] = [-1, 0], RIGHT: [number, number] = [1, 0];
export const MOVEMENT_KEYS: Record<string, [number, number] | undefined> = {
    w: UP, arrowup: UP, s: DOWN, arrowdown: DOWN, a: LEFT, arrowleft: LEFT, d: RIGHT, arrowright: RIGHT,
};

/**
 * The held movement key (lowercased) for the life of a component, else null.
 * It is released by a WINDOW keyup, wherever focus went, and on window blur.
 * macOS sends no keyup for a key let go while Cmd is down, so Cmd's own keyup
 * ends the hold too.
 */
export function useHeldMovementKey() {
    const held = useRef<string | null>(null);
    useEffect(() => {
        const clear = () => { held.current = null; };
        const release = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (key === held.current || key === "meta") clear(); };
        addEventListener("keyup", release);
        addEventListener("blur", clear);
        return () => { removeEventListener("keyup", release); removeEventListener("blur", clear); };
    }, []);
    return held;
}

/** The walkable 10x10 inside a golden shrine's 12x12 room grid. */
export const onShrineFloor = (tile: number) => tile >= 12 && tile < 132 && tile % 12 >= 1 && tile % 12 <= 10;

/** The shrine floor tile one step from `from` toward `key`, else -1. */
export function shrineTileToward(key: string | null, from: number) {
    const dir = key && MOVEMENT_KEYS[key], tile = dir ? from + dir[0] + dir[1] * 12 : -1;
    return onShrineFloor(tile) ? tile : -1;
}

/**
 * A golden shrine room's keydown: the floor tile a WASD or arrow press asks
 * for, else -1. Cmd/Ctrl/Alt chords are browser shortcuts (a Cmd chord also
 * sends no keyup on macOS). A real press starts a hold; its OS repeats ask
 * for nothing, because the room's walk loop follows the held key itself.
 * WASD works anywhere in the room, but on a button or toggle outside the
 * floor (the room's one role=group) the arrows stay the browser's, because
 * Android re-sends a controller D-pad as arrows to move focus (see WorldMap's
 * sector key handler).
 * Neither room has a text field. Give this a field guard if one ever gets one.
 *
 * A walking key also moves focus to the floor. A step disables the room's
 * buttons (and the clan courtyard's far tiles), and a focused control that
 * disables drops focus to <body>, outside the room's key handler, so every
 * key after it would be lost. On the floor, nothing that disables has focus.
 */
export function shrineKeyStep(event: ReactKeyboardEvent, held: { current: string | null }, from: number) {
    const key = event.key.toLowerCase(), target = event.target as HTMLElement;
    if (event.ctrlKey || event.metaKey || event.altKey || !MOVEMENT_KEYS[key]
        || key.length > 1 && target.closest("button,summary") && !target.closest("[role=group]")) return -1;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLElement>("[role=group]")?.focus();   // a no-op when it already has focus
    if (event.isTrusted) { if (event.repeat) return -1; held.current = key; }
    return shrineTileToward(key, from);
}

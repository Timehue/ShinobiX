// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.


/** Adapt the camera to the canvas aspect: portrait/narrow screens widen the
 *  FOV so both sides of the arena stay in frame on mobile. Applied per-frame
 *  (no-op unless it changed) — the idiomatic r3f mutation point. */
// Transient FOV punch-IN on crit/KO, set by DuelDirector and applied + decayed by
// ResponsiveCamera (the single owner of camera.fov, so nothing fights it). A lens
// snap layered on top of the existing dolly zoom. Safe as a module singleton:
// only one duel mounts at a time, and it decays to 0 every frame, so a stale
// value from a prior fight is gone within a few frames.
export const duelFovKick = { current: 0 };

// Transient camera SHAKE requested from OUTSIDE the render loop (a player command).
// Screen shake lives inside DuelDirector's useFrame ref; a command is issued from an
// onClick, so this module singleton bridges the tap → the next frame folds it into the
// live shake and zeroes it. Same safety as duelFovKick: one duel at a time, consumed
// every frame. This is what gives a MOVE CHOICE a physical jolt, not just a UI popup.
export const duelCmdKick = { shake: 0, zoom: 0 };

// Command RUSH — the fix for "I chose a move and nothing happened for a while." The
// engine deliberately makes pets size each other up between exchanges (a ~1–2 s
// standoff), so an ordered move can take a beat to actually land on screen. Rather than
// touch that sim cadence (a proven dead-end that breaks the AI-vs-AI tests), this
// fast-forwards the PLAYBACK clock through the dead staring gap after a command until
// the next real beat, so the ordered strike reaches the screen fast — then hands off to
// the savor slow-mo on contact. Render-only: it scales the camera clock, never the sim,
// so determinism / ranked / the server replay are untouched. Set by issueCommand,
// consumed + cleared by DuelDirector. `fromTick` bounds it so it can never run away.
export const duelCmdRush = { active: false, fromTick: 0 };

export const duelCmdFocus = { actorId: "", targetId: "", color: "#fbbf24", expiresAt: 0 };


/** Request a one-off camera jolt from OUTSIDE the frame loop — a player tap.
 *
 *  Wrapped in a function rather than assigned at the call sites. The three objects
 *  above are module state, and writing to module state from inside a component body
 *  is precisely what the immutability rule exists to catch; routing every write
 *  through here keeps the one legitimate escape hatch in a single place, next to the
 *  explanation of why it is safe. Each field is a MAX so two commands in the same
 *  frame take the louder jolt rather than the later one. */
export function requestDuelCommandJolt(shake: number, zoom: number, fov: number) {
    duelCmdKick.shake = Math.max(duelCmdKick.shake, shake);
    duelCmdKick.zoom = Math.max(duelCmdKick.zoom, zoom);
    duelFovKick.current = Math.max(duelFovKick.current, fov);
}

/** Fast-forward playback through the post-command staring gap (see duelCmdRush). */
export function requestDuelCommandRush(fromTick: number) {
    duelCmdRush.active = true;
    duelCmdRush.fromTick = fromTick;
}

export function requestDuelCommandFocus(actorId: string, targetId: string, color: string, durationMs = 820) {
    duelCmdFocus.actorId = actorId;
    duelCmdFocus.targetId = targetId;
    duelCmdFocus.color = color;
    duelCmdFocus.expiresAt = performance.now() + durationMs;
}

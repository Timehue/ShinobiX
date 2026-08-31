/*
 * How often the presence heartbeat (POST /api/player/heartbeat) fires.
 *
 * The beat does two jobs: it re-asserts this player's presence row, and it is
 * the ONLY carrier of the pendingChallenges / pendingAttacker / pendingNotices
 * inboxes (api/player/heartbeat.ts). The Socket.IO layer never delivers those —
 * `presence:kick` only nudges the client to run an off-cycle beat immediately.
 *
 * ── Why a hidden tab still beats ────────────────────────────────────────────
 * This used to return early on `!tabVisible` and stop the beat outright. That
 * looked like a saving and was not one, because it made the player UNREACHABLE
 * without making them SAFE:
 *
 *   • presence-socket.ts pings its own frame every 20s from a timer that is not
 *     tied to tab visibility, so the server's onlineStore row stays fresh
 *     regardless — the player is still listed in their sector, still attackable,
 *     and still far too fresh for the 90s sleeper-camp sweep to convert them.
 *   • ...but with no beat, their challenge inbox was never drained, and
 *     `presence:kick` landed on a retired no-op ref.
 *
 * So a sector attack on a backgrounded defender created a PvP session the
 * defender never joined — and an unjoined session can neither pay out
 * (`pvpSessionMayReward`) nor be resolved by forfeit (`claim-afk-win`): both
 * require `joined.p1 && joined.p2`. The attacker was parked in a battle that
 * could never end. Keeping a slow beat makes the attack land and lets the absent
 * defender forfeit — exactly what already happens to an AFK defender whose tab
 * is VISIBLE, so this is the existing rule applied evenly, not a new one.
 *
 * How the two halves drifted: the pause landed 2026-05-24 to cut Vercel function
 * invocations, back when going quiet really did make a tab go offline. The socket
 * presence ping arrived ten days later (2026-06-03) and quietly took over keeping
 * the row alive, and nobody revisited the pause. Vercel is retired; on Railway
 * this is one in-process request a minute, not a billed invocation.
 *
 * HIDDEN_TAB_MS is deliberately not conditioned on being in the wild: the same
 * beat carries offline notices and the admin force-reload signal, which matter
 * in the village too, and browsers clamp background-tab timers to roughly one
 * tick a minute anyway — so a shorter value would not actually fire. It costs
 * about what the roster poll (also visibility-independent) already costs.
 */

/** Socket is up: it owns liveness, so the poll is just a slow reconcile. */
export const SOCKET_RECONCILE_MS = 20_000;
/** Tab is hidden: the reachability backstop. See the note above. */
export const HIDDEN_TAB_MS = 60_000;
/** Socket down, mid-fight or queued for village defense: no delivery lag. */
export const COMBAT_MS = 1_000;
/** Socket down, standing in a village / hub (sector 0): nothing urgent. */
export const VILLAGE_MS = 15_000;
/** Socket down, out in the wild: a raid is less urgent than an active fight. */
export const FIELD_MS = 3_000;

export type HeartbeatCadenceInput = {
    /** document.visibilityState === "visible". */
    tabVisible: boolean;
    /** The Socket.IO presence channel is connected. */
    socketConnected: boolean;
    /** Screen hosts an unresolved fight (isBattleFlowScreen). */
    inBattleFlow: boolean;
    /** Signed up for village guard duty — must answer raids fast. */
    guardQueued: boolean;
    /** Current world sector; 0 is a village / hub safe zone. */
    sector: number;
};

/**
 * Milliseconds between heartbeats. Hidden wins over every other condition: a
 * background tab cannot render a fight, so the only thing its beat owes anyone
 * is delivery, and `presence:kick` covers the urgent case whenever the socket
 * is up.
 */
export function heartbeatIntervalMs(input: HeartbeatCadenceInput): number {
    if (!input.tabVisible) return HIDDEN_TAB_MS;
    if (input.socketConnected) return SOCKET_RECONCILE_MS;
    if (input.inBattleFlow || input.guardQueued) return COMBAT_MS;
    return input.sector === 0 ? VILLAGE_MS : FIELD_MS;
}

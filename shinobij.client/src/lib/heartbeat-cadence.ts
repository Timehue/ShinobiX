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

/*
 * ── Why the beat is scheduled, not just intervalled ─────────────────────────
 *
 * The cadence above says how OFTEN a client beats. It says nothing about WHEN,
 * and a bare `setInterval` answers that with "the same instant as everybody
 * else", which is how the beat turns a deploy into a load spike:
 *
 *   1. Railway replaces the container. Every live socket drops in the same
 *      instant, so every client's `socketConnected` flips false at once.
 *   2. That flip re-runs App's heartbeat effect on every client simultaneously,
 *      each firing an immediate beat and then arming an interval — all with the
 *      same period and, because they started together, the same PHASE.
 *   3. Anyone still in a battle flow is on COMBAT_MS. The result is a
 *      phase-aligned 1 Hz stampede onto a container that is still cold: empty
 *      proc-cache (api/_proc-cache.ts), unwarmed pg pool.
 *
 * lib/poll.ts already solved this shape for screen polls — it jitters "to
 * de-synchronise clients (avoids a thundering-herd of beats landing on the same
 * wall-clock tick after a deploy bounce)". The beat is the highest-frequency
 * call in the game and was the one poll that never adopted it.
 *
 * `visiblePoll` itself is NOT usable here, and the difference is load-bearing:
 * it skips the tick while the tab is hidden, which is exactly the behaviour the
 * long note at the top of this file exists to forbid. A hidden tab that stops
 * beating stays present and attackable while its challenge inbox goes undrained,
 * which strands the attacker in a session that can neither pay out nor forfeit.
 * So this scheduler borrows the jitter and nothing else — it keeps beating while
 * hidden, at HIDDEN_TAB_MS.
 */

/** Interval spread, as a fraction of the cadence. Matches visiblePoll's ±10%. */
export const HEARTBEAT_JITTER_PCT = 0.1;

/** Upper bound on the delay applied to a staggered first beat. */
export const HEARTBEAT_RECONNECT_STAGGER_MS = 500;

/** One interval, spread ±HEARTBEAT_JITTER_PCT around the cadence. */
export function jitterHeartbeatMs(baseMs: number, random: () => number = Math.random): number {
    const spread = baseMs * HEARTBEAT_JITTER_PCT;
    return Math.max(1, Math.round(baseMs - spread + random() * spread * 2));
}

export type HeartbeatScheduleOptions = {
    /**
     * Mutable box holding the `socketConnected` this scheduler last saw. When it
     * disagrees with the incoming input, the run is treated as a socket-state
     * FLIP and its first beat is delayed by up to
     * {@link HEARTBEAT_RECONNECT_STAGGER_MS}; the box is then updated.
     *
     * The discrimination matters. App's heartbeat effect re-runs on many
     * triggers, and most of them — a sector change, a screen change, travel —
     * depend on the immediate beat to propagate the move to sector-mates, so
     * delaying those would be a real regression. A connectivity flip is the one
     * trigger that carries no new player state to publish, and the only one that
     * fires for every player at the same instant. Stagger just that.
     *
     * Omit the box to always beat immediately (the pre-jitter behaviour).
     */
    lastSocketConnected?: { current: boolean };
    /** Test seam. */
    random?: () => number;
};

/**
 * Arm the presence heartbeat: beat now (or after a short stagger), then keep
 * beating on a jittered chain until the returned canceller runs.
 *
 * Self-rescheduling rather than `setInterval` on purpose — re-jittering every
 * tick spreads clients progressively, where a once-jittered fixed period still
 * lands its FIRST tick inside one narrow window for everybody.
 *
 * @returns a canceller. Idempotent, safe to call from an effect cleanup.
 */
export function scheduleHeartbeat(
    beat: () => void,
    input: HeartbeatCadenceInput,
    opts: HeartbeatScheduleOptions = {},
): () => void {
    const random = opts.random ?? Math.random;
    const baseMs = heartbeatIntervalMs(input);

    const box = opts.lastSocketConnected;
    const socketStateFlipped = box ? box.current !== input.socketConnected : false;
    if (box) box.current = input.socketConnected;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const armNext = (delayMs: number): void => {
        timer = setTimeout(() => {
            if (stopped) return;
            beat();
            armNext(jitterHeartbeatMs(baseMs, random));
        }, delayMs);
    };

    if (socketStateFlipped) {
        armNext(Math.round(random() * HEARTBEAT_RECONNECT_STAGGER_MS));
    } else {
        beat();
        armNext(jitterHeartbeatMs(baseMs, random));
    }

    return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
}

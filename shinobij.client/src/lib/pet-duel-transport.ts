// ─────────────────────────────────────────────────────────────────────────────
// pet-duel-transport.ts — the wire for LIVE two-player pet duels
// (docs/pet-coliseum-player-control-plan.md §10).
//
// Binds a LockstepDuel to the shared realtime socket. Deliberately the only file
// that knows both about the socket and about the duel: the session core stays
// pure and testable, and this stays dumb enough to read in one sitting.
//
// PvP pet fights are LIVE ONLY. There is no queued invite and no offline path,
// so `challengeToDuel` refuses immediately when realtime is unavailable rather
// than pretending to send something.
// ─────────────────────────────────────────────────────────────────────────────
import { emitRealtime, onRealtime, isRealtimeConnected } from "./presence-socket";
import { createLockstepDuel, createLockstepPartyDuel, PROGRESS_REPORT_TICKS, type LockstepDuel, type LockstepInput } from "./pet-duel-lockstep";
import type { Pet } from "../types/pet";
import { parseDoctrine } from "./pet-duel-doctrine";

export type DuelSide = "p1" | "p2";

export interface DuelInvite { id: string; from: string; mode: "1v1" | "2v2" }

export interface DuelStart {
    id: string;
    seed: number;
    mode: "1v1" | "2v2";
    side: DuelSide;
    /** The challenger's sealed pets — always the "player" team in the engine. */
    player: Pet[];
    /** The opponent's sealed pets — always the "enemy" team. */
    enemy: Pet[];
    opponent: string;
}

/** A duel bound to the socket: the session plus its lifecycle plumbing. */
export interface BoundDuel {
    readonly duel: LockstepDuel;
    readonly start: DuelStart;
    /** Report playback progress upstream. Throttled to PROGRESS_REPORT_TICKS —
     *  the watermark cannot advance faster than these arrive, so this is the
     *  cadence that actually sets how responsive the fight feels. */
    reportProgress(playbackTick: number): void;
    /** Concede. The server declares the opponent the winner. */
    resign(): void;
    /** Detach every listener. Safe to call twice. */
    dispose(): void;
}

const isPetArray = (v: unknown): v is Pet[] => Array.isArray(v) && v.length > 0;

/** Parse a server `petduel:start`, or null if it is malformed. */
export function parseDuelStart(payload: unknown): DuelStart | null {
    const p = (payload ?? {}) as Record<string, unknown>;
    const side = p.side === "p1" || p.side === "p2" ? p.side : null;
    const mode = p.mode === "2v2" ? "2v2" : "1v1";
    if (typeof p.id !== "string" || typeof p.seed !== "number" || !side) return null;
    if (!isPetArray(p.player) || !isPetArray(p.enemy)) return null;
    return {
        id: p.id, seed: p.seed, mode, side,
        player: p.player, enemy: p.enemy,
        opponent: typeof p.opponent === "string" ? p.opponent : "Opponent",
    };
}

/** True when a live duel is possible at all. PvP is live-only, so a false here
 *  must surface as "you cannot duel right now", never as a silent fallback. */
export const canDuelLive = (): boolean => isRealtimeConnected();

/** Send a challenge. Returns false when realtime is down. */
/** The pet carries its own standing orders, so the roster IS the doctrine —
 *  nothing extra to pass, and nothing that can drift out of step with it. */
export function challengeToDuel(to: string, mode: "1v1" | "2v2", pets: Pet[]): boolean {
    return emitRealtime("petduel:challenge", { to, mode, pets });
}
export const acceptDuel = (id: string, pets: Pet[]): boolean =>
    emitRealtime("petduel:accept", { id, pets });
export const declineDuel = (id: string): boolean => emitRealtime("petduel:decline", { id });

/** Ask the server what actually happened to a duel — the reconnect path. A live
 *  session answers with a fresh `sync`, a settled one re-emits its `over` (which
 *  lands in the bound duel's `onOver` hook), an unknown id answers with nothing.
 *  Returns false when realtime is down and there is nobody to ask. */
export const requestDuelResult = (id: string): boolean => emitRealtime("petduel:result", { id });

/** Subscribe to incoming challenges. */
export function onDuelInvite(fn: (invite: DuelInvite) => void): () => void {
    return onRealtime("petduel:invite", (payload) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        if (typeof p.id !== "string" || typeof p.from !== "string") return;
        fn({ id: p.id, from: p.from, mode: p.mode === "2v2" ? "2v2" : "1v1" });
    });
}

/** Subscribe to the fight actually starting (both sides accepted). */
export function onDuelStart(fn: (start: DuelStart) => void): () => void {
    return onRealtime("petduel:start", (payload) => {
        const start = parseDuelStart(payload);
        if (start) fn(start);
    });
}

export function onDuelDeclined(fn: (id: string, by: string) => void): () => void {
    return onRealtime("petduel:declined", (payload) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        if (typeof p.id === "string") fn(p.id, typeof p.by === "string" ? p.by : "");
    });
}

export function onDuelError(fn: (message: string) => void): () => void {
    return onRealtime("petduel:error", (payload) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        fn(typeof p.error === "string" ? p.error : "That duel could not start.");
    });
}

/**
 * Build the lockstep session for a started duel and wire it to the socket.
 *
 * `onPeerGone` fires when the opponent drops: their pet reverts to its own AI and
 * the fight plays on, which is deliberately NOT a forfeit — both players should
 * always get a real result rather than a match that hangs.
 */
export function bindDuel(start: DuelStart, hooks: {
    onSync?: () => void;
    onPeerGone?: () => void;
    onOver?: (winner: DuelSide | null, reason: string) => void;
    onRejected?: (reason: string) => void;
} = {}): BoundDuel {
    const send = (proposal: LockstepInput) => {
        emitRealtime("petduel:input", { id: start.id, tick: proposal.tick, cmd: proposal.cmd });
    };
    // The engine always seats the challenger as "player" and the opponent as
    // "enemy". `side` therefore decides which fighters THIS client may command;
    // the other side's orders only ever arrive over the wire.
    const mine = start.side === "p1" ? "player" : "enemy";
    const duel = start.mode === "2v2"
        ? createLockstepPartyDuel(start.player[0], start.player[1] ?? null, start.enemy[0], start.enemy[1] ?? null, start.seed, mine, send)
        : createLockstepDuel(start.player[0], start.enemy[0], start.seed, mine, send);

    const offs = [
        onRealtime("petduel:sync", (payload) => {
            const p = (payload ?? {}) as Record<string, unknown>;
            if (p.id !== start.id) return;
            const inputs = Array.isArray(p.inputs) ? (p.inputs as LockstepInput[]) : [];
            const safeTick = typeof p.safeTick === "number" ? p.safeTick : -1;
            duel.ingest({ safeTick, inputs });
            hooks.onSync?.();
        }),
        onRealtime("petduel:peerGone", (payload) => {
            const p = (payload ?? {}) as Record<string, unknown>;
            if (p.id !== start.id) return;
            // Standing orders take over from a SERVER-supplied tick, so both
            // clients switch the pet to autonomy at the identical moment.
            const actorIds = Array.isArray(p.actorIds) ? (p.actorIds as string[]) : [];
            const fromTick = typeof p.fromTick === "number" ? p.fromTick : null;
            if (actorIds.length && fromTick != null) {
                duel.handOverToDoctrine({ actorIds, doctrine: parseDoctrine(p.doctrine) }, fromTick);
            }
            // A reconnecting client is replayed the hand-overs it missed — which
            // can include its OWN side's. The simulation hand-over above applies
            // either way; the "opponent disconnected" notice only fits the peer.
            if (p.side !== start.side) hooks.onPeerGone?.();
        }),
        onRealtime("petduel:over", (payload) => {
            const p = (payload ?? {}) as Record<string, unknown>;
            if (p.id !== start.id) return;
            const winner = p.winner === "p1" || p.winner === "p2" ? p.winner : null;
            hooks.onOver?.(winner, typeof p.reason === "string" ? p.reason : "ko");
        }),
        onRealtime("petduel:rejected", (payload) => {
            const p = (payload ?? {}) as Record<string, unknown>;
            if (p.id !== start.id) return;
            hooks.onRejected?.(typeof p.reason === "string" ? p.reason : "rejected");
        }),
    ];

    let lastReported = -PROGRESS_REPORT_TICKS - 1;
    let toldFinished = false;
    let disposed = false;
    return {
        duel, start,
        reportProgress(playbackTick: number) {
            if (disposed) return;
            // Nudge the server to settle once our simulation resolves. This is only
            // a HINT — the server replays the merged log itself and decides — so a
            // client that never sends it just waits for its opponent's nudge.
            if (duel.settled && !toldFinished) {
                toldFinished = true;
                emitRealtime("petduel:finished", { id: start.id });
            }
            const tick = Math.floor(playbackTick);
            if (tick - lastReported < PROGRESS_REPORT_TICKS) return;
            lastReported = tick;
            // Report PLAYBACK, not the simulation head: the watermark's meaning is
            // "both players have SEEN this", and reporting the speculative head
            // would declare ticks settled that this player has not watched yet.
            emitRealtime("petduel:progress", { id: start.id, tick });
        },
        resign() { emitRealtime("petduel:resign", { id: start.id }); },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const off of offs) off();
        },
    };
}

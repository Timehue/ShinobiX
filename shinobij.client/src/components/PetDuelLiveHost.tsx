// ─────────────────────────────────────────────────────────────────────────────
// PetDuelLiveHost.tsx — the whole lifecycle of a LIVE two-player pet duel
// (docs/pet-coliseum-player-control-plan.md §10).
//
// Owns: sending a challenge, receiving one, the accept/decline prompt, binding
// the lockstep session to the socket, mounting the fight, and handing the result
// back. Kept as one self-contained component so PetArena only has to say "the
// player clicked challenge" and render this — rather than growing another
// several hundred lines of netcode bookkeeping.
//
// PvP pet duels are LIVE ONLY. A challenge to someone who is not connected is
// refused at the click with a reason, never queued.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, lazy, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Pet } from "../types/pet";
import type { DuelResult } from "../lib/pet-duel-sim";
import {
    bindDuel, canDuelLive, challengeToDuel, acceptDuel, declineDuel, requestDuelResult,
    onDuelInvite, onDuelStart, onDuelDeclined, onDuelError,
    type BoundDuel, type DuelInvite, type DuelSide,
} from "../lib/pet-duel-transport";
import { liveDuelRosterIssue, selectLiveDuelRoster } from "../lib/pet-duel-live-roster";

/** The server lapses an unanswered challenge at its 30s invite TTL and (now)
 *  says so — this timer is the belt-and-braces for the emit itself getting lost,
 *  so "Waiting for X to accept" can never outlive the invite it describes.
 *  Slightly past the server TTL so the server's word arrives first. */
const CHALLENGE_LAPSE_MS = 35_000;

/** How long to give the server to answer a `petduel:result` query before the
 *  connection-lost exit settles from the local view instead. */
const RESULT_QUERY_GRACE_MS = 2_000;

const PetColiseumDuel = lazy(() => import("./PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));

/** Imperative handle — challenging is an ACTION, not a state the parent mirrors,
 *  so the parent calls this from its click handler rather than setting a prop and
 *  having an effect fire the network call on the way through render. */
export type PetDuelLiveHandle = {
    /** Send a challenge. Returns an error string, or null when it went out. */
    challenge: (to: string, mode: "1v1" | "2v2") => string | null;
    /** True while a fight or a prompt is on screen. */
    busy: () => boolean;
};

export type PetDuelLiveHostProps = {
    /** The pets this player brings. Sealed server-side the moment a fight starts. */
    myPets: Pet[];
    ref?: React.Ref<PetDuelLiveHandle>;
    /** Fired when a challenge is refused or declined after being sent. */
    onError: (message: string) => void;
    /** Matchmaking: accept an invite from THIS name without prompting. The queue
     *  already paired the two players, so a second "do you accept?" would just be
     *  a step to fumble — and the pair has seconds before the invite lapses. */
    autoAcceptFrom?: string | null;
    /** The settled fight. Authoritative when the server sent a winner. */
    onOutcome: (outcome: "win" | "loss" | "draw", opponent: string) => void;
    sharedImages?: Record<string, string>;
};

export function PetDuelLiveHost({ myPets, ref, onError, onOutcome, autoAcceptFrom = null, sharedImages = {} }: PetDuelLiveHostProps) {
    const [invite, setInvite] = useState<DuelInvite | null>(null);
    const [awaiting, setAwaiting] = useState<string | null>(null);
    const [bound, setBound] = useState<BoundDuel | null>(null);
    const [peerGone, setPeerGone] = useState(false);
    const boundRef = useRef<BoundDuel | null>(null);
    // The server's word on the winner. It beats the local sim, which is only a
    // prediction until the fight actually resolves.
    const serverWinner = useRef<DuelSide | null | undefined>(undefined);
    const settled = useRef(false);
    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);

    useImperativeHandle(ref, () => ({
        challenge(to, mode) {
            // Live-only: refused at the click with a reason, never queued.
            if (!canDuelLive()) return "Live duels need a realtime connection — reconnect and try again.";
            const roster = selectLiveDuelRoster(myPets, mode);
            if (!roster) return liveDuelRosterIssue(myPets, mode);
            if (boundRef.current) return "You are already in a duel.";
            if (!challengeToDuel(to, mode, roster)) return "Could not reach the server. Try again in a moment.";
            setAwaiting(to);
            return null;
        },
        busy: () => !!boundRef.current || !!invite || !!awaiting,
    }), [myPets, invite, awaiting]);

    // Read through a ref so the invite listener is not re-bound on every change,
    // which would drop an invite that landed mid-swap.
    const autoAcceptRef = useRef<string | null>(autoAcceptFrom);
    const petsRef = useRef(myPets);
    useEffect(() => { autoAcceptRef.current = autoAcceptFrom; }, [autoAcceptFrom]);
    useEffect(() => { petsRef.current = myPets; }, [myPets]);

    useEffect(() => onDuelInvite((incoming) => {
        // One duel at a time — an invite arriving mid-fight is dropped rather
        // than stacking a second prompt over the arena.
        if (boundRef.current) { declineDuel(incoming.id); return; }
        const expected = autoAcceptRef.current;
        if (expected && expected.toLowerCase() === incoming.from.toLowerCase()) {
            const roster = selectLiveDuelRoster(petsRef.current, incoming.mode);
            if (!roster) {
                declineDuel(incoming.id);
                onErrorRef.current(liveDuelRosterIssue(petsRef.current, incoming.mode)!);
                return;
            }
            if (!acceptDuel(incoming.id, roster)) {
                onErrorRef.current("Could not reach the server. Try again in a moment.");
            }
            return;
        }
        setInvite(incoming);
    }), []);

    useEffect(() => onDuelDeclined((_id, by) => {
        setAwaiting(null);
        onError(by ? `${by} declined the duel.` : "The duel was called off.");
    }), [onError]);

    // The server's invite TTL is authoritative, but its expiry emit can be lost
    // to the same flaky connection that made the opponent miss the invite. Lapse
    // locally too, or `busy()` reports this player duel-busy forever.
    useEffect(() => {
        if (!awaiting) return;
        const timer = window.setTimeout(() => {
            setAwaiting(null);
            onErrorRef.current(`${awaiting} didn't answer in time.`);
        }, CHALLENGE_LAPSE_MS);
        return () => window.clearTimeout(timer);
    }, [awaiting]);

    useEffect(() => onDuelError((message) => {
        setAwaiting(null);
        onError(message);
    }), [onError]);

    useEffect(() => onDuelStart((start) => {
        setInvite(null);
        setAwaiting(null);
        setPeerGone(false);
        settled.current = false;
        serverWinner.current = undefined;
        const next = bindDuel(start, {
            onPeerGone: () => setPeerGone(true),
            onOver: (winner) => { serverWinner.current = winner; },
        });
        boundRef.current = next;
        setBound(next);
    }), []);

    // Tear the session down if this screen goes away mid-fight.
    useEffect(() => () => { boundRef.current?.dispose(); boundRef.current = null; }, []);

    const finish = useCallback((local: DuelResult) => {
        const b = boundRef.current;
        if (!b || settled.current) return;
        settled.current = true;
        // Prefer the SERVER's verdict. The local sim is deterministic and should
        // agree, but if it ever does not, the authority is the side that replayed
        // the merged input log — never this client.
        const authoritative = serverWinner.current;
        const outcome: "win" | "loss" | "draw" = authoritative === undefined || authoritative === null
            ? local.result
            : authoritative === b.start.side ? "win" : "loss";
        onOutcome(outcome, b.start.opponent);
        b.dispose();
        boundRef.current = null;
        setBound(null);
    }, [onOutcome]);

    // The connection-lost exit. NOT a forfeit: no resign is sent — if the server
    // already settled the fight (possibly in this player's favour), the result
    // query re-delivers its `over` into serverWinner and `finish` prefers it;
    // if the fight is somehow still live, the query re-syncs it instead and this
    // settles from the local view only after the grace period.
    const resultQueryTimer = useRef<number | null>(null);
    useEffect(() => () => {
        if (resultQueryTimer.current !== null) window.clearTimeout(resultQueryTimer.current);
    }, []);
    const exitConnectionLost = useCallback(() => {
        const b = boundRef.current;
        if (!b || settled.current || resultQueryTimer.current !== null) return;
        const asked = requestDuelResult(b.start.id);
        resultQueryTimer.current = window.setTimeout(() => {
            resultQueryTimer.current = null;
            const current = boundRef.current;
            if (!current || settled.current) return;
            finish(current.duel.outcome());
        }, asked ? RESULT_QUERY_GRACE_MS : 0);
    }, [finish]);

    if (bound) {
        // The engine seats the challenger as "player"; a p2 client is watching its
        // own pet on the right, so the labels follow `side` rather than the team.
        const mine = bound.start.side === "p1" ? bound.start.player : bound.start.enemy;
        const theirs = bound.start.side === "p1" ? bound.start.enemy : bound.start.player;
        return (
            <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Linking up…</div>}>
                {peerGone && (
                    <div style={{ position: "fixed", left: "50%", top: 64, transform: "translateX(-50%)", zIndex: 100000, padding: "7px 16px", borderRadius: 999, background: "rgba(8,11,22,0.86)", border: "1px solid #f59e0b", color: "#fde68a", font: "800 12px/1.2 var(--font-display), Inter, sans-serif" }}>
                        Opponent disconnected — their pet is fighting on its own
                    </div>
                )}
                <PetColiseumDuel
                    key={bound.start.id}
                    playerPet={bound.start.player[0]}
                    enemyPet={bound.start.enemy[0]}
                    playerReservePet={bound.start.player[1]}
                    enemyReservePet={bound.start.enemy[1]}
                    seed={bound.start.seed}
                    live={bound.duel}
                    onProgress={(tick) => bound.reportProgress(tick)}
                    onOutcome={finish}
                    sharedImages={sharedImages}
                    onExit={() => { bound.resign(); finish({ result: "loss" } as DuelResult); }}
                    onConnectionLost={exitConnectionLost}
                />
                {/* Rendered for the a11y tree / tests; the duel itself portals out. */}
                <span hidden data-testid="pet-duel-live-sides">{mine.length}v{theirs.length}</span>
            </Suspense>
        );
    }

    if (invite) {
        const roster = selectLiveDuelRoster(myPets, invite.mode);
        const rosterIssue = liveDuelRosterIssue(myPets, invite.mode);
        return (
            <div className="summary-box" data-testid="pet-duel-invite" style={{ padding: "1rem", textAlign: "center" }}>
                <p style={{ margin: 0, fontWeight: 700 }}>{invite.from} challenges you to a live {invite.mode} pet duel.</p>
                <p className="hint" style={{ marginTop: 4 }}>Both of you command your pets in real time.</p>
                {rosterIssue && <p className="hint" role="alert" style={{ color: "var(--red-400)" }}>{rosterIssue}</p>}
                <div className="menu" style={{ justifyContent: "center", marginTop: 10 }}>
                    <button
                        className="admin-button"
                        disabled={!roster}
                        onClick={() => {
                            if (!roster) {
                                onError(rosterIssue!);
                                return;
                            }
                            if (!acceptDuel(invite.id, roster)) {
                                onError("Could not reach the server. Try again in a moment.");
                                return;
                            }
                            setInvite(null);
                        }}
                    >Accept</button>
                    <button className="danger-button" onClick={() => { declineDuel(invite.id); setInvite(null); }}>Decline</button>
                </div>
            </div>
        );
    }

    if (awaiting) {
        return (
            <div className="summary-box" data-testid="pet-duel-awaiting" style={{ padding: "1rem", textAlign: "center" }}>
                <p style={{ margin: 0 }}>Waiting for {awaiting} to accept…</p>
                <p className="hint" style={{ marginTop: 4 }}>Live duels need both of you present. This lapses in 30 seconds.</p>
            </div>
        );
    }

    return null;
}

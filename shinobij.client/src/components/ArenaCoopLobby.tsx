/*
 * Co-op Hollow Warfront lobby. The server owns membership, pet ownership,
 * rosters, setup, and seed; this component fails closed unless the response
 * still belongs to the active player and explicitly includes their seat.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { parseVersionedWarfrontSetup } from "../lib/arena-challenge";
import {
    arenaSelectionCount,
    assignArenaSelectionSlot,
    clearArenaSelectionSlot,
    isExactAvailableArenaSelection,
    nextOpenArenaSlot,
    normalizeArenaSelection,
} from "../lib/arena-selection";
import { normalizePlayerIdentity, PlayerRequestOwner, type PlayerOwnedRequest } from "../lib/player-request-owner";
import {
    clearArenaCoopRecovery,
    readArenaCoopRecovery,
    shouldRetainArenaCoopRecovery,
    writeArenaCoopRecovery,
} from "../lib/arena-coop-recovery";
import coopHero from "../assets/coliseum/coop-hero.webp";

const PetWarfrontMatch = lazy(() => import("./PetWarfrontMatch").then((module) => ({ default: module.PetWarfrontMatch })));

type Team = "blue" | "red";
type Lane = "top" | "mid" | "bottom" | "flex";
type Seat = { team: Team; slot: 0 | 1; name: string | null; ready: boolean; petCount: number; isYou: boolean };
type MatchPayload = { seed: number; blue: ArenaSlot[]; red: ArenaSlot[]; blueSetup: unknown; redSetup: unknown };
type PublicLobby = {
    code: string;
    host: string;
    state: "lobby" | "running";
    you: { team: Team; slot: 0 | 1; petIndexes: [number, number]; lanes: [Lane, Lane] } | null;
    seats: Seat[];
    match: MatchPayload | null;
    setupPreview: unknown;
    createdAt: number;
};

type LobbyResponse = { lobby?: PublicLobby; ok?: boolean; error?: string };
class LobbyApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = "LobbyApiError";
    }
}
const ARENA_ROLES = new Set(["defender", "tracker", "assassin", "sage"]);

function isSealedMatch(value: unknown): value is MatchPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const match = value as Partial<MatchPayload>;
    const validTeam = (team: unknown): team is ArenaSlot[] => Array.isArray(team) && team.length === 4
        && team.every((slot) => Boolean(slot && typeof slot === "object"
            && ARENA_ROLES.has(String((slot as Partial<ArenaSlot>).role))
            && (slot as Partial<ArenaSlot>).pet && typeof (slot as Partial<ArenaSlot>).pet?.id === "string"
            && Boolean((slot as Partial<ArenaSlot>).pet?.id.trim())));
    return Number.isSafeInteger(match.seed) && (match.seed ?? 0) > 0
        && validTeam(match.blue) && validTeam(match.red)
        && Boolean(parseVersionedWarfrontSetup(match.blueSetup))
        && Boolean(parseVersionedWarfrontSetup(match.redSetup));
}

async function lobbyApi(
    name: string,
    action: string,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<LobbyResponse> {
    const response = await fetch("/api/arena/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action, ...extra }),
        signal,
    });
    const data = await response.json().catch(() => ({})) as LobbyResponse;
    if (!response.ok) throw new LobbyApiError(data.error || "The co-op request failed.", response.status);
    return data;
}

function participantLobby(value: unknown, playerName: string, expectedCode?: string): PublicLobby | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const lobby = value as Partial<PublicLobby>;
    if (typeof lobby.code !== "string" || !/^(?:[A-HJ-NP-Z2-9]{4}|[A-HJ-NP-Z2-9]{8})$/.test(lobby.code)
        || (expectedCode && lobby.code !== expectedCode)
        || (lobby.state !== "lobby" && lobby.state !== "running")
        || !Number.isSafeInteger(lobby.createdAt) || (lobby.createdAt ?? 0) <= 0
        || typeof lobby.host !== "string" || !normalizePlayerIdentity(lobby.host)
        || !Array.isArray(lobby.seats) || lobby.seats.length !== 4
        || !lobby.you || (lobby.you.team !== "blue" && lobby.you.team !== "red")
        || (lobby.you.slot !== 0 && lobby.you.slot !== 1)
        || !Array.isArray(lobby.you.petIndexes) || lobby.you.petIndexes.length !== 2
        || !Array.isArray(lobby.you.lanes) || lobby.you.lanes.length !== 2) return null;
    const validSeats = lobby.seats.every((seat) => Boolean(seat && (seat.team === "blue" || seat.team === "red")
        && (seat.slot === 0 || seat.slot === 1)
        && (seat.name === null || (typeof seat.name === "string" && Boolean(normalizePlayerIdentity(seat.name))))
        && typeof seat.ready === "boolean" && Number.isInteger(seat.petCount) && seat.petCount >= 0 && seat.petCount <= 2
        && typeof seat.isYou === "boolean"));
    const seatKeys = new Set(lobby.seats.map((seat) => `${seat.team}:${seat.slot}`));
    if (!validSeats || seatKeys.size !== 4) return null;
    const preview = parseVersionedWarfrontSetup(lobby.setupPreview);
    const expectedIndexes: readonly [number, number] = lobby.you.slot === 0 ? [0, 1] : [2, 3];
    if (!preview || !lobby.you.petIndexes.every((index) => Number.isInteger(index) && index >= 0 && index < 4)
        || new Set(lobby.you.petIndexes).size !== 2
        || lobby.you.petIndexes.some((index, position) => index !== expectedIndexes[position])
        || !lobby.you.lanes.every((lane, index) => preview.deployment[lobby.you!.petIndexes[index]] === lane)) return null;
    const normalized = normalizePlayerIdentity(playerName);
    const ownSeats = lobby.seats.filter((seat) => seat?.isYou
        && seat.team === lobby.you!.team && seat.slot === lobby.you!.slot
        && typeof seat.name === "string" && normalizePlayerIdentity(seat.name) === normalized);
    if (ownSeats.length !== 1 || lobby.seats.filter((seat) => seat.isYou).length !== 1) return null;
    if (lobby.state === "lobby" ? lobby.match !== null : !isSealedMatch(lobby.match)) return null;
    return lobby as PublicLobby;
}

const TEAM_COLOR: Record<Team, string> = { blue: "#3b82f6", red: "var(--danger)" };
const LANE_LABEL: Record<Lane, string> = { top: "Top", mid: "Mid", bottom: "Bottom", flex: "Flex" };

const COOP_CSS = `.wf-coop-overlay{position:fixed;inset:0;z-index:1000000;background:#05060aeb;display:grid;place-items:center;padding:max(1rem,env(safe-area-inset-top)) max(1rem,env(safe-area-inset-right)) max(1rem,env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left))}.wf-coop-dialog{outline:0;max-width:100%;max-height:100%}.wf-coop-overlay button,.wf-coop-overlay input{min-height:44px}.wf-coop-box{background:var(--slate-900);border:1px solid var(--slate-800);border-radius:10px;padding:.7rem .85rem}.wf-coop-shell{width:min(580px,94vw);max-height:min(90vh,calc(100dvh - 2rem));overflow-y:auto;background:#0b1120}.wf-coop-error{width:min(470px,94vw);background:#0b1120}.wf-coop-error strong{color:#fca5a5}.wf-coop-error p,.wf-coop-copy{color:var(--text-dim)}.wf-coop-error button{background:#1e3a8a}.wf-coop-hero{position:relative;height:108px;border-radius:10px;overflow:hidden;margin-bottom:.7rem;border:1px solid var(--slate-800);background-size:cover;background-position:center 32%}.wf-coop-shade{position:absolute;inset:0;background:linear-gradient(180deg,#080c1633,#080c168c 55%,#080c16e6)}.wf-coop-close{position:absolute;top:8px;right:8px;z-index:1;background:#0f172ad9}.wf-coop-title{position:absolute;left:14px;bottom:10px;z-index:1;font-size:1.2rem;letter-spacing:.04em;text-shadow:0 2px 6px #000f}.wf-coop-grid{display:grid;gap:.7rem}.wf-coop-copy{margin:0;font-size:.85rem}.wf-coop-create button{width:100%;background:#0e7490}.wf-coop-join{display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:end}.wf-coop-join label{grid-column:1/-1;color:#e2e8f0;font-weight:700;font-size:.8rem}.wf-coop-join input{text-transform:uppercase;letter-spacing:.16em;text-align:center;font-weight:700;min-width:0}.wf-coop-join button{background:#6d28d9}.wf-coop-code{text-align:center}.wf-coop-code>div:first-child{color:var(--text-dim);font-size:.75rem}.wf-coop-code-row{display:flex;justify-content:center;align-items:center;gap:.5rem;margin-top:.2rem}.wf-coop-code-row span{font-size:clamp(1.15rem,5vw,1.8rem);font-weight:800;letter-spacing:.18em;overflow-wrap:anywhere}.wf-coop-code-row button{background:var(--slate-700)}.wf-coop-teams{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}.wf-coop-team-title{font-weight:700;font-size:.8rem;margin-bottom:.3rem}.wf-coop-seat{display:flex;align-items:center;gap:.4rem;font-size:.85rem;padding:.15rem 0}.wf-coop-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.wf-coop-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wf-coop-ready{margin-left:auto;font-size:.75rem}.wf-coop-picker-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem}.wf-coop-picker-head strong{font-size:.85rem}.wf-coop-picker-head button{margin-left:auto}.wf-coop-warning{color:var(--gold-2);margin:0;font-size:.8rem}.wf-coop-lanes{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin:.45rem 0}.wf-coop-lane{display:grid;text-align:left;gap:1px;padding:.4rem .55rem;border:1px solid #475569;background:#0f172a;color:#e2e8f0;border-radius:8px}.wf-coop-lane[aria-pressed=true]{border-color:#67e8f9;box-shadow:0 0 0 2px #67e8f929}.wf-coop-lane span{font-size:.7rem;color:#7dd3fc;font-weight:900;text-transform:uppercase}.wf-coop-lane small{color:#94a3b8}.wf-coop-mapping{margin:.2rem 0 .5rem;color:#bae6fd;font-size:.78rem}.wf-coop-pets{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:.35rem}.wf-coop-pet{padding:.3rem;border-radius:8px;display:grid;justify-items:center;gap:2px}.wf-coop-pet img,.wf-coop-pet-placeholder{width:40px;height:40px;border-radius:50%;object-fit:cover}.wf-coop-pet-placeholder{background:var(--slate-700)}.wf-coop-pet span{font-size:.68rem;max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wf-coop-pet small{font-size:.6rem;color:#cbd5e1}.wf-coop-actions{display:flex;gap:.5rem}.wf-coop-actions .start{background:#0e7490;flex:1}.wf-coop-actions .leave{background:#7f1d1d}.wf-coop-wait{color:var(--text-muted);margin:0;font-size:.75rem;text-align:center}.wf-coop-message{color:var(--red-400);margin:.6rem 0 0;font-size:.85rem}@media(max-width:480px){.wf-coop-overlay{place-items:stretch;padding:max(.5rem,env(safe-area-inset-top)) max(.5rem,env(safe-area-inset-right)) max(.5rem,env(safe-area-inset-bottom)) max(.5rem,env(safe-area-inset-left))}.wf-coop-dialog,.wf-coop-shell{width:100%;max-height:100%}.wf-coop-teams{grid-template-columns:1fr}.wf-coop-actions{flex-direction:column}.wf-coop-join{grid-template-columns:1fr}.wf-coop-join label{grid-column:auto}}`;

export function ArenaCoopLobby({ character, sharedImages, onExit }: {
    character: Character;
    sharedImages: Record<string, string>;
    onExit: () => void;
}) {
    const myName = character.name;
    const normalizedName = normalizePlayerIdentity(myName);
    const availablePets = character.pets.filter((pet) => !isPetOnExpedition(pet));
    const availableIds = new Set(availablePets.map((pet) => pet.id));
    const [requestOwner] = useState(() => new PlayerRequestOwner());
    const requestSequence = useRef(0);
    const appliedSequence = useRef(0);
    const [lobby, setLobby] = useState<PublicLobby | null>(null);
    const [joinCode, setJoinCode] = useState("");
    const [picks, setPicks] = useState<string[]>(() => normalizeArenaSelection([], 2));
    const [activePickSlot, setActivePickSlot] = useState(0);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(() => Boolean(readArenaCoopRecovery(myName)));
    const [pollRevision, setPollRevision] = useState(0);
    const finishedMatchKey = useRef<string | null>(null);

    useLayoutEffect(() => {
        const epoch = requestOwner.activate(myName);
        requestSequence.current = 0;
        appliedSequence.current = 0;
        return () => requestOwner.deactivate(epoch);
    }, [requestOwner, normalizedName, myName]);

    const applyResponseLobby = useCallback((
        attempt: PlayerOwnedRequest,
        value: unknown,
        sequence: number,
        expectedCode?: string,
    ): PublicLobby | null => {
        if (!requestOwner.isCurrent(attempt) || sequence < appliedSequence.current) return null;
        const next = participantLobby(value, attempt.playerName, expectedCode);
        if (!next) throw new Error("The server did not return a participant-safe co-op lobby. Nothing was changed.");
        appliedSequence.current = sequence;
        const existingRecovery = readArenaCoopRecovery(attempt.playerName);
        writeArenaCoopRecovery({
            version: 1,
            normalizedPlayerName: attempt.normalizedPlayerName,
            code: next.code,
            createdAt: existingRecovery?.code === next.code ? existingRecovery.createdAt : Date.now(),
        });
        setLobby(next);
        return next;
    }, [requestOwner]);

    // A running lobby is a short-lived participant recovery record on the
    // server. Reopen the exact account-scoped code after a refresh; another
    // signed-in player has a different storage key and can never inherit it.
    useEffect(() => {
        const saved = readArenaCoopRecovery(myName);
        if (!saved) return;
        const attempt = requestOwner.begin("coop-recover", myName);
        if (!attempt) return;
        const sequence = ++requestSequence.current;
        void lobbyApi(attempt.playerName, "poll", { code: saved.code }, attempt.controller.signal)
            .then((data) => {
                if (!requestOwner.isCurrent(attempt)) return;
                applyResponseLobby(attempt, data.lobby, sequence, saved.code);
            })
            .catch((caught: unknown) => {
                if (!requestOwner.isCurrent(attempt)) return;
                if (caught instanceof DOMException && caught.name === "AbortError") return;
                if (caught instanceof LobbyApiError && (caught.status === 403 || caught.status === 404)) {
                    clearArenaCoopRecovery(attempt.playerName, saved.code);
                }
                setError(caught instanceof Error ? caught.message : "The saved co-op lobby could not be recovered.");
            })
            .finally(() => {
                if (requestOwner.finish(attempt)) setBusy(false);
            });
        return () => requestOwner.abort("coop-recover");
    }, [applyResponseLobby, myName, normalizedName, requestOwner]);

    // One non-overlapping poll chain; identity cleanup aborts both fetch and
    // timer, while sequence ordering prevents an older poll overwriting a newer
    // lock-in/start response.
    useEffect(() => {
        if (!lobby || lobby.state === "running") return;
        const owner = requestOwner;
        const attempt = owner.begin("coop-poll", myName);
        if (!attempt) return;
        const code = lobby.code;
        let timer: number | null = null;
        const poll = async () => {
            if (!owner.isCurrent(attempt)) return;
            const sequence = ++requestSequence.current;
            try {
                const data = await lobbyApi(attempt.playerName, "poll", { code }, attempt.controller.signal);
                if (!owner.isCurrent(attempt)) return;
                applyResponseLobby(attempt, data.lobby, sequence, code);
            } catch (caught) {
                if (!owner.isCurrent(attempt)) return;
                if (caught instanceof DOMException && caught.name === "AbortError") return;
                if (caught instanceof LobbyApiError && (caught.status === 403 || caught.status === 404)) {
                    clearArenaCoopRecovery(attempt.playerName, code);
                    setLobby(null);
                    owner.abort("coop-poll");
                    setError(caught.message);
                    return;
                }
                setError(caught instanceof Error ? caught.message : "The lobby could not be refreshed.");
            }
            if (owner.isCurrent(attempt)) timer = window.setTimeout(() => { void poll(); }, 2_000);
        };
        timer = window.setTimeout(() => { void poll(); }, 2_000);
        return () => {
            if (timer !== null) window.clearTimeout(timer);
            owner.abort("coop-poll");
        };
    }, [applyResponseLobby, lobby, myName, normalizedName, pollRevision, requestOwner]);

    const runAction = async (fn: (attempt: PlayerOwnedRequest, sequence: number) => Promise<void>) => {
        const owner = requestOwner;
        if (owner.current("coop-action")) return;
        // A poll can have read the old lobby immediately before this mutation
        // commits, then arrive afterward. Abort its exact attempt before issuing
        // create/join/lock/start so that stale projection can never overwrite a
        // newer ready or running response, regardless of response order.
        owner.abort("coop-poll");
        const attempt = owner.begin("coop-action", myName);
        if (!attempt) return;
        const sequence = ++requestSequence.current;
        setBusy(true);
        setError("");
        try {
            await fn(attempt, sequence);
        } catch (caught) {
            if (!owner.isCurrent(attempt)) return;
            if (caught instanceof DOMException && caught.name === "AbortError") return;
            setError(caught instanceof Error ? caught.message : "The co-op request failed.");
        } finally {
            if (owner.finish(attempt)) {
                setBusy(false);
                // The action aborted the old poll. Restart the chain even when
                // the mutation failed and the lobby object itself did not change.
                setPollRevision((revision) => revision + 1);
            }
        }
    };

    const create = () => { void runAction(async (attempt, sequence) => {
        const data = await lobbyApi(attempt.playerName, "create", {}, attempt.controller.signal);
        if (!requestOwner.isCurrent(attempt)) return;
        applyResponseLobby(attempt, data.lobby, sequence);
    }); };
    const join = () => { void runAction(async (attempt, sequence) => {
        const code = joinCode.trim().toUpperCase();
        if (code.length !== 4 && code.length !== 8) throw new Error("Enter the 8-character lobby code (or a still-active legacy 4-character code).");
        const data = await lobbyApi(attempt.playerName, "join", { code }, attempt.controller.signal);
        if (!requestOwner.isCurrent(attempt)) return;
        applyResponseLobby(attempt, data.lobby, sequence, code);
    }); };
    const lockIn = () => { void runAction(async (attempt, sequence) => {
        const snapshot = lobby;
        if (!snapshot?.you || !participantLobby(snapshot, attempt.playerName, snapshot.code)) throw new Error("Your participant seat is no longer active.");
        if (!isExactAvailableArenaSelection(picks, availableIds, 2)) throw new Error("Assign exactly two unique, available pets to your two deployment lanes.");
        const data = await lobbyApi(attempt.playerName, "pets", { code: snapshot.code, petIds: [...picks] }, attempt.controller.signal);
        if (!requestOwner.isCurrent(attempt)) return;
        applyResponseLobby(attempt, data.lobby, sequence, snapshot.code);
    }); };

    const mySeat = lobby?.seats.find((seat) => seat.isYou) ?? null;
    const iAmHost = Boolean(lobby && normalizePlayerIdentity(lobby.host) === normalizedName && mySeat);
    const allParticipantsReady = Boolean(lobby && lobby.seats.filter((seat) => seat.name).every((seat) => seat.ready));
    const canHostStart = Boolean(iAmHost && mySeat?.ready && allParticipantsReady);
    const startMatch = () => { void runAction(async (attempt, sequence) => {
        const snapshot = lobby;
        if (!snapshot?.you || !participantLobby(snapshot, attempt.playerName, snapshot.code)) throw new Error("Your participant seat is no longer active.");
        const liveOwnSeat = snapshot.seats.find((seat) => seat.isYou);
        const ready = snapshot.seats.filter((seat) => seat.name).every((seat) => seat.ready);
        if (normalizePlayerIdentity(snapshot.host) !== attempt.normalizedPlayerName || !liveOwnSeat?.ready || !ready) {
            throw new Error("Only the ready host can start after every joined player locks their pets.");
        }
        const data = await lobbyApi(attempt.playerName, "start", { code: snapshot.code }, attempt.controller.signal);
        if (!requestOwner.isCurrent(attempt)) return;
        applyResponseLobby(attempt, data.lobby, sequence, snapshot.code);
    }); };

    const requestExit = () => {
        const snapshot = lobby;
        const playerName = myName;
        requestOwner.abortAll();
        // An explicit pre-start leave ends recovery for this account. A running
        // leave is only a UI/presence acknowledgement server-side, so retain its
        // code through the sealed match's bounded recovery lifetime.
        const snapshotMatchKey = snapshot?.match ? `${snapshot.code}:${snapshot.match.seed}` : null;
        const matchFinished = snapshotMatchKey !== null && finishedMatchKey.current === snapshotMatchKey;
        if (!shouldRetainArenaCoopRecovery(snapshot?.state, matchFinished)) {
            clearArenaCoopRecovery(playerName, snapshot?.code);
        }
        if (snapshot?.you && participantLobby(snapshot, playerName, snapshot.code)) {
            void fetch("/api/arena/lobby", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: playerName, action: "leave", code: snapshot.code }),
                keepalive: true,
            }).catch(() => undefined);
        }
        onExit();
    };

    if (lobby?.state === "running" && lobby.match) {
        const blueSetup = parseVersionedWarfrontSetup(lobby.match.blueSetup);
        const redSetup = parseVersionedWarfrontSetup(lobby.match.redSetup);
        if (!lobby.you || !blueSetup || !redSetup) return (
            <DialogOverlay titleId="wf-coop-error-title" descriptionId="wf-coop-error-copy" onRequestClose={requestExit}>
                <div className="wf-coop-box wf-coop-error" role="alert">
                    <strong id="wf-coop-error-title">The sealed co-op plan could not be verified.</strong>
                    <p id="wf-coop-error-copy">Membership, both versioned deployments, and both playbooks must match the server seal. This replay was stopped before clients could diverge.</p>
                    <button type="button" data-initial-focus onClick={requestExit}>Leave lobby</button>
                </div>
            </DialogOverlay>
        );
        return (
            <Suspense fallback={
                <DialogOverlay titleId="wf-coop-loading-title" onRequestClose={requestExit}>
                    <div className="wf-coop-box wf-coop-error"><strong id="wf-coop-loading-title">Loading the Warfront...</strong></div>
                </DialogOverlay>
            }>
                <PetWarfrontMatch
                    blue={lobby.match.blue}
                    red={lobby.match.red}
                    seed={lobby.match.seed}
                    autoBuy={blueSetup.buyPolicy}
                    opponentAutoBuy={redSetup.buyPolicy}
                    stance={blueSetup.stance}
                    opponentStance={redSetup.stance}
                    doctrine={blueSetup.doctrine}
                    opponentDoctrine={redSetup.doctrine}
                    deployment={blueSetup.deployment}
                    opponentDeployment={redSetup.deployment}
                    buildPackage={blueSetup.buildPackage}
                    opponentBuildPackage={redSetup.buildPackage}
                    coachOrder={blueSetup.coachOrder}
                    opponentCoachOrder={redSetup.coachOrder}
                    objectiveTechnique={blueSetup.objectiveTechnique}
                    opponentObjectiveTechnique={redSetup.objectiveTechnique}
                    counterstrike={blueSetup.counterstrike}
                    opponentCounterstrike={redSetup.counterstrike}
                    localTeam={lobby.you.team}
                    onResult={() => {
                        finishedMatchKey.current = `${lobby.code}:${lobby.match!.seed}`;
                        clearArenaCoopRecovery(myName, lobby.code);
                    }}
                    onExit={requestExit}
                />
            </Suspense>
        );
    }

    const lanes: readonly Lane[] = lobby?.you?.lanes ?? ["top", "mid"];
    const pickedCount = arenaSelectionCount(picks);

    return (
        <DialogOverlay titleId="wf-coop-title" descriptionId="wf-coop-description" onRequestClose={requestExit}>
            <div className="wf-coop-box wf-coop-shell">
                <div className="wf-coop-hero" style={{ backgroundImage: `url(${coopHero})` }}>
                    <div className="wf-coop-shade" />
                    <button type="button" className="wf-coop-close" data-initial-focus onClick={requestExit}>Close</button>
                    <strong className="wf-coop-title" id="wf-coop-title">Co-op Hollow Warfront</strong>
                </div>

                {!lobby ? (
                    <div className="wf-coop-grid">
                        <p className="wf-coop-copy" id="wf-coop-description">
                            Team up for a 4v4 lane war. Each participant owns two named deployment lanes; empty seats are filled by AI. The server seals membership, rosters, setup, and one shared replay.
                        </p>
                        <div className="wf-coop-box wf-coop-create">
                            <button type="button" onClick={create} disabled={busy}>Create a lobby</button>
                        </div>
                        <div className="wf-coop-box wf-coop-join">
                            <label htmlFor="wf-coop-code-input">Lobby code</label>
                            <input id="wf-coop-code-input" aria-describedby="wf-coop-code-help"
                                value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 8))}
                                placeholder="8 characters" autoComplete="off" inputMode="text" maxLength={8} />
                            <button type="button" onClick={join} disabled={busy || (joinCode.length !== 4 && joinCode.length !== 8)}>Join</button>
                            <small id="wf-coop-code-help" className="wf-coop-copy">New codes contain 8 letters/numbers; legacy 4-character codes remain accepted while active.</small>
                        </div>
                    </div>
                ) : (
                    <div className="wf-coop-grid">
                        <p className="wf-coop-copy" id="wf-coop-description">You are verified in this lobby. Your two picks remain in their named lanes when you swap or update them.</p>
                        <div className="wf-coop-box wf-coop-code">
                            <div>Lobby code - share with friends</div>
                            <div className="wf-coop-code-row">
                                <span aria-label={`Lobby code ${lobby.code.split("").join(" ")}`}>{lobby.code}</span>
                                <button type="button" onClick={() => { void navigator.clipboard?.writeText(lobby.code); }} aria-label="Copy lobby code">Copy</button>
                            </div>
                        </div>

                        <div className="wf-coop-teams" aria-label="Lobby participants">
                            {(["blue", "red"] as Team[]).map((team) => (
                                <div className="wf-coop-box" key={team} style={{ borderColor: TEAM_COLOR[team] }}>
                                    <div className="wf-coop-team-title" style={{ color: TEAM_COLOR[team] }}>{team === "blue" ? "Blue Team" : "Red Team"}</div>
                                    {lobby.seats.filter((seat) => seat.team === team).map((seat) => (
                                        <div className="wf-coop-seat" key={`${team}-${seat.slot}`}>
                                            <span className="wf-coop-dot" aria-hidden="true" style={{ background: seat.name ? (seat.ready ? "var(--success)" : "#eab308") : "var(--slate-600)" }} />
                                            <span className="wf-coop-name" style={{ color: seat.name ? "var(--slate-200)" : "var(--text-muted)" }}>
                                                {seat.name ? `${seat.name}${seat.isYou ? " (you)" : ""}` : "Open - AI"}
                                            </span>
                                            {seat.name ? <span className="wf-coop-ready" style={{ color: seat.ready ? "var(--success)" : "var(--text-dim)" }}>{seat.ready ? "ready" : "picking"}</span> : null}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div className="wf-coop-box">
                            <div className="wf-coop-picker-head">
                                <strong>Your deployment {mySeat?.ready ? "- locked" : `(${pickedCount}/2)`}</strong>
                                <button type="button" onClick={lockIn} disabled={busy || !isExactAvailableArenaSelection(picks, availableIds, 2)}
                                    style={{ background: mySeat?.ready ? "#0369a1" : "#16a34a" }}>
                                    {mySeat?.ready ? "Update locked lanes" : "Lock two lanes"}
                                </button>
                            </div>
                            <p className="wf-coop-mapping" role="note">Server-sealed mapping: seat {mySeat ? mySeat.slot + 1 : "?"} owns roster slot {(lobby.you?.petIndexes[0] ?? 0) + 1} / {LANE_LABEL[lanes[0]]} and slot {(lobby.you?.petIndexes[1] ?? 1) + 1} / {LANE_LABEL[lanes[1]]}. Select a lane, then a pet; reassignment swaps without shifting.</p>
                            <div className="wf-coop-lanes" role="group" aria-label="Your server-mapped deployment lanes">
                                {lanes.map((lane, index) => {
                                    const pet = availablePets.find((candidate) => candidate.id === picks[index]);
                                    return (
                                        <button type="button" className="wf-coop-lane" key={lane}
                                            aria-pressed={activePickSlot === index}
                                            aria-label={`${LANE_LABEL[lane]} lane, pick ${index + 1}, ${pet ? petDisplayName(pet) : "open"}. Select to assign or swap.`}
                                            onClick={() => setActivePickSlot(index)}>
                                            <span>{LANE_LABEL[lane]} - pick {index + 1}</span>
                                            <strong>{pet ? petDisplayName(pet) : "Open lane"}</strong>
                                            <small>{pet ? "Select, then choose another pet to replace or swap." : "Select, then choose a pet below."}</small>
                                        </button>
                                    );
                                })}
                            </div>
                            {availablePets.length < 2 ? (
                                <p className="wf-coop-warning">You need at least two pets that are not on expeditions.</p>
                            ) : (
                                <div className="wf-coop-pets" aria-label="Available pets">
                                    {availablePets.map((pet) => {
                                        const assignedSlot = picks.indexOf(pet.id);
                                        const selected = assignedSlot >= 0;
                                        const role = (pet.role ?? derivePetRole(pet).role);
                                        const roleLabel = ROLE_META[role]?.label ?? role;
                                        const image = petCardImage(pet, sharedImages);
                                        const targetLane = lanes[activePickSlot];
                                        return (
                                            <button type="button" key={pet.id} className={`wf-coop-pet ${petVisualVariantClass(pet)}`}
                                                aria-pressed={selected}
                                                aria-label={`${petDisplayName(pet)}, ${roleLabel}${selected ? `, pick ${assignedSlot + 1}, ${LANE_LABEL[lanes[assignedSlot]]} lane` : ""}. ${selected && assignedSlot === activePickSlot ? "Press to clear this lane." : `Press to assign ${LANE_LABEL[targetLane]}${selected ? " and swap lanes" : ""}.`}`}
                                                onClick={() => {
                                                    const next = selected && assignedSlot === activePickSlot
                                                        ? clearArenaSelectionSlot(picks, activePickSlot, 2)
                                                        : assignArenaSelectionSlot(picks, activePickSlot, pet.id, 2);
                                                    setPicks(next);
                                                    setActivePickSlot(nextOpenArenaSlot(next, activePickSlot));
                                                }}
                                                style={{ background: selected ? "#0e7490" : "var(--slate-800)", border: selected ? "2px solid #22d3ee" : "2px solid transparent" }}>
                                                {image ? <img src={image} alt="" /> : <div className="wf-coop-pet-placeholder" />}
                                                <span>{petDisplayName(pet)}</span>
                                                <small>{selected ? `${assignedSlot + 1}. ${LANE_LABEL[lanes[assignedSlot]]}` : roleLabel}</small>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="wf-coop-actions">
                            {iAmHost ? <button type="button" className="start" onClick={startMatch} disabled={busy || !canHostStart}>Start match</button> : null}
                            <button type="button" className="leave" onClick={requestExit}>Leave lobby</button>
                        </div>
                        {iAmHost && !canHostStart ? <p className="wf-coop-wait">Lock your two lanes and wait for every joined player to become ready. Empty seats will use sealed AI pairs.</p> : null}
                        {!iAmHost ? <p className="wf-coop-wait">Waiting for the ready host to start.</p> : null}
                    </div>
                )}

                {error ? <p className="wf-coop-message" role="alert">{error}</p> : null}
            </div>
        </DialogOverlay>
    );
}

function DialogOverlay({ children, titleId, descriptionId, onRequestClose }: {
    children: React.ReactNode;
    titleId: string;
    descriptionId?: string;
    onRequestClose: () => void;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        const initial = dialog?.querySelector<HTMLElement>("[data-initial-focus]") ?? dialog;
        initial?.focus();
        return () => {
            const restore = restoreFocusRef.current;
            if (restore?.isConnected) restore.focus();
        };
    }, []);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onRequestClose();
            return;
        }
        if (event.key !== "Tab") return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
            .filter((element) => element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return createPortal(
        <div className="wf-coop-overlay">
            <style>{COOP_CSS}</style>
            <div ref={dialogRef} className="wf-coop-dialog" role="dialog" aria-modal="true"
                aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={onKeyDown}>
                {children}
            </div>
        </div>,
        document.body,
    );
}

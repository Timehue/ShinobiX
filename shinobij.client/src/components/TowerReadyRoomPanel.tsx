import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { visiblePoll } from "../lib/poll";
import { isRealtimeConnected, onStatus, onTowerKick } from "../lib/presence-socket";
import {
    fetchTowerParty,
    fetchTowerState,
    launchTowerPartyWithLostResponseRetry,
    mutateTowerPartyWithLostResponseRetry,
    towerPlayerSlug,
    TowerPartyApiError,
    type TowerHostLoadout,
    type TowerFloorMeta,
    type TowerPartyBinding,
    type TowerPartyEnvelope,
    type TowerPartyInvitationView,
    type TowerPartyMutation,
    type TowerPartyView,
    type TowerSession,
} from "../lib/towers-api";
import { resolveTowerStoryArt } from "../lib/tower-art-manifest";
import type { Character } from "../types/character";
import { canStartTowerRoomPoll, isTowerRoomResponseCurrent, reconcileTowerRoomEnvelope, type TowerRoomResultMode } from "../lib/tower-party-state";
import { gameConfirm } from "./GameAlert";

const EMPTY_ROOM: TowerPartyEnvelope = { party: null, invitations: [] };
const READY_ROOM_OBJECTIVE_LABEL: Record<string, string> = {
    "defeat-all": "Defeat all enemies",
    "defeat-boss": "Defeat the boss",
    "defeat-all-then-boss": "Clear guards, then boss",
    "protect-npc": "Protect the allied shinobi",
    "kill-escort": "Escort and clear",
    "reach-tile": "Reach the objective",
    "break-objective": "Break the objective",
    "survive": "Survive the hold",
    "kill-adds-first": "Eliminate adds before boss",
};
type ReadyRoomSyncState = "checking" | "live" | "reconnecting";

function setRoomIfChanged(setRoom: Dispatch<SetStateAction<TowerPartyEnvelope>>, next: TowerPartyEnvelope, resultMode: TowerRoomResultMode = "adopt") {
    setRoom(current => reconcileTowerRoomEnvelope(current, next, resultMode));
}

function readyRoomBusyLabel(busy: string | null): string | null {
    if (busy === "launch") return "Launching…";
    if (busy === "create") return "Opening…";
    if (busy === "join" || busy === "accept") return "Joining…";
    if (busy === "decline") return "Declining…";
    if (busy === "leave") return "Leaving…";
    if (busy === "invite") return "Inviting…";
    if (busy === "kick") return "Removing…";
    if (busy === "revoke-invite") return "Cancelling…";
    if (busy === "add-ai") return "Recruiting…";
    if (busy === "remove-ai") return "Releasing…";
    if (busy === "ready" || busy === "unready") return "Updating…";
    return busy ? "Updating…" : null;
}

function TowerRoomExpiry({ expiresAt }: { expiresAt: number }) {
    const [now, setNow] = useState(() => Date.now());
    const remaining = Math.max(0, expiresAt - now);
    const warning = remaining <= 5 * 60_000;

    useEffect(() => {
        const interval = warning ? 10_000 : 60_000;
        const id = window.setInterval(() => setNow(Date.now()), interval);
        return () => window.clearInterval(id);
    }, [warning, expiresAt]);

    const totalMinutes = Math.ceil(remaining / 60_000);
    const text = remaining <= 0 ? "Room expired · reconnecting"
        : totalMinutes > 60 ? `Room expires in ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
        : totalMinutes > 1 ? `Room expires in ${totalMinutes} min`
        : `Room expires in ${Math.max(1, Math.ceil(remaining / 1_000))} sec`;
    return <span className={`tower-ready-room-expiry${warning ? " is-warning" : ""}`} role="timer" aria-live="off">{text}</span>;
}

function TowerReadyRoomInvitations({
    invitations,
    activeParty,
    busy,
    connectionUnavailable,
    externalBattleActive,
    secondary = false,
    onRespond,
}: {
    invitations: TowerPartyInvitationView[];
    activeParty: boolean;
    busy: boolean;
    connectionUnavailable: boolean;
    externalBattleActive: boolean;
    secondary?: boolean;
    onRespond: (invitation: TowerPartyInvitationView, action: "accept" | "decline") => void;
}) {
    if (invitations.length === 0) return null;

    const cards = (
        <div className="tower-ready-room-invitation-list">
            {invitations.map(invitation => (
                <article key={invitation.partyId} className="tower-ready-room-invite">
                    <div className="tower-ready-room-invite-copy">
                        <span>Squad invitation</span>
                        <strong>{invitation.hostDisplayName ?? invitation.hostSlug}</strong>
                        <small>{bindingLabel(invitation.binding)} · {invitationSizeLabel(invitation)}</small>
                        <TowerRoomExpiry expiresAt={invitation.expiresAt} />
                    </div>
                    <span className="tower-ready-room-inline-actions">
                        <button className="tower-ready-room-accept" type="button"
                            onClick={() => onRespond(invitation, "accept")}
                            disabled={busy || activeParty || connectionUnavailable || externalBattleActive}>
                            Accept
                        </button>
                        <button className="tower-ready-room-secondary" type="button"
                            onClick={() => onRespond(invitation, "decline")}
                            disabled={busy || connectionUnavailable}>
                            Decline
                        </button>
                    </span>
                </article>
            ))}
        </div>
    );

    if (secondary) {
        return (
            <details className="tower-ready-room-other-invitations">
                <summary>
                    <span>Other squad invitations</span>
                    <small>Leave this room before accepting another squad.</small>
                    <b aria-label={`${invitations.length} invitation${invitations.length === 1 ? "" : "s"}`}>{invitations.length}</b>
                </summary>
                {cards}
            </details>
        );
    }

    return (
        <section className="tower-ready-room-invitations" aria-labelledby="tower-ready-room-invitations-title">
            <header className="tower-ready-room-section-head">
                <div>
                    <span>Join a waiting squad</span>
                    <h3 id="tower-ready-room-invitations-title">Incoming invitations</h3>
                </div>
                <b aria-label={`${invitations.length} invitation${invitations.length === 1 ? "" : "s"}`}>{invitations.length}</b>
            </header>
            {cards}
        </section>
    );
}

function bindingLabel(binding: TowerPartyBinding): string {
    return binding.mode === "story"
        ? `Story Floor ${binding.floor}`
        : `Endless Spire Floor ${binding.ascensionTier}`;
}

function readyRoomObjectiveLabel(objective: string): string {
    return READY_ROOM_OBJECTIVE_LABEL[objective] ?? objective.replace(/-/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function invitationSizeLabel(invitation: TowerPartyInvitationView): string {
    return invitation.binding.mode === "spire"
        ? `${invitation.memberCount}/4 players`
        : `${invitation.memberCount}/4 slots · 2 minimum`;
}

function leaveRoomPrompt(party: TowerPartyView, isHost: boolean): string {
    if (isHost && party.liveMemberCount > 1) {
        return "Leave this Ready Room? Host control will pass to another live member and every live member will need to mark ready again.";
    }
    if (isHost) {
        return "Leave and close this Ready Room? A novice AI cannot keep the room open, and its invite code will stop working.";
    }
    return "Leave this Ready Room? The squad will remain open, but every live member will need to mark ready again.";
}

function partyErrorText(error: unknown): string {
    if (error instanceof TowerPartyApiError) {
        const memberGuidance = error.memberRequirements?.map(requirement => {
            const needs = [
                requirement.requiredLevel ? `reach level ${requirement.requiredLevel}` : null,
                requirement.requiredFloor ? (requirement.requiredFloor <= 1
                    ? "unlock Story Floor 1"
                    : `clear through Story Floor ${requirement.requiredFloor - 1}`) : null,
            ].filter((need): need is string => Boolean(need));
            return needs.length > 0 ? `${requirement.member}: ${needs.join(" and ")}` : requirement.member;
        });
        const members = memberGuidance?.length
            ? ` Member requirements: ${memberGuidance.join("; ")}.`
            : error.members?.length ? ` Affected: ${error.members.join(", ")}.` : "";
        const tier = error.requiredTier ? ` Required Spire floor: ${error.requiredTier}.` : "";
        const floor = !memberGuidance?.length && error.requiredFloor ? (error.requiredFloor <= 1
            ? " Story Floor 1 must be unlocked."
            : ` Clear through Story Floor ${error.requiredFloor - 1} first.`) : "";
        const level = !memberGuidance?.length && error.requiredLevel ? ` Required level: ${error.requiredLevel}.` : "";
        return `${error.message}${members}${tier}${floor}${level}`;
    }
    return String((error as Error)?.message ?? error);
}

export function TowerReadyRoomPanel({
    character,
    following,
    storyFloor,
    storyFloorMeta,
    storyFloorActionable,
    spireTier,
    towersUnlocked,
    externalBattleActive = false,
    hostLoadout,
    updateCharacter,
    onPartyChange,
    onEnter,
}: {
    character: Character;
    following: string[];
    storyFloor: number | null;
    storyFloorMeta?: TowerFloorMeta | null;
    storyFloorActionable: boolean;
    spireTier: number;
    towersUnlocked: boolean;
    externalBattleActive?: boolean;
    hostLoadout?: TowerHostLoadout;
    updateCharacter: (character: Character) => void;
    onPartyChange: (party: TowerPartyView | null) => void;
    onEnter: (runId: string, session: TowerSession) => void;
}) {
    const playerName = character.name;
    const meSlug = towerPlayerSlug(playerName);
    const [room, setRoom] = useState<TowerPartyEnvelope>(EMPTY_ROOM);
    const [loading, setLoading] = useState(true);
    const [syncState, setSyncState] = useState<ReadyRoomSyncState>("checking");
    const [realtimeConnected, setRealtimeConnected] = useState(() => isRealtimeConnected());
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [joinCode, setJoinCode] = useState("");
    const [inviteName, setInviteName] = useState("");
    const [copied, setCopied] = useState(false);
    const mountedRef = useRef(true);
    const requestInFlightRef = useRef<string | null>(null);
    const roomRequestEpochRef = useRef(0);
    const roomRefreshRef = useRef<() => void>(() => {});
    const entryAbortRef = useRef<AbortController | null>(null);
    const enteringRunRef = useRef<string | null>(null);
    const openRoomHeadingRef = useRef<HTMLHeadingElement | null>(null);
    const activeRoomHeadingRef = useRef<HTMLHeadingElement | null>(null);
    const activePartyId = room.party?.id;

    useEffect(() => {
        onPartyChange(room.party);
    }, [onPartyChange, room.party]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            entryAbortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        setCopied(false);
    }, [room.party?.id, room.party?.inviteCode]);

    useEffect(() => {
        setRealtimeConnected(isRealtimeConnected());
        return onStatus(setRealtimeConnected);
    }, []);

    const enterActiveRoom = useCallback(async (party: TowerPartyView) => {
        const runId = party.status === "active" ? party.launch?.runId : null;
        if (!runId || enteringRunRef.current === runId) return;
        enteringRunRef.current = runId;
        entryAbortRef.current?.abort();
        const controller = new AbortController();
        entryAbortRef.current = controller;
        try {
            const session = await fetchTowerState(runId, playerName, controller.signal);
            if (!mountedRef.current || controller.signal.aborted) return;
            onEnter(runId, session);
        } catch (entryError) {
            if (!mountedRef.current || controller.signal.aborted) return;
            enteringRunRef.current = null;
            setError(`The squad launched, but the battle has not reconnected yet. ${partyErrorText(entryError)}`);
        } finally {
            if (entryAbortRef.current === controller) entryAbortRef.current = null;
        }
    }, [onEnter, playerName]);

    useEffect(() => {
        let alive = true;
        let inFlight = false;
        let refreshPending = false;
        const controller = new AbortController();
        const refresh = () => {
            // A mutation increments the epoch before transport begins. Do not let a poll
            // start on that same epoch and later overwrite create/leave with a pre-commit view.
            if (!canStartTowerRoomPoll(alive, inFlight, Boolean(requestInFlightRef.current))) {
                if (alive) refreshPending = true;
                return;
            }
            refreshPending = false;
            inFlight = true;
            const startedEpoch = roomRequestEpochRef.current;
            fetchTowerParty(playerName, activePartyId, controller.signal).then(next => {
                if (!alive || !isTowerRoomResponseCurrent(startedEpoch, roomRequestEpochRef.current)) return;
                const normalized = next.party?.status === "closed" ? { ...next, party: null } : next;
                if (next.party?.status === "closed") {
                    setNotice("That Ready Room has closed. You can open or join a new squad.");
                }
                setRoomIfChanged(setRoom, normalized);
                setSyncState("live");
                if (normalized.party) void enterActiveRoom(normalized.party);
            }).catch(pollError => {
                if (!alive || !isTowerRoomResponseCurrent(startedEpoch, roomRequestEpochRef.current)) return;
                if (pollError instanceof TowerPartyApiError && (pollError.status === 403 || pollError.status === 404)) {
                    setRoom(current => ({ ...current, party: null }));
                    setNotice(pollError.status === 404
                        ? "That Ready Room expired or no longer exists. You can open or join another."
                        : "You are no longer a member of that Ready Room.");
                    setSyncState("live");
                } else {
                    setSyncState("reconnecting");
                }
            }).finally(() => {
                inFlight = false;
                if (alive) setLoading(false);
                if (alive && refreshPending && !requestInFlightRef.current) queueMicrotask(refresh);
            });
        };
        roomRefreshRef.current = refresh;
        refresh();
        const stopPush = onTowerKick(kick => {
            if (kick.channel === "reconcile"
                || (kick.channel === "party" && (!kick.partyId || !activePartyId || kick.partyId === activePartyId))) {
                refresh();
            }
        });
        // Socket revision hints drive the normal path. The bounded HTTP poll is a
        // slow consistency sweep while connected and the complete offline fallback.
        const stopFallback = visiblePoll(refresh, realtimeConnected ? 20_000 : 2_500, 0.08);
        return () => {
            alive = false;
            controller.abort();
            stopPush();
            stopFallback();
            if (roomRefreshRef.current === refresh) roomRefreshRef.current = () => {};
        };
    }, [activePartyId, enterActiveRoom, playerName, realtimeConnected]);

    async function runRequest(
        label: string,
        request: () => Promise<TowerPartyEnvelope>,
        resultMode: TowerRoomResultMode = "adopt",
        reconcileError = true,
    ) {
        if (requestInFlightRef.current) return null;
        const requestEpoch = ++roomRequestEpochRef.current;
        requestInFlightRef.current = label;
        setBusy(label);
        setError(null);
        setNotice(null);
        try {
            const next = await request();
            if (!mountedRef.current || !isTowerRoomResponseCurrent(requestEpoch, roomRequestEpochRef.current)) return next;
            setRoom(current => reconcileTowerRoomEnvelope(current, next, resultMode));
            setSyncState("live");
            if ((label === "create" || label === "join" || label === "accept") && next.party) {
                window.requestAnimationFrame(() => activeRoomHeadingRef.current?.focus({ preventScroll: true }));
            } else if (label === "leave") {
                window.requestAnimationFrame(() => openRoomHeadingRef.current?.focus({ preventScroll: true }));
            }
            return next;
        } catch (requestError) {
            if (!mountedRef.current || !isTowerRoomResponseCurrent(requestEpoch, roomRequestEpochRef.current)) return null;
            if (reconcileError && requestError instanceof TowerPartyApiError && requestError.party !== undefined) {
                setRoom(current => reconcileTowerRoomEnvelope(current, {
                    ...current,
                    party: requestError.party?.status === "closed" ? null : requestError.party ?? null,
                }));
            }
            setError(partyErrorText(requestError));
            return null;
        } finally {
            requestInFlightRef.current = null;
            if (mountedRef.current) {
                setBusy(null);
                roomRefreshRef.current();
            }
        }
    }

    function createRoom(binding: TowerPartyBinding) {
        const mutation: TowerPartyMutation = binding.mode === "story"
            ? { action: "create", mode: "story", floor: binding.floor }
            : { action: "create", mode: "spire", ascensionTier: binding.ascensionTier };
        void runRequest("create", () => mutateTowerPartyWithLostResponseRetry(playerName, mutation));
    }

    function joinOpenRoom() {
        const inviteCode = joinCode.trim().toUpperCase();
        if (!inviteCode) return;
        void runRequest("join", () => mutateTowerPartyWithLostResponseRetry(playerName, { action: "join", inviteCode }))
            .then(next => { if (next?.party) setJoinCode(""); });
    }

    function respondToInvitation(invitation: TowerPartyInvitationView, action: "accept" | "decline") {
        void runRequest(action, async () => {
            const preview = await fetchTowerParty(playerName, invitation.partyId);
            if (!preview.party) throw new Error("That invitation is no longer available.");
            return mutateTowerPartyWithLostResponseRetry(playerName, {
                action,
                partyId: invitation.partyId,
                expectedVersion: preview.party.version,
            });
        }, action === "accept" ? "adopt" : "preserve", action === "accept");
    }

    function mutateCurrent(mutation: TowerPartyMutation, label: string, resultMode: "adopt" | "drop" = "adopt") {
        return runRequest(label, () => mutateTowerPartyWithLostResponseRetry(playerName, mutation), resultMode);
    }

    function invitePlayerByName(party: TowerPartyView) {
        const target = inviteName.trim();
        if (!target || editsLocked) return;
        void mutateCurrent({ action: "invite", partyId: party.id, target, expectedVersion: party.version }, "invite")
            .then(next => { if (next) setInviteName(""); });
    }

    async function copyInviteCode() {
        if (!room.party) return;
        try {
            await navigator.clipboard.writeText(room.party.inviteCode);
            setCopied(true);
        } catch {
            setError("Copy failed. Select the invite code and share it manually.");
        }
    }

    async function launchRoom() {
        const party = room.party;
        if (!party || requestInFlightRef.current || party.hostSlug !== meSlug || !party.canLaunch) return;
        const requestEpoch = ++roomRequestEpochRef.current;
        requestInFlightRef.current = "launch";
        setBusy("launch");
        setError(null);
        setNotice(null);
        try {
            const response = await launchTowerPartyWithLostResponseRetry(playerName, party, hostLoadout);
            if (!mountedRef.current || !isTowerRoomResponseCurrent(requestEpoch, roomRequestEpochRef.current)) return;
            setRoom(current => reconcileTowerRoomEnvelope(current, { ...current, party: response.party }));
            if (response.character) updateCharacter(response.character);
            enteringRunRef.current = response.runId;
            onEnter(response.runId, response.session);
        } catch (launchError) {
            if (!mountedRef.current || !isTowerRoomResponseCurrent(requestEpoch, roomRequestEpochRef.current)) return;
            if (launchError instanceof TowerPartyApiError && launchError.party !== undefined) {
                setRoom(current => reconcileTowerRoomEnvelope(current, {
                    ...current,
                    party: launchError.party?.status === "closed" ? null : launchError.party ?? null,
                }));
            }
            setError(partyErrorText(launchError));
        } finally {
            requestInFlightRef.current = null;
            if (mountedRef.current) {
                setBusy(null);
                roomRefreshRef.current();
            }
        }
    }

    const party = room.party;
    const me = party?.members.find(member => member.slug === meSlug);
    const isHost = party?.hostSlug === meSlug;
    const connectionUnavailable = loading || syncState !== "live";
    const editsLocked = Boolean(busy) || connectionUnavailable || party?.status !== "forming";
    const openInviteTargets = following.filter(name => {
        const slug = towerPlayerSlug(name);
        return slug && slug !== meSlug
            && !party?.members.some(member => member.slug === slug)
            && !party?.invitedSlugs.includes(slug);
    });
    const requiredSize = party?.sizeRequirements.required;
    const readyCount = party?.members.filter(member => member.ready).length ?? 0;
    const openSlotCount = party ? Math.max(0, party.sizeRequirements.max - party.members.length) : 0;
    const waitingMembers = party?.members.filter(member => !member.ready && !member.ai) ?? [];
    const selectedStoryFloor = storyFloorMeta?.id === storyFloor ? storyFloorMeta : null;
    const boundStoryFloor = party?.binding.mode === "story" && storyFloorMeta?.id === party.binding.floor ? storyFloorMeta : null;
    const boundStoryArt = boundStoryFloor ? resolveTowerStoryArt(boundStoryFloor.artKey) : null;
    const sizeText = party
        ? requiredSize != null
            ? `${requiredSize} players required · ${party.members.length}/${requiredSize} joined`
            : `${party.sizeRequirements.min}–${party.sizeRequirements.max} slots · ${party.liveMemberCount} live + ${party.aiMemberCount} AI`
        : "Story squads support live players and novice AI recruits · the Spire requires exactly 4 live players";
    const launchBlocker = !party ? ""
        : requiredSize != null && party.members.length !== requiredSize
            ? `Recruit ${requiredSize - party.members.length} more live player${requiredSize - party.members.length === 1 ? "" : "s"} to fill the Spire squad.`
            : party.members.length < party.sizeRequirements.min
                ? `Recruit ${party.sizeRequirements.min - party.members.length} more squadmate${party.sizeRequirements.min - party.members.length === 1 ? "" : "s"} to meet the minimum.`
                : !party.allReady
                    ? me && !me.ready
                        ? waitingMembers.length > 1
                            ? `Mark yourself ready. Still waiting on ${waitingMembers.filter(member => member.slug !== meSlug).map(member => member.displayName).join(", ")}.`
                            : "Mark yourself ready to complete the ready check."
                        : waitingMembers.length > 0
                            ? `Waiting on ${waitingMembers.map(member => member.displayName).join(", ")} to mark ready.`
                            : "Waiting for the latest room readiness to synchronize."
                    : isHost ? "Squad ready. You can launch the encounter." : "Squad ready. Waiting for the host to launch.";
    const statusKind = syncState === "checking" ? "checking"
        : syncState === "reconnecting" ? "reconnecting"
        : busy ? "updating"
        : party?.status ?? "open";
    const statusLabel = syncState === "checking" ? "Checking…"
        : syncState === "reconnecting" ? "Reconnecting…"
        : readyRoomBusyLabel(busy) ?? (party?.status === "forming" ? "Forming" : party?.status === "launching" ? "Launching" : party?.status === "active" ? "In battle" : "Open");

    return (
        <section id="tower-ready-room" className="tower-ready-room" tabIndex={-1} aria-labelledby="tower-ready-room-title"
            aria-busy={Boolean(busy || loading || syncState !== "live")}>
            <header className="tower-ready-room-head">
                <div>
                    <span className="tower-ready-room-kicker">Live squad · optional novice recruits</span>
                    <h2 id="tower-ready-room-title">Tower Ready Room</h2>
                </div>
                <div className="tower-ready-room-status-stack" role="status" aria-live="polite">
                    <span className={`tower-ready-room-status tower-ready-room-status--${statusKind}`}>
                        {statusLabel}
                    </span>
                    <small className={realtimeConnected ? "is-live" : "is-fallback"}>
                        {realtimeConnected ? "Squad sync live" : "Recovery sync active"}
                    </small>
                </div>
            </header>
            <p className="tower-ready-room-intro">
                Assemble a 2–4 member Story squad or a four-player Spire team. Every live shinobi controls their own turn; Story allows deliberately basic, reward-ineligible AI recruits (one maximum) that act automatically.
            </p>
            {error && (
                <div className="tower-ready-room-error" role="alert">
                    <strong>Ready Room action failed</strong>
                    <span>{error}</span>
                </div>
            )}
            {notice && <div className="tower-ready-room-notice" role="status" aria-live="polite">{notice}</div>}
            {syncState === "reconnecting" && (
                <div className="tower-ready-room-sync-warning" role="status" aria-live="polite">
                    <div>
                        <strong>Restoring squad connection</strong>
                        <span>Your room is preserved. Formation controls will unlock when the latest roster returns.</span>
                    </div>
                    <button type="button" onClick={() => roomRefreshRef.current()} disabled={Boolean(busy || loading)}>Retry now</button>
                </div>
            )}
            {externalBattleActive && !party && (
                <div className="tower-ready-room-notice" role="status">Finish or leave your Tower Team Arena match before opening a co-op room.</div>
            )}

            {!party ? (
                <>
                    <TowerReadyRoomInvitations
                        invitations={room.invitations}
                        activeParty={false}
                        busy={Boolean(busy)}
                        connectionUnavailable={connectionUnavailable}
                        externalBattleActive={externalBattleActive}
                        onRespond={respondToInvitation}
                    />
                    <div className="tower-ready-room-open">
                        <div className="tower-ready-room-paths">
                            <section className="tower-ready-room-path tower-ready-room-path--host" aria-labelledby="tower-ready-room-host-title">
                                <span>Host a squad</span>
                                <h3 id="tower-ready-room-host-title" ref={openRoomHeadingRef} tabIndex={-1}>Choose an expedition</h3>
                                <p>Create a server-owned room for the floor currently selected below.</p>
                                <div className="tower-ready-room-create">
                                    <button className="tower-ready-room-story-path" type="button"
                                        onClick={() => storyFloor != null && createRoom({ mode: "story", floor: storyFloor })}
                                        disabled={Boolean(busy || connectionUnavailable || externalBattleActive || !towersUnlocked || storyFloor == null || !storyFloorActionable)}>
                                        <span>Story Floor {storyFloor ?? "—"}{selectedStoryFloor ? ` · ${selectedStoryFloor.name}` : ""}</span>
                                        <small>2–4 slots · live or novice AI</small>
                                    </button>
                                    <button id="tower-ready-room-open-spire" className="tower-ready-room-spire-path" type="button"
                                        onClick={() => createRoom({ mode: "spire", ascensionTier: spireTier })}
                                        disabled={Boolean(busy || connectionUnavailable || externalBattleActive || !towersUnlocked)}>
                                        <span>Spire Floor {spireTier}</span>
                                        <small>exactly 4 live players</small>
                                    </button>
                                </div>
                            </section>
                            <form className="tower-ready-room-path tower-ready-room-code" aria-labelledby="tower-ready-room-join-title"
                                onSubmit={event => { event.preventDefault(); joinOpenRoom(); }}>
                                <span>Join a squad</span>
                                <h3 id="tower-ready-room-join-title">Enter a room code</h3>
                                <p id="tower-ready-room-code-help">Use the 8-character code sent by the host. Codes omit I, O, 0, and 1.</p>
                                <label htmlFor="tower-ready-room-code">Room code</label>
                                <div>
                                    <input id="tower-ready-room-code" value={joinCode} maxLength={8} autoCapitalize="characters" autoComplete="off"
                                        spellCheck={false} aria-describedby="tower-ready-room-code-help"
                                        onKeyDown={event => {
                                            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                                            event.preventDefault();
                                            joinOpenRoom();
                                        }}
                                        onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, ""))} placeholder="ROOMCODE" />
                                    <button type="submit" disabled={Boolean(busy || connectionUnavailable || externalBattleActive || joinCode.length !== 8)}>
                                        {busy === "join" ? "Joining…" : "Join room"}
                                    </button>
                                </div>
                            </form>
                        </div>
                        <p className="tower-ready-room-size">{towersUnlocked ? sizeText : "Battle Towers unlock at level 30."}</p>
                    </div>
                </>
            ) : (
                <div className="tower-ready-room-active">
                    <article
                        className={`tower-ready-room-binding${boundStoryArt ? " has-art" : ""}`}
                        aria-labelledby="tower-ready-room-mission-title"
                        data-art-fallback={boundStoryArt?.kind === "fallback" ? "true" : undefined}
                        style={boundStoryArt ? { ["--tower-ready-room-mission-art" as string]: `url(${boundStoryArt.src})` } : undefined}
                    >
                        <div className="tower-ready-room-mission-copy">
                            <span>Bound encounter</span>
                            <h3 id="tower-ready-room-mission-title">
                                {bindingLabel(party.binding)}{boundStoryFloor ? ` · ${boundStoryFloor.name}` : ""}
                            </h3>
                            {boundStoryFloor ? (
                                <small>{readyRoomObjectiveLabel(boundStoryFloor.objective)} · {boundStoryFloor.biome.replace(/\b\w/g, character => character.toUpperCase())} biome · Chapter {boundStoryFloor.chapter ?? 1}</small>
                            ) : <small>Leave this room before choosing a different floor.</small>}
                            <TowerRoomExpiry key={party.id} expiresAt={party.expiresAt} />
                        </div>
                    </article>
                    <div className="tower-ready-room-code-card">
                        <span>Invite code</span>
                        <strong aria-label={`Invite code ${party.inviteCode.split("").join(" ")}`}>{party.inviteCode}</strong>
                        <button type="button" onClick={() => void copyInviteCode()} disabled={Boolean(busy)} aria-live="polite">
                            {copied ? "Code copied" : "Copy code"}
                        </button>
                    </div>

                    <header className="tower-ready-room-roster-head">
                        <div>
                            <span>Squad assembly</span>
                            <h3 id="tower-ready-room-squad-title" ref={activeRoomHeadingRef} tabIndex={-1}>Your Tower squad</h3>
                        </div>
                        <span className="tower-ready-room-capacity" aria-label={`${party.members.length} of ${party.sizeRequirements.max} squad slots filled`}>
                            <strong>{party.members.length}</strong>/{party.sizeRequirements.max} <small>slots</small>
                        </span>
                    </header>
                    <p className="tower-ready-room-size">{sizeText}</p>
                    <ul className="tower-ready-room-roster" aria-labelledby="tower-ready-room-squad-title">
                        {party.members.map(member => (
                            <li key={member.slug} className={`${member.ready ? "is-ready" : "is-waiting"}${member.ai ? " is-ai" : ""}`}>
                                <span className="tower-ready-room-member-mark" aria-hidden="true">{member.ready ? "✓" : "○"}</span>
                                <span>
                                    <strong>{member.displayName}</strong>
                                    {member.slug === party.hostSlug ? <small>host</small> : null}
                                    {member.slug === meSlug ? <small>you</small> : null}
                                    {member.ai ? <small>novice AI · no rewards</small> : null}
                                </span>
                                <b>{member.ai ? "Auto-ready" : member.ready ? "Ready" : "Not ready"}</b>
                                {isHost && member.slug !== meSlug && party.status === "forming" && !member.ai && (
                                    <button type="button" className="tower-ready-room-remove" disabled={editsLocked}
                                        aria-label={`Remove ${member.displayName} from the Ready Room`}
                                        onClick={() => { void (async () => {
                                            const confirmed = await gameConfirm(`Remove ${member.displayName} from this Ready Room? Remaining members will need to mark ready again.`);
                                            if (!confirmed) return;
                                            await mutateCurrent({ action: "kick", partyId: party.id, target: member.slug, expectedVersion: party.version }, "kick");
                                        })(); }}>
                                        {busy === "kick" ? "Removing…" : "Remove"}
                                    </button>
                                )}
                                {isHost && member.ai && party.status === "forming" && (
                                    <button type="button" className="tower-ready-room-remove" disabled={editsLocked}
                                        aria-label={`Release ${member.displayName} from the Ready Room`}
                                        onClick={() => { void mutateCurrent({ action: "remove-ai", partyId: party.id, target: member.slug, expectedVersion: party.version }, "remove-ai"); }}>
                                        {busy === "remove-ai" ? "Releasing…" : "Release"}
                                    </button>
                                )}
                            </li>
                        ))}
                        {Array.from({ length: openSlotCount }, (_, index) => {
                            const slotNumber = party.members.length + index + 1;
                            const required = slotNumber <= (requiredSize ?? party.sizeRequirements.min);
                            const slotKind = party.binding.mode === "spire" ? "Live player required"
                                : required ? "Live player or novice AI" : "Optional reinforcement";
                            return (
                                <li key={`open-slot-${slotNumber}`} className={`is-open${required ? " is-required" : ""}`}
                                    aria-label={`Open squad slot ${slotNumber}. ${slotKind}.`}>
                                    <span className="tower-ready-room-member-mark" aria-hidden="true">+</span>
                                    <span><strong>Open slot</strong><small>{slotKind}</small></span>
                                    <b>{required ? "Required" : "Optional"}</b>
                                </li>
                            );
                        })}
                    </ul>

                    <section className={`tower-ready-room-readiness${party.canLaunch ? " is-complete" : ""}`} aria-labelledby="tower-ready-room-readiness-title">
                        <header>
                            <div>
                                <span>Deployment gate</span>
                                <h4 id="tower-ready-room-readiness-title">Ready check</h4>
                            </div>
                            <strong>{readyCount}/{party.members.length}</strong>
                        </header>
                        <progress value={readyCount} max={party.members.length}
                            aria-label={`Squad readiness: ${readyCount} of ${party.members.length} members ready`} />
                        <p role="status" aria-live="polite" aria-atomic="true">
                            {party.status === "forming" ? launchBlocker : "Launch is in progress…"}
                        </p>
                    </section>

                    {isHost && party.status === "forming" && party.members.length < party.sizeRequirements.max && (
                        <section className="tower-ready-room-recruitment" aria-labelledby="tower-ready-room-recruitment-title">
                            <header className="tower-ready-room-section-head">
                                <div>
                                    <span>Host controls</span>
                                    <h4 id="tower-ready-room-recruitment-title">Recruit squadmates</h4>
                                </div>
                                <small>Roster changes reset live-player readiness.</small>
                            </header>
                            {party.aiPolicy.allowed && (
                                <div className="tower-ready-room-ai-recruit">
                                    <div>
                                        <strong>Novice Tower Recruit</strong>
                                        <span id="tower-ready-room-ai-description">Deliberately basic movement and one weak strike. No items, support kit, rewards, or progression.</span>
                                    </div>
                                    <button type="button" disabled={editsLocked || party.aiMemberCount >= party.aiPolicy.max}
                                        aria-describedby="tower-ready-room-ai-description"
                                        onClick={() => { void mutateCurrent({ action: "add-ai", partyId: party.id, expectedVersion: party.version }, "add-ai"); }}>
                                        {party.aiMemberCount >= party.aiPolicy.max ? "AI slot filled" : busy === "add-ai" ? "Recruiting…" : "Recruit novice AI"}
                                    </button>
                                </div>
                            )}
                            <form className="tower-ready-room-recruit" onSubmit={event => {
                                event.preventDefault();
                                invitePlayerByName(party);
                            }}>
                                <label htmlFor="tower-ready-room-invite">Invite by player name</label>
                                <div>
                                    <input id="tower-ready-room-invite" value={inviteName} maxLength={32} autoComplete="off" spellCheck={false} disabled={editsLocked}
                                        onKeyDown={event => {
                                            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                                            event.preventDefault();
                                            invitePlayerByName(party);
                                        }}
                                        onChange={event => setInviteName(event.target.value)} placeholder="Player name" />
                                    <button type="submit" disabled={Boolean(editsLocked || !inviteName.trim())}>{busy === "invite" ? "Inviting…" : "Send invite"}</button>
                                </div>
                                {openInviteTargets.length > 0 && (
                                    <select aria-label="Invite a followed player" value="" disabled={editsLocked} onChange={event => {
                                        if (!event.target.value) return;
                                        void mutateCurrent({ action: "invite", partyId: party.id, target: event.target.value, expectedVersion: party.version }, "invite");
                                    }}>
                                        <option value="">Or choose someone you follow…</option>
                                        {openInviteTargets.map(name => <option key={name} value={name}>{name}</option>)}
                                    </select>
                                )}
                            </form>
                        </section>
                    )}

                    {party.invitedSlugs.length > 0 && (
                        <div className="tower-ready-room-pending">
                            <span>Awaiting invitation responses</span>
                            <ul aria-label="Players with pending Tower invitations">
                                {party.invitedSlugs.map(slug => (
                                    <li key={slug}>
                                        <span>{slug}</span>
                                        {isHost && <button type="button" disabled={editsLocked}
                                            aria-label={`Cancel Tower invitation for ${slug}`}
                                            onClick={() => { void mutateCurrent({ action: "revoke-invite", partyId: party.id, target: slug, expectedVersion: party.version }, "revoke-invite"); }}>
                                            {busy === "revoke-invite" ? "Cancelling…" : "Cancel invite"}
                                        </button>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <TowerReadyRoomInvitations
                        invitations={room.invitations}
                        activeParty
                        busy={Boolean(busy)}
                        connectionUnavailable={connectionUnavailable}
                        externalBattleActive={externalBattleActive}
                        secondary
                        onRespond={respondToInvitation}
                    />

                    <div className="tower-ready-room-footer">
                        <span className={party.canLaunch ? "is-ready" : undefined}>
                            {party.canLaunch ? (isHost ? "Squad cleared for deployment" : "Host can deploy the squad") : "Complete the ready check to unlock deployment"}
                        </span>
                        <div className="tower-ready-room-inline-actions">
                            <button type="button" className="tower-ready-toggle" disabled={editsLocked || !me}
                                aria-pressed={Boolean(me?.ready)}
                                onClick={() => { if (me) void mutateCurrent({ action: me.ready ? "unready" : "ready", partyId: party.id, expectedVersion: party.version }, me.ready ? "unready" : "ready"); }}>
                                {busy === "ready" || busy === "unready" ? "Updating…" : me?.ready ? "Mark not ready" : "Mark ready"}
                            </button>
                            {isHost && <button type="button" className="tower-ready-launch" disabled={Boolean(busy || !party.canLaunch)} onClick={() => void launchRoom()}>
                                {busy === "launch" || party.status === "launching" ? "Launching…" : "Launch squad"}
                            </button>}
                            <button type="button" className="tower-ready-leave" disabled={editsLocked}
                                onClick={() => { void (async () => {
                                    const confirmed = await gameConfirm(leaveRoomPrompt(party, isHost));
                                    if (!confirmed) return;
                                    await mutateCurrent({ action: "leave", partyId: party.id, expectedVersion: party.version }, "leave", "drop");
                                })(); }}>Leave room</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

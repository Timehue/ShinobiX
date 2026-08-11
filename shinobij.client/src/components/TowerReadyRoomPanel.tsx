import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { visiblePoll } from "../lib/poll";
import {
    fetchTowerParty,
    fetchTowerState,
    launchTowerPartyWithLostResponseRetry,
    mutateTowerPartyWithLostResponseRetry,
    towerPlayerSlug,
    TowerPartyApiError,
    type TowerHostLoadout,
    type TowerPartyBinding,
    type TowerPartyEnvelope,
    type TowerPartyInvitationView,
    type TowerPartyMutation,
    type TowerPartyView,
    type TowerSession,
} from "../lib/towers-api";
import type { Character } from "../types/character";
import { canStartTowerRoomPoll, isTowerRoomResponseCurrent, reconcileTowerRoomEnvelope, type TowerRoomResultMode } from "../lib/tower-party-state";
import { gameConfirm } from "./GameAlert";

const EMPTY_ROOM: TowerPartyEnvelope = { party: null, invitations: [] };
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

function bindingLabel(binding: TowerPartyBinding): string {
    return binding.mode === "story"
        ? `Story Floor ${binding.floor}`
        : `Endless Spire Floor ${binding.ascensionTier}`;
}

function invitationSizeLabel(invitation: TowerPartyInvitationView): string {
    return invitation.binding.mode === "spire"
        ? `${invitation.memberCount}/4 players`
        : `${invitation.memberCount}/4 players · 2 minimum`;
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
    storyFloorActionable,
    spireTier,
    towersUnlocked,
    hostLoadout,
    updateCharacter,
    onPartyChange,
    onEnter,
}: {
    character: Character;
    following: string[];
    storyFloor: number | null;
    storyFloorActionable: boolean;
    spireTier: number;
    towersUnlocked: boolean;
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
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [joinCode, setJoinCode] = useState("");
    const [inviteName, setInviteName] = useState("");
    const [copied, setCopied] = useState(false);
    const mountedRef = useRef(true);
    const requestInFlightRef = useRef<string | null>(null);
    const roomRequestEpochRef = useRef(0);
    const entryAbortRef = useRef<AbortController | null>(null);
    const enteringRunRef = useRef<string | null>(null);
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
        const controller = new AbortController();
        const refresh = () => {
            // A mutation increments the epoch before transport begins. Do not let a poll
            // start on that same epoch and later overwrite create/leave with a pre-commit view.
            if (!canStartTowerRoomPoll(alive, inFlight, Boolean(requestInFlightRef.current))) return;
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
            });
        };
        refresh();
        const stop = visiblePoll(refresh, 1_150, 0.05);
        return () => { alive = false; controller.abort(); stop(); };
    }, [activePartyId, enterActiveRoom, playerName]);

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
            if (mountedRef.current) setBusy(null);
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
            if (mountedRef.current) setBusy(null);
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
    const sizeText = party
        ? requiredSize != null
            ? `${requiredSize} players required · ${party.members.length}/${requiredSize} joined`
            : `${party.sizeRequirements.min}–${party.sizeRequirements.max} players · ${party.members.length} joined`
        : "Story squads support 2–4 live players · the Spire requires exactly 4";
    const launchBlocker = !party ? ""
        : party.members.length < party.sizeRequirements.min || (requiredSize != null && party.members.length !== requiredSize)
            ? "Waiting for the required squad size."
            : !party.allReady ? "Every member must mark ready." : "Ready to launch.";
    const statusKind = syncState === "checking" ? "checking"
        : syncState === "reconnecting" ? "reconnecting"
        : busy ? "updating"
        : party?.status ?? "open";
    const statusLabel = syncState === "checking" ? "Checking…"
        : syncState === "reconnecting" ? "Reconnecting…"
        : readyRoomBusyLabel(busy) ?? (party?.status === "forming" ? "Forming" : party?.status === "launching" ? "Launching" : party?.status === "active" ? "In battle" : "Open");

    return (
        <section id="tower-ready-room" className="tower-ready-room" tabIndex={-1} aria-labelledby="tower-ready-room-title" aria-busy={Boolean(busy || loading)}>
            <header className="tower-ready-room-head">
                <div>
                    <span className="tower-ready-room-kicker">Live squad · full member rewards</span>
                    <h2 id="tower-ready-room-title">Tower Ready Room</h2>
                </div>
                <span className={`tower-ready-room-status tower-ready-room-status--${statusKind}`} role="status" aria-live="polite">
                    {statusLabel}
                </span>
            </header>
            <p className="tower-ready-room-intro">
                Live members control their own shinobi. The room binding, roster, and readiness are server-authoritative.
            </p>
            {error && <div className="tower-ready-room-error" role="alert">{error}</div>}
            {notice && <div className="tower-ready-room-notice" role="status" aria-live="polite">{notice}</div>}

            {room.invitations.length > 0 && (
                <div className="tower-ready-room-invitations">
                    <h3>Incoming invitations</h3>
                    {room.invitations.map(invitation => (
                        <div key={invitation.partyId} className="tower-ready-room-invite">
                            <span><strong>{invitation.hostDisplayName ?? invitation.hostSlug}</strong> · {bindingLabel(invitation.binding)} · {invitationSizeLabel(invitation)}</span>
                            <span className="tower-ready-room-inline-actions">
                                <button type="button" onClick={() => respondToInvitation(invitation, "accept")} disabled={Boolean(busy || party || connectionUnavailable)}>Accept</button>
                                <button type="button" onClick={() => respondToInvitation(invitation, "decline")} disabled={Boolean(busy || connectionUnavailable)}>Decline</button>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {!party ? (
                <div className="tower-ready-room-open">
                    <div className="tower-ready-room-create">
                        <button type="button" onClick={() => storyFloor != null && createRoom({ mode: "story", floor: storyFloor })}
                            disabled={Boolean(busy || connectionUnavailable || !towersUnlocked || storyFloor == null || !storyFloorActionable)}>
                            Open Story Floor {storyFloor ?? "—"} room <small>2–4 live players</small>
                        </button>
                        <button id="tower-ready-room-open-spire" type="button" onClick={() => createRoom({ mode: "spire", ascensionTier: spireTier })} disabled={Boolean(busy || connectionUnavailable || !towersUnlocked)}>
                            Open Spire Floor {spireTier} room <small>exactly 4 live players</small>
                        </button>
                    </div>
                    <form className="tower-ready-room-code" onSubmit={event => { event.preventDefault(); joinOpenRoom(); }}>
                        <label htmlFor="tower-ready-room-code">Join with an 8-character room code</label>
                        <span>
                            <input id="tower-ready-room-code" value={joinCode} maxLength={8} autoCapitalize="characters" autoComplete="off"
                                onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, ""))} placeholder="ROOMCODE" />
                            <button type="submit" disabled={Boolean(busy || connectionUnavailable || joinCode.length !== 8)}>Join room</button>
                        </span>
                    </form>
                    <p className="tower-ready-room-size">{towersUnlocked ? sizeText : "Battle Towers unlock at level 30."}</p>
                </div>
            ) : (
                <div className="tower-ready-room-active">
                    <div className="tower-ready-room-binding">
                        <span>Bound encounter</span>
                        <strong>{bindingLabel(party.binding)}</strong>
                        <small>Leave this room before choosing a different floor.</small>
                        <TowerRoomExpiry key={party.id} expiresAt={party.expiresAt} />
                    </div>
                    <div className="tower-ready-room-code-card">
                        <span>Invite code</span>
                        <strong aria-label={`Invite code ${party.inviteCode.split("").join(" ")}`}>{party.inviteCode}</strong>
                        <button type="button" onClick={() => void copyInviteCode()} disabled={Boolean(busy)}>{copied ? "Copied" : "Copy code"}</button>
                    </div>

                    <p className="tower-ready-room-size">{sizeText}</p>
                    <ul className="tower-ready-room-roster" aria-label="Live Tower party roster">
                        {party.members.map(member => (
                            <li key={member.slug} className={member.ready ? "is-ready" : "is-waiting"}>
                                <span className="tower-ready-room-member-mark" aria-hidden="true">{member.ready ? "✓" : "…"}</span>
                                <span><strong>{member.displayName}</strong>{member.slug === party.hostSlug ? <small>host</small> : null}{member.slug === meSlug ? <small>you</small> : null}</span>
                                <b>{member.ready ? "Ready" : "Not ready"}</b>
                                {isHost && member.slug !== meSlug && party.status === "forming" && (
                                    <button type="button" className="tower-ready-room-remove" disabled={editsLocked}
                                        aria-label={`Remove ${member.displayName} from the Ready Room`}
                                        onClick={() => { void (async () => {
                                            const confirmed = await gameConfirm(`Remove ${member.displayName} from this Ready Room? Remaining members will need to mark ready again.`);
                                            if (!confirmed) return;
                                            await mutateCurrent({ action: "kick", partyId: party.id, target: member.slug, expectedVersion: party.version }, "kick");
                                        })(); }}>
                                        Remove
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>

                    {isHost && party.status === "forming" && party.members.length < party.sizeRequirements.max && (
                        <div className="tower-ready-room-recruit">
                            <label htmlFor="tower-ready-room-invite">Invite a player</label>
                            <span>
                                <input id="tower-ready-room-invite" value={inviteName} maxLength={32} onChange={event => setInviteName(event.target.value)} placeholder="Player name" />
                                <button type="button" disabled={Boolean(editsLocked || !inviteName.trim())} onClick={() => {
                                    void mutateCurrent({ action: "invite", partyId: party.id, target: inviteName, expectedVersion: party.version }, "invite")
                                        .then(next => { if (next) setInviteName(""); });
                                }}>Invite</button>
                                {openInviteTargets.length > 0 && (
                                    <select aria-label="Invite a followed player" value="" disabled={editsLocked} onChange={event => {
                                        if (!event.target.value) return;
                                        mutateCurrent({ action: "invite", partyId: party.id, target: event.target.value, expectedVersion: party.version }, "invite");
                                    }}>
                                        <option value="">From follows…</option>
                                        {openInviteTargets.map(name => <option key={name} value={name}>{name}</option>)}
                                    </select>
                                )}
                            </span>
                        </div>
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
                                            Cancel invite
                                        </button>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="tower-ready-room-footer">
                        <span className={party.canLaunch ? "is-ready" : undefined}>{party.status === "forming" ? launchBlocker : "Launch is in progress…"}</span>
                        <div className="tower-ready-room-inline-actions">
                            <button type="button" className="tower-ready-toggle" disabled={editsLocked || !me}
                                onClick={() => { if (me) void mutateCurrent({ action: me.ready ? "unready" : "ready", partyId: party.id, expectedVersion: party.version }, me.ready ? "unready" : "ready"); }}>
                                {me?.ready ? "Mark not ready" : "Mark ready"}
                            </button>
                            {isHost && <button type="button" className="tower-ready-launch" disabled={Boolean(busy || !party.canLaunch)} onClick={() => void launchRoom()}>
                                {busy === "launch" || party.status === "launching" ? "Launching…" : "Launch live squad"}
                            </button>}
                            <button type="button" className="tower-ready-leave" disabled={editsLocked}
                                onClick={() => { void mutateCurrent({ action: "leave", partyId: party.id, expectedVersion: party.version }, "leave", "drop"); }}>Leave room</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

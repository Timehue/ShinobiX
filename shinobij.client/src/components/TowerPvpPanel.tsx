import { useCallback, useEffect, useRef, useState } from "react";
import { visiblePoll } from "../lib/poll";
import { isRealtimeConnected, onStatus, onTowerKick } from "../lib/presence-socket";
import {
    fetchTowerPvpPresence,
    joinTowerPvpQueue,
    leaveTowerPvp,
    setTowerPvpReady,
    TowerPvpApiError,
    type TowerPvpMatch,
    type TowerPvpPresence,
} from "../lib/tower-pvp-api";
import { towerPlayerSlug } from "../lib/towers-api";
import { gameConfirm } from "./GameAlert";

type PvpSyncState = "checking" | "live" | "reconnecting";

function readyTimeLeft(deadline: number): number {
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
}

function ReadyDeadline({ deadline, onExpire }: { deadline: number; onExpire: (deadline: number) => void }) {
    const [seconds, setSeconds] = useState(() => readyTimeLeft(deadline));
    const announcedExpiryRef = useRef<number | null>(null);
    useEffect(() => {
        const timer = window.setInterval(() => setSeconds(readyTimeLeft(deadline)), 1_000);
        return () => window.clearInterval(timer);
    }, [deadline]);
    useEffect(() => {
        if (seconds > 0 || announcedExpiryRef.current === deadline) return;
        announcedExpiryRef.current = deadline;
        onExpire(deadline);
    }, [deadline, onExpire, seconds]);
    return (
        <span className={seconds <= 20 ? "is-warning" : undefined} role="timer"
            aria-label={seconds > 0 ? `${seconds} seconds remain in the ready check` : "Ready check expired"}>
            {seconds > 0 ? `Ready check · ${seconds}s` : "Ready check expired"}
        </span>
    );
}

function errorText(error: unknown): string {
    if (error instanceof TowerPvpApiError) {
        if (error.errorCode === "member-busy") return "Finish your current battle before entering the Team Arena queue.";
        if (error.errorCode === "version-conflict") return "The match changed. The latest ready check has been restored.";
        if (error.errorCode === "ready-timeout") return "The ready check expired. Queue again when your team is available.";
        return error.message;
    }
    return String((error as Error)?.message ?? error);
}

export function TowerPvpPanel({
    playerName,
    unlocked,
    blockedReason,
    onMatchLockChange,
    onEnter,
}: {
    playerName: string;
    unlocked: boolean;
    blockedReason?: string | null;
    onMatchLockChange: (matchId: string | null) => void;
    onEnter: (match: TowerPvpMatch) => void;
}) {
    const meSlug = towerPlayerSlug(playerName);
    const [presence, setPresence] = useState<TowerPvpPresence>({ state: "idle", match: null, queuePosition: null });
    const [syncState, setSyncState] = useState<PvpSyncState>("checking");
    const [realtimeConnected, setRealtimeConnected] = useState(() => isRealtimeConnected());
    const [busy, setBusy] = useState<"join" | "ready" | "leave" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const presenceRef = useRef<TowerPvpPresence>(presence);
    const mountedRef = useRef(true);
    const requestRef = useRef(false);
    const refreshRef = useRef<() => void>(() => {});
    const enteringRef = useRef<string | null>(null);
    const panelRef = useRef<HTMLElement | null>(null);
    const joinButtonRef = useRef<HTMLButtonElement | null>(null);
    const queueCancelButtonRef = useRef<HTMLButtonElement | null>(null);
    const readyButtonRef = useRef<HTMLButtonElement | null>(null);
    const cancelledButtonRef = useRef<HTMLButtonElement | null>(null);
    const transferFocusRef = useRef(false);
    const [expiredReadyDeadline, setExpiredReadyDeadline] = useState<number | null>(null);
    const matchId = presence.state === "matched" ? presence.match.matchId : null;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        return onStatus(setRealtimeConnected);
    }, []);

    const adoptPresence = useCallback((next: TowerPvpPresence) => {
        const current = presenceRef.current;
        if (current.state === "matched" && next.state === "matched" && current.match.matchId === next.match.matchId
            && current.match.version > next.match.version) return false;
        const currentView = current.state === "matched" ? current.match.status : current.state;
        const nextView = next.state === "matched" ? next.match.status : next.state;
        if (currentView !== nextView && panelRef.current?.contains(document.activeElement)) transferFocusRef.current = true;
        presenceRef.current = next;
        setPresence(next);
        const nextMatch = next.state === "matched" ? next.match : null;
        onMatchLockChange(nextMatch && nextMatch.status !== "cancelled" ? nextMatch.matchId : null);
        if (nextMatch && (nextMatch.status === "active" || nextMatch.status === "done")) {
            const enterKey = `${nextMatch.matchId}:${nextMatch.status}`;
            if (enteringRef.current !== enterKey) {
                enteringRef.current = enterKey;
                onEnter(nextMatch);
            }
        } else {
            enteringRef.current = null;
        }
        return true;
    }, [onEnter, onMatchLockChange]);

    useEffect(() => {
        let alive = true;
        let inFlight = false;
        let refreshPending = false;
        const controller = new AbortController();
        const refresh = () => {
            if (!alive) return;
            if (inFlight || requestRef.current) {
                refreshPending = true;
                return;
            }
            refreshPending = false;
            inFlight = true;
            fetchTowerPvpPresence(playerName, controller.signal).then(next => {
                if (!alive) return;
                // A read that began before a queue/ready/leave mutation cannot be
                // allowed to overwrite that mutation's authoritative response.
                if (requestRef.current) {
                    refreshPending = true;
                    return;
                }
                adoptPresence(next);
                setSyncState("live");
            }).catch(_fetchError => {
                if (alive && !controller.signal.aborted) setSyncState("reconnecting");
            }).finally(() => {
                inFlight = false;
                if (alive && refreshPending && !requestRef.current) queueMicrotask(refresh);
            });
        };
        refreshRef.current = refresh;
        refresh();
        const stopPush = onTowerKick(kick => {
            if (kick.channel === "reconcile"
                || (kick.channel === "pvp" && (!kick.matchId || !matchId || kick.matchId === matchId))) refresh();
        });
        const stopFallback = visiblePoll(refresh, realtimeConnected ? 20_000 : 2_500, 0.08);
        return () => {
            alive = false;
            controller.abort();
            stopPush();
            stopFallback();
            if (refreshRef.current === refresh) refreshRef.current = () => {};
        };
    }, [adoptPresence, matchId, playerName, realtimeConnected]);

    async function mutate(label: "join" | "ready" | "leave", request: () => Promise<TowerPvpPresence>) {
        if (requestRef.current) return;
        requestRef.current = true;
        setBusy(label);
        setError(null);
        try {
            const next = await request();
            if (mountedRef.current) adoptPresence(next);
        } catch (requestError) {
            if (!mountedRef.current) return;
            if (requestError instanceof TowerPvpApiError && requestError.match) {
                adoptPresence({ state: "matched", match: requestError.match, queuePosition: null });
            }
            setError(errorText(requestError));
        } finally {
            requestRef.current = false;
            if (mountedRef.current) {
                setBusy(null);
                refreshRef.current();
            }
        }
    }

    const match = presence.state === "matched" ? presence.match : null;
    const me = match?.roster.find(member => member.slug === meSlug);
    const myTeam = match?.viewer.teamId;
    const amber = match?.roster.filter(member => member.teamId === "amber") ?? [];
    const violet = match?.roster.filter(member => member.teamId === "violet") ?? [];
    const readyCheckExpired = match?.status === "ready" && expiredReadyDeadline === match.readyDeadlineAt;

    const handleReadyExpiry = useCallback((deadline: number) => {
        setExpiredReadyDeadline(deadline);
        refreshRef.current();
    }, []);

    useEffect(() => {
        if (!transferFocusRef.current) return;
        const target = presence.state === "idle" ? joinButtonRef.current
            : presence.state === "queued" ? queueCancelButtonRef.current
            : match?.status === "ready" ? readyButtonRef.current
            : match?.status === "cancelled" ? cancelledButtonRef.current
            : null;
        if (!target) {
            transferFocusRef.current = false;
            return;
        }
        transferFocusRef.current = false;
        const frame = window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [match?.status, presence.state]);

    const leave = async () => {
        if (match?.status === "active") return;
        const confirmed = await gameConfirm(match
            ? "Leave this 2v2 ready check? The other three players will return to matchmaking."
            : "Leave the Tower Team Arena queue?");
        if (!confirmed) return;
        void mutate("leave", async () => (await leaveTowerPvp(playerName, match)).presence);
    };

    return (
        <section ref={panelRef} className="tower-pvp-panel" aria-labelledby="tower-pvp-title" aria-busy={Boolean(busy || syncState === "checking")}>
            <header className="tower-pvp-head">
                <div>
                    <span className="tower-pvp-kicker">Public multiplayer · exact 2v2</span>
                    <h2 id="tower-pvp-title">Tower Team Arena</h2>
                </div>
                <div className="tower-pvp-network" role="status" aria-live="polite">
                    <strong>{syncState === "checking" ? "Checking…" : syncState === "reconnecting" ? "Reconnecting…" : presence.state === "queued" ? "Matchmaking" : presence.state === "matched" ? "Match found" : "Open"}</strong>
                    <small>{realtimeConnected ? "Realtime channel connected" : "HTTP recovery mode"}</small>
                </div>
            </header>
            <p className="tower-pvp-intro">Four live players are split into balanced two-person teams. PvP uses the Tower board and canonical combat tags; consumables, rating, currency, and progression rewards are disabled.</p>
            {error && <div className="tower-pvp-error" role="alert">{error}</div>}

            {presence.state === "idle" && (
                <div className="tower-pvp-idle">
                    <div><strong>Queue solo</strong><span>{blockedReason ?? "The server forms and owns both teams. Every fighter controls only their own shinobi."}</span></div>
                    <button ref={joinButtonRef} type="button" disabled={!unlocked || Boolean(blockedReason) || Boolean(busy) || syncState !== "live"} onClick={() => {
                        void mutate("join", async () => (await joinTowerPvpQueue(playerName)).presence);
                    }}>{busy === "join" ? "Joining…" : "Find 2v2 match"}</button>
                </div>
            )}

            {presence.state === "queued" && (
                <div className="tower-pvp-queued" role="status">
                    <div className="tower-pvp-search-orb" aria-hidden="true" />
                    <div><strong>Searching for three fighters</strong><span>Queue position {presence.queuePosition} · you can keep this panel open while matchmaking.</span></div>
                    <button ref={queueCancelButtonRef} type="button" disabled={Boolean(busy)} onClick={() => void leave()}>{busy === "leave" ? "Leaving…" : "Cancel"}</button>
                </div>
            )}

            {match?.status === "ready" && (
                <div className="tower-pvp-ready">
                    <div className="tower-pvp-ready-banner">
                        <strong>Match found</strong>
                        <ReadyDeadline key={match.readyDeadlineAt} deadline={match.readyDeadlineAt} onExpire={handleReadyExpiry} />
                    </div>
                    <div className="tower-pvp-teams">
                        {([amber, violet] as const).map((team, teamIndex) => {
                            const teamId = teamIndex === 0 ? "amber" : "violet";
                            return (
                                <div key={teamId} className={`tower-pvp-team tower-pvp-team--${teamId}${myTeam === teamId ? " is-mine" : ""}`}
                                    role="group" aria-label={myTeam === teamId ? "Your Team" : "Rival Team"}>
                                    <span>{myTeam === teamId ? "Your team" : "Rival team"}</span>
                                    {team.map(member => (
                                        <div key={member.slug} className={member.ready ? "is-ready" : undefined} role="group"
                                            aria-label={`${member.displayName}, ${member.slug === meSlug ? "you, " : ""}${member.ready ? "ready" : "waiting"}`}>
                                            <strong>{member.displayName}</strong>
                                            <small>{member.slug === meSlug ? "you · " : ""}{member.ready ? "ready" : "waiting"}</small>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                    <div className="tower-pvp-actions">
                        <span role="status" aria-live="polite" aria-atomic="true">
                            {readyCheckExpired
                                ? "Ready check expired · refreshing match status"
                                : `${match.roster.filter(member => member.ready).length}/4 ready · the fight starts automatically`}
                        </span>
                        <div>
                            <button ref={readyButtonRef} type="button" className="tower-pvp-ready-button"
                                aria-pressed={Boolean(me?.ready)} disabled={!me || Boolean(busy) || readyCheckExpired} onClick={() => {
                                if (!match || !me) return;
                                void mutate("ready", async () => {
                                    const response = await setTowerPvpReady(playerName, match, !me.ready);
                                    return { state: "matched", match: response.match, queuePosition: null };
                                });
                            }}>{busy === "ready" ? "Updating…" : me?.ready ? "Mark not ready" : "Ready up"}</button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void leave()}>Leave match</button>
                        </div>
                    </div>
                </div>
            )}

            {match?.status === "cancelled" && (
                <div className="tower-pvp-cancelled" role="status">
                    <strong>Ready check closed</strong>
                    <span>{match.cancellationReason?.replace(/-/g, " ") ?? "A fighter left before the match began."}</span>
                    <button ref={cancelledButtonRef} type="button" disabled={Boolean(busy)} onClick={() => void mutate("leave", async () => (await leaveTowerPvp(playerName, match)).presence)}>Return to queue</button>
                </div>
            )}
        </section>
    );
}

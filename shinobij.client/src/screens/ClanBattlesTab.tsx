/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character, PlayerRecord } from "../types/character";
import type { Screen } from "../types/core";
import { ClanWarManual } from "../components/ClanWarManual";
import { CW_DAMAGE, CW_HP_MAX, CW_MODE_ICON, CW_MODE_LABEL } from "../constants/clan";
import { cwChallengeAction, cwDeclareWar, cwListWars, type CwChallenge, type CwChallengeMode, type CwChallengeResult, type CwWar } from "../lib/clan-war-api";
import { gameConfirm } from "../components/GameAlert";

export function ClanBattlesTab({ character, playerRoster, setScreen, launchClanWarBattle }: { character: Character; playerRoster: PlayerRecord[]; setScreen: (s: Screen) => void; launchClanWarBattle: (ch: CwChallenge, warId?: string) => void }) {
    void setScreen; // navigation now lives inside launchClanWarBattle
    const [wars, setWars] = useState<CwWar[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [declareTarget, setDeclareTarget] = useState("");
    const [composeMode, setComposeMode] = useState<CwChallengeMode>("pvp1v1");
    // composePartner is unused now that 2v2 is queue-based, but kept as
    // a no-op so existing handleSend reset-state lines compile cleanly.
    const [, setComposePartner] = useState("");
    // Tutorial popover — toggled by the ? button next to the section
    // title. Same UX pattern as the Village War manual.
    const [showClanWarManual, setShowClanWarManual] = useState(false);

    const refresh = useCallback(async () => {
        const list = await cwListWars();
        setWars(list);
        setLoading(false);
    }, []);
    useEffect(() => {
        void refresh();
        return visiblePoll(refresh, 15_000);
    }, [refresh]);

    const myClan = (character.clan ?? "").trim();
    const myClanmates: string[] = useMemo(() => {
        if (!myClan) return [];
        return playerRoster
            .filter(p => (p.character?.clan ?? "") === myClan && p.name.toLowerCase() !== character.name.toLowerCase())
            .map(p => p.name)
            .sort((a: string, b: string) => a.localeCompare(b));
    }, [playerRoster, myClan, character.name]);
    const myWar = wars.find(w => !w.endedAt && w.clans.includes(myClan));
    const enemyClan = myWar?.clans.find(c => c !== myClan) ?? "";
    // Per-player slot count: in-flight challenges (pending or queuing)
    // where I sit in EITHER challenger slot. Caps at 2 per the server.
    const CW_MAX_PER_PLAYER = 2;
    const mySlotCount = myWar ? myWar.pendingChallenges.filter(c => {
        if (c.status !== "pending" && c.status !== "queuing") return false;
        const me = character.name.toLowerCase();
        return (c.fromPlayer ?? "").toLowerCase() === me
            || (c.fromPlayer2 ?? "").toLowerCase() === me;
    }).length : 0;
    const atSlotCap = mySlotCount >= CW_MAX_PER_PLAYER;

    // Eligible clans to declare war on: any clan that exists in the
    // roster, isn't mine, and isn't currently in a clan war.
    const clansInWar = new Set<string>();
    for (const w of wars) if (!w.endedAt) for (const c of w.clans) clansInWar.add(c);
    const eligibleTargets: string[] = useMemo(() => {
        const set = new Set<string>();
        for (const p of playerRoster) {
            const clan = (p.character?.clan ?? "").trim();
            if (!clan) continue;
            if (clan === myClan) continue;
            if (clansInWar.has(clan)) continue;
            set.add(clan);
        }
        return [...set].sort((a: string, b: string) => a.localeCompare(b));
    }, [playerRoster, myClan, clansInWar]);

    // Leadership gate — mirror the server's loadClanContext. Founder
    // flag is on the character; Leader/Officer come from clan record's
    // roleOverrides. We optimistically allow Founder via clanFounder
    // flag; if the role check fails server-side the API surfaces the
    // error.
    const canLead = character.clanFounder === true;

    async function handleDeclare() {
        if (!declareTarget) return;
        if (!(await gameConfirm(`Declare clan war on ${declareTarget}? Both clans will see this in the Shinobi Council Hall.`))) return;
        setBusy(true);
        const result = await cwDeclareWar(declareTarget);
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        setDeclareTarget("");
        await refresh();
    }

    // Send a new challenge. 1v1 modes go straight to pending; 2v2 modes
    // create a 'queuing' challenge with just the current player as seed.
    // A second clanmate has to call join-send to convert it to pending.
    async function handleSend() {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({
            action: "send",
            warId: myWar.id,
            mode: composeMode,
        });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        setComposePartner("");
        await refresh();
    }

    async function handleJoinSend(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "join-send", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    async function handleLeaveSend(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "leave-send", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    // 1v1: immediately accepts. 2v2: queues as the 1st defender — a
    // clanmate has to call join-accept to fill the second slot.
    async function handleAccept(ch: CwChallenge) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({
            action: "accept",
            warId: myWar.id,
            challengeId: ch.id,
        });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    async function handleJoinAccept(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "join-accept", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    async function handleLeaveAccept(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "leave-accept", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    async function handleCancel(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "cancel", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    async function handleDecline(challengeId: string) {
        if (!myWar) return;
        setBusy(true);
        const result = await cwChallengeAction({ action: "decline", warId: myWar.id, challengeId });
        setBusy(false);
        if (!result.ok) { setError(result.error ?? "Failed."); return; }
        setError("");
        await refresh();
    }

    // Launch into the matching battle screen. The actual state plumbing
    // (pvpBattleId/pvpRole/pvpBattleContext for PvP, sessionStorage
    // stash for pet/tile-cards) is owned by the App component via the
    // launchClanWarBattle prop so the PvP screen guard doesn't show a
    // blank screen mid-route.
    function launchBattle(ch: CwChallenge) {
        if (!myWar) return;
        launchClanWarBattle(ch, myWar.id);
    }

    // handleReport removed — reporting is fully automatic via the
    // PvP win/loss handlers and PetArena onClanWarBattleEnd hook,
    // both routed through autoReportClanWarBattleResult at the App
    // level. Server-side: two-phase tentative+confirm + the new
    // validateAgainstPvpSession check in report.ts catch any drift.


    if (!myClan) {
        return (
            <section className="council-section">
                <h3 className="council-section-title">🏴 Clan Battles</h3>
                <p className="council-empty">Join a clan to participate in clan wars.</p>
            </section>
        );
    }

    return (
        <section className="council-section">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
                <h3 className="council-section-title" style={{ margin: 0 }}>🏴 Clan Battles</h3>
                <button
                    type="button"
                    onClick={() => setShowClanWarManual(v => !v)}
                    title="How does Clan War work?"
                    style={{ padding: "0.15rem 0.5rem", fontSize: "0.85rem", borderRadius: 999, border: "1px solid #60a5fa", background: "#1e293b", color: "#60a5fa", cursor: "pointer", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
                >
                    ?
                </button>
            </div>
            {showClanWarManual && <ClanWarManual onClose={() => setShowClanWarManual(false)} />}
            {error && <div style={{ color: "#f87171", marginBottom: "0.5rem", padding: "0.4rem 0.6rem", background: "#3b0a0a", borderRadius: 4 }}>⚠ {error}</div>}
            {loading && <p className="council-empty">Loading clan wars…</p>}

            {!loading && myWar && (
                <>
                    {/* My active war — HP bars + challenge composer + inbox */}
                    <div className="council-war-card" style={{ marginBottom: "1rem" }}>
                        <div className="council-vs-row">
                            <div className={`council-side ${character.clan === myClan ? "council-mine" : ""}`}>
                                <span className="council-village-name">{myClan}</span>
                                <span className="council-hp-label">{(myWar.hp[myClan] ?? 0).toLocaleString()} / {(myWar.hpMax?.[myClan] ?? CW_HP_MAX).toLocaleString()} HP</span>
                                <div className="council-hp-track"><div className="council-hp-fill" style={{ width: `${Math.max(0, Math.min(100, ((myWar.hp[myClan] ?? 0) / (myWar.hpMax?.[myClan] ?? CW_HP_MAX)) * 100))}%`, background: "#22c55e" }} /></div>
                                {myWar.mvpByClan?.[myClan] && <span className="council-top">👑 MVP: {myWar.mvpByClan[myClan]}</span>}
                            </div>
                            <div className="council-vs">VS</div>
                            <div className="council-side council-side-right">
                                <span className="council-village-name">{enemyClan}</span>
                                <span className="council-hp-label">{(myWar.hp[enemyClan] ?? 0).toLocaleString()} / {(myWar.hpMax?.[enemyClan] ?? CW_HP_MAX).toLocaleString()} HP</span>
                                <div className="council-hp-track"><div className="council-hp-fill" style={{ width: `${Math.max(0, Math.min(100, ((myWar.hp[enemyClan] ?? 0) / (myWar.hpMax?.[enemyClan] ?? CW_HP_MAX)) * 100))}%`, background: "#ef4444" }} /></div>
                                {myWar.mvpByClan?.[enemyClan] && <span className="council-top">👑 MVP: {myWar.mvpByClan[enemyClan]}</span>}
                            </div>
                        </div>
                        <div className="council-war-meta">
                            Started {new Date(myWar.startedAt).toLocaleDateString()} · {myWar.completedChallenges.length} battles completed
                        </div>
                    </div>

                    {/* Send a challenge — 1v1 sends immediately; 2v2 opens a queue */}
                    <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <strong style={{ color: "#60a5fa" }}>⚔ Send Anonymous Challenge to {enemyClan}</strong>
                            <span style={{ fontSize: "0.78rem", color: atSlotCap ? "#f87171" : "#94a3b8" }}>
                                Your slots: <strong>{mySlotCount}/{CW_MAX_PER_PLAYER}</strong>
                            </span>
                        </div>
                        <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "4px 0 8px" }}>
                            {composeMode === "pvp2v2" || composeMode === "pet2v2"
                                ? `2v2 modes open a send queue — a clanmate has to join from Your Queued Challenges below before ${enemyClan} sees it.`
                                : `${enemyClan} will see your clan but not the specific challenger until they accept. Challenges expire in 1h — ignored ones cost the defender ${5} HP.`}
                        </p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <select value={composeMode} onChange={e => setComposeMode(e.target.value as CwChallengeMode)} style={{ padding: "0.35rem" }} disabled={busy}>
                                {/* All five modes are picker-eligible. Tile cards uses a
                                    server-managed Triple-Triad-style duel; both clients are
                                    auto-pulled into ClanWarTileCardDuel on accept. */}
                                {(Object.keys(CW_MODE_LABEL) as CwChallengeMode[]).map(m => (
                                    <option key={m} value={m}>{CW_MODE_ICON[m]} {CW_MODE_LABEL[m]} (−{CW_DAMAGE[m]} HP)</option>
                                ))}
                            </select>
                            <button onClick={handleSend} disabled={busy || atSlotCap} style={{ padding: "0.4rem 0.8rem", background: atSlotCap ? "#1f2937" : "linear-gradient(#7f1d1d,#450a0a)", borderColor: atSlotCap ? "#475569" : "#f87171" }}>
                                {busy ? "Sending…" : atSlotCap ? "Slot cap reached" : (composeMode === "pvp2v2" || composeMode === "pet2v2") ? "Open 2v2 Queue" : "Send Challenge"}
                            </button>
                        </div>
                        {atSlotCap && (
                            <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: 6 }}>You're at the {CW_MAX_PER_PLAYER}-slot cap. Cancel one of your active challenges or wait for them to resolve / expire.</p>
                        )}
                        {!atSlotCap && myClanmates.length === 0 && (composeMode === "pvp2v2" || composeMode === "pet2v2") && (
                            <p style={{ fontSize: "0.78rem", color: "#fbbf24", marginTop: 6 }}>You can still open a queue but no clanmates are online to fill the partner slot yet.</p>
                        )}
                    </div>

                    {/* 2v2 Send Queues — challenges with status='queuing' that need a partner */}
                    {(() => {
                        const sendQueues = myWar.pendingChallenges.filter(c => c.fromClan === myClan && c.status === "queuing");
                        if (sendQueues.length === 0) return null;
                        return (
                            <div style={{ background: "#0a1a2a", border: "1px solid #60a5fa", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                                <strong style={{ color: "#60a5fa" }}>🪑 Your Clan's Open 2v2 Send Queues ({sendQueues.length})</strong>
                                <p style={{ fontSize: "0.78rem", color: "#bfdbfe", margin: "4px 0 8px" }}>
                                    A clanmate must join as partner before {enemyClan} sees the challenge. 1/2 challengers queued.
                                </p>
                                {sendQueues.map(ch => {
                                    const minsLeft = Math.max(1, Math.ceil((ch.expiresAt - Date.now()) / 60_000));
                                    const isSeed = ch.fromPlayer.toLowerCase() === character.name.toLowerCase();
                                    return (
                                        <div key={ch.id} style={{ background: "#0b1220", padding: "0.5rem 0.7rem", borderRadius: 4, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <strong style={{ flex: 1, minWidth: 200 }}>
                                                {CW_MODE_ICON[ch.mode]} {CW_MODE_LABEL[ch.mode]}
                                                <span style={{ color: "#94a3b8", fontWeight: 400 }}> · seed: {ch.fromPlayer} · expires in {minsLeft}m</span>
                                            </strong>
                                            {!isSeed && (
                                                <button onClick={() => handleJoinSend(ch.id)} disabled={busy} style={{ padding: "0.3rem 0.6rem", background: "#15803d", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                                    🤝 Join as Partner
                                                </button>
                                            )}
                                            {isSeed && (
                                                <button onClick={() => handleLeaveSend(ch.id)} disabled={busy} className="danger-button" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
                                                    ✕ Cancel Queue
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Incoming challenges — pending only (hides 'queuing' from defender) */}
                    {(() => {
                        const incoming = myWar.pendingChallenges.filter(c => c.fromClan === enemyClan && c.status === "pending");
                        if (incoming.length === 0) return null;
                        return (
                            <div style={{ background: "#1f0a0a", border: "1px solid #f87171", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                                <strong style={{ color: "#f87171" }}>🚨 Incoming Challenges ({incoming.length})</strong>
                                <p style={{ fontSize: "0.78rem", color: "#fcd34d", margin: "4px 0 8px" }}>
                                    {enemyClan} sent these. Challenger names are hidden until your accept queue fills.
                                    2v2 challenges need 2 defenders to queue before the battle is ready.
                                </p>
                                {incoming.map(ch => {
                                    const isTwoV = ch.mode === "pvp2v2" || ch.mode === "pet2v2";
                                    const minsLeft = Math.max(1, Math.ceil((ch.expiresAt - Date.now()) / 60_000));
                                    const meIsFirstDefender = (ch.acceptedPlayer ?? "").toLowerCase() === character.name.toLowerCase();
                                    const meIsSecondDefender = (ch.acceptedPlayer2 ?? "").toLowerCase() === character.name.toLowerCase();
                                    const meQueued = meIsFirstDefender || meIsSecondDefender;
                                    const queueCount = (ch.acceptedPlayer ? 1 : 0) + (ch.acceptedPlayer2 ? 1 : 0);
                                    const queueLabel = isTwoV ? ` · accept queue ${queueCount}/2` : "";
                                    return (
                                        <div key={ch.id} style={{ background: "#0b1220", padding: "0.5rem 0.7rem", borderRadius: 4, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <strong style={{ flex: 1, minWidth: 200 }}>
                                                {CW_MODE_ICON[ch.mode]} {CW_MODE_LABEL[ch.mode]}
                                                <span style={{ color: "#94a3b8", fontWeight: 400 }}> (−{CW_DAMAGE[ch.mode]} HP · {minsLeft}m{queueLabel})</span>
                                                {isTwoV && ch.acceptedPlayer && <span style={{ color: "#a7f3d0", fontSize: "0.78rem", marginLeft: 6 }}>· queued: {ch.acceptedPlayer}{ch.acceptedPlayer2 ? ` + ${ch.acceptedPlayer2}` : ""}</span>}
                                            </strong>
                                            {!isTwoV && !meQueued && (
                                                <button onClick={() => handleAccept(ch)} disabled={busy} style={{ padding: "0.3rem 0.6rem", background: "#15803d", borderColor: "#4ade80" }}>Accept</button>
                                            )}
                                            {isTwoV && !meQueued && !ch.acceptedPlayer && (
                                                <button onClick={() => handleAccept(ch)} disabled={busy} style={{ padding: "0.3rem 0.6rem", background: "#15803d", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                                    🪑 Queue to Accept (1st)
                                                </button>
                                            )}
                                            {isTwoV && !meQueued && ch.acceptedPlayer && !ch.acceptedPlayer2 && (
                                                <button onClick={() => handleJoinAccept(ch.id)} disabled={busy} style={{ padding: "0.3rem 0.6rem", background: "#15803d", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                                    🤝 Join Accept Queue (2nd)
                                                </button>
                                            )}
                                            {isTwoV && meQueued && (
                                                <button onClick={() => handleLeaveAccept(ch.id)} disabled={busy} className="danger-button" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
                                                    ✕ Leave Accept Queue
                                                </button>
                                            )}
                                            {!meQueued && (
                                                <button onClick={() => handleDecline(ch.id)} disabled={busy} className="danger-button" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
                                                    Decline (clan)
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* My outgoing challenges (pending, queuing-aware) */}
                    {(() => {
                        const outgoing = myWar.pendingChallenges.filter(c => c.fromClan === myClan && c.status === "pending");
                        if (outgoing.length === 0) return null;
                        return (
                            <div style={{ background: "#0a1f0a", border: "1px solid #4ade80", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                                <strong style={{ color: "#4ade80" }}>📤 Your Clan's Sent Challenges ({outgoing.length})</strong>
                                {outgoing.map(ch => {
                                    const isTwoV = ch.mode === "pvp2v2" || ch.mode === "pet2v2";
                                    const minsLeft = Math.max(1, Math.ceil((ch.expiresAt - Date.now()) / 60_000));
                                    const mine = ch.fromPlayer.toLowerCase() === character.name.toLowerCase()
                                        || (ch.fromPlayer2 ?? "").toLowerCase() === character.name.toLowerCase();
                                    const enemyQueueCount = (ch.acceptedPlayer ? 1 : 0) + (ch.acceptedPlayer2 ? 1 : 0);
                                    const enemyQueueLabel = isTwoV ? ` · enemy accept queue ${enemyQueueCount}/2` : "";
                                    return (
                                        <div key={ch.id} style={{ background: "#0b1220", padding: "0.5rem 0.7rem", borderRadius: 4, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <strong style={{ flex: 1, minWidth: 200 }}>
                                                {CW_MODE_ICON[ch.mode]} {CW_MODE_LABEL[ch.mode]}
                                                <span style={{ color: "#94a3b8", fontWeight: 400 }}> · {ch.fromPlayer}{ch.fromPlayer2 ? ` + ${ch.fromPlayer2}` : ""} · expires in {minsLeft}m{enemyQueueLabel}</span>
                                            </strong>
                                            {isTwoV && mine && (
                                                <button onClick={() => handleLeaveSend(ch.id)} disabled={busy} style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
                                                    🚪 Leave Send Queue
                                                </button>
                                            )}
                                            {mine && (
                                                <button onClick={() => handleCancel(ch.id)} disabled={busy} className="danger-button" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}>
                                                    Cancel (full)
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Active battles — accepted challenges where the current player is a participant */}
                    {(() => {
                        const myActive = myWar.pendingChallenges.filter(c => c.status === "accepted" && (
                            (c.fromPlayer ?? "").toLowerCase() === character.name.toLowerCase()
                            || (c.fromPlayer2 ?? "").toLowerCase() === character.name.toLowerCase()
                            || (c.acceptedPlayer ?? "").toLowerCase() === character.name.toLowerCase()
                            || (c.acceptedPlayer2 ?? "").toLowerCase() === character.name.toLowerCase()
                        ));
                        if (myActive.length === 0) return null;
                        return (
                            <div style={{ background: "#1f1606", border: "1px solid #fbbf24", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                                <strong style={{ color: "#fbbf24" }}>⚔ Your Active Battles ({myActive.length})</strong>
                                <p style={{ fontSize: "0.78rem", color: "#fef3c7", margin: "4px 0 8px" }}>
                                    When a challenge is accepted, both clients are <strong>auto-pulled</strong> into the matching battle screen — no buttons to click. The win &amp; loss handlers post the result to the server when the fight ends, the opposing client's report confirms it, and damage applies. If you navigated away, use <em>Re-launch</em> below to jump back in.
                                </p>
                                {myActive.map(ch => {
                                    const fromSide = (ch.fromPlayer ?? "").toLowerCase() === character.name.toLowerCase()
                                        || (ch.fromPlayer2 ?? "").toLowerCase() === character.name.toLowerCase();
                                    const opponents = fromSide
                                        ? [ch.acceptedPlayer, ch.acceptedPlayer2].filter(Boolean) as string[]
                                        : [ch.fromPlayer, ch.fromPlayer2].filter(Boolean) as string[];
                                    const myWinResult: CwChallengeResult = fromSide ? "from-wins" : "to-wins";
                                    // _oppWinResult kept for symmetry / future dispute-against-opponent flow.
                                    const _oppWinResult: CwChallengeResult = fromSide ? "to-wins" : "from-wins";
                                    void _oppWinResult;
                                    // Two-phase state. A tentative claim
                                    // by someone shows differently for the
                                    // opposing side (confirm/dispute) vs.
                                    // the tentative reporter (waiting).
                                    const hasTentative = !!ch.tentativeResult;
                                    const iAmTentative = (ch.tentativeBy ?? "").toLowerCase() === character.name.toLowerCase();
                                    const tentativeMins = ch.tentativeAt
                                        ? Math.max(0, 15 - Math.floor((Date.now() - ch.tentativeAt) / 60_000))
                                        : 15;
                                    const tentativeStale = ch.tentativeAt ? (Date.now() - ch.tentativeAt) >= 15 * 60_000 : false;
                                    const tentativeMyWin = ch.tentativeResult === myWinResult;
                                    const tentativeLabel = ch.tentativeResult === "draw" ? "draw" : (tentativeMyWin ? "you won" : "opponent won");
                                    return (
                                        <div key={ch.id} style={{ background: "#0b1220", padding: "0.6rem 0.7rem", borderRadius: 4, marginTop: 6 }}>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
                                                <strong style={{ flex: 1, minWidth: 200 }}>
                                                    {CW_MODE_ICON[ch.mode]} {CW_MODE_LABEL[ch.mode]}
                                                    <span style={{ color: "#94a3b8", fontWeight: 400 }}> · vs {opponents.join(" + ") || "?"} · −{CW_DAMAGE[ch.mode]} HP on win</span>
                                                </strong>
                                                <button onClick={() => launchBattle(ch)} disabled={busy} style={{ padding: "0.25rem 0.55rem", background: "#0f172a", borderColor: "#475569", color: "#94a3b8", fontSize: "0.78rem" }}>
                                                    ↻ Re-launch
                                                </button>
                                            </div>
                                            {hasTentative && (
                                                <div style={{ background: "#0f1a2a", border: "1px solid #60a5fa", borderRadius: 4, padding: "0.4rem 0.6rem", marginBottom: 6, fontSize: "0.82rem" }}>
                                                    {iAmTentative
                                                        ? <span style={{ color: "#fbbf24" }}>⏳ Your tentative report (<strong>{tentativeLabel}</strong>) is awaiting opposing-side confirmation. {tentativeStale ? "Window elapsed — click any button below to auto-confirm." : `${tentativeMins}m remaining.`}</span>
                                                        : <span style={{ color: "#a7f3d0" }}>📨 Opposing side reported <strong>{tentativeLabel}</strong>. {tentativeStale ? "Window elapsed — clicking below will auto-confirm." : `Confirm to apply damage, or dispute to record a draw. ${tentativeMins}m remaining.`}</span>}
                                                </div>
                                            )}
                                            {/* No manual reporting. PvP win/loss handlers + the
                                                Pet Arena onClanWarBattleEnd hook post the result
                                                automatically when the battle resolves. The two-
                                                phase server merge + the PvpSession cross-check
                                                cover correctness without player input. */}
                                            {ch.battleId && <small style={{ display: "block", marginTop: 4, color: "#64748b" }}>Battle ID: {ch.battleId}</small>}
                                            {ch.petBattleSeed && <small style={{ display: "block", marginTop: 4, color: "#64748b" }}>Pet seed: {ch.petBattleSeed}</small>}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Recent battles log */}
                    {myWar.completedChallenges.length > 0 && (
                        <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                            <strong style={{ color: "#94a3b8" }}>📜 Recent Battles</strong>
                            <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: "0.82rem" }}>
                                {myWar.completedChallenges.slice(0, 10).map(ch => {
                                    const winnerSide = ch.result === "from-wins" ? ch.fromClan : ch.result === "to-wins" ? (myWar.clans.find(c => c !== ch.fromClan) ?? "?") : null;
                                    const tag = ch.status === "expired" ? "⏳ expired" :
                                                ch.status === "cancelled" ? "✕ cancelled" :
                                                ch.result === "draw" ? "🤝 draw" :
                                                winnerSide ? `🏆 ${winnerSide} won (−${CW_DAMAGE[ch.mode]} enemy HP)` : "?";
                                    return (
                                        <div key={ch.id} style={{ color: winnerSide === myClan ? "#4ade80" : winnerSide === enemyClan ? "#f87171" : "#94a3b8" }}>
                                            {CW_MODE_ICON[ch.mode]} {CW_MODE_LABEL[ch.mode]} — {tag}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* No active war — show declare form if I'm leadership */}
            {!loading && !myWar && (
                <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 6, padding: "0.8rem", marginBottom: "1rem" }}>
                    <p style={{ marginTop: 0 }}>Your clan ({myClan}) is not currently in a clan war.</p>
                    {canLead ? (
                        <>
                            <p style={{ fontSize: "0.82rem", color: "#fbbf24" }}>Wars run until one clan's 1,000 HP hits 0. 7-day rematch cooldown.</p>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <select value={declareTarget} onChange={e => setDeclareTarget(e.target.value)} style={{ padding: "0.35rem" }} disabled={busy}>
                                    <option value="">Pick enemy clan…</option>
                                    {eligibleTargets.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <button onClick={handleDeclare} disabled={busy || !declareTarget} style={{ padding: "0.4rem 0.8rem", background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }}>
                                    {busy ? "Declaring…" : "⚔ Declare Clan War"}
                                </button>
                            </div>
                            {eligibleTargets.length === 0 && <p style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 6 }}>No eligible clans right now — all known clans are already in wars or unavailable.</p>}
                        </>
                    ) : (
                        <p style={{ fontSize: "0.82rem", color: "#64748b", fontStyle: "italic" }}>Only your Clan Founder / Leader / Officer can declare a clan war.</p>
                    )}
                </div>
            )}

            {/* Spectator: other active clan wars */}
            {(() => {
                const others = wars.filter(w => !w.endedAt && !w.clans.includes(myClan));
                if (others.length === 0) return null;
                return (
                    <div style={{ marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid #334155" }}>
                        <h4 style={{ color: "#94a3b8", marginTop: 0, marginBottom: 8 }}>👁 Other Active Clan Wars</h4>
                        <div style={{ display: "grid", gap: 8 }}>
                            {others.map(w => {
                                const [cA, cB] = w.clans;
                                return (
                                    <div key={w.id} style={{ background: "#0b1220", padding: "0.5rem 0.7rem", borderRadius: 4, fontSize: "0.85rem" }}>
                                        <strong>{cA}</strong> <span style={{ color: "#64748b" }}>vs</span> <strong>{cB}</strong>
                                        <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginTop: 2 }}>
                                            {cA}: {(w.hp[cA] ?? 0).toLocaleString()} HP · {cB}: {(w.hp[cB] ?? 0).toLocaleString()} HP · {w.completedChallenges.length} battles
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}
        </section>
    );
}

// -- Hall of Legends ---------------------------------------------------------

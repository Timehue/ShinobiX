/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { realtimeAvailable, subscribeKvKey } from "../lib/realtime";

type CwTileCardStat = { id: string; element: string; top: number; right: number; bottom: number; left: number };
type CwTileCardSide = {
    name: string;
    clan: string;
    defaultDeck: CwTileCardStat[];
    deck?: CwTileCardStat[];
    handIds?: string[];
    ready: boolean;
};
type CwTileCardCell = { cardId: string; owner: "p1" | "p2" } | null;
type CwTileCardSession = {
    warId: string;
    challengeId: string;
    p1: CwTileCardSide;
    p2?: CwTileCardSide;
    board: CwTileCardCell[];
    turn: "p1" | "p2";
    status: "awaiting-p2" | "picking" | "active" | "done";
    winner?: "p1" | "p2" | "draw";
    turnDeadline?: number;
    pickingDeadline?: number;
    coinFlip?: "p1" | "p2";
};

export function ClanWarTileCardDuel({ character, setScreen, sharedImages }: { character: Character; setScreen: (s: Screen) => void; sharedImages: Record<string, string> }) {
    void sharedImages;
    const [session, setSession] = useState<CwTileCardSession | null>(null);
    const [error, setError] = useState("");
    const [selectedCardId, setSelectedCardId] = useState<string>("");
    const [busy, setBusy] = useState(false);
    // Read the clan-war stash for warId + challengeId. If missing,
    // we can't proceed — kick the player back.
    const stash = useMemo(() => {
        try {
            const raw = sessionStorage.getItem("clanWarChallenge.v1");
            if (!raw) return null;
            return JSON.parse(raw) as { warId: string; challengeId: string; mode: string };
        } catch { return null; }
    }, []);

    const refresh = useCallback(async () => {
        if (!stash?.challengeId || !stash?.warId) return;
        try {
            const r = await fetch("/api/clan/war/tilecards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "state", warId: stash.warId, challengeId: stash.challengeId }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.session) {
                setSession(data.session as CwTileCardSession);
                setError("");
            } else if (r.status === 404) {
                // Session not initialized yet on this client. Trigger init.
                // launchClanWarBattle already fired init, but in resume cases
                // (refresh after navigation) we may need to retry.
                setError("Waiting for duel to start…");
            } else {
                setError(data.error ?? `HTTP ${r.status}`);
            }
        } catch (e) {
            setError(String((e as Error).message));
        }
    }, [stash?.challengeId, stash?.warId]);

    useEffect(() => {
        if (!stash) return;
        // Always do an initial fetch — subscriptions only push NEW
        // writes, so we need the current state to render anything.
        void refresh();
        // Realtime path: subscribe to the cw-tilecards:<id> KV row.
        // Supabase pushes the updated session on every server commit
        // (~30-80ms). Falls back to the 1.5s polling loop when
        // VITE_SUPABASE_* env vars aren't configured.
        let unsubscribe: (() => void) | null = null;
        if (realtimeAvailable()) {
            unsubscribe = subscribeKvKey<CwTileCardSession>(
                `cw-tilecards:${stash.challengeId}`,
                (next) => { setSession(next); setError(""); },
            );
        }
        // Keep a low-frequency poll as belt-and-braces — picks up
        // server-driven transitions that don't directly write the
        // row (e.g., the picking-deadline auto-start) and provides a
        // fallback when Realtime is unconfigured.
        const id = setInterval(refresh, unsubscribe ? 5000 : 1500);
        return () => {
            clearInterval(id);
            if (unsubscribe) { try { unsubscribe(); } catch { /* noop */ } }
        };
    }, [refresh, stash]);

    // Clear the sessionStorage stash when the duel finishes — the
    // server has already applied HP damage by then.
    useEffect(() => {
        if (session?.status === "done") {
            try { sessionStorage.removeItem("clanWarChallenge.v1"); } catch { /* ignore */ }
        }
    }, [session?.status]);

    // ── Hooks must run in identical order every render (Rules of Hooks).
    // The original layout had an early `if (!stash) return ...` here, with
    // additional useMemo/useState/useEffect calls below it. That meant the
    // "no stash" render path skipped those hooks entirely, producing a
    // potential mismatch on later renders if stash transitioned (in practice
    // it can't — stash uses [] deps — but the lint rule is right to flag it
    // and the brittle pattern is easy to break later). All hooks now live
    // BEFORE the early return; the no-stash render is reached via the same
    // hook sequence as the active duel render.

    // Picking-phase state: the player's selected card IDs (max 5) and
    // their full owned-card collection. Local-only until they click
    // "Lock in deck" which submits to the server.
    const ownedTileCards = useMemo(() => {
        const all = getAllTileCards([]);
        const owned = (character.tileCards ?? [])
            .map(id => all.find(c => c.id === id))
            .filter((c): c is TileCard => Boolean(c));
        return owned;
    }, [character.tileCards]);
    const [pickedIds, setPickedIds] = useState<string[]>([]);

    // Compute derived state (non-hooks) — these are safe to evaluate with
    // null session because the ternaries short-circuit on the null guard.
    const mySide: "p1" | "p2" | null = !session ? null
        : session.p1.name.toLowerCase() === character.name.toLowerCase() ? "p1"
        : session.p2 && session.p2.name.toLowerCase() === character.name.toLowerCase() ? "p2"
        : null;
    const me = session && mySide ? (mySide === "p1" ? session.p1 : session.p2!) : null;
    const opp = session && mySide ? (mySide === "p1" ? session.p2 : session.p1) : null;
    const isMyTurn = !!(session && mySide && session.status === "active" && session.turn === mySide);
    const secondsRemaining = session?.turnDeadline ? Math.max(0, Math.ceil((session.turnDeadline - Date.now()) / 1000)) : 0;
    const pickingSecondsRemaining = session?.pickingDeadline ? Math.max(0, Math.ceil((session.pickingDeadline - Date.now()) / 1000)) : 0;

    // Pre-populate the picker with the fallback deck once the session loads.
    useEffect(() => {
        if (session?.status === "picking" && pickedIds.length === 0 && me?.defaultDeck) {
            setPickedIds(me.defaultDeck.map(c => c.id));
        }
    }, [session?.status, me?.defaultDeck, pickedIds.length]);

    function togglePick(id: string) {
        setPickedIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 5) return prev;
            return [...prev, id];
        });
    }

    async function lockInDeck() {
        if (!session || pickedIds.length !== 5) return;
        const all = getAllTileCards([]);
        const cards = pickedIds.map(id => all.find(c => c.id === id)).filter((c): c is TileCard => Boolean(c));
        if (cards.length !== 5) {
            setError("Could not resolve all 5 cards in your selection.");
            return;
        }
        const deckPayload = cards.map(c => ({ id: c.id, element: c.element, top: c.top, right: c.right, bottom: c.bottom, left: c.left }));
        setBusy(true);
        try {
            const r = await fetch("/api/clan/war/tilecards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "submit-deck", warId: session.warId, challengeId: session.challengeId, deck: deckPayload }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.session) {
                setSession(data.session as CwTileCardSession);
                setError("");
            } else {
                setError(data.error ?? `HTTP ${r.status}`);
            }
        } catch (e) {
            setError(String((e as Error).message));
        }
        setBusy(false);
    }

    // Coin-flip flash: shows for ~2 seconds when transitioning from
    // picking → active so both clients see the same outcome.
    const [showCoinFlip, setShowCoinFlip] = useState(false);
    const lastStatusRef = useRef<CwTileCardSession["status"] | null>(null);
    useEffect(() => {
        const prev = lastStatusRef.current;
        lastStatusRef.current = session?.status ?? null;
        if (prev === "picking" && session?.status === "active" && session.coinFlip) {
            setShowCoinFlip(true);
            const t = setTimeout(() => setShowCoinFlip(false), 2200);
            return () => clearTimeout(t);
        }
    }, [session?.status, session?.coinFlip]);

    async function place(pos: number) {
        if (!isMyTurn || !selectedCardId || !session) return;
        if (session.board[pos] !== null) return;
        setBusy(true);
        try {
            const r = await fetch("/api/clan/war/tilecards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "move",
                    warId: session.warId,
                    challengeId: session.challengeId,
                    pos,
                    cardId: selectedCardId,
                }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.session) {
                setSession(data.session as CwTileCardSession);
                setSelectedCardId("");
            } else {
                setError(data.error ?? `HTTP ${r.status}`);
            }
        } catch (e) {
            setError(String((e as Error).message));
        }
        setBusy(false);
    }

    async function forfeit() {
        if (!session || !window.confirm("Forfeit the duel? The opposing clan wins and deals damage to your clan.")) return;
        setBusy(true);
        try {
            await fetch("/api/clan/war/tilecards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "forfeit", warId: session.warId, challengeId: session.challengeId }),
            });
        } catch { /* ignore */ }
        setBusy(false);
        void refresh();
    }

    function cardStats(cardId: string): CwTileCardStat | null {
        if (!session) return null;
        const p1Deck = session.p1.deck ?? session.p1.defaultDeck;
        const hit = p1Deck.find(c => c.id === cardId);
        if (hit) return hit;
        const p2Deck = session.p2?.deck ?? session.p2?.defaultDeck ?? [];
        return p2Deck.find(c => c.id === cardId) ?? null;
    }

    const score = useMemo(() => {
        if (!session) return { p1: 0, p2: 0 };
        let p1 = 0, p2 = 0;
        for (const c of session.board) {
            if (!c) continue;
            if (c.owner === "p1") p1++; else p2++;
        }
        return { p1, p2 };
    }, [session]);

    const myScore = mySide === "p1" ? score.p1 : score.p2;
    const oppScore = mySide === "p1" ? score.p2 : score.p1;
    const youWon = session?.status === "done" && session.winner === mySide;
    const isDraw = session?.status === "done" && session.winner === "draw";

    // No-stash fallback render (moved below all hooks to satisfy Rules of Hooks).
    if (!stash) {
        return (
            <div className="card" style={{ maxWidth: 700, margin: "1rem auto", padding: "1.4rem" }}>
                <h2>⚠ No active clan-war tile-card duel</h2>
                <p>The duel context was lost. Return to the Shinobi Council Hall.</p>
                <button onClick={() => setScreen("shinobiCouncil")}>Back to Council Hall</button>
            </div>
        );
    }

    return (
        <div className="card" style={{ maxWidth: 820, margin: "1rem auto", padding: "1.4rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.8rem" }}>
                <h2 style={{ margin: 0 }}>🃏 Clan War Tile Card Duel</h2>
                <button type="button" onClick={() => setScreen("shinobiCouncil")} style={{ marginLeft: "auto", padding: "0.3rem 0.7rem", fontSize: "0.85rem" }}>← Back</button>
            </div>
            {error && <div style={{ color: "#f87171", marginBottom: "0.5rem", padding: "0.4rem 0.6rem", background: "#3b0a0a", borderRadius: 4 }}>⚠ {error}</div>}
            {!session && <p className="hint">Connecting to duel session…</p>}
            {session && session.status === "awaiting-p2" && (
                <div style={{ background: "#0b1220", border: "1px solid #fbbf24", borderRadius: 6, padding: "0.8rem" }}>
                    <strong style={{ color: "#fbbf24" }}>⏳ Waiting for the opposing clan's duelist to join…</strong>
                    <p className="hint" style={{ marginTop: 6 }}>They'll be auto-pulled in when the challenge accepts on their client.</p>
                </div>
            )}
            {/* Picking phase — 30s for both players to lock in 5-card decks. */}
            {session && session.status === "picking" && me && (() => {
                const opponentReady = mySide === "p1" ? !!session.p2?.ready : !!session.p1.ready;
                const meReady = !!me.ready;
                return (
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem", background: "#0b1220", padding: "0.6rem 0.8rem", borderRadius: 6 }}>
                            <strong style={{ color: "#fbbf24" }}>🃏 Pick your 5-card deck</strong>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: "1.4rem" }}>⏱ {pickingSecondsRemaining}s</div>
                                <small style={{ color: "#94a3b8" }}>
                                    You: {meReady ? "✅ Locked in" : `${pickedIds.length}/5 picked`} · Opponent: {opponentReady ? "✅ Locked in" : "Still picking…"}
                                </small>
                            </div>
                        </div>
                        {!meReady && (
                            <>
                                <p className="hint" style={{ marginBottom: 8 }}>
                                    Tap up to 5 cards from your collection. If both players lock in before the timer runs out the match starts early; otherwise the auto-picked top-5 deck is used.
                                </p>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, maxHeight: 360, overflowY: "auto", padding: 6, background: "#0b1220", borderRadius: 6 }}>
                                    {ownedTileCards.length === 0 ? (
                                        <p className="hint">You don't own any tile cards — the auto-picked fallback deck will be used at timeout.</p>
                                    ) : ownedTileCards.map(card => {
                                        const picked = pickedIds.includes(card.id);
                                        const disabled = !picked && pickedIds.length >= 5;
                                        return (
                                            <button
                                                key={card.id}
                                                onClick={() => togglePick(card.id)}
                                                disabled={disabled}
                                                style={{
                                                    padding: "0.5rem 0.6rem", background: picked ? "#1e3a8a" : "#0f172a",
                                                    border: `2px solid ${picked ? "#60a5fa" : "#334155"}`, borderRadius: 6,
                                                    color: "#e5e7eb", fontSize: "0.78rem", cursor: disabled ? "not-allowed" : "pointer",
                                                    opacity: disabled ? 0.5 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                                                }}
                                            >
                                                <strong style={{ fontSize: "0.78rem" }}>{card.name}</strong>
                                                <small style={{ color: "#94a3b8" }}>{card.element} · {card.rarity}</small>
                                                <div style={{ fontSize: "0.72rem", marginTop: 2 }}>
                                                    ↑{card.top} ←{card.left} →{card.right} ↓{card.bottom}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                                    <button
                                        onClick={() => void lockInDeck()}
                                        disabled={busy || pickedIds.length !== 5}
                                        style={{ padding: "0.5rem 1rem", background: pickedIds.length === 5 ? "linear-gradient(#15803d,#0a4019)" : "#1f2937", borderColor: pickedIds.length === 5 ? "#4ade80" : "#475569" }}
                                    >
                                        {busy ? "Locking in…" : pickedIds.length === 5 ? "✅ Ready — Lock in deck" : `Pick ${5 - pickedIds.length} more`}
                                    </button>
                                    <button onClick={() => void forfeit()} disabled={busy} className="danger-button" style={{ fontSize: "0.8rem" }}>Forfeit</button>
                                </div>
                            </>
                        )}
                        {meReady && (
                            <div style={{ background: "#0a2010", border: "1px solid #4ade80", borderRadius: 6, padding: "0.8rem", textAlign: "center" }}>
                                <strong style={{ color: "#4ade80" }}>✅ Your deck is locked in.</strong>
                                <p className="hint" style={{ marginTop: 6 }}>
                                    {opponentReady
                                        ? "Both players ready — the match starts immediately after the coin flip."
                                        : `Waiting for the opposing duelist to lock in… ${pickingSecondsRemaining}s remaining. If they time out, their auto-picked fallback deck is used.`}
                                </p>
                            </div>
                        )}
                    </div>
                );
            })()}
            {/* Coin-flip flash — shows for ~2s when the match starts. */}
            {showCoinFlip && session?.coinFlip && mySide && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.3s" }}>
                    <div style={{ background: "linear-gradient(#1e3a8a,#172554)", border: "2px solid #fbbf24", borderRadius: 16, padding: "2rem 3rem", textAlign: "center", boxShadow: "0 0 40px rgba(251,191,36,0.5)" }}>
                        <div style={{ fontSize: "3rem", marginBottom: 8 }}>🪙</div>
                        <h2 style={{ color: "#fbbf24", margin: "0 0 8px" }}>Coin Flip</h2>
                        <p style={{ fontSize: "1.1rem", color: "#e5e7eb" }}>
                            <strong style={{ color: session.coinFlip === mySide ? "#4ade80" : "#f87171" }}>
                                {session.coinFlip === mySide ? "You go first!" : `${opp?.name ?? "Opponent"} goes first.`}
                            </strong>
                        </p>
                    </div>
                </div>
            )}
            {session && session.status === "active" && mySide && me && opp && (
                <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem", background: "#0b1220", padding: "0.6rem 0.8rem", borderRadius: 6 }}>
                        <div>
                            <strong style={{ color: "#4ade80" }}>{me.name} ({me.clan})</strong>
                            <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Score: <strong style={{ color: "#4ade80" }}>{myScore}</strong></div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                            <div style={{ color: "#fbbf24", fontWeight: 700 }}>{isMyTurn ? "🟢 YOUR TURN" : "⏳ OPPONENT'S TURN"}</div>
                            <small style={{ color: "#94a3b8" }}>{secondsRemaining}s</small>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <strong style={{ color: "#f87171" }}>{opp.name} ({opp.clan})</strong>
                            <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Score: <strong style={{ color: "#f87171" }}>{oppScore}</strong></div>
                        </div>
                    </div>
                    {/* 3x3 board */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, maxWidth: 420, margin: "0 auto 1rem" }}>
                        {session.board.map((cell, idx) => {
                            const card = cell ? cardStats(cell.cardId) : null;
                            const owner = cell?.owner;
                            const isMine = owner === mySide;
                            const bg = !cell ? (isMyTurn && selectedCardId ? "#1e293b" : "#0b1220") : isMine ? "#15803d" : "#7f1d1d";
                            return (
                                <button
                                    key={idx}
                                    disabled={!isMyTurn || !selectedCardId || cell !== null || busy}
                                    onClick={() => void place(idx)}
                                    style={{
                                        aspectRatio: "1", padding: 8, background: bg, border: "1px solid #475569",
                                        borderRadius: 6, color: "#e5e7eb", fontSize: "0.78rem", cursor: cell || !isMyTurn || !selectedCardId ? "default" : "pointer",
                                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                                        position: "relative", minHeight: 80,
                                    }}
                                >
                                    {card && (
                                        <>
                                            <strong style={{ fontSize: "0.7rem" }}>{card.id}</strong>
                                            <div style={{ fontSize: "0.65rem", opacity: 0.85 }}>{card.element}</div>
                                            <div style={{ fontSize: "0.7rem", marginTop: 2 }}>
                                                <span style={{ position: "absolute", top: 4, left: "50%", transform: "translateX(-50%)" }}>{card.top}</span>
                                                <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)" }}>{card.left}</span>
                                                <span style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}>{card.right}</span>
                                                <span style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)" }}>{card.bottom}</span>
                                            </div>
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {/* My hand */}
                    <div>
                        <strong style={{ color: "#94a3b8" }}>Your Hand ({(me.handIds ?? []).length} cards)</strong>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                            {(me.handIds ?? []).map(id => {
                                const card = cardStats(id);
                                if (!card) return null;
                                const sel = selectedCardId === id;
                                return (
                                    <button
                                        key={id}
                                        disabled={!isMyTurn || busy}
                                        onClick={() => setSelectedCardId(sel ? "" : id)}
                                        style={{
                                            padding: "0.5rem 0.7rem", background: sel ? "#1e3a8a" : "#0b1220",
                                            border: `2px solid ${sel ? "#60a5fa" : "#334155"}`, borderRadius: 6,
                                            color: "#e5e7eb", fontSize: "0.78rem", cursor: isMyTurn ? "pointer" : "default",
                                            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 90,
                                        }}
                                    >
                                        <strong style={{ fontSize: "0.78rem" }}>{card.id}</strong>
                                        <small style={{ color: "#94a3b8" }}>{card.element}</small>
                                        <div style={{ fontSize: "0.72rem", marginTop: 2 }}>
                                            ↑{card.top} ←{card.left} →{card.right} ↓{card.bottom}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {!isMyTurn && <p className="hint" style={{ marginTop: 6 }}>Wait for {opp.name} to place a card.</p>}
                        {isMyTurn && !selectedCardId && <p className="hint" style={{ marginTop: 6 }}>Pick a card from your hand, then click an empty cell.</p>}
                    </div>
                    <div style={{ marginTop: "1rem", display: "flex", gap: 8 }}>
                        <button onClick={() => void forfeit()} disabled={busy} className="danger-button" style={{ fontSize: "0.8rem" }}>Forfeit</button>
                    </div>
                </>
            )}
            {session && session.status === "done" && (
                <div style={{ background: youWon ? "#0a2010" : isDraw ? "#1f1606" : "#1f0a0a", border: `1px solid ${youWon ? "#4ade80" : isDraw ? "#fbbf24" : "#f87171"}`, borderRadius: 8, padding: "1.2rem", textAlign: "center" }}>
                    <h2 style={{ color: youWon ? "#4ade80" : isDraw ? "#fbbf24" : "#f87171", marginTop: 0 }}>
                        {youWon ? "🏆 Victory" : isDraw ? "🤝 Draw" : "💀 Defeat"}
                    </h2>
                    <p>Final score — You: <strong>{myScore}</strong> · Opponent: <strong>{oppScore}</strong></p>
                    {!isDraw && <p className="hint">Clan-war HP damage applied to the losing clan automatically.</p>}
                    {isDraw && <p className="hint">No damage on a draw.</p>}
                    <button onClick={() => setScreen("shinobiCouncil")} style={{ marginTop: 12, padding: "0.5rem 1rem", background: "linear-gradient(#1e3a8a,#172554)", borderColor: "#60a5fa" }}>
                        🏯 Return to Council Hall
                    </button>
                </div>
            )}
        </div>
    );
}

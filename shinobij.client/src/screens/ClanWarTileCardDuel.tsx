/* eslint-disable react-hooks/set-state-in-effect */
/*
 * ClanWarTileCardDuel — the clan-war duel screen, now Shinobi Card Clash.
 *
 * This is server-authoritative real-time PvP: the server (api/clan/war/tilecards)
 * runs the match and applies clan-war HP damage. This client only renders the
 * PROJECTED session (the opponent's hand + staged plays are hidden) and sends
 * actions: submit-deck (12-card lock-in during picking), commit-turn (stage this
 * turn's plays), and forfeit. It polls `state` (no realtime subscription) so the
 * opponent's staged plays never leak through a raw KV row.
 *
 * Each turn both players SECRETLY stage their plays, then commit. When both have
 * committed (or the 60s turn timer elapses) the server reveals both sides at once
 * and advances. Win 2 of 3 locations after turn 6.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import { CARD_CLASH_BOARD_BG, CARD_CLASH_LOCATION_ART } from "../lib/card-clash-art";
import type { Screen } from "../types/core";
import { getAllTileCards } from "../data/tile-cards";
import {
    toClashCards,
    indexClashCards,
    validateDeck,
    canAddToDeck,
    buildPlayableDeck,
    deckCopyLimit,
    SHADOW_CLONE_CARD,
    CARD_CLASH_DECK_SIZE,
    CARD_CLASH_LOCATION_SLOTS,
    CARD_CLASH_MAX_LEGENDARY,
    type CardClashCard,
} from "../lib/card-clash";
import { CardClashCardView } from "../components/CardClashCardView";
import { gameConfirm } from "../components/GameAlert";

// ── Server projection shapes (see tilecards.ts projectFor) ───────────────────
type ServerCard = { id: string; element: string; rarity: CardClashCard["rarity"]; cost: number; power: number; ability: string };
type ServerPlayed = ServerCard & { iid: string; basePower: number; currentPower: number; loc: number; protectedFromReduction?: boolean; isToken?: boolean };
type ServerLoc = { def: { id: string; name: string; description: string; effectType: string }; p1: ServerPlayed[]; p2: ServerPlayed[] };
type ServerMatch = { locations: ServerLoc[]; turn: number; log: string[] };
type SideKey = "p1" | "p2";
type View = {
    status: "awaiting-p2" | "awaiting-defender" | "picking" | "active" | "done";
    winner?: SideKey | "draw";
    coinFlip?: SideKey;
    turnDeadline?: number; pickingDeadline?: number;
    match: ServerMatch | null; turn: number;
    side: SideKey | null;
    you: { side: SideKey; name: string; clan: string; ready: boolean; committed: boolean; chakra: number; nextDiscount: number; hand: ServerCard[]; pending: { handIndex: number; loc: number }[]; deckCount: number } | null;
    opponent: { name: string; clan: string; ready: boolean; committed: boolean; chakra: number; nextDiscount: number; handCount: number; deckCount: number } | null;
};

type Staged = { handIndex: number; loc: number };

function locBonus(card: { element: string; rarity: string; cost: number; power: number }, effectType: string): number {
    switch (effectType) {
        case "fireBonus": return card.element === "Fire" ? 2 : 0;
        case "waterBonus": return card.element === "Water" ? 2 : 0;
        case "earthBonus": return card.element === "Earth" ? 2 : 0;
        case "windBonus": return card.element === "Wind" ? 2 : 0;
        case "lightningBonus": return card.element === "Lightning" ? 2 : 0;
        case "shadowBonus": return card.element === "Shadow" ? 2 : 0;
        case "iceBonus": return card.element === "Ice" ? 2 : 0;
        case "commonBonus": return card.rarity === "common" ? 2 : 0;
        case "rareBonus": return card.rarity === "rare" ? 2 : 0;
        case "epicLegendaryBonus": return card.rarity === "epic" || card.rarity === "legendary" ? 2 : 0;
        case "lowCostBonus": return card.cost <= 2 ? 1 : 0;
        case "highCostBonus": return card.cost >= 5 ? 2 : 0;
        case "neutralBonus": return card.element === "Neutral" ? 2 : 0;
        case "noneBonus": return card.element === "None" ? 2 : 0;
        case "midCostBonus": return card.cost === 3 || card.cost === 4 ? 2 : 0;
        case "allHereBonus": return 1;
        case "lowPowerBonus": return card.power <= 3 ? 2 : 0;
        case "highPowerBonus": return card.power >= 8 ? 2 : 0;
        default: return 0;
    }
}

export interface CardClashDuelConfig {
    stashKey: string;            // sessionStorage key holding the session id payload
    endpoint: string;            // the duel API path
    title: string;               // sub-title under "Shinobi Card Clash"
    backScreen: Screen;
    backLabel: string;
    emptyTitle: string;
    emptyNote: string;
    emptyBackLabel: string;
    awaitingNote: string;
    forfeitConfirm: string;
    doneNote: (won: boolean, draw: boolean) => string;
    // When true, the screen auto-`join`s the session on mount (the sector-war card
    // battle has no separate accept step). Clan-war joins at challenge-accept time.
    autoJoin?: boolean;
}

// The clan-war duel config — the original behaviour, applied by the back-compat
// ClanWarTileCardDuel wrapper at the bottom of this file.
const CLAN_WAR_DUEL_CONFIG: CardClashDuelConfig = {
    stashKey: "clanWarChallenge.v1",
    endpoint: "/api/clan/war/tilecards",
    title: "Clan War Duel",
    backScreen: "shinobiCouncil",
    backLabel: "← Council",
    emptyTitle: "⚠ No active clan-war duel",
    emptyNote: "The duel context was lost. Return to the Shinobi Council Hall.",
    emptyBackLabel: "Back to Council Hall",
    awaitingNote: "⏳ Waiting for the opposing clan's duelist to join…",
    forfeitConfirm: "Forfeit the duel? Your clan takes the damage.",
    doneNote: (_won, draw) => (draw ? "No damage on a draw." : "Clan-war HP damage applied automatically."),
};

// Generic Shinobi Card Clash duel screen — drives the join/submit/commit/state
// loop against `config.endpoint` for the session id(s) stashed under
// `config.stashKey`. Used for both the clan-war duel and the sector-war card
// battle (/api/village/sector-card); only the config differs.
export function CardClashDuelScreen({ character, setScreen, config }: { character: Character; setScreen: (s: Screen) => void; config: CardClashDuelConfig }) {
    const [view, setView] = useState<View | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // Card catalog → Clash cards, for resolving names/art/abilities from the
    // server's minimal card payloads.
    const clashById = useMemo(() => indexClashCards(toClashCards(getAllTileCards([]))), []);
    const ownedCards = useMemo(() => {
        const seen = new Set<string>();
        const out: CardClashCard[] = [];
        for (const id of character.tileCards ?? []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const c = clashById[id];
            if (c) out.push(c);
        }
        return out;
    }, [character.tileCards, clashById]);

    const stash = useMemo(() => {
        try {
            const raw = sessionStorage.getItem(config.stashKey);
            if (!raw) return null;
            return JSON.parse(raw) as Record<string, string>;
        } catch { return null; }
    }, [config.stashKey]);

    const refresh = useCallback(async () => {
        if (!stash) return;
        try {
            const r = await fetch(config.endpoint, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "state", ...stash }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.session) { setView(data.session as View); setError(""); }
            else if (r.status === 404) setError("Waiting for the duel to start…");
            else setError(data.error ?? `HTTP ${r.status}`);
        } catch (e) { setError(String((e as Error).message)); }
    }, [stash, config.endpoint]);

    // Poll only (no realtime) so the opponent's staged plays never leak.
    useEffect(() => {
        if (!stash) return;
        void refresh();
        const id = setInterval(refresh, 1500);
        const clock = setInterval(() => setNow(Date.now()), 1000);
        return () => { clearInterval(id); clearInterval(clock); };
    }, [refresh, stash]);

    // Sector-war card battles have no separate accept step — auto-join on mount so
    // the attacker opens the session and the defender joins it (the server picks the
    // side from each player's village). No-op for clan war (autoJoin unset).
    const joinedRef = useRef(false);
    useEffect(() => {
        if (!config.autoJoin || joinedRef.current || !stash) return;
        joinedRef.current = true;
        const saved = character.cardClashDeck ?? [];
        const deckIds = validateDeck(saved, clashById).valid
            ? saved
            : buildPlayableDeck(character.tileCards ?? [], clashById, toClashCards(getAllTileCards([])));
        const deck = deckIds.map((id) => {
            const c = clashById[id];
            const ability = c.abilityType === "ongoingElementBoostHere" ? "none" : c.abilityType;
            return { id: c.id, element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability };
        });
        void fetch(config.endpoint, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", ...stash, defaultDeck: deck }),
        }).then(() => refresh()).catch(() => { /* the poll surfaces any error */ });
    }, [config.autoJoin, config.endpoint, stash, character.cardClashDeck, character.tileCards, clashById, refresh]);

    useEffect(() => {
        if (view?.status === "done") {
            try { sessionStorage.removeItem(config.stashKey); } catch { /* ignore */ }
        }
    }, [view?.status, config.stashKey]);

    // ── Picking-phase deck (pre-filled from saved Card Hall deck / auto-build) ──
    const [pickedIds, setPickedIds] = useState<string[] | null>(null);
    useEffect(() => {
        if (view?.status === "picking" && pickedIds === null && !view.you?.ready) {
            const saved = character.cardClashDeck ?? [];
            const seed = validateDeck(saved, clashById).valid
                ? saved
                : buildPlayableDeck(character.tileCards ?? [], clashById, toClashCards(getAllTileCards([])));
            setPickedIds(seed);
        }
    }, [view?.status, view?.you?.ready, pickedIds, character.cardClashDeck, character.tileCards, clashById]);

    // ── Active-phase staging ────────────────────────────────────────────────
    const [staged, setStaged] = useState<Staged[]>([]);
    const [selHand, setSelHand] = useState<number | null>(null);
    const committed = !!view?.you?.committed;
    // Reset staging whenever the turn advances (or we commit).
    const turnRef = useRef<number>(0);
    useEffect(() => {
        if (view?.turn && view.turn !== turnRef.current) { turnRef.current = view.turn; setStaged([]); setSelHand(null); }
    }, [view?.turn]);
    useEffect(() => { if (committed) { setStaged([]); setSelHand(null); } }, [committed]);

    async function post(action: string, extra: Record<string, unknown>) {
        if (!view || !stash) return;
        setBusy(true);
        try {
            const r = await fetch(config.endpoint, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...stash, ...extra }),
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.session) { setView(data.session as View); setError(""); }
            else setError(data.error ?? `HTTP ${r.status}`);
        } catch (e) { setError(String((e as Error).message)); }
        setBusy(false);
    }

    function deckPayload(ids: string[]) {
        return ids.map((id) => {
            const c = clashById[id];
            const ability = c.abilityType === "ongoingElementBoostHere" ? "none" : c.abilityType;
            return { id: c.id, element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability };
        });
    }

    const pickerValid = pickedIds ? validateDeck(pickedIds, clashById).valid : false;
    function addPick(id: string) {
        if (!pickedIds) return;
        const res = canAddToDeck(pickedIds, id, clashById);
        if (!res.ok) { setError(res.reason ?? "Can't add that card."); return; }
        setError(""); setPickedIds([...pickedIds, id]);
    }
    function removePick(id: string) {
        if (!pickedIds) return;
        const i = pickedIds.indexOf(id);
        if (i === -1) return;
        setPickedIds([...pickedIds.slice(0, i), ...pickedIds.slice(i + 1)]);
    }

    // Staging helpers
    const stagedCost = (() => {
        if (!view?.you) return 0;
        let discount = view.you.nextDiscount;
        let total = 0;
        for (const s of staged) {
            const card = view.you.hand[s.handIndex];
            if (!card) continue;
            total += Math.max(1, card.cost - discount);
            discount = card.ability === "discountNextCard" ? 1 : 0;
        }
        return total;
    })();
    const chakraLeft = (view?.you?.chakra ?? 0) - stagedCost;

    function stagedAtLoc(loc: number): number { return staged.filter((s) => s.loc === loc).length; }

    function tryStage(loc: number) {
        if (selHand === null || !view?.you || committed) return;
        const card = view.you.hand[selHand];
        if (!card) return;
        if (staged.some((s) => s.handIndex === selHand)) return; // already staged
        const myKey = view.side!;
        const revealed = view.match?.locations[loc]?.[myKey].length ?? 0;
        if (revealed + stagedAtLoc(loc) >= CARD_CLASH_LOCATION_SLOTS) { setError("That location is full."); return; }
        const cost = Math.max(1, card.cost - (staged.length === 0 ? view.you.nextDiscount : 0));
        if (cost > chakraLeft) { setError("Not enough Chakra."); return; }
        setError(""); setStaged([...staged, { handIndex: selHand, loc }]); setSelHand(null);
    }
    function unstage(handIndex: number) { setStaged(staged.filter((s) => s.handIndex !== handIndex)); }

    function resolveServerCard(sc: ServerCard): CardClashCard {
        const hit = clashById[sc.id];
        if (hit) return hit;
        return { ...SHADOW_CLONE_CARD, ...sc, name: sc.id === "token-shadow-clone" ? "Shadow Clone" : sc.id, abilityType: "none", abilityText: "", role: "summoner", top: 0, right: 0, bottom: 0, left: 0, description: "" };
    }

    // ── Renders ──────────────────────────────────────────────────────────────
    if (!stash) {
        return (
            <div className="card-clash-root" style={{ "--cc-board-bg": `url(${CARD_CLASH_BOARD_BG})` } as CSSProperties}><div className="cc-body">
                <div className="cc-empty-note">
                    <h2>{config.emptyTitle}</h2>
                    <p className="cc-muted">{config.emptyNote}</p>
                    <button className="cc-btn" onClick={() => setScreen(config.backScreen)}>{config.emptyBackLabel}</button>
                </div>
            </div></div>
        );
    }

    const youKey = view?.side ?? "p1";
    const oppKey: SideKey = youKey === "p1" ? "p2" : "p1";
    const pickSecs = view?.pickingDeadline ? Math.max(0, Math.ceil((view.pickingDeadline - now) / 1000)) : 0;
    const turnSecs = view?.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - now) / 1000)) : 0;

    return (
        <div className="card-clash-root" style={{ "--cc-board-bg": `url(${CARD_CLASH_BOARD_BG})` } as CSSProperties}>
            <div className="cc-header">
                <div className="cc-title"><b>Shinobi Card Clash</b><span>{config.title}</span></div>
                <span className="cc-header-spacer" />
                {view && view.status !== "done" && (
                    <button className="cc-btn danger" disabled={busy} onClick={async () => { if (await gameConfirm(config.forfeitConfirm, { danger: true, confirmLabel: "Forfeit" })) void post("forfeit", {}); }}>Forfeit</button>
                )}
                <button className="cc-btn ghost" onClick={() => setScreen(config.backScreen)}>{config.backLabel}</button>
            </div>

            <div className="cc-body">
                {error && <div className="cc-deck-errors">⚠ {error}</div>}
                {!view && <p className="cc-muted">Connecting to duel session…</p>}

                {view && view.status !== "picking" && view.status !== "active" && view.status !== "done" && (
                    <div className="cc-empty-note">{config.awaitingNote}</div>
                )}

                {/* ── Picking phase ── */}
                {view?.status === "picking" && (
                    view.you?.ready ? (
                        <div className="cc-empty-note">✅ Your deck is locked in. Waiting for the opponent… <b>{pickSecs}s</b></div>
                    ) : (
                        <div>
                            <div className="cc-hud">
                                <b>🃏 Build your 12-card deck</b>
                                <span className="cc-hud-spacer" />
                                <span className="cc-turn" style={{ color: "var(--cc-gold)" }}>⏱ {pickSecs}s</span>
                            </div>
                            {pickedIds && (
                                <>
                                    <div className="cc-deck-meter">
                                        <span className={`big ${pickerValid ? "ok" : ""}`}>{pickedIds.length}/{CARD_CLASH_DECK_SIZE}</span>
                                        <span className="cc-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                                            Legendary {pickedIds.filter((id) => clashById[id]?.rarity === "legendary").length}/{CARD_CLASH_MAX_LEGENDARY}
                                        </span>
                                    </div>
                                    <button className="cc-btn primary" disabled={busy || !pickerValid} onClick={() => void post("submit-deck", { deck: deckPayload(pickedIds) })} style={{ marginBottom: 10 }}>
                                        {busy ? "Locking in…" : "✅ Lock in deck"}
                                    </button>
                                    {ownedCards.length === 0
                                        ? <div className="cc-empty-note">You own no cards — your auto-built fallback deck will be used at timeout.</div>
                                        : (
                                            <div className="cc-grid">
                                                {ownedCards.map((card) => {
                                                    const copies = pickedIds.filter((id) => id === card.id).length;
                                                    const maxed = copies >= deckCopyLimit(card.rarity);
                                                    return (
                                                        <div key={card.id} style={{ position: "relative", opacity: maxed ? 0.5 : 1 }}>
                                                            <CardClashCardView card={card} onClick={() => (copies > 0 ? removePick(card.id) : addPick(card.id))} />
                                                            {copies > 0 && <span className="cc-tag" style={{ position: "absolute", top: 2, right: 2, background: "#0a1326" }}>×{copies}</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                </>
                            )}
                        </div>
                    )
                )}

                {/* ── Active / done: the board ── */}
                {view && (view.status === "active" || view.status === "done") && view.match && view.you && (
                    <>
                        {view.status === "done" && (
                            <div className={`cc-result ${view.winner === youKey ? "win" : view.winner === "draw" ? "draw" : "lose"}`}>
                                <h2>{view.winner === youKey ? "🏆 Victory" : view.winner === "draw" ? "🤝 Draw" : "💀 Defeat"}</h2>
                                <p className="cc-muted">{config.doneNote(view.winner === youKey, view.winner === "draw")}</p>
                                <button className="cc-btn gold" onClick={() => setScreen(config.backScreen)}>{config.emptyBackLabel}</button>
                            </div>
                        )}

                        <div className="cc-hud">
                            <span className="cc-turn">Turn {view.match.turn}<span className="cc-hud-meta"> / 6</span></span>
                            <span className="cc-chakra">
                                {Array.from({ length: Math.max(view.match.turn, view.you.chakra) }).map((_, i) => (
                                    <span key={i} className={`orb${i >= chakraLeft ? " spent" : ""}`} />
                                ))}
                                <span className="cc-hud-meta" style={{ marginLeft: 4 }}>{Math.max(0, chakraLeft)} Chakra</span>
                            </span>
                            <span className="cc-hud-spacer" />
                            {view.status === "active" && <span className="cc-hud-meta">⏱ {turnSecs}s · 🟥 opp {view.opponent?.committed ? "✅ committed" : "thinking…"}</span>}
                        </div>

                        <div className="cc-locations">
                            {view.match.locations.map((loc, li) => {
                                const myCards = loc[youKey], oppCards = loc[oppKey];
                                const youP = myCards.reduce((s, c) => s + c.currentPower + locBonus(c, loc.def.effectType), 0);
                                const oppP = oppCards.reduce((s, c) => s + c.currentPower + locBonus(c, loc.def.effectType), 0);
                                const win = youP > oppP ? "winning-player" : oppP > youP ? "winning-opponent" : "";
                                const stagedHere = staged.filter((s) => s.loc === li);
                                const canStage = view.status === "active" && !committed && selHand !== null;
                                return (
                                    <div key={loc.def.id} className={`cc-loc ${win} ${canStage ? "playable" : ""}`} onClick={() => canStage && tryStage(li)}>
                                        <div className="cc-loc-head" style={{ "--cc-loc-img": CARD_CLASH_LOCATION_ART[loc.def.id] ? `url(${CARD_CLASH_LOCATION_ART[loc.def.id]})` : undefined } as CSSProperties}><b>{loc.def.name}</b><span className="eff">{loc.def.description}</span></div>
                                        <div className="cc-zone opp"><div className="cc-slots">
                                            {oppCards.map((c) => <CardClashCardView key={c.iid} card={resolveServerCard(c)} size="sm" owner="opponent" reveal displayedPower={c.currentPower + locBonus(c, loc.def.effectType)} />)}
                                            {Array.from({ length: Math.max(0, CARD_CLASH_LOCATION_SLOTS - oppCards.length) }).map((_, i) => <span key={i} className="cc-slot-empty" />)}
                                        </div></div>
                                        <div className="cc-power-bar"><span className="opp-p">🟥 {oppP}</span>{canStage && <span className="cc-play-hint">▶ STAGE HERE</span>}<span className="you-p">{youP} 🟦</span></div>
                                        <div className="cc-zone you"><div className="cc-slots">
                                            {myCards.map((c) => <CardClashCardView key={c.iid} card={resolveServerCard(c)} size="sm" owner="player" reveal displayedPower={c.currentPower + locBonus(c, loc.def.effectType)} />)}
                                            {stagedHere.map((s) => { const card = view.you!.hand[s.handIndex]; return <div key={`stg-${s.handIndex}`} style={{ opacity: 0.7 }}><CardClashCardView card={resolveServerCard(card)} size="sm" owner="player" onClick={() => unstage(s.handIndex)} /></div>; })}
                                            {Array.from({ length: Math.max(0, CARD_CLASH_LOCATION_SLOTS - myCards.length - stagedHere.length) }).map((_, i) => <span key={i} className="cc-slot-empty" />)}
                                        </div></div>
                                    </div>
                                );
                            })}
                        </div>

                        {view.status === "active" && (
                            <>
                                <div className="cc-hand-wrap">
                                    <div className="cc-hand-label">Your Hand — {view.you.hand.length} cards{committed ? " · committed, waiting for opponent…" : ""}</div>
                                    <div className="cc-hand">
                                        {view.you.hand.map((sc, i) => {
                                            const isStaged = staged.some((s) => s.handIndex === i);
                                            const card = resolveServerCard(sc);
                                            return (
                                                <div key={`${sc.id}-${i}`} style={{ opacity: isStaged ? 0.4 : 1 }}>
                                                    <CardClashCardView card={card} selected={selHand === i} onClick={committed || isStaged ? undefined : () => setSelHand(selHand === i ? null : i)} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="cc-controls">
                                    <span className="cc-muted" style={{ fontSize: 13 }}>
                                        {committed ? "Committed — waiting for the opponent to commit…" : selHand !== null ? "Tap a location to stage the card" : "Tap a card, then a location. Commit when ready."}
                                    </span>
                                    <span className="cc-hud-spacer" />
                                    {staged.length > 0 && !committed && <button className="cc-btn ghost" onClick={() => setStaged([])}>Clear</button>}
                                    <button className="cc-btn primary" disabled={busy || committed} onClick={() => void post("commit-turn", { plays: staged })}>
                                        {committed ? "Committed ✓" : `Commit Turn (${staged.length})`}
                                    </button>
                                </div>
                            </>
                        )}

                        <div className="cc-log">{(view.match.log ?? []).slice(-10).map((l, i) => <div key={i}>{l}</div>)}</div>
                    </>
                )}
            </div>
        </div>
    );
}

// Back-compat wrapper — the clan-war duel screen App.tsx imports. Same behaviour
// as before the CardClashDuelScreen extraction (the default clan-war config).
export function ClanWarTileCardDuel({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void; sharedImages?: Record<string, string> }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={CLAN_WAR_DUEL_CONFIG} />;
}

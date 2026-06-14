/*
 * CardClashBoard — the in-match UI for Shinobi Card Clash. Renders the 3
 * locations (opponent zone / power bar / player zone), the player hand, and the
 * End Turn / Retreat controls.
 *
 * It owns NO match state. The parent (CardHall) holds the CardClashMatchState in
 * useState and passes immutable-update callbacks; the only local state here is
 * the transient "which hand card is selected" UI highlight. Per the design rule,
 * children never mutate match state directly.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import {
    getEffectiveCost,
    getCardDisplayedPower,
    locationSidePower,
    CARD_CLASH_LOCATION_SLOTS,
    CARD_CLASH_MAX_TURNS,
    type CardClashMatchState,
    type CardClashLocationState,
} from "../lib/card-clash";
import { CardClashCardView } from "./CardClashCardView";
import { CARD_CLASH_LOCATION_ART } from "../lib/card-clash-art";

const TINT: Record<string, string> = {
    fireBonus: "rgba(255,112,67,0.2)", waterBonus: "rgba(79,195,247,0.2)",
    earthBonus: "rgba(161,136,127,0.22)", windBonus: "rgba(165,214,167,0.2)",
    lightningBonus: "rgba(255,241,118,0.18)", shadowBonus: "rgba(186,104,200,0.2)",
    iceBonus: "rgba(176,224,255,0.2)", commonBonus: "rgba(148,163,184,0.2)",
    rareBonus: "rgba(96,165,250,0.2)", epicLegendaryBonus: "rgba(206,147,216,0.2)",
    lowCostBonus: "rgba(74,222,128,0.18)", highCostBonus: "rgba(251,191,36,0.18)",
    none: "rgba(80,110,200,0.16)",
};

export function CardClashBoard({
    match,
    onPlayCard,
    onEndTurn,
    onRetreat,
    retreatLabel = "Retreat",
}: {
    match: CardClashMatchState;
    onPlayCard: (handIndex: number, locationIndex: number) => void;
    onEndTurn: () => void;
    onRetreat: () => void;
    retreatLabel?: string;
}) {
    const [sel, setSel] = useState<number | null>(null);

    const playing = match.status === "playing";
    const selCard = sel != null ? match.playerHand[sel] : null;
    const selCost = selCard ? getEffectiveCost(selCard, match.playerNextCardDiscount) : 0;
    const selAffordable = selCard ? selCost <= match.playerChakra : false;

    function locationPlayable(loc: CardClashLocationState): boolean {
        return playing && !!selCard && selAffordable && loc.playerCards.length < CARD_CLASH_LOCATION_SLOTS;
    }

    function clickLocation(li: number) {
        if (sel == null) return;
        if (!locationPlayable(match.locations[li])) return;
        onPlayCard(sel, li);
        setSel(null);
    }

    return (
        <div>
            {/* HUD */}
            <div className="cc-hud">
                <span className="cc-turn">Turn {match.turn}<span className="cc-hud-meta"> / {CARD_CLASH_MAX_TURNS}</span></span>
                <span className="cc-chakra" title="Chakra this turn">
                    {Array.from({ length: Math.max(match.turn, match.playerChakra) }).map((_, i) => (
                        <span key={i} className={`orb${i >= match.playerChakra ? " spent" : ""}`} />
                    ))}
                    <span className="cc-hud-meta" style={{ marginLeft: 4 }}>{match.playerChakra} Chakra</span>
                </span>
                {match.playerNextCardDiscount > 0 && <span className="cc-hud-meta" style={{ color: "#fff176" }}>⚡ next card −{match.playerNextCardDiscount}</span>}
                <span className="cc-hud-spacer" />
                <span className="cc-hud-meta">🟥 Opponent: {match.opponentHand.length} in hand · {match.opponentDeck.length} in deck</span>
            </div>

            {/* Locations */}
            <div className="cc-locations">
                {match.locations.map((loc, li) => {
                    const youP = locationSidePower(loc, "player");
                    const oppP = locationSidePower(loc, "opponent");
                    const winCls = youP > oppP ? "winning-player" : oppP > youP ? "winning-opponent" : "";
                    const playable = locationPlayable(loc);
                    const tint = TINT[loc.location.effectType] ?? TINT.none;
                    const art = CARD_CLASH_LOCATION_ART[loc.location.id];
                    return (
                        <div
                            key={loc.location.id}
                            className={`cc-loc ${winCls} ${playable ? "playable" : ""}`}
                            onClick={() => clickLocation(li)}
                        >
                            <div className="cc-loc-head" style={{ "--cc-loc-tint": tint, "--cc-loc-img": art ? `url(${art})` : undefined } as CSSProperties}>
                                <b>{loc.location.name}</b>
                                <span className="eff">{loc.location.description}</span>
                            </div>

                            {/* Opponent zone */}
                            <div className="cc-zone opp">
                                <Slots loc={loc} side="opponent" />
                            </div>

                            <div className="cc-power-bar">
                                <span className="opp-p">🟥 {oppP}</span>
                                {playable && <span className="cc-play-hint">▶ PLAY HERE</span>}
                                <span className="you-p">{youP} 🟦</span>
                            </div>

                            {/* Player zone */}
                            <div className="cc-zone you">
                                <Slots loc={loc} side="player" />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Hand */}
            <div className="cc-hand-wrap">
                <div className="cc-hand-label">Your Hand — {match.playerHand.length} cards</div>
                <div className="cc-hand">
                    {match.playerHand.length === 0 && <span className="cc-muted" style={{ fontSize: 12 }}>No cards in hand.</span>}
                    {match.playerHand.map((card, i) => {
                        const cost = getEffectiveCost(card, match.playerNextCardDiscount);
                        const affordable = cost <= match.playerChakra;
                        return (
                            <div key={`${card.id}-${i}`} className={affordable ? "" : "unaffordable"}>
                                <CardClashCardView
                                    card={card}
                                    selected={sel === i}
                                    onClick={playing ? () => setSel(sel === i ? null : i) : undefined}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="cc-controls">
                {selCard
                    ? <span className="cc-muted" style={{ fontSize: 13 }}>
                        Selected <b>{selCard.name}</b> ({selCost} Chakra) — {selAffordable ? "tap a location to play it" : "not enough Chakra"}
                      </span>
                    : <span className="cc-muted" style={{ fontSize: 13 }}>Tap a card, then tap a location to deploy it.</span>}
                <span className="cc-hud-spacer" />
                <button className="cc-btn danger" onClick={onRetreat} disabled={!playing}>{retreatLabel}</button>
                <button className="cc-btn primary" onClick={() => { setSel(null); onEndTurn(); }} disabled={!playing}>End Turn ▶</button>
            </div>

            {/* Battle log */}
            <div className="cc-log">
                {match.log.slice(-12).map((line, i) => <div key={i}>{line}</div>)}
            </div>
        </div>
    );
}

function Slots({ loc, side }: { loc: CardClashLocationState; side: "player" | "opponent" }) {
    const cards = side === "player" ? loc.playerCards : loc.opponentCards;
    const empties = Math.max(0, CARD_CLASH_LOCATION_SLOTS - cards.length);
    return (
        <div className="cc-slots">
            {cards.map((c) => (
                <CardClashCardView
                    key={c.instanceId}
                    card={c}
                    size="sm"
                    owner={side}
                    reveal
                    displayedPower={getCardDisplayedPower(c, loc.location)}
                />
            ))}
            {Array.from({ length: empties }).map((_, i) => <span key={`e${i}`} className="cc-slot-empty" />)}
        </div>
    );
}

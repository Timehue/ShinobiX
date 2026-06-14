/*
 * CardClashCollection — the "Collection" tab of the Card Hall. Shows every card
 * the player owns, converted to its Clash form (cost / power / role / ability),
 * with rarity + element filters, sorting, and a detail panel for the selected
 * card. Read-only — deck building lives in CardClashDeckBuilder.
 */
import { useMemo, useState } from "react";
import type { CardClashCard } from "../lib/card-clash";
import { CardClashCardView, ELEMENT_COLOR, RARITY_BORDER } from "./CardClashCardView";

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

export function CardClashCollection({ ownedCards }: { ownedCards: CardClashCard[] }) {
    const [rarity, setRarity] = useState<string>("all");
    const [element, setElement] = useState<string>("all");
    const [sortBy, setSortBy] = useState<"rarity" | "cost" | "power" | "name">("rarity");
    const [selected, setSelected] = useState<CardClashCard | null>(null);

    const elements = useMemo(
        () => Array.from(new Set(ownedCards.map((c) => c.element))).sort(),
        [ownedCards],
    );

    const shown = useMemo(() => {
        let list = ownedCards.slice();
        if (rarity !== "all") list = list.filter((c) => c.rarity === rarity);
        if (element !== "all") list = list.filter((c) => c.element === element);
        list.sort((a, b) => {
            if (sortBy === "name") return a.name.localeCompare(b.name);
            if (sortBy === "cost") return a.cost - b.cost || b.power - a.power;
            if (sortBy === "power") return b.power - a.power || a.cost - b.cost;
            return (RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]) || b.power - a.power;
        });
        return list;
    }, [ownedCards, rarity, element, sortBy]);

    if (ownedCards.length === 0) {
        return (
            <div className="cc-empty-note">
                You don't own any cards yet. Open <b>Card Packs</b> in the Shop or Grand Marketplace to start your collection.
            </div>
        );
    }

    return (
        <div>
            {selected && (
                <div className="cc-detail">
                    <CardClashCardView card={selected} size="lg" />
                    <div className="cc-detail-body">
                        <h3>{selected.name}</h3>
                        <div className="cc-detail-meta">
                            <span className="cc-tag" style={{ color: ELEMENT_COLOR[selected.element] }}>{selected.element}</span>
                            <span className="cc-tag" style={{ color: RARITY_BORDER[selected.rarity] }}>{selected.rarity}</span>
                            <span className="cc-tag">{selected.role}</span>
                            <span className="cc-tag">⏣ {selected.cost} Chakra</span>
                            <span className="cc-tag">⚔ {selected.power} Power</span>
                        </div>
                        <div className="cc-ability">{selected.abilityText}</div>
                        <p className="cc-muted" style={{ fontSize: 12, marginTop: 8 }}>{selected.description}</p>
                    </div>
                </div>
            )}

            <div className="cc-toolbar">
                <label className="cc-muted" style={{ fontSize: 12 }}>Rarity</label>
                <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
                    <option value="all">All</option>
                    <option value="common">Common</option>
                    <option value="rare">Rare</option>
                    <option value="epic">Epic</option>
                    <option value="legendary">Legendary</option>
                </select>
                <label className="cc-muted" style={{ fontSize: 12 }}>Element</label>
                <select value={element} onChange={(e) => setElement(e.target.value)}>
                    <option value="all">All</option>
                    {elements.map((el) => <option key={el} value={el}>{el}</option>)}
                </select>
                <label className="cc-muted" style={{ fontSize: 12 }}>Sort</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                    <option value="rarity">Rarity</option>
                    <option value="cost">Cost</option>
                    <option value="power">Power</option>
                    <option value="name">Name</option>
                </select>
                <span className="cc-muted" style={{ fontSize: 12, marginLeft: "auto" }}>{shown.length} shown · {ownedCards.length} owned</span>
            </div>

            <div className="cc-grid">
                {shown.map((card, i) => (
                    <CardClashCardView
                        key={`${card.id}-${i}`}
                        card={card}
                        onClick={() => setSelected(card)}
                        selected={selected?.id === card.id}
                    />
                ))}
            </div>
        </div>
    );
}

/*
 * CardClashDeckBuilder — the "Deck Builder" tab. Build an exactly-12-card deck
 * from owned cards, enforcing copy limits (common/rare ≤2, epic/legendary ≤1)
 * and the ≤2-legendary cap. Saves to character.cardClashDeck via onSave.
 */
import { useMemo, useState } from "react";
import {
    canAddToDeck,
    validateDeck,
    deckCopyLimit,
    CARD_CLASH_DECK_SIZE,
    CARD_CLASH_MAX_LEGENDARY,
    type CardClashCard,
} from "../lib/card-clash";
import { CardClashCardView, ELEMENT_COLOR, RARITY_BORDER } from "./CardClashCardView";

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

export function CardClashDeckBuilder({
    ownedCards,
    cardsById,
    deckIds,
    setDeckIds,
    onSave,
    dirty,
}: {
    ownedCards: CardClashCard[];
    cardsById: Record<string, CardClashCard>;
    deckIds: string[];
    setDeckIds: (ids: string[]) => void;
    onSave: () => void;
    dirty: boolean;
}) {
    const [notice, setNotice] = useState<string>("");

    const sortedOwned = useMemo(
        () =>
            ownedCards.slice().sort(
                (a, b) => (RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]) || a.cost - b.cost || a.name.localeCompare(b.name),
            ),
        [ownedCards],
    );

    const validation = useMemo(() => validateDeck(deckIds, cardsById), [deckIds, cardsById]);
    const legendaryCount = useMemo(
        () => deckIds.filter((id) => cardsById[id]?.rarity === "legendary").length,
        [deckIds, cardsById],
    );

    // Group the deck into distinct cards with copy counts for a compact list.
    const deckGroups = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const id of deckIds) counts[id] = (counts[id] ?? 0) + 1;
        return Object.entries(counts)
            .map(([id, count]) => ({ card: cardsById[id], count, id }))
            .filter((g) => g.card)
            .sort((a, b) => (RARITY_ORDER[a.card.rarity] - RARITY_ORDER[b.card.rarity]) || a.card.cost - b.card.cost);
    }, [deckIds, cardsById]);

    function add(id: string) {
        const res = canAddToDeck(deckIds, id, cardsById);
        if (!res.ok) { setNotice(res.reason ?? "Can't add that card."); return; }
        setNotice("");
        setDeckIds([...deckIds, id]);
    }

    function removeOne(id: string) {
        const idx = deckIds.indexOf(id);
        if (idx === -1) return;
        setNotice("");
        setDeckIds([...deckIds.slice(0, idx), ...deckIds.slice(idx + 1)]);
    }

    if (ownedCards.length < CARD_CLASH_DECK_SIZE) {
        return (
            <div className="cc-empty-note">
                You need at least <b>{CARD_CLASH_DECK_SIZE} cards</b> to build a Shinobi Card Clash deck. Open
                Card Packs in the Shop or Grand Marketplace.
                <div className="cc-muted" style={{ marginTop: 8, fontSize: 12 }}>You currently own {ownedCards.length}.</div>
            </div>
        );
    }

    const countLabel = `${deckIds.length}/${CARD_CLASH_DECK_SIZE}`;

    return (
        <div className="cc-deck-cols">
            {/* Owned cards — click to add */}
            <div className="cc-section-card">
                <div className="cc-toolbar" style={{ marginBottom: 8 }}>
                    <b style={{ fontSize: 14 }}>Your Collection</b>
                    <span className="cc-muted" style={{ fontSize: 12, marginLeft: "auto" }}>Click a card to add it to your deck</span>
                </div>
                <div className="cc-grid">
                    {sortedOwned.map((card) => {
                        const copies = deckIds.filter((id) => id === card.id).length;
                        const limit = deckCopyLimit(card.rarity);
                        const maxed = copies >= limit;
                        return (
                            <div key={card.id} style={{ position: "relative", opacity: maxed ? 0.5 : 1 }}>
                                <CardClashCardView card={card} onClick={() => add(card.id)} />
                                {copies > 0 && (
                                    <span className="cc-tag" style={{ position: "absolute", top: 2, right: 2, background: "#0a1326" }}>
                                        ×{copies}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Current deck */}
            <div className="cc-section-card" style={{ position: "sticky", top: 8 }}>
                <div className="cc-deck-meter">
                    <span className={`big ${validation.valid ? "ok" : ""}`}>{countLabel}</span>
                    <span className="cc-muted" style={{ fontSize: 12 }}>cards</span>
                    <span className="cc-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                        Legendary {legendaryCount}/{CARD_CLASH_MAX_LEGENDARY}
                    </span>
                </div>

                {notice && <div className="cc-deck-errors">⚠ {notice}</div>}
                {!validation.valid && deckIds.length > 0 && (
                    <div className="cc-deck-errors">{validation.errors.map((e, i) => <div key={i}>• {e}</div>)}</div>
                )}

                <div className="cc-deck-list">
                    {deckGroups.length === 0 && <div className="cc-muted" style={{ fontSize: 12, padding: 8 }}>Empty — add 12 cards from your collection.</div>}
                    {deckGroups.map(({ card, count, id }) => (
                        <div className="cc-deck-row" key={id}>
                            <span className="cc-pip cost" style={{ position: "static" }}>{card.cost}</span>
                            <span className="nm">{card.name}</span>
                            <span className="cc-tag" style={{ color: ELEMENT_COLOR[card.element] }}>{card.element[0]}</span>
                            <span className="cc-tag" style={{ color: RARITY_BORDER[card.rarity] }}>{card.rarity[0].toUpperCase()}</span>
                            {count > 1 && <span className="cc-muted" style={{ fontSize: 11 }}>×{count}</span>}
                            <button className="cc-btn ghost" style={{ padding: "3px 8px" }} onClick={() => removeOne(id)}>−</button>
                            <button className="cc-btn ghost" style={{ padding: "3px 8px" }} onClick={() => add(id)}>+</button>
                        </div>
                    ))}
                </div>

                <div className="cc-controls" style={{ marginTop: 12 }}>
                    <button className="cc-btn primary" disabled={!validation.valid || !dirty} onClick={onSave}>
                        {dirty ? "Save Deck" : "Deck Saved ✓"}
                    </button>
                    {deckIds.length > 0 && (
                        <button className="cc-btn danger" onClick={() => setDeckIds([])}>Clear</button>
                    )}
                </div>
            </div>
        </div>
    );
}

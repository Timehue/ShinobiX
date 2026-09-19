import { useState } from "react";
import { useChronicleCardSearch } from "./ChronicleCardSearch";
import { ChronicleCardView } from "./ChronicleCardView";
import { ChronicleCardInspector } from "./ChronicleCardInspector";
import { MAIN_DECK_SIZE, MAX_COPIES_PER_CARD, canAddChronicleCard, getChronicleCard, type ChronicleDisplayCard } from "../lib/chronicle-duel";
export function Collection({
  cards,
  owned,
  catalogSize,
}: {
  cards: ChronicleDisplayCard[];
  /** Copies owned per card id — the Collection is YOUR shelf, not the catalog. */
  owned: ReadonlyMap<string, number>;
  catalogSize: number;
}) {
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  const { shown, controls } = useChronicleCardSearch(cards);
  return (
    <section className="chronicle-panel chronicle-binder">
      <p>{cards.length} of {catalogSize} in the set</p>
      {controls}
      <div className="chronicle-collection">
        {shown.map((card) => (
          <button
            className="chronicle-card-inspect-trigger"
            key={card.id}
            type="button"
            aria-label={`Inspect ${card.name} — you own ${owned.get(card.id) ?? 0}`}
            onClick={() => setInspected(card)}
          >
            <ChronicleCardView card={card} />
            <span className="chronicle-binder-meta">{card.cardClass === "monster" ? `${card.element} Monster` : card.cardClass === "magic" ? "Jutsu" : "Snare"} · {card.rarity}</span>
            {/* Copies OWNED. The card foot already prints a number, but that is
                the deck-building limit ("MAX 3") — it reads like inventory and
                isn't, which left the collection with no signal of what you
                actually hold. */}
            <span className="chronicle-owned-badge">×{owned.get(card.id) ?? 0}</span>
          </button>
        ))}
      </div>
      <ChronicleCardInspector
        card={inspected}
        onClose={() => setInspected(null)}
        meta={
          inspected ? `Owned ×${owned.get(inspected.id) ?? 0}` : undefined
        }
      />
    </section>
  );
}

export function DeckBuilder({
  cards,
  cardsById,
  owned,
  deck,
  setDeck,
  validation,
  dirty,
  onSave,
  onMigrate,
}: {
  cards: ChronicleDisplayCard[];
  cardsById: Record<string, ChronicleDisplayCard>;
  owned: ReadonlyMap<string, number>;
  deck: string[];
  setDeck: (deck: string[]) => void;
  validation: { valid: boolean; errors: string[] };
  dirty: boolean;
  onSave: () => void;
  onMigrate: () => void;
}) {
  const [deckView, setDeckView] = useState("collection");
  const { shown, controls } = useChronicleCardSearch(cards);
  const groups = Object.entries(
    Object.fromEntries(
      [...new Set(deck)].map((id) => [
        id,
        deck.filter((entry) => entry === id).length,
      ]),
    ),
  );
  const counts = {
    monster: deck.filter((id) => getChronicleCard(id)?.cardClass === "monster")
      .length,
    magic: deck.filter((id) => getChronicleCard(id)?.cardClass === "magic")
      .length,
    trap: deck.filter((id) => getChronicleCard(id)?.cardClass === "trap")
      .length,
  };
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  const addCard = (id: string) => {
    if (!canAddChronicleCard(deck, id, owned)) setDeck([...deck, id]);
  };
  return (
    <section className="chronicle-panel chronicle-deck" data-view={deckView}>
      <header className="chronicle-deck-status">
        <strong>DECK {deck.length} / {MAIN_DECK_SIZE}</strong>
        <span>{counts.monster} Monsters · {counts.magic} Jutsu · {counts.trap} Snares</span>
        <button onClick={onSave} disabled={!validation.valid || !dirty}>Save Deck</button>
        <nav aria-label="Deck browser"><button aria-pressed={deckView === "collection"} onClick={() => setDeckView("collection")}>Collection</button><button aria-pressed={deckView === "deck"} onClick={() => setDeckView("deck")}>My Deck</button></nav>
      </header>
      <div className="chronicle-deck-catalog">
        <div className="chronicle-toolbar">
          <strong>Your cards</strong>
          <span>
            Tap a card to read it full size, or the + to add a copy. Up to{" "}
            {MAX_COPIES_PER_CARD} copies; iconic advanced cards show their lower
            limit on the frame.
          </span>
        </div>
        {controls}
        <div className="chronicle-collection">
          {shown.map((card) => {
            const inDeck = deck.filter((id) => id === card.id).length;
            const blocked = canAddChronicleCard(deck, card.id, owned);
            return (
              <div className="chronicle-deck-slot" key={card.id}>
                <button
                  className="chronicle-card-inspect-trigger"
                  type="button"
                  aria-label={`Read ${card.name}`}
                  onClick={() => setInspected(card)}
                >
                  <ChronicleCardView card={card} compact />
                  <span className="chronicle-binder-meta">{card.cardClass === "monster" ? `${card.element} Monster` : card.cardClass === "magic" ? "Jutsu" : "Snare"} · {card.rarity}</span>
                </button>
                <span className="chronicle-deck-owned">Owned {owned.get(card.id) ?? 0} · Deck {inDeck}</span>
                {inDeck > 0 ? (
                  <span className="chronicle-deck-slot__count">×{inDeck}</span>
                ) : null}
                <button
                  className="chronicle-deck-slot__add"
                  type="button"
                  aria-label={`Add ${card.name} to your deck`}
                  title={blocked ?? "Add to deck"}
                  disabled={Boolean(blocked)}
                  onClick={() => addCard(card.id)}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="chronicle-deck__list">
        <h2>
          {deck.length}/{MAIN_DECK_SIZE}
        </h2>
        <p>
          {counts.monster} Monsters · {counts.magic} Jutsu · {counts.trap} Snares
        </p>
        {groups.map(([id, count]) => (
          <div className="chronicle-deck__row" key={id}>
            <button className="chronicle-deck__inspect" onClick={() => setInspected(cardsById[id] ?? null)}>{cardsById[id]?.name ?? id}</button>
            <b>×{count}</b>
            <button aria-label={`Add one ${cardsById[id]?.name ?? id}`} disabled={Boolean(canAddChronicleCard(deck, id, owned))} onClick={() => addCard(id)}>+</button>
            <button
              aria-label={`Remove one ${cardsById[id]?.name ?? id}`}
              onClick={() => {
                const index = deck.indexOf(id);
                setDeck([...deck.slice(0, index), ...deck.slice(index + 1)]);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!validation.valid ? (
          <div className="chronicle-error">{validation.errors.join(" ")}</div>
        ) : null}
        <button onClick={onSave} disabled={!validation.valid || !dirty}>
          Save Deck
        </button>
        <button onClick={onMigrate}>Restore Migrated Deck</button>
        <button onClick={() => setDeck([])}>Clear</button>
      </aside>
      <ChronicleCardInspector
        card={inspected}
        onClose={() => setInspected(null)}
        meta={
          inspected
            ? `In deck ×${deck.filter((id) => id === inspected.id).length} · owned ×${owned.get(inspected.id) ?? 0}`
            : undefined
        }
        actions={
          inspected ? (
            <button
              className="primary"
              type="button"
              disabled={Boolean(canAddChronicleCard(deck, inspected.id, owned))}
              title={
                canAddChronicleCard(deck, inspected.id, owned) ?? "Add to deck"
              }
              onClick={() => addCard(inspected.id)}
            >
              Add to Deck
            </button>
          ) : null
        }
      />
    </section>
  );
}

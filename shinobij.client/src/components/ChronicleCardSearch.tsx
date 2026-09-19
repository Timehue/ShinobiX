import { useState } from "react";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";

/** Local catalog filtering; never sends requests or changes deck validation. */
export function useChronicleCardSearch(cards: ChronicleDisplayCard[]) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const active = Object.values(filters).filter(Boolean).length;
  const words = query.toLowerCase().trim().split(/\s+/);
  const shown = cards.filter(card => {
    const metadata = [card.name, card.rarity, card.cardClass === "magic" ? "Jutsu" : card.cardClass === "trap" ? "Snare" : "Monster",
      card.cardClass === "monster" ? `${card.element} ${card.family} ${card.powerTier}` : card.cardClass === "magic" ? card.magicType : card.trapType].join(" ").toLowerCase();
    return words.every(word => metadata.includes(word)) &&
      Object.entries(filters).every(([key, value]) => !value || String((card as unknown as Record<string, unknown>)[key]) === value);
  });
  const controls = <div className="chronicle-card-search">
    <label>Search cards<input type="search" placeholder="Name, element, type…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <details className="chronicle-card-filters"><summary>Filters ({active})</summary>
      <div>{Object.entries({ cardClass: ["Class", "monster", "magic", "trap"], element: ["Element", "Fire", "Water", "Earth", "Wind", "Lightning"], powerTier: ["Tier", "weak", "standard", "elite", "boss", "mythic"], rarity: ["Rarity", "common", "rare", "epic", "legendary", "mythic"] }).map(([key, [label, ...values]]) =>
        <label key={key}>{label}<select aria-label={label} value={filters[key] ?? ""} onChange={event => setFilters({ ...filters, [key]: event.target.value })}><option value="">All</option>{values.map(value => <option key={value} value={value}>{value === "magic" ? "Jutsu" : value === "trap" ? "Snare" : value}</option>)}</select></label>)}
        <button type="button" onClick={() => setFilters({})}>Clear filters</button>
      </div>
    </details>
    <span role="status">{shown.length} cards</span>
  </div>;
  return { shown, controls };
}

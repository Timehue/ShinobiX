import { shinobiTileCards } from "../shinobij.client/src/data/tile-cards.js";
import { deriveCardClashCard } from "../shinobij.client/src/lib/card-clash.js";

// Emit the BUILTIN_CLASH table literal (id -> canonical engine stats).
const rows = shinobiTileCards.map((card) => {
    const c = deriveCardClashCard(card);
    return `    '${c.id}': { element: '${c.element}', rarity: '${c.rarity}', cost: ${c.cost}, power: ${c.power}, ability: '${c.abilityType}' },`;
});
console.log(rows.join("\n"));
console.error(`generated ${rows.length} rows`);

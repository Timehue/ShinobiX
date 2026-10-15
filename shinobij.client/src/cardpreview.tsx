// DEV-ONLY card-face harness. Renders a representative set of ChronicleCardView
// cards at full "hero" size plus the compact board-tile size, so visual reviews
// of the card face can iterate without a live duel. Absent from prod inputs
// (only index.html is a rollup input).
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CHRONICLE_CARD_CATALOG, CHRONICLE_FIXED_FALLBACK_DECK, createMatch, projectMatchForViewer, type ChronicleDisplayCard } from "./lib/chronicle-duel";
import { ChronicleCardView } from "./components/ChronicleCardView";
import { ChronicleCardInspector } from "./components/ChronicleCardInspector";
import { CardPackOpening } from "./components/CardPackOpening";
import { ChronicleDuelBoard } from "./components/ChronicleDuelBoard";
import { CHRONICLE_PAINTED_ART } from "../../shared/chronicle-painted-art";
import { CHRONICLE_TOKEN_CARDS } from "../../shared/chronicle-duel";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./styles/chronicle-duel.css";
import "./styles/card-pack-opening.css";

// Use each card's NATIVE image (bespoke /chronicle/cards art for monsters;
// reused emblem/field/scene art for support). The component's srcset helper
// swaps in the -512 variant for /chronicle/cards paths on its own.
const allCards: readonly ChronicleDisplayCard[] = [...CHRONICLE_CARD_CATALOG, ...CHRONICLE_TOKEN_CARDS];
const byId = (id: string) => allCards.find((c) => c.id === id);
const pickIds = [
  "tc-61", "story-story-ai-frostfang-village-4", "pet-witness-wind",
  "chronicle-gale-reversal", "story-story-ai-frostfang-village-25",
  "story-wandering-sage", "tc-131", "chronicle-forbidden-archive",
];
const params = new URLSearchParams(window.location.search);
const picks = (params.has("ids") ? params.get("ids")!.split(",")
  : params.has("all") ? allCards.map(card => card.id)
  : params.has("painted") ? Object.keys(CHRONICLE_PAINTED_ART) : pickIds)
  .map(byId)
  .filter((c): c is ChronicleDisplayCard => Boolean(c));

function createArtDuelPreview() {
  const state = createMatch("Art review", CHRONICLE_FIXED_FALLBACK_DECK, "Matching opponent", CHRONICLE_FIXED_FALLBACK_DECK, () => 0, 1_000);
  state.turnNumber = 3;
  state.phase = "main1";
  state.activePlayer = "p1";
  const cards = params.has("ids") ? picks : ["tc-61", "tc-01", "tc-131", "tc-133", "tc-143"].map(byId).filter((card): card is ChronicleDisplayCard => Boolean(card));
  for (const side of ["p1", "p2"] as const) {
    cards.filter(card => card.cardClass === "monster").slice(0, 5).forEach((card, zoneIndex) => {
      state[side].monsterZones[zoneIndex] = { instanceId: `${side}-art-${card.id}`, cardId: card.id, owner: side, zoneIndex, position: "attack", faceUp: true, summonedOnTurn: 1, lastPositionChangeTurn: 0, lastAttackTurn: 0, temporaryAttack: 0, temporaryDefense: 0 };
    });
  }
  return projectMatchForViewer(state, "p1");
}
const artDuelPreview = params.has("duel") ? createArtDuelPreview() : null;

function Harness() {
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  if (artDuelPreview) return <div className="chronicle-shell chronicle-shell--duel-active"><div><ChronicleDuelBoard state={artDuelPreview} cardsById={Object.fromEntries(allCards.map(card => [card.id, card]))} onAction={() => undefined} /></div></div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <button type="button" onClick={() => setPackOpen(true)} style={{ alignSelf: "flex-start", padding: "12px 18px" }}>Preview pack reveal</button>
      <section>
        <div style={{ color: "#8a93a6", font: "600 12px/1 system-ui", letterSpacing: 2, marginBottom: 14 }}>
          HERO SIZE
        </div>
        <div style={{ display: "grid", gap: 22, gridTemplateColumns: "repeat(auto-fit, 252px)", alignItems: "start", justifyContent: "center" }}>
          {picks.map((card) => (
            <div key={card.id} data-card-preview-id={card.id}>
              <ChronicleCardView card={card} onClick={() => setInspected(card)} />
            </div>
          ))}
        </div>
      </section>
      <ChronicleCardInspector card={inspected} onClose={() => setInspected(null)} />
      {packOpen ? <CardPackOpening packType="legendary" cards={pickIds} cardsById={Object.fromEntries(allCards.map(card => [card.id, card]))} ownedBefore={new Map()} title="Painted card review" onClose={() => setPackOpen(false)} /> : null}
      <section>
        <div style={{ color: "#8a93a6", font: "600 12px/1 system-ui", letterSpacing: 2, marginBottom: 14 }}>
          COMPACT (BOARD TILE)
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          {picks.map((card) => (
            <ChronicleCardView key={card.id} card={card} compact />
          ))}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

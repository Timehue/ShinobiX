// DEV-ONLY card-face harness. Renders a representative set of ChronicleCardView
// cards at full "hero" size plus the compact board-tile size, so visual reviews
// of the card face can iterate without a live duel. Absent from prod inputs
// (only index.html is a rollup input).
import { createRoot } from "react-dom/client";
import { CHRONICLE_CARD_CATALOG, type ChronicleDisplayCard } from "./lib/chronicle-duel";
import { ChronicleCardView } from "./components/ChronicleCardView";
import "./styles/chronicle-duel.css";

// Use each card's NATIVE image (bespoke /chronicle/cards art for monsters;
// reused emblem/field/scene art for support). The component's srcset helper
// swaps in the -512 variant for /chronicle/cards paths on its own.
const byId = (id: string) => CHRONICLE_CARD_CATALOG.find((c) => c.id === id);
const pickIds = [
  "tc-03", // bespoke monster art (effect)
  "tc-01", // bespoke monster art (normal)
  "chronicle-recon-scroll", // jutsu — reuses /legacy/jutsu emblem art
  "chronicle-field-volcano", // field — reuses /chronicle/fields art
  "chronicle-smoke-bomb", // snare — reuses a /scenes/story image
];
const picks = pickIds
  .map(byId)
  .filter((c): c is ChronicleDisplayCard => Boolean(c));

function Harness() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <section>
        <div style={{ color: "#8a93a6", font: "600 12px/1 system-ui", letterSpacing: 2, marginBottom: 14 }}>
          HERO SIZE
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          {picks.map((card) => (
            <ChronicleCardView key={card.id} card={card} />
          ))}
        </div>
      </section>
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

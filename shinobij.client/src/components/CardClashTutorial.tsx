import { ChronicleCardView } from "./ChronicleCardView";
import {
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  getChronicleCard,
  type ChronicleDisplayCard,
} from "../lib/chronicle-duel";

export function CardClashTutorial({ onClose }: { onClose: () => void }) {
  const smokeBomb = getChronicleCard(
    "chronicle-smoke-bomb",
  ) as ChronicleDisplayCard;
  return (
    <div
      className="chronicle-tutorial-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Shinobi Chronicle Duel tutorial"
      onClick={onClose}
    >
      <div
        className="chronicle-tutorial"
        onClick={(event) => event.stopPropagation()}
      >
        <ChronicleCardView card={smokeBomb} />
        <div className="chronicle-tutorial__body">
          <small>
            RULES VERSION {CHRONICLE_RULES_VERSION}
          </small>
          <h2>{CHRONICLE_ROOM_TITLE}</h2>
          <p>
            Start at 8,000 Health with a 40-card Deck and five cards. Move
            through Draw, Standby, Main 1, Battle, Main 2 and End.
          </p>
          <p>
            Summon or Set once per turn. Set Traps wait one turn and allow one
            matching response.
          </p>
          <p>
            Fire beats Wind, then Lightning, Earth, Water and Fire again.
            Advantage adds +200 to the ATK or DEF used in battle.
          </p>
          <div className="chronicle-tutorial__foot">
            <button onClick={onClose}>Enter the Card Hall</button>
          </div>
        </div>
      </div>
    </div>
  );
}

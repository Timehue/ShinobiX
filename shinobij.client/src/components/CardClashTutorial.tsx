import { ChronicleCardView } from "./ChronicleCardView";
import {
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  getChronicleCard,
  type ChronicleDisplayCard,
} from "../lib/chronicle-duel";
import { Modal } from "./ui/Modal";
import "../styles/card-clash-tutorial.css";

export function CardClashTutorial({ onClose }: { onClose: () => void }) {
  const smokeBomb = getChronicleCard(
    "chronicle-smoke-bomb",
  ) as ChronicleDisplayCard;
  return (
    <Modal
      open
      onClose={onClose}
      bare
      size="lg"
      ariaLabel="Shinobi Chronicle Showdown tutorial"
      className="chronicle-tutorial-modal-shell"
    >
      <div className="chronicle-tutorial">
        <ChronicleCardView card={smokeBomb} />
        <div className="chronicle-tutorial__body">
          <small>
            RULES VERSION {CHRONICLE_RULES_VERSION}
          </small>
          <h2>{CHRONICLE_ROOM_TITLE}</h2>
          <p>
            Start at 8,000 Health with a 40-card Deck and five cards. Draw,
            Standby, and End resolve automatically; you decide when to start or
            finish attacking during your Main Phases.
          </p>
          <p>
            Summon or Set once per turn. Set Snares wait one turn and allow one
            matching response.
          </p>
          <p>
            Fire beats Wind, then Lightning, Earth, Water and Fire again.
            Advantage adds +200 to the ATK or DEF used in battle.
          </p>
          <p>
            Target badges preview the result from visible stats before a hidden
            Snare responds. Smart Phase Assist finishes Battle automatically
            once none of your Monsters can attack; switch it off in Match
            Options if you prefer every phase control.
          </p>
          <div className="chronicle-tutorial__foot">
            <button onClick={onClose}>Enter the Card Hall</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

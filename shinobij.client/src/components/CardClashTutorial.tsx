import { useState } from "react";
import { ChronicleCardView } from "./ChronicleCardView";
import {
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  getChronicleCard,
  type ChronicleDisplayCard,
} from "../lib/chronicle-duel";
import { Modal } from "./ui/Modal";
import "../styles/card-clash-tutorial.css";

/* Four short pages instead of one. The single page left out Tributes, the
   first-player rule, FLIP, Calls, Shadow Doubles and Warded, which the Card
   Hall rules tab covers in full. */
const TUTORIAL_PAGES: ReadonlyArray<{ title: string; lines: readonly string[] }> = [
  {
    title: "Your turn",
    lines: [
      "Start at 8,000 Health with a 40-card Deck and five cards. Draw, Standby, and End resolve automatically; you decide when to start or finish attacking during your Main Phases.",
      "The first player skips its turn-one draw and cannot attack that turn.",
      "Smart Phase Assist finishes Battle automatically once none of your Monsters can attack. Switch it off in Match Options if you prefer every phase control.",
    ],
  },
  {
    title: "Summoning and Tributes",
    lines: [
      "Summon or Set one Monster per turn. Levels 1 to 4 need no Tribute, Levels 5 and 6 need one, and Levels 7 and 8 need two.",
      "A Set Monster enters face-down in Defense Position and can be Flip Summoned on a later turn. A FLIP effect triggers when the Monster is turned face-up.",
      "Fire beats Wind, then Lightning, Earth, Water and Fire again. Advantage adds +200 to the ATK or DEF used in battle.",
    ],
  },
  {
    title: "Calls, Shadow Doubles and Warded",
    lines: [
      "A Call Jutsu Summons its one matching Level 8 Monster from your hand in place of your Normal Summon. It costs 1,000 Health, and that Monster cannot attack on the turn it arrives.",
      "Shadow Clone makes two Shadow Doubles. You can Tribute them starting next turn, and they vanish when they leave the field.",
      "About half of the other Level 7 and 8 Monsters are Warded, and the card says so. Snares cannot destroy a Warded Monster or return it to the hand on the turn it is Summoned.",
    ],
  },
  {
    title: "Snares and battle previews",
    lines: [
      "A Set Snare waits one turn, then lets you answer one matching move. There are no chains.",
      "Target badges preview a battle from the stats you can see. A hidden Snare can still change the result.",
    ],
  },
];

export function CardClashTutorial({ onClose }: { onClose: () => void }) {
  const smokeBomb = getChronicleCard(
    "chronicle-smoke-bomb",
  ) as ChronicleDisplayCard;
  const [page, setPage] = useState(0);
  const current = TUTORIAL_PAGES[page];
  const last = page === TUTORIAL_PAGES.length - 1;
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
            RULES VERSION {CHRONICLE_RULES_VERSION} · {page + 1} OF {TUTORIAL_PAGES.length}
          </small>
          <h2>{page === 0 ? CHRONICLE_ROOM_TITLE : current.title}</h2>
          {current.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {/* Enter is on every page and first, so it takes the dialog's
              opening focus: a returning player (or a controller's A) leaves
              in one press, and a new one pages on with Next. */}
          <div className="chronicle-tutorial__foot">
            <button type="button" onClick={onClose}>Enter the Card Hall</button>
            {page > 0 ? (
              <button type="button" className="secondary" onClick={() => setPage(page - 1)}>
                Back
              </button>
            ) : null}
            {last ? null : (
              <button type="button" onClick={() => setPage(page + 1)}>Next</button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

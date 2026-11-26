import { useState } from "react";
import { ChronicleCardView } from "./ChronicleCardView";
import {
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  getChronicleCard,
  type ChronicleDisplayCard,
} from "../lib/chronicle-duel";
import { Modal } from "./ui/Modal";
import { TUTORIAL_PAGES } from "../lib/card-clash-tutorial-pages";
import "../styles/card-clash-tutorial.css";

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

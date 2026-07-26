// NOTE: no `import "../styles/chronicle-duel.css"` here on purpose. This
// component is pulled in by ChronicleDuelBoard, which the node test runner
// imports directly — and tsx cannot load a .css file, so the import would
// crash ChronicleDuelBoard.test.ts. Screens own the stylesheet import.
import type { ReactNode } from "react";
import { Modal } from "./ui/Modal";
import { ChronicleCardView } from "./ChronicleCardView";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";

function taxonomyLine(card: ChronicleDisplayCard): string {
  return card.cardClass === "monster"
    ? `${card.family} / ${card.monsterType === "effect" ? "Effect" : "Normal"} Monster`
    : card.cardClass === "magic"
      ? `${card.magicType} / Jutsu Card`
      : `${card.trapType} / Snare Card`;
}

function statLine(card: ChronicleDisplayCard): string {
  return card.cardClass === "monster"
    ? `Level ${card.level} · ${card.element} · ATK ${card.attack} · DEF ${card.defense}`
    : card.cardClass === "magic"
      ? `${card.magicType} Jutsu`
      : `${card.trapType} Snare`;
}

/**
 * Full-size reader for a single Chronicle Showdown card. Every grid that shows
 * cards shrinks the frame well past the point its rules text stays legible, so
 * the tiles open this instead of asking players to squint at a 92px thumbnail.
 *
 * The card frame itself still clamps its text to keep the 5/7 silhouette, so
 * the complete rules and flavour text are repeated underneath in plain type —
 * that block is what actually guarantees a long effect can be read in full.
 *
 * Built on Modal so it portals to <body>: a plain `position: fixed` overlay
 * rendered inside a screen's subtree gets painted over by the fixed desktop
 * side rails and the mobile bottom nav.
 */
export function ChronicleCardInspector({
  card,
  onClose,
  meta,
  actions,
}: {
  card: ChronicleDisplayCard | null;
  onClose: () => void;
  /** Ownership / deck-count line shown above the rules text. */
  meta?: ReactNode;
  /** Extra buttons (e.g. Add to Deck) rendered beside Close. */
  actions?: ReactNode;
}) {
  if (!card) return null;
  // Normal monsters carry no rules text — their lore below is the whole body.
  const rulesText =
    card.cardClass === "monster" && card.monsterType !== "effect"
      ? ""
      : card.effectText;
  return (
    <Modal
      open
      onClose={onClose}
      bare
      size="md"
      className="chronicle-card-modal"
      ariaLabel={`${card.name} card details`}
    >
      <div className="chronicle-card-zoom">
        {/* First focusable on purpose: Modal focuses it on open, and a target
            at the top keeps the dialog scrolled to the card rather than
            jumping past it to the action row on shorter screens. */}
        <button
          className="chronicle-card-zoom__close"
          type="button"
          aria-label="Close card details"
          onClick={onClose}
        >
          ×
        </button>
        <ChronicleCardView card={card} />
        <div className="chronicle-card-zoom__codex">
          <strong>{card.name}</strong>
          <span className="chronicle-card-zoom__taxonomy">
            {taxonomyLine(card)} · {card.rarity}
          </span>
          <span className="chronicle-card-zoom__stats">{statLine(card)}</span>
          {meta ? <p className="chronicle-card-zoom__meta">{meta}</p> : null}
          {rulesText ? <p>{rulesText}</p> : null}
          {card.lore ? (
            <p className="chronicle-card-zoom__lore">{card.lore}</p>
          ) : null}
          <span className="chronicle-card-zoom__limit">
            {card.id} · Deck limit {card.deckLimit ?? 3}
          </span>
        </div>
        <div className="chronicle-card-zoom__actions">
          {actions}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

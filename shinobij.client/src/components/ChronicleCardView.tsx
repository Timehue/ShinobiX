import type { CSSProperties, ReactElement } from "react";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";
import { chronicleCardArtSrcSet, CARD_ART_SIZES_DEFAULT } from "../lib/chronicle-card-art";


// Crisp per-element glyphs for the corner badge — reads far more premium than a
// bare letter. White fills/strokes ride on top of the element-tinted gem.
// Factories (not bare elements) so the JSX is built at render time — a bare
// module-level element evaluates at import, before test harnesses set up React.
const ELEMENT_ICONS: Record<string, () => ReactElement> = {
  Fire: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.7 2c.5 2.4-.3 4.2-1.7 5.7C9.3 9.6 7.5 11.2 7.5 14a4.5 4.5 0 0 0 9 .3c.1-1.2-.2-2.3-.8-3.3 1.1.5 1.9 1.5 2.3 2.7.8-2.6-.2-5.2-2-7.1C14.4 5.1 13.3 3.7 12.7 2Zm-.9 11.3c.7.5 1.1 1.3 1.1 2.2a2 2 0 0 1-4 .1c0-1 .5-1.7 1.2-2.4.2.9.8 1.4 1.7 1.5-.4-.4-.4-.9 0-1.4Z"
      />
    </svg>
  ),
  Water: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.5C9 6.4 5.5 9.8 5.5 14a6.5 6.5 0 0 0 13 0C18.5 9.8 15 6.4 12 2.5Zm-2.6 9.1c.4 0 .7.3.7.7 0 1.6 1.1 2.9 2.6 3.2.4.1.6.4.5.8-.1.4-.4.6-.8.5a4.9 4.9 0 0 1-3.7-4.5c0-.4.3-.7.7-.7Z"
      />
    </svg>
  ),
  Earth: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2 4 8.6 12 22l8-13.4L12 2Zm0 2.7 4.8 4L12 18l-4.8-9.3L12 4.7Z"
      />
      <path fill="currentColor" opacity=".55" d="M12 4.7 16.8 8.7 12 18Z" />
    </svg>
  ),
  Wind: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h9.5A2.75 2.75 0 1 0 9.8 5" />
      <path d="M3 12h13a2.75 2.75 0 1 1-2.7 3.2" />
      <path d="M3 16h6.5" />
    </svg>
  ),
  Lightning: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.6 2 5 13.4h5.2L9 22l9.4-12.3h-5.6L15 2h-1.4Z"
      />
    </svg>
  ),
};

const FRAME: Record<string, string> = {
  monster: "#b85f35",
  magic: "#3c76b2",
  trap: "#9b3f52",
};
const RARITY: Record<string, string> = {
  common: "#a9b3c4",
  rare: "#68a7ff",
  epic: "#d68cff",
  legendary: "#f0c463",
  mythic: "#ff875f",
};
const ELEMENT: Record<string, { color: string; mark: string }> = {
  Fire: { color: "#f05b3c", mark: "F" },
  Water: { color: "#3d9ee8", mark: "W" },
  Earth: { color: "#9d8147", mark: "E" },
  Wind: { color: "#63c79b", mark: "A" },
  Lightning: { color: "#d8b83e", mark: "L" },
};

export function ChronicleCardView({
  card,
  hidden = false,
  compact = false,
  selected = false,
  disabled = false,
  artSizes = CARD_ART_SIZES_DEFAULT,
  onClick,
}: {
  card?: ChronicleDisplayCard;
  hidden?: boolean;
  compact?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /**
   * The `sizes` hint for the art srcset, i.e. how wide this card actually
   * renders. Defaults to the 252px base card, which also covers the compact
   * board tiles and the collection grid.
   *
   * Pass an override on any surface that displays the card LARGER, otherwise
   * the browser picks the 512px variant and upscales it. Two surfaces do:
   * the card inspector, and Pack Opening — whose card is 252px in layout but
   * carries a `transform: scale()` up to 1.25x. A transform is invisible to
   * `sizes` (it does not change the layout box), so that one has to be stated
   * explicitly or the reveal moment renders from a soft upscale.
   */
  artSizes?: string;
  onClick?: () => void;
}) {
  if (hidden || !card) {
    return (
      <div
        className={`chronicle-card back ${compact ? "compact" : ""}`}
        aria-label="Face-down Shinobi Journey card"
      >
        <span>
          SHINOBI
          <br />
          JOURNEY<small>CHRONICLE SHOWDOWN</small>
        </span>
      </div>
    );
  }

  const frameColor =
    card.cardClass === "monster" && card.monsterType === "effect"
      ? "#93483f"
      : card.cardClass === "magic" && card.magicType === "field"
        ? "#4f916b"
        : FRAME[card.cardClass];
  const element =
    card.cardClass === "monster"
      ? ELEMENT[card.element]
      : { color: frameColor, mark: card.cardClass === "magic" ? "J" : "S" };
  const style = {
    "--chronicle-frame": frameColor,
    "--chronicle-rarity": RARITY[card.rarity],
    "--chronicle-element": element.color,
  } as CSSProperties;
  const details =
    card.cardClass === "monster"
      ? `Level ${card.level} ${card.element} ${card.monsterType} Monster. ATK ${card.attack}, DEF ${card.defense}. ${card.monsterType === "effect" ? card.effectText : card.lore}`
      : `${card.cardClass === "magic" ? `${card.magicType} Jutsu` : `${card.trapType} Snare`}. ${card.effectText} ${card.lore}`;
  const classLabel =
    card.cardClass === "monster"
      ? "MONSTER"
      : card.cardClass === "magic"
        ? "JUTSU"
        : "SNARE";
  const subtypeLabel =
    card.cardClass === "monster"
      ? card.monsterType === "effect"
        ? "EFFECT MONSTER"
        : "NORMAL MONSTER"
      : card.cardClass === "magic"
        ? `${card.magicType.toUpperCase()} JUTSU`
        : `${card.trapType.toUpperCase()} SNARE`;
  const rulesText =
    card.cardClass === "monster"
      ? card.monsterType === "effect"
        ? card.effectText
        : card.lore
      : card.effectText;
  const taxonomy =
    card.cardClass === "monster"
      ? `${card.family.toUpperCase()} / ${card.monsterType === "effect" ? "EFFECT" : "NORMAL"} MONSTER`
      : card.cardClass === "magic"
        ? `${card.magicType.toUpperCase()} / JUTSU CARD`
        : `${card.trapType.toUpperCase()} / SNARE CARD`;
  const supportInstruction =
    card.cardClass === "trap"
      ? "Set before activation"
      : card.cardClass === "monster"
        ? ""
        : card.magicType === "equip"
          ? "Remains attached"
          : card.magicType === "field"
            ? "Shapes both battlefields"
            : "Resolve, then send to the Graveyard";
  const CardRoot = onClick ? "button" : "div";
  const nameLengthClass =
    card.name.length > 26
      ? "very-long-name"
      : card.name.length > 20
        ? "long-name"
        : "";
  // Only catalog art under /chronicle/cards/ has a generated 512px sibling;
  // admin overlays and data: URLs come back undefined and render unchanged.
  const artSrcSet = card.image
    ? chronicleCardArtSrcSet(card.image)
    : undefined;
  const usesEmblemArt = Boolean(
    card.image &&
      ["/badges/", "/legacy/jutsu/", "/combat-vfx/"].some((prefix) =>
        card.image!.startsWith(prefix),
      ),
  );

  return (
    <CardRoot
      type={onClick ? "button" : undefined}
      className={`chronicle-card ${card.cardClass} ${card.cardClass === "monster" ? `${card.monsterType}-monster` : ""} ${card.cardClass === "magic" ? `${card.magicType}-magic` : ""} rarity-${card.rarity} ${nameLengthClass} ${compact ? "compact" : ""} ${selected ? "selected" : ""}`}
      style={style}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-pressed={onClick ? selected : undefined}
      aria-label={`${card.name}. ${details}`}
    >
      <span className="chronicle-card__foil" aria-hidden="true" />
      <header className="chronicle-card__header">
        <strong className="chronicle-card__name">{card.name}</strong>
        {card.cardClass === "monster" ? (
          <span
            className="chronicle-card__element"
            title={`${card.element} element`}
            aria-label={`${card.element} element`}
          >
            <b aria-hidden="true">
              {ELEMENT_ICONS[card.element]?.() ?? element.mark}
            </b>
            <small>{card.element}</small>
          </span>
        ) : (
          <span
            className="chronicle-card__element support"
            title={classLabel}
            aria-hidden="true"
          >
            <b>{card.cardClass === "magic" ? "J" : "S"}</b>
            <small>{classLabel}</small>
          </span>
        )}
      </header>
      <div className="chronicle-card__discipline">
        <span>
          {card.cardClass === "monster"
            ? `LEVEL ${card.level}`
            : card.cardClass === "magic"
              ? `${card.magicType} Jutsu Card`
              : `${card.trapType} response card`}
        </span>
        {card.cardClass === "monster" ? (
          <span className="chronicle-card__level-marks" aria-hidden="true">
            {Array.from({ length: card.level }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        ) : card.deckLimit ? (
          <span className="chronicle-card__limit">
            DECK LIMIT {card.deckLimit}
          </span>
        ) : (
          <span className="chronicle-card__limit">STANDARD ISSUE</span>
        )}
      </div>
      <div
        className={`chronicle-card__art-frame ${usesEmblemArt ? "emblem-art" : ""}`}
      >
        {card.image ? (
          <img
            className="chronicle-card__art"
            src={card.image}
            srcSet={artSrcSet}
            // `sizes` is what decides between the 512px variant and the 768px
            // original; it is meaningless without a srcset, so only emit it
            // alongside one. See the artSizes prop for why callers override it.
            sizes={artSrcSet ? artSizes : undefined}
            alt=""
            draggable={false}
            loading="lazy"
            onError={(event) => event.currentTarget.remove()}
          />
        ) : null}
        <span className="chronicle-card__art-mark" aria-hidden="true">
          SJ
        </span>
        <span className="chronicle-card__art-seal" aria-hidden="true">
          {card.cardClass === "monster"
            ? element.mark
            : card.cardClass === "magic"
              ? "J"
              : "S"}
        </span>
      </div>
      <div className="chronicle-card__dossier">
        <div className="chronicle-card__line">
          <strong>[ {taxonomy} ]</strong>
          <span>{card.rarity}</span>
        </div>
        <p className="chronicle-card__text">{rulesText}</p>
      </div>
      {card.cardClass === "monster" ? (
        <div className="chronicle-card__stats">
          <span>
            <small>ATK</small>
            <b>{card.attack}</b>
          </span>
          <i aria-hidden="true" />
          <span>
            <small>DEF</small>
            <b>{card.defense}</b>
          </span>
        </div>
      ) : (
        <div className="chronicle-card__support-kind">
          <b>{subtypeLabel}</b>
          <span>{supportInstruction}</span>
        </div>
      )}
      <footer className="chronicle-card__footer">
        <span>SJ-CDX</span>
        <span>{card.id}</span>
        <span>{card.deckLimit ? `LIMIT ${card.deckLimit}` : "MAX 3"}</span>
      </footer>
    </CardRoot>
  );
}

export { FRAME as CHRONICLE_FRAME_COLORS, RARITY as CHRONICLE_RARITY_COLORS };

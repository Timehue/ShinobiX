import type { CSSProperties } from "react";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";

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
  onClick,
}: {
  card?: ChronicleDisplayCard;
  hidden?: boolean;
  compact?: boolean;
  selected?: boolean;
  disabled?: boolean;
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
          JOURNEY<small>CHRONICLE DUEL</small>
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
      : { color: frameColor, mark: card.cardClass === "magic" ? "M" : "T" };
  const style = {
    "--chronicle-frame": frameColor,
    "--chronicle-rarity": RARITY[card.rarity],
    "--chronicle-element": element.color,
  } as CSSProperties;
  const details =
    card.cardClass === "monster"
      ? `Level ${card.level} ${card.element} ${card.monsterType} Monster. ATK ${card.attack}, DEF ${card.defense}. ${card.monsterType === "effect" ? card.effectText : card.lore}`
      : `${card.cardClass === "magic" ? `${card.magicType} Magic` : `${card.trapType} Trap`}. ${card.effectText} ${card.lore}`;
  const classLabel =
    card.cardClass === "monster"
      ? "MONSTER"
      : card.cardClass === "magic"
        ? "MAGIC"
        : "TRAP";
  const subtypeLabel =
    card.cardClass === "monster"
      ? card.monsterType === "effect"
        ? "EFFECT MONSTER"
        : "NORMAL MONSTER"
      : card.cardClass === "magic"
        ? `${card.magicType.toUpperCase()} MAGIC`
        : `${card.trapType.toUpperCase()} TRAP`;
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
        ? `${card.magicType.toUpperCase()} / MAGIC CARD`
        : `${card.trapType.toUpperCase()} / TRAP CARD`;
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
        <span className="chronicle-card__class">{subtypeLabel}</span>
        <strong className="chronicle-card__name">{card.name}</strong>
        {card.cardClass === "monster" ? (
          <span
            className="chronicle-card__element"
            title={`${card.element} element`}
            aria-label={`${card.element} element`}
          >
            <b aria-hidden="true">{element.mark}</b>
            <small>{card.element}</small>
          </span>
        ) : (
          <span
            className="chronicle-card__element support"
            title={classLabel}
            aria-hidden="true"
          >
            <b>{card.cardClass === "magic" ? "M" : "T"}</b>
            <small>{classLabel}</small>
          </span>
        )}
      </header>
      <div className="chronicle-card__discipline">
        <span>
          {card.cardClass === "monster"
            ? `LEVEL ${card.level}`
            : card.cardClass === "magic"
              ? `${card.magicType} Magic Card`
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
              ? "M"
              : "T"}
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
        <span>SJD-DCR</span>
        <span>{card.id}</span>
        <span>{card.deckLimit ? `LIMIT ${card.deckLimit}` : "MAX 3"}</span>
      </footer>
    </CardRoot>
  );
}

export { FRAME as CHRONICLE_FRAME_COLORS, RARITY as CHRONICLE_RARITY_COLORS };

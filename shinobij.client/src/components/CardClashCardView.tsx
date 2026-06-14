/*
 * CardClashCardView — the single source of truth for how a Shinobi Card Clash
 * card is drawn (collection grid, deck builder, hand, and on the board). Shows
 * art (card.image or an element-tinted placeholder), chakra cost, power, name,
 * element + rarity. Pure presentational — all interaction is via onClick.
 */
import type { CSSProperties } from "react";
import type { CardClashCard, CardClashPlayedCard, CardClashSide } from "../lib/card-clash";

const ELEMENT_COLOR: Record<string, string> = {
    Fire: "#ff7043", Water: "#4fc3f7", Earth: "#a1887f", Wind: "#a5d6a7",
    Lightning: "#fff176", Shadow: "#ba68c8", Ice: "#b0e0ff", Neutral: "#94a3b8", None: "#8a93a8",
};

const ELEMENT_EMOJI: Record<string, string> = {
    Fire: "🔥", Water: "💧", Earth: "🪨", Wind: "🍃",
    Lightning: "⚡", Shadow: "🌑", Ice: "❄️", Neutral: "⚪", None: "🗡️",
};

const RARITY_BORDER: Record<string, string> = {
    legendary: "#fbbf24", epic: "#ce93d8", rare: "#60a5fa", common: "#64748b",
};

const RARITY_GLOW: Record<string, string> = {
    legendary: "0 0 16px rgba(251,191,36,0.55)",
    epic: "0 0 12px rgba(206,147,216,0.45)",
    rare: "0 0 9px rgba(96,165,250,0.4)",
    common: "none",
};

const ART_HEIGHT: Record<string, number> = { sm: 52, md: 64, lg: 92 };

// On-Reveal ability → burst colour class (see card-clash-skin.css .cc-fx-*).
const FX_CATEGORY: Record<string, string> = {
    onRevealBuffSelf: "buff",
    onRevealBuffAlliesHere: "buff",
    onRevealBuffAlliesEverywhere: "buff",
    onRevealDebuffEnemiesHere: "debuff",
    onRevealDebuffEnemiesEverywhere: "debuff",
    onRevealDoubleSelf: "double",
    summonClone: "summon",
    drawCard: "draw",
    moveAfterReveal: "move",
    protectSelf: "protect",
    discountNextCard: "discount",
};

export function CardClashCardView({
    card,
    size = "md",
    owner,
    selected = false,
    onClick,
    displayedPower,
    reveal = false,
    delta,
}: {
    card: CardClashCard | CardClashPlayedCard;
    size?: "sm" | "md" | "lg";
    owner?: CardClashSide;
    selected?: boolean;
    onClick?: () => void;
    /** Power to display (e.g. including location bonus). Defaults to card power / currentPower. */
    displayedPower?: number;
    /** Play the Snap-style reveal flourish + On-Reveal ability burst (board cards). */
    reveal?: boolean;
    /** Float a "+N / −N" off the card when its displayed power just changed. */
    delta?: number;
}) {
    const elementColor = ELEMENT_COLOR[card.element] ?? "#8a93a8";
    const played = card as Partial<CardClashPlayedCard>;
    const basePower = typeof played.basePower === "number" ? played.basePower : card.power;
    const shownPower =
        typeof displayedPower === "number"
            ? displayedPower
            : typeof played.currentPower === "number"
              ? played.currentPower
              : card.power;
    const buffed = shownPower > basePower;
    const debuffed = shownPower < basePower;
    const isToken = Boolean(played.isToken);

    const style = {
        "--cc-card-border": RARITY_BORDER[card.rarity] ?? "#475569",
        "--cc-card-glow": RARITY_GLOW[card.rarity] ?? "none",
        "--cc-art-h": `${ART_HEIGHT[size]}px`,
        "--cc-art-bg": `linear-gradient(160deg, ${elementColor}33, #0a1326 70%)`,
    } as CSSProperties;

    const cls = [
        "cc-card", size,
        onClick ? "clickable" : "",
        selected ? "selected" : "",
        owner ? `owner-${owner}` : "",
        isToken ? "token" : "",
        reveal ? "reveal" : "",
    ].filter(Boolean).join(" ");

    const fx = reveal ? FX_CATEGORY[card.abilityType] : undefined;

    return (
        <div
            className={cls}
            style={style}
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
            title={`${card.name} — ${card.abilityText}`}
        >
            <div className="cc-card-art">
                {card.image ? (
                    <img src={card.image} alt={card.name} draggable={false} />
                ) : (
                    <span className="cc-emoji">{ELEMENT_EMOJI[card.element] ?? "🗡️"}</span>
                )}
                <span className="cc-pip cost">{card.cost}</span>
                <span className={`cc-pip power${buffed ? " buffed" : ""}${debuffed ? " debuffed" : ""}`}>{shownPower}</span>
            </div>
            <div className="cc-card-name">{card.name}</div>
            <div className="cc-card-foot">
                <span className="cc-chip" style={{ color: elementColor }}>{card.element}</span>
                <span className="cc-chip" style={{ color: RARITY_BORDER[card.rarity] }}>{card.rarity[0].toUpperCase()}</span>
            </div>
            {fx && <span className={`cc-fx-burst cc-fx-${fx}`} aria-hidden />}
            {delta ? (
                // Keyed by shownPower so a fresh power change re-mounts → re-animates.
                <span key={`d-${shownPower}`} className={`cc-float-delta ${delta > 0 ? "up" : "down"}`}>
                    {delta > 0 ? `+${delta}` : delta}
                </span>
            ) : null}
        </div>
    );
}

export { ELEMENT_COLOR, ELEMENT_EMOJI, RARITY_BORDER };

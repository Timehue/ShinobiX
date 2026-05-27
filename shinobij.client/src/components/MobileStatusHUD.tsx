/*
 * Mobile-only persistent top status HUD.
 *
 * Mobile games (Genshin, Clash Royale, Marvel SNAP) always show the
 * player's key resources at the top of the screen. NinjaK on mobile
 * was hiding both the desktop left-profile-card AND the journey-live-stats,
 * so a player on the Jutsu/Profession/Inventory screens had zero visibility
 * of their HP, Chakra, Stamina, Ryo, Shards, or Level. This component fills
 * that gap.
 *
 * Sticky at the top of the viewport while scrolling. Hidden on desktop via
 * CSS (the left-profile-card covers this role there).
 *
 * Pure leaf — receives the character snapshot via prop, no internal state.
 */

import { memo } from "react";
import type { Character } from "../types/character";

export const MobileStatusHUD = memo(function MobileStatusHUD({
    character,
    onBack,
}: {
    character: Character;
    /** When provided, a back arrow appears in the HUD's left edge. */
    onBack?: () => void;
}) {
    const pct = (current: number, max: number) =>
        Math.max(0, Math.min(100, Math.round((current / Math.max(1, max)) * 100)));

    const hpPct = pct(character.hp, character.maxHp);
    const chakraPct = pct(character.chakra, character.maxChakra);
    const staminaPct = pct(character.stamina, character.maxStamina);

    return (
        <div className="mobile-top-hud" role="status" aria-label="Player status">
            {onBack && (
                <button
                    type="button"
                    className="mthd-back"
                    onClick={onBack}
                    aria-label="Go back"
                    title="Go back"
                >
                    ←
                </button>
            )}
            <div className="mthd-identity">
                <div className="mthd-avatar">
                    {character.avatarImage ? (
                        <img
                            src={character.avatarImage}
                            alt=""
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                    ) : (
                        character.name.slice(0, 2).toUpperCase()
                    )}
                </div>
                <div className="mthd-name-row">
                    <strong className="mthd-name">{character.name}</strong>
                    <span className="mthd-level">Lv {character.level}</span>
                </div>
            </div>

            <div className="mthd-bars">
                <div className="mthd-bar mthd-bar-hp" title={`HP ${character.hp}/${character.maxHp}`}>
                    <div className="mthd-bar-fill" style={{ width: `${hpPct}%` }} />
                    <span className="mthd-bar-label">{character.hp}</span>
                </div>
                <div className="mthd-bar mthd-bar-chakra" title={`Chakra ${character.chakra}/${character.maxChakra}`}>
                    <div className="mthd-bar-fill" style={{ width: `${chakraPct}%` }} />
                    <span className="mthd-bar-label">{character.chakra}</span>
                </div>
                <div className="mthd-bar mthd-bar-stamina" title={`Stamina ${character.stamina}/${character.maxStamina}`}>
                    <div className="mthd-bar-fill" style={{ width: `${staminaPct}%` }} />
                    <span className="mthd-bar-label">{character.stamina}</span>
                </div>
            </div>

            <div className="mthd-resources">
                <span className="mthd-resource mthd-ryo" title={`Ryo ${character.ryo.toLocaleString()}`}>
                    <span className="mthd-resource-icon">¥</span>
                    {character.ryo.toLocaleString()}
                </span>
                <span className="mthd-resource mthd-shards" title={`Fate Shards ${character.fateShards.toLocaleString()}`}>
                    <span className="mthd-resource-icon">💎</span>
                    {character.fateShards.toLocaleString()}
                </span>
            </div>
        </div>
    );
});

/*
 * Mobile-only persistent top status HUD.
 *
 * Major mobile games always show the
 * player's key resources at the top of the screen. NinjaK on mobile
 * was hiding both the desktop left-profile-card AND the journey-live-stats,
 * so a player on the Jutsu/Profession/Inventory screens had zero visibility
 * of their HP, Chakra, Stamina, Ryo, Shards, or Level. This component fills
 * that gap.
 *
 * Fixed at the top of the viewport while scrolling. Hidden on desktop via
 * CSS (the left-profile-card covers this role there).
 *
 * Pure leaf — receives the character snapshot via prop, no internal state.
 */

import { memo } from "react";
import type { Character } from "../types/character";
import { formatCompact, formatExact } from "../lib/format-number";
import { GameIcon } from "./icons/GameIcon";
import { useOwnAvatar } from "../lib/own-avatar";

export const MobileStatusHUD = memo(function MobileStatusHUD({
    character,
    onBack,
}: {
    character: Character;
    /** When provided, a back arrow appears in the HUD's left edge. */
    onBack?: () => void;
}) {
    // Name-keyed shared image as the fallback, so the HUD doesn't drop to
    // initials before character.avatarImage hydrates (lib/own-avatar.ts).
    const avatarSrc = useOwnAvatar(character);

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
                    {avatarSrc ? (
                        <img
                            src={avatarSrc}
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

            {/* Bar labels and resource chips are width-constrained, so they use the
                shared COMPACT convention (lib/format-number) while every `title` keeps
                the exact figure. Previously the bars rendered raw values and the
                currencies used toLocaleString(), so two formats sat in one strip — and a
                six-digit raw value overflowed the narrow .mthd-bar-label. */}
            <div className="mthd-bars">
                <div className="mthd-bar mthd-bar-hp" title={`HP ${formatExact(character.hp)}/${formatExact(character.maxHp)}`}>
                    <div className="mthd-bar-fill" style={{ width: `${hpPct}%` }} />
                    <span className="mthd-bar-label">{formatCompact(character.hp)}</span>
                </div>
                <div className="mthd-bar mthd-bar-chakra" title={`Chakra ${formatExact(character.chakra)}/${formatExact(character.maxChakra)}`}>
                    <div className="mthd-bar-fill" style={{ width: `${chakraPct}%` }} />
                    <span className="mthd-bar-label">{formatCompact(character.chakra)}</span>
                </div>
                <div className="mthd-bar mthd-bar-stamina" title={`Stamina ${formatExact(character.stamina)}/${formatExact(character.maxStamina)}`}>
                    <div className="mthd-bar-fill" style={{ width: `${staminaPct}%` }} />
                    <span className="mthd-bar-label">{formatCompact(character.stamina)}</span>
                </div>
            </div>

            <div className="mthd-resources">
                <span className="mthd-resource mthd-ryo" title={`Ryo ${formatExact(character.ryo)}`}>
                    <span className="mthd-resource-icon"><GameIcon name="ryo" size={12} style={{ display: "block" }} /></span>
                    {formatCompact(character.ryo)}
                </span>
                <span className="mthd-resource mthd-shards" title={`Fate Shards ${formatExact(character.fateShards)}`}>
                    <span className="mthd-resource-icon"><GameIcon name="shard" size={12} style={{ display: "block" }} /></span>
                    {formatCompact(character.fateShards)}
                </span>
            </div>
        </div>
    );
});

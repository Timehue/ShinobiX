import { GameArtIcon, type GameArtIconKind } from "./GameArtIcon";

/*
 * Tiny presentational mark / portrait components.
 *
 * Each renders an image when available and a text-or-emoji fallback
 * otherwise. Pure props in, JSX out — no state, no effects, no closure
 * references to App.tsx. Extracted so they stop counting against
 * App.tsx's react-refresh warnings and can be reused independently.
 */

export function CardVisual({
    image,
    icon,
    label,
}: { image?: string; icon?: string; label: string }) {
    const iconArt: readonly [string, GameArtIconKind][] = [
        ["📜", "scroll"], ["📖", "scroll"], ["⚔", "attack"], ["🛡", "roleDefender"],
        ["🐾", "petTamer"], ["🐉", "vanguard"], ["🏯", "clanHall"], ["🎴", "cardHall"],
        ["🔒", "key"], ["🗝", "key"], ["🏆", "crown"],
    ];
    const mappedArt = icon && iconArt.find(([glyph]) => icon.includes(glyph))?.[1];
    const fallback = icon && /\p{Extended_Pictographic}/u.test(icon)
        ? <GameArtIcon kind={mappedArt ?? "roleAssassin"} size={30} />
        : icon || "?";
    return image
        ? <img className="card-visual-thumb" src={image} alt={label} />
        : <span className="tile-icon">{fallback}</span>;
}

export function ClanImageMark({
    image,
    name,
    village,
}: { image?: string; name: string; village?: string }) {
    return image
        ? <img className="clan-image-mark" src={image} alt={name} />
        : (
            <div className="clan-image-mark clan-image-fallback">
                {name.slice(0, 2).toUpperCase() || village?.slice(0, 2).toUpperCase() || "CL"}
            </div>
        );
}

export function LeaderPortrait({
    image,
    name,
    fallback = "?",
}: { image?: string; name: string; fallback?: string }) {
    return image
        ? <img className="leader-portrait-img" src={image} alt={name} />
        : (
            <div className="leader-portrait-img leader-portrait-fallback" aria-label={name}>
                {fallback}
            </div>
        );
}


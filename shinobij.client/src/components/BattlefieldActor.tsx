import React, { useState, type CSSProperties, type ReactNode } from "react";
import { isImageAvatar } from "../lib/avatar";
import {
    inferSpriteKind,
    type BattlefieldSpriteFacing,
    type BattlefieldSpriteKind,
} from "../lib/battlefield-sprite";

type BattlefieldActorProps = {
    side: "player" | "enemy";
    label: string;
    portrait?: string | null;
    sprite?: string | null;
    spriteKind?: BattlefieldSpriteKind;
    facing?: BattlefieldSpriteFacing;
    nativeFacing?: BattlefieldSpriteFacing;
    fallback?: ReactNode;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
};

// Re-exported so existing importers keep their one-stop `BattlefieldActor`
// import; the geometry itself (and `battlefieldSpriteHeadroom`, which overlays
// use to clear a sprite's head) lives in lib/battlefield-sprite.ts.
export type { BattlefieldSpriteKind };

/**
 * Presentation-only combatant marker. The outer actor anchor remains the source
 * of truth for movement, HP badges, targeting, and board scaling; only the art
 * inside it changes between a grounded portrait pin and an optional full-body
 * sprite. The wrapper never receives pointer events, so the hex/button beneath
 * it keeps owning every combat interaction.
 */
export function BattlefieldActor({
    side,
    label,
    portrait,
    sprite,
    spriteKind,
    facing,
    nativeFacing = "left",
    fallback,
    className = "",
    style,
    children,
}: BattlefieldActorProps) {
    const [failedSprite, setFailedSprite] = useState<string | null>(null);
    const [failedPortrait, setFailedPortrait] = useState<string | null>(null);
    const spriteSrc = isImageAvatar(sprite) && failedSprite !== sprite ? sprite : "";
    const portraitSrc = isImageAvatar(portrait) && failedPortrait !== portrait ? portrait : "";
    const initials = fallback ?? label.trim().slice(0, 2).toUpperCase();
    const resolvedSpriteKind = spriteSrc ? spriteKind ?? inferSpriteKind(spriteSrc) : undefined;
    const resolvedFacing = spriteSrc ? facing ?? nativeFacing : undefined;
    const mirrored = spriteSrc ? resolvedFacing !== nativeFacing : undefined;

    return (
        <span
            aria-hidden="true"
            className={[
                "avatar-orb",
                "battlefield-actor",
                side === "enemy" ? "enemy-orb battlefield-actor--enemy" : "battlefield-actor--player",
                spriteSrc ? "battlefield-actor--sprite" : "battlefield-actor--marker",
                className,
            ].filter(Boolean).join(" ")}
            data-battlefield-actor={side}
            data-battlefield-presentation={spriteSrc ? "sprite" : "marker"}
            data-battlefield-sprite-kind={resolvedSpriteKind}
            data-battlefield-facing={resolvedFacing}
            data-battlefield-native-facing={spriteSrc ? nativeFacing : undefined}
            data-battlefield-mirrored={spriteSrc ? String(mirrored) : undefined}
            style={style}
        >
            {spriteSrc ? (
                <img
                    className="battlefield-actor-sprite"
                    src={spriteSrc}
                    alt=""
                    draggable={false}
                    onError={() => setFailedSprite(spriteSrc)}
                />
            ) : (
                <span className="battlefield-actor-marker">
                    <span className="battlefield-actor-pin" />
                    <span className="battlefield-actor-portrait">
                        <span className="battlefield-actor-fallback">{initials}</span>
                        {portraitSrc ? (
                            <img
                                className="battlefield-actor-portrait-image"
                                src={portraitSrc}
                                alt=""
                                draggable={false}
                                onError={() => setFailedPortrait(portraitSrc)}
                            />
                        ) : null}
                    </span>
                </span>
            )}
            {children}
        </span>
    );
}

import React, { useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_PLAYER_BATTLE_SPRITE } from '../lib/battlefield-fighter-art';
import { isImageAvatar } from "../lib/avatar";
import { PetSummonEntrance } from './PetSummonEntrance';
import { useBattlefieldModelSprite } from '../lib/use-battlefield-model-sprite';
import type { PlayerModel } from '../../../shared/player-model-ref';
import {
    inferSpriteKind,
    inferSpriteNativeFacing,
    type BattlefieldSpriteFacing,
    type BattlefieldSpriteKind,
} from "../lib/battlefield-sprite";

type BattlefieldActorProps = {
    side: "player" | "enemy";
    /** Stable actor id stamped as `data-battlefield-actor-id`, so the hit-reaction
     *  layer (lib/battlefield-reactions) can find this anchor without React state. */
    actorId?: string;
    label: string;
    fallbackSprite?: string | null;
    sprite?: string | null;
    model?: PlayerModel;
    spriteKind?: BattlefieldSpriteKind;
    facing?: BattlefieldSpriteFacing;
    nativeFacing?: BattlefieldSpriteFacing;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
    summon?: boolean;
};

// Re-exported so existing importers keep their one-stop `BattlefieldActor`
// import; the geometry itself (and `battlefieldSpriteHeadroom`, which overlays
// use to clear a sprite's head) lives in lib/battlefield-sprite.ts.
export type { BattlefieldSpriteKind };

/**
 * Each fighter's fixed anchor carries movement, reactions and targeting.
 * The equipped model can finish loading after the bundled battle sprite.
 */
export function BattlefieldActor({
    side,
    actorId,
    label,
    fallbackSprite,
    sprite,
    model,
    spriteKind,
    facing,
    nativeFacing,
    className = "",
    style,
    children,
    summon = false,
}: BattlefieldActorProps) {
    const [failed, setFailed] = useState<readonly string[]>([]);
    const modelSprite = useBattlefieldModelSprite(model);
    const spriteSrc = [modelSprite, sprite, fallbackSprite ?? DEFAULT_PLAYER_BATTLE_SPRITE]
        .find((url): url is string => !!url && isImageAvatar(url) && !failed.includes(url));
    const resolvedSpriteKind = spriteKind ?? inferSpriteKind(spriteSrc ?? "");
    const resolvedNativeFacing = nativeFacing ?? inferSpriteNativeFacing(spriteSrc ?? "");
    const resolvedFacing = facing ?? resolvedNativeFacing;
    const art = spriteSrc && (
        <img key={spriteSrc} className="battlefield-actor-sprite" src={spriteSrc} alt={label} draggable={false}
            onError={() => setFailed(urls => urls.includes(spriteSrc) ? urls : [...urls, spriteSrc])} />
    );

    return (
        <span
            aria-hidden="true"
            className={[
                "avatar-orb",
                "battlefield-actor",
                side === "enemy" ? "enemy-orb battlefield-actor--enemy" : "battlefield-actor--player",
                "battlefield-actor--sprite",
                className,
            ].filter(Boolean).join(" ")}
            data-battlefield-actor={side}
            data-battlefield-actor-id={actorId}
            data-battlefield-presentation="sprite"
            data-battlefield-sprite-kind={resolvedSpriteKind}
            data-battlefield-facing={resolvedFacing}
            data-battlefield-native-facing={resolvedNativeFacing}
            data-battlefield-mirrored={String(resolvedFacing !== resolvedNativeFacing)}
            style={style}
        >
            {summon ? <PetSummonEntrance>{art}</PetSummonEntrance> : art}
            {children}
        </span>
    );
}

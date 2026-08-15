import type { CSSProperties, ReactNode, RefCallback, RefObject } from "react";
import { GiPawPrint } from "react-icons/gi";
import { CombatBoardStage } from "../../../components/CombatHudLayout";
import { BattlefieldActor } from "../../../components/BattlefieldActor";
import { FighterHpBadge } from "../../../components/FighterHpBadge";
import { petCollarVisual } from "../../../data/pet-config";
import { petCardImage } from "../../../lib/pet-battle-anim";
import { petDisplayName } from "../../../lib/pet";
import { petVisualVariantClass } from "../../../lib/pet-visual-variant";
import type { Pet } from "../../../types/pet";
import type { Biome } from "../../../types/core";
import type { ArenaCombatVfx, ArenaHitFx } from "../types";

type ArenaCombatBoardStageProps = {
    currentBiome: Biome;
    currentSector: number;
    battlefieldCallbackRef: RefCallback<HTMLDivElement>;
    boardContainerSize: { w: number; h: number };
    effectiveScale: number;
    gridLayerWidth: number;
    gridLayerHeight: number;
    gridWidth: number;
    hexWidth: number;
    hexHeight: number;
    xStep: number;
    yStep: number;
    orbSize: number;
    playerPos: number;
    playerBattleAvatar: string;
    playerName: string;
    playerHp: number;
    playerMaxHp: number;
    enemyPos: number;
    opponentAvatar: string;
    opponentName: string;
    opponentBattleSprite?: string | null;
    enemyHp: number;
    enemyMaxHp: number;
    isPetAlive: boolean;
    summonedPet: Pet | null;
    petPos: number;
    petHp: number;
    petMaxHp: number;
    petTurnsRemaining: number;
    sharedImages: Record<string, string>;
    pveHitFx: ArenaHitFx[];
    boardGrid: ReactNode;
    combatVfxLayerRef: RefObject<HTMLDivElement | null>;
    combatVfx: ArenaCombatVfx[];
    renderCombatVfx: (fx: ArenaCombatVfx) => ReactNode;
};

export function ArenaCombatBoardStage({
    currentBiome,
    currentSector,
    battlefieldCallbackRef,
    boardContainerSize,
    effectiveScale,
    gridLayerWidth,
    gridLayerHeight,
    gridWidth,
    hexWidth,
    hexHeight,
    xStep,
    yStep,
    orbSize,
    playerPos,
    playerBattleAvatar,
    playerName,
    playerHp,
    playerMaxHp,
    enemyPos,
    opponentAvatar,
    opponentName,
    opponentBattleSprite,
    enemyHp,
    enemyMaxHp,
    isPetAlive,
    summonedPet,
    petPos,
    petHp,
    petMaxHp,
    petTurnsRemaining,
    sharedImages,
    pveHitFx,
    boardGrid,
    combatVfxLayerRef,
    combatVfx,
    renderCombatVfx,
}: ArenaCombatBoardStageProps) {
    const scaledWidth = gridLayerWidth * effectiveScale;
    const scaledHeight = gridLayerHeight * effectiveScale;
    const containerWidth = boardContainerSize.w || scaledWidth;
    const containerHeight = boardContainerSize.h || scaledHeight;
    const leftOffset = Math.max(0, (containerWidth - scaledWidth) / 2);
    const topOffset = Math.max(0, (containerHeight - scaledHeight) / 2);

    const orbForPos = (pos: number, isEnemy: boolean, imgSrc: string, altText: string, spriteSrc?: string | null) => {
        const row = Math.floor(pos / gridWidth);
        const col = pos % gridWidth;
        const x = col * xStep + hexWidth / 2 - orbSize / 2;
        const y = row * yStep + (col % 2 === 1 ? hexHeight / 2 : 0) + hexHeight * 0.85 - orbSize;
        return (
            <BattlefieldActor
                key={isEnemy ? "enemy-orb" : "player-orb"}
                side={isEnemy ? "enemy" : "player"}
                label={altText}
                portrait={imgSrc}
                sprite={spriteSrc}
                fallback={altText.slice(0, 2).toUpperCase()}
                style={{ position: "absolute", left: x, top: y, width: orbSize, height: orbSize, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}
            />
        );
    };

    const petActorOrb = (pos: number, pet: Pet) => {
        const row = Math.floor(pos / gridWidth);
        const col = pos % gridWidth;
        const x = col * xStep + hexWidth / 2 - orbSize / 2;
        const y = row * yStep + (col % 2 === 1 ? hexHeight / 2 : 0) + hexHeight * 0.85 - orbSize;
        const collarVisual = petCollarVisual(pet.loadout?.collar);
        const style: Record<string, string | number> = { position: "absolute", left: x, top: y, width: orbSize, height: orbSize, zIndex: 9, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" };
        if (collarVisual) style["--collar-glow"] = collarVisual.glow;
        const orbGlowClass = collarVisual ? (collarVisual.prismatic ? " pet-collar-prismatic" : " pet-collar-glow") : "";
        const petImg = petCardImage(pet, sharedImages);
        return (
            <div key="pet-actor-orb" className={`avatar-orb pet-summon-orb${orbGlowClass} ${petVisualVariantClass(pet)}`} style={style as CSSProperties}>
                <span className="avatar-orb-fallback" style={{ fontSize: orbSize * 0.5 }} aria-hidden="true"><GiPawPrint /></span>
                {petImg && <img className="tiny-map-avatar" src={petImg} alt={petDisplayName(pet)} fetchPriority="high" />}
                {collarVisual?.prismatic && <span className="pet-collar-sparkles" aria-hidden="true" />}
            </div>
        );
    };

    const hpBadgeFor = (
        pos: number,
        key: string,
        hp: number,
        maxHp: number,
        side: "player" | "enemy" | "pet",
        caption?: string,
    ) => {
        const row = Math.floor(pos / gridWidth);
        const col = pos % gridWidth;
        const x = col * xStep + hexWidth / 2 - orbSize / 2;
        const y = row * yStep + (col % 2 === 1 ? hexHeight / 2 : 0) + hexHeight * 0.85 - orbSize - 16;
        return (
            <FighterHpBadge
                key={key}
                left={x}
                top={y}
                width={orbSize}
                hp={hp}
                maxHp={maxHp}
                side={side}
                caption={caption}
                showNumbers={caption == null}
            />
        );
    };

    return (
        <CombatBoardStage>
            <div
                className={`hex-battlefield hex-${currentBiome}${currentSector === 99 ? " hex-deathsgate" : ""}`}
                ref={battlefieldCallbackRef}
            >
                <div style={{
                    position: "absolute",
                    left: `${leftOffset}px`,
                    top: `${topOffset}px`,
                    width: `${scaledWidth}px`,
                    height: `${scaledHeight}px`,
                    overflow: "hidden",
                }}>
                    <div
                        className="hex-grid-layer"
                        style={{
                            position: "absolute",
                            width: `${gridLayerWidth}px`,
                            height: `${gridLayerHeight}px`,
                            transform: `scale(${effectiveScale})`,
                            transformOrigin: "top left",
                            left: "0",
                            top: "0",
                        }}
                    >
                        {orbForPos(playerPos, false, playerBattleAvatar, playerName)}
                        {hpBadgeFor(playerPos, "player-hp-badge", playerHp, playerMaxHp, "player")}
                        {isPetAlive && summonedPet && petActorOrb(petPos, summonedPet)}
                        {isPetAlive && summonedPet && hpBadgeFor(petPos, "pet-hp-badge", petHp, petMaxHp, "pet", `${petDisplayName(summonedPet)} · ${petTurnsRemaining}⟳`)}
                        {orbForPos(enemyPos, true, opponentAvatar, opponentName, opponentBattleSprite)}
                        {hpBadgeFor(enemyPos, "enemy-hp-badge", enemyHp, enemyMaxHp, "enemy")}
                        {pveHitFx.map((fx) => (
                            <span
                                key={fx.id}
                                className={`pvp-hit-fx pvp-hit-${fx.kind}`}
                                style={{ left: `${fx.x}px`, top: `${Math.max(fx.y, 16)}px`, zIndex: 20, pointerEvents: "none" }}
                                aria-hidden="true"
                            >
                                {fx.kind === "damage" ? "−" : "+"}{fx.amount}
                            </span>
                        ))}
                        {boardGrid}
                    </div>
                </div>
                <div ref={combatVfxLayerRef} className="arena-combat-vfx-layer" aria-hidden="true">
                    {combatVfx.map(renderCombatVfx)}
                </div>
            </div>
        </CombatBoardStage>
    );
}

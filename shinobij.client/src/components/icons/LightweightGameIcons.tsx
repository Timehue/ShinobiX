import React, { type CSSProperties, type ReactElement } from "react";
import { GameIcon, type GameIconName } from "./GameIcon";
import { GameArtIcon, type GameArtIconKind } from "../GameArtIcon";

/**
 * Lightweight compatibility layer for the small fantasy-icon vocabulary used
 * across game screens. The previous package shipped every selected 512px path
 * in a shared 174 KB chunk. These aliases reuse the game's compact 24px glyphs
 * so labels retain a consistent visual cue without carrying a second icon set.
 */
export type LightweightGameIconProps = {
    "aria-hidden"?: boolean | "true" | "false";
    className?: string;
    color?: string;
    size?: number | string;
    style?: CSSProperties;
    title?: string;
};

export type IconType = (props: LightweightGameIconProps) => ReactElement;

function gameGlyph(name: GameIconName): IconType {
    return function LightweightGameIcon({ className, color, size = "1em", style, title }) {
        return (
            <GameIcon
                className={className}
                name={name}
                size={size}
                style={color ? { ...style, color } : style}
                title={title}
            />
        );
    };
}

function artGlyph(kind: GameArtIconKind): IconType {
    return function LightweightGameArtIcon({ className, size = "1em", style, title }) {
        return <GameArtIcon className={className} kind={kind} size={size} style={style} title={title} />;
    };
}

function pathGlyph(path: string, options: { fill?: boolean; strokeWidth?: number } = {}): IconType {
    return function LightweightPathIcon({ className, color, size = "1em", style, title }) {
        const labelled = Boolean(title);
        return (
            <svg
                aria-hidden={labelled ? undefined : true}
                className={className}
                fill={options.fill ? "currentColor" : "none"}
                focusable="false"
                height={size}
                role={labelled ? "img" : undefined}
                stroke={options.fill ? "none" : "currentColor"}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={options.strokeWidth ?? 1.8}
                style={color ? { ...style, color } : style}
                viewBox="0 0 24 24"
                width={size}
            >
                {title ? <title>{title}</title> : null}
                <path d={path} />
            </svg>
        );
    };
}

const attack = artGlyph("attack");
const admin = gameGlyph("admin");
const bag = artGlyph("supply");
const bone = artGlyph("boneCharm");
const clock = gameGlyph("clock");
const crystal = artGlyph("auraStone");
const defense = artGlyph("guard");
const dice = artGlyph("dice");
const fire = artGlyph("elementFire");
const gift = artGlyph("reward");
const health = artGlyph("vitality");
// Rations and the starvation warning get their OWN glyphs. They used to alias
// the hp heart and the ownership flag, which put three meanings on one shape on
// the Village War Map (rations / HP / hearts) and made "marches hungry" read
// as a planted banner on a territory-control map.
const rations = artGlyph("rations");
const hazard = artGlyph("warning");
const map = artGlyph("map");
const menu = gameGlyph("menu");
const paw = artGlyph("petTamer");
const petHome = artGlyph("petHome");
const person = artGlyph("roleDefender");
const ryo = artGlyph("ryo");
const scroll = artGlyph("scroll");
const snow = artGlyph("biomeSnow");
const sparkle = artGlyph("auraStone");
const speed = artGlyph("speed");
const strength = artGlyph("training");
const blacksmith = artGlyph("blacksmith");
const community = artGlyph("community");
const target = artGlyph("roleTracker");
const tower = artGlyph("clanHall");
const coliseum = artGlyph("arena");
const travel = artGlyph("gate");

const book = artGlyph("logbook");
const storyBook = artGlyph("storyHall");
const tavern = artGlyph("tavern");
const premiumShop = artGlyph("premiumShop");
const chat = pathGlyph("M4 4.5h16v11H9l-5 4v-15Z");
const discord = gameGlyph("discord");
const envelope = gameGlyph("envelope");
const close = pathGlyph("m6 6 12 12M18 6 6 18", { strokeWidth: 2.2 });
const crown = artGlyph("crown");
const eye = pathGlyph("M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z");
const exit = pathGlyph("M10 4H5v16h5M13 8l4 4-4 4M8 12h9");
const flag = pathGlyph("M5 21V4m0 1h11l-2 3 2 3H5");
const settings = gameGlyph("settings");
const lock = pathGlyph("M7 10V7a5 5 0 0 1 10 0v3m-11 0h12v10H6V10Z");
const trash = pathGlyph("M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5");
const trophy = artGlyph("crown");

export {
    paw as GiAnimalHide,
    blacksmith as GiAnvil,
    tavern as GiBeerStein,
    strength as GiBiceps,
    flag as GiBlackFlag,
    blacksmith as GiBlacksmith,
    book as GiBookCover,
    book as GiBookshelf,
    speed as GiBootPrints,
    rations as GiBowlOfRice,
    attack as GiBoxingGlove,
    defense as GiBreastplate,
    bag as GiBriefcase,
    scroll as GiCardPickup,
    chat as GiChatBubble,
    paw as GiClawSlashes,
    coliseum as GiColiseum,
    map as GiCompass,
    attack as GiCrossedSwords,
    crown as GiCrown,
    target as GiCrownedSkull,
    crystal as GiCrystalBall,
    crystal as GiCrystalCluster,
    crystal as GiCrystalGrowth,
    discord as GiDiscord,
    target as GiDragonHead,
    travel as GiDungeonGate,
    envelope as GiEnvelope,
    exit as GiExitDoor,
    eye as GiEyeball,
    bone as GiFangs,
    speed as GiFastForwardButton,
    paw as GiFeather,
    fire as GiFireSpellCast,
    paw as GiFishScales,
    fire as GiFlame,
    admin as GiAdmin,
    settings as GiSettings,
    crystal as GiGems,
    tower as GiGreekTemple,
    menu as GiHamburgerMenu,
    hazard as GiHazardSign,
    health as GiHealing,
    health as GiHealthIncrease,
    health as GiHealthNormal,
    health as GiHealthPotion,
    defense as GiHood,
    bone as GiHornInternal,
    bag as GiKnapsack,
    tower as GiLadder,
    crown as GiLaurelCrown,
    sparkle as GiMagicSwirl,
    paw as GiMeat,
    person as GiNinjaHeroicStance,
    target as GiOgre,
    storyBook as GiOpenBook,
    gift as GiOpenTreasureChest,
    lock as GiPadlock,
    tower as GiPagoda,
    paw as GiPawPrint,
    petHome as GiPetHome,
    dice as GiRollingDices,
    speed as GiRun,
    clock as GiSandsOfTime,
    scroll as GiScrollUnfurled,
    defense as GiShield,
    premiumShop as GiPremiumShop,
    snow as GiSnowflake1,
    sparkle as GiSparkles,
    target as GiSpikedDragonHead,
    bone as GiSpinalCoil,
    sparkle as GiSpiralThrust,
    eye as GiSpyglass,
    crystal as GiStoneStack,
    tower as GiStoneTower,
    bag as GiSwapBag,
    chat as GiTalk,
    target as GiTargeted,
    travel as GiTempleGate,
    community as GiThreeFriends,
    bone as GiTombstone,
    map as GiTrail,
    trash as GiTrashCan,
    map as GiTreasureMap,
    trophy as GiTrophy,
    ryo as GiTwoCoins,
    crystal as GiWaterDrop,
    target as GiWolfHead,
    close as FiX,
};

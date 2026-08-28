import React, { type CSSProperties, type ReactElement } from "react";
import { GameIcon, type GameIconName } from "./GameIcon";

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

const attack = gameGlyph("sword");
const bag = gameGlyph("bag");
const bone = gameGlyph("bone");
const chakra = gameGlyph("chakra");
const clock = gameGlyph("clock");
const crystal = gameGlyph("crystal");
const defense = gameGlyph("shield");
const dice = gameGlyph("dice");
const fire = pathGlyph("M13.3 2.5c.5 3-1.7 4.3-1.7 6.2 0 1.2.8 2.1 1.9 2.1 1.8 0 2.8-1.7 2.5-3.6 2.4 2 3.8 4.6 3.8 7.1 0 3.8-3 6.7-7.1 6.7s-7.1-2.9-7.1-6.7c0-3.1 1.9-6 5.5-8.5-.2 2.6.8 4.1 2.2 4.1 1.7 0 3-2.1 3.8-5.2Z", { fill: true });
const gift = gameGlyph("gift");
const health = gameGlyph("hp");
// Rations and the starvation warning get their OWN glyphs. They used to alias
// the hp heart and the ownership flag, which put three meanings on one shape on
// the Village War Map (rations / HP / hearts) and made "marches hungry" read
// as a planted banner on a territory-control map.
const rations = gameGlyph("rations");
const hazard = gameGlyph("hazard");
const map = gameGlyph("map");
const medal = gameGlyph("medal");
const menu = gameGlyph("menu");
const moon = gameGlyph("moon");
const paw = gameGlyph("paw");
const person = gameGlyph("person");
const ryo = gameGlyph("ryo");
const scroll = gameGlyph("scroll");
const sigil = gameGlyph("sigil");
const snow = gameGlyph("snow");
const sparkle = gameGlyph("sparkle");
const speed = gameGlyph("bolt");
const strength = gameGlyph("dumbbell");
const target = gameGlyph("target");
const tower = gameGlyph("tower");
const travel = gameGlyph("gate");

const book = pathGlyph("M4 5.5c2.7-.9 5.3-.4 8 1.2v13c-2.7-1.6-5.3-2.1-8-1.2v-13Zm16 0c-2.7-.9-5.3-.4-8 1.2v13c2.7-1.6 5.3-2.1 8-1.2v-13Z");
const chat = pathGlyph("M4 4.5h16v11H9l-5 4v-15Z");
const close = pathGlyph("m6 6 12 12M18 6 6 18", { strokeWidth: 2.2 });
const crown = pathGlyph("m3.5 7 4.5 4 4-6 4 6 4.5-4-2 11h-12l-2-11Z");
const eye = pathGlyph("M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z");
const exit = pathGlyph("M10 4H5v16h5M13 8l4 4-4 4M8 12h9");
const flag = pathGlyph("M5 21V4m0 1h11l-2 3 2 3H5");
const gears = pathGlyph("M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M3.5 12h2m13 0h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18");
const lock = pathGlyph("M7 10V7a5 5 0 0 1 10 0v3m-11 0h12v10H6V10Z");
const speaker = pathGlyph("M4 10h4l5-4v12l-5-4H4v-4Zm12-1c1.3 1.7 1.3 4.3 0 6m2.5-8.5c2.7 3.1 2.7 7.9 0 11");
const speakerOff = pathGlyph("M4 10h4l5-4v5m0 4v3l-5-4H4v-4Zm12-5 5 5m0-5-5 5M3 3l18 18");
const trash = pathGlyph("M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5");
const trophy = pathGlyph("M8 4h8v4c0 3-1.6 5-4 5s-4-2-4-5V4Zm0 2H4v2c0 2 1.5 3.5 4 3.5M16 6h4v2c0 2-1.5 3.5-4 3.5M12 13v4m-4 3h8m-6-3h4");

export {
    clock as GiAlarmClock,
    paw as GiAnimalHide,
    strength as GiAnvil,
    bag as GiBeerStein,
    strength as GiBiceps,
    defense as GiBlackBelt,
    flag as GiBlackFlag,
    strength as GiBlacksmith,
    book as GiBookCover,
    book as GiBookshelf,
    speed as GiBootPrints,
    rations as GiBowlOfRice,
    attack as GiBoxingGlove,
    chakra as GiBrain,
    chakra as GiBrainstorm,
    defense as GiBreastplate,
    defense as GiBrickWall,
    bag as GiBriefcase,
    attack as GiBroadsword,
    clock as GiCalendar,
    fire as GiCampfire,
    scroll as GiCardPickup,
    tower as GiCastle,
    chat as GiChatBubble,
    gift as GiChest,
    paw as GiClawSlashes,
    tower as GiColiseum,
    map as GiCompass,
    attack as GiCrossedSwords,
    crown as GiCrown,
    target as GiCrownedSkull,
    crystal as GiCrystalBall,
    crystal as GiCrystalCluster,
    crystal as GiCrystalGrowth,
    attack as GiDaggers,
    dice as GiDiceSixFacesSix,
    sigil as GiDna1,
    target as GiDragonHead,
    travel as GiDungeonGate,
    chat as GiEnvelope,
    exit as GiExitDoor,
    eye as GiEyeball,
    bone as GiFangs,
    speed as GiFastForwardButton,
    paw as GiFeather,
    fire as GiFireSpellCast,
    paw as GiFishScales,
    fire as GiFlame,
    attack as GiGauntlet,
    gears as GiGears,
    crystal as GiGems,
    medal as GiGraduateCap,
    tower as GiGreekTemple,
    menu as GiHamburgerMenu,
    hazard as GiHazardSign,
    health as GiHealing,
    health as GiHealthIncrease,
    health as GiHealthNormal,
    health as GiHealthPotion,
    health as GiHearts,
    defense as GiHood,
    bone as GiHornInternal,
    bag as GiKnapsack,
    tower as GiLadder,
    crown as GiLaurelCrown,
    trophy as GiLaurelsTrophy,
    sparkle as GiMagicSwirl,
    paw as GiMeat,
    chat as GiMegaphone,
    ryo as GiMoneyStack,
    moon as GiMoon,
    moon as GiNightSleep,
    person as GiNinjaHeroicStance,
    book as GiNotebook,
    target as GiOgre,
    book as GiOpenBook,
    gift as GiOpenTreasureChest,
    lock as GiPadlock,
    tower as GiPagoda,
    paw as GiPawPrint,
    map as GiPositionMarker,
    attack as GiPunchBlast,
    medal as GiRank3,
    medal as GiRibbonMedal,
    dice as GiRollingDices,
    speed as GiRun,
    clock as GiSandsOfTime,
    scroll as GiScrollUnfurled,
    defense as GiShield,
    bag as GiShop,
    snow as GiSnowflake1,
    sparkle as GiSparkles,
    speaker as GiSpeaker,
    speakerOff as GiSpeakerOff,
    target as GiSpikedDragonHead,
    bone as GiSpinalCoil,
    sparkle as GiSpiralThrust,
    speed as GiSprint,
    eye as GiSpyglass,
    crystal as GiStoneStack,
    tower as GiStoneTower,
    clock as GiStopwatch,
    sparkle as GiSun,
    bag as GiSwapBag,
    chakra as GiSwirlString,
    chat as GiTalk,
    target as GiTargeted,
    travel as GiTempleGate,
    person as GiThreeFriends,
    bone as GiTombstone,
    map as GiTrail,
    trash as GiTrashCan,
    map as GiTreasureMap,
    trophy as GiTrophy,
    ryo as GiTwoCoins,
    sigil as GiUpgrade,
    chakra as GiVortex,
    crystal as GiWaterDrop,
    crystal as GiWaterSplash,
    target as GiWolfHead,
    menu as FiGrid,
    bag as FiPackage,
    close as FiX,
};

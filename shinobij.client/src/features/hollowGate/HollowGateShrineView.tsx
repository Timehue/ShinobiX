/*
 * HollowGateShrineView — the dungeon screen, Spirit-Tracks-style pass.
 *
 * The floor renders as a seamless top-down dungeon (not a grid of bordered
 * cells): fixed 48px tiles inside a camera viewport that follows the player,
 * neighbour-aware walls (flat tops vs south-facing wall FACES so chambers
 * read with depth), doors framed in their walls, torch sconces flickering on
 * lit wall faces, and a three-state fog — lit (current room / torchlight),
 * remembered (explored, drawn dim like a map memory) and dark.
 *
 * Movement is sector-style: tap any known tile and the avatar (a gliding
 * grounded pin — HollowGateAvatar) walks there step by step via the walk hook
 * in App; WASD/arrows still step one tile. A minimap in the side panel keeps
 * the whole floor legible while the camera stays close.
 *
 * Quest rifts use the shared underground terrain; legacy atlas floor stamps
 * must not cover its continuous rock, passage art and lighting. Assigned
 * content icons remain available in every run.
 */
import { sharedAvatarFor } from "../../lib/shared-avatar";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "../../styles/index/33-hollow-gate-cinematic.css";
import "../../styles/index/29-clan-exchange-storefront.css";
import type { CSSProperties } from "react";
import { HollowGateAvatar } from "./HollowGateAvatar";
import { HollowGateEventDialog } from './HollowGateEventDialog';
import { hollowGateWandererArt, hollowGateWandererFriendly, hollowGateWandererName, hollowGateWandererOrigin } from '../../../../shared/hollow-gate-wanderers';
import { UndergroundSectorTerrain } from '../../components/UndergroundSectorTerrain';
import { undergroundFeatureBlocks } from '../../../../shared/underground-floor-collision';
import { undergroundCamera, undergroundRenderWindow, undergroundRooms, undergroundTileSize } from '../../lib/underground-sector-camera';
import { riftArrivalRoom, riftBreachSites } from '../../lib/rift-breach-layout';
import { RiftEnergyOverlay } from '../../components/RiftBreach';
import { HollowGateBossCinematic } from "./HollowGateBossCinematic";
import { HollowGateShardBar } from "../../components/HollowGateShardBar";
import type { HollowGateConsumableScope } from "../../lib/hollow-gate-consumable-confirmation";
import { GameArtIcon, type GameArtIconKind } from "../../components/GameArtIcon";
import { HOLLOW_GATE_ICON_KEY, HOLLOW_GATE_ICON_ROLES } from "../../data/hollow-gate-atlas";
import { hollowGateIntroPagesFor } from "../../data/hollow-gate-flavor";
import { computeHollowGateSight } from "../../lib/hollow-gate-visibility";
import { hollowGateSecretSealed } from "../../lib/hollow-gate-secrets";
import { HollowGateFissureArt } from "../../components/HollowGateFissureArt";

/** Painted weakened-rock decal for a sealed secret passage. */
const CAVERN_CRACKED_WALL_ART = "/underground/cavern-cracked-wall-v1.webp";
/** Painted props that stand on the chamber floors instead of UI badges
 *  (shinobij.client/art-source/hollow-gate-cavern-chambers.json). */
const PAINTED_PROP: Partial<Record<HollowGateTileKind, string>> = {
    descend: "/underground/cavern-prop-descend-v1.webp", exit: "/underground/cavern-prop-exit-v1.webp",
    chest: "/underground/cavern-prop-chest-v1.webp", shard_vein: "/underground/cavern-prop-shard-vein-v1.webp",
    shrine: "/underground/cavern-prop-shrine-v1.webp", story: "/underground/cavern-prop-story-v1.webp",
    locked: "/underground/cavern-prop-locked-v1.webp",
};
import { HOLLOW_GATE_FISSURE_BEAT_MS, hollowGateArenaFissures, hollowGateFissureState, type HollowGateFissureState } from "../../lib/hollow-gate-arena";
import { hollowGateBossDisplayName, hollowGateRunMaxFloor } from "../../lib/hollow-gate-variant";
import { hollowGateClawBackPreview } from "../../lib/hollow-gate-run";
import {
    HOLLOW_GATE_ALPHA_CINEMATIC,
    hollowGateAlphaCinematicImage,
    hollowGateLegacyRoomPrefabs,
    hollowGatePassageArt,
    hollowGateRoomArt,
    hollowGateFloorProfile,
    hollowGateRiftFloorProfile,
} from "../../lib/hollow-gate-presentation";
import type { HollowGateEventModal } from "../../lib/hollow-gate-tile";
import { isPetOnExpedition } from "../../lib/pet";
import { formatCompact, formatExact } from '../../lib/format-number';
import {
    playGameSfx,
    primeGameAudio,
    startGameAmbience,
    stopGameAmbience,
} from "../../lib/game-audio";
import type { Character, HollowGateShrineRun, HollowGateTerrain, HollowGateTile, HollowGateTileKind, VersionedCharacterCommit } from "../../types/character";

const nativePresentationStyle0 = { color: "#a855f7", letterSpacing: 2 } satisfies import('react').CSSProperties;
const nativePresentationStyle1 = { margin: "0 0 12px", color: "#faf5ff" } satisfies import('react').CSSProperties;
const nativePresentationStyle2 = { background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 } satisfies import('react').CSSProperties;
const nativePresentationStyle3 = { margin: "0 0 6px", color: "#c4b5fd" } satisfies import('react').CSSProperties;
const nativePresentationStyle4 = { background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 } satisfies import('react').CSSProperties;
const HOLLOW_GATE_TILE_ART: Partial<Record<HollowGateTileKind, GameArtIconKind>> = {
    battle: "attack", elite: "roleAssassin", trap: "warning", chest: "reward",
    pet_event: "petTamer", pet_battle: "petTamer", tile_game: "dice", shard_vein: "fateShard",
    shrine: "gate", story: "scroll", boss: "attack", exit: "worldMap", locked: "key",
    npc: "healer", descend: "worldMap",
};
const HOLLOW_GATE_WORLD_PROP: Partial<Record<HollowGateTileKind, string>> = {
    chest: 'fortress-supplies', shard_vein: 'cavern-crystals', shrine: 'cavern-offering',
    locked: 'cavern-arch', descend: 'cavern-arch', exit: 'cavern-arch', story: 'cavern-broken-pillar',
};

type HiddenChamberState = { searched: boolean; relicTaken: boolean } | null;

const BOSS_INTRO_SESSION_PREFIX = "shinobix:hollow-gate-alpha-intro:";
const RIFT_DISTORTION_LABEL: Record<string, { label: string; detail: string }> = {
    "echoed-cache": { label: "Echoed Cache", detail: "One existing chest is marked on each floor. Its usual chest contents are unchanged." },
    "echoed-threat": { label: "Echoed Threat", detail: "One existing battle is marked on each floor. Enemy and reward rules are unchanged." },
    "resonant-vein": { label: "Resonant Vein", detail: "One existing shard vein is marked on each floor. Its usual contents are unchanged." },
};
const bossIntroSeenKeys = new Set<string>();

function bossIntroWasSeen(key: string): boolean {
    if (bossIntroSeenKeys.has(key)) return true;
    try {
        const seen = sessionStorage.getItem(`${BOSS_INTRO_SESSION_PREFIX}${key}`) === "1";
        if (seen) bossIntroSeenKeys.add(key);
        return seen;
    } catch {
        return false;
    }
}

function rememberBossIntro(key: string): void {
    bossIntroSeenKeys.add(key);
    try {
        sessionStorage.setItem(`${BOSS_INTRO_SESSION_PREFIX}${key}`, "1");
    } catch {
        // The cinematic remains dismissible when storage is unavailable.
    }
}

/** The shrine's admin-assigned content icons (game art fallback when absent).
 *  Floors and walls are the room paintings, so no atlas floor stamps remain. */
type HollowGateCellArt = {
    pickRoleIconImage: (role: string, idx: number) => string | undefined;
};

// Deterministic cell-index hash so a given cell always picks the same
// variant (no flicker between renders). Standard 32-bit mixing constant.
function variantPick(idx: number, count: number): number {
    if (count <= 1) return 0;
    return ((idx * 2654435761) >>> 0) % count;
}

function hollowGateCellArt(sharedImages: Record<string, string>): HollowGateCellArt {
    // Variant-aware icon lookup for a content role (chest, battle, etc.).
    // Tries shrine:icon-<role>-1..N in deterministic hash order, falls back
    // to shrine:icon-<role> (legacy single-icon assignments).
    const roleIconPools = new Map<string, string[]>();
    return {
        pickRoleIconImage(role, idx) {
            const cfg = HOLLOW_GATE_ICON_ROLES[role];
            if (!cfg) return undefined;
            let assigned = roleIconPools.get(role);
            if (!assigned) {
                assigned = [];
                if (cfg.count > 1) {
                    for (let i = 1; i <= cfg.count; i += 1) {
                        const image = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                        if (image) assigned.push(image);
                    }
                }
                if (assigned.length === 0) {
                    const fallback = sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                    if (fallback) assigned.push(fallback);
                }
                roleIconPools.set(role, assigned);
            }
            if (assigned.length === 0) return undefined;
            return assigned.length === 1 ? assigned[0] : assigned[variantPick(idx, assigned.length)];
        },
    };
}

function iconSlotIdFor(k: HollowGateTileKind): string | null {
    if (k === "pet_event") return "pet";
    if (k === "pet_battle") return "petbattle";
    if (k === "tile_game") return "tilegame";
    if (k === "shard_vein") return "shardvein";
    if (k === "empty" || k === "wall") return null;
    return k;
}

type HollowGateCellProps = {
    i: number; x: number; y: number; tile: HollowGateTile;
    wall: boolean; wallFace: boolean;
    visible: boolean; known: boolean; isPlayer: boolean; isDest: boolean; clickable: boolean;
    isDetourChest: boolean; isRiftSignal: boolean; roamerOrigin: boolean;
    /** A sealed secret passage: drawn as cracked rock, walk into it to break through. */
    secret?: boolean;
    /** A boss-arena fissure and where it is in its rhythm. */
    fissure?: HollowGateFissureState;
    /** Only the cells whose label uses them get these; every other cell's stay undefined. */
    playerName?: string; detourExtraSteps?: number; riftLabel?: string;
    art: HollowGateCellArt; onPick: (idx: number) => void;
};

/**
 * One board cell. Memoized on what it draws, so a step re-renders the cells
 * whose light, occupancy or contents changed rather than every cell of the
 * floor, and a reply that only moves torch or threat re-renders none.
 */
const HollowGateCell = memo(function HollowGateCell({ i, x, y, tile, wall, wallFace,
    visible, known, isPlayer, isDest, clickable, isDetourChest, isRiftSignal, roamerOrigin, secret = false, fissure, playerName, detourExtraSteps, riftLabel, art, onPick }: HollowGateCellProps) {
    const revealed = tile.revealed;
    const terrainKind: HollowGateTerrain =
        tile.terrain ?? (tile.kind === "wall" ? "wall" : "room_floor");

    // ── Cell classes: terrain shape + fog state ────────────
    // Walls read with depth: a wall whose SOUTH neighbour is
    // walkable shows its FACE (brick courses); other walls are
    // flat tops. Floors are seamless (no per-cell borders).
    const fogCls = visible ? "hg-lit" : known ? "hg-dim" : "hg-dark";
    const shapeCls = wall
        ? (wallFace ? "hg-wall-face" : "hg-wall-top")
        : terrainKind === "door" ? "hg-door"
        : terrainKind === "corridor_floor" ? "hg-floor-corridor"
        : "hg-floor-room";
    const checkCls = !wall && terrainKind !== "door" && (x + y) % 2 === 0 ? " hg-check" : "";

    // The room paintings are the floor: cells draw no texture of their own.
    // Surprise tiles (trap/battle/elite/pet) stay disguised as
    // floor until actually stepped on (revealed).
    const isSurpriseKind = tile.kind === "trap"
        || tile.kind === "battle"
        || tile.kind === "elite"
        || tile.kind === "pet_event"
        || tile.kind === "pet_battle";

    // ── Icon: atlas image (shrine:icon-<slot>) or themed game art ────
    const showIcon = tile.kind !== 'npc' && !roamerOrigin && !wall && (visible || known) && !(isSurpriseKind && !revealed) && tile.kind !== "empty";
    const spentTrap = known && revealed && tile.kind === 'trap' && tile.resolved;
    const iconSlotId = showIcon ? iconSlotIdFor(tile.kind) : null;
    const iconImage = iconSlotId ? art.pickRoleIconImage(iconSlotId, i) : undefined;
    const worldProp = showIcon ? HOLLOW_GATE_WORLD_PROP[tile.kind] : undefined;
    const iconArtKind = tile.terrain === "door" ? "gate" : HOLLOW_GATE_TILE_ART[tile.kind] ?? "warning";

    const tileLabel = isPlayer
        ? `${playerName}, current location${spentTrap ? ', spent trap, safe to cross' : ''}, row ${y + 1}, column ${x + 1}`
        : !known
            ? `Unknown tile, row ${y + 1}, column ${x + 1}`
            : secret
                ? `Cracked wall, row ${y + 1}, column ${x + 1}${clickable ? ", press Enter to break through" : ""}`
            : wall
                ? `Wall, row ${y + 1}, column ${x + 1}`
                : `${fissure ? `Fire fissure, ${fissure === "erupting" ? "erupting, cannot cross now" : fissure === "warning" ? "glowing, erupts next" : "cool, safe to cross"}; ` : ""}${isDetourChest ? `Optional echo cache, standard chest contents, about ${detourExtraSteps ?? 0} extra route steps; ` : ""}${isRiftSignal ? `Weekly Rift signal for ${riftLabel}; ` : ""}${spentTrap ? 'Spent trap, safe to cross' : showIcon ? tile.kind.replaceAll("_", " ") : "explored floor"}, row ${y + 1}, column ${x + 1}${clickable ? ", press Enter to walk here" : ""}`;

    return (
        <div
             title={secret && known ? 'Cracked wall' : wall || !known ? undefined : spentTrap ? 'Spent trap (safe to cross)' : showIcon ? tile.kind.replaceAll('_', ' ') : 'Explored floor'}
             role="gridcell"
             aria-label={tileLabel}
             aria-rowindex={y + 1}
             aria-colindex={x + 1}
             aria-current={isPlayer ? "location" : undefined}
             tabIndex={clickable ? 0 : -1}
             className={`hg-cell ${shapeCls} ${fogCls}${checkCls}${secret ? " hg-secret" : ""}${clickable ? " hg-clickable" : ""}${isDest ? " hg-dest" : ""}${isDetourChest ? " hg-detour-cache" : ""}${isRiftSignal ? " hg-rift-signal" : ""}`}
             style={{ gridColumn: x + 1, gridRow: y + 1 }}
             onClick={clickable ? () => onPick(i) : undefined}
             onKeyDown={clickable ? (event) => {
                 if (event.key !== "Enter" && event.key !== " ") return;
                 event.preventDefault();
                 onPick(i);
             } : undefined}
         >
             {secret && known && <img className="hg-secret-decal" src={CAVERN_CRACKED_WALL_ART} alt="" aria-hidden="true" />}
             {fissure && known && <HollowGateFissureArt state={fissure} />}
             {spentTrap && <span className="hg-spent-trap" aria-hidden="true">✓</span>}
             {isDetourChest && <span className="hg-detour-mark" aria-hidden="true">✦</span>}
             {isRiftSignal && <span className="hg-rift-mark" aria-hidden="true">◈</span>}
             {known && (tile.kind === 'descend' || tile.kind === 'exit' || tile.kind === 'boss') && <span className="hg-cave-waypoint" aria-hidden="true">{tile.kind === 'descend' ? '↓ Deeper' : tile.kind === 'exit' ? '↑ Exit' : tile.resolved ? 'Cleared' : 'Boss'}</span>}
             {showIcon && PAINTED_PROP[tile.kind] ? <img className="hg-painted-prop" src={PAINTED_PROP[tile.kind]} alt="" aria-hidden="true" draggable={false} />
             : iconImage ? (
                 <img
                     src={iconImage}
                     alt=""
                     aria-hidden="true"
                     className="hg-icon-img"
                 />
             ) : worldProp ? <img className="hg-world-prop" src={`/underground/${worldProp}-v1.webp`} alt="" aria-hidden="true" />
             : showIcon ? <span className="hg-icon" aria-hidden="true"><GameArtIcon kind={iconArtKind} size={22} /></span> : null}
        </div>
    );
});

type HollowGateShrineViewProps = {
    character: Character;
    currentConsumableScope: () => HollowGateConsumableScope | null;
    hollowGateRun: HollowGateShrineRun;
    hollowGateLog: string[];
    sharedImages: Record<string, string>;
    hollowGateIntroPage: number | null;
    setHollowGateIntroPage: (page: number | null) => void;
    hollowGateEvent: HollowGateEventModal;
    hollowGateHiddenChamber: HiddenChamberState;
    moveHollowGatePlayer: (dx: number, dy: number) => void;
    onTileClick: (idx: number) => void;
    walkTarget: number | null;
    setHollowGateRun: (run: HollowGateShrineRun) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    pushHollowGateLog: (line: string) => void;
    petEligible: boolean;
    exitPending: boolean;
    onEmergencyForfeit: () => void;
    onSearchHiddenChamber: () => void;
    onTakeHiddenChamberRelic: () => void;
    onCloseHiddenChamber: () => void;
};

export function HollowGateShrineView({
    character,
    currentConsumableScope,
    hollowGateRun,
    hollowGateLog,
    sharedImages,
    hollowGateIntroPage,
    setHollowGateIntroPage,
    hollowGateEvent,
    hollowGateHiddenChamber,
    moveHollowGatePlayer,
    onTileClick,
    walkTarget,
    setHollowGateRun,
    onVersionedCharacter,
    pushHollowGateLog,
    petEligible,
    exitPending,
    onEmergencyForfeit,
    onSearchHiddenChamber,
    onTakeHiddenChamberRelic,
    onCloseHiddenChamber,
}: HollowGateShrineViewProps) {
    const run = hollowGateRun;
    const maxHp = Math.max(1, character.maxHp);
    const hp = Math.min(maxHp, Math.max(0, character.hp));
    const isQuestRift = run.variant?.id.startsWith('rift-') === true;
    const chamberBounds = useMemo(() => undergroundRooms(run.tiles, run.width), [run.tiles, run.width]);
    // Two signpost breaches: the arrival room and the way down. One list feeds
    // both the painted stone (terrain) and its energy overlay, so they agree.
    const cryptFloor = run.roomPrefabs != null;
    const breachSites = useMemo(() => isQuestRift ? riftBreachSites(run.tiles, run.width, riftArrivalRoom(run.tiles, run.width, cryptFloor)) : [],
        [isQuestRift, run.tiles, run.width, cryptFloor]);
    // computeHollowGateVisible reads only the board, its size and the position,
    // so a server reply that moves torch, threat or wanderers reuses the set.
    const { tiles: runTiles, width: runWidth, height: runHeight, playerX: runPlayerX, playerY: runPlayerY, diviner: runDiviner } = run;
    const visibleSet = useMemo(() => computeHollowGateSight({ tiles: runTiles, width: runWidth, height: runHeight,
        playerX: runPlayerX, playerY: runPlayerY, diviner: runDiviner } as HollowGateShrineRun),
    [runTiles, runWidth, runHeight, runPlayerX, runPlayerY, runDiviner]);
    // Known = currently visible ∪ previously explored (stepped OR ever seen) —
    // the click-to-walk surface and the "map memory" fog tier.
    const knownSet = useMemo(() => {
        const known = new Set(visibleSet);
        runTiles.forEach((t, i) => { if (t.revealed || t.seen) known.add(i); });
        return known;
    }, [visibleSet, runTiles]);
    // Boss arena fissures (lib/hollow-gate-arena): tick once per beat, and only
    // while the chamber is in sight, so a beat re-renders just those cells.
    const fissures = useMemo(() => hollowGateArenaFissures({ tiles: runTiles, width: runWidth }), [runTiles, runWidth]);
    const fissuresInSight = fissures.size > 0 && [...fissures.keys()].some((i) => visibleSet.has(i));
    const [arenaNow, setArenaNow] = useState(() => Date.now());
    useEffect(() => {
        if (!fissuresInSight) return;
        let timer = 0;
        const tick = () => {
            const now = Date.now();
            setArenaNow(now);
            timer = window.setTimeout(tick, HOLLOW_GATE_FISSURE_BEAT_MS - (now % HOLLOW_GATE_FISSURE_BEAT_MS) + 5);
        };
        tick();
        return () => window.clearTimeout(timer);
    }, [fissuresInSight]);
    // The terrain painter draws a sealed secret passage as plain rock.
    const terrainTiles = useMemo(() => runTiles.some(hollowGateSecretSealed)
        ? runTiles.map((t) => (hollowGateSecretSealed(t) ? { ...t, terrain: "wall" as const } : t))
        : runTiles, [runTiles]);
    const cellArt = useMemo(() => hollowGateCellArt(sharedImages), [sharedImages]);
    const floorFeatures = run.floorFeatures;
    const blockedCells = useMemo(() => {
        const blocked = new Set<number>();
        for (let i = 0; i < runTiles.length; i += 1) if (undergroundFeatureBlocks(floorFeatures, i)) blocked.add(i);
        return blocked;
    }, [floorFeatures, runTiles.length]);
    // Cells call the latest click handler through a stable function, so App's
    // per-render callback does not re-render every cell.
    const onTileClickRef = useRef(onTileClick);
    useLayoutEffect(() => { onTileClickRef.current = onTileClick; });
    const pickTile = useCallback((idx: number) => onTileClickRef.current(idx), []);
    const [journalOpen, setJournalOpen] = useState(false);
    const hiddenChamberOpen = hollowGateHiddenChamber !== null;
    useEffect(() => {
        primeGameAudio(["ambience-hollow", "omen", "paper", "reveal", "mythic"]);
        startGameAmbience("ambience-hollow", { gain: 0.026, fadeMs: 1400 });
        return () => stopGameAmbience(700);
    }, []);
    useEffect(() => {
        const kind = hollowGateEvent?.kind;
        if (kind === "chest") playGameSfx("reveal", { gain: 0.56 });
        else if (kind === "locked") playGameSfx("omen", { gain: 0.52 });
        else if (kind === "story") playGameSfx("paper", { gain: 0.62 });
    }, [hollowGateEvent?.kind]);
    useEffect(() => {
        if (hiddenChamberOpen) playGameSfx("reveal", { gain: 0.68 });
    }, [hiddenChamberOpen]);
    const pet = character.pets.find(p => p.id === character.activePetId);
    const shrineBg = sharedImages["shrine:hollow-gate-background"];
    const cardBackground = shrineBg
        ? `linear-gradient(180deg, rgba(15,9,28,0.78), rgba(8,4,18,0.88)), url(${shrineBg}) center/cover no-repeat`
        : "linear-gradient(180deg, rgba(15,9,28,0.92), rgba(8,4,18,0.95))";
    const maxFloor = hollowGateRunMaxFloor(run);
    // Stable art props, so the memoized terrain is not redrawn on every step
    // or fissure beat (a fresh object each render would defeat its memo).
    const runFloor = run.floor, savedPrefabs = run.roomPrefabs;
    // A floor from before the crypt board has no prefab record; its rooms
    // still get the painting nearest their shape. (Same object while saved.)
    const runRoomPrefabs = useMemo(() => savedPrefabs ?? hollowGateLegacyRoomPrefabs(runTiles, runWidth), [savedPrefabs, runTiles, runWidth]);
    const roomArt = useMemo(() => hollowGateRoomArt(runFloor, runFloor >= maxFloor, runRoomPrefabs, isQuestRift),
        [runFloor, maxFloor, runRoomPrefabs, isQuestRift]);
    const passageArt = hollowGatePassageArt(runFloor, isQuestRift);
    const introPages = hollowGateIntroPagesFor(run.variant);
    const bossName = hollowGateBossDisplayName(run);
    const floorProfile = isQuestRift ? hollowGateRiftFloorProfile(run.floor, maxFloor, bossName) : hollowGateFloorProfile(run.floor);
    const lootAtRisk = hollowGateClawBackPreview(character, run);
    const ryoAtRisk = lootAtRisk.ryo ?? 0, shardsAtRisk = lootAtRisk.hollowShards ?? 0;
    const isFinalFloor = run.floor >= maxFloor;
    const isHoundBoss = bossName.toLowerCase().includes("hound");
    const bossIntroKey = `${run.runToken || run.serverSeed || character.name || "local"}:${run.floor}`;
    const [dismissedBossIntroKey, setDismissedBossIntroKey] = useState<string | null>(null);
    const showBossIntro = hollowGateIntroPage === null
        && !hollowGateEvent
        && !hollowGateHiddenChamber
        && isFinalFloor
        && isHoundBoss
        && !run.completed
        && dismissedBossIntroKey !== bossIntroKey
        && !bossIntroWasSeen(bossIntroKey);
    const floorStyle = {
        ...(!isQuestRift ? {
            "--hg-floor-accent": floorProfile.accent,
            "--hg-floor-accent-soft": floorProfile.accentSoft,
            "--hg-floor-fog": floorProfile.fog,
        } : {}),
        background: cardBackground,
        color: "#e9d5ff",
        padding: 16,
        borderRadius: 12,
    } as CSSProperties;

    const dismissBossIntro = () => {
        rememberBossIntro(bossIntroKey);
        setDismissedBossIntroKey(bossIntroKey);
    };

    // ── Camera: the viewport is measured; the board translates so the player
    //    stays centred (clamped to the board edges). Small boards just centre.
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [vp, setVp] = useState({ w: 0, h: 0 });
    useLayoutEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            setVp(prev => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Derived from the measured viewport rather than window.innerWidth at module
    // load, so rotation, split-screen, and browser zoom update the camera.
    const tilePx = undergroundTileSize({ width: vp.w, height: vp.h }, chamberBounds, isQuestRift ? 'rift' : 'chamber');
    const boardW = run.width * tilePx;
    const boardH = run.height * tilePx;
    const playerRoom = run.tiles[run.playerY * run.width + run.playerX]?.roomId;
    const roomBreach = breachSites.find(site => site.roomId === playerRoom && site.cells.every(i => visibleSet.has(i)));
    // Keep the player and the discovered power source together, particularly
    // in short landscape fields. Large chamber axes still follow the player.
    const sourceWeight = roomBreach ? (vp.h < 300 ? .5 : .2) : 0;
    const focusAxis = (player: number, source: number, extent: number) => player
        + Math.max(-extent / tilePx * .22, Math.min(extent / tilePx * .22, (source - .5 - player) * sourceWeight));
    const camera = undergroundCamera({ view: { width: vp.w, height: vp.h }, width: run.width, height: run.height,
        tileSize: tilePx, playerX: focusAxis(run.playerX, roomBreach?.x ?? run.playerX + .5, vp.w),
        playerY: focusAxis(run.playerY, roomBreach?.y ?? run.playerY + .5, vp.h),
        room: playerRoom == null ? undefined : chamberBounds.get(playerRoom), margin: isQuestRift ? 1.3 : 1 });
    // The terrain is memoized: keep its raster window's identity until the camera moves.
    const terrainWindow = useMemo(() => undergroundRenderWindow({ view: { width: vp.w, height: vp.h },
        width: runWidth, height: runHeight, tileSize: tilePx, camera: { x: camera.x, y: camera.y } }),
    [vp.w, vp.h, runWidth, runHeight, tilePx, camera.x, camera.y]);

    return (
                        <div className={`card hollow-gate-shrine underground-world underground-world--cave${isQuestRift ? ' underground-world--rift' : ''}`} data-hg-rift={isQuestRift ? run.variant?.id : undefined} data-hg-depths={maxFloor} data-hg-floor={floorProfile.floor} data-hg-loot-at-risk={Boolean(ryoAtRisk || shardsAtRisk)} style={floorStyle}>
                            {showBossIntro && (
                                <HollowGateBossCinematic
                                    mode="entrance"
                                    eyebrow="FINAL FLOOR · ALPHA SANCTUM"
                                    title={bossName}
                                    body={`${floorProfile.atmosphere} ${floorProfile.lore}`}
                                    image={hollowGateAlphaCinematicImage(sharedImages)}
                                    actionLabel="Enter the Alpha Sanctum"
                                    onContinue={dismissBossIntro}
                                    onEmergencyForfeit={onEmergencyForfeit}
                                    exitPending={exitPending}
                                />
                            )}
                            {/* First-entry Intro VN overlay — blocks interaction until dismissed. */}
                            {hollowGateIntroPage !== null && (() => {
                                const page = introPages[hollowGateIntroPage] ?? introPages[0];
                                const introImage = sharedImages[page.imageKey];
                                const isLast = hollowGateIntroPage >= introPages.length - 1;
                                return (
                                    <HollowGateEventDialog titleId="hg-intro-title" busy={exitPending} style={{ width: "min(640px, calc(100vw - 24px))" }}>
                                            <p className="act-label" style={nativePresentationStyle0}>HOLLOW GATE — INTRODUCTION</p>
                                            <h2 id="hg-intro-title" style={nativePresentationStyle1}>{page.title}</h2>
                                            {introImage && (
                                                <img src={introImage} alt={page.title} style={{ width: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                                                {page.lines.map((line, i) => (
                                                    <p key={i} style={{ margin: 0, lineHeight: 1.55 }}>{line}</p>
                                                ))}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <small style={{ color: "#a78bfa" }}>Page {hollowGateIntroPage + 1} / {introPages.length}</small>
                                                <div style={{ display: "flex", gap: 8 }}>
                                                    {hollowGateIntroPage > 0 && (
                                                        <button onClick={() => setHollowGateIntroPage(hollowGateIntroPage - 1)}>Back</button>
                                                    )}
                                                    <button
                                                        autoFocus
                                                        onClick={() => {
                                                            if (isLast) setHollowGateIntroPage(null);
                                                            else setHollowGateIntroPage(hollowGateIntroPage + 1);
                                                        }}
                                                        style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", borderColor: "#c4b5fd" }}
                                                    >
                                                        {isLast ? "Enter the shrine" : "Next"}
                                                    </button>
                                                </div>
                                            </div>
                                    </HollowGateEventDialog>
                                );
                            })()}
                            <div className="hg-cave-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                                <div>
                                    <p className="act-label" style={nativePresentationStyle0}>
                                        {run.variant?.label ? run.variant.label.toUpperCase() : "HOLLOW GATE · ANCIENT CAVERN"}
                                        {run.variant && !isQuestRift && <span style={{ marginLeft: 8, fontSize: 10, color: "#e6c477", border: "1px solid #b45309", borderRadius: 999, padding: "1px 8px", letterSpacing: 1 }}>EVENT</span>}
                                    </p>
                                    <h2 style={{ margin: 0, color: "#faf5ff" }}>{isQuestRift ? <><span className="hg-rift-depth">Depth {String(run.floor).padStart(2, '0')} / {String(maxFloor).padStart(2, '0')}</span>{run.completed ? 'The Rift Falls Silent' : floorProfile.name}</> : <>Floor {run.floor} / {maxFloor} · {run.completed ? `${bossName} Defeated` : floorProfile.name}</>}</h2>
                                </div>
                                <div className="hg-cave-vitals" style={{ display: "flex", gap: 16, alignItems: "center" }}>
                                    <div className="hg-cave-threat" style={{ minWidth: 200 }}>
                                        <div className="hg-cave-hp" data-low-hp={hp <= maxHp * .3 || undefined} title="Waiting does not restore HP during this run.">
                                            <div><strong>HP</strong><span>{formatExact(hp)} / {formatExact(maxHp)}</span></div>
                                            <div className="hg-cave-hp__track" role="progressbar" aria-label="Shrine HP" aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp}>
                                                <span style={{ width: `${hp / maxHp * 100}%` }} />
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, alignItems: "center" }}>
                                            <span>Threat{run.threat >= 80 && (
                                                <span style={{
                                                    marginLeft: 6,
                                                    fontSize: 11,
                                                    color: "#fda4af",
                                                    fontWeight: 700,
                                                    animation: "hgPulse 1s ease-in-out infinite",
                                                }}>⚠ AMBUSH IMMINENT</span>
                                            )}</span>
                                            <span style={{ color: run.threat >= 80 ? "#fda4af" : "#c4b5fd" }}>{run.threat}%</span>
                                        </div>
                                        <div
                                            role="progressbar"
                                            aria-label="Hollow Gate threat"
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={run.threat}
                                            style={{
                                            height: 8,
                                            background: "rgba(168,85,247,0.18)",
                                            borderRadius: 4,
                                            overflow: "hidden",
                                            border: run.threat >= 80 ? "1px solid #fda4af" : undefined,
                                            boxShadow: run.threat >= 80 ? "0 0 8px rgba(248,113,113,0.55)" : undefined,
                                        }}>
                                            <div style={{ width: `${run.threat}%`, height: "100%", background: run.threat >= 80 ? "linear-gradient(90deg,#a855f7,#fda4af)" : "linear-gradient(90deg,#7c3aed,#a855f7)" }} />
                                        </div>
                                        <style>{`@keyframes hgPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
                                    </div>
                                    <div className="hg-resource-belt" style={{ fontSize: 13 }}>
                                        <span className="hg-resource" role="group" aria-label={`Shrine Keys: ${formatExact(run.keys)}`} title={`Shrine Keys: ${formatExact(run.keys)}`}><GameArtIcon kind="key" size={22} /><b>{formatCompact(run.keys)}</b><small>Keys</small></span>
                                        <span className="hg-resource" title="Torch of Reiki"><GameArtIcon kind="elementFire" size={22} /><b>{run.torch}/10</b><small>Torch</small></span>
                                        <span className="hg-resource" role="group" aria-label={`Banked Hollow Shards: ${formatExact(character.hollowShards)}`} title={`Banked Hollow Shards: ${formatExact(character.hollowShards)}`}><GameArtIcon kind="fateShard" size={22} /><b>{formatCompact(character.hollowShards)}</b><small>Shards</small></span>
                                        {(ryoAtRisk > 0 || shardsAtRisk > 0) && <span className="hg-resource-risk"
                                            title={`Lost if you die now: ${[ryoAtRisk ? `${formatExact(ryoAtRisk)} ryo` : '', shardsAtRisk ? `${formatExact(shardsAtRisk)} Hollow Shards` : ''].filter(Boolean).join(' · ')}. Sanctify Loot to protect it.`}>
                                            <GameArtIcon kind="warning" size={15} /> {[ryoAtRisk ? `${formatCompact(ryoAtRisk)} ryo` : '', shardsAtRisk ? `${formatCompact(shardsAtRisk)} Hollow Shards` : ''].filter(Boolean).join(' · ')} at risk
                                        </span>}
                                    </div>
                                </div>
                            </div>

                            <ol className="underground-depths" aria-label="Hollow Gate depths">
                                {Array.from({ length: maxFloor }, (_, i) => <li key={i} aria-current={run.floor === i + 1 ? 'step' : undefined}
                                    data-depth-state={i + 1 < run.floor ? 'traversed' : i + 1 === run.floor ? 'current' : 'ahead'}>
                                    <span className="underground-depths__number" aria-hidden="true">{i + 1}</span>
                                    <span className="underground-depths__name"><small>{i + 1 < run.floor ? 'Traversed' : i + 1 === run.floor ? 'Current depth' : `Depth ${i + 1}`}</small>{(isQuestRift ? hollowGateRiftFloorProfile(i + 1, maxFloor, bossName) : hollowGateFloorProfile(i + 1)).name}</span>
                                </li>)}
                            </ol>
                            <details className="hg-floor-notes"><summary><span className="hg-floor-notes__epithet">{floorProfile.epithet} · </span>{isQuestRift ? 'Rift lore & guardian intel' : 'Cave lore & hound intel'}</summary>
                            <section className="hg-floor-identity" aria-label={`Floor ${run.floor}: ${floorProfile.name}`}>
                                <div className="hg-floor-identity__seal" aria-hidden="true">{run.floor}</div>
                                <div className="hg-floor-identity__story">
                                    <strong>{floorProfile.epithet}</strong>
                                    <span>{floorProfile.atmosphere}</span>
                                    <small>{floorProfile.lore}</small>
                                </div>
                                <div className="hg-floor-identity__hound">
                                    <span>{isQuestRift ? 'RIFT GUARDIAN' : 'HOUND SIGNATURE'}</span>
                                    <strong>{floorProfile.signature}</strong>
                                    <small>{floorProfile.houndEpithet}</small>
                                </div>
                            </section></details>

                            <div className="hg-layout">
                                {/* Dungeon board: seamless tiles inside the camera viewport.
                                    Room-flood visibility lights the room you're in; explored
                                    tiles stay as a dim map memory; surprise tiles stay
                                    disguised until stepped on. */}
                                {(() => {
                                    // knownSet, cellArt and blockedCells are memoized above the return.
                                    const w = run.width, h = run.height;
                                    const riftLabel = RIFT_DISTORTION_LABEL[run.riftDistortionId ?? ""]?.label ?? "the active distortion";
                                    // A sealed secret passage draws as rock until it is broken open.
                                    const isWallAt = (x: number, y: number) => {
                                        if (x < 0 || y < 0 || x >= w || y >= h) return true;   // outside = solid
                                        const t = run.tiles[y * w + x];
                                        return t.terrain === "wall" || (t.terrain == null && t.kind === "wall") || hollowGateSecretSealed(t);
                                    };
                                    return (
                                 <div className="hg-viewport" ref={viewportRef} style={{ ["--hg-bh" as string]: `${boardH}px` }} aria-label={`Hollow Gate floor ${run.floor} map`}>
                                     <div className="hg-cave-location"><b>{floorProfile.name}</b><span>{run.variant ? run.variant.label || 'Event Rift' : 'Hollow Gate'} · Depth {run.floor} / {maxFloor}</span></div>
                                     <div
                                         key={`${run.runToken ?? 'local'}:${run.floor}`}
                                         className="hg-board"
                                         data-tile-size={tilePx}
                                         role="grid"
                                         aria-label={`Floor ${run.floor} dungeon grid`}
                                         aria-rowcount={h}
                                         aria-colcount={w}
                                         style={{
                                             width: boardW,
                                             height: boardH,
                                             gridTemplateColumns: `repeat(${w}, ${tilePx}px)`,
                                             gridAutoRows: `${tilePx}px`,
                                             transform: `translate3d(${Math.round(camera.x)}px, ${Math.round(camera.y)}px, 0)`,
                                             ["--hg-tile" as string]: `${tilePx}px`,
                                        }}
                                    >
                                    <UndergroundSectorTerrain tiles={terrainTiles} width={w} height={h} known={knownSet} visible={visibleSet} mode="cave" breaches={breachSites} features={run.floorFeatures}
                                        roomArt={roomArt} passageArt={passageArt}
                                        renderWindow={terrainWindow} />
                                    {breachSites.filter(site => site.x >= terrainWindow.left && site.x < terrainWindow.left + terrainWindow.width
                                        && site.y >= terrainWindow.top && site.y < terrainWindow.top + terrainWindow.height
                                        && site.cells.every(index => visibleSet.has(index)))
                                        .map(site => <RiftEnergyOverlay key={site.roomId} site={site} tilePx={tilePx} />)}
                                    {run.tiles.map((tile, i) => {
                                        const x = i % w;
                                        const y = Math.floor(i / w);
                                        const visible = visibleSet.has(i);
                                        const known = knownSet.has(i);
                                        if (!visible && !known) return null;
                                        const isPlayer = x === run.playerX && y === run.playerY;
                                        const isDetourChest = run.detourTileIndex === i;
                                        const isRiftSignal = run.riftSignalTileIndex === i;
                                        const wall = isWallAt(x, y);
                                        const secret = hollowGateSecretSealed(tile);
                                        return <HollowGateCell key={i} i={i} x={x} y={y} tile={tile}
                                            wall={wall} wallFace={wall && !isWallAt(x, y + 1)} visible={visible} known={known} isPlayer={isPlayer} isDest={walkTarget === i}
                                            secret={secret}
                                            fissure={fissures.has(i) ? hollowGateFissureState(fissures.get(i)!, arenaNow) : undefined}
                                            clickable={known && (!wall || secret) && !isPlayer && !blockedCells.has(i)}
                                            isDetourChest={isDetourChest} isRiftSignal={isRiftSignal} roamerOrigin={Boolean(hollowGateWandererOrigin(run.wanderers, i))}
                                            playerName={isPlayer ? character.name : undefined} detourExtraSteps={isDetourChest ? run.detourExtraSteps : undefined}
                                            riftLabel={isRiftSignal ? riftLabel : undefined} art={cellArt} onPick={pickTile} />;
                                    })}
                                    {run.tiles.map((tile, index) => tile.kind === 'npc' && !tile.resolved && visibleSet.has(index)
                                        ? <HollowGateAvatar key={`keeper-${index}`} tileX={index % w} tileY={Math.floor(index / w)} tilePx={tilePx}
                                            avatarImage="/underground/wanderer-medic-v1.webp" name="Shrine Keeper" disposition="friendly"
                                            label="Friendly · One blessing" onSelect={() => onTileClick(index)} /> : null)}
                                    {run.wanderers?.filter(npc => !npc.spent && visibleSet.has(npc.tile)).map(npc => {
                                        const friendly = hollowGateWandererFriendly(npc), name = hollowGateWandererName(npc);
                                        return <HollowGateAvatar key={npc.nodeId} tileX={npc.tile % w} tileY={Math.floor(npc.tile / w)} tilePx={tilePx}
                                            avatarImage={hollowGateWandererArt(npc)} name={name} disposition={friendly ? 'friendly' : 'hostile'}
                                            label={friendly ? 'Friendly · Talk' : npc.hunting ? 'Hostile · Hunting you' : 'Hostile patrol'} onSelect={() => onTileClick(npc.tile)} />;
                                    })}
                                    <HollowGateAvatar
                                        tileX={run.playerX}
                                        tileY={run.playerY}
                                        tilePx={tilePx}
                                        avatarImage={character.avatarImage || sharedAvatarFor(sharedImages, character.name) || cellArt.pickRoleIconImage("you", 0)}
                                        name={character.name}
                                    />
                                    </div>
                                    {fissuresInSight && <div className="hg-arena-note" role="status">Fissures vent spirit fire in a rhythm. Cross a crack once its glow dies down.</div>}
                                </div>
                                    );
                                })()}

                                {/* Side panel */}
                                <details className="hg-sidepanel" onToggle={(event) => setJournalOpen(event.currentTarget.open)}><summary>Floor map &amp; expedition journal</summary><div className="hg-expedition-journal">
                                    {/* Minimap — the explored floor at a glance (the camera stays
                                        close, the minimap keeps the run orientable). One span per
                                        cell, so it is built only while the journal is open. */}
                                    {journalOpen && (() => {
                                        const px = Math.max(3, Math.min(7, Math.floor(200 / run.width)));
                                        return (
                                            <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10 }}>
                                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd", fontSize: 12 }}>Floor Map</h4>
                                                <div className="hg-minimap" style={{ gridTemplateColumns: `repeat(${run.width}, ${px}px)`, gridAutoRows: `${px}px` }}>
                                                    {run.tiles.map((t, i) => {
                                                        const x = i % run.width, y = Math.floor(i / run.width);
                                                        const isYou = x === run.playerX && y === run.playerY;
                                                        const seen = visibleSet.has(i) || t.revealed || t.seen;
                                                        const isWall = t.terrain === "wall" || (t.terrain == null && t.kind === "wall") || hollowGateSecretSealed(t);
                                                        // Explored-only: nothing (not even a Rift signal or an
                                                        // Echo Cache) is marked before the player has seen it.
                                                        const cls = isYou ? "hg-mm-you"
                                                            : !seen ? "hg-mm-dark"
                                                            : run.riftSignalTileIndex === i ? "hg-mm-rift-signal"
                                                            : run.detourTileIndex === i ? "hg-mm-detour"
                                                            : isWall ? "hg-mm-wall"
                                                            : t.kind === "descend" || t.kind === "boss" ? "hg-mm-goal"
                                                            : t.kind === "exit" ? "hg-mm-exit"
                                                            : visibleSet.has(i) ? "hg-mm-lit"
                                                            : "hg-mm-floor";
                                                        return <span key={i} className={cls} />;
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* Objectives panel — updates as the run progresses. */}
                                    {run.detourTileIndex != null && <div className="hg-detour-card" role="note">
                                        <b>Optional Echo Cache</b>
                                        <span>Side route adds about {run.detourExtraSteps ?? 0} steps over the direct route. It uses the floor’s standard chest contents; the main route stays open if you skip it.</span>
                                    </div>}
                                    {run.riftDistortionId && RIFT_DISTORTION_LABEL[run.riftDistortionId] && <div className="hg-rift-card" role="note">
                                        <b>This week’s Rift distortion · {RIFT_DISTORTION_LABEL[run.riftDistortionId].label}</b>
                                        <span>{RIFT_DISTORTION_LABEL[run.riftDistortionId].detail} Watch for its signal mark as you explore. The Rift’s boss, daily offer and rewards stay the same.</span>
                                    </div>}
                                    {(() => {
                                        const maxFloor = hollowGateRunMaxFloor(run);
                                        const reachedFinalFloor = run.floor >= maxFloor;
                                        const alphaDefeated = Boolean(run.completed) || run.tiles.some(t => t.kind === "boss" && t.resolved);
                                        const hiddenChamberFound = run.tiles.some(t => t.kind === "shrine" && t.resolved);
                                        const objectives = [
                                            ...(maxFloor > 1 ? [{ label: `Reach Floor ${maxFloor}`, done: reachedFinalFloor }] : []),
                                            { label: `Defeat ${hollowGateBossDisplayName(run)}`, done: alphaDefeated },
                                            { label: "Find a Hidden Chamber (optional)", done: hiddenChamberFound },
                                        ];
                                        return (
                                            <div style={nativePresentationStyle2}>
                                                <h4 style={nativePresentationStyle3}>Objectives</h4>
                                                {objectives.map((obj, i) => (
                                                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                                                        <span style={{ color: obj.done ? "#86efac" : "#fda4af" }}>{obj.done ? "✓" : "○"}</span>
                                                        <span style={{ textDecoration: obj.done ? "line-through" : undefined, color: obj.done ? "#86efac" : "#e9d5ff" }}>{obj.label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    <div style={nativePresentationStyle2}>
                                        <h4 style={nativePresentationStyle3}>Map Legend</h4>
                                        {/* Legend uses the same atlas icon as the dungeon when the admin
                                            assigned one via the Atlas Tile Picker. Falls back to the
                                            matching painted game art otherwise. The
                                            "wall" slot uses the room-floor/wall atlas tile instead since
                                            walls render as terrain, not an icon. */}
                                        {(() => {
                                            // Map slot id → themed fallback art. Keeps the legend self-contained.
                                            const fallbackArt: Record<string, GameArtIconKind> = {
                                                you: "roleDefender", battle: "attack", elite: "roleAssassin", boss: "attack", trap: "warning",
                                                chest: "reward", shrine: "gate", story: "scroll", pet: "petTamer", petbattle: "petTamer",
                                                tilegame: "dice", npc: "healer", descend: "worldMap", exit: "worldMap", locked: "key", wall: "biomeCentral",
                                            };
                                            // Walls use the atlas wall tile (terrain), not an icon slot.
                                            const wallTileImg: string | undefined = undefined; // walls are part of the painted floor
                                            // Legend picks any-variant: shrine:icon-<role>-1 first, then
                                            // shrine:icon-<role>-2..N, then the legacy un-suffixed key.
                                            // This way the legend reflects "an assignment exists" without
                                            // caring which specific variant the admin filled.
                                            const anyAssignedVariant = (role: string): string | undefined => {
                                                const cfg = HOLLOW_GATE_ICON_ROLES[role];
                                                if (cfg && cfg.count > 1) {
                                                    for (let i = 1; i <= cfg.count; i += 1) {
                                                        const v = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                                                        if (v) return v;
                                                    }
                                                }
                                                return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                            };
                                            const legendCell = (slotId: string, label: string) => {
                                                const img = slotId === "wall" ? wallTileImg : anyAssignedVariant(slotId);
                                                return (
                                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        {img ? (
                                                            <img src={img} alt="" style={{ width: 18, height: 18, objectFit: "contain", imageRendering: "pixelated" }} />
                                                        ) : (
                                                            <GameArtIcon kind={fallbackArt[slotId] ?? "warning"} size={18} />
                                                        )}
                                                        <span>{label}</span>
                                                    </span>
                                                );
                                            };
                                            // Discovered-only, like the floor map: a kind joins the legend once
                                            // the player has found one (surprise tiles once they were stepped on).
                                            const surprise = new Set(["trap", "battle", "elite", "pet_event", "pet_battle"]);
                                            const found = new Set<string>();
                                            run.tiles.forEach((t, i) => { if (knownSet.has(i) && (!surprise.has(t.kind) || t.revealed)) found.add(t.kind); });
                                            const entries: Array<[string, string]> = [
                                                ["battle", isQuestRift ? "Encounter" : "Hollow Hound"], ["elite", isQuestRift ? "Elite" : "Elite Hound"],
                                                ["boss", isQuestRift ? bossName : "Alpha Hound"], ["trap", "Trap"], ["chest", "Chest"], ["shrine", "Shrine"],
                                                ["story", "Story"], ["npc", "Keeper"], ["descend", "Descend"], ["exit", "Leave"], ["locked", "Locked Door"],
                                            ];
                                            return (
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                                    {legendCell("you", "You")}
                                                    {entries.filter(([kind]) => found.has(kind)).map(([kind, label]) => <span key={kind} style={{ display: "contents" }}>{legendCell(kind, label)}</span>)}
                                                </div>
                                            );
                                        })()}
                                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "#a78bfa" }}>
                                            Every room has a purpose: guarded stairs, a sealed treasury, a keeper's alcove. Fights hold the doorways. Some walls are cracked: walk into one to break through.
                                        </div>
                                    </div>
                                    <div style={nativePresentationStyle2}>
                                        <h4 style={nativePresentationStyle3}>Active Pet</h4>
                                        {pet ? (
                                            <>
                                                <div><strong>{pet.name}</strong> · Lv. {pet.level}</div>
                                                <div style={{ color: petEligible ? "#86efac" : "#fda4af" }}>
                                                    {petEligible ? "Available for Hollow Hound duels" : isPetOnExpedition(pet) ? "On expedition" : "Not PvE-ready (needs Lv. 50)"}
                                                </div>
                                            </>
                                        ) : <div className="hint">No active pet selected.</div>}
                                    </div>
                                </div></details>
                            </div>

                            {/* Movement and always-available recovery controls. */}
                            <div className="hg-controls" style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 12, color: "#c4b5fd" }}>Tap a tile to walk there · WASD / arrows step · or:</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 4 }}>
                                    <div />
                                    <button aria-label="Move up" onClick={() => moveHollowGatePlayer(0, -1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▲</button>
                                    <div />
                                    <button aria-label="Move left" onClick={() => moveHollowGatePlayer(-1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>◀</button>
                                    <div />
                                    <button aria-label="Move right" onClick={() => moveHollowGatePlayer(1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▶</button>
                                    <div />
                                    <button aria-label="Move down" onClick={() => moveHollowGatePlayer(0, 1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▼</button>
                                    <div />
                                </div>
                                {/* Never disabled: this must stay clickable even while an
                                    ordinary leave is settling, or a stalled request traps the run. */}
                                <button
                                    className="danger-button"
                                    type="button"
                                    onClick={onEmergencyForfeit}
                                    title="Ends the run as a defeat. Use this if the run or an encounter is stuck."
                                >
                                    {exitPending ? "Settling run…" : "Emergency forfeit"}
                                </button>
                            </div>

                            <details className="hg-run-tools"><summary>Hollow Shard relics &amp; event log</summary>
                            <HollowGateShardBar run={run} character={character} currentScope={currentConsumableScope} setRun={setHollowGateRun} onVersionedCharacter={onVersionedCharacter} pushLog={pushHollowGateLog} />

                            {/* Event log */}
                            <div role="log" aria-live="polite" aria-relevant="additions" style={{ marginTop: 12, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 8, padding: 10, maxHeight: 140, overflowY: "auto", fontSize: 13 }}>
                                <h4 style={nativePresentationStyle3}>Event Log</h4>
                                {hollowGateLog.length === 0 ? <p className="hint">The shrine watches in silence.</p> : hollowGateLog.map((line, i) => (
                                    <p key={i} style={{ margin: "2px 0" }}>• {line}</p>
                                ))}
                            </div>

                            </details>
                            {/* Event modal overlay — shows a generated tile image header
                                when the relevant 'shrine:tile-*' key has art. */}
                            {hollowGateEvent && (() => {
                                const tileImageKey =
                                    hollowGateEvent.kind === "trap" ? "shrine:tile-trap"
                                    : hollowGateEvent.kind === "chest" ? "shrine:tile-ancient-chest"
                                    : hollowGateEvent.kind === "pet_event" ? "shrine:tile-pet-encounter"
                                    : hollowGateEvent.kind === "pet_battle" ? "shrine:tile-hollow-beast"
                                    : hollowGateEvent.kind === "tile_game" ? "shrine:tile-tile-game"
                                    : hollowGateEvent.kind === "locked" ? "shrine:tile-sealed-door"
                                    : hollowGateEvent.kind === "npc" ? "shrine:tile-shrine-keeper"
                                    : hollowGateEvent.kind === "story" ? "shrine:tile-story"
                                    : hollowGateEvent.kind === "battle" || hollowGateEvent.kind === "elite" || hollowGateEvent.kind === "boss" ? "shrine:tile-hollow-beast"
                                    : null;
                                const tileImage = hollowGateEvent.image || (tileImageKey ? sharedImages[tileImageKey] : null);
                                if (hollowGateEvent.presentation === "boss-victory") {
                                    return (
                                        <HollowGateBossCinematic
                                            mode="victory"
                                            eyebrow={hollowGateEvent.eyebrow || "SHRINE RECLAIMED"}
                                            title={hollowGateEvent.title}
                                            body={hollowGateEvent.body}
                                            image={hollowGateEvent.image || HOLLOW_GATE_ALPHA_CINEMATIC}
                                            actionLabel={hollowGateEvent.choices[0]?.label || "Take final rewards + leave"}
                                            onContinue={() => hollowGateEvent.choices[0]?.onSelect()}
                                            onEmergencyForfeit={onEmergencyForfeit}
                                            exitPending={exitPending}
                                        />
                                    );
                                }
                                return (
                                    <HollowGateEventDialog titleId="hg-event-title" busy={hollowGateEvent.pending || exitPending} onDismiss={hollowGateEvent.onDismiss}>
                                            {tileImage && (
                                                <img src={tileImage} alt={hollowGateEvent.title} style={{ width: "100%", height: 180, objectFit: "contain", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <h3 id="hg-event-title" style={nativePresentationStyle1}>{hollowGateEvent.title}</h3>
                                            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{hollowGateEvent.body}</p>
                                            {hollowGateEvent.error && <p role="alert" className="hg-event-error">{hollowGateEvent.error}</p>}
                                            {hollowGateEvent.pending && <p role="status" className="hg-event-pending">{hollowGateEvent.kind === 'descend' ? 'Opening the staircase.' : 'Receiving gift…'}</p>}
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                                                {hollowGateEvent.choices.map((c, i) => (
                                                    <button key={i} autoFocus={i === 0} disabled={hollowGateEvent.pending || exitPending} className={c.tone === "danger" ? "danger-button" : ""} onClick={c.onSelect}>{c.label}</button>
                                                ))}
                                            </div>
                                            <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(248,113,113,0.25)" }}>
                                                <button
                                                    className="danger-button"
                                                    type="button"
                                                    disabled={exitPending}
                                                    onClick={onEmergencyForfeit}
                                                    title="Ends the run as a defeat if this encounter cannot continue."
                                                >
                                                    {exitPending ? "Settling run…" : "Emergency forfeit run"}
                                                </button>
                                            </div>
                                    </HollowGateEventDialog>
                                );
                            })()}

                            {/* Hidden Chamber overlay — wears the chamber background art if generated. */}
                            {hollowGateHiddenChamber && (() => {
                                const chamberBg = sharedImages["shrine:hidden-chamber-background"];
                                const chamberStyle = chamberBg
                                    ? `linear-gradient(180deg, rgba(30,15,50,0.82), rgba(15,5,30,0.92)), url(${chamberBg}) center/cover no-repeat`
                                    : "linear-gradient(180deg, rgba(30,15,50,0.97), rgba(15,5,30,0.99))";
                                return (
                                <HollowGateEventDialog titleId="hg-hidden-title" busy={exitPending} onDismiss={onCloseHiddenChamber} style={{ background: chamberStyle, width: "min(620px, calc(100vw - 24px))" }}>
                                        <p className="act-label" style={nativePresentationStyle0}>HIDDEN CHAMBER</p>
                                        <h2 id="hg-hidden-title" style={nativePresentationStyle1}>Secret Area Discovered</h2>
                                        <p style={{ lineHeight: 1.6 }}>A ritual circle pulses violet at the chamber's center. Spirit lanterns hover above a cracked altar. An ancient tablet hums with sealed chakra, and a shrine relic floats untouched within the seal.</p>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "16px 0", fontSize: 13 }}>
                                            <div style={nativePresentationStyle4}><strong>Shrine Relic</strong><br/>{hollowGateHiddenChamber.relicTaken ? "Claimed" : "Available"}</div>
                                            <div style={nativePresentationStyle4}><strong>Spirit Lantern</strong><br/>Active</div>
                                            <div style={nativePresentationStyle4}><strong>Ancient Tablet</strong><br/>{hollowGateHiddenChamber.searched ? "Read" : "Readable"}</div>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                            <button autoFocus={!hollowGateHiddenChamber.searched} disabled={hollowGateHiddenChamber.searched} onClick={() => { playGameSfx("paper", { gain: 0.72 }); onSearchHiddenChamber(); }}><GameArtIcon kind="map" size={16} /> Search chamber</button>
                                            <button disabled={hollowGateHiddenChamber.relicTaken} onClick={() => { playGameSfx("mythic", { gain: 0.62 }); onTakeHiddenChamberRelic(); }}><GameArtIcon kind="reward" size={16} /> Take relic</button>
                                            <button autoFocus={hollowGateHiddenChamber.searched} onClick={onCloseHiddenChamber} className="danger-button">Return to shrine</button>
                                            <button onClick={onEmergencyForfeit} className="danger-button">
                                                {exitPending ? "Settling run…" : "Emergency forfeit run"}
                                            </button>
                                        </div>
                                </HollowGateEventDialog>
                                );
                            })()}
                        </div>
    );
}

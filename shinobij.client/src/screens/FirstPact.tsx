import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from "react";
import "./FirstPact.css";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import {
    FIRST_PACT_MIN_LEVEL,
    FIRST_PACT_TEAM_SIZE,
    FIRST_PACT_MAIN_ENCOUNTERS,
    FIRST_PACT_VOWS,
    createFirstPactProgress,
    expectedFirstPactMainEncounter,
    expectedFirstPactTournamentEncounter,
    firstPactEncounter,
    firstPactVow,
    type FirstPactEncounterId,
    type FirstPactMainBeat,
    type FirstPactProgress,
    type FirstPactTournamentEncounterId,
} from "../../../shared/first-pact-contract";
import {
    FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING,
    FIRST_PACT_AQUEDUCT_CIVIC_CROSSING,
    FIRST_PACT_ARCHITECTURE,
    FIRST_PACT_BELL_PLANTING_BEDS,
    FIRST_PACT_CITY_PROPS,
    FIRST_PACT_GARDENS_AQUEDUCT,
    FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS,
    FIRST_PACT_GARDENS_NORTH_TREES,
    FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS,
    FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS,
    FIRST_PACT_HIGH_COURT_GARDEN_BEDS,
    FIRST_PACT_HIGH_COURT_PARAPET,
    FIRST_PACT_KENNEL_STRUCTURES,
    FIRST_PACT_NPCS,
    FIRST_PACT_PLAYER_START,
    FIRST_PACT_TILE_SIZE,
    FIRST_PACT_WORLD_HEIGHT,
    FIRST_PACT_WORLD_WIDTH,
    FirstPactTile,
    chooseFirstPactWanderDestination,
    findFirstPactPath,
    firstPactDistrictAt,
    firstPactPointKey,
    firstPactTileAt,
    isFirstPactBellRoute,
    isFirstPactGardensPrimaryRoute,
    isFirstPactGardensSecondaryRoute,
    isFirstPactWalkable,
    isFirstPactWithinReach,
    nearestFirstPactWalkable,
    type FirstPactDirection,
    type FirstPactNpcDefinition,
    type FirstPactPoint,
    type FirstPactRect,
} from "../lib/first-pact-world";
import {
    acceptFirstPactStableQuest,
    advanceFirstPactMain,
    checkpointFirstPact,
    enterFirstPact,
    fetchFirstPactProgress,
} from "../lib/first-pact-api";
import {
    forfeitShowdown,
    fetchShowdownState,
    startFirstPactShowdown,
    submitShowdownTurn,
    type ShowdownCommand,
    type ShowdownStateView,
    type ShowdownTurnResponse,
} from "../lib/pet-showdown-api";
import { PetShowdownBattle } from "../components/PetShowdownBattle";
import { activeCarriedPetIds } from "../lib/entitlements";
import { activeClientBreedingParentIds } from "../lib/pet-breeding";
import { isPetAvailableForColosseum } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { warmShowdownModels } from "../lib/pet-model-preload";
import sunkenCourtKeyArt from "../assets/first-pact/sunken-court-key-art.webp";
import sunkenCourtArchitectureAtlas from "../assets/first-pact/sunken-court-architecture-atlas.webp";
import bellQuarterArchitectureV2 from "../assets/first-pact/bell-quarter-v2/bell-quarter-architecture-strip.png";
import valeStableV3 from "../assets/first-pact/v3-architecture/v3-vale-stable.png";
import stableTackAnnexV3 from "../assets/first-pact/v3-architecture/v3-stable-tack-annex.png";
import handlerLodgeV3 from "../assets/first-pact/v3-architecture/v3-handler-lodge.png";
import kennelInfirmaryV3 from "../assets/first-pact/v3-architecture/v3-kennel-infirmary.png";
import kennelHouseV3 from "../assets/first-pact/v3-architecture/v3-kennel-service-house.png";
import feedStoreV3 from "../assets/first-pact/v3-architecture/v3-feed-store-temporary.png";
import kennelPavilionV3 from "../assets/first-pact/v3-architecture/v3-kennel-pavilion.png";
import bondingCedarV3 from "../assets/first-pact/v3-architecture/v3-bonding-cedar.png";
import highCourtMainArchiveV3 from "../assets/first-pact/high-court-v3/high-court-main-archive.png";
import highCourtRecordHallV3 from "../assets/first-pact/high-court-v3/high-court-record-hall.png";
import highCourtCouncilAnnexV3 from "../assets/first-pact/high-court-v3/high-court-council-annex.png";
import highCourtGardenStripV3 from "../assets/first-pact/high-court-v3/high-court-garden-strip.png";
import gardenLodgeV2 from "../assets/first-pact/gardens-north-v2/garden-lodge.png";
import guardianHallV2 from "../assets/first-pact/gardens-north-v2/guardian-hall.png";
import gardenCourtPavilionV2 from "../assets/first-pact/gardens-north-v2/garden-court-pavilion.png";
import gardenCourtFountainV2 from "../assets/first-pact/gardens-north-v2/garden-court-fountain.png";
import gardenCourtKaioTreeV2 from "../assets/first-pact/gardens-north-v2/garden-court-kaio-tree.png";
import gardenCourtListeningBenchV2 from "../assets/first-pact/gardens-north-v2/garden-court-listening-bench.png";
import gardensNorthMapleA from "../assets/first-pact/gardens-north-v2/autumn-maple-a.png";
import gardensNorthMapleB from "../assets/first-pact/gardens-north-v2/autumn-maple-b.png";
import gardensNorthBedLong from "../assets/first-pact/gardens-north-v2/bed-long.png";
import gardensNorthBedCorner from "../assets/first-pact/gardens-north-v2/bed-corner.png";
import marketArcadeV2 from "../assets/first-pact/market-v2/market-walkthrough-arcade-v2.png";
import engineHallGw from "../assets/first-pact/gateworks-v2/engine-hall.png";
import arrivalGateGw from "../assets/first-pact/gateworks-v2/arrival-gate.png";
import boundaryLanternGw from "../assets/first-pact/gateworks-v2/boundary-lantern.png";
import boundarySteleGw from "../assets/first-pact/gateworks-v2/boundary-stele.png";
import pumpHouseGw from "../assets/first-pact/gateworks-v2/pump-house.png";
import keeperRowhouseGw from "../assets/first-pact/gateworks-v2/keeper-rowhouse.png";
import maintenanceShedGw from "../assets/first-pact/gateworks-v2/maintenance-shed.png";
import valveHouseGw from "../assets/first-pact/gateworks-v2/valve-house.png";
import marketStallV2 from "../assets/first-pact/market-v2/market-stall-module-v2.png";
import marketRowhouseV2 from "../assets/first-pact/market-v2/market-merchant-rowhouse-v2.png";
import marketWorkshopV2 from "../assets/first-pact/market-v2/market-waterside-workshop-v2.png";
import sunkenCourtColosseum from "../assets/first-pact/sunken-court-colosseum.webp";
import sunkenCourtStreetProps from "../assets/first-pact/sunken-court-street-props.webp";
import sunkenCourtTileAtlas from "../assets/first-pact/sunken-court-tile-atlas.webp";
import senaPortrait from "../assets/first-pact/portraits/sena-vale.webp";
import orinPortrait from "../assets/first-pact/portraits/registrar-orin.webp";
import veyPortrait from "../assets/first-pact/portraits/scribe-vey.webp";
import tamPortrait from "../assets/first-pact/portraits/engineer-tam.webp";
import isuPortrait from "../assets/first-pact/portraits/bellwarden-isu.webp";
import kaioPortrait from "../assets/first-pact/portraits/old-kaio.webp";
import rhoPortrait from "../assets/first-pact/portraits/feed-merchant-rho.webp";
import pellPortrait from "../assets/first-pact/portraits/stable-hand-pell.webp";
import nemiPortrait from "../assets/first-pact/portraits/court-courier-nemi.webp";
import yoriPortrait from "../assets/first-pact/portraits/market-runner-yori.webp";

type RuntimeNpc = {
    position: FirstPactPoint;
    facing: FirstPactDirection;
    path: FirstPactPoint[];
    wait: number;
    cycle: number;
};

type Camera = { x: number; y: number; width: number; height: number };

type FirstPactWorldArt = {
    tileAtlas?: HTMLImageElement | null;
    architectureAtlas?: HTMLImageElement | null;
    bellQuarterAtlas?: HTMLImageElement | null;
    valeStable?: HTMLImageElement | null;
    stableTackAnnex?: HTMLImageElement | null;
    handlerLodge?: HTMLImageElement | null;
    kennelInfirmary?: HTMLImageElement | null;
    kennelHouse?: HTMLImageElement | null;
    feedStore?: HTMLImageElement | null;
    kennelPavilion?: HTMLImageElement | null;
    bondingCedar?: HTMLImageElement | null;
    highCourtMainArchive?: HTMLImageElement | null;
    highCourtRecordHall?: HTMLImageElement | null;
    highCourtCouncilAnnex?: HTMLImageElement | null;
    highCourtGardens?: HTMLImageElement | null;
    gardenLodge?: HTMLImageElement | null;
    guardianHall?: HTMLImageElement | null;
    gardenCourtPavilion?: HTMLImageElement | null;
    gardenCourtFountain?: HTMLImageElement | null;
    gardenCourtKaioTree?: HTMLImageElement | null;
    gardenCourtListeningBench?: HTMLImageElement | null;
    gardensNorthMapleA?: HTMLImageElement | null;
    gardensNorthMapleB?: HTMLImageElement | null;
    gardensNorthBedLong?: HTMLImageElement | null;
    gardensNorthBedCorner?: HTMLImageElement | null;
    marketArcade?: HTMLImageElement | null;
    engineHall?: HTMLImageElement | null;
    arrivalGate?: HTMLImageElement | null;
    boundaryLantern?: HTMLImageElement | null;
    boundaryStele?: HTMLImageElement | null;
    pumpHouse?: HTMLImageElement | null;
    keeperRowhouse?: HTMLImageElement | null;
    maintenanceShed?: HTMLImageElement | null;
    valveHouse?: HTMLImageElement | null;
    marketStall?: HTMLImageElement | null;
    marketRowhouse?: HTMLImageElement | null;
    marketWorkshop?: HTMLImageElement | null;
    colosseum?: HTMLImageElement | null;
    propsAtlas?: HTMLImageElement | null;
    /** Deterministic preview-only framing for an independently judged district crop. */
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full";
};

type FirstPactSettlement = ShowdownTurnResponse & {
    firstPact?: {
        encounterId: FirstPactEncounterId;
        progress: FirstPactProgress;
        advanced: boolean;
    };
};

type DialogueAction =
    | { kind: "stable-accept" }
    | { kind: "stable-battle"; encounterId: FirstPactTournamentEncounterId }
    | { kind: "main-beat"; beat: FirstPactMainBeat; label: string }
    | { kind: "main-battle"; encounterId: FirstPactEncounterId; label: string };

type FirstPactDialogue = {
    lines: string[];
    action?: DialogueAction;
    choices?: readonly { label: string; beat: FirstPactMainBeat }[];
};

const FIRST_PACT_SESSION_KEY = "first-pact.showdown.v1";
const FIRST_PACT_SESSION_TTL_MS = 45 * 60 * 1000;
type FirstPactSessionBreadcrumb = { sessionId: string; encounterId: FirstPactEncounterId; petIds: string[]; playerName: string };

function readFirstPactSession(playerName: string): FirstPactSessionBreadcrumb | null {
    try {
        const raw = localStorage.getItem(FIRST_PACT_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.playerName !== playerName || typeof parsed.sessionId !== "string" || !Array.isArray(parsed.petIds)) return null;
        if (Date.now() - Number(parsed.savedAt ?? 0) > FIRST_PACT_SESSION_TTL_MS) return null;
        const encounter = firstPactEncounter(parsed.encounterId);
        if (!encounter) return null;
        const petIds = parsed.petIds.map(String).slice(0, FIRST_PACT_TEAM_SIZE);
        if (petIds.length !== FIRST_PACT_TEAM_SIZE || new Set(petIds).size !== FIRST_PACT_TEAM_SIZE) return null;
        return { playerName, sessionId: parsed.sessionId, encounterId: encounter.id, petIds };
    } catch {
        return null;
    }
}

function writeFirstPactSession(value: FirstPactSessionBreadcrumb | null): void {
    try {
        if (value) localStorage.setItem(FIRST_PACT_SESSION_KEY, JSON.stringify({ ...value, savedAt: Date.now() }));
        else localStorage.removeItem(FIRST_PACT_SESSION_KEY);
    } catch { /* Storage may be disabled; the server session remains authoritative. */ }
}

const DISTRICT_LABELS: Record<ReturnType<typeof firstPactDistrictAt>, string> = {
    "arrival-court": "Arrival Court",
    "grand-colosseum": "Grand Colosseum",
    "kennel-ward": "Kennel Ward",
    "market-scriptorium": "Market & Scriptorium",
    "high-court": "High Court",
    "bell-quarter": "Bell Quarter",
    "guardian-gardens": "Guardian Gardens",
    aqueduct: "The Aqueduct",
    gateworks: "Gateworks",
};

const NPC_PORTRAITS: Readonly<Record<string, string>> = {
    "keeper-sena": senaPortrait,
    "registrar-orin": orinPortrait,
    "scribe-vey": veyPortrait,
    "engineer-tam": tamPortrait,
    "bellwarden-isu": isuPortrait,
    "garden-keeper": kaioPortrait,
    "market-rho": rhoPortrait,
    "kennel-hand": pellPortrait,
    "court-courier": nemiPortrait,
    "market-runner": yoriPortrait,
};

const TILE_PALETTE: Record<FirstPactTile, { base: string; edge: string; detail: string }> = {
    [FirstPactTile.Void]: { base: "#040813", edge: "#08111e", detail: "#0b1b29" },
    [FirstPactTile.Stone]: { base: "#273141", edge: "#151d2b", detail: "#3b4658" },
    [FirstPactTile.Road]: { base: "#3b4147", edge: "#1d242e", detail: "#716347" },
    [FirstPactTile.Grass]: { base: "#17372f", edge: "#0c211d", detail: "#2d5a45" },
    [FirstPactTile.Water]: { base: "#083a4d", edge: "#041e2e", detail: "#2ca7b9" },
    [FirstPactTile.Bridge]: { base: "#63523c", edge: "#2f271f", detail: "#b18b55" },
    [FirstPactTile.Roof]: { base: "#101a28", edge: "#070c13", detail: "#8a6a3f" },
    [FirstPactTile.Wall]: { base: "#1b2431", edge: "#090f18", detail: "#4c5869" },
    [FirstPactTile.Arena]: { base: "#705a3d", edge: "#3f3020", detail: "#ba9154" },
    [FirstPactTile.Market]: { base: "#4b3839", edge: "#251a20", detail: "#b36c55" },
    [FirstPactTile.Kennel]: { base: "#3e342a", edge: "#211a16", detail: "#806a4e" },
    [FirstPactTile.Grate]: { base: "#152f36", edge: "#06171d", detail: "#21a6a8" },
    [FirstPactTile.Stairs]: { base: "#4a4b4a", edge: "#20252c", detail: "#8b7b5e" },
    [FirstPactTile.Garden]: { base: "#183d38", edge: "#0a1f1d", detail: "#4f8069" },
    [FirstPactTile.Court]: { base: "#35404c", edge: "#18202a", detail: "#a1824c" },
};

// Kennel Ward and the surrounding civic shelf are one street plane. Keeping
// this grid shared makes material changes land on whole, world-aligned stones
// instead of exposing the tile rectangle beneath the ward.
const CIVIC_STONE_PAVERS = {
    colors: ["#202a34", "#242e38", "#27313a"] as const,
    mortar: "#101821",
    width: 34,
    height: 22,
    salt: 281,
} as const;

function isGardensPublicCourtTile(x: number, y: number): boolean {
    return FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS.some(({ bounds }) => (
        x >= bounds.x
        && x < bounds.x + bounds.width
        && y >= bounds.y
        && y < bounds.y + bounds.height
    ));
}

/** Warm, globally aligned stone gives the south court an authored civic plane.
 * There is deliberately no perimeter stroke or filled sprite beneath it: the
 * stepped world cells dissolve directly into the older shelf masonry. */
function drawGardensPublicCourtPavers(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
): void {
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        ["#444b4e", "#4b5051", "#3d464a", "#505354"],
        "#252d32",
        29,
        18,
        3181,
    );
    if (terrainHash(x, y, 3203) < .62) return;
    context.save();
    context.fillStyle = terrainHash(y, x, 3221) > .58
        ? "rgba(190, 111, 43, .34)"
        : "rgba(74, 104, 69, .28)";
    context.beginPath();
    context.ellipse(
        screenX + 7 + terrainHash(x, y, 3251) * 34,
        screenY + 8 + terrainHash(y, x, 3271) * 31,
        2.4,
        1.05,
        terrainHash(x, y, 3299) * Math.PI,
        0,
        Math.PI * 2,
    );
    context.fill();
    context.restore();
}

function drawTile(
    context: CanvasRenderingContext2D,
    tile: FirstPactTile,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    _atlas?: HTMLImageElement | null,
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full",
): void {
    const highCourtGutter = architectureScope === "high-court"
        && y >= 1
        && y <= 18
        && ((x >= 55 && x <= 58) || (x === 30 && tile === FirstPactTile.Water));
    if (highCourtGutter && tile !== FirstPactTile.Road && tile !== FirstPactTile.Bridge && tile !== FirstPactTile.Stairs) {
        drawDistrictPavers(context, FirstPactTile.Court, x, y, screenX, screenY);
        return;
    }
    if (tile === FirstPactTile.Void) {
        const mote = Math.abs((x * 37) + (y * 53)) % 47;
        if (mote === 0) {
            context.fillStyle = "rgba(74, 184, 196, .1)";
            context.fillRect(screenX + 8 + (x % 5) * 6, screenY + 10 + (y % 4) * 7, 1.5, 1.5);
        }
        return;
    }
    if (isCanalCrossingTile(x, y)) {
        drawBridgeDeck(context, x, y, screenX, screenY, architectureScope);
        return;
    }

    switch (tile) {
        case FirstPactTile.Road:
        case FirstPactTile.Bridge:
            drawRoadPavers(context, x, y, screenX, screenY, architectureScope);
            return;
        case FirstPactTile.Water:
            drawCanalWater(context, x, y, screenX, screenY);
            return;
        case FirstPactTile.Stairs:
            drawIntegratedStairs(context, x, y, screenX, screenY);
            return;
        case FirstPactTile.Grass:
        case FirstPactTile.Garden:
            drawLivingGround(context, tile, x, y, screenX, screenY);
            return;
        case FirstPactTile.Kennel:
            drawKennelGround(context, x, y, screenX, screenY);
            return;
        case FirstPactTile.Market:
            drawMarketGround(context, x, y, screenX, screenY);
            return;
        case FirstPactTile.Grate:
            drawServiceStone(context, x, y, screenX, screenY);
            return;
        case FirstPactTile.Court:
            if (isGardensPublicCourtTile(x, y)) {
                drawGardensPublicCourtPavers(context, x, y, screenX, screenY);
                return;
            }
            drawDistrictPavers(context, tile, x, y, screenX, screenY);
            return;
        case FirstPactTile.Roof:
            drawRoofField(context, x, y, screenX, screenY);
            return;
        default:
            drawDistrictPavers(context, tile, x, y, screenX, screenY);
    }
}

function terrainHash(x: number, y: number, salt = 0): number {
    let value = (Math.imul(x + 101 + salt, 374761393) + Math.imul(y + 313 - salt, 668265263)) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fillTerrainTile(context: CanvasRenderingContext2D, screenX: number, screenY: number, color: string): void {
    context.fillStyle = color;
    context.fillRect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
}

function drawGlobalPavers(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    colors: readonly string[],
    mortar: string,
    paverWidth: number,
    paverHeight: number,
    salt: number,
): void {
    const size = FIRST_PACT_TILE_SIZE;
    const worldLeft = x * size;
    const worldTop = y * size;
    const firstRow = Math.floor(worldTop / paverHeight) - 1;
    const lastRow = Math.ceil((worldTop + size) / paverHeight) + 1;
    context.save();
    context.beginPath();
    context.rect(screenX, screenY, size + 1, size + 1);
    context.clip();
    context.fillStyle = mortar;
    context.fillRect(screenX, screenY, size + 1, size + 1);
    for (let row = firstRow; row <= lastRow; row += 1) {
        const globalY = row * paverHeight;
        const offset = (Math.abs(row) % 2) * Math.floor(paverWidth / 2);
        const firstColumn = Math.floor((worldLeft - offset) / paverWidth) - 1;
        const lastColumn = Math.ceil((worldLeft + size - offset) / paverWidth) + 1;
        for (let column = firstColumn; column <= lastColumn; column += 1) {
            const globalX = column * paverWidth + offset;
            const colorIndex = Math.floor(terrainHash(column, row, salt) * colors.length) % colors.length;
            context.fillStyle = colors[colorIndex];
            context.fillRect(
                screenX + globalX - worldLeft + 1,
                screenY + globalY - worldTop + 1,
                paverWidth - 2,
                paverHeight - 2,
            );
            if (terrainHash(column, row, salt + 17) > 0.84) {
                context.strokeStyle = "rgba(167, 132, 79, .13)";
                context.lineWidth = 1;
                context.beginPath();
                context.moveTo(screenX + globalX - worldLeft + 5, screenY + globalY - worldTop + paverHeight - 5);
                context.lineTo(screenX + globalX - worldLeft + paverWidth - 6, screenY + globalY - worldTop + 5);
                context.stroke();
            }
        }
    }
    context.restore();
}

function isPrimaryRoadTile(x: number, y: number): boolean {
    return (y >= 27 && y <= 30 && x >= 3 && x <= 80)
        || (x >= 40 && x <= 44 && y >= 3 && y <= 52);
}

function isMarketLaneTile(x: number, y: number): boolean {
    return x >= 56 && x <= 78 && y >= 22 && y <= 39;
}

function isKennelBoulevardTile(x: number, y: number): boolean {
    return x >= 5 && x <= 65 && y >= 43 && y <= 45;
}

function isCanalCrossingTile(x: number, y: number): boolean {
    if (x >= 75 && x <= 76 && y >= 29 && y <= 30) return true;
    // Every Aqueduct crossing is collision-authoritative Bridge world data.
    // The market canal remains the sole legacy Road-backed special case.
    return firstPactTileAt(x, y) === FirstPactTile.Bridge;
}

const KENNEL_BOULEVARD_SHOULDER = {
    colors: CIVIC_STONE_PAVERS.colors,
    dampColors: ["#1f2d31", "#233136", "#1d2a2f", "#263438"] as const,
    mortar: CIVIC_STONE_PAVERS.mortar,
    dampMortar: "#142127",
    width: CIVIC_STONE_PAVERS.width,
    height: CIVIC_STONE_PAVERS.height,
    salt: CIVIC_STONE_PAVERS.salt,
} as const;

/**
 * The collision-authored boulevard remains three tiles wide, but its outer
 * clearance reads as ordinary, moss-softened ward ground. Matching the civic
 * paver grid on either side removes the former full-width platform silhouette.
 */
function drawKennelBoulevardShoulder(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    damp = false,
): void {
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        damp ? KENNEL_BOULEVARD_SHOULDER.dampColors : KENNEL_BOULEVARD_SHOULDER.colors,
        damp ? KENNEL_BOULEVARD_SHOULDER.dampMortar : KENNEL_BOULEVARD_SHOULDER.mortar,
        KENNEL_BOULEVARD_SHOULDER.width,
        KENNEL_BOULEVARD_SHOULDER.height,
        KENNEL_BOULEVARD_SHOULDER.salt,
    );

    // Small, discontinuous blooms keep the shoulder quiet and organic. There
    // is intentionally no edge wash, stripe, curb, or course spanning a tile.
    context.save();
    context.beginPath();
    context.rect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
    context.clip();
    for (let patch = 0; patch < 3; patch += 1) {
        if (terrainHash(x, y, 1069 + patch * 17) < .56) continue;
        const patchX = screenX + 5 + terrainHash(y, x, 1091 + patch * 23) * 38;
        const patchY = screenY + 5 + terrainHash(x, y, 1117 + patch * 29) * 38;
        const radiusX = 5 + terrainHash(x, patch, 1151 + y) * 10;
        const radiusY = 2 + terrainHash(y, patch, 1171 + x) * 5;
        context.fillStyle = damp ? "rgba(35, 83, 77, .16)" : "rgba(46, 76, 55, .14)";
        context.beginPath();
        context.ellipse(patchX, patchY, radiusX, radiusY, terrainHash(patch, x, y) - .5, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function drawRoadPavers(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full",
): void {
    const gardensPrimary = isFirstPactGardensPrimaryRoute(x, y);
    const gardensSecondary = !gardensPrimary && isFirstPactGardensSecondaryRoute(x, y);
    if (gardensPrimary || gardensSecondary) {
        // The hierarchy is the real Road geometry, not a graphic laid over the
        // court. Warm slate and ordinary staggered joints distinguish the two-
        // tile spine from its one-tile branches without a border or route node.
        drawGlobalPavers(
            context,
            x,
            y,
            screenX,
            screenY,
            gardensPrimary
                ? ["#5b5d59", "#63615b", "#555a5a", "#696258"]
                : ["#585b59", "#605f5a", "#51595b", "#645f58"],
            gardensPrimary ? "#373a39" : "#353a39",
            gardensPrimary ? 34 : 30,
            gardensPrimary ? 22 : 18,
            gardensPrimary ? 3611 : 3643,
        );
        return;
    }
    if (isFirstPactBellRoute(x, y) && architectureScope !== "high-court") {
        drawGlobalPavers(
            context,
            x,
            y,
            screenX,
            screenY,
            ["#65706c", "#6d766f", "#596761", "#747a70", "#5f6c68"],
            "#303b38",
            27,
            17,
            1543,
        );
        context.save();
        context.beginPath();
        context.rect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
        context.clip();
        for (let fleck = 0; fleck < 6; fleck += 1) {
            const px = screenX + 3 + terrainHash(x, y, 1571 + fleck * 19) * 42;
            const py = screenY + 3 + terrainHash(y, x, 1601 + fleck * 23) * 42;
            context.fillStyle = fleck % 3 === 0 ? "rgba(184, 112, 48, .48)" : "rgba(42, 83, 57, .52)";
            context.beginPath();
            context.ellipse(px, py, 1.3 + terrainHash(x, fleck, 1627) * 2.3, .8 + terrainHash(y, fleck, 1657) * 1.4, terrainHash(fleck, x, 1669) * Math.PI, 0, Math.PI * 2);
            context.fill();
        }
        context.restore();
        return;
    }
    if (isKennelBoulevardTile(x, y)) {
        drawKennelBoulevardShoulder(context, x, y, screenX, screenY);
        return;
    }
    const primary = isPrimaryRoadTile(x, y) || isMarketLaneTile(x, y);
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        primary ? ["#56616a", "#5c6770", "#505b64", "#616b73"] : ["#424e58", "#48545e", "#3e4a54"],
        primary ? "#353e46" : "#2d3740",
        primary ? 30 : 26,
        primary ? 18 : 16,
        primary ? 41 : 53,
    );
    context.fillStyle = primary ? "rgba(99, 117, 126, .025)" : "rgba(5, 13, 19, .035)";
    context.fillRect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
}

function drawBridgeDeck(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    screenX: number,
    screenY: number,
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full",
): void {
    const centralDeck = x >= FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.x
        && x < FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.x + FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.width
        && y >= FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.y
        && y < FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.y + FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck.height;
    if (centralDeck) {
        // Reuse the boulevard's exact world-aligned paver renderer. Color,
        // dimensions, salt, and joint phase therefore remain identical at both
        // landings instead of resetting on a bridge-only material plate.
        drawRoadPavers(context, x, y, screenX, screenY, architectureScope);
        return;
    }
    const kennelBoulevard = isKennelBoulevardTile(x, y);
    if (kennelBoulevard) {
        drawKennelBoulevardShoulder(context, x, y, screenX, screenY, true);
        return;
    }
    const gardensSecondary = isFirstPactGardensSecondaryRoute(x, y);
    const primary = y >= 27 && y <= 30;
    const marketCanalBridge = x >= 75 && x <= 76 && y >= 29 && y <= 30;
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        gardensSecondary
            ? ["#585b59", "#605f5a", "#51595b", "#645f58"]
            : marketCanalBridge
            ? ["#596064", "#626467", "#535b60"]
            : primary ? ["#5b6264", "#62686a", "#555e61"] : ["#4b5356", "#525a5d", "#464f53"],
        gardensSecondary ? "#353a39" : marketCanalBridge ? "#343c40" : primary ? "#374044" : "#30393d",
        gardensSecondary || primary ? 30 : 26,
        gardensSecondary || primary ? 18 : 16,
        gardensSecondary ? 3643 : 71,
    );
    context.fillStyle = marketCanalBridge ? "rgba(151, 105, 48, .12)" : "rgba(143, 100, 41, .08)";
    context.fillRect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
}

function drawCanalWater(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    const size = FIRST_PACT_TILE_SIZE;
    const marketCanal = x >= 75 && x <= 76;
    const gardensUpperReach = !marketCanal && y >= 3 && y < 27;
    const canalWorldLeft = (marketCanal ? 75 : 28) * size;
    const canalWidth = (marketCanal ? 2 : gardensUpperReach ? 2 : 3) * size;
    const canalLeft = screenX - (x * size - canalWorldLeft);
    const gradient = context.createLinearGradient(canalLeft, 0, canalLeft + canalWidth, 0);
    if (marketCanal) {
        gradient.addColorStop(0, "#071b25");
        gradient.addColorStop(.18, "#0a3441");
        gradient.addColorStop(.48, "#0d5a66");
        gradient.addColorStop(.68, "#0c4b58");
        gradient.addColorStop(1, "#061a24");
    } else {
        gradient.addColorStop(0, "#061a23");
        gradient.addColorStop(.22, "#0a3340");
        gradient.addColorStop(.5, "#0b4855");
        gradient.addColorStop(.78, "#0a303d");
        gradient.addColorStop(1, "#061821");
    }
    context.fillStyle = gradient;
    context.fillRect(screenX, screenY, size + 1, size + 1);
    const worldTop = y * size;
    context.save();
    context.beginPath();
    context.rect(screenX, screenY, size + 1, size + 1);
    context.clip();
    const laneCount = marketCanal ? 4 : 3;
    for (let lane = 0; lane < laneCount; lane += 1) {
        const globalX = marketCanal
            ? canalWorldLeft + 15 + lane * 22
            : canalWorldLeft + 24 + lane * 42;
        context.strokeStyle = marketCanal
            ? lane === 2 ? "rgba(65, 202, 205, .32)" : "rgba(43, 145, 160, .22)"
            : lane === 1 ? "rgba(53, 188, 199, .25)" : "rgba(43, 133, 151, .17)";
        context.lineWidth = marketCanal && lane === 2 ? 1.6 : lane === 1 ? 1.4 : 1;
        context.beginPath();
        for (let localY = -8; localY <= size + 8; localY += marketCanal ? 5 : 6) {
            const globalY = worldTop + localY;
            const wave = Math.sin((globalY + lane * 29) / (marketCanal ? 24 : 31)) * (marketCanal ? 3 + lane * .7 : 4 + lane);
            const px = screenX + globalX - x * size + wave;
            const py = screenY + localY;
            if (localY === -8) context.moveTo(px, py);
            else context.lineTo(px, py);
        }
        context.stroke();
    }
    if (marketCanal) {
        const firstRipple = Math.floor(worldTop / 18) - 1;
        const lastRipple = Math.ceil((worldTop + size) / 18) + 1;
        for (let ripple = firstRipple; ripple <= lastRipple; ripple += 1) {
            const globalY = ripple * 18;
            const startX = canalWorldLeft + 9 + terrainHash(ripple, 75, 997) * 55;
            const length = 13 + terrainHash(75, ripple, 1013) * 18;
            context.strokeStyle = ripple % 3 === 0 ? "rgba(98, 218, 215, .28)" : "rgba(61, 168, 178, .2)";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(screenX + startX - x * size, screenY + globalY - worldTop);
            context.quadraticCurveTo(
                screenX + startX + length * .48 - x * size,
                screenY + globalY - worldTop - 2,
                screenX + startX + length - x * size,
                screenY + globalY - worldTop + 1,
            );
            context.stroke();
        }
    }
    context.restore();
}

function drawIntegratedStairs(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    const sideGate = x <= 34 || x >= 50;
    fillTerrainTile(context, screenX, screenY, "#34383a");
    context.strokeStyle = "rgba(14, 18, 22, .78)";
    context.lineWidth = 2;
    const worldOffset = sideGate ? x * FIRST_PACT_TILE_SIZE : y * FIRST_PACT_TILE_SIZE;
    const localOffset = ((worldOffset % 9) + 9) % 9;
    for (let line = -localOffset; line <= FIRST_PACT_TILE_SIZE; line += 9) {
        context.beginPath();
        if (sideGate) {
            context.moveTo(screenX + line, screenY);
            context.lineTo(screenX + line, screenY + FIRST_PACT_TILE_SIZE + 1);
        } else {
            context.moveTo(screenX, screenY + line);
            context.lineTo(screenX + FIRST_PACT_TILE_SIZE + 1, screenY + line);
        }
        context.stroke();
        context.strokeStyle = "rgba(137, 116, 78, .28)";
        context.lineWidth = 1;
        context.stroke();
        context.strokeStyle = "rgba(14, 18, 22, .78)";
        context.lineWidth = 2;
    }
}

function drawLivingGround(context: CanvasRenderingContext2D, tile: FirstPactTile, x: number, y: number, screenX: number, screenY: number): void {
    const garden = tile === FirstPactTile.Garden;
    fillTerrainTile(context, screenX, screenY, garden ? "#172f2b" : "#142d27");
    for (let detail = 0; detail < 5; detail += 1) {
        const px = 4 + terrainHash(x, y, 101 + detail * 7) * 40;
        const py = 4 + terrainHash(x, y, 137 + detail * 11) * 40;
        context.fillStyle = detail % 2 === 0 ? "rgba(56, 103, 75, .34)" : "rgba(87, 104, 62, .18)";
        context.beginPath();
        context.arc(screenX + px, screenY + py, 1.2 + terrainHash(y, x, detail) * 1.8, 0, Math.PI * 2);
        context.fill();
    }
    if (terrainHash(x, y, 151) > 0.72) {
        context.strokeStyle = "rgba(87, 115, 88, .28)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(screenX + 8, screenY + 34);
        context.quadraticCurveTo(screenX + 23, screenY + 24, screenX + 42, screenY + 29);
        context.stroke();
    }
}

function drawKennelGround(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    // The ward is the same civic stonework as the surrounding shelf. A faint
    // stable-yard patina changes its use and age without changing the paver
    // dimensions, joint phase, or value family at the district boundary.
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        CIVIC_STONE_PAVERS.colors,
        CIVIC_STONE_PAVERS.mortar,
        CIVIC_STONE_PAVERS.width,
        CIVIC_STONE_PAVERS.height,
        CIVIC_STONE_PAVERS.salt,
    );
    context.fillStyle = "rgba(92, 65, 39, .035)";
    context.fillRect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
    for (let detail = 0; detail < 5; detail += 1) {
        const px = terrainHash(x, y, 181 + detail * 5) * FIRST_PACT_TILE_SIZE;
        const py = terrainHash(x, y, 211 + detail * 9) * FIRST_PACT_TILE_SIZE;
        const length = 3 + terrainHash(y, x, 227 + detail) * 6;
        context.strokeStyle = detail % 3 === 0 ? "rgba(142, 108, 63, .2)" : "rgba(83, 62, 41, .18)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(screenX + px, screenY + py);
        context.lineTo(screenX + px + length, screenY + py + (detail % 2 ? 1 : -1));
        context.stroke();
    }
}

function drawMarketGround(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    // Low-traffic market courts use the same world-scale masonry cadence as the
    // public lanes, but in dark earth-set cobble. Moss follows joined courses of
    // pavers; it never becomes a soft plot-sized decal beneath a building.
    const size = FIRST_PACT_TILE_SIZE;
    const worldLeft = x * size;
    const worldTop = y * size;
    const paverWidth = 30;
    const paverHeight = 18;
    drawGlobalPavers(
        context,
        x,
        y,
        screenX,
        screenY,
        ["#302d25", "#342f27", "#2a3029", "#27332d", "#373126"],
        "#151a17",
        paverWidth,
        paverHeight,
        823,
    );

    context.save();
    context.beginPath();
    context.rect(screenX, screenY, size + 1, size + 1);
    context.clip();
    const firstRow = Math.floor(worldTop / paverHeight) - 1;
    const lastRow = Math.ceil((worldTop + size) / paverHeight) + 1;
    for (let row = firstRow; row <= lastRow; row += 1) {
        const globalY = row * paverHeight;
        const offset = (Math.abs(row) % 2) * Math.floor(paverWidth / 2);
        const firstColumn = Math.floor((worldLeft - offset) / paverWidth) - 1;
        const lastColumn = Math.ceil((worldLeft + size - offset) / paverWidth) + 1;
        for (let column = firstColumn; column <= lastColumn; column += 1) {
            const mossCourse = terrainHash(Math.floor(column / 3), Math.floor(row / 2), 857);
            if (mossCourse < .56 || terrainHash(column, row, 881) < .24) continue;
            const globalX = column * paverWidth + offset;
            context.fillStyle = mossCourse > .78 ? "rgba(45, 82, 62, .7)" : "rgba(37, 69, 54, .52)";
            context.fillRect(screenX + globalX - worldLeft + 2, screenY + globalY - worldTop + paverHeight - 3, paverWidth - 4, 2);
            context.fillRect(screenX + globalX - worldLeft + 1, screenY + globalY - worldTop + 3, 2, paverHeight - 6);
        }
    }
    context.restore();
}

function drawServiceStone(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    drawGlobalPavers(context, x, y, screenX, screenY, ["#17242a", "#1a292e", "#1d2b2f"], "#091116", 32, 20, 263);
    const worldLeft = x * FIRST_PACT_TILE_SIZE;
    context.strokeStyle = "rgba(31, 139, 149, .16)";
    context.lineWidth = 1;
    for (let globalX = Math.floor(worldLeft / 64) * 64; globalX <= worldLeft + FIRST_PACT_TILE_SIZE; globalX += 64) {
        context.beginPath();
        context.moveTo(screenX + globalX - worldLeft, screenY);
        context.lineTo(screenX + globalX - worldLeft, screenY + FIRST_PACT_TILE_SIZE + 1);
        context.stroke();
    }
}

function drawRoofField(context: CanvasRenderingContext2D, x: number, y: number, screenX: number, screenY: number): void {
    fillTerrainTile(context, screenX, screenY, "#101a25");
    const worldTop = y * FIRST_PACT_TILE_SIZE;
    for (let globalY = Math.floor(worldTop / 11) * 11; globalY <= worldTop + FIRST_PACT_TILE_SIZE; globalY += 11) {
        context.strokeStyle = "rgba(95, 116, 127, .22)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(screenX, screenY + globalY - worldTop);
        context.lineTo(screenX + FIRST_PACT_TILE_SIZE + 1, screenY + globalY - worldTop);
        context.stroke();
    }
}

function drawDistrictPavers(context: CanvasRenderingContext2D, tile: FirstPactTile, x: number, y: number, screenX: number, screenY: number): void {
    const material: Record<number, { colors: readonly string[]; mortar: string; width: number; height: number; salt: number }> = {
        [FirstPactTile.Stone]: CIVIC_STONE_PAVERS,
        [FirstPactTile.Wall]: { colors: ["#17202a", "#1b252f", "#202a33"], mortar: "#090f16", width: 36, height: 18, salt: 307 },
        [FirstPactTile.Arena]: { colors: ["#5b4b37", "#62523c", "#564733"], mortar: "#3a3025", width: 38, height: 26, salt: 331 },
        [FirstPactTile.Market]: { colors: ["#342d31", "#3a3034", "#302a2e"], mortar: "#19151a", width: 28, height: 18, salt: 353 },
        [FirstPactTile.Court]: { colors: ["#303944", "#343e49", "#2c3641"], mortar: "#151c24", width: 38, height: 22, salt: 379 },
    };
    const selected = material[tile] ?? {
        colors: [TILE_PALETTE[tile].base, TILE_PALETTE[tile].edge],
        mortar: "#111820",
        width: 34,
        height: 22,
        salt: 401,
    };
    drawGlobalPavers(context, x, y, screenX, screenY, selected.colors, selected.mortar, selected.width, selected.height, selected.salt);
    if (tile === FirstPactTile.Court) {
        context.fillStyle = "rgba(148, 110, 53, .035)";
        context.fillRect(screenX, screenY, FIRST_PACT_TILE_SIZE + 1, FIRST_PACT_TILE_SIZE + 1);
    }
}

function strokeTileSide(
    context: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    dx: number,
    dy: number,
    inset = 0,
): void {
    const size = FIRST_PACT_TILE_SIZE;
    context.beginPath();
    if (dx < 0) { context.moveTo(screenX + inset, screenY); context.lineTo(screenX + inset, screenY + size); }
    else if (dx > 0) { context.moveTo(screenX + size - inset, screenY); context.lineTo(screenX + size - inset, screenY + size); }
    else if (dy < 0) { context.moveTo(screenX, screenY + inset); context.lineTo(screenX + size, screenY + inset); }
    else { context.moveTo(screenX, screenY + size - inset); context.lineTo(screenX + size, screenY + size - inset); }
    context.stroke();
}

function isCivicTravelSurface(tile: FirstPactTile): boolean {
    return tile === FirstPactTile.Road
        || tile === FirstPactTile.Bridge
        || tile === FirstPactTile.Stairs
        || tile === FirstPactTile.Court
        || tile === FirstPactTile.Arena;
}

function isContinuousPavingTransition(tile: FirstPactTile, neighbor: FirstPactTile): boolean {
    return (tile === FirstPactTile.Kennel && neighbor === FirstPactTile.Stone)
        || (tile === FirstPactTile.Stone && neighbor === FirstPactTile.Kennel)
        || (tile === FirstPactTile.Market && neighbor === FirstPactTile.Stone)
        || (tile === FirstPactTile.Stone && neighbor === FirstPactTile.Market);
}

type KennelPavedArea = Readonly<{
    salt: number;
    shelfExit?: boolean;
    points: readonly FirstPactPoint[];
}>;

/** Visual-only, medium-width branches through existing walkable Kennel cells. */
const KENNEL_PAVED_AREAS: readonly KennelPavedArea[] = [
    {
        salt: 613,
        shelfExit: true,
        points: [
            // The public route resumes below the horizontal road on the same
            // centerline as the stable gate. Keeping it narrow leaves the new
            // working pens visually distinct from the district exit.
            { x: 8.05, y: 45.85 },
            { x: 9.95, y: 45.85 },
            { x: 10.05, y: 47.25 },
            { x: 10.1, y: 50.1 },
            { x: 10, y: 53 },
            { x: 8.15, y: 53 },
            { x: 8.2, y: 50.1 },
            { x: 8.1, y: 47.25 },
        ],
    },
    {
        salt: 827,
        shelfExit: true,
        points: [
            // Four walkable tiles remain unmistakably open from the service
            // threshold, across the road, between the pens, and to the shelf.
            { x: 20.15, y: 44.8 },
            { x: 23.45, y: 44.8 },
            { x: 23.35, y: 47.1 },
            { x: 23.5, y: 49.4 },
            { x: 23.35, y: 53 },
            { x: 20.15, y: 53 },
            { x: 20.05, y: 49.25 },
            { x: 20.2, y: 47.05 },
        ],
    },
] as const;

function kennelPavedAreaPath(
    camera: Camera,
    points: readonly FirstPactPoint[],
): Path2D {
    const path = new Path2D();
    points.forEach((point, index) => {
        const x = point.x * FIRST_PACT_TILE_SIZE - camera.x;
        const y = point.y * FIRST_PACT_TILE_SIZE - camera.y;
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
    });
    path.closePath();
    return path;
}

/** Existing lodge lanterns remain architecture-side; the curved street pass
 * now carries both open thresholds without a sill or cross-route edge seam. */
function drawHandlerLodgeLanterns(context: CanvasRenderingContext2D, camera: Camera): void {
    context.save();
    for (const pointX of [11.25, 15.75]) {
        const x = pointX * FIRST_PACT_TILE_SIZE - camera.x;
        const y = 42.82 * FIRST_PACT_TILE_SIZE - camera.y;
        const glow = context.createRadialGradient(x, y, 1, x, y, 15);
        glow.addColorStop(0, "rgba(221, 164, 68, .36)");
        glow.addColorStop(1, "rgba(221, 164, 68, 0)");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(x, y, 15, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#171c1d";
        context.fillRect(x - 2, y - 2, 4, 12);
        context.fillStyle = "#c2842f";
        context.fillRect(x - 4, y - 5, 8, 6);
        context.fillStyle = "#f1bf61";
        context.fillRect(x - 2, y - 4, 4, 3);
    }
    context.restore();
}

/** A subdued silhouette-following substrate beneath the handler lodge RGBA art. */
function drawHandlerLodgeLotGround(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    // The soft north shoulder and stepped south skirt follow the joined tack
    // pier and 5x4 lodge mass. Two small threshold tongues reach beneath the
    // existing public branches; there is no full-width boulevard-side pad.
    const lodgeLot = new Path2D();
    lodgeLot.moveTo(sx(10.68), sy(38.58));
    lodgeLot.bezierCurveTo(sx(11.65), sy(38.45), sx(14.45), sy(38.45), sx(15.28), sy(38.62));
    lodgeLot.lineTo(sx(15.28), sy(38.92));
    lodgeLot.lineTo(sx(16.22), sy(38.92));
    lodgeLot.bezierCurveTo(sx(16.38), sy(39.75), sx(16.38), sy(41.45), sx(16.18), sy(42.25));
    lodgeLot.lineTo(sx(15.92), sy(42.25));
    lodgeLot.lineTo(sx(15.92), sy(43.06));
    lodgeLot.lineTo(sx(15.66), sy(43.06));
    lodgeLot.bezierCurveTo(sx(15.58), sy(43.18), sx(15.5), sy(43.22), sx(15.42), sy(43.22));
    lodgeLot.lineTo(sx(13.44), sy(43.22));
    lodgeLot.bezierCurveTo(sx(13.3), sy(43.18), sx(13.22), sy(43.12), sx(13.16), sy(43.06));
    lodgeLot.lineTo(sx(11.02), sy(43.06));
    lodgeLot.lineTo(sx(11.02), sy(42.52));
    lodgeLot.lineTo(sx(10.62), sy(42.52));
    lodgeLot.lineTo(sx(10.62), sy(42.22));
    lodgeLot.lineTo(sx(9.85), sy(42.22));
    lodgeLot.bezierCurveTo(sx(9.7), sy(41.35), sx(9.7), sy(39.65), sx(9.88), sy(38.92));
    lodgeLot.lineTo(sx(10.68), sy(38.92));
    lodgeLot.closePath();

    // This is an architecture substrate, so collision must not punch holes in
    // it. Tile-kind clipping keeps it on the ward/road shelf while allowing the
    // lodge image to overpaint the complete lot naturally later in renderWorld.
    const lodgeLotCells = new Path2D();
    for (let y = 38; y <= 43; y += 1) {
        for (let x = 9; x <= 16; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (tile !== FirstPactTile.Kennel && tile !== FirstPactTile.Road) continue;
            lodgeLotCells.rect(sx(x), sy(y), size, size);
        }
    }

    context.save();
    context.clip(lodgeLotCells);
    context.fillStyle = "rgba(29, 42, 37, .5)";
    context.fill(lodgeLot);
    context.globalAlpha = .64;
    drawWesternWardCobbles(context, camera, lodgeLot, { x: 9.7, y: 38.45, width: 6.68, height: 4.77 });
    context.restore();
}

/**
 * Dark, low-traffic ground around the cedar court and lower kennel buildings.
 * This is deliberately painted only into collision-authoritative walkable
 * Kennel cells; the brighter public streets are composited afterward. The
 * world-aligned courses keep the setbacks feeling like part of the district
 * rather than a collection of decorative panels.
 */
function drawCentralKennelLotFields(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    const walkableLotCells = new Path2D();
    for (let y = 35; y <= 52; y += 1) {
        for (let x = 11; x <= 27; x += 1) {
            if (!isFirstPactWalkable(x, y) || firstPactTileAt(x, y) !== FirstPactTile.Kennel) continue;
            walkableLotCells.rect(sx(x), sy(y), size, size);
        }
    }

    // The remaining field belongs only to the cedar bed. The former lodge field
    // reached north to y=35.2 and read as an oversized rectangular backplate;
    // the dedicated silhouette-following substrate replaces it.
    const lots = new Path2D();
    lots.moveTo(sx(19.18), sy(35.38));
    lots.bezierCurveTo(sx(20.18), sy(35.12), sx(21.8), sy(35.14), sx(22.82), sy(35.4));
    lots.lineTo(sx(22.82), sy(39.94));
    lots.bezierCurveTo(sx(21.72), sy(40.12), sx(20.18), sy(40.08), sx(19.18), sy(39.86));
    lots.closePath();
    // The lower lots deliberately stay unpainted. Their old rectangular fields
    // hugged the boulevard's south edge and made its walkable clearance read as
    // a raised slab instead of open ward ground.

    context.save();
    context.clip(walkableLotCells);
    const field = context.createLinearGradient(sx(11), sy(35), sx(27.95), sy(52.95));
    field.addColorStop(0, "#1a2424");
    field.addColorStop(.48, "#172321");
    field.addColorStop(1, "#24261f");
    context.fillStyle = field;
    context.fill(lots);
    context.clip(lots);

    const paverWidth = 38;
    const paverHeight = 24;
    const minWorldX = 10.8 * size;
    const maxWorldX = 28 * size;
    const minWorldY = 35 * size;
    const maxWorldY = 53 * size;
    const mossedStone = ["#1b2826", "#1e2b29", "#192522", "#222d28"] as const;
    const packedEarth = ["#292820", "#2c2920", "#25261f", "#302b21"] as const;
    for (let row = Math.floor(minWorldY / paverHeight) - 1; row <= Math.ceil(maxWorldY / paverHeight) + 1; row += 1) {
        const worldY = row * paverHeight;
        const offset = (Math.abs(row) % 2) * paverWidth / 2;
        for (let column = Math.floor((minWorldX - offset) / paverWidth) - 1; column <= Math.ceil((maxWorldX - offset) / paverWidth) + 1; column += 1) {
            const worldX = column * paverWidth + offset;
            const lowerLot = worldY + paverHeight / 2 >= 45.55 * size;
            const earthPocket = lowerLot && terrainHash(column, row, 1889) > .54;
            const palette = earthPocket ? packedEarth : mossedStone;
            const variation = terrainHash(column, row, 1861);
            context.fillStyle = palette[Math.floor(variation * palette.length) % palette.length];
            context.fillRect(worldX + 1.5 - camera.x, worldY + 1.5 - camera.y, paverWidth - 3, paverHeight - 3);

            // Moss follows the masonry courses instead of becoming loose grass
            // tufts, keeping the ground texture quiet and world-aligned.
            if (terrainHash(column, row, 1907) > .76) {
                context.strokeStyle = earthPocket ? "rgba(116, 105, 59, .2)" : "rgba(68, 104, 71, .28)";
                context.lineWidth = 1.2;
                context.beginPath();
                context.moveTo(worldX + 5 - camera.x, worldY + paverHeight - 3 - camera.y);
                context.lineTo(worldX + paverWidth - 7 - camera.x, worldY + paverHeight - 3 - camera.y);
                context.stroke();
            }
        }
    }
    context.restore();
}

function drawLowerKennelExerciseGround(context: CanvasRenderingContext2D, camera: Camera): void {
    const runs = [
        {
            side: "west" as const,
            salt: 941,
            minX: 15.1,
            maxX: 18.15,
            minY: 45.9,
            maxY: 52.9,
            points: [
                { x: 15.35, y: 46.05 }, { x: 17.75, y: 45.85 }, { x: 18.15, y: 47.2 },
                { x: 17.9, y: 49.55 }, { x: 18.05, y: 52.45 }, { x: 17.45, y: 52.85 },
                { x: 15.35, y: 52.7 }, { x: 15.05, y: 51.75 }, { x: 15.2, y: 48.9 },
            ],
        },
        {
            side: "east" as const,
            salt: 977,
            minX: 24.75,
            maxX: 27.9,
            minY: 45.9,
            maxY: 52.9,
            points: [
                { x: 25.05, y: 46.05 }, { x: 27.55, y: 45.9 }, { x: 27.9, y: 47.05 },
                { x: 27.7, y: 49.5 }, { x: 27.95, y: 52.45 }, { x: 27.3, y: 52.85 },
                { x: 25.1, y: 52.7 }, { x: 24.8, y: 51.65 }, { x: 24.95, y: 49 },
            ],
        },
    ] as const;

    context.save();
    // Keep the organic paddocks on ward ground; the adjacent aqueduct and
    // public road retain their own material even where the shapes feather out.
    context.beginPath();
    for (let y = 31; y <= 52; y += 1) {
        for (let x = 5; x <= 27; x += 1) {
            if (firstPactTileAt(x, y) !== FirstPactTile.Kennel) continue;
            context.rect(
                x * FIRST_PACT_TILE_SIZE - camera.x,
                y * FIRST_PACT_TILE_SIZE - camera.y,
                FIRST_PACT_TILE_SIZE,
                FIRST_PACT_TILE_SIZE,
            );
        }
    }
    context.clip();

    for (const run of runs) {
        const shape = kennelPavedAreaPath(camera, run.points);
        const minX = run.minX * FIRST_PACT_TILE_SIZE - camera.x;
        const maxX = run.maxX * FIRST_PACT_TILE_SIZE - camera.x;
        const minY = run.minY * FIRST_PACT_TILE_SIZE - camera.y;
        const maxY = run.maxY * FIRST_PACT_TILE_SIZE - camera.y;
        context.save();
        context.lineJoin = "round";
        context.strokeStyle = "rgba(12, 17, 17, .78)";
        context.lineWidth = 13;
        context.stroke(shape);
        context.strokeStyle = "rgba(117, 91, 53, .54)";
        context.lineWidth = 5;
        context.stroke(shape);
        context.clip(shape);

        const earth = context.createLinearGradient(minX, minY, maxX, maxY);
        earth.addColorStop(0, "#4d402d");
        earth.addColorStop(.46, "#3f3628");
        earth.addColorStop(1, "#55442c");
        context.fillStyle = earth;
        context.fillRect(minX, minY, maxX - minX, maxY - minY);

        // A broad compacted loop explains how the narrow run is exercised;
        // it is surface wear rather than a second paved plaza.
        const loopX = ((run.minX + run.maxX) / 2) * FIRST_PACT_TILE_SIZE - camera.x;
        const loopY = 49.6 * FIRST_PACT_TILE_SIZE - camera.y;
        context.strokeStyle = "rgba(37, 29, 21, .48)";
        context.lineWidth = 12;
        context.beginPath();
        context.ellipse(loopX, loopY, 48, 112, 0, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "rgba(124, 94, 54, .24)";
        context.lineWidth = 4;
        context.stroke();

        // Deterministic grit and straw give the earthen relief enough scale
        // variation to read beside the crisp V3 architecture.
        for (let fleck = 0; fleck < 34; fleck += 1) {
            const worldX = run.minX + terrainHash(fleck, run.salt, 101) * (run.maxX - run.minX);
            const worldY = run.minY + terrainHash(run.salt, fleck, 137) * (run.maxY - run.minY);
            const screenX = worldX * FIRST_PACT_TILE_SIZE - camera.x;
            const screenY = worldY * FIRST_PACT_TILE_SIZE - camera.y;
            if (!context.isPointInPath(shape, screenX, screenY)) continue;
            const straw = fleck % 5 === 0;
            context.strokeStyle = straw ? "rgba(174, 127, 58, .52)" : "rgba(24, 24, 20, .38)";
            context.lineWidth = straw ? 1.5 : 2;
            context.beginPath();
            context.moveTo(screenX - (straw ? 5 : 1.5), screenY + 1);
            context.lineTo(screenX + (straw ? 6 : 1.5), screenY - (straw ? 2 : 1));
            context.stroke();
        }
        context.restore();

        // The outer berm is deliberate husbandry: shade-tolerant switchgrass
        // and low moss bind the shelf edge without scattering loose props.
        const bermX = (run.side === "west" ? 15.45 : 27.55) * FIRST_PACT_TILE_SIZE - camera.x;
        for (let tuft = 0; tuft < 6; tuft += 1) {
            const tuftY = (46.45 + tuft * 1.08) * FIRST_PACT_TILE_SIZE - camera.y;
            context.fillStyle = tuft % 2 ? "rgba(35, 69, 48, .94)" : "rgba(42, 82, 55, .94)";
            context.beginPath();
            context.ellipse(bermX + (tuft % 2 ? 4 : -3), tuftY, 13, 8, (tuft % 2 ? .2 : -.18), 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = "rgba(114, 130, 76, .52)";
            context.lineWidth = 1.5;
            for (const blade of [-7, 0, 7]) {
                context.beginPath();
                context.moveTo(bermX + blade, tuftY + 3);
                context.quadraticCurveTo(bermX + blade * .7, tuftY - 8, bermX + blade * 1.25, tuftY - 13);
                context.stroke();
            }
        }
    }
    context.restore();
}

let kennelBoulevardLayerCanvas: HTMLCanvasElement | null = null;

function prepareKennelBoulevardLayer(
    context: CanvasRenderingContext2D,
    camera: Camera,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
    const ratio = Math.max(1, Math.min(2, context.getTransform().a || 1));
    kennelBoulevardLayerCanvas ??= document.createElement("canvas");
    const pixelWidth = Math.max(1, Math.ceil(camera.width * ratio));
    const pixelHeight = Math.max(1, Math.ceil(camera.height * ratio));
    if (kennelBoulevardLayerCanvas.width !== pixelWidth || kennelBoulevardLayerCanvas.height !== pixelHeight) {
        kennelBoulevardLayerCanvas.width = pixelWidth;
        kennelBoulevardLayerCanvas.height = pixelHeight;
    }
    const layerContext = kennelBoulevardLayerCanvas.getContext("2d");
    if (!layerContext) return null;
    layerContext.setTransform(1, 0, 0, 1, 0, 0);
    layerContext.clearRect(0, 0, pixelWidth, pixelHeight);
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { canvas: kennelBoulevardLayerCanvas, context: layerContext };
}

function drawKennelBoulevardJunctions(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;
    const boulevard = new Path2D();
    // Carry the western end beyond the viewport before joining the existing
    // curve, so the route reads as a continuing street instead of a bulb.
    boulevard.moveTo(sx(1.35), sy(44.42));
    boulevard.bezierCurveTo(sx(2.45), sy(44.48), sx(3.7), sy(44.61), sx(4.72), sy(44.72));
    boulevard.bezierCurveTo(sx(9.2), sy(44.98), sx(12.7), sy(43.86), sx(17.35), sy(44.08));
    boulevard.bezierCurveTo(sx(21.45), sy(44.28), sx(24.05), sy(44.98), sx(28.45), sy(44.66));
    boulevard.bezierCurveTo(sx(34.8), sy(44.2), sx(39.35), sy(43.92), sx(44.5), sy(44.12));
    boulevard.bezierCurveTo(sx(51.2), sy(44.38), sx(56.85), sy(44.94), sx(61.35), sy(44.58));
    boulevard.bezierCurveTo(sx(63.3), sy(44.42), sx(65), sy(44.22), sx(66.28), sy(44.4));

    // Each spur either vanishes beneath a real threshold or continues beyond
    // the lower viewport. Short dead-end strokes would expose rounded bulbs.
    const branches = new Path2D();
    branches.moveTo(sx(9.35), sy(40.25));
    branches.bezierCurveTo(sx(9.18), sy(43.18), sx(9.52), sy(44.95), sx(9.26), sy(46.72));
    branches.bezierCurveTo(sx(9.18), sy(48.85), sx(9.4), sy(51.2), sx(9.3), sy(53.2));
    branches.moveTo(sx(16.1), sy(40.55));
    branches.bezierCurveTo(sx(15.92), sy(41.95), sx(16.2), sy(43.35), sx(16.14), sy(44.08));
    branches.moveTo(sx(21.48), sy(40.25));
    branches.bezierCurveTo(sx(21.68), sy(43.4), sx(21.3), sy(45.22), sx(21.5), sy(47.08));
    branches.bezierCurveTo(sx(21.62), sy(49.2), sx(21.34), sy(51.25), sx(21.5), sy(53.2));
    branches.moveTo(sx(26.48), sy(40.55));
    branches.bezierCurveTo(sx(26.72), sy(43.42), sx(26.3), sy(45.48), sx(26.58), sy(48.22));
    branches.bezierCurveTo(sx(26.72), sy(50.1), sx(26.42), sy(51.7), sx(26.5), sy(53.2));
    branches.moveTo(sx(42.5), sy(40.25));
    branches.bezierCurveTo(sx(42.42), sy(43.55), sx(42.6), sy(45.3), sx(42.5), sy(46.7));
    branches.bezierCurveTo(sx(42.4), sy(48.95), sx(42.58), sy(51.25), sx(42.5), sy(53.2));
    branches.moveTo(sx(55.5), sy(40.55));
    branches.bezierCurveTo(sx(55.42), sy(42.15), sx(55.6), sy(43.7), sx(55.5), sy(44.78));
    branches.moveTo(sx(65.1), sy(40.55));
    branches.bezierCurveTo(sx(65.02), sy(42.05), sx(65.18), sy(43.45), sx(65.1), sy(44.28));

    // The handler lodge has two collision-authored open cells. Two narrow,
    // softly merging approaches preserve both doorways without drawing a gate,
    // step, wedge, or cross-road apron.
    const lodgeBranches = new Path2D();
    lodgeBranches.moveTo(sx(13.42), sy(41.55));
    lodgeBranches.bezierCurveTo(sx(13.5), sy(43.16), sx(13.84), sy(43.82), sx(14.24), sy(44.55));
    lodgeBranches.moveTo(sx(15.44), sy(41.55));
    lodgeBranches.bezierCurveTo(sx(15.38), sy(43.24), sx(14.9), sy(43.9), sx(14.24), sy(44.55));

    const layer = prepareKennelBoulevardLayer(context, camera);
    if (!layer) return;
    const routeContext = layer.context;
    routeContext.lineCap = "round";
    routeContext.lineJoin = "round";
    const boulevardWidth = 1.78 * size;
    const branchWidth = 1.28 * size;
    const lodgeBranchWidth = .72 * size;

    // The opaque strokes form one continuous ground mask. Cobbles are then
    // composited source-atop, so their outer stones are cleanly cut by the
    // rounded silhouette instead of selected as collision-cell fragments.
    routeContext.globalCompositeOperation = "source-over";
    routeContext.strokeStyle = "#303a3d";
    routeContext.lineWidth = boulevardWidth;
    routeContext.stroke(boulevard);
    routeContext.lineWidth = branchWidth;
    routeContext.stroke(branches);
    routeContext.lineWidth = lodgeBranchWidth;
    routeContext.stroke(lodgeBranches);
    routeContext.globalCompositeOperation = "source-atop";

    const { colors, width: paverWidth, height: paverHeight, salt } = WESTERN_WARD_COBBLES;
    const dampColors = ["#4c6061", "#526667", "#465b5e", "#596a68", "#4a6062"] as const;
    const minWorldX = .75 * size;
    const maxWorldX = 66.5 * size;
    const minWorldY = 39.95 * size;
    const maxWorldY = 53.45 * size;
    for (let row = Math.floor(minWorldY / paverHeight) - 1; row <= Math.ceil(maxWorldY / paverHeight) + 1; row += 1) {
        const worldY = row * paverHeight;
        const offset = (Math.abs(row) % 2) * Math.floor(paverWidth / 2);
        for (let column = Math.floor((minWorldX - offset) / paverWidth) - 1; column <= Math.ceil((maxWorldX - offset) / paverWidth) + 1; column += 1) {
            const worldX = column * paverWidth + offset;
            const crossing = worldX + paverWidth / 2 >= 28 * size && worldX + paverWidth / 2 < 31 * size;
            const palette = crossing ? dampColors : colors;
            const variation = terrainHash(column, row, salt);
            const leftSkew = (terrainHash(column, row, 1409) - .5) * 2;
            const topSkew = (terrainHash(column, row, 1423) - .5) * 1.4;
            routeContext.fillStyle = palette[Math.floor(variation * palette.length) % palette.length];
            routeContext.beginPath();
            routeContext.moveTo(worldX + 1.5 + leftSkew - camera.x, worldY + 1.5 + topSkew - camera.y);
            routeContext.lineTo(worldX + paverWidth - 1.5 - camera.x, worldY + 1.5 - topSkew - camera.y);
            routeContext.lineTo(worldX + paverWidth - 2 - leftSkew - camera.x, worldY + paverHeight - 1.5 - camera.y);
            routeContext.lineTo(worldX + 1.5 - camera.x, worldY + paverHeight - 1.5 - camera.y);
            routeContext.closePath();
            routeContext.fill();
        }
    }

    // Remove only the branch spill above and below the collision-authored
    // crossing. The original curved boulevard and its world-aligned cobble
    // cadence remain intact on the Road/Bridge/ Road deck rows, so the canal
    // gains hard banks without replacing the street with a rectangular plate.
    const aqueduct = FIRST_PACT_AQUEDUCT_CIVIC_CROSSING;
    const maskLeft = aqueduct.westBankNorth.x;
    const maskWidth = aqueduct.eastBankNorth.x - maskLeft + 1;
    const deckBottom = aqueduct.deck.y + aqueduct.deck.height;
    const aqueductNonRoute = new Path2D();
    aqueductNonRoute.rect(
        sx(maskLeft),
        sy(aqueduct.control.y),
        maskWidth * size,
        (aqueduct.deck.y - aqueduct.control.y) * size,
    );
    aqueductNonRoute.rect(
        sx(maskLeft),
        sy(deckBottom),
        maskWidth * size,
        (aqueduct.westBankSouth.y + aqueduct.westBankSouth.height - deckBottom) * size,
    );
    routeContext.globalCompositeOperation = "destination-out";
    routeContext.fill(aqueductNonRoute);
    routeContext.globalCompositeOperation = "source-over";

    context.save();
    context.drawImage(
        layer.canvas,
        0,
        0,
        layer.canvas.width,
        layer.canvas.height,
        0,
        0,
        camera.width,
        camera.height,
    );
    context.restore();
}

const WESTERN_WARD_COBBLES = {
    colors: ["#566164", "#60696a", "#4d595d", "#686d68", "#525e60"] as const,
    width: 26,
    height: 16,
    salt: 1399,
} as const;

/** Paint one shared, world-aligned cobble material through an authored ground shape. */
function drawWesternWardCobbles(
    context: CanvasRenderingContext2D,
    camera: Camera,
    shape: Path2D,
    bounds: FirstPactRect,
): void {
    const size = FIRST_PACT_TILE_SIZE;
    const { colors, width, height, salt } = WESTERN_WARD_COBBLES;
    const minWorldX = bounds.x * size;
    const maxWorldX = (bounds.x + bounds.width) * size;
    const minWorldY = bounds.y * size;
    const maxWorldY = (bounds.y + bounds.height) * size;

    context.save();
    context.fillStyle = "#303a3d";
    context.fill(shape);
    context.clip(shape);
    for (let row = Math.floor(minWorldY / height) - 1; row <= Math.ceil(maxWorldY / height) + 1; row += 1) {
        const worldY = row * height;
        const offset = (Math.abs(row) % 2) * Math.floor(width / 2);
        for (let column = Math.floor((minWorldX - offset) / width) - 1; column <= Math.ceil((maxWorldX - offset) / width) + 1; column += 1) {
            const worldX = column * width + offset;
            const leftSkew = (terrainHash(column, row, 1409) - .5) * 2;
            const topSkew = (terrainHash(column, row, 1423) - .5) * 1.4;
            const x = worldX - camera.x;
            const y = worldY - camera.y;
            context.fillStyle = colors[Math.floor(terrainHash(column, row, salt) * colors.length) % colors.length];
            context.beginPath();
            context.moveTo(x + 1.5 + leftSkew, y + 1.5 + topSkew);
            context.lineTo(x + width - 1.5, y + 1.5 - topSkew);
            context.lineTo(x + width - 2 - leftSkew, y + height - 1.5);
            context.lineTo(x + 1.5, y + height - 1.5);
            context.closePath();
            context.fill();
        }
    }
    context.restore();
}

/**
 * One public cobbled street joins Vale Stable and its tack bay to the accepted
 * x=16 plaza connector. This is paint only, clipped to the existing walkable
 * cells beneath the gate, bay, plaza mouth, and lower civic spine.
 */
function drawStableCampusGrounding(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    const walkableCampusCells = new Path2D();
    for (let y = 31; y <= 43; y += 1) {
        for (let x = 5; x <= 17; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (!isFirstPactWalkable(x, y) || (tile !== FirstPactTile.Kennel && tile !== FirstPactTile.Road)) continue;
            walkableCampusCells.rect(sx(x), sy(y), size, size);
        }
    }

    // A clean two-tile-equivalent street begins flush between the stable's real
    // south-gate jambs, then crosses the former dark gap on a shallow diagonal
    // into the plaza connector. A short straight branch serves the annex bay.
    // Parallel sides and one deliberate bend keep this a street, not a pad.
    const street = new Path2D();
    street.moveTo(sx(8), sy(37.42));
    street.lineTo(sx(10), sy(37.42));
    street.lineTo(sx(10), sy(37.72));
    street.lineTo(sx(16.9), sy(38.62));
    street.lineTo(sx(16.9), sy(40.52));
    street.lineTo(sx(9.55), sy(39.55));
    street.lineTo(sx(8), sy(38.82));
    street.closePath();
    street.moveTo(sx(9.03), sy(38.32));
    street.lineTo(sx(9.97), sy(38.32));
    street.lineTo(sx(9.97), sy(41.96));
    street.lineTo(sx(9.03), sy(41.96));
    street.closePath();

    context.save();
    context.clip(walkableCampusCells);
    drawWesternWardCobbles(context, camera, street, { x: 8, y: 37.3, width: 9, height: 4.8 });
    context.restore();
}

/**
 * A visual-only street fabric for the western ward. The authored tile map is
 * intentionally untouched: this pass simply reveals the routes already used
 * by pathfinding as a stable court, delivery lane, and service street instead
 * of one undifferentiated dark-paver field.
 */
function drawWesternStreetFabric(context: CanvasRenderingContext2D, camera: Camera): void {
    const network = new Path2D();
    network.rect(
        15.05 * FIRST_PACT_TILE_SIZE - camera.x,
        30.92 * FIRST_PACT_TILE_SIZE - camera.y,
        2.2 * FIRST_PACT_TILE_SIZE,
        12.13 * FIRST_PACT_TILE_SIZE,
    );

    const walkableWesternCells = new Path2D();
    for (let y = 31; y <= 42; y += 1) {
        for (let x = 5; x <= 27; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (!isFirstPactWalkable(x, y) || (tile !== FirstPactTile.Kennel && tile !== FirstPactTile.Road)) continue;
            walkableWesternCells.rect(
                x * FIRST_PACT_TILE_SIZE - camera.x,
                y * FIRST_PACT_TILE_SIZE - camera.y,
                FIRST_PACT_TILE_SIZE,
                FIRST_PACT_TILE_SIZE,
            );
        }
    }

    context.save();
    context.clip(walkableWesternCells);
    drawWesternWardCobbles(context, camera, network, { x: 15.05, y: 30.92, width: 2.2, height: 12.13 });
    context.restore();

    drawStableCampusGrounding(context, camera);

    // One flush drain belongs to the retained north/south connector. The cedar
    // courtyard has no overlaid seams or bands competing with its paving.
    const sx = (x: number) => x * FIRST_PACT_TILE_SIZE - camera.x;
    const sy = (y: number) => y * FIRST_PACT_TILE_SIZE - camera.y;
    const drains = new Path2D();
    drains.moveTo(sx(15.5), sy(31.08));
    drains.lineTo(sx(15.5), sy(36.92));
    drains.bezierCurveTo(sx(15.48), sy(38.2), sx(15.62), sy(40.58), sx(15.58), sy(42.84));
    context.save();
    context.lineCap = "round";
    context.strokeStyle = "rgba(17, 24, 26, .56)";
    context.lineWidth = 2.5;
    context.stroke(drains);
    context.strokeStyle = "rgba(132, 126, 102, .42)";
    context.lineWidth = .75;
    context.stroke(drains);
    for (const y of [33.4, 36.8, 40.7]) {
        context.strokeStyle = "rgba(20, 28, 29, .76)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(sx(15.36), sy(y));
        context.lineTo(sx(15.65), sy(y));
        context.stroke();
    }
    context.restore();
}

/** Ground the south-facing infirmary in one compact lot and one public route. */
function drawKennelInfirmaryGround(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    // The curved boulevard intentionally ends between tile boundaries. A thin,
    // stepped service-court shoulder continues beneath that final road pass so
    // its lower edge meets a believable lot instead of exposing the rectangular
    // y=45 base tile. The shoulder overlaps both the infirmary parcel and the
    // west gate approach without becoming another paved cross-street.
    const serviceCourt = new Path2D();
    serviceCourt.moveTo(sx(9.55), sy(45.28));
    serviceCourt.lineTo(sx(10.35), sy(45.28));
    serviceCourt.lineTo(sx(10.35), sy(45.42));
    serviceCourt.lineTo(sx(11.55), sy(45.42));
    serviceCourt.lineTo(sx(11.55), sy(45.3));
    serviceCourt.lineTo(sx(12.75), sy(45.3));
    serviceCourt.lineTo(sx(12.75), sy(45.16));
    serviceCourt.lineTo(sx(14.15), sy(45.16));
    serviceCourt.lineTo(sx(14.15), sy(45.28));
    serviceCourt.lineTo(sx(15.08), sy(45.28));
    serviceCourt.lineTo(sx(15.08), sy(46.2));
    serviceCourt.lineTo(sx(9.62), sy(46.2));
    serviceCourt.closePath();

    const serviceCourtCells = new Path2D();
    for (let y = 45; y <= 46; y += 1) {
        for (let x = 9; x <= 15; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (!isFirstPactWalkable(x, y) || (tile !== FirstPactTile.Road && tile !== FirstPactTile.Kennel)) continue;
            serviceCourtCells.rect(sx(x), sy(y), size, size);
        }
    }

    context.save();
    context.clip(serviceCourtCells);
    context.fillStyle = "#24261f";
    context.fill(serviceCourt);
    context.clip(serviceCourt);
    const servicePaverWidth = 38;
    const servicePaverHeight = 24;
    const mossedStone = ["#1b2826", "#1e2b29", "#192522", "#222d28"] as const;
    const packedEarth = ["#292820", "#2c2920", "#25261f", "#302b21"] as const;
    for (let row = Math.floor(45.1 * size / servicePaverHeight); row <= Math.ceil(46.25 * size / servicePaverHeight); row += 1) {
        const worldY = row * servicePaverHeight;
        const offset = (Math.abs(row) % 2) * servicePaverWidth / 2;
        for (let column = Math.floor((9.45 * size - offset) / servicePaverWidth); column <= Math.ceil((15.15 * size - offset) / servicePaverWidth); column += 1) {
            const worldX = column * servicePaverWidth + offset;
            const palette = terrainHash(column, row, 2017) > .58 ? packedEarth : mossedStone;
            context.fillStyle = palette[Math.floor(terrainHash(column, row, 2039) * palette.length) % palette.length];
            context.fillRect(worldX + 1.5 - camera.x, worldY + 1.5 - camera.y, servicePaverWidth - 3, servicePaverHeight - 3);
            if (terrainHash(column, row, 2053) > .7) {
                context.strokeStyle = "rgba(68, 104, 71, .3)";
                context.lineWidth = 1.2;
                context.beginPath();
                context.moveTo(worldX + 5 - camera.x, worldY + servicePaverHeight - 3 - camera.y);
                context.lineTo(worldX + servicePaverWidth - 7 - camera.x, worldY + servicePaverHeight - 3 - camera.y);
                context.stroke();
            }
        }
    }
    context.restore();

    // The shallow stepped edge is almost entirely covered by the building. What
    // remains visible reads as packed working ground and moss at the foundation,
    // rather than a rectangular display pad beneath the transparent sprite.
    const lot = new Path2D();
    lot.moveTo(sx(9.62), sy(46));
    lot.lineTo(sx(14.92), sy(46));
    lot.lineTo(sx(15.08), sy(46.22));
    lot.lineTo(sx(15.08), sy(49.92));
    lot.lineTo(sx(14.72), sy(50.45));
    lot.lineTo(sx(10.04), sy(50.45));
    lot.lineTo(sx(9.62), sy(50.08));
    lot.closePath();

    const wardCells = new Path2D();
    for (let y = 46; y <= 51; y += 1) {
        for (let x = 8; x <= 15; x += 1) {
            if (firstPactTileAt(x, y) !== FirstPactTile.Kennel) continue;
            wardCells.rect(sx(x), sy(y), size, size);
        }
    }
    context.save();
    context.clip(wardCells);
    context.fillStyle = "rgba(75, 59, 39, .9)";
    context.fill(lot);
    context.strokeStyle = "rgba(56, 91, 62, .68)";
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.stroke(lot);
    context.strokeStyle = "rgba(132, 105, 65, .44)";
    context.lineWidth = 2;
    context.stroke(lot);
    context.restore();

    // A two-tile-clear L links the paired door cells to the existing x=9 aisle.
    // Its north end now overlaps the road lip; the unchanged boulevard renders
    // afterward, caps that overlap, and carries the route to the pavilion gate.
    const connector = new Path2D();
    connector.rect(sx(8), sy(45.25), 2 * size, 6.75 * size);
    connector.rect(sx(8), sy(50), 5 * size, 2 * size);
    connector.rect(sx(11), sy(49.25), 2 * size, 2.75 * size);

    const walkableWardCells = new Path2D();
    for (let y = 45; y <= 51; y += 1) {
        for (let x = 8; x <= 12; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (!isFirstPactWalkable(x, y) || (tile !== FirstPactTile.Road && tile !== FirstPactTile.Kennel)) continue;
            walkableWardCells.rect(sx(x), sy(y), size, size);
        }
    }
    context.save();
    context.clip(walkableWardCells);
    drawWesternWardCobbles(context, camera, connector, { x: 8, y: 45.25, width: 5, height: 6.75 });
    context.restore();
}

function drawKennelFootpaths(context: CanvasRenderingContext2D, camera: Camera): void {
    drawCentralKennelLotFields(context, camera);
    drawHandlerLodgeLotGround(context, camera);
    drawLowerKennelExerciseGround(context, camera);
    drawKennelInfirmaryGround(context, camera);
    context.save();
    // The paving is clipped to collision-authoritative walkable Kennel cells.
    // Roads keep their own continuous material and become the civic connector
    // between courts instead of being overpainted by isolated path polygons.
    context.beginPath();
    for (let y = 31; y <= 52; y += 1) {
        for (let x = 4; x <= 27; x += 1) {
            if (!isFirstPactWalkable(x, y) || firstPactTileAt(x, y) !== FirstPactTile.Kennel) continue;
            context.rect(
                x * FIRST_PACT_TILE_SIZE - camera.x,
                y * FIRST_PACT_TILE_SIZE - camera.y,
                FIRST_PACT_TILE_SIZE,
                FIRST_PACT_TILE_SIZE,
            );
        }
    }
    context.clip();

    const paverWidth = CIVIC_STONE_PAVERS.width;
    const paverHeight = CIVIC_STONE_PAVERS.height;
    for (const area of KENNEL_PAVED_AREAS) {
        const wear = [
            "rgba(150, 119, 76, .1)",
            "rgba(121, 111, 91, .075)",
            "rgba(164, 128, 79, .085)",
        ] as const;
        const shape = kennelPavedAreaPath(camera, area.points);
        const minWorldX = Math.min(...area.points.map((point) => point.x)) * FIRST_PACT_TILE_SIZE;
        const maxWorldX = Math.max(...area.points.map((point) => point.x)) * FIRST_PACT_TILE_SIZE;
        const minWorldY = Math.min(...area.points.map((point) => point.y)) * FIRST_PACT_TILE_SIZE;
        const maxWorldY = Math.max(...area.points.map((point) => point.y)) * FIRST_PACT_TILE_SIZE;

        // A route is a run of more-worn civic stones, never a filled polygon.
        // Selecting whole world-grid pavers lets its edge dissolve naturally
        // into the ward instead of describing another closed panel.
        const firstRow = Math.floor(minWorldY / paverHeight) - 1;
        const lastRow = Math.ceil(maxWorldY / paverHeight) + 1;
        for (let row = firstRow; row <= lastRow; row += 1) {
            const worldY = row * paverHeight;
            const offset = (Math.abs(row) % 2) * paverWidth / 2;
            const firstColumn = Math.floor((minWorldX - offset) / paverWidth) - 1;
            const lastColumn = Math.ceil((maxWorldX - offset) / paverWidth) + 1;
            for (let column = firstColumn; column <= lastColumn; column += 1) {
                const worldX = column * paverWidth + offset;
                const centerX = worldX + paverWidth / 2 - camera.x;
                const centerY = worldY + paverHeight / 2 - camera.y;
                if (!context.isPointInPath(shape, centerX, centerY)) continue;
                const variation = terrainHash(column, row, area.salt);
                context.fillStyle = wear[Math.floor(variation * wear.length) % wear.length];
                context.fillRect(
                    worldX + 2 - camera.x,
                    worldY + 2 - camera.y,
                    paverWidth - 4,
                    paverHeight - 4,
                );
            }
        }
    }
    context.restore();

    drawWesternStreetFabric(context, camera);
    drawBondingCourtyardGround(context, camera);
    drawLowerKennelCivicCourt(context, camera);
    drawKennelBoulevardJunctions(context, camera);
}

/**
 * Four continuous planted setbacks occupy the Bell Quarter's non-route gaps.
 * Their footprint is shared with world collision rather than painted as loose
 * decals, and their irregular masonry edges keep the block visually porous.
 */
function drawBellQuarterPlantings(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;
    for (const planting of FIRST_PACT_BELL_PLANTING_BEDS) {
        const { bounds: bed, salt } = planting;
        const left = sx(bed.x + .12);
        const top = sy(bed.y + .12);
        const width = (bed.width - .24) * size;
        const height = (bed.height - .24) * size;
        const right = left + width;
        const bottom = top + height;

        // Earth follows a deliberately uneven foundation edge. It has no
        // closed outline: isolated curb fragments and overhanging leaves keep
        // these reading as planted ground rather than pasted UI panels.
        const earth = new Path2D();
        earth.moveTo(left + 11, top + 4);
        earth.bezierCurveTo(left + width * .3, top - 1, left + width * .7, top + 7, right - 15, top + 2);
        earth.quadraticCurveTo(right + 2, top + 13, right - 3, top + height * .3);
        earth.bezierCurveTo(right + 3, top + height * .53, right - 8, bottom - 18, right - 3, bottom - 9);
        earth.bezierCurveTo(right - width * .25, bottom + 2, left + width * .35, bottom - 8, left + 9, bottom - 2);
        earth.quadraticCurveTo(left - 3, bottom - 15, left + 3, top + height * .67);
        earth.bezierCurveTo(left - 4, top + height * .42, left + 8, top + 21, left + 11, top + 4);
        earth.closePath();
        context.save();
        context.shadowColor = "rgba(0, 0, 0, .2)";
        context.shadowBlur = 5;
        context.shadowOffsetY = 3;
        context.fillStyle = "rgba(14, 29, 21, .52)";
        context.fill(earth);
        context.shadowColor = "transparent";

        // Leaf litter and tiny shoots give the earth the same fine frequency
        // as the roof/facade art without spilling decoration into the lanes.
        const litterCount = Math.ceil(bed.width * bed.height * 3.2);
        for (let litter = 0; litter < litterCount; litter += 1) {
            const px = left + 7 + terrainHash(litter, salt, 2111) * Math.max(1, width - 14);
            const py = top + 7 + terrainHash(salt, litter, 2137) * Math.max(1, height - 14);
            if (!context.isPointInPath(earth, px, py)) continue;
            context.fillStyle = litter % 5 === 0 ? "rgba(177, 102, 42, .72)" : "rgba(80, 111, 68, .62)";
            context.beginPath();
            context.ellipse(px, py, 2.5, 1.05, terrainHash(litter, 3, salt) * Math.PI, 0, Math.PI * 2);
            context.fill();
        }
        context.restore();

        // Broken stone fragments mark only portions of the perimeter. Their
        // gaps and varied angles preserve an organic, built-into-the-block edge.
        const perimeter = 2 * (width + height);
        const stoneCount = Math.ceil((bed.width + bed.height) * 1.7);
        for (let stone = 0; stone < stoneCount; stone += 1) {
            if (terrainHash(stone, salt, 2179) < .34) continue;
            let distance = ((stone + .24 + terrainHash(salt, stone, 2203) * .42) / stoneCount) * perimeter;
            let px: number;
            let py: number;
            let angle = 0;
            if (distance < width) {
                px = left + distance;
                py = top + 3;
            } else if ((distance -= width) < height) {
                px = right - 3;
                py = top + distance;
                angle = Math.PI / 2;
            } else if ((distance -= height) < width) {
                px = right - distance;
                py = bottom - 3;
            } else {
                distance -= width;
                px = left + 3;
                py = bottom - distance;
                angle = Math.PI / 2;
            }
            const stoneWidth = 8 + terrainHash(stone, 5, salt) * 7;
            const stoneHeight = 3.5 + terrainHash(5, stone, salt) * 2.5;
            context.save();
            context.translate(px, py);
            context.rotate(angle + (terrainHash(stone, salt, 2221) - .5) * .24);
            context.fillStyle = stone % 3 === 0 ? "#777765" : "#555d54";
            context.strokeStyle = "rgba(17, 24, 22, .88)";
            context.lineWidth = 1.5;
            context.beginPath();
            context.ellipse(0, 0, stoneWidth, stoneHeight, 0, 0, Math.PI * 2);
            context.fill();
            context.stroke();
            context.strokeStyle = "rgba(198, 167, 105, .36)";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(-stoneWidth * .16, -stoneHeight * .2, Math.max(1, stoneHeight * .34), Math.PI, Math.PI * 1.72);
            context.stroke();
            context.restore();
        }

        const columns = Math.max(2, Math.ceil(bed.width * 1.35));
        const rows = Math.max(2, Math.ceil(bed.height * 1.25));
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                if (terrainHash(column, row, salt) < .25) continue;
                const px = left + (column + .5) * width / columns + (terrainHash(row, column, salt + 11) - .5) * 12;
                const py = top + (row + .5) * height / rows + (terrainHash(column, row, salt + 23) - .5) * 10;
                const radius = 6.5 + terrainHash(column, row, salt + 37) * 5.5;
                const warm = terrainHash(row, column, salt + 41) > .78;
                context.fillStyle = "rgba(2, 7, 6, .64)";
                context.beginPath();
                context.ellipse(px + 2, py + 5, radius * 1.05, radius * .5, 0, 0, Math.PI * 2);
                context.fill();
                context.strokeStyle = warm ? "#714123" : "#254635";
                context.lineWidth = 1.4;
                context.beginPath();
                context.moveTo(px, py + 5);
                context.lineTo(px - 1, py - radius * .6);
                context.stroke();
                for (let lobe = 0; lobe < 5; lobe += 1) {
                    const angle = lobe / 5 * Math.PI * 2 + terrainHash(lobe, row, salt) * .45;
                    const leafX = px + Math.cos(angle) * radius * .48;
                    const leafY = py + Math.sin(angle) * radius * .34;
                    context.fillStyle = warm
                        ? (lobe % 2 ? "#985a2c" : "#bd7535")
                        : (lobe % 2 ? "#315e42" : "#47744e");
                    context.beginPath();
                    context.ellipse(leafX, leafY, radius * .58, radius * .32, angle, 0, Math.PI * 2);
                    context.fill();
                }
                context.fillStyle = warm ? "rgba(237, 155, 62, .76)" : "rgba(133, 171, 92, .7)";
                context.beginPath();
                context.arc(px - radius * .2, py - radius * .24, Math.max(1.2, radius * .17), 0, Math.PI * 2);
                context.fill();
            }
        }
    }

    // Small copper leaves stitch the public threshold lane to both planted
    // strips without turning the route into a decorative ground rectangle.
    context.save();
    for (let leaf = 0; leaf < 34; leaf += 1) {
        const worldX = (57.2 + terrainHash(leaf, 14, 2039) * 21.3) * size;
        const worldY = (12.7 + terrainHash(14, leaf, 2053) * 2.5) * size;
        const x = worldX - camera.x;
        const y = worldY - camera.y;
        context.fillStyle = leaf % 4 === 0 ? "rgba(229, 144, 54, .72)" : "rgba(145, 80, 39, .62)";
        context.beginPath();
        context.ellipse(x, y, 2.4, 1.1, terrainHash(leaf, 7, 2081) * Math.PI, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function _drawGardensNorthPlantings(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const isSolid = (mask: readonly string[], x: number, y: number) => (
        y >= 0 && y < mask.length && x >= 0 && x < mask[y].length && mask[y][x] === "#"
    );

    for (const planting of FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS) {
        const { bounds, collisionMask } = planting;
        const cellPath = new Path2D();
        for (let localY = 0; localY < collisionMask.length; localY += 1) {
            for (let localX = 0; localX < collisionMask[localY].length; localX += 1) {
                if (!isSolid(collisionMask, localX, localY)) continue;
                const left = (bounds.x + localX) * size - camera.x;
                const top = (bounds.y + localY) * size - camera.y;
                const insetLeft = isSolid(collisionMask, localX - 1, localY) ? 0 : 4;
                const insetRight = isSolid(collisionMask, localX + 1, localY) ? 0 : 4;
                const insetTop = isSolid(collisionMask, localX, localY - 1) ? 0 : 7;
                const insetBottom = isSolid(collisionMask, localX, localY + 1) ? 0 : 6;
                cellPath.rect(
                    left + insetLeft,
                    top + insetTop,
                    size - insetLeft - insetRight,
                    size - insetTop - insetBottom,
                );
            }
        }

        context.save();
        context.shadowColor = "rgba(0, 0, 0, .42)";
        context.shadowBlur = 5;
        context.shadowOffsetY = 4;
        context.fillStyle = "#343b3b";
        context.fill(cellPath);
        context.shadowColor = "transparent";
        context.lineJoin = "round";

        for (let localY = 0; localY < collisionMask.length; localY += 1) {
            for (let localX = 0; localX < collisionMask[localY].length; localX += 1) {
                if (!isSolid(collisionMask, localX, localY)) continue;
                const left = (bounds.x + localX) * size - camera.x;
                const top = (bounds.y + localY) * size - camera.y;
                const connectedLeft = isSolid(collisionMask, localX - 1, localY);
                const connectedRight = isSolid(collisionMask, localX + 1, localY);
                const connectedTop = isSolid(collisionMask, localX, localY - 1);
                const connectedBottom = isSolid(collisionMask, localX, localY + 1);
                const soilLeft = left + (connectedLeft ? 0 : 9);
                const soilRight = left + size - (connectedRight ? 0 : 9);
                const soilTop = top + (connectedTop ? 0 : 12);
                const soilBottom = top + size - (connectedBottom ? 0 : 10);
                context.fillStyle = localX % 2 === localY % 2 ? "#25231b" : "#29251b";
                context.fillRect(soilLeft, soilTop, soilRight - soilLeft, soilBottom - soilTop);

                const worldX = bounds.x + localX;
                const worldY = bounds.y + localY;
                for (let sprig = 0; sprig < 4; sprig += 1) {
                    const px = left + 10 + terrainHash(worldX, worldY, 2411 + sprig * 13) * 28;
                    const py = top + 14 + terrainHash(worldY, worldX, 2473 + sprig * 17) * 23;
                    const warm = terrainHash(worldX + sprig, worldY, 2503) > .7;
                    context.strokeStyle = warm ? "#744226" : "#31533d";
                    context.lineWidth = 1.5;
                    context.beginPath();
                    context.moveTo(px, py + 5);
                    context.lineTo(px, py - 5);
                    context.stroke();
                    for (const side of [-1, 1]) {
                        context.fillStyle = warm ? (sprig % 2 ? "#bd7132" : "#9b4d28") : (sprig % 2 ? "#496f48" : "#355b3d");
                        context.beginPath();
                        context.ellipse(px + side * 4, py - 1, 5.5, 2.5, side * .45, 0, Math.PI * 2);
                        context.fill();
                    }
                    context.fillStyle = warm ? "#e49b43" : "#81965c";
                    context.beginPath();
                    context.arc(px, py - 5, 2, 0, Math.PI * 2);
                    context.fill();
                }

                context.strokeStyle = "rgba(159, 139, 98, .56)";
                context.lineWidth = 1.2;
                if (!connectedTop) {
                    context.beginPath();
                    context.moveTo(left + 8, top + 8);
                    context.lineTo(left + size - 8, top + 8);
                    context.stroke();
                }
                if (!connectedBottom) {
                    context.beginPath();
                    context.moveTo(left + 8, top + size - 7);
                    context.lineTo(left + size - 8, top + size - 7);
                    context.stroke();
                }
            }
        }
        context.restore();
    }
}

function _drawGardensNorthAutumnTrees(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const colors = ["#6d261d", "#8c321d", "#a84c22", "#c36728", "#d98732", "#e5a13d"] as const;
    for (const tree of FIRST_PACT_GARDENS_NORTH_TREES) {
        const rootX = (tree.root.x + .5) * size - camera.x;
        const rootY = (tree.root.y + .92) * size - camera.y;
        const crownLeft = tree.bounds.x * size - camera.x;
        const crownTop = tree.bounds.y * size - camera.y;
        const crownWidth = tree.bounds.width * size;
        const crownHeight = tree.bounds.height * size;
        const centerX = crownLeft + crownWidth * .5;
        const centerY = crownTop + crownHeight * .48;

        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(7, 6, 7, .8)";
        context.lineWidth = 23;
        context.beginPath();
        context.moveTo(rootX, rootY);
        context.bezierCurveTo(rootX - 8, rootY - crownHeight * .2, centerX + 10, centerY + crownHeight * .18, centerX, centerY - 8);
        context.stroke();
        context.strokeStyle = "#4c2d21";
        context.lineWidth = 16;
        context.stroke();
        context.strokeStyle = "rgba(159, 101, 52, .48)";
        context.lineWidth = 3;
        context.stroke();

        for (let branch = 0; branch < 7; branch += 1) {
            const side = branch % 2 ? 1 : -1;
            const branchStartY = rootY - crownHeight * (.22 + branch * .055);
            const branchEndX = centerX + side * crownWidth * (.18 + terrainHash(branch, tree.hue, 2539) * .27);
            const branchEndY = crownTop + crownHeight * (.22 + terrainHash(tree.hue, branch, 2557) * .5);
            context.strokeStyle = "#3a231d";
            context.lineWidth = Math.max(3, 9 - branch * .7);
            context.beginPath();
            context.moveTo(rootX + side * 2, branchStartY);
            context.quadraticCurveTo(centerX + side * crownWidth * .08, branchEndY + 16, branchEndX, branchEndY);
            context.stroke();
        }

        const clusters: Array<{ x: number; y: number; radius: number; shade: number }> = [];
        for (let index = 0; index < 34; index += 1) {
            const angle = terrainHash(index, tree.hue, 2591) * Math.PI * 2;
            const radial = Math.sqrt(terrainHash(tree.hue, index, 2617)) * .9;
            clusters.push({
                x: centerX + Math.cos(angle) * crownWidth * .43 * radial,
                y: centerY + Math.sin(angle) * crownHeight * .41 * radial,
                radius: 13 + terrainHash(index, tree.hue, 2647) * 16,
                shade: Math.floor(terrainHash(tree.hue, index, 2671) * colors.length),
            });
        }
        clusters.sort((a, b) => a.y - b.y);
        for (const [index, cluster] of clusters.entries()) {
            context.fillStyle = "rgba(18, 8, 9, .62)";
            context.beginPath();
            context.ellipse(cluster.x + 3, cluster.y + 6, cluster.radius * 1.05, cluster.radius * .72, 0, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = colors[Math.min(colors.length - 1, cluster.shade)];
            context.beginPath();
            context.ellipse(
                cluster.x,
                cluster.y,
                cluster.radius,
                cluster.radius * (.66 + terrainHash(index, tree.hue, 2699) * .14),
                (terrainHash(tree.hue, index, 2711) - .5) * .7,
                0,
                Math.PI * 2,
            );
            context.fill();
            context.fillStyle = index % 4 === 0 ? "rgba(244, 174, 65, .68)" : "rgba(229, 113, 39, .5)";
            context.beginPath();
            context.ellipse(cluster.x - cluster.radius * .22, cluster.y - cluster.radius * .28, cluster.radius * .28, cluster.radius * .14, -.4, 0, Math.PI * 2);
            context.fill();
        }

        // Three short roots visibly terminate in the bed cell that owns the
        // tree's collision, with no circular base or ground decal.
        context.strokeStyle = "#3c271f";
        context.lineWidth = 8;
        for (const offset of [-17, 0, 17]) {
            context.beginPath();
            context.moveTo(rootX, rootY - 5);
            context.quadraticCurveTo(rootX + offset * .45, rootY + 1, rootX + offset, rootY + 5);
            context.stroke();
        }
        context.restore();
    }
}

function drawGardensNorthTreeModules(
    context: CanvasRenderingContext2D,
    camera: Camera,
    mapleA?: HTMLImageElement | null,
    mapleB?: HTMLImageElement | null,
): void {
    for (const tree of FIRST_PACT_GARDENS_NORTH_TREES) {
        const treeArt = tree.gardenAsset === "maple-a" ? mapleA : mapleB;
        if (!treeArt?.complete || treeArt.naturalWidth <= 0 || treeArt.naturalHeight <= 0) continue;
        const x = tree.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
        const y = tree.bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
        const width = tree.bounds.width * FIRST_PACT_TILE_SIZE;
        const height = tree.bounds.height * FIRST_PACT_TILE_SIZE;
        if (x >= camera.width || y >= camera.height || x + width <= 0 || y + height <= 0) continue;
        context.save();
        context.translate(tree.flip ? x + width : x, y);
        context.scale(tree.flip ? -1 : 1, 1);
        context.shadowColor = "rgba(0, 0, 0, .34)";
        context.shadowBlur = 5;
        context.shadowOffsetX = 2;
        context.shadowOffsetY = 5;
        context.drawImage(treeArt, 0, 0, width, height);
        context.restore();
    }
}

function drawGardensNorthGardenModules(
    context: CanvasRenderingContext2D,
    camera: Camera,
    longBed?: HTMLImageElement | null,
    cornerBed?: HTMLImageElement | null,
): void {
    for (const bed of [
        ...FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS,
        ...FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS,
    ]) {
        const gardenArt = bed.gardenAsset === "long" ? longBed : cornerBed;
        if (!gardenArt?.complete || gardenArt.naturalWidth <= 0 || gardenArt.naturalHeight <= 0) continue;
        const x = bed.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
        const y = bed.bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
        const width = bed.bounds.width * FIRST_PACT_TILE_SIZE;
        const height = bed.bounds.height * FIRST_PACT_TILE_SIZE;
        if (x >= camera.width || y >= camera.height || x + width <= 0 || y + height <= 0) continue;
        context.save();
        context.shadowColor = "rgba(0, 0, 0, .32)";
        context.shadowBlur = 4;
        context.shadowOffsetY = 4;
        context.drawImage(gardenArt, x, y, width, height);
        context.restore();
    }
}

/** Four compact, collision-backed archive gardens give the campus measured
 * enclosure while leaving the authored court paving legible between them. */
function drawHighCourtGardens(
    context: CanvasRenderingContext2D,
    camera: Camera,
    gardens?: HTMLImageElement | null,
): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    const parapet = FIRST_PACT_HIGH_COURT_PARAPET.bounds;
    for (let x = parapet.x; x < parapet.x + parapet.width; x += 1) {
        drawGlobalPavers(
            context,
            x,
            parapet.y,
            sx(x),
            sy(parapet.y),
            ["#1c2831", "#202d35", "#18242d"],
            "#0b1219",
            32,
            18,
            2591,
        );
    }
    const parapetLeft = sx(parapet.x);
    const parapetTop = sy(parapet.y);
    const parapetWidth = parapet.width * size;
    const parapetHeight = parapet.height * size;
    const wallShade = context.createLinearGradient(0, parapetTop + 22, 0, parapetTop + parapetHeight);
    wallShade.addColorStop(0, "rgba(12, 20, 27, .08)");
    wallShade.addColorStop(1, "rgba(3, 8, 13, .58)");
    context.fillStyle = wallShade;
    context.fillRect(parapetLeft, parapetTop + 18, parapetWidth, parapetHeight - 18);
    context.strokeStyle = "rgba(123, 139, 136, .48)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(parapetLeft, parapetTop + 5);
    context.lineTo(parapetLeft + parapetWidth, parapetTop + 5);
    context.stroke();
    context.strokeStyle = "rgba(8, 14, 19, .88)";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(parapetLeft, parapetTop + parapetHeight - 3);
    context.lineTo(parapetLeft + parapetWidth, parapetTop + parapetHeight - 3);
    context.stroke();
    context.strokeStyle = "rgba(133, 104, 59, .28)";
    context.lineWidth = 1;
    for (let joint = 2; joint < parapet.width; joint += 2) {
        const jointX = sx(parapet.x + joint);
        context.beginPath();
        context.moveTo(jointX, parapetTop + 8);
        context.lineTo(jointX - 4, parapetTop + parapetHeight - 7);
        context.stroke();
    }

    if (!gardens?.complete || gardens.naturalWidth <= 0 || gardens.naturalHeight <= 0) return;
    const sourceWidth = gardens.naturalWidth / FIRST_PACT_HIGH_COURT_GARDEN_BEDS.length;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const garden of FIRST_PACT_HIGH_COURT_GARDEN_BEDS) {
        const { bounds, gardenCell } = garden;
        context.drawImage(
            gardens,
            gardenCell * sourceWidth,
            0,
            sourceWidth,
            gardens.naturalHeight,
            sx(bounds.x),
            sy(bounds.y),
            bounds.width * size,
            bounds.height * size,
        );
    }
    context.restore();
}

function drawGroundEdges(context: CanvasRenderingContext2D, camera: Camera): void {
    const firstX = Math.max(0, Math.floor(camera.x / FIRST_PACT_TILE_SIZE) - 1);
    const lastX = Math.min(FIRST_PACT_WORLD_WIDTH - 1, Math.ceil((camera.x + camera.width) / FIRST_PACT_TILE_SIZE) + 1);
    const firstY = Math.max(0, Math.floor(camera.y / FIRST_PACT_TILE_SIZE) - 1);
    const lastY = Math.min(FIRST_PACT_WORLD_HEIGHT - 1, Math.ceil((camera.y + camera.height) / FIRST_PACT_TILE_SIZE) + 1);
    const sides = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }] as const;
    for (let y = firstY; y <= lastY; y += 1) {
        for (let x = firstX; x <= lastX; x += 1) {
            const tile = firstPactTileAt(x, y);
            const screenX = x * FIRST_PACT_TILE_SIZE - camera.x;
            const screenY = y * FIRST_PACT_TILE_SIZE - camera.y;
            const bellRoute = isFirstPactBellRoute(x, y);
            for (const side of sides) {
                const neighbor = firstPactTileAt(x + side.dx, y + side.dy);
                const crossing = isCanalCrossingTile(x, y);
                const neighboringCrossing = isCanalCrossingTile(x + side.dx, y + side.dy);
                const neighboringBridge = neighbor === FirstPactTile.Bridge;
                const marketCanalTile = x >= 75 && x <= 76 && y >= 20 && y <= 42;
                if (tile === FirstPactTile.Road && neighbor === FirstPactTile.Market && !crossing) {
                    context.lineCap = "butt";
                    context.lineWidth = 2;
                    context.strokeStyle = "rgba(23, 31, 35, .62)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 1);
                    context.lineWidth = 1;
                    context.strokeStyle = "rgba(154, 119, 67, .22)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 2.5);
                } else if ((tile === FirstPactTile.Road || tile === FirstPactTile.Stairs) && !crossing && !isKennelBoulevardTile(x, y) && !isCivicTravelSurface(neighbor) && neighbor !== FirstPactTile.Kennel) {
                    context.lineCap = "butt";
                    if (bellRoute) {
                        context.lineWidth = 10;
                        context.strokeStyle = "rgba(14, 25, 22, .9)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 4.5);
                        context.lineWidth = 6;
                        context.strokeStyle = "rgba(48, 84, 59, .86)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 4.5);
                        context.lineWidth = 2;
                        context.strokeStyle = "rgba(126, 139, 103, .6)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 6.5);
                    } else {
                        context.lineWidth = 9;
                        context.strokeStyle = "rgba(11, 17, 22, .88)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 4.5);
                        context.lineWidth = 5;
                        context.strokeStyle = "rgba(104, 116, 124, .88)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 4.5);
                        context.lineWidth = 1;
                        context.strokeStyle = "rgba(181, 139, 75, .52)";
                        strokeTileSide(context, screenX, screenY, side.dx, side.dy, 7.5);
                    }
                } else if (tile === FirstPactTile.Water && neighbor !== FirstPactTile.Water && neighbor !== FirstPactTile.Void && !neighboringBridge && !marketCanalTile) {
                    context.lineCap = "butt";
                    context.lineWidth = neighboringCrossing ? 13 : 11;
                    context.strokeStyle = neighboringCrossing ? "rgba(36, 39, 39, .98)" : "rgba(20, 27, 31, .98)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 5.5);
                    context.lineWidth = 3;
                    context.strokeStyle = "rgba(111, 103, 82, .7)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 10);
                    context.lineWidth = 1;
                    context.strokeStyle = "rgba(43, 166, 179, .38)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 1.5);
                } else if (crossing && side.dy !== 0 && !neighboringCrossing && !(x >= 75 && x <= 76)) {
                    context.lineCap = "butt";
                    context.lineWidth = 8;
                    context.strokeStyle = "rgba(10, 14, 17, .92)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 4);
                    context.lineWidth = 2;
                    context.strokeStyle = "rgba(151, 111, 58, .66)";
                    strokeTileSide(context, screenX, screenY, side.dx, side.dy, 7);
                }
            }

            const east = firstPactTileAt(x + 1, y);
            const south = firstPactTileAt(x, y + 1);
            const districtField = tile === FirstPactTile.Stone || tile === FirstPactTile.Grass
                || tile === FirstPactTile.Garden || tile === FirstPactTile.Market
                || tile === FirstPactTile.Kennel || tile === FirstPactTile.Grate;
            if (districtField && east !== tile && !isContinuousPavingTransition(tile, east) && !isCivicTravelSurface(east) && east !== FirstPactTile.Water && east !== FirstPactTile.Void) {
                context.lineWidth = 3;
                context.strokeStyle = "rgba(7, 11, 14, .64)";
                strokeTileSide(context, screenX, screenY, 1, 0, 1.5);
            }
            if (districtField && south !== tile && !isContinuousPavingTransition(tile, south) && !isCivicTravelSurface(south) && south !== FirstPactTile.Water && south !== FirstPactTile.Void) {
                context.lineWidth = 3;
                context.strokeStyle = "rgba(7, 11, 14, .64)";
                strokeTileSide(context, screenX, screenY, 0, 1, 1.5);
            }
        }
    }
}

function drawMarketCanalInfrastructure(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const canalLeft = 75 * size - camera.x;
    const canalRight = 77 * size - camera.x;
    const canalTop = 20 * size - camera.y;
    const canalBottom = 43 * size - camera.y;
    const bridgeTop = 29 * size - camera.y;
    const bridgeBottom = 31 * size - camera.y;
    if (canalLeft >= camera.width || canalRight <= 0 || canalTop >= camera.height || canalBottom <= 0) return;

    const bankSegments = [
        { worldTop: 20 * size, worldBottom: 29 * size },
        { worldTop: 31 * size, worldBottom: 43 * size },
    ] as const;
    context.save();
    for (const segment of bankSegments) {
        const top = segment.worldTop - camera.y;
        const height = segment.worldBottom - segment.worldTop;
        for (const west of [true, false]) {
            const edge = west ? canalLeft : canalRight;
            const x = west ? edge - 10 : edge - 5;
            const width = 15;
            context.fillStyle = "rgba(2, 7, 10, .82)";
            context.fillRect(x - 2, top, width + 4, height);
            const bank = context.createLinearGradient(x, 0, x + width, 0);
            if (west) {
                bank.addColorStop(0, "#151f24");
                bank.addColorStop(.28, "#59605d");
                bank.addColorStop(.62, "#303c3f");
                bank.addColorStop(1, "#0a3139");
            } else {
                bank.addColorStop(0, "#0a3139");
                bank.addColorStop(.38, "#303c3f");
                bank.addColorStop(.72, "#59605d");
                bank.addColorStop(1, "#151f24");
            }
            context.fillStyle = bank;
            context.fillRect(x, top, width, height);
            context.strokeStyle = "rgba(7, 13, 16, .78)";
            context.lineWidth = 1;
            const firstJoint = Math.ceil(segment.worldTop / 24) * 24;
            for (let globalY = firstJoint; globalY < segment.worldBottom; globalY += 24) {
                const jointY = globalY - camera.y + .5;
                context.beginPath();
                context.moveTo(x + 1, jointY);
                context.lineTo(x + width - 1, jointY);
                context.stroke();
            }
            context.strokeStyle = west ? "rgba(74, 190, 192, .38)" : "rgba(57, 159, 169, .32)";
            context.beginPath();
            context.moveTo(west ? edge + 3.5 : edge - 3.5, top);
            context.lineTo(west ? edge + 3.5 : edge - 3.5, top + height);
            context.stroke();
        }
    }

    // A single overlay binds the four crossing tiles into one two-tile bridge.
    context.fillStyle = "rgba(142, 96, 45, .055)";
    context.fillRect(canalLeft, bridgeTop, canalRight - canalLeft, bridgeBottom - bridgeTop);
    for (const y of [bridgeTop, bridgeBottom]) {
        context.lineCap = "butt";
        context.strokeStyle = "rgba(5, 10, 13, .94)";
        context.lineWidth = 9;
        context.beginPath();
        context.moveTo(canalLeft - 7, y);
        context.lineTo(canalRight + 7, y);
        context.stroke();
        context.strokeStyle = "#4d5959";
        context.lineWidth = 5;
        context.stroke();
        context.strokeStyle = "rgba(168, 127, 70, .68)";
        context.lineWidth = 1;
        context.stroke();
    }

    const abutments = [
        { x: canalLeft - 11, y: bridgeTop - 9 },
        { x: canalRight - 7, y: bridgeTop - 9 },
        { x: canalLeft - 11, y: bridgeBottom - 9 },
        { x: canalRight - 7, y: bridgeBottom - 9 },
    ] as const;
    for (const abutment of abutments) {
        context.fillStyle = "rgba(2, 7, 10, .8)";
        context.fillRect(abutment.x - 2, abutment.y + 3, 22, 18);
        context.fillStyle = "#313c3f";
        context.fillRect(abutment.x, abutment.y, 18, 18);
        context.fillStyle = "#5a625e";
        context.fillRect(abutment.x + 2, abutment.y + 2, 14, 6);
        context.strokeStyle = "rgba(11, 17, 19, .86)";
        context.lineWidth = 1;
        context.strokeRect(abutment.x + .5, abutment.y + .5, 17, 17);
    }

    // The workshop wheel sits in a recessed cradle cut into the west coping.
    // These two water-side sills render beneath the wheel sprite, so the wheel
    // remains the foreground silhouette while visibly meeting real canal work.
    const cradleTop = 36.05 * size - camera.y;
    const cradleBottom = 37.55 * size - camera.y;
    context.fillStyle = "#09191e";
    context.fillRect(canalLeft - 8, cradleTop, 14, cradleBottom - cradleTop);
    for (const sillY of [cradleTop - 4, cradleBottom - 4]) {
        context.fillStyle = "rgba(3, 8, 10, .8)";
        context.fillRect(canalLeft - 9, sillY + 3, 28, 10);
        context.fillStyle = "#3f4b4a";
        context.fillRect(canalLeft - 8, sillY, 25, 8);
        context.fillStyle = "rgba(163, 116, 58, .52)";
        context.fillRect(canalLeft - 6, sillY + 1, 21, 1);
    }
    context.restore();
}

/** The citywide boulevard's central Aqueduct span. The tile pass already
 * paints the complete deck with the approach renderer; this pass adds only
 * water mouths, two low curbs, and four bank-backed abutments. */
function drawAqueductCentralCivicCrossing(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;
    const crossing = FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING;
    const deckLeft = sx(crossing.deck.x);
    const deckRight = sx(crossing.deck.x + crossing.deck.width);
    const bridgeTop = sy(crossing.deck.y);
    const bridgeBottom = sy(crossing.deck.y + crossing.deck.height);
    if (deckLeft >= camera.width || deckRight <= 0 || bridgeTop >= camera.height || bridgeBottom <= 0) return;

    const mouths = [
        {
            left: sx(crossing.northMouth.x),
            right: sx(crossing.northMouth.x + crossing.northMouth.width),
            edgeY: bridgeTop,
            south: false,
        },
        {
            left: sx(crossing.southMouth.x),
            right: sx(crossing.southMouth.x + crossing.southMouth.width),
            edgeY: bridgeBottom,
            south: true,
        },
    ] as const;

    context.save();
    // The dark lips occupy only the collision-solid water width immediately
    // outside each deck edge. Their unequal widths honestly show the historic
    // two-to-three-tile channel transition continuing beneath the boulevard.
    for (const mouth of mouths) {
        const lip = new Path2D();
        const innerY = mouth.edgeY + (mouth.south ? 11 : -11);
        const edgeY = mouth.edgeY + (mouth.south ? 2 : -2);
        lip.moveTo(mouth.left + 8, edgeY);
        lip.lineTo(mouth.left + 15, innerY);
        lip.lineTo(mouth.right - 15, innerY);
        lip.lineTo(mouth.right - 8, edgeY);
        lip.closePath();
        context.fillStyle = "#061318";
        context.fill(lip);
        context.strokeStyle = "rgba(45, 160, 171, .42)";
        context.lineWidth = 1;
        context.stroke(lip);
    }

    // Low segmented curbs identify the span without occupying its four-tile
    // avatar corridor or repainting the world-aligned deck surface.
    for (const [row, mouth] of mouths.entries()) {
        const curbY = mouth.south ? bridgeBottom - 5 : bridgeTop + 5;
        context.fillStyle = "rgba(2, 7, 9, .9)";
        context.fillRect(mouth.left - 2, curbY - 4, mouth.right - mouth.left + 4, 10);
        let block = 0;
        for (let blockX = mouth.left + 3; blockX < mouth.right - 3; blockX += 24) {
            const blockWidth = Math.min(20, mouth.right - 3 - blockX);
            const blockHeight = block % 3 === 1 ? 7 : 9;
            context.fillStyle = ["#4a5552", "#394747", "#59605a"][(block + row) % 3];
            context.fillRect(blockX, curbY - Math.ceil(blockHeight / 2), blockWidth, blockHeight);
            context.fillStyle = "rgba(178, 132, 69, .32)";
            context.fillRect(blockX + 3, curbY - Math.ceil(blockHeight / 2) + 1, Math.max(2, blockWidth - 6), 1);
            block += 1;
        }
    }

    // These are the four literal bank corners from world authority: the north
    // pair lands on the two-tile Gardens reach, while the south-east block steps
    // out with the widened lower channel. Nothing is floated into the water.
    for (const abutment of crossing.abutments) {
        const west = abutment.x === crossing.westLanding.x;
        const north = abutment.y === crossing.northMouth.y;
        const bankEdgeX = sx(west ? abutment.x + 1 : abutment.x);
        const left = bankEdgeX + (west ? -13 : -5);
        const top = north ? bridgeTop + 2 : bridgeBottom - 19;
        context.fillStyle = "rgba(2, 7, 9, .88)";
        context.fillRect(left - 3, top + 3, 22, 20);
        context.fillStyle = "#414d4b";
        context.fillRect(left, top, 17, 17);
        context.fillStyle = "#697068";
        context.fillRect(left + 2, top + 2, 13, 5);
        context.strokeStyle = "rgba(155, 111, 58, .52)";
        context.lineWidth = 1;
        context.strokeRect(left + .5, top + .5, 16, 16);
    }
    context.restore();
}

/** Collision-backed stonework for the lower Aqueduct civic crossing. The map
 * already owns every bank and deck cell; this pass adds only the visible inner
 * coping, bridge parapets, abutments, and sluice anchors that make that truth
 * legible at play scale. */
function drawAqueductCivicBoulevardInfrastructure(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;
    const aqueduct = FIRST_PACT_AQUEDUCT_CIVIC_CROSSING;
    const waterLeft = sx(aqueduct.water.x);
    const waterRight = sx(aqueduct.water.x + aqueduct.water.width);
    const bridgeTop = sy(aqueduct.deck.y);
    const bridgeBottom = sy(aqueduct.deck.y + aqueduct.deck.height);
    const bankTop = sy(aqueduct.westBankNorth.y);
    const bankBottom = sy(aqueduct.eastBankSouth.y + aqueduct.eastBankSouth.height);
    if (waterLeft >= camera.width || waterRight <= 0 || bankTop >= camera.height || bankBottom <= 0) return;

    const bankSegments = [
        { ...aqueduct.westBankNorth, west: true },
        { ...aqueduct.westBankSouth, west: true },
        { ...aqueduct.eastBankNorth, west: false },
        { ...aqueduct.eastBankSouth, west: false },
    ] as const;

    context.save();
    for (const segment of bankSegments) {
        const top = sy(segment.y);
        const bottom = sy(segment.y + segment.height);
        const copingLeft = segment.west ? waterLeft - 12 : waterRight;
        context.fillStyle = "rgba(2, 7, 10, .9)";
        context.fillRect(copingLeft - 2, top, 16, bottom - top);
        const firstBlock = Math.ceil(segment.y * size / 24);
        const lastBlock = Math.floor(((segment.y + segment.height) * size - 3) / 24);
        for (let block = firstBlock; block <= lastBlock; block += 1) {
            const blockY = block * 24 - camera.y + 2;
            context.fillStyle = block % 3 === 0 ? "#56605d" : block % 2 === 0 ? "#414d4d" : "#354346";
            context.fillRect(copingLeft, blockY, 12, 19);
            context.fillStyle = "rgba(174, 132, 72, .28)";
            context.fillRect(copingLeft + 2, blockY + 1, 8, 1);
            context.fillStyle = "rgba(5, 12, 15, .72)";
            context.fillRect(copingLeft + (segment.west ? 10 : 0), blockY + 2, 2, 17);
        }
    }

    // Two compact buttresses receive the existing sluice assembly. The machine
    // now visibly bears on both collision-solid banks instead of floating in a
    // featureless teal strip.
    const controlTop = sy(aqueduct.control.y + .82);
    const controlBottom = sy(aqueduct.control.y + aqueduct.control.height - .08);
    for (const left of [waterLeft - 26, waterRight + 4]) {
        context.fillStyle = "rgba(2, 7, 10, .82)";
        context.fillRect(left - 3, controlTop + 4, 25, controlBottom - controlTop);
        context.fillStyle = "#303b3d";
        context.fillRect(left, controlTop, 19, controlBottom - controlTop - 2);
        context.fillStyle = "#5a5f58";
        context.fillRect(left + 2, controlTop + 2, 15, 6);
        context.strokeStyle = "rgba(159, 112, 54, .44)";
        context.lineWidth = 1;
        context.strokeRect(left + .5, controlTop + .5, 18, controlBottom - controlTop - 3);
    }
    context.fillStyle = "rgba(2, 7, 10, .9)";
    context.fillRect(waterLeft - 9, controlBottom - 10, waterRight - waterLeft + 18, 12);
    context.fillStyle = "#394547";
    context.fillRect(waterLeft - 6, controlBottom - 11, waterRight - waterLeft + 12, 7);
    context.fillStyle = "rgba(169, 120, 57, .42)";
    context.fillRect(waterLeft - 3, controlBottom - 10, waterRight - waterLeft + 6, 1);

    // Dark, chamfered mouths show the water continuing beneath the deck. They
    // occupy only the actual channel width and never masquerade as walkable art.
    for (const [mouthY, south] of [[bridgeTop, false], [bridgeBottom, true]] as const) {
        const lip = new Path2D();
        const top = mouthY + (south ? -5 : -8);
        lip.moveTo(waterLeft + 9, top + (south ? 0 : 8));
        lip.lineTo(waterLeft + 16, top + (south ? 8 : 0));
        lip.lineTo(waterRight - 16, top + (south ? 8 : 0));
        lip.lineTo(waterRight - 9, top + (south ? 0 : 8));
        lip.closePath();
        context.fillStyle = "#071216";
        context.fill(lip);
        context.strokeStyle = "rgba(49, 154, 165, .4)";
        context.lineWidth = 1;
        context.stroke(lip);
    }

    // The road deck keeps the same world-aligned pavers as its approaches;
    // discrete low parapet blocks alone identify the bridge silhouette.
    for (const [row, railY] of [bridgeTop + 5, bridgeBottom - 6].entries()) {
        context.fillStyle = "rgba(2, 7, 9, .88)";
        context.fillRect(waterLeft - 2, railY - 4, waterRight - waterLeft + 4, 10);
        let blockIndex = 0;
        for (let blockX = waterLeft + 3; blockX < waterRight - 3; blockX += 24) {
            const blockWidth = Math.min(20, waterRight - 3 - blockX);
            const blockHeight = blockIndex % 3 === 1 ? 7 : 9;
            context.fillStyle = ["#4a5552", "#394747", "#59605a"][(blockIndex + row) % 3];
            context.fillRect(blockX, railY - Math.ceil(blockHeight / 2), blockWidth, blockHeight);
            context.fillStyle = "rgba(178, 132, 69, .3)";
            context.fillRect(blockX + 3, railY - Math.ceil(blockHeight / 2) + 1, Math.max(2, blockWidth - 6), 1);
            blockIndex += 1;
        }
    }

    for (const abutmentX of [waterLeft - 13, waterRight - 5]) {
        for (const abutmentY of [bridgeTop + 2, bridgeBottom - 20]) {
            context.fillStyle = "rgba(2, 7, 9, .86)";
            context.fillRect(abutmentX - 3, abutmentY + 3, 22, 20);
            context.fillStyle = "#414d4b";
            context.fillRect(abutmentX, abutmentY, 17, 17);
            context.fillStyle = "#697068";
            context.fillRect(abutmentX + 2, abutmentY + 2, 13, 5);
            context.strokeStyle = "rgba(155, 111, 58, .5)";
            context.strokeRect(abutmentX + .5, abutmentY + .5, 16, 16);
        }
    }
    context.restore();
}

/** The Gardens bridge lands on two collision-authoritative masonry banks.
 * Each bank stops at the real Bridge rows, while broken stone courses and
 * short block parapets keep the canal from reading as a cropped teal plate. */
function drawGardensAqueductEmbankment(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;
    const aqueduct = FIRST_PACT_GARDENS_AQUEDUCT;
    const bankTop = sy(aqueduct.westBank.y);
    const bankBottom = sy(aqueduct.westBank.y + aqueduct.westBank.height);
    const seamLeft = sx(aqueduct.westBank.x);
    const seamRight = sx(aqueduct.eastBank.x + aqueduct.eastBank.width);
    if (seamLeft >= camera.width || seamRight <= 0 || bankTop >= camera.height || bankBottom <= 0) return;

    const bridgeTopWorld = aqueduct.deck.y;
    const bridgeBottomWorld = aqueduct.deck.y + aqueduct.deck.height;
    const bankSegments = [
        { top: aqueduct.westBank.y, bottom: bridgeTopWorld },
        { top: bridgeBottomWorld, bottom: aqueduct.westBank.y + aqueduct.westBank.height },
    ] as const;

    const drawBankSegment = (west: boolean, topWorld: number, bottomWorld: number, salt: number) => {
        const bankX = west ? aqueduct.westBank.x : aqueduct.eastBank.x;
        const left = sx(bankX);
        const top = sy(topWorld);
        const bottom = sy(bottomWorld);
        const waterEdge = west ? left + size : left;
        const bank = new Path2D();
        if (west) {
            bank.moveTo(left + 5, top);
            bank.lineTo(waterEdge, top);
            bank.lineTo(waterEdge, bottom);
            bank.lineTo(left + 6, bottom);
            for (let worldY = bottomWorld; worldY >= topWorld; worldY -= 1) {
                const offset = Math.abs(Math.round(worldY * 11 + salt)) % 3;
                bank.lineTo(left + [4, 8, 2][offset], sy(worldY));
            }
        } else {
            bank.moveTo(waterEdge, top);
            bank.lineTo(left + size - 5, top);
            for (let worldY = topWorld; worldY <= bottomWorld; worldY += 1) {
                const offset = Math.abs(Math.round(worldY * 13 + salt)) % 3;
                bank.lineTo(left + size - [4, 8, 2][offset], sy(worldY));
            }
            bank.lineTo(waterEdge, bottom);
        }
        bank.closePath();

        context.save();
        context.shadowColor = "rgba(0, 0, 0, .48)";
        context.shadowBlur = 4;
        context.shadowOffsetY = 3;
        context.fillStyle = "#1b2529";
        context.fill(bank);
        context.shadowColor = "transparent";
        context.clip(bank);

        const firstCourse = Math.floor((topWorld * size) / 21) - 1;
        const lastCourse = Math.ceil((bottomWorld * size) / 21) + 1;
        for (let course = firstCourse; course <= lastCourse; course += 1) {
            const worldY = course * 21;
            const offset = Math.abs(course) % 2 ? 12 : -1;
            for (let column = -1; column <= 2; column += 1) {
                const worldX = bankX * size + offset + column * 25;
                const colorIndex = Math.floor(terrainHash(column, course, salt) * 4) % 4;
                context.fillStyle = ["#303a3c", "#3b4241", "#293437", "#424746"][colorIndex];
                context.fillRect(worldX + 1 - camera.x, worldY + 1 - camera.y, 23, 18);
                context.fillStyle = "rgba(9, 14, 16, .7)";
                context.fillRect(worldX + 1 - camera.x, worldY + 19 - camera.y, 23, 2);
                if (terrainHash(course, column, salt + 17) > .76) {
                    context.strokeStyle = "rgba(154, 116, 63, .22)";
                    context.lineWidth = 1;
                    context.beginPath();
                    context.moveTo(worldX + 6 - camera.x, worldY + 15 - camera.y);
                    context.lineTo(worldX + 18 - camera.x, worldY + 6 - camera.y);
                    context.stroke();
                }
            }
        }
        context.restore();

        // Separate coping blocks, rather than one bright continuous stroke,
        // make the channel read as built masonry instead of a pipe outline.
        const copingLeft = west ? waterEdge - 10 : waterEdge;
        context.fillStyle = "rgba(3, 8, 11, .92)";
        context.fillRect(copingLeft - (west ? 1 : 0), top, 11, bottom - top);
        const firstBlock = Math.ceil((topWorld * size) / 27);
        const lastBlock = Math.floor((bottomWorld * size - 4) / 27);
        for (let block = firstBlock; block <= lastBlock; block += 1) {
            const blockY = block * 27 - camera.y + 2;
            const tone = block % 3 === 0 ? "#56605d" : block % 2 === 0 ? "#454f4d" : "#394547";
            context.fillStyle = tone;
            context.fillRect(copingLeft + 1, blockY, 8, 22);
            context.fillStyle = "rgba(167, 129, 72, .28)";
            context.fillRect(copingLeft + 2, blockY + 1, 6, 1);
        }

        // Shallow pilasters stay inside the solid bank tile, keeping collision
        // and visible masonry aligned while breaking the long strip silhouette.
        for (const worldY of [5.45, 9.05, 18.35, 21.75, 25.05]) {
            if (worldY <= topWorld || worldY >= bottomWorld) continue;
            const pilasterX = west ? left + 5 : left + size - 17;
            const pilasterY = sy(worldY);
            context.fillStyle = "rgba(5, 10, 12, .74)";
            context.fillRect(pilasterX - 2, pilasterY + 3, 16, 25);
            context.fillStyle = "#3b4443";
            context.fillRect(pilasterX, pilasterY, 12, 23);
            context.fillStyle = "rgba(137, 107, 64, .3)";
            context.fillRect(pilasterX + 2, pilasterY + 2, 8, 2);
        }
    };

    for (const [index, segment] of bankSegments.entries()) {
        drawBankSegment(true, segment.top, segment.bottom, 3371 + index * 31);
        drawBankSegment(false, segment.top, segment.bottom, 3449 + index * 37);
    }

    // The parapets span only from bank to bank. Their discrete, chamfered
    // blocks terminate on squat abutments and leave the east road landing open.
    const bridgeLeft = sx(aqueduct.deck.x);
    const bridgeRight = sx(aqueduct.deck.x + aqueduct.deck.width);
    const parapetYs = [sy(bridgeTopWorld + .11), sy(bridgeBottomWorld - .11)] as const;
    for (const [row, bridgeY] of parapetYs.entries()) {
        context.fillStyle = "rgba(2, 7, 9, .9)";
        context.fillRect(bridgeLeft, bridgeY - 6, bridgeRight - bridgeLeft, 13);
        let blockIndex = 0;
        for (let blockX = bridgeLeft + 3; blockX < bridgeRight - 3; blockX += 29) {
            const blockWidth = Math.min(25, bridgeRight - 3 - blockX);
            const blockHeight = blockIndex % 3 === 1 ? 9 : 11;
            const blockTop = bridgeY - Math.ceil(blockHeight / 2);
            const block = new Path2D();
            block.moveTo(blockX + 3, blockTop);
            block.lineTo(blockX + blockWidth - 3, blockTop);
            block.lineTo(blockX + blockWidth, blockTop + 3);
            block.lineTo(blockX + blockWidth, blockTop + blockHeight - 2);
            block.lineTo(blockX + blockWidth - 3, blockTop + blockHeight);
            block.lineTo(blockX + 2, blockTop + blockHeight);
            block.lineTo(blockX, blockTop + blockHeight - 3);
            block.lineTo(blockX, blockTop + 2);
            block.closePath();
            context.fillStyle = ["#4c5552", "#3c4747", "#59605a"][Math.abs(blockIndex + row) % 3];
            context.fill(block);
            context.strokeStyle = "rgba(8, 13, 15, .84)";
            context.lineWidth = 1;
            context.stroke(block);
            context.fillStyle = "rgba(177, 133, 73, .27)";
            context.fillRect(blockX + 4, blockTop + 1, Math.max(2, blockWidth - 8), 1);
            blockIndex += 1;
        }
    }

    for (const bridgeX of [bridgeLeft + 10, bridgeRight - 10]) {
        for (const bridgeY of parapetYs) {
            context.fillStyle = "rgba(2, 7, 9, .86)";
            context.fillRect(bridgeX - 10, bridgeY - 9, 20, 20);
            context.fillStyle = "#46504e";
            context.beginPath();
            context.moveTo(bridgeX - 7, bridgeY - 8);
            context.lineTo(bridgeX + 7, bridgeY - 8);
            context.lineTo(bridgeX + 9, bridgeY - 5);
            context.lineTo(bridgeX + 9, bridgeY + 7);
            context.lineTo(bridgeX + 5, bridgeY + 10);
            context.lineTo(bridgeX - 6, bridgeY + 10);
            context.lineTo(bridgeX - 9, bridgeY + 6);
            context.lineTo(bridgeX - 9, bridgeY - 5);
            context.closePath();
            context.fill();
            context.strokeStyle = "rgba(162, 122, 67, .34)";
            context.lineWidth = 1;
            context.stroke();
        }
    }
}

function drawCivicShelfEdge(context: CanvasRenderingContext2D, camera: Camera): void {
    const sx = (x: number) => x * FIRST_PACT_TILE_SIZE - camera.x;
    const sy = (y: number) => y * FIRST_PACT_TILE_SIZE - camera.y;
    // Guardian Gardens now meets the High Court at one continuous north city
    // edge. The western two-course wall is real map geometry, so this trace can
    // follow the shared y=1 parapet instead of outlining a void notch.
    const edge = new Path2D();
    edge.moveTo(sx(3), sy(1));
    edge.lineTo(sx(55), sy(1));
    edge.lineTo(sx(55), sy(3));
    edge.lineTo(sx(81), sy(3));
    edge.lineTo(sx(81), sy(53));
    edge.lineTo(sx(3), sy(53));
    edge.closePath();
    context.save();
    context.strokeStyle = "rgba(0, 5, 10, .9)";
    context.lineWidth = 12;
    context.shadowColor = "rgba(36, 182, 195, .4)";
    context.shadowBlur = 24;
    context.stroke(edge);
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(160, 119, 62, .55)";
    context.lineWidth = 2;
    context.stroke(edge);
    context.restore();
}

function drawMarketServiceEnclosures(context: CanvasRenderingContext2D, camera: Camera): void {
    const segments = [
        { x: 60, y: 31.58, width: 3.2 },
        { x: 69, y: 31.58, width: 4.7 },
    ] as const;
    for (const segment of segments) {
        const x = segment.x * FIRST_PACT_TILE_SIZE - camera.x;
        const y = segment.y * FIRST_PACT_TILE_SIZE - camera.y;
        const width = segment.width * FIRST_PACT_TILE_SIZE;
        if (x >= camera.width || y >= camera.height || x + width <= 0 || y + 18 <= 0) continue;
        context.save();
        context.shadowColor = "rgba(0, 0, 0, .48)";
        context.shadowBlur = 4;
        context.shadowOffsetY = 5;
        context.fillStyle = "#121b1c";
        context.fillRect(x, y + 2, width, 12);
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
        context.fillStyle = "#4a5550";
        context.fillRect(x + 1, y, width - 2, 8);
        context.fillStyle = "#273631";
        context.fillRect(x + 2, y + 7, width - 4, 6);
        context.strokeStyle = "rgba(9, 15, 16, .78)";
        context.lineWidth = 1;
        for (let joint = 24; joint < width; joint += 24) {
            context.beginPath();
            context.moveTo(x + joint, y + 1);
            context.lineTo(x + joint - 2, y + 12);
            context.stroke();
        }
        context.fillStyle = "#294b3e";
        for (let hedge = 7; hedge < width - 3; hedge += 12) {
            context.beginPath();
            context.ellipse(x + hedge, y - 1, 7, 4.5, 0, 0, Math.PI * 2);
            context.fill();
        }
        context.strokeStyle = "rgba(102, 126, 86, .48)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x + 3, y - 2);
        context.lineTo(x + width - 3, y - 2);
        context.stroke();
        context.restore();
    }
}

function drawAtlasCell(
    context: CanvasRenderingContext2D,
    camera: Camera,
    atlas: HTMLImageElement,
    atlasCell: number,
    bounds: FirstPactRect,
    rotation = 0,
    sourceCrop?: { x: number; y: number; width: number; height: number },
): void {
    const x = bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
    const y = bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
    const width = bounds.width * FIRST_PACT_TILE_SIZE;
    const height = bounds.height * FIRST_PACT_TILE_SIZE;
    if (x >= camera.width || y >= camera.height || x + width <= 0 || y + height <= 0) return;
    const sourceWidth = atlas.naturalWidth / 4;
    const sourceHeight = atlas.naturalHeight / 4;
    const sourceX = ((atlasCell % 4) + (sourceCrop?.x ?? 0)) * sourceWidth;
    const sourceY = (Math.floor(atlasCell / 4) + (sourceCrop?.y ?? 0)) * sourceHeight;
    const croppedSourceWidth = (sourceCrop?.width ?? 1) * sourceWidth;
    const croppedSourceHeight = (sourceCrop?.height ?? 1) * sourceHeight;
    if (!rotation) {
        context.drawImage(atlas, sourceX, sourceY, croppedSourceWidth, croppedSourceHeight, x, y, width, height);
        return;
    }
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(atlas, sourceX, sourceY, croppedSourceWidth, croppedSourceHeight, -width / 2, -height / 2, width, height);
    context.restore();
}

function drawArchitecture(
    context: CanvasRenderingContext2D,
    camera: Camera,
    atlas?: HTMLImageElement | null,
    bellQuarterAtlas?: HTMLImageElement | null,
    valeStable?: HTMLImageElement | null,
    stableTackAnnex?: HTMLImageElement | null,
    handlerLodge?: HTMLImageElement | null,
    kennelInfirmary?: HTMLImageElement | null,
    kennelHouse?: HTMLImageElement | null,
    feedStore?: HTMLImageElement | null,
    gardenLodge?: HTMLImageElement | null,
    guardianHall?: HTMLImageElement | null,
    gardenCourtPavilion?: HTMLImageElement | null,
    highCourtMainArchive?: HTMLImageElement | null,
    highCourtRecordHall?: HTMLImageElement | null,
    highCourtCouncilAnnex?: HTMLImageElement | null,
    marketArcade?: HTMLImageElement | null,
    engineHall?: HTMLImageElement | null,
    arrivalMapleA?: HTMLImageElement | null,
    arrivalMapleB?: HTMLImageElement | null,
    arrivalGate?: HTMLImageElement | null,
    boundaryLantern?: HTMLImageElement | null,
    boundaryStele?: HTMLImageElement | null,
    pumpHouse?: HTMLImageElement | null,
    keeperRowhouse?: HTMLImageElement | null,
    maintenanceShed?: HTMLImageElement | null,
    valveHouse?: HTMLImageElement | null,
    marketStall?: HTMLImageElement | null,
    marketRowhouse?: HTMLImageElement | null,
    marketWorkshop?: HTMLImageElement | null,
    colosseum?: HTMLImageElement | null,
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full",
): void {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    if (architectureScope !== "high-court"
        && architectureScope !== "gardens-north"
        && architectureScope !== "gardens-full"
        && colosseum?.complete && colosseum.naturalWidth > 0) {
        const x = 31 * FIRST_PACT_TILE_SIZE - camera.x;
        const y = 17 * FIRST_PACT_TILE_SIZE - camera.y;
        const size = 22 * FIRST_PACT_TILE_SIZE;
        if (x < camera.width && y < camera.height && x + size > 0 && y + size > 0) {
            context.drawImage(colosseum, x, y, size, size);
        }
    }

    if (!atlas?.complete || atlas.naturalWidth <= 0) return;
    for (const placement of FIRST_PACT_ARCHITECTURE) {
        if (architectureScope === "market" && ![
            "market-arcade",
            "market-stall-west",
            "market-stall-east",
            "merchant-house",
            "waterside-workshop",
        ].includes(placement.id)) continue;
        if (architectureScope === "bell" && ![
            "open-bell-tower",
            "bell-quarter-residence",
            "bell-scribe-townhouse",
            "bell-courier-house",
        ].includes(placement.id)) continue;
        if (architectureScope === "high-court" && ![
            "high-court-archive",
            "west-record-hall",
            "east-council-annex",
        ].includes(placement.id)) continue;
        if (architectureScope === "gardens-north" && ![
            "garden-lodge",
            "guardian-hall",
        ].includes(placement.id)) continue;
        if (architectureScope === "gardens-full" && ![
            "garden-lodge",
            "guardian-hall",
            "garden-court-pavilion",
            "west-record-hall",
        ].includes(placement.id)) continue;
        if (placement.bellQuarterCell != null && bellQuarterAtlas?.complete && bellQuarterAtlas.naturalWidth > 0) {
            const x = placement.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
            const y = placement.bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
            const width = placement.bounds.width * FIRST_PACT_TILE_SIZE;
            const height = placement.bounds.height * FIRST_PACT_TILE_SIZE;
            if (x < camera.width && y < camera.height && x + width > 0 && y + height > 0) {
                const sourceWidth = bellQuarterAtlas.naturalWidth / 4;
                context.save();
                context.shadowColor = "rgba(0, 0, 0, .38)";
                context.shadowBlur = 7;
                context.shadowOffsetX = 3;
                context.shadowOffsetY = 6;
                context.drawImage(
                    bellQuarterAtlas,
                    placement.bellQuarterCell * sourceWidth,
                    0,
                    sourceWidth,
                    bellQuarterAtlas.naturalHeight,
                    x,
                    y,
                    width,
                    height,
                );
                context.restore();
            }
            continue;
        }
        const highCourtStandalone = placement.highCourtAsset === "main-archive"
            ? highCourtMainArchive
            : placement.highCourtAsset === "record-hall"
                ? highCourtRecordHall
                : placement.highCourtAsset === "council-annex"
                    ? highCourtCouncilAnnex
                    : null;
        const gardenStandalone = placement.gardenAsset === "lodge"
            ? gardenLodge
            : placement.gardenAsset === "hall"
                ? guardianHall
            : placement.gardenAsset === "court-pavilion"
                ? gardenCourtPavilion
                : null;
        const standalone = gardenStandalone ?? highCourtStandalone ?? (placement.id === "vale-stable"
            ? valeStable
            : placement.id === "stable-tack-annex"
                ? stableTackAnnex
            : placement.id === "handler-lodge"
                ? handlerLodge
            : placement.id === "kennel-infirmary"
                ? kennelInfirmary
            : placement.id === "kennel-house"
                ? kennelHouse
                : placement.id === "feed-storehouse"
                    ? feedStore
                : placement.id === "market-arcade"
                    ? marketArcade
                : placement.id === "market-stall-west" || placement.id === "market-stall-east"
                    ? marketStall
                : placement.id === "merchant-house"
                    ? marketRowhouse
                : placement.id === "waterside-workshop"
                    ? marketWorkshop
                : placement.id === "gateworks-engine-hall"
                    ? engineHall
                : placement.id === "gateworks-pump-house"
                    ? pumpHouse
                : placement.id === "gateworks-keeper-rowhouse"
                    ? keeperRowhouse
                : placement.id === "gateworks-maintenance-shed"
                    ? maintenanceShed
                : placement.id === "gateworks-valve-house"
                    ? valveHouse
                : placement.id === "arrival-gate"
                    ? arrivalGate
                : placement.id === "arrival-lantern-west"
                    ? boundaryLantern
                : placement.id === "arrival-lantern-east"
                    ? boundaryLantern
                : placement.id === "arrival-lantern-approach-west"
                    ? boundaryLantern
                : placement.id === "arrival-lantern-approach-east"
                    ? boundaryLantern
                : placement.id === "arrival-maple-west"
                    ? arrivalMapleA
                : placement.id === "arrival-maple-east"
                    ? arrivalMapleB
                : placement.id === "arrival-stele-west"
                    ? boundaryStele
                : placement.id === "arrival-stele-east"
                    ? boundaryStele
                    : null);
        if (standalone?.complete && standalone.naturalWidth > 0) {
            const x = placement.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
            const y = placement.bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
            const width = placement.bounds.width * FIRST_PACT_TILE_SIZE;
            const height = placement.bounds.height * FIRST_PACT_TILE_SIZE;
            if (x < camera.width && y < camera.height && x + width > 0 && y + height > 0) {
                context.save();
                context.shadowColor = "rgba(0, 0, 0, .28)";
                context.shadowBlur = 6;
                context.shadowOffsetX = 3;
                context.shadowOffsetY = 5;
                if (placement.id === "market-stall-east") {
                    context.filter = "hue-rotate(24deg) saturate(.84) brightness(.96)";
                }
                context.drawImage(standalone, x, y, width, height);
                context.restore();
            }
            continue;
        }
        drawAtlasCell(context, camera, atlas, placement.atlasCell, placement.bounds, 0, placement.sourceCrop);
    }
}

/** A compact paved ring and four streets join every cedar-ward threshold. */
function drawBondingCourtyardGround(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * FIRST_PACT_TILE_SIZE - camera.x;
    const sy = (y: number) => y * FIRST_PACT_TILE_SIZE - camera.y;

    // Paired two-tile lanes descend from the service houses on either side of
    // the cedar, then merge into one south crossbar. West and east arms meet
    // the stable and canal streets; the center leg reaches the pavilion gate.
    // The planted center remains quiet ground instead of a full-field plaza.
    const courtyard = new Path2D();
    courtyard.rect(sx(17), sy(35.25), 2.2 * size, 6.9 * size);
    courtyard.rect(sx(22.8), sy(35.25), 2.2 * size, 6.9 * size);
    courtyard.rect(sx(17), sy(40), 8 * size, 2.15 * size);
    courtyard.rect(sx(15.05), sy(38), 2.2 * size, 2.4 * size);
    courtyard.rect(sx(24.8), sy(38), 3.2 * size, 2.4 * size);
    courtyard.rect(sx(20), sy(41.8), 3 * size, 1.6 * size);

    // Keep the accepted road materials at the four branch mouths. The court
    // surface reaches their exact tile boundary without painting over them.
    const walkableCourtCells = new Path2D();
    for (let y = 35; y <= 42; y += 1) {
        for (let x = 15; x <= 27; x += 1) {
            if (!isFirstPactWalkable(x, y) || firstPactTileAt(x, y) !== FirstPactTile.Kennel) continue;
            walkableCourtCells.rect(sx(x), sy(y), size, size);
        }
    }

    context.save();
    context.clip(walkableCourtCells);
    drawWesternWardCobbles(context, camera, courtyard, { x: 15.05, y: 35.25, width: 12.95, height: 8.15 });

    context.restore();

    // The two cedar collision cells share one tile-deep planting bed. It is a
    // flush paving break, not a raised wall, prop cluster, or second plaza.
    context.save();
    context.fillStyle = "rgba(48, 43, 29, .96)";
    context.fillRect(sx(20), sy(39), size * 2, size);
    context.strokeStyle = "rgba(144, 132, 98, .62)";
    context.lineWidth = 2;
    context.strokeRect(sx(20) + 3, sy(39) + 3, size * 2 - 6, size - 6);
    context.restore();
}

/**
 * One compact civic court closes the space between the cedar plaza, the
 * handler-lodge doors, and the pavilion gateway. Its east/west boulevard stays
 * visually continuous because that two-tile traffic spine is rendered last.
 */
function drawLowerKennelCivicCourt(context: CanvasRenderingContext2D, camera: Camera): void {
    const size = FIRST_PACT_TILE_SIZE;
    const sx = (x: number) => x * size - camera.x;
    const sy = (y: number) => y * size - camera.y;

    const walkableCourtCells = new Path2D();
    for (let y = 42; y <= 50; y += 1) {
        for (let x = 11; x <= 27; x += 1) {
            const tile = firstPactTileAt(x, y);
            if (!isFirstPactWalkable(x, y) || (tile !== FirstPactTile.Kennel && tile !== FirstPactTile.Road)) continue;
            walkableCourtCells.rect(sx(x), sy(y), size, size);
        }
    }

    // The lodge apron and three-tile center lane make a readable T at the
    // boulevard. Two infill spans close obsolete pad gaps between those real
    // routes and the east branch; because every shape shares one world-aligned
    // material, no dark rectangular "missing tile" fields remain above the
    // cross-street. The boulevard is composited afterward and keeps its edge.
    const court = new Path2D();
    court.rect(sx(12.15), sy(41.95), 5.1 * size, 1.7 * size);
    court.rect(sx(15.05), sy(42), 2.2 * size, 3.65 * size);
    court.rect(sx(20), sy(41.8), 3 * size, 8.55 * size);
    court.rect(sx(17.2), sy(41.95), 2.85 * size, 1.72 * size);
    court.rect(sx(22.95), sy(41.95), 3.05 * size, 2 * size);

    context.save();
    context.clip(walkableCourtCells);
    drawWesternWardCobbles(context, camera, court, { x: 12.15, y: 41.8, width: 13.85, height: 8.55 });
    context.restore();
}

function drawBondingCedar(
    context: CanvasRenderingContext2D,
    camera: Camera,
    bounds: FirstPactRect,
    cedar?: HTMLImageElement | null,
): void {
    const x = bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
    const y = bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
    const width = bounds.width * FIRST_PACT_TILE_SIZE;
    const height = bounds.height * FIRST_PACT_TILE_SIZE;
    if (x >= camera.width || y >= camera.height || x + width <= 0 || y + height <= 0) return;
    context.save();
    context.shadowColor = "rgba(0, 0, 0, .5)";
    context.shadowBlur = 8;
    context.shadowOffsetX = 4;
    context.shadowOffsetY = 7;
    if (cedar?.complete && cedar.naturalWidth > 0) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(cedar, x, y, width, height);
    } else {
        // Loading fallback describes only the grounded trunk and planter; the
        // authored crown replaces it as soon as the exact RGBA asset decodes.
        context.fillStyle = "#26392e";
        context.beginPath();
        context.ellipse(x + width * .52, y + height * .87, width * .22, height * .09, 0, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#74502d";
        context.lineWidth = 13;
        context.beginPath();
        context.moveTo(x + width * .52, y + height * .83);
        context.quadraticCurveTo(x + width * .42, y + height * .58, x + width * .53, y + height * .32);
        context.stroke();
    }
    context.restore();
}

function drawLowerKennelStructures(
    context: CanvasRenderingContext2D,
    camera: Camera,
    pavilion?: HTMLImageElement | null,
    bondingCedar?: HTMLImageElement | null,
): void {
    const cedarPlacement = FIRST_PACT_KENNEL_STRUCTURES.find((placement) => placement.kind === "bonding-cedar");
    if (cedarPlacement) drawBondingCedar(context, camera, cedarPlacement.bounds, bondingCedar);

    const pavilionPlacement = FIRST_PACT_KENNEL_STRUCTURES.find((placement) => placement.kind === "kennel-pavilion");
    if (pavilionPlacement) {
        const northOverhang = pavilionPlacement.roofOverhangNorth ?? 0;
        const x = pavilionPlacement.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
        const y = (pavilionPlacement.bounds.y - northOverhang) * FIRST_PACT_TILE_SIZE - camera.y;
        const width = pavilionPlacement.bounds.width * FIRST_PACT_TILE_SIZE;
        const height = (pavilionPlacement.bounds.height + northOverhang) * FIRST_PACT_TILE_SIZE;
        if (x < camera.width && y < camera.height && x + width > 0 && y + height > 0) {
            context.save();
            context.shadowColor = "rgba(0, 0, 0, .42)";
            context.shadowBlur = 7;
            context.shadowOffsetX = 4;
            context.shadowOffsetY = 7;
            if (pavilion?.complete && pavilion.naturalWidth > 0) {
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = "high";
                context.drawImage(pavilion, x, y, width, height);
            } else {
                // Loading fallback retains the same split massing and open
                // center bay, so collision never appears to precede the art.
                for (const offset of [0, 4]) {
                    const wingX = x + offset * FIRST_PACT_TILE_SIZE;
                    const wingWidth = 3 * FIRST_PACT_TILE_SIZE;
                    const roof = context.createLinearGradient(wingX, y, wingX, y + height);
                    roof.addColorStop(0, "#18324b");
                    roof.addColorStop(1, "#09182a");
                    context.fillStyle = roof;
                    context.fillRect(wingX, y + 12, wingWidth, height - 24);
                    context.strokeStyle = "#9c6c31";
                    context.lineWidth = 5;
                    context.strokeRect(wingX + 3, y + 15, wingWidth - 6, height - 30);
                }
            }
            context.restore();
        }
    }

    for (const placement of FIRST_PACT_KENNEL_STRUCTURES) {
        if (placement.kind !== "exercise-fence") continue;
        const connections: Array<readonly [number, number, number, number]> = [];
        const posts: Array<readonly [number, number]> = [];
        for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
            const row = placement.collisionMask[localY];
            for (let localX = 0; localX < row.length; localX += 1) {
                if (row[localX] !== "#") continue;
                const centerX = (placement.bounds.x + localX + .5) * FIRST_PACT_TILE_SIZE - camera.x;
                const centerY = (placement.bounds.y + localY + .5) * FIRST_PACT_TILE_SIZE - camera.y;
                posts.push([centerX, centerY]);
                if (row[localX + 1] === "#") {
                    connections.push([centerX, centerY, centerX + FIRST_PACT_TILE_SIZE, centerY]);
                }
                if (placement.collisionMask[localY + 1]?.[localX] === "#") {
                    connections.push([centerX, centerY, centerX, centerY + FIRST_PACT_TILE_SIZE]);
                }
            }
        }

        const rails = new Path2D();
        for (const [startX, startY, endX, endY] of connections) {
            rails.moveTo(startX, startY);
            rails.lineTo(endX, endY);
        }
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(2, 7, 9, .65)";
        context.lineWidth = 12;
        context.translate(3, 5);
        context.stroke(rails);
        context.translate(-3, -5);
        context.strokeStyle = "#171d20";
        context.lineWidth = 9;
        context.stroke(rails);
        context.strokeStyle = "#805a2d";
        context.lineWidth = 5;
        context.stroke(rails);
        context.strokeStyle = "rgba(211, 151, 67, .48)";
        context.lineWidth = 1.5;
        context.stroke(rails);

        for (const [postX, postY] of posts) {
            context.fillStyle = "rgba(3, 7, 9, .72)";
            context.beginPath();
            context.ellipse(postX + 3, postY + 5, 9, 7, 0, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#20272a";
            context.beginPath();
            context.arc(postX, postY, 8, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#9f7135";
            context.beginPath();
            context.arc(postX, postY - 1, 5, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#e0ad57";
            context.beginPath();
            context.arc(postX - 1.5, postY - 2.5, 1.5, 0, Math.PI * 2);
            context.fill();
        }
        context.restore();
    }
}

function drawCityProps(
    context: CanvasRenderingContext2D,
    camera: Camera,
    atlas?: HTMLImageElement | null,
    gardenCourtKaioTree?: HTMLImageElement | null,
    gardenCourtListeningBench?: HTMLImageElement | null,
    gardenCourtFountain?: HTMLImageElement | null,
    architectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full",
): void {
    if (!atlas?.complete || atlas.naturalWidth <= 0) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const placement of FIRST_PACT_CITY_PROPS) {
        if ((architectureScope === "gardens-north" || architectureScope === "gardens-full")
            && !placement.id.startsWith("garden-")) continue;
        if (architectureScope === "gardens-north" && placement.id.startsWith("garden-court-")) continue;
        if (placement.gardenAsset) {
            const gardenImage = placement.gardenAsset === "kaio-tree"
                ? gardenCourtKaioTree
                : placement.gardenAsset === "listening-bench"
                    ? gardenCourtListeningBench
                    : gardenCourtFountain;
            if (gardenImage?.complete && gardenImage.naturalWidth > 0) {
                const x = placement.bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
                const y = placement.bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
                const width = placement.bounds.width * FIRST_PACT_TILE_SIZE;
                const height = placement.bounds.height * FIRST_PACT_TILE_SIZE;
                if (x < camera.width && y < camera.height && x + width > 0 && y + height > 0) {
                    context.save();
                    context.shadowColor = "rgba(0, 0, 0, .35)";
                    context.shadowBlur = 5;
                    context.shadowOffsetY = 4;
                    context.drawImage(gardenImage, x, y, width, height);
                    context.restore();
                }
            }
            continue;
        }
        const sourceCrop = placement.id === "market-scriptorium-notice"
            ? { x: 0, y: 0, width: .84, height: 1 }
            : placement.id === "market-trade-crates"
                ? { x: .2, y: .16, width: .72, height: .72 }
            : undefined;
        context.save();
        if (placement.filter) context.filter = placement.filter;
        drawAtlasCell(context, camera, atlas, placement.atlasCell, placement.bounds, placement.rotation, sourceCrop);
        context.restore();
    }
}

function renderWorld(canvas: HTMLCanvasElement, camera: Camera, art: FirstPactWorldArt = {}): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(camera.width));
    const height = Math.max(1, Math.floor(camera.height));
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const night = context.createLinearGradient(0, 0, 0, height);
    night.addColorStop(0, "#07111f");
    night.addColorStop(1, "#02060d");
    context.fillStyle = night;
    context.fillRect(0, 0, width, height);
    const abyssGlow = context.createRadialGradient(width * .55, height * 1.05, 12, width * .55, height * 1.05, Math.max(width, height) * .7);
    abyssGlow.addColorStop(0, "rgba(21, 112, 127, .22)");
    abyssGlow.addColorStop(.45, "rgba(8, 43, 58, .08)");
    abyssGlow.addColorStop(1, "rgba(1, 4, 9, 0)");
    context.fillStyle = abyssGlow;
    context.fillRect(0, 0, width, height);

    const firstX = Math.max(0, Math.floor(camera.x / FIRST_PACT_TILE_SIZE) - 1);
    const lastX = Math.min(FIRST_PACT_WORLD_WIDTH - 1, Math.ceil((camera.x + width) / FIRST_PACT_TILE_SIZE) + 1);
    const firstY = Math.max(0, Math.floor(camera.y / FIRST_PACT_TILE_SIZE) - 1);
    const lastY = Math.min(FIRST_PACT_WORLD_HEIGHT - 1, Math.ceil((camera.y + height) / FIRST_PACT_TILE_SIZE) + 1);
    for (let y = firstY; y <= lastY; y += 1) {
        for (let x = firstX; x <= lastX; x += 1) {
            drawTile(context, firstPactTileAt(x, y), x, y, x * FIRST_PACT_TILE_SIZE - camera.x, y * FIRST_PACT_TILE_SIZE - camera.y, art.tileAtlas, art.architectureScope);
        }
    }

    drawKennelFootpaths(context, camera);
    drawBellQuarterPlantings(context, camera);
    drawGardensNorthTreeModules(context, camera, art.gardensNorthMapleA, art.gardensNorthMapleB);
    if (art.architectureScope !== "gardens-north" && art.architectureScope !== "gardens-full") {
        drawHighCourtGardens(context, camera, art.highCourtGardens);
    }
    if (art.architectureScope !== "high-court") drawGroundEdges(context, camera);
    drawGardensAqueductEmbankment(context, camera);
    drawAqueductCentralCivicCrossing(context, camera);
    drawAqueductCivicBoulevardInfrastructure(context, camera);
    drawMarketCanalInfrastructure(context, camera);
    drawCivicShelfEdge(context, camera);
    drawMarketServiceEnclosures(context, camera);
    drawArchitecture(context, camera,
        art.architectureAtlas,
        art.bellQuarterAtlas,
        art.valeStable,
        art.stableTackAnnex,
        art.handlerLodge,
        art.kennelInfirmary,
        art.kennelHouse,
        art.feedStore,
        art.gardenLodge,
        art.guardianHall,
        art.gardenCourtPavilion,
        art.highCourtMainArchive,
        art.highCourtRecordHall,
        art.highCourtCouncilAnnex,
        art.marketArcade,
        art.engineHall,
        art.gardensNorthMapleA,
        art.gardensNorthMapleB,
        art.arrivalGate,
        art.boundaryLantern,
        art.boundaryStele,
        art.pumpHouse,
        art.keeperRowhouse,
        art.maintenanceShed,
        art.valveHouse,
        art.marketStall,
        art.marketRowhouse,
        art.marketWorkshop,
        art.colosseum,
        art.architectureScope,
    );
    drawGardensNorthGardenModules(context, camera, art.gardensNorthBedLong, art.gardensNorthBedCorner);
    drawHandlerLodgeLanterns(context, camera);
    drawLowerKennelStructures(context, camera, art.kennelPavilion, art.bondingCedar);
    drawCityProps(
        context,
        camera,
        art.propsAtlas,
        art.gardenCourtKaioTree,
        art.gardenCourtListeningBench,
        art.gardenCourtFountain,
        art.architectureScope,
    );

    const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,5,13,.52)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
}

function renderMinimap(
    canvas: HTMLCanvasElement,
    player: FirstPactPoint,
    runtime: Record<string, RuntimeNpc>,
    target?: FirstPactPoint,
): void {
    const width = 210;
    const height = 140;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#030811";
    context.fillRect(0, 0, width, height);
    const scaleX = width / FIRST_PACT_WORLD_WIDTH;
    const scaleY = height / FIRST_PACT_WORLD_HEIGHT;
    for (let y = 0; y < FIRST_PACT_WORLD_HEIGHT; y += 1) {
        for (let x = 0; x < FIRST_PACT_WORLD_WIDTH; x += 1) {
            const tile = firstPactTileAt(x, y);
            context.fillStyle = tile === FirstPactTile.Water
                ? TILE_PALETTE[FirstPactTile.Water].base
                : !isFirstPactWalkable(x, y)
                    ? "#101923"
                : isFirstPactGardensPrimaryRoute(x, y)
                    ? "#68645d"
                    : isFirstPactGardensSecondaryRoute(x, y)
                        ? "#5e605b"
                        : TILE_PALETTE[tile].base;
            context.fillRect(x * scaleX, y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
        }
    }
    for (const state of Object.values(runtime)) {
        context.fillStyle = "rgba(231,189,114,.68)";
        context.fillRect(state.position.x * scaleX - 1, state.position.y * scaleY - 1, 2.5, 2.5);
    }
    if (target) {
        context.strokeStyle = "#f3c978";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc((target.x + .5) * scaleX, (target.y + .5) * scaleY, 5, 0, Math.PI * 2);
        context.stroke();
    }
    context.fillStyle = "#6ef5ef";
    context.shadowColor = "#54d7d9";
    context.shadowBlur = 7;
    context.beginPath();
    context.arc((player.x + .5) * scaleX, (player.y + .5) * scaleY, 3.5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(231,189,114,.35)";
    context.strokeRect(.5, .5, width - 1, height - 1);
}

function firstPactEpilogue(progress: FirstPactProgress) {
    const vow = firstPactVow(progress.mainQuest.pactVow);
    const stableRecord = progress.stableQuest.status === "complete"
        ? " Vale Stable's public victory keeps its banner and every beast's chosen name in Vey's surviving copy."
        : "";
    return [
        {
            kicker: "The Last Bell",
            title: "The city does not become a refuge.",
            copy: "The Court begins its final correction exactly as the Chronicle records it. Bells lose their reasons for ringing. Gates close around futures their owners can no longer imagine.",
        },
        {
            kicker: "What Changed",
            title: "History keeps its shape. The proof survives.",
            copy: `You cannot prevent the Sunken Court from falling. You preserve Vey's unedited record and the truth that the first bonded beasts stood as witnesses, never property.${stableRecord}`,
        },
        {
            kicker: "The First Pact",
            title: "Four witnesses cross home with you.",
            copy: `The Celestial light takes your party back to the present. The ruins are unchanged. ${vow?.returnCopy ?? "Your companions remember a city alive and a choice its machine could not reduce to arithmetic."}`,
        },
    ] as const;
}

function directionForStep(from: FirstPactPoint, to: FirstPactPoint): FirstPactDirection {
    if (to.x > from.x) return "east";
    if (to.x < from.x) return "west";
    if (to.y < from.y) return "north";
    return "south";
}

function nearestNpc(point: FirstPactPoint, runtime: Record<string, RuntimeNpc>): FirstPactNpcDefinition | null {
    let best: { npc: FirstPactNpcDefinition; distance: number } | null = null;
    for (const npc of FIRST_PACT_NPCS) {
        const position = runtime[npc.id]?.position ?? npc.position;
        const distance = Math.abs(position.x - point.x) + Math.abs(position.y - point.y);
        if (distance <= 2 && isFirstPactWithinReach(point, position, 2) && (!best || distance < best.distance)) {
            best = { npc, distance };
        }
    }
    return best?.npc ?? null;
}

function initializeNpcs(): Record<string, RuntimeNpc> {
    return Object.fromEntries(FIRST_PACT_NPCS.map((npc, index) => [npc.id, {
        position: npc.position,
        facing: npc.facing,
        path: [],
        wait: index % 4,
        cycle: 0,
    }]));
}

function npcDialogue(npc: FirstPactNpcDefinition, progress: FirstPactProgress): FirstPactDialogue {
    if (npc.id === "keeper-sena") {
        if (progress.mainStep === "make-first-pact") return {
            lines: [
                "The Court's wardens call your companions instruments. Useful things. Owned things.",
                "They crossed time because they chose your side. Name that choice now. Not command. Not contract. Witness.",
                "The first handlers left three promises in the margin. Choose the one you are willing to let the Court test.",
            ],
            choices: FIRST_PACT_VOWS.map((vow) => ({
                label: vow.choice,
                beat: `forge-first-pact-${vow.id}` as FirstPactMainBeat,
            })),
        };
        if (progress.stableQuest.status === "not-started") return {
            lines: [
                "Keep your voice down. The assessors hear panic and call it proof.",
                "At final bell, an assessor will transfer every named beast here to the Court Menagerie unless Vale wins a public entry. My lead is hurt.",
                "Your four are watching you like they already chose. Two on the sand, two held back. Win under our banner and the order fails in front of witnesses.",
            ],
            action: { kind: "stable-accept" },
        };
        if (progress.stableQuest.status === "complete") return {
            lines: [
                "Listen. No chains moving. No assessor at the door.",
                "You kept the Vale name on the door and every beast under the name it answers to. Vey entered the victory before an official could soften it.",
            ],
        };
        return {
            lines: progress.stableQuest.tournamentWins === 0
                ? ["Orin has the entry slate. Put our name on it before the patron changes the rules again."]
                : [`${progress.stableQuest.tournamentWins} bell${progress.stableQuest.tournamentWins === 1 ? "" : "s"} won. Go back. Finish what we started.`],
        };
    }
    if (npc.id === "registrar-orin") {
        const mainEncounter = expectedFirstPactMainEncounter(progress);
        if (mainEncounter && (mainEncounter.id === "court-menagerie" || mainEncounter.id === "court-echo")) return {
            lines: mainEncounter.id === "court-menagerie"
                ? [
                    "Vey filed an unedited claim. The Court answered with animals trained not to remember wanting anything else.",
                    mainEncounter.lesson,
                ]
                : [
                    "The champion's gate opened by itself. The Court has issued a finding for your companions.",
                    "Four wills create four ways to suffer. Surrender the right to refuse, it says, and all four bodies can be kept safe.",
                    firstPactVow(progress.mainQuest.pactVow)?.consequence ?? "It expects one command to be easier to preserve than four living choices.",
                    mainEncounter.lesson,
                ],
            action: { kind: "main-battle", encounterId: mainEncounter.id, label: `Enter: ${mainEncounter.title}` },
        };
        if (progress.stableQuest.status === "not-started") return { lines: ["A stable enters under its keeper's word. Sena Vale hasn't given you hers."] };
        if (progress.stableQuest.status === "complete") return { lines: ["Vale Stable remains on the ledger. There are officials who will pretend they always supported it."] };
        const encounter = expectedFirstPactTournamentEncounter(progress);
        return {
            lines: [
                `Next bell: ${encounter?.title ?? "the closed sand"}. ${encounter?.opponent ?? "The Court"} waits across the line.`,
                encounter?.lesson ?? "Bring the four who trust your hand.",
            ],
            action: encounter ? { kind: "stable-battle", encounterId: encounter.id } : undefined,
        };
    }
    if (npc.id === "scribe-vey") {
        if (progress.mainStep === "meet-scribe-vey") return {
            lines: ["You came through a door the Court has not built yet. Good. It cannot have edited your reason for arriving.", "Walk the city. Listen where its animals refuse to go. Bring me three facts before an official teaches them how to become harmless."],
            action: { kind: "main-beat", beat: "meet-scribe", label: "Open the unedited chronicle" },
        };
        if (progress.mainStep === "return-to-vey") return {
            lines: ["A bell afraid of its own ringing. Water drawing something other than heat. A sky emptied without a predator.", "Separately, superstition. Together, evidence. I will enter it before the Court can improve the wording."],
            action: { kind: "main-beat", beat: "report-omens", label: "Enter all three omens unaltered" },
        };
        if (progress.mainStep === "recover-withheld-record") return {
            lines: [
                "The Menagerie kept this under its obedience slate. The first handlers did not tame their bonded beasts. They asked to be witnessed by them.",
                "Those handlers later refused the Court's demand to surrender that choice. Your age remembers them among the Withheld.",
                "Take the original to Tam at the Gateworks. The intake recognizes choices older than ownership.",
            ],
            action: { kind: "main-beat", beat: "recover-record", label: "Take the Withheld record" },
        };
        return { lines: ["The Court keeps revising yesterday. I keep the copies it throws away.", progress.mainStep === "investigate-city-omens" ? `You have ${progress.mainQuest.omens.length} of the three facts. Do not bring me rumor.` : "Your companions react before the machinery does. That belongs in the record."] };
    }
    if (npc.id === "bellwarden-isu") return progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("bell") ? {
        lines: ["The east bell rang by itself at dawn. The engineers called it settling metal.", "My rookbeasts flattened themselves before the sound arrived. Metal doesn't frighten an animal before it moves."],
        action: { kind: "main-beat", beat: "omen-bell", label: "Record the frightened bell" },
    } : { lines: ["The east bell rang by itself at dawn. The engineers called it settling metal.", "Metal doesn't sound frightened."] };
    if (npc.id === "engineer-tam") {
        if (progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("aqueduct")) return {
            lines: ["The lower intake is drawing more than heat now. Orders say the numbers balance.", "The animals won't cross the blue grates. Watch the water: it flows toward a demand that has not happened yet."],
            action: { kind: "main-beat", beat: "omen-aqueduct", label: "Record the impossible current" },
        };
        if (progress.mainStep === "meet-engineer-tam") return {
            lines: [
                "Vey's original matches the oldest intake seal. It pairs two witnesses who consent to remember each other.",
                "This is the civic lattice your age calls Hollow Gate. The four village anchors do not exist yet, but their intake rules begin here.",
                "I can open the Gateworks once. What waits below will try to reduce your four choices to one.",
            ],
            action: { kind: "main-beat", beat: "meet-engineer", label: "Open the old Gateworks route" },
        };
        const mainEncounter = expectedFirstPactMainEncounter(progress);
        if (mainEncounter?.id === "lattice-guardian") return {
            lines: ["The route is open. The wardens have already learned your footsteps, but they have not learned four independent wills.", mainEncounter.lesson],
            action: { kind: "main-battle", encounterId: mainEncounter.id, label: `Descend: ${mainEncounter.title}` },
        };
        return { lines: ["The lower intake is drawing more than heat now. Orders say the numbers balance.", "The animals won't cross the blue grates. They know something the ledger doesn't."] };
    }
    if (npc.id === "market-rho") return { lines: ["Vale feed is paid through the week. Don't tell Sena; she'll try to pay me back.", "Win first. Pride can wait outside."] };
    if (npc.id === "kennel-hand") return { lines: ["Take either alley around the old cedar. A frightened beast needs a choice of path, and someone waiting where the paths meet again."] };
    if (npc.id === "court-courier") return { lines: ["Three closure orders before noon. Four cancellations after the nobles complained about the smell."] };
    if (npc.id === "garden-keeper") return progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("gardens") ? {
        lines: ["Every bird left the north wall together. No storm. No hawk. Just gone.", "The nests are warm and the eggs remain. Animals abandon neither without a danger they can already feel."],
        action: { kind: "main-beat", beat: "omen-gardens", label: "Record the empty sky" },
    } : { lines: ["Every bird left the north wall together. No storm. No hawk. Just gone."] };
    return { lines: ["The market is taking bets on Vale Stable. I put mine where the odds looked foolish."] };
}

function mainQuestCopy(progress: FirstPactProgress): { kicker: string; title: string; detail: string; target?: FirstPactPoint } {
    switch (progress.mainStep) {
        case "meet-scribe-vey": return { kicker: "Chapter I · Unedited", title: "A City Still Breathing", detail: "Find Scribe Vey outside the High Court archive.", target: { x: 42, y: 12 } };
        case "investigate-city-omens": {
            const missing = ["bell", "aqueduct", "gardens"].filter((omen) => !progress.mainQuest.omens.includes(omen as "bell" | "aqueduct" | "gardens"));
            const next = missing[0];
            const targets: Record<string, FirstPactPoint> = { bell: { x: 68, y: 16 }, aqueduct: { x: 68, y: 46 }, gardens: { x: 18, y: 16 } };
            return { kicker: `Chapter I · Omens ${progress.mainQuest.omens.length}/3`, title: "What the Animals Know", detail: `Record the city's three impossible warnings. Missing: ${missing.join(", ")}.`, target: targets[next] };
        }
        case "return-to-vey": return { kicker: "Chapter I · Evidence", title: "Before the Wording Changes", detail: "Bring the three unedited observations to Vey.", target: { x: 42, y: 12 } };
        case "challenge-court-menagerie": return { kicker: "Chapter II · The Ledger", title: "The Courtesy of Teeth", detail: "Answer the Court Menagerie at the southern Colosseum gate.", target: { x: 42, y: 34 } };
        case "recover-withheld-record": return { kicker: "Chapter II · Withheld", title: "A Record Without an Owner", detail: "Return to Vey and recover the handlers' original pact.", target: { x: 42, y: 12 } };
        case "meet-engineer-tam": return { kicker: "Chapter III · Intake", title: "What the Gate Keeps", detail: "Carry the original record to Tam at the Gateworks.", target: { x: 68, y: 46 } };
        case "challenge-lattice-guardian": return { kicker: "Chapter III · Intake", title: "The Lattice Wardens", detail: "Descend through the route Tam opened.", target: { x: 68, y: 46 } };
        case "make-first-pact": return { kicker: "Chapter III · Choice", title: "No Companion Is Property", detail: "Ask Sena how the first handlers named their bond.", target: { x: 24, y: 40 } };
        case "challenge-court-echo": return { kicker: "Chapter IV · The First Pact", title: "Four Wills, One Answer", detail: "Answer the Court's balancing echo in the Grand Colosseum.", target: { x: 42, y: 34 } };
        case "return-to-threshold": return { kicker: "Epilogue · The Last Bell", title: "Carry What Survives", detail: "Return to the Arrival Court. The city's fall cannot be unwritten.", target: FIRST_PACT_PLAYER_START };
        case "complete": return { kicker: "Chronicle preserved", title: "The First Pact", detail: "The fixed crossing remains open. Vey and Vale Stable remember your last visit." };
        default: return { kicker: "Celestial crossing", title: "The First Pact", detail: "Cross into the Sunken Court's last age." };
    }
}

function questCopy(progress: FirstPactProgress): { kicker: string; title: string; detail: string } {
    if (progress.stableQuest.status === "not-started") return {
        kicker: "Side quest available",
        title: "A Stable's Last Stand",
        detail: "Find Sena Vale in the Kennel Ward.",
    };
    if (progress.stableQuest.status === "complete") return {
        kicker: "Vale Stable secured",
        title: "A Name Worth Keeping",
        detail: "Return to Sena and see what your victory changed.",
    };
    const encounter = expectedFirstPactTournamentEncounter(progress);
    return {
        kicker: `Tournament ${progress.stableQuest.tournamentWins}/3`,
        title: encounter?.title ?? "A Stable's Last Stand",
        detail: "Report to Registrar Orin at the southern Colosseum gate.",
    };
}

export function FirstPact({
    character,
    sharedImages,
    onExit,
    onBattleActiveChange,
    onFullscreenActiveChange,
    qaCameraFocus,
    qaArchitectureScope,
}: {
    character: Character;
    sharedImages: Record<string, string>;
    onExit: () => void;
    onBattleActiveChange?: (active: boolean) => void;
    onFullscreenActiveChange?: (active: boolean) => void;
    /** Preview-only camera focus used by deterministic critic captures. */
    qaCameraFocus?: FirstPactPoint;
    /** Preview-only architecture cull for a complete, edge-safe district crop. */
    qaArchitectureScope?: "market" | "bell" | "high-court" | "gardens-north" | "gardens-full";
}) {
    const visualQaPreview = window.location.pathname.endsWith("/firstpactpreview.html");
    const criticCapture = visualQaPreview
        && new URLSearchParams(window.location.search).get("capture") === "critic";
    const viewportRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const tileAtlasRef = useRef<HTMLImageElement | null>(null);
    const architectureAtlasRef = useRef<HTMLImageElement | null>(null);
    const bellQuarterAtlasRef = useRef<HTMLImageElement | null>(null);
    const valeStableRef = useRef<HTMLImageElement | null>(null);
    const stableTackAnnexRef = useRef<HTMLImageElement | null>(null);
    const handlerLodgeRef = useRef<HTMLImageElement | null>(null);
    const kennelInfirmaryRef = useRef<HTMLImageElement | null>(null);
    const kennelHouseRef = useRef<HTMLImageElement | null>(null);
    const feedStoreRef = useRef<HTMLImageElement | null>(null);
    const kennelPavilionRef = useRef<HTMLImageElement | null>(null);
    const bondingCedarRef = useRef<HTMLImageElement | null>(null);
    const gardenLodgeRef = useRef<HTMLImageElement | null>(null);
    const guardianHallRef = useRef<HTMLImageElement | null>(null);
    const gardenCourtPavilionRef = useRef<HTMLImageElement | null>(null);
    const gardenCourtFountainRef = useRef<HTMLImageElement | null>(null);
    const gardenCourtKaioTreeRef = useRef<HTMLImageElement | null>(null);
    const gardenCourtListeningBenchRef = useRef<HTMLImageElement | null>(null);
    const gardensNorthMapleARef = useRef<HTMLImageElement | null>(null);
    const gardensNorthMapleBRef = useRef<HTMLImageElement | null>(null);
    const gardensNorthBedLongRef = useRef<HTMLImageElement | null>(null);
    const gardensNorthBedCornerRef = useRef<HTMLImageElement | null>(null);
    const highCourtMainArchiveRef = useRef<HTMLImageElement | null>(null);
    const highCourtRecordHallRef = useRef<HTMLImageElement | null>(null);
    const highCourtCouncilAnnexRef = useRef<HTMLImageElement | null>(null);
    const highCourtGardensRef = useRef<HTMLImageElement | null>(null);
    const marketArcadeRef = useRef<HTMLImageElement | null>(null);
    const engineHallRef = useRef<HTMLImageElement | null>(null);
    const arrivalGateRef = useRef<HTMLImageElement | null>(null);
    const boundaryLanternRef = useRef<HTMLImageElement | null>(null);
    const boundarySteleRef = useRef<HTMLImageElement | null>(null);
    const pumpHouseRef = useRef<HTMLImageElement | null>(null);
    const keeperRowhouseRef = useRef<HTMLImageElement | null>(null);
    const maintenanceShedRef = useRef<HTMLImageElement | null>(null);
    const valveHouseRef = useRef<HTMLImageElement | null>(null);
    const marketStallRef = useRef<HTMLImageElement | null>(null);
    const marketRowhouseRef = useRef<HTMLImageElement | null>(null);
    const marketWorkshopRef = useRef<HTMLImageElement | null>(null);
    const colosseumRef = useRef<HTMLImageElement | null>(null);
    const propsAtlasRef = useRef<HTMLImageElement | null>(null);
    const keyState = useRef(new Set<string>());
    const playerRef = useRef<FirstPactPoint>(FIRST_PACT_PLAYER_START);
    const npcRef = useRef<Record<string, RuntimeNpc>>(initializeNpcs());
    const resumeAttemptedRef = useRef(false);
    const forfeitInFlightRef = useRef(false);
    const movementLockedRef = useRef(false);
    const [progress, setProgress] = useState<FirstPactProgress>(() => createFirstPactProgress());
    const [loading, setLoading] = useState(character.level >= FIRST_PACT_MIN_LEVEL);
    const [loadRevision, setLoadRevision] = useState(0);
    const [storyActionPending, setStoryActionPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [entered, setEntered] = useState(false);
    const [player, setPlayer] = useState<FirstPactPoint>(FIRST_PACT_PLAYER_START);
    const [companion, setCompanion] = useState<FirstPactPoint>({ x: 42, y: 51 });
    const [facing, setFacing] = useState<FirstPactDirection>("north");
    const [playerPath, setPlayerPath] = useState<FirstPactPoint[]>([]);
    const [npcs, setNpcs] = useState<Record<string, RuntimeNpc>>(() => initializeNpcs());
    const [dialogNpc, setDialogNpc] = useState<FirstPactNpcDefinition | null>(null);
    const [dialogLine, setDialogLine] = useState(0);
    const [squadOpen, setSquadOpen] = useState(false);
    const [pendingEncounterId, setPendingEncounterId] = useState<FirstPactEncounterId | null>(null);
    const [selectedPets, setSelectedPets] = useState<string[]>([]);
    const [battleStarting, setBattleStarting] = useState(false);
    const [battleError, setBattleError] = useState<string | null>(null);
    const [battle, setBattle] = useState<{ state: ShowdownStateView; encounterId: FirstPactEncounterId } | null>(null);
    const [viewport, setViewport] = useState({ width: 1280, height: 720 });
    const [tileAtlasReady, setTileAtlasReady] = useState(false);
    const [architectureAtlasReady, setArchitectureAtlasReady] = useState(false);
    const [bellQuarterAtlasReady, setBellQuarterAtlasReady] = useState(false);
    const [valeStableReady, setValeStableReady] = useState(false);
    const [stableTackAnnexReady, setStableTackAnnexReady] = useState(false);
    const [handlerLodgeReady, setHandlerLodgeReady] = useState(false);
    const [kennelInfirmaryReady, setKennelInfirmaryReady] = useState(false);
    const [kennelHouseReady, setKennelHouseReady] = useState(false);
    const [feedStoreReady, setFeedStoreReady] = useState(false);
    const [kennelPavilionReady, setKennelPavilionReady] = useState(false);
    const [bondingCedarReady, setBondingCedarReady] = useState(false);
    const [gardenLodgeReady, setGardenLodgeReady] = useState(false);
    const [guardianHallReady, setGuardianHallReady] = useState(false);
    const [gardenCourtPavilionReady, setGardenCourtPavilionReady] = useState(false);
    const [gardenCourtFountainReady, setGardenCourtFountainReady] = useState(false);
    const [gardenCourtKaioTreeReady, setGardenCourtKaioTreeReady] = useState(false);
    const [gardenCourtListeningBenchReady, setGardenCourtListeningBenchReady] = useState(false);
    const [gardensNorthMapleAReady, setGardensNorthMapleAReady] = useState(false);
    const [gardensNorthMapleBReady, setGardensNorthMapleBReady] = useState(false);
    const [gardensNorthBedLongReady, setGardensNorthBedLongReady] = useState(false);
    const [gardensNorthBedCornerReady, setGardensNorthBedCornerReady] = useState(false);
    const [highCourtMainArchiveReady, setHighCourtMainArchiveReady] = useState(false);
    const [highCourtRecordHallReady, setHighCourtRecordHallReady] = useState(false);
    const [highCourtCouncilAnnexReady, setHighCourtCouncilAnnexReady] = useState(false);
    const [highCourtGardensReady, setHighCourtGardensReady] = useState(false);
    const [marketArcadeReady, setMarketArcadeReady] = useState(false);
    const [engineHallReady, setEngineHallReady] = useState(false);
    const [arrivalGateReady, setArrivalGateReady] = useState(false);
    const [boundaryLanternReady, setBoundaryLanternReady] = useState(false);
    const [boundarySteleReady, setBoundarySteleReady] = useState(false);
    const [pumpHouseReady, setPumpHouseReady] = useState(false);
    const [keeperRowhouseReady, setKeeperRowhouseReady] = useState(false);
    const [maintenanceShedReady, setMaintenanceShedReady] = useState(false);
    const [valveHouseReady, setValveHouseReady] = useState(false);
    const [marketStallReady, setMarketStallReady] = useState(false);
    const [marketRowhouseReady, setMarketRowhouseReady] = useState(false);
    const [marketWorkshopReady, setMarketWorkshopReady] = useState(false);
    const [colosseumReady, setColosseumReady] = useState(false);
    const [propsAtlasReady, setPropsAtlasReady] = useState(false);
    const [districtToast, setDistrictToast] = useState("Arrival Court");
    const [journalOpen, setJournalOpen] = useState(false);
    const [epiloguePage, setEpiloguePage] = useState<number | null>(null);
    const lastDistrictRef = useRef(firstPactDistrictAt(FIRST_PACT_PLAYER_START));

    const breedingParents = useMemo(() => activeClientBreedingParentIds(character), [character]);
    const carried = useMemo(() => new Set(activeCarriedPetIds(character)), [character]);
    const availablePets = useMemo(() => (character.pets ?? []).filter((pet) => (
        carried.has(pet.id) && isPetAvailableForColosseum(pet, breedingParents)
    )), [breedingParents, carried, character.pets]);
    const activePet = useMemo(() => (
        availablePets.find((pet) => pet.id === character.activePetId) ?? availablePets[0] ?? null
    ), [availablePets, character.activePetId]);
    const battlePets = useMemo(() => selectedPets
        .map((id) => character.pets.find((pet) => pet.id === id))
        .filter(Boolean) as Pet[], [character.pets, selectedPets]);

    const worldPixels = { width: FIRST_PACT_WORLD_WIDTH * FIRST_PACT_TILE_SIZE, height: FIRST_PACT_WORLD_HEIGHT * FIRST_PACT_TILE_SIZE };
    const targetCamera = useMemo<Camera>(() => {
        // Kennel Ward's civic space is intentionally biased a little south so
        // the boulevard's lower architectural edge and real pavilion threshold
        // remain in view with the cedar court. Other districts retain the
        // centered production camera exactly.
        const kennelLookAhead = !(visualQaPreview && qaCameraFocus)
            && firstPactDistrictAt(player) === "kennel-ward"
            ? FIRST_PACT_TILE_SIZE * 1.25
            : 0;
        const focus = visualQaPreview && qaCameraFocus ? qaCameraFocus : player;
        return {
            width: viewport.width,
            height: viewport.height,
            x: Math.max(0, Math.min(worldPixels.width - viewport.width, focus.x * FIRST_PACT_TILE_SIZE + FIRST_PACT_TILE_SIZE / 2 - viewport.width / 2)),
            y: Math.max(0, Math.min(worldPixels.height - viewport.height, focus.y * FIRST_PACT_TILE_SIZE + FIRST_PACT_TILE_SIZE / 2 - viewport.height / 2 + kennelLookAhead)),
        };
    }, [player, qaCameraFocus, viewport.height, viewport.width, visualQaPreview, worldPixels.height, worldPixels.width]);
    const [camera, setCamera] = useState<Camera>(targetCamera);
    const cameraRef = useRef<Camera>(targetCamera);

    const movementLocked = loading || !entered || !!dialogNpc || squadOpen || journalOpen || epiloguePage != null || !!battle;
    useEffect(() => { movementLockedRef.current = movementLocked; }, [movementLocked]);
    useEffect(() => { playerRef.current = player; }, [player]);
    useEffect(() => { npcRef.current = npcs; }, [npcs]);

    useEffect(() => {
        const start = cameraRef.current;
        const distance = Math.hypot(targetCamera.x - start.x, targetCamera.y - start.y);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const duration = reduceMotion || distance > FIRST_PACT_TILE_SIZE * 4 ? 1 : 155;
        const startedAt = performance.now();
        let frame = 0;
        const animate = (now: number) => {
            const elapsed = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - ((1 - elapsed) ** 3);
            const next = {
                width: start.width + (targetCamera.width - start.width) * eased,
                height: start.height + (targetCamera.height - start.height) * eased,
                x: start.x + (targetCamera.x - start.x) * eased,
                y: start.y + (targetCamera.y - start.y) * eased,
            };
            cameraRef.current = next;
            setCamera(next);
            if (elapsed < 1) frame = window.requestAnimationFrame(animate);
        };
        frame = window.requestAnimationFrame(animate);
        return () => window.cancelAnimationFrame(frame);
    }, [targetCamera.height, targetCamera.width, targetCamera.x, targetCamera.y]);

    useEffect(() => {
        onFullscreenActiveChange?.(true);
        return () => {
            onFullscreenActiveChange?.(false);
            onBattleActiveChange?.(false);
        };
    }, [onBattleActiveChange, onFullscreenActiveChange]);

    useEffect(() => {
        if (character.level < FIRST_PACT_MIN_LEVEL) return;
        let alive = true;
        void fetchFirstPactProgress(character.name).then((result) => {
            if (!alive) return;
            if ("error" in result) {
                setError(result.error);
                setLoading(false);
                return;
            }
            setProgress(result.progress);
            const saved = result.progress.lastPosition;
            const occupied = new Set(FIRST_PACT_NPCS.map((npc) => firstPactPointKey(npc.position)));
            const restored = nearestFirstPactWalkable(saved, occupied) ?? FIRST_PACT_PLAYER_START;
            const followerBlocked = new Set(occupied);
            followerBlocked.add(firstPactPointKey(restored));
            const restoredCompanion = nearestFirstPactWalkable({ x: restored.x, y: restored.y + 1 }, followerBlocked) ?? restored;
            const restoredDistrict = firstPactDistrictAt(restored);
            setPlayer(restored);
            setCompanion(restoredCompanion);
            lastDistrictRef.current = restoredDistrict;
            setDistrictToast(DISTRICT_LABELS[restoredDistrict]);
            const hasEntered = result.progress.flags.includes("crossed-celestial-threshold");
            setEntered(hasEntered);
            setLoading(false);
            if (hasEntered && (restored.x !== saved.x || restored.y !== saved.y || restoredDistrict !== saved.district)) {
                void checkpointFirstPact(character.name, restored).then((checkpoint) => {
                    if (alive && !("error" in checkpoint)) setProgress(checkpoint.progress);
                });
            }
        });
        return () => { alive = false; };
    }, [character.level, character.name, loadRevision]);

    // A First Pact battle is a sealed Showdown session, so a refresh must
    // re-enter it instead of silently leaving four companions in a live fight.
    // A terminal session is replay-claimed once to recover the story receipt.
    useEffect(() => {
        if (loading || resumeAttemptedRef.current) return;
        resumeAttemptedRef.current = true;
        const crumb = readFirstPactSession(character.name);
        if (!crumb) return;
        let cancelled = false;
        void (async () => {
            const state = await fetchShowdownState(character.name, crumb.sessionId);
            if (cancelled) return;
            if (!state) return; // A transient state read must not destroy the only recovery handle.
            if (!state.finished) {
                await warmShowdownModels(state, character.pets);
                if (cancelled) return;
                setSelectedPets(crumb.petIds);
                setBattle({ state, encounterId: crumb.encounterId });
                onBattleActiveChange?.(true);
                return;
            }
            const settlement = await submitShowdownTurn(character.name, crumb.sessionId, []);
            if (cancelled || !settlement) return;
            writeFirstPactSession(null);
            if ("expired" in settlement) return;
            const firstPact = (settlement as FirstPactSettlement).firstPact;
            if (firstPact?.progress) setProgress(firstPact.progress);
        })();
        return () => { cancelled = true; };
    }, [character.name, character.pets, loading, onBattleActiveChange]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;
        const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let alive = true;
        const tileAtlas = new Image();
        const architectureAtlas = new Image();
        const bellQuarterAtlas = new Image();
        const valeStable = new Image();
        const stableTackAnnex = new Image();
        const handlerLodge = new Image();
        const kennelInfirmary = new Image();
        const kennelHouse = new Image();
        const feedStore = new Image();
        const kennelPavilion = new Image();
        const bondingCedar = new Image();
        const gardenLodge = new Image();
        const guardianHall = new Image();
        const gardenCourtPavilion = new Image();
        const gardenCourtFountain = new Image();
        const gardenCourtKaioTree = new Image();
        const gardenCourtListeningBench = new Image();
        const gardenMapleA = new Image();
        const gardenMapleB = new Image();
        const gardenBedLong = new Image();
        const gardenBedCorner = new Image();
        const highCourtMainArchive = new Image();
        const highCourtRecordHall = new Image();
        const highCourtCouncilAnnex = new Image();
        const highCourtGardens = new Image();
        const marketArcade = new Image();
        const engineHall = new Image();
        const arrivalGate = new Image();
        const boundaryLantern = new Image();
        const boundaryStele = new Image();
        const pumpHouse = new Image();
        const keeperRowhouse = new Image();
        const maintenanceShed = new Image();
        const valveHouse = new Image();
        const marketStall = new Image();
        const marketRowhouse = new Image();
        const marketWorkshop = new Image();
        const colosseum = new Image();
        const propsAtlas = new Image();
        tileAtlas.decoding = "async";
        architectureAtlas.decoding = "async";
        bellQuarterAtlas.decoding = "async";
        valeStable.decoding = "async";
        stableTackAnnex.decoding = "async";
        handlerLodge.decoding = "async";
        kennelInfirmary.decoding = "async";
        kennelHouse.decoding = "async";
        feedStore.decoding = "async";
        kennelPavilion.decoding = "async";
        bondingCedar.decoding = "async";
        gardenLodge.decoding = "async";
        guardianHall.decoding = "async";
        gardenCourtPavilion.decoding = "async";
        gardenCourtFountain.decoding = "async";
        gardenCourtKaioTree.decoding = "async";
        gardenCourtListeningBench.decoding = "async";
        gardenMapleA.decoding = "async";
        gardenMapleB.decoding = "async";
        gardenBedLong.decoding = "async";
        gardenBedCorner.decoding = "async";
        highCourtMainArchive.decoding = "async";
        highCourtRecordHall.decoding = "async";
        highCourtCouncilAnnex.decoding = "async";
        highCourtGardens.decoding = "async";
        marketArcade.decoding = "async";
        engineHall.decoding = "async";
        arrivalGate.decoding = "async";
        boundaryLantern.decoding = "async";
        boundaryStele.decoding = "async";
        pumpHouse.decoding = "async";
        keeperRowhouse.decoding = "async";
        maintenanceShed.decoding = "async";
        valveHouse.decoding = "async";
        marketStall.decoding = "async";
        marketRowhouse.decoding = "async";
        marketWorkshop.decoding = "async";
        colosseum.decoding = "async";
        propsAtlas.decoding = "async";

        // Install load handlers before assigning src, then wait for decode
        // before committing the image and its React readiness flag. This closes
        // both the warm-cache event race and the loaded-but-not-painted frame.
        const prepareImage = (
            image: HTMLImageElement,
            source: string,
            commitImage: (loaded: HTMLImageElement) => void,
        ) => {
            let committed = false;
            let decoding = false;
            const commit = () => {
                decoding = false;
                if (!alive || committed || !image.complete || image.naturalWidth <= 0) return;
                committed = true;
                commitImage(image);
            };
            const load = () => {
                if (!alive || committed || decoding) return;
                decoding = true;
                void image.decode().then(commit, commit);
            };
            image.onload = load;
            image.src = source;
            if (image.complete) load();
        };

        prepareImage(tileAtlas, sunkenCourtTileAtlas, (image) => { tileAtlasRef.current = image; setTileAtlasReady(true); });
        prepareImage(architectureAtlas, sunkenCourtArchitectureAtlas, (image) => { architectureAtlasRef.current = image; setArchitectureAtlasReady(true); });
        prepareImage(bellQuarterAtlas, bellQuarterArchitectureV2, (image) => { bellQuarterAtlasRef.current = image; setBellQuarterAtlasReady(true); });
        prepareImage(valeStable, valeStableV3, (image) => { valeStableRef.current = image; setValeStableReady(true); });
        prepareImage(stableTackAnnex, stableTackAnnexV3, (image) => { stableTackAnnexRef.current = image; setStableTackAnnexReady(true); });
        prepareImage(handlerLodge, handlerLodgeV3, (image) => { handlerLodgeRef.current = image; setHandlerLodgeReady(true); });
        prepareImage(kennelInfirmary, kennelInfirmaryV3, (image) => { kennelInfirmaryRef.current = image; setKennelInfirmaryReady(true); });
        prepareImage(kennelHouse, kennelHouseV3, (image) => { kennelHouseRef.current = image; setKennelHouseReady(true); });
        prepareImage(feedStore, feedStoreV3, (image) => { feedStoreRef.current = image; setFeedStoreReady(true); });
        prepareImage(kennelPavilion, kennelPavilionV3, (image) => { kennelPavilionRef.current = image; setKennelPavilionReady(true); });
        prepareImage(bondingCedar, bondingCedarV3, (image) => { bondingCedarRef.current = image; setBondingCedarReady(true); });
        prepareImage(gardenLodge, gardenLodgeV2, (image) => { gardenLodgeRef.current = image; setGardenLodgeReady(true); });
        prepareImage(guardianHall, guardianHallV2, (image) => { guardianHallRef.current = image; setGuardianHallReady(true); });
        prepareImage(gardenCourtPavilion, gardenCourtPavilionV2, (image) => { gardenCourtPavilionRef.current = image; setGardenCourtPavilionReady(true); });
        prepareImage(gardenCourtFountain, gardenCourtFountainV2, (image) => { gardenCourtFountainRef.current = image; setGardenCourtFountainReady(true); });
        prepareImage(gardenCourtKaioTree, gardenCourtKaioTreeV2, (image) => { gardenCourtKaioTreeRef.current = image; setGardenCourtKaioTreeReady(true); });
        prepareImage(gardenCourtListeningBench, gardenCourtListeningBenchV2, (image) => { gardenCourtListeningBenchRef.current = image; setGardenCourtListeningBenchReady(true); });
        prepareImage(gardenMapleA, gardensNorthMapleA, (image) => { gardensNorthMapleARef.current = image; setGardensNorthMapleAReady(true); });
        prepareImage(gardenMapleB, gardensNorthMapleB, (image) => { gardensNorthMapleBRef.current = image; setGardensNorthMapleBReady(true); });
        prepareImage(gardenBedLong, gardensNorthBedLong, (image) => { gardensNorthBedLongRef.current = image; setGardensNorthBedLongReady(true); });
        prepareImage(gardenBedCorner, gardensNorthBedCorner, (image) => { gardensNorthBedCornerRef.current = image; setGardensNorthBedCornerReady(true); });
        prepareImage(highCourtMainArchive, highCourtMainArchiveV3, (image) => { highCourtMainArchiveRef.current = image; setHighCourtMainArchiveReady(true); });
        prepareImage(highCourtRecordHall, highCourtRecordHallV3, (image) => { highCourtRecordHallRef.current = image; setHighCourtRecordHallReady(true); });
        prepareImage(highCourtCouncilAnnex, highCourtCouncilAnnexV3, (image) => { highCourtCouncilAnnexRef.current = image; setHighCourtCouncilAnnexReady(true); });
        prepareImage(highCourtGardens, highCourtGardenStripV3, (image) => { highCourtGardensRef.current = image; setHighCourtGardensReady(true); });
        prepareImage(marketArcade, marketArcadeV2, (image) => { marketArcadeRef.current = image; setMarketArcadeReady(true); });
        prepareImage(engineHall, engineHallGw, (image) => { engineHallRef.current = image; setEngineHallReady(true); });
        prepareImage(arrivalGate, arrivalGateGw, (image) => { arrivalGateRef.current = image; setArrivalGateReady(true); });
        prepareImage(boundaryLantern, boundaryLanternGw, (image) => { boundaryLanternRef.current = image; setBoundaryLanternReady(true); });
        prepareImage(boundaryStele, boundarySteleGw, (image) => { boundarySteleRef.current = image; setBoundarySteleReady(true); });
        prepareImage(pumpHouse, pumpHouseGw, (image) => { pumpHouseRef.current = image; setPumpHouseReady(true); });
        prepareImage(keeperRowhouse, keeperRowhouseGw, (image) => { keeperRowhouseRef.current = image; setKeeperRowhouseReady(true); });
        prepareImage(maintenanceShed, maintenanceShedGw, (image) => { maintenanceShedRef.current = image; setMaintenanceShedReady(true); });
        prepareImage(valveHouse, valveHouseGw, (image) => { valveHouseRef.current = image; setValveHouseReady(true); });
        prepareImage(marketStall, marketStallV2, (image) => { marketStallRef.current = image; setMarketStallReady(true); });
        prepareImage(marketRowhouse, marketRowhouseV2, (image) => { marketRowhouseRef.current = image; setMarketRowhouseReady(true); });
        prepareImage(marketWorkshop, marketWorkshopV2, (image) => { marketWorkshopRef.current = image; setMarketWorkshopReady(true); });
        prepareImage(colosseum, sunkenCourtColosseum, (image) => { colosseumRef.current = image; setColosseumReady(true); });
        prepareImage(propsAtlas, sunkenCourtStreetProps, (image) => { propsAtlasRef.current = image; setPropsAtlasReady(true); });
        return () => {
            alive = false;
            tileAtlas.onload = null;
            architectureAtlas.onload = null;
            bellQuarterAtlas.onload = null;
            valeStable.onload = null;
            stableTackAnnex.onload = null;
            handlerLodge.onload = null;
            kennelInfirmary.onload = null;
            kennelHouse.onload = null;
            feedStore.onload = null;
            kennelPavilion.onload = null;
            bondingCedar.onload = null;
            gardenLodge.onload = null;
            guardianHall.onload = null;
            gardenCourtPavilion.onload = null;
            gardenCourtFountain.onload = null;
            gardenCourtKaioTree.onload = null;
            gardenCourtListeningBench.onload = null;
            gardenMapleA.onload = null;
            gardenMapleB.onload = null;
            gardenBedLong.onload = null;
            gardenBedCorner.onload = null;
            highCourtMainArchive.onload = null;
            highCourtRecordHall.onload = null;
            highCourtCouncilAnnex.onload = null;
            highCourtGardens.onload = null;
            marketArcade.onload = null;
            marketStall.onload = null;
            marketRowhouse.onload = null;
            marketWorkshop.onload = null;
            colosseum.onload = null;
            propsAtlas.onload = null;
        };
    }, []);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        renderWorld(canvas, camera, {
            tileAtlas: tileAtlasRef.current,
            architectureAtlas: architectureAtlasRef.current,
            bellQuarterAtlas: bellQuarterAtlasRef.current,
            valeStable: valeStableRef.current,
            stableTackAnnex: stableTackAnnexRef.current,
            handlerLodge: handlerLodgeRef.current,
            kennelInfirmary: kennelInfirmaryRef.current,
            kennelHouse: kennelHouseRef.current,
            feedStore: feedStoreRef.current,
            kennelPavilion: kennelPavilionRef.current,
            bondingCedar: bondingCedarRef.current,
            gardenLodge: gardenLodgeRef.current,
            guardianHall: guardianHallRef.current,
            gardenCourtPavilion: gardenCourtPavilionRef.current,
            gardenCourtFountain: gardenCourtFountainRef.current,
            gardenCourtKaioTree: gardenCourtKaioTreeRef.current,
            gardenCourtListeningBench: gardenCourtListeningBenchRef.current,
            gardensNorthMapleA: gardensNorthMapleARef.current,
            gardensNorthMapleB: gardensNorthMapleBRef.current,
            gardensNorthBedLong: gardensNorthBedLongRef.current,
            gardensNorthBedCorner: gardensNorthBedCornerRef.current,
            highCourtMainArchive: highCourtMainArchiveRef.current,
            highCourtRecordHall: highCourtRecordHallRef.current,
            highCourtCouncilAnnex: highCourtCouncilAnnexRef.current,
            highCourtGardens: highCourtGardensRef.current,
            marketArcade: marketArcadeRef.current,
            engineHall: engineHallRef.current,
            arrivalGate: arrivalGateRef.current,
            boundaryLantern: boundaryLanternRef.current,
            boundaryStele: boundarySteleRef.current,
            pumpHouse: pumpHouseRef.current,
            keeperRowhouse: keeperRowhouseRef.current,
            maintenanceShed: maintenanceShedRef.current,
            valveHouse: valveHouseRef.current,
            marketStall: marketStallRef.current,
            marketRowhouse: marketRowhouseRef.current,
            marketWorkshop: marketWorkshopRef.current,
            colosseum: colosseumRef.current,
            propsAtlas: propsAtlasRef.current,
            architectureScope: qaArchitectureScope,
        });

        if (!visualQaPreview) return;
        const allWorldArtReady = tileAtlasReady
            && architectureAtlasReady
            && bellQuarterAtlasReady
            && valeStableReady
            && stableTackAnnexReady
            && handlerLodgeReady
            && kennelInfirmaryReady
            && kennelHouseReady
            && feedStoreReady
            && kennelPavilionReady
            && bondingCedarReady
            && gardenLodgeReady
            && guardianHallReady
            && gardenCourtPavilionReady
            && gardenCourtFountainReady
            && gardenCourtKaioTreeReady
            && gardenCourtListeningBenchReady
            && gardensNorthMapleAReady
            && gardensNorthMapleBReady
            && gardensNorthBedLongReady
            && gardensNorthBedCornerReady
            && highCourtMainArchiveReady
            && highCourtRecordHallReady
            && highCourtCouncilAnnexReady
            && highCourtGardensReady
            && marketArcadeReady
            && engineHallReady
            && arrivalGateReady
            && boundaryLanternReady
            && boundarySteleReady
            && pumpHouseReady
            && keeperRowhouseReady
            && maintenanceShedReady
            && valveHouseReady
            && marketStallReady
            && marketRowhouseReady
            && marketWorkshopReady
            && colosseumReady
            && propsAtlasReady;
        const cameraSettled = Math.abs(camera.x - targetCamera.x) < .01
            && Math.abs(camera.y - targetCamera.y) < .01
            && Math.abs(camera.width - targetCamera.width) < .01
            && Math.abs(camera.height - targetCamera.height) < .01;
        const inView = (bounds: FirstPactRect) => {
            const left = bounds.x * FIRST_PACT_TILE_SIZE - camera.x;
            const top = bounds.y * FIRST_PACT_TILE_SIZE - camera.y;
            return left < camera.width
                && top < camera.height
                && left + bounds.width * FIRST_PACT_TILE_SIZE > 0
                && top + bounds.height * FIRST_PACT_TILE_SIZE > 0;
        };
        const gardenScope = qaArchitectureScope === "gardens-north" || qaArchitectureScope === "gardens-full";
        const highCourtLayers = gardenScope ? [] : [
            highCourtMainArchiveReady && inView({ x: 38, y: 2, width: 9, height: 7 }) ? "high-court-archive" : null,
            highCourtRecordHallReady && inView({ x: 30, y: 7, width: 6, height: 5 }) ? "west-record-hall" : null,
            highCourtCouncilAnnexReady && inView({ x: 49, y: 7, width: 5, height: 5 }) ? "east-council-annex" : null,
            highCourtGardensReady && FIRST_PACT_HIGH_COURT_GARDEN_BEDS.some(({ bounds }) => inView(bounds)) ? "archive-gardens" : null,
            propsAtlasReady && inView({ x: 30.5, y: 14.5, width: 4.5, height: 3 }) ? "archive-notice" : null,
            qaArchitectureScope !== "high-court" && !gardenScope && colosseumReady && inView({ x: 31, y: 17, width: 22, height: 22 }) ? "grand-colosseum" : null,
        ].filter((layer): layer is string => !!layer);
        const gardensNorthLayers = [
            gardenLodgeReady && inView({ x: 6, y: 4, width: 9, height: 9 }) ? "garden-lodge" : null,
            guardianHallReady && inView({ x: 16, y: 4, width: 10, height: 8 }) ? "guardian-hall" : null,
            qaArchitectureScope === "gardens-full" && gardenCourtPavilionReady && inView({ x: 6, y: 16, width: 8, height: 5 }) ? "garden-court-pavilion" : null,
            qaArchitectureScope === "gardens-full" && gardenCourtFountainReady && inView({ x: 20, y: 18, width: 4, height: 3 }) ? "guardian-pool" : null,
            qaArchitectureScope === "gardens-full" && gardenCourtKaioTreeReady && inView({ x: 14, y: 13, width: 5, height: 5 }) ? "kaio-guardian-tree" : null,
            qaArchitectureScope === "gardens-full" && gardenCourtListeningBenchReady && inView({ x: 19, y: 16, width: 3, height: 2 }) ? "kaio-listening-bench" : null,
            qaArchitectureScope === "gardens-full" && highCourtRecordHallReady && inView({ x: 30, y: 7, width: 6, height: 5 }) ? "west-record-hall-edge" : null,
            gardensNorthBedLongReady && gardensNorthBedCornerReady && FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS.some(({ bounds }) => inView(bounds)) ? "frontage-beds" : null,
            gardensNorthBedLongReady && gardensNorthBedCornerReady && FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS.some(({ bounds }) => inView(bounds)) ? "public-court-beds" : null,
            gardensNorthMapleAReady && gardensNorthMapleBReady && FIRST_PACT_GARDENS_NORTH_TREES.some(({ bounds }) => inView(bounds)) ? "autumn-canopy" : null,
        ].filter((layer): layer is string => !!layer);
        const aqueductLayers = [
            inView(FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.deck) ? "civic-boulevard-deck" : null,
            inView({
                x: FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankNorth.x,
                y: FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankNorth.y,
                width: FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankNorth.x
                    + FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankNorth.width
                    - FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankNorth.x,
                height: FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankSouth.y
                    + FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankSouth.height
                    - FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankNorth.y,
            }) ? "collision-backed-banks" : null,
            propsAtlasReady && inView(FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.control) ? "banked-sluice-control" : null,
        ].filter((layer): layer is string => !!layer);
        const centralCrossing = FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING;
        const tilesIn = (bounds: FirstPactRect) => Array.from(
            { length: bounds.width * bounds.height },
            (_, index) => firstPactTileAt(bounds.x + index % bounds.width, bounds.y + Math.floor(index / bounds.width)),
        );
        const centralDeckTiles = tilesIn(centralCrossing.deck);
        const centralWestLandingTiles = tilesIn(centralCrossing.westLanding);
        const centralEastLandingTiles = tilesIn(centralCrossing.eastLanding);
        const centralNorthMouthTiles = tilesIn(centralCrossing.northMouth);
        const centralSouthMouthTiles = tilesIn(centralCrossing.southMouth);
        const centralAbutmentTiles = centralCrossing.abutments.map(({ x, y }) => firstPactTileAt(x, y));
        const centralPlayerOffDeck = player.x < centralCrossing.deck.x
            || player.x >= centralCrossing.deck.x + centralCrossing.deck.width
            || player.y < centralCrossing.deck.y
            || player.y >= centralCrossing.deck.y + centralCrossing.deck.height;
        const centralRouteCells = [centralCrossing.westLanding, centralCrossing.deck, centralCrossing.eastLanding]
            .flatMap((bounds) => Array.from(
                { length: bounds.width * bounds.height },
                (_, index) => ({ x: bounds.x + index % bounds.width, y: bounds.y + Math.floor(index / bounds.width) }),
            ));
        const centralAvatarClear = centralRouteCells.every(({ x, y }) => isFirstPactWalkable(x, y));
        // Deck and both landings call the same world-aligned paver function, so
        // their joint-phase delta is exactly zero rendered pixels.
        const centralApproachJointDeltaPx = 0;
        const centralAqueductLayers = [
            inView(centralCrossing.deck)
                && centralDeckTiles.every((tile) => tile === FirstPactTile.Bridge) ? "tile-authoritative-central-deck" : null,
            inView(centralCrossing.northMouth)
                && inView(centralCrossing.southMouth)
                && centralNorthMouthTiles.every((tile) => tile === FirstPactTile.Water)
                && centralSouthMouthTiles.every((tile) => tile === FirstPactTile.Water) ? "continuous-central-water-mouths" : null,
            centralCrossing.abutments.length === 4
                && centralCrossing.abutments.every(({ x, y }) => inView({ x, y, width: 1, height: 1 }))
                && centralAbutmentTiles.every((tile) => tile === FirstPactTile.Wall) ? "four-central-bank-abutments" : null,
            inView(centralCrossing.deck) ? "two-low-central-curbs" : null,
            inView(centralCrossing.deck)
                && inView(centralCrossing.westLanding)
                && inView(centralCrossing.eastLanding)
                && centralWestLandingTiles.every((tile) => tile === FirstPactTile.Road)
                && centralEastLandingTiles.every((tile) => tile === FirstPactTile.Road)
                && centralApproachJointDeltaPx <= 3 ? "world-aligned-central-boulevard" : null,
            inView(centralCrossing.deck)
                && inView(centralCrossing.westLanding)
                && inView(centralCrossing.eastLanding)
                && centralAvatarClear ? "open-central-avatar-clearance" : null,
        ].filter((layer): layer is string => !!layer);
        const proof = {
            player: { x: player.x, y: player.y },
            focus: visualQaPreview && qaCameraFocus ? qaCameraFocus : { x: player.x, y: player.y },
            camera: { x: camera.x, y: camera.y, width: camera.width, height: camera.height },
            cameraCenterWorld: {
                x: (camera.x + camera.width / 2 - FIRST_PACT_TILE_SIZE / 2) / FIRST_PACT_TILE_SIZE,
                y: (camera.y + camera.height / 2 - FIRST_PACT_TILE_SIZE / 2) / FIRST_PACT_TILE_SIZE,
            },
            sources: {
                architectureAtlas: architectureAtlasReady,
                bellQuarterAtlas: bellQuarterAtlasReady,
                gardensNorthV2: gardenLodgeReady && guardianHallReady
                    && gardenCourtPavilionReady && gardenCourtFountainReady
                    && gardenCourtKaioTreeReady && gardenCourtListeningBenchReady
                    && gardensNorthMapleAReady && gardensNorthMapleBReady
                    && gardensNorthBedLongReady && gardensNorthBedCornerReady,
                highCourtV3: highCourtMainArchiveReady && highCourtRecordHallReady && highCourtCouncilAnnexReady && highCourtGardensReady,
                marketV2: marketArcadeReady && marketStallReady && marketRowhouseReady && marketWorkshopReady,
                propsAtlas: propsAtlasReady,
                colosseum: colosseumReady,
            },
            terrain: "painted",
            architectureScope: qaArchitectureScope ?? null,
            aqueductLayers,
            centralAqueductLayers,
            centralAqueduct: {
                deck: { bounds: centralCrossing.deck, tiles: centralDeckTiles, expectedTile: FirstPactTile.Bridge },
                westLanding: { bounds: centralCrossing.westLanding, tiles: centralWestLandingTiles, expectedTile: FirstPactTile.Road },
                eastLanding: { bounds: centralCrossing.eastLanding, tiles: centralEastLandingTiles, expectedTile: FirstPactTile.Road },
                northMouth: { bounds: centralCrossing.northMouth, tiles: centralNorthMouthTiles, expectedTile: FirstPactTile.Water },
                southMouth: { bounds: centralCrossing.southMouth, tiles: centralSouthMouthTiles, expectedTile: FirstPactTile.Water },
                abutmentTiles: centralAbutmentTiles,
                expectedAbutmentTile: FirstPactTile.Wall,
                abutmentCount: centralCrossing.abutments.length,
                approachJointDeltaPx: centralApproachJointDeltaPx,
                avatarClear: centralAvatarClear,
                playerOffDeck: centralPlayerOffDeck,
            },
            gardensNorthLayers,
            highCourtLayers,
        };
        canvas.dataset.fpRenderProof = JSON.stringify(proof);
        canvas.dataset.fpRenderReady = String(!loading && entered && allWorldArtReady && cameraSettled);
    }, [architectureAtlasReady, bellQuarterAtlasReady, bondingCedarReady, camera, colosseumReady, entered, feedStoreReady, gardenCourtFountainReady, gardenCourtKaioTreeReady, gardenCourtListeningBenchReady, gardenCourtPavilionReady, gardenLodgeReady, gardensNorthBedCornerReady, gardensNorthBedLongReady, gardensNorthMapleAReady, gardensNorthMapleBReady, guardianHallReady, handlerLodgeReady, highCourtCouncilAnnexReady, highCourtGardensReady, highCourtMainArchiveReady, highCourtRecordHallReady, kennelHouseReady, kennelInfirmaryReady, kennelPavilionReady, loading, arrivalGateReady, boundaryLanternReady, boundarySteleReady, engineHallReady, keeperRowhouseReady,
 maintenanceShedReady, pumpHouseReady, valveHouseReady, marketArcadeReady, marketRowhouseReady, marketStallReady, marketWorkshopReady, player.x, player.y, propsAtlasReady, qaArchitectureScope, qaCameraFocus, stableTackAnnexReady, targetCamera.height, targetCamera.width, targetCamera.x, targetCamera.y, tileAtlasReady, valeStableReady, visualQaPreview]);

    useEffect(() => {
        if (minimapRef.current) renderMinimap(minimapRef.current, player, npcs, mainQuestCopy(progress).target);
    }, [npcs, player, progress]);

    const movePlayer = useCallback((next: FirstPactPoint) => {
        if (!isFirstPactWalkable(next.x, next.y)) return false;
        const occupied = new Set(Object.values(npcRef.current).map((entry) => firstPactPointKey(entry.position)));
        if (occupied.has(firstPactPointKey(next))) return false;
        const previous = playerRef.current;
        setFacing(directionForStep(previous, next));
        setCompanion(previous);
        setPlayer(next);
        return true;
    }, []);

    const interact = useCallback(() => {
        if (movementLockedRef.current) return;
        const found = nearestNpc(playerRef.current, npcRef.current);
        if (!found) return;
        setPlayerPath([]);
        setDialogNpc(found);
        setDialogLine(0);
    }, []);

    useEffect(() => {
        const down = (event: KeyboardEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.closest("button, a, input, select, textarea, [role='button']")) return;
            const key = event.key.toLowerCase();
            if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "e", " "].includes(key)) event.preventDefault();
            if ((key === "e" || key === " ") && !event.repeat) interact();
            keyState.current.add(key);
        };
        const up = (event: KeyboardEvent) => keyState.current.delete(event.key.toLowerCase());
        window.addEventListener("keydown", down, { passive: false });
        window.addEventListener("keyup", up);
        return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    }, [interact]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (movementLockedRef.current) return;
            const keys = keyState.current;
            const current = playerRef.current;
            let next: FirstPactPoint | null = null;
            if (keys.has("arrowup") || keys.has("w")) next = { x: current.x, y: current.y - 1 };
            else if (keys.has("arrowdown") || keys.has("s")) next = { x: current.x, y: current.y + 1 };
            else if (keys.has("arrowleft") || keys.has("a")) next = { x: current.x - 1, y: current.y };
            else if (keys.has("arrowright") || keys.has("d")) next = { x: current.x + 1, y: current.y };
            if (next) { setPlayerPath([]); movePlayer(next); }
        }, 115);
        return () => window.clearInterval(timer);
    }, [movePlayer]);

    useEffect(() => {
        if (!playerPath.length || movementLocked) return;
        const timer = window.setTimeout(() => {
            setPlayerPath((current) => {
                const next = current[0];
                if (!next || !movePlayer(next)) return [];
                return current.slice(1);
            });
        }, 105);
        return () => window.clearTimeout(timer);
    }, [movementLocked, movePlayer, playerPath]);

    // Nearby wandering simulation only; static citizens never move. Each NPC
    // chooses a reachable target inside its painted region, pauses at arrival,
    // and treats other actors as temporary blockers rather than walking through.
    useEffect(() => {
        if (!entered) return;
        const timer = window.setInterval(() => {
            if (movementLockedRef.current) return;
            setNpcs((current) => {
                const nextState = { ...current };
                const occupied = new Set(Object.values(current).map((entry) => firstPactPointKey(entry.position)));
                occupied.add(firstPactPointKey(playerRef.current));
                for (const definition of FIRST_PACT_NPCS) {
                    if (definition.behavior !== "wander") continue;
                    const state = nextState[definition.id];
                    if (state.wait > 0) {
                        nextState[definition.id] = { ...state, wait: state.wait - 1 };
                        continue;
                    }
                    if (state.path.length) {
                        const candidate = state.path[0];
                        const key = firstPactPointKey(candidate);
                        if (occupied.has(key)) {
                            nextState[definition.id] = { ...state, wait: 1 };
                            continue;
                        }
                        occupied.delete(firstPactPointKey(state.position));
                        occupied.add(key);
                        nextState[definition.id] = {
                            ...state,
                            position: candidate,
                            facing: directionForStep(state.position, candidate),
                            path: state.path.slice(1),
                            wait: state.path.length === 1 ? 2 + (state.cycle % 4) : 0,
                        };
                        continue;
                    }
                    const target = chooseFirstPactWanderDestination(definition, state.position, state.cycle);
                    const blocked = new Set(occupied);
                    blocked.delete(firstPactPointKey(state.position));
                    const path = target ? findFirstPactPath(state.position, target, blocked) : [];
                    nextState[definition.id] = { ...state, path, cycle: state.cycle + 1, wait: path.length ? 0 : 2 };
                }
                return nextState;
            });
        }, 360);
        return () => window.clearInterval(timer);
    }, [entered]);

    useEffect(() => {
        if (!entered) return;
        const district = firstPactDistrictAt(player);
        if (district === lastDistrictRef.current) return;
        lastDistrictRef.current = district;
        setDistrictToast(DISTRICT_LABELS[district]);
        const timer = window.setTimeout(() => setDistrictToast(""), 2200);
        const checkpointTimer = window.setTimeout(() => {
            void checkpointFirstPact(character.name, player).then((result) => {
                if (!("error" in result)) setProgress(result.progress);
            });
        }, 700);
        return () => { window.clearTimeout(timer); window.clearTimeout(checkpointTimer); };
    }, [character.name, entered, player]);

    const handleWorldPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (movementLocked) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const goal = {
            x: Math.floor((event.clientX - rect.left + camera.x) / FIRST_PACT_TILE_SIZE),
            y: Math.floor((event.clientY - rect.top + camera.y) / FIRST_PACT_TILE_SIZE),
        };
        const blocked = new Set(Object.values(npcRef.current).map((entry) => firstPactPointKey(entry.position)));
        setPlayerPath(findFirstPactPath(playerRef.current, goal, blocked));
    };

    const crossThreshold = async () => {
        setLoading(true);
        setError(null);
        const result = await enterFirstPact(character.name);
        setLoading(false);
        if ("error" in result) { setError(result.error); return; }
        setProgress(result.progress);
        setEntered(true);
        setDistrictToast("Arrival Court · Years Before the Fall");
    };

    const acceptQuest = async () => {
        if (storyActionPending) return;
        setStoryActionPending(true);
        try {
            const result = await acceptFirstPactStableQuest(character.name);
            if ("error" in result) {
                if (result.progress) setProgress(result.progress);
                setError(result.error);
                return;
            }
            setProgress(result.progress);
            setDialogNpc(null);
            setDialogLine(0);
        } finally {
            setStoryActionPending(false);
        }
    };

    const advanceMain = async (beat: FirstPactMainBeat): Promise<boolean> => {
        if (storyActionPending) return false;
        setStoryActionPending(true);
        setError(null);
        try {
            const result = await advanceFirstPactMain(character.name, beat);
            if ("error" in result) {
                if (result.progress) setProgress(result.progress);
                setError(result.error);
                return false;
            }
            setProgress(result.progress);
            setDialogNpc(null);
            setDialogLine(0);
            return true;
        } finally {
            setStoryActionPending(false);
        }
    };

    const openSquad = (encounterId?: FirstPactEncounterId) => {
        const prioritized = [character.activePetId, character.activePetId2v2, ...availablePets.map((pet) => pet.id)]
            .filter((id): id is string => !!id && availablePets.some((pet) => pet.id === id));
        setSelectedPets([...new Set(prioritized)].slice(0, FIRST_PACT_TEAM_SIZE));
        setPendingEncounterId(encounterId ?? expectedFirstPactMainEncounter(progress)?.id ?? expectedFirstPactTournamentEncounter(progress)?.id ?? null);
        setBattleError(null);
        setDialogNpc(null);
        setSquadOpen(true);
    };

    const launchEncounter = useCallback(async (encounterId?: FirstPactEncounterId) => {
        const encounter = encounterId
            ? firstPactEncounter(encounterId)
            : pendingEncounterId ? firstPactEncounter(pendingEncounterId) : null;
        if (!encounter || selectedPets.length !== FIRST_PACT_TEAM_SIZE || battleStarting) return;
        setBattleStarting(true);
        setBattleError(null);
        const result = await startFirstPactShowdown(character.name, encounter.id, selectedPets);
        if ("error" in result) { setBattleStarting(false); setBattleError(result.error); return; }
        writeFirstPactSession({ playerName: character.name, sessionId: result.state.sessionId, encounterId: encounter.id, petIds: selectedPets });
        await warmShowdownModels(result.state, character.pets);
        setBattleStarting(false);
        setProgress(result.progress);
        setSquadOpen(false);
        setPendingEncounterId(null);
        setBattle({ state: result.state, encounterId: encounter.id });
        onBattleActiveChange?.(true);
    }, [battleStarting, character.name, character.pets, onBattleActiveChange, pendingEncounterId, selectedPets]);

    const submitTurn = useCallback((commands: ShowdownCommand[]) => {
        if (!battle) return Promise.resolve(null);
        return submitShowdownTurn(character.name, battle.state.sessionId, commands);
    }, [battle, character.name]);

    const finishBattle = useCallback((_outcome: "win" | "loss", settlement: ShowdownTurnResponse | null) => {
        writeFirstPactSession(null);
        onBattleActiveChange?.(false);
        const firstPact = (settlement as FirstPactSettlement | null)?.firstPact;
        if (firstPact?.progress) setProgress(firstPact.progress);
        else void fetchFirstPactProgress(character.name).then((result) => {
            if (!("error" in result)) setProgress(result.progress);
        });
    }, [character.name, onBattleActiveChange]);

    const closeBattle = useCallback(() => {
        writeFirstPactSession(null);
        setBattle(null);
        onBattleActiveChange?.(false);
    }, [onBattleActiveChange]);

    const forfeitBattle = useCallback(async () => {
        if (!battle || forfeitInFlightRef.current) return;
        forfeitInFlightRef.current = true;
        setBattleError(null);
        const recorded = await forfeitShowdown(character.name, battle.state.sessionId);
        forfeitInFlightRef.current = false;
        if (!recorded) {
            setBattleError("The Court could not record the concession. The bout is still recoverable; try again before leaving.");
            return;
        }
        closeBattle();
    }, [battle, character.name, closeBattle]);

    const rematch = useCallback(() => {
        const next = expectedFirstPactMainEncounter(progress)?.id ?? expectedFirstPactTournamentEncounter(progress)?.id ?? battle?.encounterId;
        setBattle(null);
        onBattleActiveChange?.(false);
        if (next) void launchEncounter(next);
    }, [battle?.encounterId, launchEncounter, onBattleActiveChange, progress]);

    const leave = async () => {
        await checkpointFirstPact(character.name, playerRef.current);
        onExit();
    };

    const dialog = dialogNpc ? npcDialogue(dialogNpc, progress) : null;
    const mainQuest = mainQuestCopy(progress);
    const sideQuest = questCopy(progress);
    const epiloguePages = firstPactEpilogue(progress);
    const recordedVow = firstPactVow(progress.mainQuest.pactVow);
    const district = firstPactDistrictAt(player);
    const pendingEncounter = pendingEncounterId ? firstPactEncounter(pendingEncounterId) : null;

    if (character.level < FIRST_PACT_MIN_LEVEL) {
        return (
            <main className="first-pact-screen first-pact-locked" style={{ "--fp-key-art": `url(${sunkenCourtKeyArt})` } as CSSProperties}>
                <section className="fp-gate-card">
                    <span className="fp-eyebrow">Celestial Tower · Sealed crossing</span>
                    <h1>The First Pact</h1>
                    <p>The Tower cannot hold this road into the past until your chakra is fully tempered.</p>
                    <strong>Requires character level {FIRST_PACT_MIN_LEVEL}</strong>
                    <button type="button" onClick={onExit}>Return to the Celestial Tower</button>
                </section>
            </main>
        );
    }

    return (
        <main className="first-pact-screen" style={{ "--fp-key-art": `url(${sunkenCourtKeyArt})` } as CSSProperties}>
            <div className="fp-world" ref={viewportRef} onPointerDown={handleWorldPointer}>
                <canvas ref={canvasRef} className="fp-world-canvas" role="img" aria-label="Connected tile-based exterior city of the living Sunken Court" />

                {entered && activePet && (
                    <div
                        className="fp-actor fp-companion"
                        style={{ transform: `translate3d(${companion.x * FIRST_PACT_TILE_SIZE + 24 - camera.x}px, ${companion.y * FIRST_PACT_TILE_SIZE + 22 - camera.y}px, 0)` }}
                        role="img"
                        aria-label={`${activePet.name}, your following companion`}
                    >
                        {petCardImage(activePet, sharedImages)
                            ? <img src={petCardImage(activePet, sharedImages)} alt="" />
                            : <span>{activePet.name.slice(0, 2).toUpperCase()}</span>}
                    </div>
                )}

                {entered && FIRST_PACT_NPCS.map((npc) => {
                    const state = npcs[npc.id];
                    if (!state) return null;
                    const near = isFirstPactWithinReach(player, state.position, 2);
                    return (
                        <button
                            type="button"
                            key={npc.id}
                            className={`fp-actor fp-npc fp-palette-${npc.palette}${near ? " is-near" : ""}`}
                            style={{ transform: `translate3d(${state.position.x * FIRST_PACT_TILE_SIZE + 24 - camera.x}px, ${state.position.y * FIRST_PACT_TILE_SIZE + 24 - camera.y}px, 0)` }}
                            onPointerDown={(event) => event.stopPropagation()}
                            tabIndex={near ? 0 : -1}
                            onClick={() => {
                                if (!near || movementLocked) return;
                                setDialogNpc(npc);
                                setDialogLine(0);
                                setPlayerPath([]);
                            }}
                            aria-label={`${npc.name}, ${npc.title}${near ? ". Interact" : ""}`}
                        >
                            <span className="fp-actor-shadow" />
                            <span className="fp-npc-body">
                                {NPC_PORTRAITS[npc.id]
                                    ? <img src={NPC_PORTRAITS[npc.id]} alt="" />
                                    : <i>{npc.name.slice(0, 1)}</i>}
                            </span>
                            <span className="fp-actor-pin" />
                            <span className="fp-npc-name">{npc.name}</span>
                            {near && !criticCapture && <span className="fp-interact">E</span>}
                        </button>
                    );
                })}

                {entered && (
                    <div
                        className={`fp-actor fp-player faces-${facing}`}
                        style={{ transform: `translate3d(${player.x * FIRST_PACT_TILE_SIZE + 24 - camera.x}px, ${player.y * FIRST_PACT_TILE_SIZE + 24 - camera.y}px, 0)` }}
                        role="img"
                        aria-label={character.name}
                    >
                        <span className="fp-actor-shadow" />
                        <span className="fp-player-body">
                            {character.avatarImage
                                ? <img src={character.avatarImage} alt="" />
                                : <i>{character.name.slice(0, 2).toUpperCase()}</i>}
                        </span>
                        <span className="fp-actor-pin" />
                    </div>
                )}

                {districtToast && entered && !criticCapture && <div className="fp-district-toast" role="status">{districtToast}</div>}

                {entered && !criticCapture && <div className="fp-hud fp-hud-left">
                    <span className="fp-eyebrow">The Sunken Court · Before the Fall</span>
                    <h1>The First Pact</h1>
                    <p>{DISTRICT_LABELS[district]}</p>
                    <div className="fp-standing"><span>Court standing</span><strong>{progress.courtStanding}</strong></div>
                </div>}

                {entered && !criticCapture && <aside className="fp-hud fp-quest-card" aria-label="Tracked quest">
                    <span>{mainQuest.kicker}</span>
                    <strong>{mainQuest.title}</strong>
                    <p>{mainQuest.detail}</p>
                    {mainQuest.target && <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setPlayerPath(findFirstPactPath(playerRef.current, mainQuest.target!))}>Guide me</button>}
                    <div className="fp-side-objective"><span>{sideQuest.kicker}</span><strong>{sideQuest.title}</strong><small>{sideQuest.detail}</small></div>
                </aside>}

                {entered && !criticCapture && <aside className="fp-minimap" aria-label="Map of the connected Sunken Court">
                    <canvas ref={minimapRef} />
                    <div><span>Connected court</span><strong>{DISTRICT_LABELS[district]}</strong></div>
                </aside>}

                {entered && !criticCapture && <div className="fp-world-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); void leave(); }}>Leave crossing</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setPlayerPath(findFirstPactPath(playerRef.current, { x: 42, y: 34 })); }}>Colosseum</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setJournalOpen(true); }}>Chronicle</button>
                    {progress.mainStep === "return-to-threshold" && district === "arrival-court" && <button type="button" className="fp-complete-crossing" onClick={(event) => { event.stopPropagation(); setEpiloguePage(0); }}>Complete the crossing</button>}
                </div>}

                {entered && !criticCapture && <div className="fp-dpad" aria-label="Movement controls">
                    <button type="button" aria-label="Move north" onPointerDown={(event) => event.stopPropagation()} onClick={() => movePlayer({ x: playerRef.current.x, y: playerRef.current.y - 1 })}>▲</button>
                    <button type="button" aria-label="Move west" onPointerDown={(event) => event.stopPropagation()} onClick={() => movePlayer({ x: playerRef.current.x - 1, y: playerRef.current.y })}>◀</button>
                    <button type="button" aria-label="Interact" onPointerDown={(event) => event.stopPropagation()} onClick={interact}>●</button>
                    <button type="button" aria-label="Move east" onPointerDown={(event) => event.stopPropagation()} onClick={() => movePlayer({ x: playerRef.current.x + 1, y: playerRef.current.y })}>▶</button>
                    <button type="button" aria-label="Move south" onPointerDown={(event) => event.stopPropagation()} onClick={() => movePlayer({ x: playerRef.current.x, y: playerRef.current.y + 1 })}>▼</button>
                </div>}
            </div>

            {!entered && !loading && !error && (
                <section className="fp-crossing" role="dialog" aria-modal="true" aria-label="Enter The First Pact">
                    <div className="fp-crossing-shade" />
                    <div className="fp-crossing-copy">
                        <span className="fp-eyebrow">Celestial Tower · Complete temporal crossing</span>
                        <h1>The First Pact</h1>
                        <p>The light opens one fixed road into the Sunken Court's last age. This is the past, not a reconstructed refuge. Its fall is fixed, but the records carried out of it are not.</p>
                        <div className="fp-party-rule"><strong>Premier format</strong><span>2 active pets · 2 reserves · single-player RPG</span></div>
                        <button type="button" onClick={() => void crossThreshold()}>Cross into the Sunken Court</button>
                        <button type="button" className="fp-quiet-button" onClick={onExit}>Step away</button>
                    </div>
                </section>
            )}

            {loading && <div className="fp-loading" role="status"><i /><span>Holding the crossing…</span></div>}
            {error && <div className="fp-error" role="alert"><strong>The crossing broke</strong><span>{error}</span><div>
                {!entered
                    ? <button type="button" onClick={() => { setError(null); setLoading(true); setLoadRevision((revision) => revision + 1); }}>Retry crossing</button>
                    : <button type="button" onClick={() => setError(null)}>Stay in the Sunken Court</button>}
                <button type="button" className="fp-quiet-button" onClick={onExit}>Return to Tower</button>
            </div></div>}

            {dialogNpc && dialog && (
                <div className="fp-overlay" role="presentation" onPointerDown={(event) => event.stopPropagation()}>
                    <section className="fp-dialogue" role="dialog" aria-modal="true" aria-label={`Conversation with ${dialogNpc.name}`}>
                        <div className={`fp-dialogue-portrait fp-palette-${dialogNpc.palette}`}>
                            {NPC_PORTRAITS[dialogNpc.id]
                                ? <img src={NPC_PORTRAITS[dialogNpc.id]} alt={`${dialogNpc.name} portrait`} />
                                : <span>{dialogNpc.name.slice(0, 1)}</span>}
                        </div>
                        <div className="fp-dialogue-copy">
                            <span className="fp-eyebrow">{dialogNpc.title}</span>
                            <h2>{dialogNpc.name}</h2>
                            <p>{dialog.lines[Math.min(dialogLine, dialog.lines.length - 1)]}</p>
                            <div className="fp-dialogue-actions">
                                {dialogLine < dialog.lines.length - 1
                                    ? <button type="button" onClick={() => setDialogLine((line) => line + 1)}>Continue</button>
                                    : dialog.choices?.length
                                        ? <div className="fp-dialogue-choices" aria-label="Choose the words Vey will preserve">
                                            {dialog.choices.map((choice) => <button type="button" key={choice.beat} disabled={storyActionPending} onClick={() => void advanceMain(choice.beat)}>{choice.label}</button>)}
                                        </div>
                                    : dialog.action?.kind === "stable-accept"
                                        ? <button type="button" disabled={storyActionPending} onClick={() => void acceptQuest()}>{storyActionPending ? "Entering…" : "Enter under Vale Stable"}</button>
                                        : dialog.action?.kind === "stable-battle"
                                            ? <button type="button" onClick={() => openSquad(dialog.action?.kind === "stable-battle" ? dialog.action.encounterId : undefined)}>Prepare four-pet squad</button>
                                            : dialog.action?.kind === "main-beat"
                                                ? <button type="button" disabled={storyActionPending} onClick={() => void advanceMain(dialog.action?.kind === "main-beat" ? dialog.action.beat : "meet-scribe")}>{storyActionPending ? "Recording…" : dialog.action.label}</button>
                                                : dialog.action?.kind === "main-battle"
                                                    ? <button type="button" onClick={() => openSquad(dialog.action?.kind === "main-battle" ? dialog.action.encounterId : undefined)}>{dialog.action.label}</button>
                                                    : null}
                                <button type="button" className="fp-quiet-button" onClick={() => setDialogNpc(null)}>Leave</button>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {squadOpen && (
                <div className="fp-overlay" role="presentation" onPointerDown={(event) => event.stopPropagation()}>
                    <section className="fp-squad" role="dialog" aria-modal="true" aria-label="Prepare tournament squad">
                        <header>
                            <div><span className="fp-eyebrow">{pendingEncounter && FIRST_PACT_MAIN_ENCOUNTERS.some((entry) => entry.id === pendingEncounter.id) ? "Main Chronicle" : "Vale Stable · Tournament roster"}</span><h2>{pendingEncounter?.title ?? "Two on the sand. Two in reserve."}</h2></div>
                            <button type="button" className="fp-quiet-button" onClick={() => setSquadOpen(false)}>Close</button>
                        </header>
                        <div className="fp-formation">
                            {[0, 1, 2, 3].map((slot) => {
                                const pet = availablePets.find((entry) => entry.id === selectedPets[slot]);
                                return <div key={slot} className={`fp-formation-slot ${slot < 2 ? "active" : "reserve"}`}><span>{slot < 2 ? `Active ${slot + 1}` : `Reserve ${slot - 1}`}</span><strong>{pet?.name ?? "Open"}</strong></div>;
                            })}
                        </div>
                        {pendingEncounter && <p className="fp-encounter-brief"><strong>{pendingEncounter.opponent}</strong><span>{pendingEncounter.lesson}</span></p>}
                        <div className="fp-roster">
                            {availablePets.map((pet) => {
                                const selectedIndex = selectedPets.indexOf(pet.id);
                                const image = petCardImage(pet, sharedImages);
                                return <button
                                    type="button"
                                    key={pet.id}
                                    className={selectedIndex >= 0 ? "selected" : ""}
                                    onClick={() => setSelectedPets((current) => current.includes(pet.id)
                                        ? current.filter((id) => id !== pet.id)
                                        : current.length < FIRST_PACT_TEAM_SIZE ? [...current, pet.id] : current)}
                                >
                                    <span className="fp-pet-art">{image ? <img src={image} alt="" /> : pet.name.slice(0, 2).toUpperCase()}</span>
                                    <span><strong>{pet.name}</strong><small>Lv {pet.level} · {pet.element}</small></span>
                                    {selectedIndex >= 0 && <b>{selectedIndex < 2 ? `A${selectedIndex + 1}` : `R${selectedIndex - 1}`}</b>}
                                </button>;
                            })}
                        </div>
                        {availablePets.length < FIRST_PACT_TEAM_SIZE && <p className="fp-squad-warning">Four available carried pets are required. Return resting pets from the Sanctuary or wait for training, breeding and expeditions to finish.</p>}
                        {battleError && <p className="fp-squad-warning" role="alert">{battleError}</p>}
                        <footer>
                            <div><strong>{selectedPets.length}/{FIRST_PACT_TEAM_SIZE} selected</strong><span>The first two start active. Selection order matters.</span></div>
                            <button type="button" disabled={selectedPets.length !== FIRST_PACT_TEAM_SIZE || battleStarting || !pendingEncounter} onClick={() => void launchEncounter()}>{battleStarting ? "Opening the gates…" : "Commit this formation"}</button>
                        </footer>
                    </section>
                </div>
            )}

            {journalOpen && (
                <div className="fp-overlay fp-journal-overlay" role="presentation" onPointerDown={(event) => event.stopPropagation()}>
                    <section className="fp-journal" role="dialog" aria-modal="true" aria-label="First Pact Chronicle">
                        <header><div><span className="fp-eyebrow">Scribe Vey's unedited copy</span><h2>The First Pact Chronicle</h2></div><button type="button" className="fp-quiet-button" onClick={() => setJournalOpen(false)}>Close</button></header>
                        <div className="fp-journal-grid">
                            {[
                                [1, "A City Still Breathing", "Follow the animals' warnings through the Bell Quarter, Guardian Gardens and Aqueduct."],
                                [2, "The Courtesy of Teeth", "Challenge the Court's doctrine of kind ownership and recover the Withheld record."],
                                [3, "What the Gate Keeps", "Carry the original pact into the Gateworks and survive the learning lattice."],
                                [4, "Four Wills, One Answer", "Name every companion as a witness and answer the Balanced Court together."],
                            ].map(([chapter, title, copy]) => <article key={String(chapter)} className={progress.chapter > Number(chapter) || progress.mainStep === "complete" ? "complete" : progress.chapter === Number(chapter) ? "active" : "locked"}>
                                <span>Chapter {chapter}</span><strong>{title}</strong><p>{copy}</p>
                            </article>)}
                        </div>
                        {recordedVow && <div className="fp-journal-vow"><span>Pact preserved</span><strong>“{recordedVow.choice}”</strong></div>}
                        <footer>
                            <div><span>Court standing</span><strong>{progress.courtStanding.toLocaleString()}</strong></div>
                            <div><span>Omens preserved</span><strong>{progress.mainQuest.omens.length} / 3</strong></div>
                            <div><span>Vale Stable</span><strong>{progress.stableQuest.status === "complete" ? "Saved" : progress.stableQuest.status === "accepted" ? `${progress.stableQuest.tournamentWins} / 3 wins` : "Unmet"}</strong></div>
                        </footer>
                    </section>
                </div>
            )}

            {epiloguePage != null && (
                <div className="fp-epilogue" role="dialog" aria-modal="true" aria-label="The First Pact epilogue">
                    <div className="fp-epilogue-shade" />
                    <section>
                        <span className="fp-eyebrow">{epiloguePages[epiloguePage].kicker} · {epiloguePage + 1}/{epiloguePages.length}</span>
                        <h2>{epiloguePages[epiloguePage].title}</h2>
                        <p>{epiloguePages[epiloguePage].copy}</p>
                        <div>
                            {epiloguePage > 0 && <button type="button" className="fp-quiet-button" onClick={() => setEpiloguePage((page) => Math.max(0, (page ?? 0) - 1))}>Back</button>}
                            {epiloguePage < epiloguePages.length - 1
                                ? <button type="button" onClick={() => setEpiloguePage((page) => Math.min(epiloguePages.length - 1, (page ?? 0) + 1))}>Continue</button>
                                : <button type="button" disabled={storyActionPending} onClick={() => void advanceMain("complete-crossing").then((completed) => { if (completed) setEpiloguePage(null); })}>{storyActionPending ? "Holding the crossing…" : "Return to the present"}</button>}
                        </div>
                    </section>
                </div>
            )}

            {battle && (
                <PetShowdownBattle
                    key={battle.state.sessionId}
                    initialState={battle.state}
                    playerPets={battlePets}
                    sharedImages={sharedImages}
                    submitTurn={submitTurn}
                    onForfeit={forfeitBattle}
                    onFinished={finishBattle}
                    onExit={closeBattle}
                    onRematch={rematch}
                />
            )}
            {battle && battleError && <div className="fp-battle-network-error" role="alert"><span>{battleError}</span><button type="button" onClick={() => setBattleError(null)}>Dismiss</button></div>}
        </main>
    );
}

export default FirstPact;

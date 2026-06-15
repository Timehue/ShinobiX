/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo } from "react";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorRaid } from "../types/missions";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { Pet } from "../types/pet";
import { TERRITORY_CONTROL_MAX, TERRITORY_HP_MAX, TERRITORY_REBUILD_COOLDOWN_MS } from "../constants/game";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { TriggeredVisualNovel } from "../components/TriggeredVisualNovel";
import { SceneAmbience } from "../components/SceneAmbience";
import { SceneAmbience3D } from "../components/SceneAmbience3D";
import { SectorAvatar } from "../components/SectorAvatar";
import { SectorScene } from "../components/SectorScene";
import { SectorScene3D } from "../components/SectorScene3D";
import { SectorForeground } from "../components/SectorForeground";
import { SectorScatter } from "../components/SectorScatter";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";
import { SECTOR_DEPTH_THEMES } from "../data/sector-depth-manifest";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { applyPetTraitBonuses, rollPetTrait, rollPetEncounter } from "../lib/pet-balance";
import { biomeForWorldSector, villageForOutskirtsSector, villageOutskirtsSectorNumber, weatherForBiome } from "../data/sectors";
import { biomeLabel, weatherEffects } from "../data/world";
import { builtinHuntMissions } from "../data/missions";
import { currentDateKey, makeId, sameSector } from "../lib/utils";
import { defaultVnScene } from "../lib/vn";
import { displayCharacterXpGain, effectiveCharacterXpGain } from "../lib/progression";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "../lib/pvp-session";
import { getAllItems } from "../lib/items";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { cwListWars } from "../lib/clan-war-api";
import { fetchClanData } from "../lib/clan-api";
import { scoutIntelTier } from "../lib/clan-upgrades";
import { getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus, getPvpItemLoadout } from "../lib/equipment-stats";
import { hiddenDungeonVnEvent } from "../data/vn-events";
import { petTraitDescriptions, petTreatItems, stackableItemIds } from "../data/pet-config";
import { starterItems } from "../data/starter-items";
import worldMapBg from "../assets/Maps/world_map.webp";
import castleImg from "../assets/castle.webp";
import houseImg from "../assets/house1.webp";
import towerImg from "../assets/tower.webp";
import moonshadowImage from "../assets/moonshadow.webp";
import iceSectorImg from "../assets/sectors/ice.webp";
import darkSectorImg from "../assets/sectors/dark.webp";
import templeSectorImg from "../assets/sectors/temple.webp";
import waterSectorImg from "../assets/sectors/water.webp";
import forrestSectorImg from "../assets/sectors/forrest.webp";
import meadow2SectorImg from "../assets/sectors/meadow2.webp";
import meadowSectorImg from "../assets/sectors/meadow.webp";
import stormveilVillageImg from "../assets/sectors/stormveil-village.webp";
import {
    gainXp,
    getPvpJutsuLoadout,
    normalizeCharacter,
    villagePageImage,
    type CreatorEvent,
    type DuelChallenge,
    type EventEncounterBattle,
    type PvpSessionState,
    type SharedPvpBattleContext,
} from "../App";
import { activeVillageWarsFor, loadSectorTerritory, weatherForSector, VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX } from "../lib/world-state";

function playerNameTile(name: string): number {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
    // keep away from corners — map to 10–133 range
    return 10 + (h % 124);
}

// Which scene-image theme each sector shows. Single source of truth shared by
// the background image picker and the ambience-biome picker so the drifting
// particles always match the painted scene the player is looking at.
const SECTOR_IMAGE_GROUPS: Record<string, number[]> = {
    ice: [52, 48, 53, 54, 50, 55],
    dark: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 19, 18, 14, 15, 13],
    temple: [34, 60, 59],
    water: [23, 26, 21, 22, 27, 32, 28, 33, 42],
    forrest: [36, 37, 38, 39, 40, 43, 46],
    stormveil: [31, 35, 10, 16],
    meadow2: [44, 24, 29, 30, 59, 1],
    meadow: [25, 41, 45, 47, 57, 51],
};

function sectorImageTheme(sector: number): string {
    for (const [theme, sectors] of Object.entries(SECTOR_IMAGE_GROUPS)) {
        if (sectors.includes(sector)) return theme;
    }
    return "meadow";
}

function sectorBackgroundImage(sector: number) {
    if (sector === 99) return "/deathgate-sector.webp";

    const village = villageForOutskirtsSector(sector);
    if (village) return villagePageImage(village);

    switch (sectorImageTheme(sector)) {
        case "ice": return iceSectorImg;
        case "dark": return darkSectorImg;
        case "temple": return templeSectorImg;
        case "water": return waterSectorImg;
        case "stormveil": return stormveilVillageImg;
        case "forrest": return forrestSectorImg;
        case "meadow2": return meadow2SectorImg;
        default: return meadowSectorImg;
    }
}

// Depth-map URL for a sector's painted scene, when one has been baked
// (scripts/gen-sector-depth.mjs). Mirrors sectorBackgroundImage's image choice
// so the depth lines up with what's shown: only theme images have maps for now —
// village outskirts, Death's Gate, and custom territory art fall back to the
// procedural depth in SectorScene3DScene.
function sectorDepthImage(sector: number): string | undefined {
    if (sector === 99) return undefined;
    if (villageForOutskirtsSector(sector)) return undefined;
    const theme = sectorImageTheme(sector);
    return SECTOR_DEPTH_THEMES.has(theme) ? `/sector-depth/${theme}.webp` : undefined;
}

// Ambience biome (drives drifting particles + god-ray tint) chosen to match the
// painted scene image — NOT the territory biome, which can differ (e.g. a
// volcano-territory sector that paints as forest). Outskirts mirror their village.
function ambienceBiomeForSector(sector: number): Biome {
    if (sector === 99) return "volcano";
    const village = villageForOutskirtsSector(sector);
    if (village === "Frostfang Village") return "snow";
    if (village === "Moonshadow Village") return "shadow";
    if (village === "Stormveil Village") return "forest";
    if (village === "Ashen Leaf Village") return "volcano";
    switch (sectorImageTheme(sector)) {
        case "ice": return "snow";
        case "dark": return "shadow";
        case "temple": return "shadow";   // cherry-blossom temple → drifting petals
        case "forrest": return "forest";
        case "stormveil": return "forest";
        case "water": return "central";   // soft motes over the lagoon
        case "meadow2": return "central";
        case "meadow": return "central";
        default: return "central";
    }
}
export function WorldMap({
    setCurrentBiome,
    setScreen,
    character,
    updateCharacter,
    creatorEvents,
    creatorRaids,
    petEncounterVn,
    ancientChestVn,
    editablePets,
    setPendingAiProfileId,
    setPendingPvpOpponent,
    setRaidBattleKind,
    recordMissionExplore,
    setPendingExploreSector,
    playableAis,
    setCurrentWeather,
    playerRoster,
    liveSectorPlayers,
    currentSector,
    setCurrentSector,
    isTraveling,
    travelingUntil,
    setTravelingUntil,
    sectorAttackPlayer,
    acceptedMissionIds,
    missionProgress,
    setMissionProgress,
    sharedImages = {},
    onStartEventEncounter,
    onDungeonFound,
    onEnterHollowGate,
    setPvpBattleId,
    setPvpRole,
    setPvpBattleContext,
    setPvpSeedSession,
    savedBloodlines,
    creatorJutsus: wmCreatorJutsus,
    creatorItems: wmCreatorItems,
    onImmediateSave,
}: {
    setCurrentBiome: (biome: Biome) => void;
    setScreen: (screen: Screen) => void;
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorEvents: CreatorEvent[];
    creatorRaids: CreatorRaid[];
    petEncounterVn: CreatorEvent;
    ancientChestVn: CreatorEvent;
    editablePets: Pet[];
    setPendingAiProfileId: (id: string) => void;
    setPendingPvpOpponent: (c: Character | null) => void;
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    recordMissionExplore: (sector: number) => void;
    setPendingExploreSector: (sector: number | null) => void;
    playableAis: CreatorAi[];
    setCurrentWeather: (weather: WeatherType) => void;
    playerRoster: PlayerRecord[];
    liveSectorPlayers: PlayerRecord[];
    currentSector: number;
    setCurrentSector: (sector: number) => void;
    isTraveling: boolean;
    travelingUntil: number;
    setTravelingUntil: (until: number) => void;
    sectorAttackPlayer: (opponent: PlayerRecord) => void;
    acceptedMissionIds: string[];
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    sharedImages?: Record<string, string>;
    onStartEventEncounter: (event: CreatorEvent, battle?: EventEncounterBattle) => void;
    onDungeonFound: () => void;
    onEnterHollowGate?: () => void;
    setPvpBattleId: (id: string) => void;
    setPvpRole: (role: "p1" | "p2") => void;
    setPvpBattleContext: (context: SharedPvpBattleContext | null) => void;
    setPvpSeedSession: (session: PvpSessionState | null) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorItems: GameItem[];
    onImmediateSave?: (char: Character) => void;
}) {
    const [selectedSector, setSelectedSector] = useState<number | null>(null);
    const [selectedVillageTerritory, setSelectedVillageTerritory] = useState<typeof locations[number] | null>(null);
    const [territoryGuards, setTerritoryGuards] = useState<{ name: string; level: number; village: string; defenseBonusPercent?: number }[]>([]);
    const [sectorEnemyGuards, setSectorEnemyGuards] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);

    // ── Scout Network (clan upgrade) ──────────────────────────────────────
    // During the viewer clan's active clan war, surface enemy-clan members who
    // are out in the world (hidden while they sit safe at their own village).
    // The Scout Network building level gates how much detail each dot shows.
    const [scoutInfo, setScoutInfo] = useState<{ tier: 0 | 1 | 2 | 3; enemyClans: string[] }>({ tier: 0, enemyClans: [] });
    useEffect(() => {
        let cancelled = false;
        const clan = character.clan;
        if (!clan) { setScoutInfo({ tier: 0, enemyClans: [] }); return; }
        void (async () => {
            const [clanRec, wars] = await Promise.all([
                fetchClanData(clan) as Promise<{ upgrades?: Record<string, number> } | null>,
                cwListWars(),
            ]);
            if (cancelled) return;
            const tier = scoutIntelTier(clanRec?.upgrades?.scoutNetwork ?? 0);
            const mine = clan.toLowerCase();
            const enemyClans = wars
                .filter((w) => !w.endedAt && w.clans.some((c) => c.toLowerCase() === mine))
                .map((w) => w.clans.find((c) => c.toLowerCase() !== mine) ?? "")
                .filter(Boolean);
            setScoutInfo({ tier, enemyClans });
        })();
        return () => { cancelled = true; };
    }, [character.clan]);
    const scoutedSectors = useMemo(() => {
        const map = new Map<number, PlayerRecord[]>();
        if (scoutInfo.tier < 1 || scoutInfo.enemyClans.length === 0) return map;
        const enemySet = new Set(scoutInfo.enemyClans.map((c) => c.toLowerCase()));
        const now = Date.now();
        for (const p of playerRoster) {
            const pClan = (p.clan ?? "").toLowerCase();
            if (!pClan || !enemySet.has(pClan)) continue;
            const sector = p.currentSector;
            if (typeof sector !== "number" || sector <= 0) continue;
            // Hide enemies sitting safe at their own village (home outskirts sector).
            if (sector === villageOutskirtsSectorNumber(p.village)) continue;
            // Only show recently-seen players (drop stale presence).
            if (p.lastSeenAt && now - p.lastSeenAt > 90_000) continue;
            const arr = map.get(sector) ?? [];
            arr.push(p);
            map.set(sector, arr);
        }
        return map;
    }, [playerRoster, scoutInfo]);
    function scoutDotTitle(players: PlayerRecord[], tier: 1 | 2 | 3): string {
        if (tier >= 3) return "Enemy clan: " + players.map((p) => `${p.name} (Lv ${p.level})`).join(", ");
        if (tier === 2) return `Enemy clan here · ${players.length} · level${players.length > 1 ? "s" : ""} ${players.map((p) => p.level).join(", ")}`;
        return `Enemy clan spotted · ${players.length} member${players.length > 1 ? "s" : ""}`;
    }

    useEffect(() => {
        if (!selectedVillageTerritory) { setTerritoryGuards([]); return; }
        fetch("/api/village-guard/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ village: selectedVillageTerritory.name }),
        }).then(r => r.ok ? r.json() : []).then(setTerritoryGuards).catch(() => setTerritoryGuards([]));
    }, [selectedVillageTerritory]);

    useEffect(() => {
        if (!selectedSector) { setSectorEnemyGuards([]); return; }
        const war = activeVillageWarsFor(character.village).find(w => w.warGroundSector === selectedSector);
        const enemyVillage = war?.villages.find(v => v !== character.village);
        if (!enemyVillage) { setSectorEnemyGuards([]); return; }
        fetch("/api/village-guard/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ village: enemyVillage }),
        }).then(r => r.ok ? r.json() : []).then(setSectorEnemyGuards).catch(() => setSectorEnemyGuards([]));
    }, [selectedSector, character.village]);

    async function fetchSavedPlayerCharacter(name: string): Promise<Character | null> {
        // Always prefer the authoritative combat save for PvP. Roster entries can be
        // avatar-only (heartbeat broadcasts { avatarImage }, which normalizes to a
        // level-1, no-jutsu default), so trusting them would load a broken opponent.
        // Fall back to a roster character only if the save fetch fails.
        const fromSave = (await fetchPlayerCombatSave(name))?.character;
        if (fromSave) return fromSave;
        const rosterMatch = playerRoster.find((player) => player.name.toLowerCase() === name.toLowerCase());
        return rosterMatch?.character ? normalizeCharacter(rosterMatch.character) : null;
    }

    async function startPvpRaid(opponent: Character, sector: number, biome: Biome, weather: WeatherType) {
        setCurrentSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weather);

        // Use local character data — the server hydrates both fighters from
        // their KV save records directly (see api/pvp/session.ts ~line 502),
        // so the redundant fetchPlayerCombatSave round trips that used to
        // gate this flow are unnecessary. The payload below is only
        // consulted as a fallback for fighters without a save (NPCs).
        const selfCharacter = character;
        const selfBloodlines = savedBloodlines;
        const selfCreatorJutsus = wmCreatorJutsus;
        const selfAllItems = getAllItems(wmCreatorItems);
        const p1Jutsus = getPvpJutsuLoadout(selfBloodlines, selfCreatorJutsus, selfCharacter);
        const opponentCharacter = opponent;
        const opponentBloodlines = savedBloodlines;
        const opponentCreatorJutsus = wmCreatorJutsus;
        const opponentAllItems = getAllItems(wmCreatorItems);
        const p2Jutsus = getPvpJutsuLoadout(opponentBloodlines, opponentCreatorJutsus, opponentCharacter);

        // Optimistic navigation — flip to the pvpBattle screen immediately
        // so the player sees the proper battle backdrop + a "Connecting to
        // battle session..." card instead of staring at the sector view
        // while the session POST resolves. The PvpBattleScreen session-fetch
        // effect is keyed on battleId, so the empty id just renders the
        // loading card; once we set the real id below the effect re-runs
        // and loads the grid.
        //
        // Note: this used to generate a client-side battleId and pass it
        // through both POSTs in parallel, but the server intentionally
        // ignores client-supplied ids (api/pvp/session.ts:544–550 — the
        // comment explains the scrape-via-stream vector that motivated the
        // change). The result was that the attacker's pvpBattle screen
        // fetched a non-existent session and was stuck on "Connecting..."
        // until the server-managed defender heartbeat happened to re-route
        // them — i.e. broken in production for the attacker. The challenge
        // now ships the *real* server-issued battleId so the defender
        // routes to the right session too.
        setPvpBattleId('');
        setPvpRole("p1");
        setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector });
        setScreen("pvpBattle");

        let battleId = '';
        try {
            const sr = await fetch('/api/pvp/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: stringifyPvpSessionPayload({
                    // Sector raid — fighters bring current vitals.
                    useCurrentVitals: true,
                    // Phase 3: server credits base ryo + XP on the win. `sector`
                    // is this raid's target (= handlePvpWin's reward sector).
                    baseRewards: true,
                    rewardSector: sector,
                    // Sector raids ride the sector's biome/weather (not ranked).
                    ...pvpSessionEnvironment(false, biome, weatherEffects[weather]?.positiveElement, weatherEffects[weather]?.negativeElement),
                    p1Character: { ...selfCharacter, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(selfCharacter, selfAllItems), bloodlineMult: getBloodlineMultiplier(selfCharacter, selfBloodlines), armorFactor: getCharacterArmorFactor(selfCharacter, selfAllItems), armorRawDR: getCharacterArmorRawDR(selfCharacter, selfAllItems), itemDamagePct: getEquippedItemBonus(selfCharacter, selfAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(selfCharacter, selfAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(selfCharacter, selfAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(selfCharacter, selfAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(selfCharacter, selfAllItems, "shield") },
                    p2Character: { ...opponentCharacter, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(opponentCharacter, opponentAllItems), bloodlineMult: getBloodlineMultiplier(opponentCharacter, opponentBloodlines), armorFactor: getCharacterArmorFactor(opponentCharacter, opponentAllItems), armorRawDR: getCharacterArmorRawDR(opponentCharacter, opponentAllItems), itemDamagePct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(opponentCharacter, opponentAllItems, "shield") },
                }),
            });
            if (sr.ok) {
                const data = await sr.json() as { battleId: string; session?: PvpSessionState };
                battleId = data.battleId;
                // Stash the session payload so PvpBattleScreen can render
                // the grid on first paint instead of flashing the
                // "Connecting..." card.
                if (data.session) setPvpSeedSession(data.session);
            }
        } catch { /* fallback below */ }

        if (!battleId) {
            // Session creation failed — refuse to fall through to the local-sim
            // arena. That fallback used to award PvP-win counters / Vanguard
            // seals / ryo / XP from a CLIENT-decided outcome with no server
            // session to cross-check. Route back to the world map with an
            // error so the player can retry, rather than have rewards quietly
            // inflated (or denied) by a transient outage.
            setPvpBattleId('');
            setPvpSeedSession(null);
            setPendingPvpOpponent(null);
            setRaidBattleKind("none");
            setScreen("worldMap");
            alert("Couldn't reach the battle server. Please try the raid again in a moment.");
            return;
        }

        // Surface the real battleId — PvpBattleScreen re-renders with both
        // the matching seed session and the right id, so the battle grid
        // appears without the loading card showing.
        setPvpBattleId(battleId);

        // Notify defender via DuelChallenge with the real battleId. Fire-
        // and-forget: the session is already live on the server; if the
        // defender's challenge POST fails (e.g. they just started
        // traveling) we alert and bounce the attacker back to the world
        // map so they aren't stuck waiting on an empty session.
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: opponentCharacter.name,
            challenger: character,
            challengerJutsus: p1Jutsus,
            challengerBloodlineMult: getBloodlineMultiplier(selfCharacter, selfBloodlines),
            createdAt: Date.now(),
            mode: "standard",
            sectorAttack: true,
            battleId,
        };
        fetch('/api/player/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: opponentCharacter.name, challenge }),
        }).then((res) => {
            if (!res.ok) {
                alert(`${opponentCharacter.name} is traveling and cannot be attacked right now.`);
                setPvpBattleId('');
                setScreen("worldMap");
            }
        }).catch(() => { /* defender notification is best-effort; session is live regardless */ });
    }

    function pickGuardAi(level: number, defenseBonusPercent = 0): string {
        const effectiveLevel = level + Math.floor(defenseBonusPercent * 2);
        if (effectiveLevel < 20) return "builtin-ai-mist-sentinel";
        if (effectiveLevel < 40) return "builtin-ai-ember-duelist";
        if (effectiveLevel < 60) return "builtin-ai-frost-sealer";
        if (effectiveLevel < 80) return "builtin-ai-shadow-weaver";
        return "builtin-ai-central-champion";
    }
    const [activePetEncounter, setActivePetEncounter] = useState<Pet | null>(null);
    const [petVnDone, setPetVnDone] = useState(false);
    const [petVnPage, setPetVnPage] = useState(0);
    const [petVnLine, setPetVnLine] = useState(0);
    const [sectorPlayerPos, setSectorPlayerPos] = useState(78);
    const [selectedCreatorEvent, setSelectedCreatorEvent] = useState<CreatorEvent | null>(null);
    const [creatorEventPage, setCreatorEventPage] = useState(0);
    const [creatorEventLine, setCreatorEventLine] = useState(0);
    type ChestLoot = {
        xp: number;
        ryo?: number;
        itemId?: string;
        cardId?: string;
        fateShards?: number;
        boneCharms?: number;
        auraStones?: number;
        auraDust?: number;
    };
    const [activeChest, setActiveChest] = useState<ChestLoot | null>(null);
    const [chestVnPage, setChestVnPage] = useState(0);
    const [chestVnLine, setChestVnLine] = useState(0);
    const [chestVnDone, setChestVnDone] = useState(false);
    const locations = [
        // Each village sits on top of its outskirts-sector coordinate so the
        // marker stamps the same point the engine treats as that village.
        // Stormveil  -> sector 31 (20, 65)
        // Ashen Leaf -> sector 38 (24, 18)
        // Frostfang  -> sector 47 (62, 11)
        // Moonshadow -> sector 11 (81, 67)
        // Coords aligned to the new World Map.png baked-in banners (measured on a
        // 0–100 grid + crosshair triangulation): each village marker sits ON its
        // painted banner icon medallion (the icon hexagon at the banner's far-left).
        { name: "Stormveil Village", type: "village", biome: "forest" as Biome, x: 12, y: 84, icon: "SV" },
        { name: "Ashen Leaf Village", type: "village", biome: "volcano" as Biome, x: 11, y: 37, icon: "AL" },
        { name: "Frostfang Village", type: "village", biome: "snow" as Biome, x: 78, y: 37, icon: "FF" },
        { name: "Moonshadow Village", type: "village", biome: "shadow" as Biome, x: 75, y: 83, icon: "MS" },
        { name: "Central", type: "central", biome: "central" as Biome, x: 49, y: 45, icon: "C", staminaReward: 20, xpReward: 20 },
        // Hollow Gate — the dark gothic spire painted just below the central citadel.
        { name: "Hollow Gate", type: "hollowGate", biome: "shadow" as Biome, x: 50, y: 79, icon: "HG" },
    ];
    const [selectedLandmark, setSelectedLandmark] = useState<(typeof locations)[number] | null>(null);
    const sectorPoints = [
        // ── Shadow / Moonshadow territory (1–20) — bottom-right quadrant ──
        { id: 1, x: 58, y: 50 }, { id: 2, x: 64, y: 49 }, { id: 3, x: 71, y: 49 }, { id: 4, x: 78, y: 50 }, { id: 5, x: 85, y: 53 },
        { id: 6, x: 91, y: 58 }, { id: 7, x: 63, y: 57 }, { id: 8, x: 70, y: 57 }, { id: 9, x: 77, y: 58 }, { id: 10, x: 84, y: 61 },
        { id: 11, x: 72, y: 79 }, { id: 12, x: 90, y: 66 }, { id: 13, x: 63, y: 65 }, { id: 14, x: 70, y: 66 }, { id: 15, x: 79, y: 67 },
        { id: 16, x: 86, y: 70 }, { id: 17, x: 92, y: 75 }, { id: 18, x: 66, y: 75 }, { id: 19, x: 81, y: 76 }, { id: 20, x: 88, y: 81 },
        // ── Forest / Stormveil territory (21–35) — bottom-left quadrant ──
        { id: 21, x: 15, y: 57 }, { id: 22, x: 23, y: 55 }, { id: 23, x: 31, y: 57 }, { id: 24, x: 39, y: 59 }, { id: 25, x: 45, y: 53 },
        { id: 26, x: 13, y: 65 }, { id: 27, x: 21, y: 66 }, { id: 28, x: 29, y: 67 }, { id: 29, x: 37, y: 68 }, { id: 30, x: 44, y: 66 },
        { id: 31, x: 18, y: 78 }, { id: 32, x: 26, y: 77 }, { id: 33, x: 34, y: 79 }, { id: 34, x: 41, y: 80 }, { id: 35, x: 44, y: 90 },
        // ── Volcano / Ashen Leaf territory (36–45) — top-left quadrant ──
        { id: 36, x: 13, y: 30 }, { id: 37, x: 20, y: 23 }, { id: 38, x: 18, y: 42 }, { id: 39, x: 28, y: 20 }, { id: 40, x: 35, y: 22 },
        { id: 41, x: 43, y: 27 }, { id: 42, x: 25, y: 32 }, { id: 43, x: 32, y: 30 }, { id: 44, x: 39, y: 35 }, { id: 45, x: 45, y: 38 },
        // ── Snow / Frostfang territory (46–55) — top-right quadrant ──
        { id: 46, x: 58, y: 18 }, { id: 47, x: 82, y: 44 }, { id: 48, x: 65, y: 15 }, { id: 49, x: 73, y: 15 }, { id: 50, x: 81, y: 19 },
        { id: 51, x: 60, y: 28 }, { id: 52, x: 67, y: 27 }, { id: 53, x: 74, y: 29 }, { id: 54, x: 81, y: 31 }, { id: 55, x: 90, y: 30 },
        // ── Central ring (56–60) — heart of the map ──
        { id: 56, x: 44, y: 47 }, { id: 57, x: 54, y: 48 }, { id: 58, x: 48, y: 55 }, { id: 59, x: 55, y: 58 }, { id: 60, x: 49, y: 64 },
        { id: 99, x: 51, y: 10 }, // Death's Gate — cursed PvP zone (on the volcano)
    ];

    function biomeForSector(sector: number): Biome {
        if (sector === 99) return "volcano"; // Death's Gate — cursed volcanic frontier
        if (sector >= 56) return "central"; // Central meadow
        if (sector <= 20) return "shadow";  // Moonshadow shadow territory
        if (sector <= 35) return "forest";  // Stormveil forest territory
        if (sector <= 45) return "volcano"; // Ashen Leaf volcano territory
        return "snow";                      // Frostfang snow territory
    }

    // Sector adjacent to each home village (used for Outskirts)
    function villageOutskirtsSector(villageName: string): number {
        return villageOutskirtsSectorNumber(villageName);
    }

    // Background image for enemy village territory pages
    function villageTerritorySectorBg(villageName: string): string {
        return villagePageImage(villageName);
    }

    function enterLandmark(location: typeof locations[number]) {
        setCurrentBiome(location.biome);
        setCurrentWeather(weatherForBiome(location.biome));
        // Hollow Gate is a forbidden shrine. Entry is gated by either the Kage's
        // village-wide unlock OR a Hollow Gate Key (handled inside the entry
        // function — it shows its own prompts for missing unlock / daily cap).
        if (location.type === "hollowGate") {
            onEnterHollowGate?.();
            return;
        }
        // Enemy village ? territory exploration page; own village & Central ? normal landmark
        if (location.type === "village" && location.name !== character.village) {
            setSelectedVillageTerritory(location);
        } else {
            setSelectedLandmark(location);
        }
    }
    function beginSectorTravel(sector: number, arrive: () => void) {
        if (isTraveling) return;
        if (currentSector === sector) {
            arrive();
            return;
        }
        const arrivalAt = Date.now() + 3000;
        setTravelingUntil(arrivalAt);
        setSelectedSector(null);
        setSelectedVillageTerritory(null);
        window.setTimeout(() => {
            arrive();
            setTravelingUntil(0);
        }, 3000);
    }
    function triggerTravelPoint(sector: number) {
        beginSectorTravel(sector, () => {
        if (sector === 35) {
            setCurrentBiome("volcano");
            setCurrentWeather(weatherForSector(sector, "volcano"));
            setCurrentSector(sector);
            setScreen("sunscarFestival");
            return;
        }

        const biome = biomeForSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);
        setSelectedSector(sector);
        });
    }

    // ── WASD / E keyboard controls inside a sector tile view ─────────────────────
    // W/A/S/D moves one tile in that direction on the 12-wide sector grid.
    // E explores the open sector.
    // Only active while a sector panel is open and focus is not in a text field.
    const SECTOR_GRID_W = 12;
    const SECTOR_GRID_SIZE = 144;
    useEffect(() => {
        if (!selectedSector) return;
        function handleKey(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            const key = e.key.toLowerCase();
            if (key === 'e') {
                e.preventDefault();
                exploreSector(selectedSector!);
                return;
            }
            if (!['w', 'a', 's', 'd'].includes(key)) return;
            e.preventDefault();
            setSectorPlayerPos(prev => {
                const col = prev % SECTOR_GRID_W;
                const row = Math.floor(prev / SECTOR_GRID_W);
                if (key === 'w' && row > 0)                          return prev - SECTOR_GRID_W;
                if (key === 's' && row < (SECTOR_GRID_SIZE / SECTOR_GRID_W) - 1) return prev + SECTOR_GRID_W;
                if (key === 'a' && col > 0)                          return prev - 1;
                if (key === 'd' && col < SECTOR_GRID_W - 1)          return prev + 1;
                return prev;
            });
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selectedSector]);

    function rollAncientChest(sector: number, allCards: TileCard[]): ChestLoot {
        // Always: XP scaled to sector
        const xp = 50 + Math.floor(sector * 2);

        // 50%: Ryo 100–500
        const ryo = Math.random() < 0.5
            ? 100 + Math.floor(Math.random() * 401)
            : undefined;

        // Loot slot roll (item, card, or currency)
        const lootRoll = Math.random();
        let itemId: string | undefined;
        let cardId: string | undefined;
        let fateShards: number | undefined;
        let boneCharms: number | undefined;
        let auraStones: number | undefined;
        const auraDust = Math.random() < 0.2 ? 5 + Math.floor(Math.random() * 11) : undefined;

        if (lootRoll < 0.2) {
            // 20% - pet treat
            const treat = petTreatItems[Math.floor(Math.random() * petTreatItems.length)];
            itemId = treat.id;
        } else if (lootRoll < 0.55) {
            // 35% - random common gear item
            const commons = starterItems.filter((i) => i.rarity === "common" && i.slot !== "item");
            if (commons.length) itemId = commons[Math.floor(Math.random() * commons.length)].id;
        } else if (lootRoll < 0.65) {
            // 10% - random rare gear item
            const rares = starterItems.filter((i) => i.rarity === "rare" && i.slot !== "item");
            if (rares.length) itemId = rares[Math.floor(Math.random() * rares.length)].id;
        } else if (lootRoll < 0.83) {
            // 18% - random common tile card
            const commonCards = allCards.filter((c) => c.rarity === "common");
            if (commonCards.length) cardId = commonCards[Math.floor(Math.random() * commonCards.length)].id;
        } else if (lootRoll < 0.92) {
            // 9% - random rare tile card
            const rareCards = allCards.filter((c) => c.rarity === "rare");
            if (rareCards.length) cardId = rareCards[Math.floor(Math.random() * rareCards.length)].id;
        } else if (lootRoll < 0.97) {
            // 5% - 1 Fate Shard
            fateShards = 1;
        } else if (lootRoll < 0.99) {
            // 2% - 1 Bone Charm
            boneCharms = 1;
        } else {
            // 1% - 1 Aura Stone
            auraStones = 1;
        }

        return { xp, ryo, itemId, cardId, fateShards, boneCharms, auraStones, auraDust };
    }

    function claimChest(loot: ChestLoot) {
        const leveled = gainXp(character, loot.xp);
        const newInventory = loot.itemId && (stackableItemIds.has(loot.itemId) || !character.inventory.includes(loot.itemId))
            ? [...character.inventory, loot.itemId]
            : character.inventory;
        const newTileCards = loot.cardId && !character.tileCards.includes(loot.cardId)
            ? [...character.tileCards, loot.cardId]
            : character.tileCards;
        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + (loot.ryo ?? 0),
            fateShards: leveled.fateShards + (loot.fateShards ?? 0),
            boneCharms: (leveled.boneCharms ?? 0) + (loot.boneCharms ?? 0),
            auraStones: (leveled.auraStones ?? 0) + (loot.auraStones ?? 0),
            auraDust: (leveled.auraDust ?? 0) + (loot.auraDust ?? 0),
            inventory: newInventory,
            tileCards: newTileCards,
        });
        setActiveChest(null);
        setChestVnDone(false);
        setChestVnPage(0);
        setChestVnLine(0);
    }

    function exploreSector(sector: number) {
        const dailyTiles = character.dailyTilesExplored ?? 0;
        if (dailyTiles >= 150) {
            alert("Daily tile exploration limit reached (150/150). Resets at midnight UTC.");
            return;
        }
        const exploredCharacter = {
            ...character,
            totalTilesExplored: (character.totalTilesExplored ?? 0) + 1,
            dailyTilesExplored: dailyTiles + 1,
            lastDailyReset: currentDateKey(),
        };
        const biome = biomeForSector(sector);
        setSelectedVillageTerritory(null);
        setSelectedSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);
        if (character.level >= hiddenDungeonVnEvent.levelReq && Math.random() < 0.02) {
            updateCharacter(exploredCharacter);
            recordMissionExplore(sector);
            onDungeonFound();
            return;
        }
        const petEncounter = rollPetEncounter(editablePets);

        if (petEncounter) {
            updateCharacter(exploredCharacter);
            recordMissionExplore(sector);

            setActivePetEncounter(petEncounter);
            setPetVnDone(false);
            setPetVnPage(0);
            setPetVnLine(0);
            return;
        }

        // 15% — Ancient Chest found
        if (Math.random() < 0.15) {
            updateCharacter(exploredCharacter);
            recordMissionExplore(sector);

            const allCards = getAllTileCards([]);
            setActiveChest(rollAncientChest(sector, allCards));
            setChestVnPage(0);
            setChestVnLine(0);
            setChestVnDone(false);
            return;
        }

        const battleRoll = Math.random();

        // 80% random AI battle chance — pick AI closest in level to the player.
        // Boss AIs are excluded from ambush encounters.
        if (battleRoll <= 0.80 && playableAis.length > 0) {
            const normalAis = playableAis.filter(ai => !ai.isBossAi);
            const pool = normalAis.length > 0 ? normalAis : playableAis;
            const sorted = [...pool].sort((a, b) => Math.abs((a.level ?? 1) - character.level) - Math.abs((b.level ?? 1) - character.level));
            const closestLevel = Math.abs((sorted[0].level ?? 1) - character.level);
            const levelMatches = sorted.filter(ai => Math.abs((ai.level ?? 1) - character.level) === closestLevel);
            const randomAi = levelMatches[Math.floor(Math.random() * levelMatches.length)];

            updateCharacter(exploredCharacter);
            // Defer explore-mission credit until the ambush is WON (winBattle).
            // Losing/fleeing the ambush no longer counts the tile as explored.
            setPendingExploreSector(sector);
            alert(`A hostile shinobi appears: ${randomAi.name}!`);
            setPendingAiProfileId(randomAi.id);
            setScreen("arena");
            return;
        }

        const xpReward = 20 + Math.floor(sector / 5);
        const ryoReward = 10 + Math.floor(sector / 4);
        const leveled = gainXp(exploredCharacter, xpReward);

        recordMissionExplore(sector);
        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + ryoReward,
        });

        alert("Sector " + sector + " explored. +" + effectiveCharacterXpGain(character, xpReward) + " XP and +" + ryoReward + " ryo.");
    }
    function huntSector(sector: number) {
        if (sector < 1 || sector > 60) {
            alert("Hunting is only available in Sectors 1-60.");
            return;
        }

        const biome = biomeForSector(sector);
        setSelectedVillageTerritory(null);
        setSelectedSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);

        const activeHuntMission = builtinHuntMissions.find(
            (mission) =>
                acceptedMissionIds.includes(mission.id) &&
                mission.targetSector === sector &&
                mission.aiProfileId
        );

        if (!activeHuntMission) {
            alert(`No accepted hunt contract is active in Sector ${sector}.`);
            return;
        }

        const requiredTracks = activeHuntMission.exploreCount ?? 1;
        const currentProgress = missionProgress[activeHuntMission.id] ?? 0;
        const nextProgress = Math.min(requiredTracks, currentProgress + 1);

        if (nextProgress < requiredTracks) {
            // Still gathering tracks — advance the tracking counter and stop.
            setMissionProgress((current) => ({
                ...current,
                [activeHuntMission.id]: Math.max(nextProgress, current[activeHuntMission.id] ?? 0),
            }));
            alert(`${activeHuntMission.name}: tracks found in Sector ${sector}. ${nextProgress}/${requiredTracks}`);
            return;
        }

        // Final track = the kill attempt. Do NOT complete progress here — that
        // is what let a player claim the hunt reward after dying/fleeing. Hold
        // the counter at requiredTracks-1; winBattle() completes it on an actual
        // kill via onHuntBeastDefeated. Losing leaves it here so the beast can be
        // re-engaged without re-tracking.
        setMissionProgress((current) => ({
            ...current,
            [activeHuntMission.id]: Math.max(requiredTracks - 1, current[activeHuntMission.id] ?? 0),
        }));

        const huntAi = playableAis.find((ai) => ai.id === activeHuntMission.aiProfileId);
        if (!huntAi) {
            alert("Beast AI not found.");
            return;
        }

        alert(`You've tracked down the ${huntAi.name}! Prepare to fight!`);
        setPendingAiProfileId(huntAi.id);
        setRaidBattleKind("raidAi");
        setScreen("arena");
    }
    function restInSector(sector: number) {
        const staminaReward = 10 + (sector % 10);

        updateCharacter({
            ...character,
            stamina: Math.min(character.maxStamina, character.stamina + staminaReward),
        });

        alert("You recovered in Sector " + sector + ". +" + staminaReward + " stamina.");
    }

    function triggerCreatorEvent(event: CreatorEvent) {
        const sector = event.targetSector ?? 56;
        const biome = biomeForWorldSector(sector);
        setCurrentSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        if (character.level < event.levelReq) return alert("Requires level " + event.levelReq + ".");
        if (event.eventKind === "visualNovel") {
            setCreatorEventPage(0);
            setCreatorEventLine(0);
            setSelectedCreatorEvent(event);
            return;
        }
        const leveled = gainXp(character, event.xpReward);
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.icon + " " + event.name + "\n\n" + event.dialogue.join("\n") + "\n\n" + rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards, character));
    }
    function completeCreatorEvent(event: CreatorEvent) {
        const leveled = gainXp(character, event.xpReward);
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.name + " complete. " + rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards, character) + ".");
        setSelectedCreatorEvent(null);
    }
    if (activePetEncounter && !petVnDone) {
        const vn = petEncounterVn;
        const pages = vn.vnPages && vn.vnPages.length > 0 ? vn.vnPages : [{ title: vn.vnTitle || vn.name, scene: vn.vnScene || "", speaker: vn.vnSpeaker || "Narrator", dialogue: vn.dialogue, image: vn.image, choices: [] }];
        const page = pages[Math.min(petVnPage, pages.length - 1)];
        const pageDialogue = page.dialogue.length > 0 ? page.dialogue : vn.dialogue;
        const activeLine = pageDialogue[petVnLine] ?? pageDialogue[0] ?? page.scene ?? "A presence stirs nearby.";
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || vn.vnSpeaker || "Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
        const pageImage = page.image || vn.image || activePetEncounter.image || defaultVnScene(vn.id, "forest");
        const canBack = petVnLine > 0 || petVnPage > 0;
        const isLastPage = petVnPage >= pages.length - 1;
        const isLastLine = petVnLine >= pageDialogue.length - 1;

        function vnBack() {
            if (petVnLine > 0) { setPetVnLine((l) => l - 1); return; }
            if (petVnPage > 0) { const prev = pages[petVnPage - 1]; setPetVnPage((p) => p - 1); setPetVnLine(Math.max(0, (prev.dialogue.length || 1) - 1)); }
        }
        function vnNext() {
            if (!isLastLine) { setPetVnLine((l) => l + 1); return; }
            if (!isLastPage) { setPetVnPage((p) => p + 1); setPetVnLine(0); return; }
            setPetVnDone(true);
        }

        return (
            <div className="card cinematic-card">
                <div className="visual-novel admin-vn-play">
                    <div className="vn-header">
                        <div>
                            <p className="act-label">🐾 PET ENCOUNTER</p>
                            <h2>{page.title || vn.vnTitle || "A Presence in the Shadows"}</h2>
                        </div>
                        <div className="vn-progress">Page {petVnPage + 1}/{pages.length} | Line {petVnLine + 1}/{Math.max(1, pageDialogue.length)}</div>
                    </div>
                    <div className={"vn-stage vn-biome-forest" + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}>
                        <div className="vn-backdrop"><span className="vn-village-silhouette" /></div>
                        <div className="vn-character mentor-character">{character.avatarImage ? <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : character.name.slice(0, 2).toUpperCase()}</div>
                        <div className="vn-character hero-character">{activePetEncounter.image ? <img src={activePetEncounter.image} alt={activePetEncounter.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : "🐾"}</div>
                        <div className="vn-scene-card">{page.scene || vn.vnScene || "Something moves through the undergrowth."}</div>
                        <div className="vn-dialogue">
                            <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                            <p>{spoken}</p>
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={vnBack}>Back</button>
                                <button onClick={vnNext}>{isLastPage && isLastLine ? "Continue" : "Next"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (activePetEncounter && petVnDone) {
        return (
            <div className="card cinematic-card">
                <h2>🐾 {activePetEncounter.name} Wants to Join You!</h2>

                <div className="summary-box">
                    <h3>{activePetEncounter.name}</h3>
                    <p><strong>Rarity:</strong> {activePetEncounter.rarity}</p>
                    <p><strong>Level:</strong> {activePetEncounter.level}</p>
                    <p>
                        HP {activePetEncounter.hp} | ATK {activePetEncounter.attack} |
                        DEF {activePetEncounter.defense} | SPD {activePetEncounter.speed}
                    </p>

                    {activePetEncounter.image && (
                        <div className="admin-jutsu-preview">
                            <img src={activePetEncounter.image} alt={activePetEncounter.name} />
                        </div>
                    )}
                </div>

                <div className="menu">
                    <button
                        onClick={() => {
                            // Re-read length inside the handler in case of fast double-click.
                            if (character.pets.length >= 5) {
                                return alert("Your Pet Yard is full (5/5). Release a pet before befriending another.");
                            }
                            // Capture the encounter and clear it immediately so a second
                            // click before re-render finds no encounter and does nothing.
                            const encounter = activePetEncounter;
                            setActivePetEncounter(null);
                            const trait = rollPetTrait(encounter.rarity);
                            const petWithTrait = applyPetTraitBonuses({ ...encounter, trait }, trait);
                            const updatedChar = { ...character, pets: [...character.pets, petWithTrait] };
                            updateCharacter(updatedChar);
                            // Explicitly push to server so the pet isn't lost on reload
                            // before the auto-save interval fires.
                            onImmediateSave?.(updatedChar);
                            alert(`${encounter.name} joined you!\nTrait: ${trait} — ${petTraitDescriptions[trait]}`);
                        }}
                    >
                        Befriend Pet
                    </button>

                    <button
                        className="danger-button"
                        onClick={() => setActivePetEncounter(null)}
                    >
                        Leave
                    </button>
                </div>
            </div>
        );
    }
    if (selectedCreatorEvent) {
        return <TriggeredVisualNovel event={selectedCreatorEvent} character={character} pageIndex={creatorEventPage} lineIndex={creatorEventLine} setPageIndex={setCreatorEventPage} setLineIndex={setCreatorEventLine} onCancel={() => setSelectedCreatorEvent(null)} onComplete={() => completeCreatorEvent(selectedCreatorEvent)} onBattle={onStartEventEncounter} sharedImages={sharedImages} />;
        const event = selectedCreatorEvent!;
        const eventPages = event.vnPages ?? [];
        const pages = (eventPages.length > 0 ? eventPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }]) as NonNullable<CreatorEvent["vnPages"]>;
        const page = pages[Math.min(creatorEventPage, pages.length - 1)];
        const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
        const activeLine = pageDialogue[creatorEventLine] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || event.vnSpeaker || "Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const pageImage = page.image || event.image || defaultVnScene(event.id, event.biome);
        const savedRightWasPlayer = (page.rightName ?? "").trim().toLowerCase() === "player";
        const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
        const rightName = savedRightWasPlayer ? (page.leftName || page.speaker || event.vnSpeaker || speaker) : (page.rightName || page.speaker || event.vnSpeaker || speaker);
        const leftInitials = leftName === "Narrator" ? "..." : leftName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const rightInitials = rightName.toLowerCase() === "player" ? character.name.slice(0, 2).toUpperCase() : rightName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const leftImage = savedRightWasPlayer ? character.avatarImage : (page.leftImage || (leftName.toLowerCase() === "player" ? character.avatarImage : ""));
        const rightImage = savedRightWasPlayer ? (page.leftImage || page.rightImage || event.avatarImage || "") : (page.rightImage || event.avatarImage || "");
        const canBack = creatorEventLine > 0 || creatorEventPage > 0;
        function previousLine() { if (creatorEventLine > 0) return setCreatorEventLine((index) => index - 1); if (creatorEventPage > 0) { const previousPage = pages[creatorEventPage - 1]; setCreatorEventPage((index) => index - 1); setCreatorEventLine(Math.max(0, (previousPage.dialogue.length || 1) - 1)); } }
        function nextLine() { if (creatorEventLine < pageDialogue.length - 1) return setCreatorEventLine((index) => index + 1); if (creatorEventPage < pages.length - 1) { setCreatorEventPage((index) => index + 1); setCreatorEventLine(0); return; } completeCreatorEvent(event); }
        return <div className="card cinematic-card"><div className="visual-novel admin-vn-play"><div className="vn-header"><div><p className="act-label">ADMIN VISUAL NOVEL EVENT</p><h2>{page.title || event.vnTitle || event.name}</h2></div><div className="vn-progress">Page {creatorEventPage + 1}/{pages.length} | Line {creatorEventLine + 1}/{Math.max(1, pageDialogue.length)}</div></div><div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}><div className="vn-backdrop"><span className="vn-village-silhouette"></span></div><div className="vn-character mentor-character">{leftImage ? <img src={leftImage} alt={leftName} /> : leftInitials}</div><div className="vn-character hero-character">{rightImage ? <img src={rightImage} alt={rightName} /> : rightInitials}</div><div className="vn-scene-card">{page.scene || event.vnScene || "An admin-created scene unfolds across the shinobi world."}</div><div className="vn-dialogue"><div className="vn-speaker">{speaker}</div><p>{spoken}</p><div className="vn-controls"><button disabled={!canBack} onClick={previousLine}>Back</button><button onClick={nextLine}>{creatorEventPage === pages.length - 1 && creatorEventLine >= pageDialogue.length - 1 ? "Complete Event" : "Next"}</button></div></div></div><div className="vn-choice-row"><button onClick={() => { setCreatorEventPage(0); setCreatorEventLine(0); }}>Replay Scene</button><button onClick={() => { setPendingAiProfileId(event.aiProfileId ?? ""); setCurrentBiome(event.biome); setCurrentWeather(weatherForBiome(event.biome)); setScreen("arena"); }}>Battle in {biomeLabel(event.biome)}</button><button onClick={() => completeCreatorEvent(event)}>Claim Reward</button></div><div className="vn-reward-strip"><span>Requirement: Level {event.levelReq}</span><span>Reward: {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</span></div></div></div>;
    }
    if (activeChest && !chestVnDone) {
        const biome = biomeForSector(selectedSector ?? 40);
        const biomeLabelText = biome === "snow" ? "frozen tundra" : biome === "volcano" ? "volcanic ash fields" : biome === "shadow" ? "shadowed ruins" : biome === "central" ? "ancient central district" : "dense forest";
        const vnPages = [
            {
                title: "Something Stirs in the Ruins",
                scene: `Deep within the ${biomeLabelText}, a faint shimmer catches your eye.`,
                speaker: "Narrator",
                dialogue: [
                    "Narrator: You pause. Something between the rubble is glowing.",
                    "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                    `${character.name}: These runes... pre-war era seals. This thing has been here a long time.`,
                    "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                    `${character.name}: Whoever left this... they wanted someone strong enough to find it.`,
                    "Narrator: You press your hand to the seal. It dissolves at your touch.",
                ],
            },
            {
                title: "The Chest Opens",
                scene: "Golden light spills from the ancient chest as the seal breaks.",
                speaker: "Narrator",
                dialogue: [
                    "Narrator: The lid swings open with a low resonant hum.",
                    "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                    `${character.name}: ...I wasn't expecting this.`,
                    "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
                ],
            },
        ];
        const page = vnPages[Math.min(chestVnPage, vnPages.length - 1)];
        const pageDialogue = page.dialogue;
        const activeLine = pageDialogue[chestVnLine] ?? pageDialogue[0];
        const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
        const speaker = splitLine[0].trim();
        const spoken = splitLine.slice(1).join(":").trim() || activeLine;
        const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
        const canBack = chestVnLine > 0 || chestVnPage > 0;
        const isLastPage = chestVnPage >= vnPages.length - 1;
        const isLastLine = chestVnLine >= pageDialogue.length - 1;
        function chestVnBack() {
            if (chestVnLine > 0) { setChestVnLine((l) => l - 1); return; }
            if (chestVnPage > 0) { const prev = vnPages[chestVnPage - 1]; setChestVnPage((p) => p - 1); setChestVnLine(Math.max(0, prev.dialogue.length - 1)); }
        }
        function chestVnNext() {
            if (!isLastLine) { setChestVnLine((l) => l + 1); return; }
            if (!isLastPage) { setChestVnPage((p) => p + 1); setChestVnLine(0); return; }
            setChestVnDone(true);
        }

        const chestPageImage = ancientChestVn.vnPages?.[chestVnPage]?.image || ancientChestVn.image || defaultVnScene(ancientChestVn.id, biome);
        return (
            <div className="card cinematic-card ancient-chest-vn-card">
                <div className="visual-novel admin-vn-play">
                    <div className="vn-header">
                        <div>
                            <p className="act-label">📦 ANCIENT CHEST DISCOVERED</p>
                            <h2>{page.title}</h2>
                        </div>
                        <div className="vn-progress">Page {chestVnPage + 1}/{vnPages.length} | Line {chestVnLine + 1}/{pageDialogue.length}</div>
                    </div>
                    <div className={`vn-stage vn-biome-${biome}${chestPageImage ? " vn-has-image" : ""}`} style={chestPageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${chestPageImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
                        <div className="vn-backdrop">
                            {!chestPageImage && <span className="vn-village-silhouette" />}
                        </div>
                        <div className="vn-character mentor-character">🧙</div>
                        <div className="vn-character hero-character">
                            {(() => {
                                const playerAvatar = sharedImages?.['avatar:' + character.name.trim().toLowerCase()] || character.avatarImage || "";
                                return playerAvatar
                                    ? <img src={playerAvatar} alt={character.name} />
                                    : character.name.slice(0, 2).toUpperCase();
                            })()}
                        </div>
                        <div className="vn-scene-card">{page.scene}</div>
                        <div className="vn-dialogue">
                            <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                            <p>{spoken}</p>
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={chestVnBack}>Back</button>
                                <button onClick={chestVnNext}>{isLastPage && isLastLine ? "Open Chest" : "Next"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (activeChest && chestVnDone) {
        const allCards = getAllTileCards([]);
        const lootItem = activeChest.itemId ? starterItems.find((i) => i.id === activeChest.itemId) : null;
        const lootCard = activeChest.cardId ? allCards.find((c) => c.id === activeChest.cardId) : null;
        const alreadyHaveCard = lootCard && character.tileCards.includes(lootCard.id);
        const rewards: { icon: string; label: string; sub: string }[] = [
            { icon: "⭐", label: `+${displayCharacterXpGain(activeChest.xp)} XP`, sub: "Experience" },
        ];
        if (activeChest.ryo) rewards.push({ icon: "🪙", label: `+${activeChest.ryo} Ryo`, sub: "Ancient gold" });
        if (lootItem) rewards.push({ icon: stackableItemIds.has(lootItem.id) ? "📦" : lootItem.rarity === "rare" ? "⭐" : "🎁", label: lootItem.name, sub: `${lootItem.rarity.charAt(0).toUpperCase() + lootItem.rarity.slice(1)} ${lootItem.slot} · ${lootItem.description.slice(0, 40)}` });
        if (lootCard) rewards.push({ icon: lootCard.rarity === "rare" ? "🌟" : "🃏", label: `${lootCard.name}${alreadyHaveCard ? " (duplicate)" : ""}`, sub: `${lootCard.rarity.charAt(0).toUpperCase() + lootCard.rarity.slice(1)} · ${lootCard.element} · T:${lootCard.top} R:${lootCard.right} B:${lootCard.bottom} L:${lootCard.left}` });
        if (activeChest.fateShards) rewards.push({ icon: "🔮", label: "+1 Fate Shard", sub: "Premium currency" });
        if (activeChest.boneCharms) rewards.push({ icon: "🪬", label: "+1 Bone Charm", sub: "Awakening Stone material" });
        if (activeChest.auraStones) rewards.push({ icon: "💠", label: "+1 Aura Stone", sub: "Awakening Stone material" });
        if (activeChest.auraDust) rewards.push({ icon: "✨", label: `+${activeChest.auraDust} Aura Dust`, sub: "Feeds the Aura Sphere" });

        return (
            <div className="card cinematic-card ancient-chest-reveal-card">
                <div className="chest-reveal">
                    <div className="chest-reveal-header">
                        <p className="act-label">📦 ANCIENT CHEST CONTENTS</p>
                        <h2 className="chest-reveal-title">The chest yields its secrets</h2>
                        <p className="chest-reveal-sub">A relic of the shinobi wars, now yours to keep.</p>
                    </div>
                    <div className="chest-rewards">
                        {rewards.map((r, i) => (
                            <div key={i} className="chest-reward-row">
                                <span className="chest-reward-icon">{r.icon}</span>
                                <div className="chest-reward-text">
                                    <strong>{r.label}</strong>
                                    <small>{r.sub}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="chest-claim-btn" onClick={() => claimChest(activeChest)}>
                        🎁 Claim All Rewards
                    </button>
                </div>
            </div>
        );
    }

    if (isTraveling) {
        const secondsLeft = Math.max(1, Math.ceil((travelingUntil - Date.now()) / 1000));
        return (
            <div className="map-instance">
                <div className="card" style={{ maxWidth: 520, margin: "4rem auto", textAlign: "center" }}>
                    <h2>Traveling</h2>
                    <p className="hint">Moving between sectors. You cannot be attacked during travel.</p>
                    <div className="bar ap-bar"><span style={{ width: `${Math.max(0, Math.min(100, ((3 - secondsLeft) / 3) * 100))}%` }} /></div>
                    <p>{secondsLeft}s</p>
                </div>
            </div>
        );
    }

    if (selectedSector) {
        const biome = biomeForSector(selectedSector);
        const sectorWeather = weatherForSector(selectedSector, biome);
        const territory = loadSectorTerritory(selectedSector);
        const villageWar = activeVillageWarsFor(character.village).find(war => war.warGroundSector === selectedSector);
        const villageWarEnemy = villageWar?.villages.find(village => village !== character.village);
        const livePlayersHere = liveSectorPlayers
            .filter((p) => p.name.toLowerCase() !== character.name.toLowerCase())
            .filter((p) => sameSector(p.currentSector, selectedSector));
        const rosterPlayersHere = playerRoster
            .filter((player) => player.name.toLowerCase() !== character.name.toLowerCase())
            .filter((player) => sameSector(player.currentSector, selectedSector));
        const sectorPlayers = sameSector(currentSector, selectedSector)
            ? (livePlayersHere.length > 0 ? livePlayersHere : rosterPlayersHere)
            : [];
        const activeHuntMissionForSector = selectedSector >= 1 && selectedSector <= 60
            ? builtinHuntMissions.find((mission) =>
                acceptedMissionIds.includes(mission.id) &&
                mission.targetSector === selectedSector &&
                mission.aiProfileId
            )
            : undefined;
        const activeHuntAiForSector = activeHuntMissionForSector?.aiProfileId
            ? playableAis.find((ai) => ai.id === activeHuntMissionForSector.aiProfileId)
            : undefined;

        return (
            <div className="map-instance">
                <div className="instance-frame">
                    

                    <main className="tile-scene">
                        <div className="scene-title">
                            <strong>Sector {selectedSector}</strong>
                            <span>{biomeLabel(biome)} | {weatherEffects[sectorWeather].name}</span>
                        </div>

                        <div className="pixel-map walkable-sector-map sector-image-map">
                            {/* Living sector: a panning biome backdrop + atmosphere
                                behind, then 3D depth-particles, then 2D biome ambience
                                (snow/embers/petals/leaves/weather) in front. Ambience
                                biome matches the painted scene art; weather is the real
                                sector weather. All pointer-events:none, so tile
                                movement still works. */}
                            <SectorScene
                                image={territory.backgroundImage || sectorBackgroundImage(selectedSector)}
                                biome={ambienceBiomeForSector(selectedSector)}
                                focus={sectorPlayerPos}
                            />
                            <SectorScene3D
                                image={territory.backgroundImage || sectorBackgroundImage(selectedSector)}
                                biome={ambienceBiomeForSector(selectedSector)}
                                focus={sectorPlayerPos}
                                depth={territory.backgroundImage ? undefined : sectorDepthImage(selectedSector)}
                            />
                            {/* Biome ground-objects scattered across the field (rocks,
                                bushes, crystals, lanterns…) — explorable density under
                                the grid. Deterministic per sector. */}
                            <SectorScatter sector={selectedSector} biome={ambienceBiomeForSector(selectedSector)} />
                            {/* Time-of-day wash over the backdrop + depth layers (real
                                local clock) — keeps the hero, particles + markers crisp. */}
                            <DayNightSky />
                            <SceneAmbience3D biome={ambienceBiomeForSector(selectedSector)} />
                            <SceneAmbience biome={ambienceBiomeForSector(selectedSector)} weather={sectorWeather} />
                            {/* Biome wildlife (birds / butterflies / fireflies after
                                dark) — the layer that makes the sector feel patrolled,
                                not parked on a still image. */}
                            <SceneCritters biome={ambienceBiomeForSector(selectedSector)} />
                            {Array.from({ length: 144 }).map((_, index) => {
                                const isPlayer = index === sectorPlayerPos;
                                const otherHere = sectorPlayers.filter(p => playerNameTile(p.name) === index);

                                return (
                                    <button
                                        key={index}
                                        title={otherHere.length > 0 ? otherHere.map(p => `${p.name} (Lv ${p.level})`).join(", ") : undefined}
                                        className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""} ${otherHere.length > 0 ? "sector-other-tile" : ""}`}
                                        onClick={() => setSectorPlayerPos(index)}
                                    >
                                        {otherHere.length > 0 ? (
                                            <div className="other-players-map-stack">
                                                {otherHere.map(p => (
                                                    <div key={p.name} className="other-player-map-dot" title={`${p.name} Lv ${p.level}`}>
                                                        {(sharedImages['avatar:' + p.name.toLowerCase()] || (p.character.avatarImage as string) || '')
                                                            ? <img className="tiny-map-avatar other-player-map-avatar" src={sharedImages['avatar:' + p.name.toLowerCase()] || (p.character.avatarImage as string) || ''} alt={p.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                                            : <span className="other-player-map-emoji">🥷</span>
                                                        }
                                                        <span className="other-player-map-name">{p.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : ""}
                                    </button>
                                );
                            })}

                            <SectorAvatar
                                targetIndex={sectorPlayerPos}
                                avatarImage={character.avatarImage}
                                name={character.name}
                                biome={ambienceBiomeForSector(selectedSector)}
                            />

                            {/* Near-camera foliage band that parallaxes against the
                                backdrop as you cross the grid — the "walking THROUGH
                                the biome" depth cue. No-op until its biome band is baked. */}
                            <SectorForeground biome={ambienceBiomeForSector(selectedSector)} focus={sectorPlayerPos} />

                            {creatorEvents
                                .filter((event) => event.eventKind !== "visualNovel" && event.targetSector === selectedSector)
                                .map((event) => {
                                    const col = ((event.tileX ?? 0) % 12 + 12) % 12;
                                    const row = ((event.tileY ?? 0) % 12 + 12) % 12;
                                    return (
                                        <button
                                            key={`sector-event-${event.id}`}
                                            className="sector-encounter-marker sector-event-marker"
                                            style={{
                                                gridColumn: `${col + 1} / span 1`,
                                                gridRow: `${row + 1} / span 1`,
                                                alignSelf: "center",
                                                justifySelf: "center",
                                                zIndex: 5,
                                                background: "rgba(2,6,23,.85)",
                                                color: "#f8fafc",
                                                border: "2px solid #fef3c7",
                                                borderRadius: 8,
                                                padding: "4px 6px",
                                                fontSize: 10,
                                                lineHeight: 1.05,
                                                display: "grid",
                                                gap: 1,
                                                textAlign: "center",
                                                cursor: "pointer",
                                                boxShadow: "0 3px 0 rgba(2,6,23,.8), 0 0 16px rgba(0,0,0,.58)",
                                            }}
                                            onClick={() => triggerCreatorEvent(event)}
                                            title={`${event.name} | Lvl ${event.levelReq}`}
                                        >
                                            <strong style={{ color: "#facc15", fontSize: 16 }}>{event.icon}</strong>
                                            <span>{event.name}</span>
                                        </button>
                                    );
                                })}

                            {creatorRaids
                                .filter((raid) => raid.targetSector === selectedSector)
                                .map((raid) => {
                                    const col = ((raid.tileX ?? 0) % 12 + 12) % 12;
                                    const row = ((raid.tileY ?? 0) % 12 + 12) % 12;
                                    return (
                                        <button
                                            key={`sector-raid-${raid.id}`}
                                            className="sector-encounter-marker sector-raid-marker"
                                            style={{
                                                gridColumn: `${col + 1} / span 1`,
                                                gridRow: `${row + 1} / span 1`,
                                                alignSelf: "center",
                                                justifySelf: "center",
                                                zIndex: 5,
                                                background: "rgba(60,10,10,.88)",
                                                color: "#fff",
                                                border: "2px solid #fca5a5",
                                                borderRadius: 8,
                                                padding: "4px 6px",
                                                fontSize: 10,
                                                lineHeight: 1.05,
                                                display: "grid",
                                                gap: 1,
                                                textAlign: "center",
                                                cursor: "pointer",
                                                boxShadow: "0 3px 0 rgba(2,6,23,.8), 0 0 16px rgba(220,38,38,.45)",
                                            }}
                                            onClick={() => {
                                                if (character.level < raid.levelReq) {
                                                    alert(`Requires level ${raid.levelReq}.`);
                                                    return;
                                                }
                                                setCurrentSector(raid.targetSector!);
                                                setPendingAiProfileId(raid.aiProfileId || "");
                                                setRaidBattleKind("raidAi");
                                                setCurrentBiome(raid.biome);
                                                setCurrentWeather(weatherForBiome(raid.biome));
                                                setScreen("arena");
                                            }}
                                            title={`${raid.name} | ${raid.waves} waves | Lvl ${raid.levelReq}`}
                                        >
                                            <strong style={{ color: "#fca5a5", fontSize: 16 }}>{raid.icon}</strong>
                                            <span>{raid.name}</span>
                                        </button>
                                    );
                                })}
                        </div>
                    </main>

                    <aside className="instance-actions">
                        <h3>Sector {selectedSector}</h3>
                        <p>{weatherEffects[sectorWeather].effect}</p>
                        <section className="summary-box">
                            <h4>Territory Control</h4>
                            <p><strong>Owner:</strong> {territory.ownerClan ? `${territory.ownerClan} (${territory.ownerVillage})` : "Unclaimed"}</p>
                            {!territory.ownerClan && territory.rebuiltAt && (() => {
                                const msLeft = TERRITORY_REBUILD_COOLDOWN_MS - (Date.now() - territory.rebuiltAt);
                                if (msLeft <= 0) return null;
                                const minsLeft = Math.ceil(msLeft / 60000);
                                return <p style={{ color: "#e88", fontWeight: 600 }}>⏳ Recovering — capturable in {minsLeft}m</p>;
                            })()}
                            <div className="town-upgrade-bar"><span style={{ width: `${(territory.controlScore / TERRITORY_CONTROL_MAX) * 100}%` }} /></div>
                            <p>Control: {territory.controlScore.toLocaleString()} / {TERRITORY_CONTROL_MAX.toLocaleString()}</p>
                            <div className="bar enemy-bar"><span style={{ width: `${(territory.hp / TERRITORY_HP_MAX) * 100}%` }} /></div>
                            <p>HP: {territory.hp.toLocaleString()} / {TERRITORY_HP_MAX.toLocaleString()}</p>
                            <p>Guards: {territory.guards.length ? territory.guards.join(", ") : "None"}</p>
                            {villageWar && (
                                <div className="summary-box">
                                    <h4>Village War Ground</h4>
                                    <p>{character.village} vs {villageWarEnemy}</p>
                                    <p>War Ground HP: {villageWar.warGroundHp.toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()}</p>
                                    <p>{villageWarEnemy} HP: {villageWarEnemy ? villageWar.hp[villageWarEnemy].toLocaleString() : 0} / {VILLAGE_WAR_HP_MAX.toLocaleString()}</p>
                                    <button className="danger-button" disabled={villageWar.warGroundHp <= 0 || Boolean(villageWar.endedAt)} onClick={() => {
                                        const guard = sectorEnemyGuards[0];
                                        if (guard) {
                                            fetchSavedPlayerCharacter(guard.name).then((guardCharacter) => {
                                                if (guardCharacter) return startPvpRaid(guardCharacter, selectedSector, biome, sectorWeather);
                                                setPendingPvpOpponent(null);
                                                setPendingAiProfileId(pickGuardAi(guard.level, guard.defenseBonusPercent ?? 0));
                                                setRaidBattleKind("raidAi");
                                                setCurrentSector(selectedSector);
                                                setCurrentBiome(biome);
                                                setCurrentWeather(sectorWeather);
                                                setScreen("arena");
                                            });
                                            return;
                                        }
                                        setPendingPvpOpponent(null);
                                        setPendingAiProfileId(pickGuardAi(character.level));
                                        setRaidBattleKind("raidAi");
                                        setCurrentSector(selectedSector);
                                        setCurrentBiome(biome);
                                        setCurrentWeather(sectorWeather);
                                        setScreen("arena");
                                    }}>
                                        Raid Enemy Village
                                    </button>
                                </div>
                            )}
                            {territory.ownerClan && territory.ownerClan !== character.clan && (
                                <button className="danger-button" onClick={() => {
                                    setPendingPvpOpponent(null);
                                    setPendingAiProfileId(pickGuardAi(character.level));
                                    setRaidBattleKind("raidAi");
                                    setCurrentSector(selectedSector);
                                    setCurrentBiome(biome);
                                    setCurrentWeather(sectorWeather);
                                    setScreen("arena");
                                }}>
                                    Raid Controlled Sector
                                </button>
                            )}
                        </section>
                        <section className="sector-presence">
                            <h4>Players Here {livePlayersHere.length > 0 && <span className="live-badge">LIVE</span>}</h4>
                            {sectorPlayers.length === 0 ? (
                                <span>No other players in this sector.</span>
                            ) : (
                                sectorPlayers.map((player) => (
                                    <div className="sector-player-card" key={player.name}>
                                        <div className="sector-player-info">
                                            <strong>{player.name}</strong>
                                            <small>Level {player.level}{player.travelingUntil && player.travelingUntil > Date.now() ? " | Traveling" : ""}</small>
                                        </div>
                                        <button className="danger-button" disabled={Boolean(player.travelingUntil && player.travelingUntil > Date.now())} onClick={() => {
                                            if (player.travelingUntil && player.travelingUntil > Date.now()) {
                                                alert(`${player.name} is traveling and cannot be attacked right now.`);
                                                return;
                                            }
                                            setCurrentSector(selectedSector!);
                                            setCurrentBiome(biome);
                                            setCurrentWeather(sectorWeather);
                                            // sectorAttackPlayer handles its own routing — it sets the
                                            // screen to "pvpBattle" on a successful session POST and
                                            // falls back to "arena" only if session creation fails.
                                            // The redundant setScreen("arena") that used to live here
                                            // caused a 2–4s flash on the arena page (and the racy
                                            // arena mount could clobber the pvpBattle context) while
                                            // the session POST was in flight.
                                            sectorAttackPlayer(player);
                                        }}>{player.travelingUntil && player.travelingUntil > Date.now() ? "Traveling" : "⚔️ Attack"}</button>
                                    </div>
                                ))
                            )}
                        </section>
                        <button onClick={() => exploreSector(selectedSector)}>Explore Tile</button>
                        {activeHuntMissionForSector && (
                            <button onClick={() => huntSector(selectedSector)}>
                                Hunt {activeHuntAiForSector?.name ?? "Beast"}
                            </button>
                        )}
                        <button onClick={() => restInSector(selectedSector)}>Recover</button>
                        <button onClick={() => setSelectedSector(null)}>Leave</button>
                    </aside>
                </div>
            </div>
        );
    }

    if (selectedVillageTerritory) {
        const loc = selectedVillageTerritory;
        const biome = loc.biome;
        const weather = weatherForBiome(biome);
        const territoryBg = villageTerritorySectorBg(loc.name);
        // Pick a virtual sector number inside the enemy territory for explore/battle logic
        const virtualSector = villageOutskirtsSector(loc.name) + 4;
        return (
            <div className="map-instance">
                <div className="sector-instance-wrap">
                    <main className="tile-scene">
                        <div className="scene-title">
                            <strong>{loc.name} — Outer Territory</strong>
                            <span>{biomeLabel(biome)} | {weatherEffects[weather].name}</span>
                        </div>

                        <div className="pixel-map walkable-sector-map sector-image-map">
                            <SectorScene image={territoryBg} biome={biome} focus={sectorPlayerPos} />
                            <SectorScene3D image={territoryBg} biome={biome} focus={sectorPlayerPos} />
                            <SectorScatter sector={virtualSector} biome={biome} />
                            <DayNightSky />
                            <SceneAmbience3D biome={biome} />
                            <SceneAmbience biome={biome} weather={weather} />
                            <SceneCritters biome={biome} />
                            {Array.from({ length: 144 }).map((_, index) => {
                                const isPlayer = index === sectorPlayerPos;
                                return (
                                    <button
                                        key={index}
                                        className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""}`}
                                        onClick={() => setSectorPlayerPos(index)}
                                    />
                                );
                            })}

                            <SectorAvatar
                                targetIndex={sectorPlayerPos}
                                avatarImage={character.avatarImage}
                                name={character.name}
                                biome={loc.biome}
                            />
                            <SectorForeground biome={loc.biome} focus={sectorPlayerPos} />
                        </div>
                    </main>

                    <aside className="instance-actions">
                        <h3>{loc.name}</h3>
                        <p className="territory-hostile-tag">⚠️ Hostile Territory</p>
                        <p>{weatherEffects[weather].effect}</p>
                        <button onClick={() => exploreSector(virtualSector)}>Explore Territory</button>
                        <button onClick={() => restInSector(virtualSector)}>Recover</button>

                        {/* Village Guard / Raid */}
                        <div className="territory-guard-section">
                            {territoryGuards.length > 0 ? (
                                <>
                                    <p className="territory-guard-label">🛡️ Village Guarded</p>
                                    {territoryGuards.map(g => (
                                        <p key={g.name} className="territory-guard-name">
                                            {g.name} <span className="territory-guard-lvl">Lv.{g.level}</span>{g.defenseBonusPercent ? <span className="territory-guard-lvl"> DEF +{g.defenseBonusPercent.toFixed(1)}%</span> : null}
                                        </p>
                                    ))}
                                    <button
                                        className="territory-raid-btn"
                                        onClick={async () => {
                                            const guard = territoryGuards[0];
                                            setCurrentSector(virtualSector);
                                            setCurrentBiome(biome);
                                            setCurrentWeather(weather);

                                            // Fetch guard's actual character data
                                            let guardChar: Character | null = null;
                                            try {
                                                const cr = await fetch('/api/village-guard/challenge', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ attackerCharacter: character, village: loc.name, guardName: guard.name }),
                                                });
                                                const data = await cr.json() as { pvp?: boolean; guardCharacter?: unknown; guardLevel?: number; defenseBonusPercent?: number; };
                                                if (data.pvp && data.guardCharacter) guardChar = data.guardCharacter as Character;
                                            } catch { /* ignore */ }

                                            if (!guardChar) guardChar = await fetchSavedPlayerCharacter(guard.name);

                                            if (guardChar) {
                                                // Embed jutsu so server can resolve moves
                                                const [selfSave, guardSave] = await Promise.all([
                                                    fetchPlayerCombatSave(character.name),
                                                    fetchPlayerCombatSave(guardChar.name),
                                                ]);
                                                const selfChar = selfSave?.character ?? character;
                                                const selfBloodlines = selfSave?.savedBloodlines?.length ? selfSave.savedBloodlines : savedBloodlines;
                                                const selfCreatorJutsus = selfSave?.creatorJutsus?.length ? [...wmCreatorJutsus, ...selfSave.creatorJutsus] : wmCreatorJutsus;
                                                const p1j = getPvpJutsuLoadout(selfBloodlines, selfCreatorJutsus, selfChar);
                                                const guardSessionChar = guardSave?.character ?? guardChar;
                                                const guardBloodlines = guardSave?.savedBloodlines?.length ? guardSave.savedBloodlines : savedBloodlines;
                                                const guardCreatorJutsus = guardSave?.creatorJutsus?.length ? [...wmCreatorJutsus, ...guardSave.creatorJutsus] : wmCreatorJutsus;
                                                const p2j = getPvpJutsuLoadout(guardBloodlines, guardCreatorJutsus, guardSessionChar);
                                                // Create shared PvP session and notify the guard via challenge
                                                let battleId = '';
                                                try {
                                                    const sr = await fetch('/api/pvp/session', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: stringifyPvpSessionPayload({ useCurrentVitals: true, baseRewards: true, rewardSector: virtualSector, ...pvpSessionEnvironment(false, biome, weatherEffects[weather]?.positiveElement, weatherEffects[weather]?.negativeElement), p1Character: { ...selfChar, jutsu: p1j, pvpItems: getPvpItemLoadout(selfChar, getAllItems(wmCreatorItems)), bloodlineMult: getBloodlineMultiplier(selfChar, selfBloodlines), armorFactor: getCharacterArmorFactor(selfChar, getAllItems(wmCreatorItems)), armorRawDR: getCharacterArmorRawDR(selfChar, getAllItems(wmCreatorItems)), itemDamagePct: getEquippedItemBonus(selfChar, getAllItems(wmCreatorItems), "damagePercent") }, p2Character: { ...guardSessionChar, jutsu: p2j, pvpItems: getPvpItemLoadout(guardSessionChar, getAllItems(wmCreatorItems)), bloodlineMult: getBloodlineMultiplier(guardSessionChar, guardBloodlines), armorFactor: getCharacterArmorFactor(guardSessionChar, getAllItems(wmCreatorItems)), armorRawDR: getCharacterArmorRawDR(guardSessionChar, getAllItems(wmCreatorItems)), itemDamagePct: getEquippedItemBonus(guardSessionChar, getAllItems(wmCreatorItems), "damagePercent") } }),
                                                    });
                                                    if (sr.ok) {
                                                        // Seed PvpBattleScreen with the session returned
                                                        // by POST so the village-guard raid lands on the
                                                        // grid instantly, matching sector-attack snappiness.
                                                        const data = await sr.json() as { battleId: string; session?: PvpSessionState };
                                                        battleId = data.battleId;
                                                        if (data.session) setPvpSeedSession(data.session);
                                                    }
                                                } catch { /* fallback */ }

                                                if (battleId) {
                                                    // Send battleId to the guard so they auto-route to pvpBattle
                                                    fetch('/api/village-guard/challenge', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ attackerCharacter: character, village: loc.name, battleId, guardName: guardSessionChar.name }),
                                                    }).catch(() => {});
                                                    setPvpBattleId(battleId);
                                                    setPvpRole("p1");
                                                    setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector: virtualSector });
                                                    setScreen("pvpBattle");
                                                    return;
                                                }
                                                // Session creation failed — refuse to fall through to the
                                                // local-sim arena for a HUMAN guard. (The AI-guard fallback
                                                // below is fine — no human win-counter inflation possible.)
                                                // The local fallback would award PvP-win counters / honor
                                                // seals / ryo / XP from a client-decided outcome with no
                                                // server session to cross-check.
                                                setPendingPvpOpponent(null);
                                                setRaidBattleKind("none");
                                                alert("Couldn't reach the battle server. Please try challenging the guard again in a moment.");
                                                return;
                                            }

                                            // No guard character — AI fallback
                                            setPendingAiProfileId(pickGuardAi(guard.level, guard.defenseBonusPercent ?? 0));
                                            setRaidBattleKind("raidAi");
                                            setScreen("arena");
                                        }}
                                    >
                                        🛡️ Challenge Guard
                                    </button>
                                    <p className="hint" style={{ fontSize: "0.7rem", color: "#64748b", marginTop: 2 }}>
                                        Guard online? Real PvP. Guard offline? AI fight.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="territory-guard-label" style={{ color: "#475569" }}>Village Undefended</p>
                                    <button onClick={() => {
                                        setPendingPvpOpponent(null);
                                        setPendingAiProfileId(pickGuardAi(character.level));
                                        setRaidBattleKind("raidAi");
                                        setCurrentSector(virtualSector);
                                        setCurrentBiome(biome);
                                        setCurrentWeather(weather);
                                        setScreen("arena");
                                    }}>
                                        Raid {loc.name.split(" ")[0]}
                                    </button>
                                </>
                            )}
                        </div>

                        <button onClick={() => setSelectedVillageTerritory(null)}>Leave</button>
                    </aside>
                </div>
            </div>
        );
    }

    if (selectedLandmark) {
        const isCentral = selectedLandmark.type === "central";

        const villageImage =
            selectedLandmark.name === "Ashen Leaf Village" ? houseImg :
                selectedLandmark.name === "Frostfang Village" ? castleImg :
                    selectedLandmark.name === "Stormveil Village" ? towerImg :
                        selectedLandmark.name === "Moonshadow Village" ? moonshadowImage :
                            castleImg;

        return (
            <div className="map-instance">
                <div className="village-full-scene">
                    {!isCentral ? (
                        <img src={villageImage} alt={selectedLandmark.name} />
                    ) : (
                        <div className="central-full-scene">
                            <h1>The Thousand Gates</h1>
                        </div>
                    )}

                    {/* Living preview: time-of-day wash + drifting biome ambience +
                        wildlife behind the menu, so the village breathes while you
                        decide where to go. */}
                    <DayNightSky className="amb-under" />
                    <SceneAmbience className="amb-under" biome={selectedLandmark.biome} weather={weatherForBiome(selectedLandmark.biome)} />
                    <SceneCritters className="amb-under" biome={selectedLandmark.biome} density={0.85} />

                    <div className="village-full-overlay">
                        <h2>{selectedLandmark.name}</h2>
                        <p>{biomeLabel(selectedLandmark.biome)}</p>

                        <div className="menu">
                            {isCentral ? (
                                <button onClick={() => {
                                    setCurrentBiome("central");
                                    setScreen("centralHub");
                                }}>
                                    Enter Central
                                </button>
                            ) : (
                                <button onClick={() => setScreen("village")}>Enter {selectedLandmark.name.split(" ")[0]}</button>
                            )}

                            {isCentral ? (
                                <button onClick={() => { setCurrentBiome("central"); setCurrentWeather(weatherForBiome("central")); setScreen("arena"); }}>
                                    Central Battle
                                </button>
                            ) : (
                                <button onClick={() => {
                                    const outskirtsSector = villageOutskirtsSector(character.village);
                                    setCurrentBiome(biomeForSector(outskirtsSector));
                                    setCurrentWeather(weatherForSector(outskirtsSector, biomeForSector(outskirtsSector)));
                                    setSelectedLandmark(null);
                                    setSelectedSector(outskirtsSector);
                                }}>
                                    Outskirts
                                </button>
                            )}

                            <button onClick={() => setSelectedLandmark(null)}>Leave</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            {/* scroll wrapper keeps the map pannable on narrow mobile screens */}
            <div className="world-map-scroll">
            <div
                className="anime-world-map atlas-world-map generated-world-map"
                style={{ backgroundImage: `url(${worldMapBg})` }}
            >
                {/* Gentle magical-dust + light-sweep over the whole world (sits
                    behind the z-10 sector/village markers). Keeps the overworld
                    feeling alive without obscuring the painted map. */}
                <SceneAmbience biome="central" intensity={0.5} />
                {/* Real-clock time-of-day wash + a high, sparse bird flock drifting
                    over the atlas. Both sit below the z-10 markers. */}
                <DayNightSky className="amb-under" intensity={0.8} />
                <SceneCritters biome="central" mode="world" className="amb-under" />
                {/* Per-nation biome atmosphere — a soft elemental glow over each
                    homeland so the four regions read at a glance. */}
                {[
                    { c: "volcano", x: 11, y: 37 },
                    { c: "snow", x: 78, y: 37 },
                    { c: "forest", x: 12, y: 84 },
                    { c: "shadow", x: 75, y: 83 },
                    { c: "central", x: 49, y: 45 },
                ].map((g) => (
                    <div key={g.c} className={"world-biome-glow wbg-" + g.c} style={{ left: g.x + "%", top: g.y + "%" }} aria-hidden="true" />
                ))}
                <div className="sea-label sea-north">Hoppo Sea</div>
                <div className="sea-label sea-east">Rimawari Ocean</div>
                <div className="sea-label sea-south">Zubunure Sea</div>

                <div className="atlas-landmass continent-west"></div>
                <div className="atlas-landmass continent-east"></div>
                <div className="atlas-landmass frozen-north"></div>
                <div className="atlas-landmass island-south"></div>

                <div className="atlas-region-label label-volcano">Land of Volcanoes</div>
                <div className="atlas-region-label label-forest">Land of Swamps</div>
                <div className="atlas-region-label label-fire">Land of Fire</div>
                <div className="atlas-region-label label-ice">Land of Glaciers</div>
                {sectorPoints.map((sector) => (
                    <button
                        key={sector.id}
                        className={
                            sector.id === 99
                                ? "atlas-sector atlas-sector-deaths-gate"
                                : "atlas-sector atlas-sector-" + biomeForSector(sector.id)
                        }
                        style={{ left: sector.x + "%", top: sector.y + "%" }}
                        onClick={() => triggerTravelPoint(sector.id)}
                        title={sector.id === 99 ? "Death's Gate — PvP zone: 2× XP, Ryo & Jutsu XP · 5% Bone Charm on win" : `Sector ${sector.id} | ${weatherEffects[weatherForSector(sector.id, biomeForSector(sector.id))].name}`}
                    >
                        {sector.id === 99 ? "💀" : sector.id === 35 ? "☀️" : sector.id}
                        {scoutedSectors.has(sector.id) && (
                            <span
                                style={{ position: "absolute", top: -5, right: -5, fontSize: 11, lineHeight: 1, filter: "drop-shadow(0 0 2px #000)", pointerEvents: "none" }}
                                title={scoutDotTitle(scoutedSectors.get(sector.id)!, (scoutInfo.tier || 1) as 1 | 2 | 3)}
                            >🔴{scoutedSectors.get(sector.id)!.length > 1 ? scoutedSectors.get(sector.id)!.length : ""}</span>
                        )}
                    </button>
                ))}

                {/* (War Ground beacons were removed from the world map.
                    The Central Hub banner + the explicit Village War
                    screen already surface active wars; a third overlay
                    on the atlas was cluttering the village markers.) */}

                {locations.map((location) => {
                    // Hollow Gate POI consumes its admin-generated landmark image
                    // as a full-bleed button background — no dark overlay, no text
                    // overlay (the CSS hides strong + span). The image IS the marker.
                    const landmarkImage = location.type === "hollowGate"
                        ? sharedImages["landmark:hollow-gate"]
                        : undefined;
                    return (
                        <button
                            key={location.name}
                            className={"atlas-landmark atlas-" + location.type}
                            style={{
                                left: location.x + "%",
                                top: location.y + "%",
                                ...(landmarkImage
                                    ? {
                                        backgroundImage: `url(${landmarkImage})`,
                                        backgroundSize: "cover",
                                        backgroundPosition: "center",
                                    }
                                    : {}),
                            }}
                            onClick={() => enterLandmark(location)}
                            title={location.name}
                        >
                            <strong>{location.icon}</strong>
                            <span>{location.name}</span>
                        </button>
                    );
                })}

                {/* Settlement life — a soft hearth glow + a rising hearth-smoke
                    wisp over each village/Central, so the towns read as lived-in.
                    Pointer-events:none + below the z-10 markers, so clicks are
                    untouched. */}
                {locations.filter((l) => l.type === "village" || l.type === "central").map((l) => (
                    <div key={"poi-life-" + l.name} className="world-poi-life" style={{ left: l.x + "%", top: l.y + "%" }} aria-hidden="true">
                        <span className="world-poi-glow" />
                        <span className="world-poi-smoke" />
                        <span className="world-poi-smoke world-poi-smoke-2" />
                    </div>
                ))}
            </div>
            </div>{/* end world-map-scroll */}


            {/* -- Ancient Chest — VN Scene ---------------------------- */}
            {activeChest && !chestVnDone && (() => {
                const biome = biomeForSector(selectedSector ?? 40);
                const biomeLabel = biome === "snow" ? "frozen tundra" : biome === "volcano" ? "volcanic ash fields" : biome === "shadow" ? "shadowed ruins" : biome === "central" ? "ancient central district" : "dense forest";
                const vnPages = [
                    {
                        title: "Something Stirs in the Ruins",
                        scene: `Deep within the ${biomeLabel}, a faint shimmer catches your eye.`,
                        speaker: "Narrator",
                        dialogue: [
                            "Narrator: You pause. Something between the rubble is glowing.",
                            "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                            `${character.name}: These runes... pre-war era seals. This thing has been here a long time.`,
                            "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                            `${character.name}: Whoever left this... they wanted someone strong enough to find it.`,
                            "Narrator: You press your hand to the seal. It dissolves at your touch.",
                        ],
                    },
                    {
                        title: "The Chest Opens",
                        scene: "Golden light spills from the ancient chest as the seal breaks.",
                        speaker: "Narrator",
                        dialogue: [
                            "Narrator: The lid swings open with a low resonant hum.",
                            "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                            `${character.name}: ...I wasn't expecting this.`,
                            "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
                        ],
                    },
                ];
                const page = vnPages[Math.min(chestVnPage, vnPages.length - 1)];
                const pageDialogue = page.dialogue;
                const activeLine = pageDialogue[chestVnLine] ?? pageDialogue[0];
                const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
                const speaker = splitLine[0].trim();
                const spoken = splitLine.slice(1).join(":").trim() || activeLine;
                const initials = speaker === "Narrator" ? "..." : speaker.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
                const canBack = chestVnLine > 0 || chestVnPage > 0;
                const isLastPage = chestVnPage >= vnPages.length - 1;
                const isLastLine = chestVnLine >= pageDialogue.length - 1;
                function chestVnBack() {
                    if (chestVnLine > 0) { setChestVnLine((l) => l - 1); return; }
                    if (chestVnPage > 0) { const prev = vnPages[chestVnPage - 1]; setChestVnPage((p) => p - 1); setChestVnLine(Math.max(0, prev.dialogue.length - 1)); }
                }
                function chestVnNext() {
                    if (!isLastLine) { setChestVnLine((l) => l + 1); return; }
                    if (!isLastPage) { setChestVnPage((p) => p + 1); setChestVnLine(0); return; }
                    setChestVnDone(true);
                }
                const chestPageImg = ancientChestVn.vnPages?.[chestVnPage]?.image;
                return (
                    <div className="card cinematic-card">
                        <div className="visual-novel admin-vn-play">
                            <div className="vn-header">
                                <div>
                                    <p className="act-label">📦 ANCIENT CHEST DISCOVERED</p>
                                    <h2>{page.title}</h2>
                                </div>
                                <div className="vn-progress">Page {chestVnPage + 1}/{vnPages.length} | Line {chestVnLine + 1}/{pageDialogue.length}</div>
                            </div>
                            <div className={`vn-stage vn-biome-${biome}${chestPageImg ? " vn-has-image" : ""}`} style={chestPageImg ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${chestPageImg})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
                                <div className="vn-backdrop">
                                    {!chestPageImg && <span className="vn-village-silhouette" />}
                                </div>
                                <div className="vn-character mentor-character">🧙</div>
                                <div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div>
                                <div className="vn-scene-card">{page.scene}</div>
                                <div className="vn-dialogue">
                                    <div className="vn-speaker">{speaker === "Narrator" ? initials : speaker}</div>
                                    <p>{spoken}</p>
                                    <div className="vn-controls">
                                        <button disabled={!canBack} onClick={chestVnBack}>Back</button>
                                        <button onClick={chestVnNext}>{isLastPage && isLastLine ? "Open Chest" : "Next"}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* -- Ancient Chest — Loot Reveal ------------------------- */}
            {activeChest && chestVnDone && (() => {
                const allCards = getAllTileCards([]);
                const lootItem = activeChest.itemId ? starterItems.find((i) => i.id === activeChest.itemId) : null;
                const lootCard = activeChest.cardId ? allCards.find((c) => c.id === activeChest.cardId) : null;
                const alreadyHaveCard = lootCard && character.tileCards.includes(lootCard.id);
                const rewards: { icon: string; label: string; sub: string }[] = [
                    { icon: "⭐", label: `+${displayCharacterXpGain(activeChest.xp)} XP`, sub: "Experience" },
                ];
                if (activeChest.ryo) rewards.push({ icon: "🪙", label: `+${activeChest.ryo} Ryo`, sub: "Ancient gold" });
                if (lootItem) rewards.push({ icon: stackableItemIds.has(lootItem.id) ? "📦" : lootItem.rarity === "rare" ? "⭐" : "🎁", label: lootItem.name, sub: `${lootItem.rarity.charAt(0).toUpperCase() + lootItem.rarity.slice(1)} ${lootItem.slot} · ${lootItem.description.slice(0, 40)}` });
                if (lootCard) rewards.push({ icon: lootCard.rarity === "rare" ? "🌟" : "🃏", label: `${lootCard.name}${alreadyHaveCard ? " (duplicate)" : ""}`, sub: `${lootCard.rarity.charAt(0).toUpperCase() + lootCard.rarity.slice(1)} · ${lootCard.element} · T:${lootCard.top} R:${lootCard.right} B:${lootCard.bottom} L:${lootCard.left}` });
                if (activeChest.fateShards) rewards.push({ icon: "🔮", label: "+1 Fate Shard", sub: "Premium currency" });
                if (activeChest.boneCharms) rewards.push({ icon: "🪬", label: "+1 Bone Charm", sub: "Awakening Stone material" });
                if (activeChest.auraStones) rewards.push({ icon: "💠", label: "+1 Aura Stone", sub: "Awakening Stone material" });
                if (activeChest.auraDust) rewards.push({ icon: "✨", label: `+${activeChest.auraDust} Aura Dust`, sub: "Feeds the Aura Sphere" });
                return (
                    <div className="card cinematic-card">
                        <div className="chest-reveal">
                            <div className="chest-reveal-header">
                                <p className="act-label">📦 ANCIENT CHEST CONTENTS</p>
                                <h2 className="chest-reveal-title">The chest yields its secrets</h2>
                                <p className="chest-reveal-sub">A relic of the shinobi wars, now yours to keep.</p>
                            </div>
                            <div className="chest-rewards">
                                {rewards.map((r, i) => (
                                    <div key={i} className="chest-reward-row">
                                        <span className="chest-reward-icon">{r.icon}</span>
                                        <div className="chest-reward-text">
                                            <strong>{r.label}</strong>
                                            <small>{r.sub}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button className="chest-claim-btn" onClick={() => claimChest(activeChest)}>
                                🎁 Claim All Rewards
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

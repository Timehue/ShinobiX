/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/immutability, react-hooks/purity -- SCOPED DEBT, see below.
 *
 * These two react-compiler rules fail on this file's STRUCTURE, not on bugs:
 *
 *   immutability (5) — effects call hoisted `function` declarations defined
 *     later in the component (challengePlayer, waitTurn, advanceAfterPlayer,
 *     startPrefight, activeStatuses). Correct at runtime, since hoisting makes
 *     the binding exist and the effect body runs after render; the compiler
 *     wants declaration-before-use so it can reason about memoization.
 *   purity (13) — Math.random() / Date.now() inside those same hoisted
 *     functions. Every one is an event handler or a turn resolver, never render
 *     output, but the compiler cannot prove a component-scope function
 *     declaration is unreachable from render.
 *
 * Clearing them honestly means reordering the declarations of a 6,400-line LIVE
 * combat screen — the kind of change that earns its own branch and its own test
 * pass, not a drive-by while main is red. The file already carries the same
 * kind of scoped disable above for the same reason.
 *
 * What was NOT waved through: every react-hooks/refs violation here was fixed
 * properly, and two of them were real stale-UI bugs (ref writes during render,
 * and an explore-ambush flag read from a ref that could paint the wrong
 * victory exit). Fix the two rules above by restructuring; do not add more
 * suppressions. */
import { useState, useEffect, useRef, useMemo } from "react";
import "../styles/battle-skin.css";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import { GiFirstAidKit, GiVillage, GiShield } from "react-icons/gi";
// Inline style for a glyph that prefixes button/heading text — seats it on the baseline.
const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { createPortal } from "react-dom";
import type { Biome, JutsuType, Screen, WeatherType } from "../types/core";
import type { Character, PlayerRecord, BattleHistoryEntry, VersionedCharacterCommit } from "../types/character";
import type { EquipmentSlot, GameItem, Jutsu, JutsuTag, SavedBloodline, Stats } from "../types/combat";
import type { AiRule, CreatorAi } from "../types/creator-ai";
import type { EnhancedClanData } from "../types/clan";
import type { Pet, PetJutsu } from "../types/pet";
import { STUN_AP_PENALTY, jutsuLevelCapForLevel, perRankStatCap, COMBAT_RESOURCES_V2 } from "../constants/game";
import { ArenaBattlePersister } from "../components/ArenaBattlePersister";
import { BattleArenaLobby } from "../features/arena/components/BattleArenaLobby";
import { ArenaDistrictLobby } from "../features/arena/components/ArenaDistrictLobby";
import { ArenaCombatBoardStage } from "../features/arena/components/ArenaCombatBoardStage";
import { ArenaCommandDeck } from "../features/arena/components/ArenaCommandDeck";
import { ArenaBattleTimeline } from "../features/arena/components/ArenaBattleTimeline";
import { matchesArenaAiRule, pickArenaAiJutsu } from "../features/arena/domain/arena-ai-policy";
import type {
    ArenaBattleActionEntry as BattleActionEntry,
    ArenaBattleActor as BattleActor,
    ArenaCombatStatus as CombatStatus,
    ArenaCombatVfx,
    ArenaDistrictTab,
    ArenaHitFx,
    ArenaSelectedCombatAction as SelectedCombatAction,
    BattleArenaLobbyTab,
} from "../features/arena/types";
import { BattleLockKeeper } from "../components/BattleLockKeeper";
import { SparCoach } from "../components/SparCoach";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import {
    CombatApPanel,
    CombatEnvironmentStrip,
    CombatHudHeader,
    CombatHudLayout,
    CombatHudMain,
} from "../components/CombatHudLayout";
import { ShinobiCombatShell } from "../components/ShinobiCombatShell";
import { useBattleTabs } from "../lib/use-battle-tabs";
import { interpolateFlavor } from "../lib/battle-log-format";
import { buildActionsFromPveHistory, makeBattleEntry } from "../lib/battle-log-history";
import { playPetSfx } from "../lib/pet-sfx";
import { isMercAiId } from "../lib/merc-ai";
import { CombatSideHud } from "../components/CombatSideHud";
import { PET_CONSUMABLE_PVE_HEAL_PCT, petConsumableById, petPveGearById, petPveHealOnSummonPct, petPveLifestealPct, petPveLoyalty, petPveSummonDamageMult } from "../data/pet-config";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";
import { biomeLabel, terrainEffects, weatherEffects } from "../data/world";
import { AMP_STATUS_ROUNDS_PVE, HEAL_FLAT_PVE, SHIELD_FLAT_PVE, armorFactorToRawDr, calculateDamage, capWoundStacks, dotMitigationPVE, drainTickPVE, getBloodlineMultiplier, masteryDamageFrac, mergeCombatStatus, multiplicativeTagMultiplier, woundCapForRankPVE } from "../lib/combat-math";
import { battlefieldAiSprite, defaultAiRivalSprite } from "../lib/battlefield-actor-art";
import { resolveOwnAvatar } from "../lib/own-avatar";
import { aiArmorFactorForProfile, aiStatsForLevel } from "../lib/ai-stats";
import { resolveCombatVfxSpec, type CombatVfxSpec } from "../lib/combat-vfx";
import { combatVfxAssetFor } from "../lib/combat-vfx-assets";
import { cappedPostDamage, getJutsuMastery, scaleJutsuCostsForCharacter, v2ResourceRegen, v2PoisonOnSpend, v2JutsuResourceCost } from "../lib/jutsu-scaling";
import { pveDifficultyStatMultiplier, pveDifficultyHpMultiplier, scaleStatsForPveDifficulty, pveAiMasteryForLevel, pveGuardedEnemyHit, pveAiCompetence } from "../lib/pve-difficulty";
import { advancePveGroundZonesForTurn, pveGroundZoneDebuff, type PveGroundZone } from "../lib/pve-ground-zones";
import { buildPlayerRead, classifyPlayerAction, type PlayerActionRecord } from "../lib/combat-ai-tactics";
import { isSelfSupportJutsu, makeJutsu, normalizeJutsu } from "../lib/jutsu";
import { jutsuImpactPreviewTiles } from "../lib/jutsu-impact-preview";
import { effectiveTagPercent, normalizeTagName, opponentAffectingTags, pvpAffectsOpponent, statusMatchesName, tagMatchesName } from "../lib/tags";
import { canEquipElementJutsu } from "../lib/bloodline";
import { hasCharacterElement, weatherElementOf } from "../lib/elements";
import { minActionCost } from "../lib/combat-affordability";
import { getActivePetTrait, getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus, getPvpItemLoadout } from "../lib/equipment-stats";
import { combatLoadoutSlots, normalizeEquipmentSlot } from "../lib/equipment";
import { earnedStatPoints, maxChakraForLevel, maxHpForLevel, maxStaminaForLevel } from "../lib/stats";
import { markMissionCompleted } from "../lib/character-progress";
import { combatMissionByAiId, missionAiLevelAndBonus } from "../data/combat-missions";
import { beastPortrait } from "../data/hunter-art";
import { stampWandererFightResult } from "../lib/wanderer-fight";
import { relevelBuiltinAi } from "../lib/combat-ai";
import { getAllItems, getItemById } from "../lib/items";
import { countItem, removeItem } from "../lib/inventory";
import { makeId } from "../lib/utils";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { requestAiFight } from "../lib/ai-fight-request";
import { publishedPracticeOpponentForLevel } from "../lib/creator-event-practice";
import { useBoardScale } from "../lib/use-board-scale";
import {
    availablePetBattleCount,
    isPetOnExpedition,
    petCombatDamage,
    petDisplayName,
    petHappiness,
} from "../lib/pet";
import { ROLE_RANGE, petRoleOf } from "../lib/pet-roles";
import { spendPetSummonCost } from "../lib/pet-acquisition-api";
import { prefersLiteCombatFx } from "../lib/device-tier";
import { PET_CRIT_MULT } from "../lib/pet-battle-sim";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "../lib/pvp-session";
import type { OwnSaveReadCommit } from "../lib/own-save-read";
const loadOwnSaveRead = () => import("../lib/own-save-read");
import {
    playerRankedAuthorityFromChallenge,
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../lib/player-ranked-authority";
import { postPlayerChallengeNotice } from "../lib/player-api";
import { boostAmount } from "../lib/village-upgrades";
import { rankedDelta } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import { legacySignatureFor } from "../lib/legacy-jutsu-slot";
import { activeCarriedPets } from "../lib/entitlements";
import { publicEligiblePets } from "../lib/public-pet-roster";
import {
    getAllJutsus,
    getPvpJutsuLoadout,
    isAdminAccountName,
    normalizeCharacter,
    playerLensDiscipline,
    type DuelChallenge,
    type PendingArenaStoryBattle,
    type PvpSessionState,
    type SharedPvpBattleContext,
} from "../App";
import { activeVillageWarsFor, damageSectorTerritory, loadArenaActiveFights, loadArenaTournament, loadSectorTerritory, saveArenaActiveFights, saveArenaTournament, savePendingClanPetBattle, sectorRaidDamageAmount, unregisterLocalFight, type ArenaSpectatorFight, type ArenaTournament, type TerritoryBuffStat } from "../lib/world-state";

export function Arena({
    lobbyMode = "battleArena",
    character,
    updateCharacter,
    onVersionedCharacter,
    onOwnSaveRead,
    savedBloodlines,
    creatorJutsus,
    creatorAis,
    pendingAiProfileId,
    setPendingAiProfileId,
    currentBiome,
    currentSector,
    playerRoster,
    duelChallenges,
    setDuelChallenges,
    currentWeather,
    pendingPvpOpponent,
    setPendingPvpOpponent,
    raidBattleKind,
    setRaidBattleKind,
    creatorItems,
    setScreen,
    sharedImages = {},
    pendingStoryBattle,
    onPendingStoryBattleWin,
    onPendingStoryBattleContinue,
    onDungeonFail,
    onMissionRaidComplete,
    onHuntBeastDefeated,
    missionBattleActive = false,
    onMissionBattleResolved,
    exploreAmbushActive = false,
    onExploreAmbushWon,
    setPvpBattleId,
    setPvpRole,
    setPvpBattleContext,
    setPvpSeedSession,
    setPendingPetBattleOpponent,
    onAcceptPetChallenge,
    onBattleActiveChange,
    directCombat = false,
    onReturnFromCombat,
    onRecordBattle,
}: {
    lobbyMode?: "battleArena" | "arenaDistrict";
    character: Character;
    updateCharacter: (character: Character) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    onOwnSaveRead: OwnSaveReadCommit;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorAis: CreatorAi[];
    pendingAiProfileId: string;
    setPendingAiProfileId: (id: string) => void;
    currentBiome: Biome;
    currentSector: number;
    currentWeather: WeatherType;
    playerRoster: PlayerRecord[];
    duelChallenges: DuelChallenge[];
    setDuelChallenges: (challenges: DuelChallenge[]) => void;
    pendingPvpOpponent: Character | null;
    setPendingPvpOpponent: (character: Character | null) => void;
    raidBattleKind: "none" | "raidAi" | "raidPlayer" | "defense";
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    creatorItems: GameItem[];
    setScreen: (screen: Screen) => void;
    sharedImages?: Record<string, string>;
    pendingStoryBattle?: PendingArenaStoryBattle | null;
    onPendingStoryBattleWin?: (survivingHp: number, aiFightToken?: string) => string | Promise<string>;
    onPendingStoryBattleContinue?: (
        result?: "win" | "loss" | "fled",
        survivingHp?: number,
    ) => void | Promise<void>;
    onDungeonFail?: () => void | Promise<void>;
    onMissionRaidComplete?: (sector: number, battleId?: string) => void;
    onHuntBeastDefeated?: (defeatedAiId: string) => void;
    missionBattleActive?: boolean;
    onMissionBattleResolved?: () => void;
    exploreAmbushActive?: boolean;
    onExploreAmbushWon?: () => void;
    setPvpBattleId?: (id: string) => void;
    setPvpRole?: (role: "p1" | "p2") => void;
    setPvpBattleContext?: (context: SharedPvpBattleContext | null) => void;
    setPvpSeedSession?: (session: PvpSessionState | null) => void;
    setPendingPetBattleOpponent?: (opponent: PetArenaOpponent | null) => void;
    // Accept an incoming casual pet-spar (clanWarPet) challenge via App's canonical
    // handler (acceptPetChallengeGlobal): validates pets, notifies the challenger,
    // seeds the shared 1v1 pet battle, and routes both players into the Pet Coliseum.
    onAcceptPetChallenge?: (challenge: DuelChallenge) => void;
    // Reports "an arena fight is in progress" up to App so the global nav lock
    // can block travelling out of any arena fight (AI, ranked, endless, story,
    // human). Fires false on resolve/unmount.
    onBattleActiveChange?: (active: boolean) => void;
    // Rolling-upgrade result-card affordance only. Current AI launchers use
    // AiFightHost and never arm this reducer from the dedicated `arena` route.
    directCombat?: boolean;
    onReturnFromCombat?: () => void;
    // Queue a won combat-mission claim SERVER-SIDE (POST /api/missions/queue-combat-claim).
    // The Mission Hall "Claim Reward" step is server-authoritative and rejects the
    // claim unless the queue is already on the server, so winning must persist the
    // queue durably — not rely on the 3s debounced autosave (which a quick claim,
    // a refresh, or a save-conflict refetch races and drops). The endpoint mints a
    // single-use claim token + writes the durable flag under the save lock; we
    // still set the local flag optimistically for instant UI + an autosave fallback.
    // Records this fight into the player's rolling battle-log history (Profile →
    // Battles) for later reflection. Display-only — carries no rewards.
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const gridWidth = 12;
    const gridHeight = 10;

    /* Final combat hex sizing */
    const HEX_W = 72;
    const HEX_H = 42;
    const X_STEP = HEX_W * 0.75;
    const Y_STEP = HEX_H * 0.92;
    const ORB = 52;

    const GRID_LAYER_W = (gridWidth - 1) * X_STEP + HEX_W;
    const GRID_LAYER_H = (gridHeight - 1) * Y_STEP + HEX_H * 1.5;

    // Auto-fit board scale + manual zoom — shared with the live-PvP battle via
    // the useBoardScale hook (this logic was previously duplicated inline in
    // both battle components, which is how the grid-scaling bug existed twice).
    const { battlefieldRef, battlefieldCallbackRef, boardContainerSize, effectiveScale } = useBoardScale(GRID_LAYER_W, GRID_LAYER_H);

    // Keep stable refs in sync with the latest arena function versions every render.
    // Timer callbacks read these so they always call fresh closures.
    // (enemyTurnRef and autoEndTurnRef are populated below once those functions are defined.)
    const allJutsus = getAllJutsus(savedBloodlines, creatorJutsus, character);
    const rawPendingAiProfile = creatorAis.find((ai) => ai.id === pendingAiProfileId);
    // Item 2 — combat-mission foes are re-leveled to the PLAYER's level (floored
    // at the rank's min) with a small rank bonus, so a D-Rank Errand isn't a fixed
    // level-8 +30 enemy vs a level-3 player. memo'd so stats/rules aren't rebuilt
    // every render; the shared catalog builtin in `creatorAis` is never mutated.
    const combatMissionForAi = missionBattleActive ? combatMissionByAiId(pendingAiProfileId) : undefined;
    const pendingAiProfile = useMemo(() => {
        if (rawPendingAiProfile && combatMissionForAi) {
            const { level, statBonus, hp } = missionAiLevelAndBonus(combatMissionForAi, character.level);
            return relevelBuiltinAi(rawPendingAiProfile, level, statBonus, hp);
        }
        return rawPendingAiProfile;
    }, [rawPendingAiProfile, combatMissionForAi, character.level]);
    const allItems = getAllItems(creatorItems, character.weaponElements);
    const isAtWarForFocus = activeVillageWarsFor(character.village).length > 0;
    const warFocusDamageReduction = (character.elderFocus === "war" && isAtWarForFocus) ? 0.99 : 1.0;
    const playerArmorFactor = getCharacterArmorFactor(character, allItems) * warFocusDamageReduction;
    const equippedDamagePercent = getEquippedItemBonus(character, allItems, "damagePercent");
    const equippedAbsorbPercent = getEquippedItemBonus(character, allItems, "absorbPercent");
    const equippedLifeStealPercent = getEquippedItemBonus(character, allItems, "lifeStealPercent");
    const equippedShieldBonus = getEquippedItemBonus(character, allItems, "shield");
    const equippedReflectPercent = getEquippedItemBonus(character, allItems, "reflectPercent");
    const playerItemMult = 1 + equippedDamagePercent / 100;
    const characterCombatStats: Stats = perRankStatCap({
        strength: character.stats.strength + getEquippedItemBonus(character, allItems, "strength"),
        speed: character.stats.speed + getEquippedItemBonus(character, allItems, "speed"),
        intelligence: character.stats.intelligence + getEquippedItemBonus(character, allItems, "intelligence"),
        willpower: character.stats.willpower + getEquippedItemBonus(character, allItems, "willpower"),
        bukijutsuOffense: character.stats.bukijutsuOffense + getEquippedItemBonus(character, allItems, "bukijutsuOffense"),
        bukijutsuDefense: character.stats.bukijutsuDefense + getEquippedItemBonus(character, allItems, "bukijutsuDefense"),
        taijutsuOffense: character.stats.taijutsuOffense + getEquippedItemBonus(character, allItems, "taijutsuOffense"),
        taijutsuDefense: character.stats.taijutsuDefense + getEquippedItemBonus(character, allItems, "taijutsuDefense"),
        genjutsuOffense: character.stats.genjutsuOffense + getEquippedItemBonus(character, allItems, "genjutsuOffense"),
        genjutsuDefense: character.stats.genjutsuDefense + getEquippedItemBonus(character, allItems, "genjutsuDefense"),
        ninjutsuOffense: character.stats.ninjutsuOffense + getEquippedItemBonus(character, allItems, "ninjutsuOffense"),
        ninjutsuDefense: character.stats.ninjutsuDefense + getEquippedItemBonus(character, allItems, "ninjutsuDefense"),
    }, character.level);
    // Build the action-bar list in equippedJutsuIds (loadout) order so the slot
    // arrangement players set in the Profile loadout carries into battle. The
    // Legacy signature (dedicated slot, derived from the server-owned
    // character.legacy at Stage 3+) is appended LAST — outside the 15, matching
    // the server's sealed-loadout injection in api/pvp/session.ts. Element
    // "None" means it always passes the element gate.
    const playerLegacySignature = legacySignatureFor(character);
    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const equippedJutsus = [
        ...character.equippedJutsuIds
            .map((id) => allJutsus.find((jutsu) => jutsu.id === id))
            .filter((jutsu): jutsu is Jutsu => !!jutsu && canEquipElementJutsu(character, jutsu, savedBloodlines)),
        ...(playerLegacySignature ? [playerLegacySignature] : []),
    ];
    // Action-bar items: weapon + throwable + the three combat-item slots + potion
    // (combatLoadoutSlots, which also carries the legacy "item"/"weapon" aliases
    // so a not-yet-migrated save still loads). Set() dedupes any alias overlap.
    const combatItemSlots: EquipmentSlot[] = combatLoadoutSlots;
    const combatEquippedItems = Array.from(
        new Set(combatItemSlots.map((slot) => character.equipment[slot]).filter((id): id is string => Boolean(id)))
    )
        .map((id) => getItemById(allItems, id))
        .filter((item): item is GameItem => Boolean(item));
    const [battleStarted, setBattleStarted] = useState(false);
    // Throwables/consumables/potions are now spent from inventory on each use
    // (weapons in the "hand" slot stay reusable). `potionUsesThisBattle` caps the
    // Rejuvenation Potion at POTION_USES_PER_BATTLE sips per fight; it resets in
    // resetBattle / on persisted-battle restore.
    const [potionUsesThisBattle, setPotionUsesThisBattle] = useState(0);
    const POTION_USES_PER_BATTLE = 2;
    const combatItemConsumed = (item: GameItem): boolean => {
        const s = normalizeEquipmentSlot(item.slot);
        return s === "thrown" || s === "item" || s === "potion";
    };
    // Can this equipped combat item still be used right now? Reusable gear → yes;
    // a consumable needs ≥1 in inventory, and the potion also respects the
    // per-battle sip cap.
    const canUseCombatItem = (item: GameItem): boolean => {
        if (!combatItemConsumed(item)) return true;
        if (countItem(character, item.id) <= 0) return false;
        if (normalizeEquipmentSlot(item.slot) === "potion" && potionUsesThisBattle >= POTION_USES_PER_BATTLE) return false;
        return true;
    };

    // ── Combat VFX (cosmetic only) ───────────────────────────────────────────
    // Arena combat VFX are cosmetic only and share the PvP 2.5D plate renderer.
    // Lite mode keeps the plates but drops extra spark layers through CSS.
    const liteFx = useMemo(() => prefersLiteCombatFx(), []);
    const combatVfxLayerRef = useRef<HTMLDivElement | null>(null);
    // Floating ±damage/heal numbers over a fighter on every HP change (D3 — PvE
    // parity with PvP's pvp-hit-fx). Purely cosmetic overlay; reuses the same CSS
    // classes/palette. Per-HP refs dedup so each transition fires once.
    const [pveHitFx, setPveHitFx] = useState<ArenaHitFx[]>([]);
    const prevPlayerHpRef = useRef<number | null>(null);
    const prevEnemyHpRef = useRef<number | null>(null);
    // Explicit floating-number events, queued by the action handlers with the TRUE
    // per-event amount (the same value written to the battle log) instead of being
    // reverse-derived from the post-clamp HP delta. This makes the flying "-N"
    // match the log: a killing blow reads the real damage (not the clamped-to-0
    // remainder), and simultaneous hits on one fighter (reflect + recoil, or a
    // heal + self-damage netted into one setState) each float separately. When a
    // fighter has no queued events for a commit we fall back to the HP-delta below,
    // so uninstrumented HP changes (init/sync/restore) still surface a popup as
    // before. `hitFxTick` is bumped on every queue so the effect also fires when
    // the queued events net to zero HP change.
    const pendingHitFxRef = useRef<{ p: { amount: number; kind: "damage" | "heal" }[]; e: { amount: number; kind: "damage" | "heal" }[] }>({ p: [], e: [] });
    const [hitFxTick, setHitFxTick] = useState(0);
    const queueHitFx = (who: "p" | "e", amount: number, kind: "damage" | "heal") => {
        if (!(amount > 0)) return;
        pendingHitFxRef.current[who].push({ amount: Math.round(amount), kind });
        setHitFxTick((t) => t + 1);
    };
    // Persisted "fast battles" preference (B2): halves the enemy-turn pacing
    // beats. Read via a ref in the delay code so a mid-fight toggle applies on
    // the next beat without stale-closure issues.
    const [combatFast, setCombatFast] = useState(false);
    const combatFastRef = useRef(false);
    useEffect(() => { combatFastRef.current = combatFast; }, [combatFast]);
    useEffect(() => { try { setCombatFast(localStorage.getItem("combatFast.v1") === "1"); } catch { /* ignore */ } }, []);
    const combatFxSeq = useRef(0);
    const [combatVfx, setCombatVfx] = useState<ArenaCombatVfx[]>([]);

    const combatTilePoint = (tile: number): { x: number; y: number } | null => {
        const board = battlefieldRef.current;
        const layer = combatVfxLayerRef.current;
        if (!board || !layer || tile < 0) return null;
        const tileEl = board.querySelector<HTMLElement>(`.hex-tile[data-tile="${tile}"]`);
        if (!tileEl) return null;
        const tileRect = tileEl.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        return {
            x: (tileRect.left + tileRect.right) / 2 - layerRect.left,
            y: (tileRect.top + tileRect.bottom) / 2 - layerRect.top,
        };
    };

    const flashCombatTiles = (tiles: number[]) => {
        const board = battlefieldRef.current;
        if (!board || !tiles.length) return;
        const uniqueTiles = Array.from(new Set(tiles)).slice(0, liteFx ? 7 : 14);
        for (const tile of uniqueTiles) {
            const tileEl = board.querySelector<HTMLElement>(`.hex-tile[data-tile="${tile}"]`);
            if (!tileEl) continue;
            tileEl.classList.add("jutsu-impact-flash");
            window.setTimeout(() => tileEl.classList.remove("jutsu-impact-flash"), 460);
        }
    };

    const spawnCombatVfx = (events: Array<{ focusPos: number; spec: CombatVfxSpec }>) => {
        const next = events.flatMap((event): ArenaCombatVfx[] => {
            if (event.focusPos < 0) return [];
            const candidateTiles = event.spec.tiles?.length ? event.spec.tiles : [event.focusPos];
            flashCombatTiles(candidateTiles);
            const points = candidateTiles
                .slice(0, liteFx ? 7 : 14)
                .map(combatTilePoint)
                .filter((point): point is { x: number; y: number } => Boolean(point));
            return points.length ? [{ id: combatFxSeq.current++, points, spec: event.spec }] : [];
        });
        if (!next.length) return;
        setCombatVfx((current) => [...current, ...next].slice(liteFx ? -4 : -10));
        const longest = Math.max(...next.map((fx) => fx.spec.durationMs), 520);
        const ids = new Set(next.map((fx) => fx.id));
        window.setTimeout(() => setCombatVfx((current) => current.filter((fx) => !ids.has(fx.id))), longest + 180);
    };

    const tagEffectSpec = (tags: Array<Pick<JutsuTag, "name" | "percent">>, target: Jutsu["target"] = "OPPONENT"): CombatVfxSpec | null => {
        const meaningfulTags = tags.filter((tag) => !tagMatchesName(tag.name, "Damage") && !tagMatchesName(tag.name, "Move"));
        if (!meaningfulTags.length) return null;
        const spec = resolveCombatVfxSpec({ action: "jutsu", tags: meaningfulTags, target });
        if (spec.key === "impact") return null;
        return {
            ...spec,
            intensity: "minor",
            durationMs: Math.max(420, Math.round(spec.durationMs * 0.82)),
            maxParticles: Math.max(6, Math.round((spec.maxParticles ?? 10) * 0.7)),
        };
    };

    const affectedCombatTiles = (jutsu: Jutsu, focusPos: number) => {
        if (focusPos < 0) return undefined;
        if (jutsu.method === "AOE_CIRCLE" || jutsu.method === "INSTANT_EFFECT" || jutsu.method === "AOE_SPIRAL" || jutsu.method === "AOE_BURST") {
            return [focusPos, ...hexNeighbors(focusPos)];
        }
        return undefined;
    };
    // Queue a resolver-backed combat plate at the caster, target, or affected tile.
    const triggerCombatFx = (
        jutsu: Jutsu,
        opts: { selfCast: boolean; focusPos: number; heavy?: boolean; isKO?: boolean; ground?: boolean; area?: boolean },
    ) => {
        // Combat SFX — reuse the pet sound engine, which routes through the global
        // master mute (so it's SILENT by default / whenever audio is muted, and the
        // one mute button covers it). Plays for player + enemy casts; deliberately
        // NOT gated by reduced-motion (that's a motion preference, not audio).
        const onlyMoves = jutsu.tags.length > 0 && jutsu.tags.every((tag) => tagMatchesName(tag.name, "Move") || tagMatchesName(tag.name, "Damage"));
        if (isMoveJutsu(jutsu) && Number(jutsu.effectPower ?? 0) <= 0 && onlyMoves) return;
        playPetSfx(opts.isKO ? "ko" : opts.selfCast ? "buff" : opts.heavy ? "crit" : "hit");
        if (opts.focusPos < 0) return;
        const spec = resolveCombatVfxSpec({
            action: "jutsu",
            ap: jutsu.ap,
            visualEffect: jutsu.visualEffect,
            element: jutsu.element,
            discipline: jutsu.type,
            effectPower: jutsu.effectPower,
            isUtility: jutsu.isUtility,
            method: jutsu.method,
            target: jutsu.target,
            tags: jutsu.tags,
            heavy: opts.heavy,
            ko: opts.isKO,
            ground: opts.ground,
            area: opts.area,
            tiles: opts.area || opts.ground ? affectedCombatTiles(jutsu, opts.focusPos) : undefined,
        });
        spawnCombatVfx([{ focusPos: opts.focusPos, spec }]);
    };
    const triggerBasicHealFx = (focusPos: number) => {
        playPetSfx("buff");
        spawnCombatVfx([{ focusPos, spec: resolveCombatVfxSpec({ action: "basicHeal", target: "SELF" }) }]);
    };

    const triggerConsumableCombatFx = (item: GameItem, focusPos: number, hints: { heal?: boolean; shield?: boolean } = {}) => {
        const tags: Array<Pick<JutsuTag, "name" | "percent">> = [...(item.weaponTags ?? [])];
        if (hints.heal) tags.unshift({ name: "Heal", percent: 100 });
        if (hints.shield) tags.push({ name: "Shield", percent: 100 });
        if (item.weaponEffect) tags.push({ name: item.weaponEffect, percent: item.weaponEffectValue ?? 0 });
        const spec = resolveCombatVfxSpec({ action: "consumable", tags, target: "SELF" });
        playPetSfx(spec.key === "debuff" ? "hit" : "buff");
        spawnCombatVfx([{ focusPos, spec }]);
    };

    const triggerWeaponCombatFx = (
        item: GameItem,
        opts: { focusPos: number; casterPos: number; heavy?: boolean; isKO?: boolean },
    ) => {
        const slot = normalizeEquipmentSlot(item.slot);
        const tags: Array<Pick<JutsuTag, "name" | "percent">> = [...(item.weaponTags ?? [])];
        if (item.weaponEffect) tags.push({ name: item.weaponEffect, percent: item.weaponEffectValue ?? 0 });
        const named = slot === "hand" && tags.some((tag) => !tagMatchesName(tag.name, "Damage"));
        const delivery = resolveCombatVfxSpec({
            action: slot === "thrown" ? "throwable" : "weapon",
            named,
            heavy: opts.heavy,
            ko: opts.isKO,
        });
        const tagSpec = tagEffectSpec(tags, "OPPONENT");
        const events = [{ focusPos: opts.focusPos, spec: delivery }];
        if (tagSpec) events.push({ focusPos: tagSpec.target === "caster" ? opts.casterPos : opts.focusPos, spec: tagSpec });
        playPetSfx(opts.isKO ? "ko" : opts.heavy || named ? "crit" : "hit");
        spawnCombatVfx(events);
    };
    const renderArenaCombatVfx = (fx: ArenaCombatVfx) => {
        const avg = fx.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
        const center = { x: avg.x / fx.points.length, y: avg.y / fx.points.length };
        const asset = combatVfxAssetFor(fx.spec.key);
        const baseClass = `pvp-combat-vfx pvp-vfx-${fx.spec.key} pvp-vfx-${fx.spec.intensity} pvp-vfx-has-asset pvp-vfx-plane-${asset.plane}${liteFx ? " pvp-vfx-lite" : ""}`;
        const styleFor = (point: { x: number; y: number }, scale = 1) => ({
            left: `${point.x}px`,
            top: `${point.y}px`,
            "--vfx-duration": `${fx.spec.durationMs}ms`,
            "--vfx-scale": scale,
            "--vfx-asset-scale": asset.assetScale,
            "--vfx-asset-lift": `${asset.liftPx}px`,
            "--vfx-asset-opacity": asset.opacity,
        } as React.CSSProperties);
        return (
            <div key={fx.id} className="pvp-combat-vfx-group" aria-hidden="true">
                {fx.points.length > 1 && fx.points.map((point, idx) => (
                    <span key={`${fx.id}-tile-${idx}`} className={`${baseClass} pvp-combat-vfx-tile`} style={styleFor(point, 0.72)}>
                        <i className="pvp-vfx-ring" />
                    </span>
                ))}
                <span className={`${baseClass} pvp-combat-vfx-burst`} style={styleFor(center, fx.spec.intensity === "finisher" ? 1.45 : fx.spec.intensity === "heavy" ? 1.18 : 1)}>
                    <i className="pvp-vfx-art">
                        <img className={`pvp-vfx-asset pvp-vfx-asset-${asset.plane}`} src={asset.url} alt="" draggable={false} />
                    </i>
                    <i className="pvp-vfx-ring" />
                    <i className="pvp-vfx-core" />
                    <i className="pvp-vfx-cut" />
                    {!liteFx && <i className="pvp-vfx-sparks" />}
                </span>
            </div>
        );
    };

    const [aiLevel, setAiLevel] = useState(character.level);
    const [sparSearch, setSparSearch] = useState("");
    const [activeArenaTab, setActiveArenaTab] = useState<ArenaDistrictTab>("ranked");
    // Battle Arena hub (village casual-spar hub) sub-tabs: sparring/challenges vs the bounty board.
    const [battleArenaTab, setBattleArenaTab] = useState<BattleArenaLobbyTab>("spar");
    const [opponentCharacter, setOpponentCharacter] = useState<Character | null>(null);
    const [rankedBattleActive, setRankedBattleActive] = useState(false);
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);
    const [clanWarPointsActive, setClanWarPointsActive] = useState(0);
    const [arenaTournament, setArenaTournament] = useState<ArenaTournament | null>(() => loadArenaTournament());
    const [spectatorFights, setSpectatorFights] = useState<ArenaSpectatorFight[]>(() => loadArenaActiveFights());
    useEffect(() => {
        const refreshArenaState = () => {
            setArenaTournament(loadArenaTournament());
            setSpectatorFights(loadArenaActiveFights());
        };
        refreshArenaState();
        const id = setInterval(refreshArenaState, 5000);
        return () => clearInterval(id);
    }, []);
    useEffect(() => {
        let active = true;
        fetch(`/api/pvp/ranked-queue?name=${encodeURIComponent(character.name)}`, { cache: "no-store" })
            .then((response) => response.ok ? response.json() : null)
            .then((data: { enabled?: boolean; queueSize?: number } | null) => {
                if (!active) return;
                const enabled = data?.enabled === true;
                setPlayerRankedEnabled(enabled);
                setRankedQueueSize(enabled ? data?.queueSize ?? 0 : 0);
                if (!enabled) setRankedQueueActive(false);
            })
            .catch(() => {
                if (active) setPlayerRankedEnabled(false);
            });
        return () => { active = false; };
    }, [character.name]);
    /* ── Ranked queue polling (paused when tab hidden) ── */
    useEffect(() => {
        if (!rankedQueueActive) return;
        let active = true;
        const poll = () => {
            if (document.visibilityState === "hidden") return;
            fetch("/api/pvp/ranked-queue", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: character.name, level: character.level, elo: character.rankedRating ?? 1000, action: "poll" }),
            })
                .then(r => r.json())
                .then(data => {
                    if (!active) return;
                    if (data.enabled !== true) {
                        setPlayerRankedEnabled(false);
                        setRankedQueueActive(false);
                        setRankedQueueSize(0);
                        return;
                    }
                    setRankedQueueSize(data.queueSize ?? 0);
                    if (data.match) {
                        const rankedAuthority = playerRankedAuthorityFromQueueMatch(data.match);
                        if (!rankedAuthority) {
                            setRankedQueueActive(false);
                            alert("The ranked server returned an incomplete match proof. Rejoin the queue before starting a battle.");
                            return;
                        }
                        // Found a match. Only the deterministic INITIATOR sends the
                        // ranked challenge; the other side waits for it to land in
                        // their challenge inbox (audit #10 — both sides now discover
                        // the match via their durable match record, so neither
                        // silently vanishes). `initiator` is absent on older servers
                        // → default true, preserving the prior single-challenger flow.
                        setRankedQueueActive(false);
                        if (data.match.initiator !== false) {
                            const opName = data.match.opponent;
                            const stub = { name: opName, level: data.match.opponentLevel ?? 1, village: "", specialty: "Ninjutsu", character: { ...character, name: opName, rankedRating: data.match.opponentElo ?? 1000 } as Character, currentSector: 0, lastSeenAt: Date.now() } as PlayerRecord;
                            challengePlayer(stub, "ranked", 0, false, rankedAuthority);
                        }
                    }
                    if (!data.inQueue) {
                        setRankedQueueActive(false);
                    }
                })
                .catch(() => {});
        };
        poll();
        const iv = setInterval(poll, 3000);
        return () => { active = false; clearInterval(iv); };
    }, [rankedQueueActive]);  

    function joinRankedQueue() {
        if (!requireServerSettlement("rankedPvp")) return;
        if (!playerRankedEnabled) {
            alert("Ranked PvP is temporarily unavailable while the v2 authority rollout completes.");
            return;
        }
        setRankedQueueActive(true);
        fetch("/api/pvp/ranked-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: character.name, level: character.level, elo: character.rankedRating ?? 1000, action: "join" }),
        })
            .then(async (r) => {
                const data = await r.json().catch(() => ({} as Record<string, unknown>));
                if (!r.ok) {
                    // Server rejected the join (e.g. newcomer protection below
                    // level 10). Without this the queue spinner runs forever.
                    setRankedQueueActive(false);
                    alert(typeof data?.error === "string" ? data.error : "Couldn't join the ranked queue.");
                    return;
                }
                setRankedQueueSize((data as { queueSize?: number }).queueSize ?? 0);
            })
            .catch(() => {});
    }

    function leaveRankedQueue() {
        setRankedQueueActive(false);
        fetch("/api/pvp/ranked-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: character.name, action: "leave" }),
        }).catch(() => {});
    }

    const [opponentClanData, setOpponentClanData] = useState<EnhancedClanData | null>(null);
    const opponentLevel = opponentCharacter?.level ?? pendingAiProfile?.level ?? aiLevel;
    // A mercenary opponent disables the player's PvE pet-summon (owner spec).
    const opponentIsMerc = isMercAiId(pendingAiProfileId);
    const enemyArmorFactor = opponentCharacter ? getCharacterArmorFactor(opponentCharacter, allItems) : aiArmorFactorForProfile(pendingAiProfile ?? { level: opponentLevel });
    const opponentName = opponentCharacter?.name ?? pendingAiProfile?.name ?? `Level ${aiLevel} AI Ninja`;
    const playerBattleAvatar = resolveOwnAvatar(character, sharedImages);
    const opponentAvatar = opponentCharacter?.avatarImage
        || (opponentCharacter ? (sharedImages['avatar:' + opponentCharacter.name.toLowerCase()] ?? '') : '')
        || pendingAiProfile?.image
        // Bundled hunt/apex beast art wins over an admin 'ai:' upload. beastPortrait
        // only resolves hunt-ai-* / apex-ai-* ids, so every OTHER AI still falls
        // through to its shared-image override below, unchanged — this ordering only
        // affects the shipped beasts. It sits ABOVE the shared lookup because a stale
        // admin upload (e.g. a "hunter with a hawk" mistaken for the Forest Hawk) was
        // overriding the correct painted portrait in the fight. The contract board
        // already shows the bundled art, so the battle should match it.
        || beastPortrait(pendingAiProfile?.id)
        || (pendingAiProfile ? (sharedImages['ai:' + pendingAiProfile.id] ?? '') : '')
        || pendingAiProfile?.icon
        || "EN";
    const opponentBattleSprite = opponentCharacter
        ? null
        : battlefieldAiSprite(pendingAiProfile?.id ?? pendingAiProfileId, sharedImages)
            || (!pendingAiProfileId ? defaultAiRivalSprite() : null);
    // PvE difficulty curve — scale standard PvE AI enemy stats AND max HP by the
    // band for the ENCOUNTER's level (easy 1-30, medium 31-50, hard 51-90,
    // peer 91+). Excludes real PvP (opponentCharacter), the endless tower
    // (already wave-scaled), and ranked, so nothing double-dips and PvP balance
    // is untouched. The HP factor only applies to the AI fallback / authored HP
    // (a live opponentCharacter is gated out by isStandardPve). See
    // lib/pve-difficulty.ts.
    const isStandardPve = !opponentCharacter && !rankedBattleActive;
    const enemyHpDifficultyFactor = isStandardPve ? pveDifficultyHpMultiplier(opponentLevel) : 1;
    const enemyMaxHp = Math.max(1, Math.floor((opponentCharacter?.maxHp ?? pendingAiProfile?.hp ?? maxHpForLevel(opponentLevel)) * enemyHpDifficultyFactor));
    const enemyMaxChakra = opponentCharacter?.maxChakra ?? pendingAiProfile?.chakra ?? maxChakraForLevel(opponentLevel);
    const enemyMaxStamina = opponentCharacter?.maxStamina ?? pendingAiProfile?.stamina ?? maxStaminaForLevel(opponentLevel);
    const pveDifficultyStatFactor = isStandardPve ? pveDifficultyStatMultiplier(opponentLevel) : 1;
    const enemyCombatStats = perRankStatCap(scaleStatsForPveDifficulty(
        opponentCharacter?.stats ?? pendingAiProfile?.stats ?? aiStatsForLevel(opponentLevel),
        pveDifficultyStatFactor,
    ), opponentLevel);
    // PvE AI mastery is tied to the enemy's level (was hard-coded to max=50 for
    // every foe, so a level-8 D-rank cast its jutsu with endgame EP + tag%).
    // Real PvP (opponentCharacter) is unaffected — it never routes through these
    // client AI paths. See lib/pve-difficulty.ts.
    const enemyTurnStartHpRef = useRef(character.hp);
    const enemyTurnDealtRef = useRef(0);
    const pveAiMastery = pveAiMasteryForLevel(opponentLevel);
    // Every enemy→player hit in standard PvE passes through pveGuardedEnemyHit:
    // per-hit cap + per-turn cap + easy-band mercy floor (no sudden death). The
    // two refs track the player's HP at the START of the enemy's turn and the
    // damage already dealt this turn (accumulated across the enemy's whole
    // multi-action turn, then the player DoT tick in endEnemyTurn — all counted,
    // so the per-turn cap bounds a chained turn, not just one hit). Non-standard PvE
    // (live PvP, endless, ranked) bypasses the guard entirely. See pve-difficulty.ts.
    const guardEnemyHit = (rawDamage: number): number => {
        if (!isStandardPve) return Math.max(0, Math.floor(Number.isFinite(rawDamage) ? rawDamage : 0));
        const guarded = pveGuardedEnemyHit(rawDamage, {
            enemyLevel: opponentLevel,
            playerMaxHp: character.maxHp,
            playerHpTurnStart: enemyTurnStartHpRef.current,
            dealtThisTurn: enemyTurnDealtRef.current,
        });
        enemyTurnDealtRef.current += guarded;
        return guarded;
    };
    // PvE-vs-player-save opponents get their Legacy signature too (parity with
    // the server's sealed loadout); AI profiles have no Legacy.
    const opponentLegacySignature = !pendingAiProfile && opponentCharacter ? legacySignatureFor(opponentCharacter) : null;
    const enemyAiJutsus = pendingAiProfile
        ? allJutsus.filter((jutsu) => pendingAiProfile.jutsuIds.includes(jutsu.id))
        : opponentCharacter
            ? [
                ...getPvpJutsuLoadout(savedBloodlines, creatorJutsus, opponentCharacter),
                ...(opponentLegacySignature ? [opponentLegacySignature] : []),
            ]
            : [];
    const playerSearchMatches = (player: PlayerRecord, search: string) =>
        player.name !== character.name && player.name.toLowerCase().includes(search.trim().toLowerCase());
    const incomingChallenges = duelChallenges.filter((challenge) => !challenge.accepted && !challenge.declined && challenge.toName.toLowerCase() === character.name.toLowerCase());
    const rollInitiative = () => (character.stats.speed + character.stats.willpower * 0.4 >= enemyCombatStats.speed + enemyCombatStats.willpower * 0.4 ? "player" : "enemy") as BattleActor;

    const [playerPos, setPlayerPos] = useState(62);
    const [enemyPos, setEnemyPos] = useState(33);

    const [playerHp, setPlayerHp] = useState(character.hp);
    const [enemyHp, setEnemyHp] = useState(enemyMaxHp);
    const [enemyChakra, setEnemyChakra] = useState(enemyMaxChakra);
    const [enemyStamina, setEnemyStamina] = useState(enemyMaxStamina);
    // combatResourcesV2: chakra/stamina are combat-only and start each fight full. The
    // bigger v2 pool can't rely on the slow +1/sec out-of-combat regen, so refill on entry.
    useEffect(() => {
        if (!COMBAT_RESOURCES_V2) return;
        if (character.chakra < character.maxChakra || character.stamina < character.maxStamina) {
            updateCharacter({ ...character, chakra: character.maxChakra, stamina: character.maxStamina });
        }
    }, []);
    const [enemyJutsuCooldowns, setEnemyJutsuCooldowns] = useState<Record<string, number>>({});

    const [playerShield, setPlayerShield] = useState(equippedShieldBonus);
    const [enemyShield, setEnemyShield] = useState(0);

    const [ap, setAp] = useState(100);
    const [enemyAp, setEnemyAp] = useState(100);
    const [turn, setTurn] = useState(1);
    const [battleEnded, setBattleEnded] = useState(false);
    const [battleResult, setBattleResult] = useState<"win" | "loss" | "fled" | null>(null);
    // Mint the reward token when an AI battle begins, not after the client says
    // it won. This binds each redemption to one battle lifecycle and prevents
    // the victory handler from manufacturing a fresh token on demand.
    const aiFightTokenPromiseRef = useRef<Promise<string> | null>(null);
    useEffect(() => {
        if (!battleStarted || battleEnded || opponentCharacter) return;
        if (aiFightTokenPromiseRef.current) return;
        const payload = {
            playerName: character.name,
            opponentId: pendingAiProfile?.id ?? "",
            opponentLevel: aiLevel,
            battleKind: raidBattleKind === "defense"
                ? "defense"
                : raidBattleKind === "raidAi"
                    ? "raidAi"
                    : exploreAmbushActive
                        ? "explore"
                        : missionBattleActive
                            ? "mission"
                            : "practice",
        };
        aiFightTokenPromiseRef.current = fetch("/api/missions/ai-fight-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        })
            .then((response) => response.ok ? response.json() : null)
            .then((data: { token?: unknown } | null) => typeof data?.token === "string" ? data.token : "")
            .catch(() => "");
    }, [battleStarted, battleEnded, opponentCharacter, character.name, pendingAiProfile?.id, aiLevel, pendingStoryBattle, raidBattleKind, exploreAmbushActive, missionBattleActive]);
    // Battle-end sting — a victory chime on a win, a KO thud on a loss/flee.
    // Routes through the pet SFX engine's master mute, so it's silent by default.
    //
    // Also stamps the AUTHORITATIVE outcome onto any pending wanderer/ambush/
    // hunt-pack record. lib/wanderer-fight.ts was written for exactly this and
    // was never called from anywhere, so resolveWandererFight always fell back
    // to its `totalAiKills` delta heuristic — which, per that module's own note,
    // "made real ambush WINS resolve as losses" (the count syncs asynchronously
    // and a save-conflict refetch can clobber it). No-op for every battle with
    // no pending record.
    useEffect(() => {
        if (battleResult === "win") playPetSfx("victory");
        else if (battleResult === "loss" || battleResult === "fled") playPetSfx("ko");
        if (battleResult) stampWandererFightResult(battleResult);
    }, [battleResult]);
    const [storySettlementPending, setStorySettlementPending] = useState(false);
    // True only for an explore-ambush win. winBattle sets it (the exploreAmbushActive
    // prop is cleared by onExploreAmbushWon in the same call, so we capture it here)
    // and the victory overlay reads it to offer a single "Return to Sector" exit
    // instead of Fight Again / Return to Village. Reset at each fight start.
    // STATE, not a ref: this drives which exit the victory overlay offers, and
    // a ref write does not re-render — the overlay could paint the wrong button
    // depending on what else happened to commit that frame.
    const [exploreAmbushWin, setExploreAmbushWin] = useState(false);
    // Report arena-fight-in-progress up to App for the global navigation lock.
    // A fight is "in progress" once it has started and not yet ended; on resolve
    // (battleEnded flips true) or unmount we report false so the player can leave.
    useEffect(() => {
        onBattleActiveChange?.(battleStarted && !battleEnded);
        return () => onBattleActiveChange?.(false);
    }, [battleStarted, battleEnded, onBattleActiveChange]);
    // Onboarding "Academy spar" — the guaranteed-first-win tutorial fight. The two
    // flags below are DISPLAY-ONLY (drive the SparCoach banner); they never affect
    // combat math. Set additively from basicAttack()/castJutsu() during this fight.
    const isAcademySpar = pendingStoryBattle?.kind === "academySparring";
    const [sparAttacked, setSparAttacked] = useState(false);
    const [sparCasted, setSparCasted] = useState(false);
    const [hoveredBattleTile, setHoveredBattleTile] = useState<number | null>(null);

    const [playerStatuses, setPlayerStatuses] = useState<CombatStatus[]>([]);
    const [enemyStatuses, setEnemyStatuses] = useState<CombatStatus[]>([]);
    const [barrierTiles, setBarrierTiles] = useState<{ tile: number; rounds: number }[]>([]);
    // Persistent ground-effect zones either fighter drops with an INSTANT_EFFECT
    // ground jutsu (mirrors PvP `groundEffects`). Each re-applies its debuffs to
    // the opposing fighter whenever they stand in it for `rounds` rounds.
    const [groundZones, setGroundZones] = useState<PveGroundZone[]>([]);
    // Tags a ground zone may carry — matches PvP groundEffectTags.
    const GROUND_ZONE_TAGS = new Set(["Decrease Damage Given", "Recoil", "Poison"]);

    const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
    const [jutsuCooldowns, setJutsuCooldowns] = useState<Record<string, number>>({});
    const [log, setLog] = useState("Battle started.");
    const [, setCombatLog] = useState<string[]>([]);
    const [activeActor, setActiveActor] = useState<BattleActor>(rollInitiative);
    const [actionsThisTurn, setActionsThisTurn] = useState(0);
    const [battleHistory, setBattleHistory] = useState<BattleActionEntry[]>([]);
    // Reflection log (display-only): once a fight resolves, snapshot its log into
    // the player's rolling battle history for later review (Profile → Battles).
    // One effect on the finalization signals avoids threading a call through the
    // ~7 scattered win/loss/flee sites; the ref resets when a new battle starts
    // so back-to-back fights (endless waves) each record exactly once.
    const battleRecordedRef = useRef(false);
    useEffect(() => { if (!battleEnded) battleRecordedRef.current = false; }, [battleEnded]);
    useEffect(() => {
        if (!battleEnded || !battleResult || battleRecordedRef.current || !onRecordBattle) return;
        battleRecordedRef.current = true;
        const mode = pendingStoryBattle ? "Story"
            : missionBattleActive ? "Mission"
            : exploreAmbushActive ? "Ambush"
            : (raidBattleKind && raidBattleKind !== "none") ? "Raid"
            : "Arena";
        const outcome: BattleHistoryEntry["outcome"] = battleResult === "win" ? "win" : battleResult === "fled" ? "flee" : "loss";
        onRecordBattle(makeBattleEntry({
            id: `pve-${Date.now()}-${opponentName}`,
            ts: Date.now(),
            mode,
            opponent: opponentName,
            outcome,
            rounds: turn,
            self: character.name,
            actions: buildActionsFromPveHistory(battleHistory),
        }));
    }, [battleEnded, battleResult]);
    // Mobile Actions|Battle Log tabs (+ unread badge on the log). Desktop shows both.
    const battleTabs = useBattleTabs(battleHistory.length);
    // Keep the PvE battle log pinned to the newest entry (parity with
    // PvpBattleScreen.tsx) — without this the latest action scrolls below the
    // fold in a long fight and the player can't see what just happened.
    const combatLogRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (combatLogRef.current) combatLogRef.current.scrollTop = combatLogRef.current.scrollHeight;
    }, [battleHistory.length]);
    // Battle-log round accordion: records only the rounds the user
    // has explicitly toggled; default-open is the latest two rounds, computed in
    // render. Keeps long fights from becoming a wall of text.
    const [logRoundOverridesA, setLogRoundOverridesA] = useState<Record<number, boolean>>({});
    const [selectedActionId, setSelectedActionId] = useState<SelectedCombatAction>(undefined);
    const [summonedPetId, setSummonedPetId] = useState("");
    // ── Summoned pet as an on-field actor (PvE only) ──────────────────────────
    // The pet takes its own tile + HP and acts on a dedicated phase (You → Pet →
    // Enemy). PET_FIELD_TURNS = how many of its own phases it fights before it
    // leaves; the damage knobs keep its ~1-action-per-round output in line with
    // the old bonus-attack model (see the pet board-actor plan).
    const PET_FIELD_TURNS = 4;
    const PET_PHASE_DAMAGE_MULT = 1;        // global tuning knob for pet strike damage
    const PET_PHASE_DAMAGE_MAX_FRAC = 0.16; // soft cap: one pet hit ≤ 16% of enemy max HP
    const [petPos, setPetPos] = useState(63);
    const [petHp, setPetHp] = useState(0);
    const [petMaxHp, setPetMaxHp] = useState(0);
    const [petStatuses, setPetStatuses] = useState<CombatStatus[]>([]);
    const [petShield, setPetShield] = useState(0);
    const [petJutsuCooldowns, setPetJutsuCooldowns] = useState<Record<string, number>>({});
    const [petTurnsRemaining, setPetTurnsRemaining] = useState(0);
    const [petSummonedThisFight, setPetSummonedThisFight] = useState(false);

    const [pendingTargetJutsuId, setPendingTargetJutsuIdRaw] = useState("");
    const [pendingTargetJutsuDirect, setPendingTargetJutsuDirect] = useState<Jutsu | null>(null);
    const [pendingTargetWeapon, setPendingTargetWeaponRaw] = useState<GameItem | null>(null);
    const [inspectedJutsuId, setInspectedJutsuId] = useState("");
    const [inspectedCombatItemId, setInspectedCombatItemId] = useState("");
    // Pre-fight countdown (10 s) — used for ALL battle types now
    const [prefightCountdown, setPrefightCountdown] = useState<number | null>(null);
    const [prefightFirstActor, setPrefightFirstActor] = useState<"player" | "enemy" | null>(null);

    // Per-turn round timer (45 s). The countdown lives in <CombatRoundTimer>
    // (rendered below) so its 1s tick re-renders only that element, not the
    // whole hex board. Incrementing this key restarts the 45-second window
    // (used when the player takes an action to keep their time from expiring
    // mid-combo) and resetting on turn change is handled by the component.
    const [roundTimerKey, setRoundTimerKey] = useState(0);

    // Stable refs so timer callbacks always call the latest version of arena functions.
    const resetBattleRef   = useRef<(hp?: number, firstActor?: "player" | "enemy") => void>(() => {});
    const setLogRef        = useRef<(msg: string) => void>(() => {});
    const autoEndTurnRef   = useRef<() => void>(() => {});
    const enemyTurnRef     = useRef<() => void>(() => {});
    // Multi-action enemy turn (Phase 0): the enemy now spends its full 100-AP
    // budget across up to 5 actions instead of taking one and ending. These refs
    // carry the turn's remaining budget across the scheduled per-action re-entry
    // (enemyContinueRef, fired by setTimeout so each action reads FRESH committed
    // state — the same latest-ref pattern enemyTurnRef uses). enemyTurnActiveRef
    // guards against a double-begin (e.g. a re-fired effect) starting two loops.
    const enemyContinueRef = useRef<() => void>(() => {});
    const enemyTurnApRef       = useRef(100);
    const enemyTurnActionsRef  = useRef(0);
    const enemyTurnActiveRef   = useRef(false);
    // Tracks the pending 850ms continuation timer so it can be cancelled on
    // unmount — otherwise an orphaned enemy-turn setTimeout chain keeps firing
    // setState into a torn-down screen (navigate away / refresh-restore mid
    // enemy turn), a leak that compounds on mobile.
    const enemyTurnTimerRef    = useRef<number | null>(null);
    // Rolling memory of the player's recent actions (most-recent-last), feeding
    // buildPlayerRead so the enemy can read playstyle (turtle / burst / kite).
    const playerActionLogRef   = useRef<PlayerActionRecord[]>([]);

    const pendingPlayerStunApPenaltyRef = useRef(false);
    // Pet-phase bookkeeping (mirrors the enemy multi-action refs): a double-begin
    // guard, the pacing timer, the fresh-state continuation, and the per-phase
    // move-step / attack counters.
    const petActingRef = useRef(false);
    const petPhaseTimerRef = useRef<number | null>(null);
    const petContinueRef = useRef<() => void>(() => {});
    const petPhaseStepsRef = useRef(0);
    const petHasAttackedRef = useRef(false);

    function setPendingTargetJutsuId(value: string) {
        setPendingTargetJutsuIdRaw(value);
        setPendingTargetWeaponRaw(null);

        if (!value) {
            setPendingTargetJutsuDirect(null);
        }
    }

    function armPendingTargetJutsu(jutsu: Jutsu) {
        setPendingTargetWeaponRaw(null);
        setPendingTargetJutsuDirect(jutsu);
        setPendingTargetJutsuIdRaw(jutsu.id || `${jutsu.name}-${jutsu.ap}-${jutsu.range}`);
    }

    const latestPendingTargetJutsu = equippedJutsus.find((jutsu) => jutsu.id === pendingTargetJutsuId);
    const pendingTargetJutsu = latestPendingTargetJutsu ?? pendingTargetJutsuDirect;

    const inspectedJutsu = equippedJutsus.find((jutsu) => jutsu.id === inspectedJutsuId);
    const inspectedCombatItem = combatEquippedItems.find((item) => item.id === inspectedCombatItemId);
    const activeBattlePet = combatEligiblePets.find((pet) => pet.id === character.activePetId);
    const summonedPet = activeBattlePet && summonedPetId === activeBattlePet.id ? activeBattlePet : null;
    // A summoned pet is a live on-field actor while it has HP and phases left.
    const isPetAlive = Boolean(summonedPet) && petHp > 0 && petTurnsRemaining > 0;
    const canSummonPet = Boolean(!opponentCharacter && !opponentIsMerc && battleStarted && !battleEnded);
    const activeBattlePetCanSummon = Boolean(
        activeBattlePet &&
        !isPetOnExpedition(activeBattlePet) &&
        (activeBattlePet.unlockedForPve || activeBattlePet.level >= 50),
    );
    const activeBattlePetSummonNote = !activeBattlePet
        ? "Choose an active pet in the Pet Yard"
        : isPetOnExpedition(activeBattlePet)
            ? `${petDisplayName(activeBattlePet)} is on an expedition`
            : !activeBattlePet.unlockedForPve && activeBattlePet.level < 50
                ? `Unlocks at pet level 50 (currently ${activeBattlePet.level})`
                : `Summon ${petDisplayName(activeBattlePet)}`;

    function weatherDamageMultiplier(jutsu: Jutsu) {
        if (rankedBattleActive) return 1;
        const weather = weatherEffects[currentWeather];
        // Bloodline jutsu carry an explicit weatherElement (base element or
        // "None"); others fall back to their own element. "None" never matches.
        const el = weatherElementOf(jutsu);
        if (weather.positiveElement === el) return 1.05;
        if (weather.negativeElement === el) return 0.98;
        return 1;
    }

    function territoryDamageMultiplier(jutsu: Jutsu) {
        if (rankedBattleActive) return 1;
        const territory = loadSectorTerritory(currentSector);
        if (!territory.ownerClan) return 1;
        // Owner-clan members only: a fighter earns the home-terrain edge on their
        // OWN clan's sector (attacking or defending), never while raiding someone
        // else's land. Mirrors the server seal in api/pvp/session.ts.
        if (!character.clan || territory.ownerClan !== character.clan) return 1;
        const buffByType: Partial<Record<JutsuType, TerritoryBuffStat>> = {
            Bukijutsu: "bukijutsuOffense",
            Taijutsu: "taijutsuOffense",
            Ninjutsu: "ninjutsuOffense",
            Genjutsu: "genjutsuOffense",
            // "Any" type uses all stats — grant the territory bonus if any matching buff applies
        };
        return territory.terrainBuffStat === buffByType[jutsu.type] ? 1.1 : 1;
    }

    // Biome terrain bonus — mirrors the server PvP engine (api/pvp/move.ts
    // `terrainMultiplier`): a jutsu whose school matches the battlefield biome
    // deals +10%. Applies to BOTH fighters and — unlike weather/territory, which
    // are local-only and gated off in ranked — also in ranked, because the biome
    // is server-sealed. This was missing in PvE, so the advertised terrain buff
    // (e.g. "+10% Taijutsu Damage" in forests) did nothing here.
    function biomeTerrainMultiplier(jutsu: Jutsu) {
        switch (currentBiome) {
            case "forest":  return jutsu.type === "Taijutsu"  ? 1.1 : 1;
            case "snow":    return jutsu.type === "Bukijutsu" ? 1.1 : 1;
            case "volcano": return jutsu.type === "Ninjutsu"  ? 1.1 : 1;
            case "shadow":  return jutsu.type === "Genjutsu"  ? 1.1 : 1;
            default:        return 1;
        }
    }

    function adjustedApCost(cost: number) {
        // Percent-per-action to match PvP (api/pvp/move.ts adjustedCost): Lag raises
        // each action's AP cost and Overclock lowers it, scaled by the status's
        // percent — was a flat ±10 regardless of magnitude. Lag/Overclock are binary
        // tags (percent 0), so `|| 20` applies the standard 20% when unspecified.
        // ACTIVE only: a just-cast (deferred) self-Overclock must not discount
        // later actions THIS turn — it starts next round. Reading raw was an
        // instant-effect exploit (cast Overclock, then spam cheaper actions).
        const active = activeStatuses(playerStatuses);
        const lag = active.find((s) => statusMatchesName(s, "Lag"));
        const overclock = active.find((s) => statusMatchesName(s, "Overclock"));
        let adjusted = cost;
        if (lag) adjusted = Math.ceil(adjusted * (1 + (lag.percent || 20) / 100));
        if (overclock) adjusted = Math.floor(adjusted * (1 - (overclock.percent || 20) / 100));
        return Math.max(0, adjusted);
    }

    // Cheapest AP cost of ANY action the player could still take this turn —
    // move, basic attack, an equipped jutsu, or an equipped weapon /
    // throwable / consumable. Used to decide whether to auto-pass the turn.
    // MUST include the cheap (20-AP) throwables/consumables: the old auto-pass
    // checked only the 30-AP move cost, so it ended the turn with ~20 AP left
    // even though a 20-AP item/jutsu was still usable.
    function pveMinActionCost(): number {
        const costs = [
            adjustedApCost(30), // move
            adjustedApCost(40), // basic attack
            ...equippedJutsus.map((j) => adjustedApCost(j.ap ?? 40)),
            // Only items the player can still USE count — a thrown/consumable/
            // potion that's out of stock (or a potion at its sip cap) must not
            // keep the turn alive when no real action remains.
            ...combatEquippedItems.filter(canUseCombatItem).map((item) => {
                const slot = normalizeEquipmentSlot(item.slot);
                const isWeapon = slot === "hand" || slot === "thrown";
                // Mirrors the spendAp defaults: weapon/thrown 40, consumable 35.
                return adjustedApCost(item.apCost ?? (isWeapon ? 40 : 35));
            }),
        ];
        // Fold via the shared reducer (lib/combat-affordability) — keep the PvP
        // twin (pvpMinActionCost in PvpBattleScreen) in sync when adding actions.
        return minActionCost(costs);
    }

    // Enemy defensive buffs (Absorb / Reflect) honored when the PLAYER damages the
    // enemy — mirrors how enemyTurn honors the player's Absorb/Reflect. Pierce (true
    // damage) bypasses them. Returns the damage the enemy actually takes (Absorb
    // converts a capped % into avoided damage) plus any reflected damage the attacker
    // receives. Reads activeStatuses so a just-applied (deferred) buff waits a round.
    function enemyDefenseFor(rawDamage: number, bypass = false) {
        if (bypass || rawDamage <= 0) return { net: rawDamage, reflected: 0, absorbed: 0 };
        const absorbPct = sumActiveStatusPct(enemyStatuses, "Absorb");
        const reflectPct = sumActiveStatusPct(enemyStatuses, "Reflect");
        const absorbed = absorbPct > 0 ? Math.min(rawDamage, Math.floor(cappedPostDamage(rawDamage, absorbPct))) : 0;
        const reflected = reflectPct > 0 ? Math.floor(cappedPostDamage(rawDamage, reflectPct)) : 0;
        const net = Math.max(0, rawDamage - absorbed);
        // `absorbed` is returned so callers can LOG it — it used to silently
        // shrink the damage number, which read as "the AI's Absorb did nothing".
        return { net, reflected, absorbed };
    }

    useEffect(() => {
        if (!battleStarted || battleEnded) return;
        // Spectator board is player-vs-player only. opponentCharacter is set
        // exclusively for real PvP bouts (it is null for every AI / story /
        // raid-boss / training opponent — see opponentName above), so it's the
        // reliable PvP signal. Skipping AI fights keeps the board free of
        // entries like "Sota vs Oathbound Soldier" that can't be spectated.
        if (!opponentCharacter) return;
        const fight: ArenaSpectatorFight = {
            id: `${character.name}-${opponentName}-${Date.now()}`,
            title: `${character.name} vs ${opponentName}`,
            mode: rankedBattleActive ? "Ranked" : clanWarPointsActive > 0 ? "Clan War" : raidBattleKind !== "none" ? "Raid/PvP" : "Arena",
            startedAt: Date.now(),
            fighters: [character.name, opponentName],
        };
        const next = [fight, ...loadArenaActiveFights().filter((candidate) => !candidate.fighters.includes(character.name))];
        saveArenaActiveFights(next);
        setSpectatorFights(next);
        return () => {
            unregisterLocalFight(fight.id);
            const remaining = loadArenaActiveFights().filter((candidate) => candidate.id !== fight.id);
            saveArenaActiveFights(remaining);
            setSpectatorFights(remaining);
        };
    }, [battleStarted, battleEnded, opponentName, opponentCharacter, rankedBattleActive, clanWarPointsActive, raidBattleKind, character.name]);

    useEffect(() => {
        if (!character.clan) { setOpponentClanData(null); return; }
        fetchClanData(character.clan).then(async (data) => {
            const activeWar = data ? enhanceClanData(data).activeWar : undefined;
            if (!activeWar?.opponentClan) { setOpponentClanData(null); return; }
            const opponentData = await fetchClanData(activeWar.opponentClan);
            setOpponentClanData(opponentData ? enhanceClanData(opponentData) : null);
        }).catch(() => setOpponentClanData(null));
    }, [character.clan]);

    useEffect(() => {
        if (!battleStarted || battleEnded) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === "m") {
                setSelectedActionId((current) => current === "move" ? undefined : "move");
                setLog("Move selected. Click an adjacent tile.");
            }
            if (event.key.toLowerCase() === "w") {
                waitTurn();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [battleStarted, battleEnded, activeActor, ap, turn]);

    useEffect(() => {
        if (!battleStarted || battleEnded || activeActor !== "player" || actionsThisTurn === 0) return;
        // Auto-pass only when the player can't afford the CHEAPEST remaining
        // action — including 20-AP throwables/consumables/jutsu, not just the
        // 30-AP move (which used to end the turn with 20 AP and a usable item).
        const minCost = pveMinActionCost();
        if (minCost > 0 && ap < minCost) {
            advanceAfterPlayer();
        }
    }, [ap, actionsThisTurn, activeActor, battleStarted, battleEnded]);

    // -- Pre-fight countdown effect -------------------------------------------
    // Ticks prefightCountdown down from 10 ? 0, then dismisses the overlay.
    // The battle itself is already started by startPrefight() — this only
    // hides the countdown UI so the player can act.
    useEffect(() => {
        if (prefightCountdown === null) return;
        if (prefightCountdown <= 0) {
            setPrefightCountdown(null);
            setPrefightFirstActor(null);
            return;
        }
        const t = setTimeout(() => setPrefightCountdown((c) => (c !== null ? c - 1 : null)), 1000);
        return () => clearTimeout(t);
    }, [prefightCountdown]);

    // -- 45-second round timer ------------------------------------------------
    // The countdown now lives in the isolated <CombatRoundTimer> rendered below
    // (so its 1s tick doesn't re-render the board). It resets each time it
    // becomes the player's turn OR the player takes an action (roundTimerKey
    // bump in spendAp), and calls autoEndTurnRef on expiry to auto-pass the turn.

    // -- Auto-resolve enemy turn -----------------------------------------------
    // When it becomes the enemy's turn, fire their action automatically after a
    // short delay. This replaces the manual "Resolve" button tap on mobile.
    useEffect(() => {
        if (!battleStarted || battleEnded || activeActor !== "enemy" || prefightCountdown !== null) return;
        // Short lead-in before the enemy's first action so the turn handoff reads
        // (was 1200ms — trimmed to keep multi-action enemy turns snappy).
        const t = setTimeout(() => enemyTurnRef.current(), combatFastRef.current ? 250 : 500);
        return () => clearTimeout(t);
    }, [battleStarted, battleEnded, activeActor, prefightCountdown]);

    useEffect(() => {
        if (lobbyMode === "arenaDistrict" && !battleStarted) {
            if (pendingAiProfileId) setPendingAiProfileId("");
            if (pendingPvpOpponent) setPendingPvpOpponent(null);
            if (raidBattleKind !== "none") setRaidBattleKind("none");
        }
    }, [lobbyMode, battleStarted, pendingAiProfileId, pendingPvpOpponent?.name, raidBattleKind]);

    // Clear the mission-battle flag whenever a battle ends. winBattle credits the
    // mission on a win BEFORE this fires; any other ending (loss, flee) leaves the
    // credit ungranted and prevents the flag lingering into a later fight.
    useEffect(() => {
        if (battleEnded) onMissionBattleResolved?.();
    }, [battleEnded]);

    // Float a ±damage / ±heal number over the player and enemy whenever their HP
    // changes (D3). Mirrors PvpBattleScreen's pvp-hit-fx: diff vs a per-fighter
    // ref so each transition fires once, cap the list, auto-expire. Cosmetic only.
    useEffect(() => {
        const floatAt = (pos: number, amount: number, kind: "damage" | "heal", who: string) => {
            const row = Math.floor(pos / gridWidth);
            const col = pos % gridWidth;
            const x = col * X_STEP + HEX_W / 2;
            const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.4;
            return { id: `${who}-${Date.now()}-${amount}-${kind}`, x, y, amount, kind };
        };
        const next: { id: string; x: number; y: number; amount: number; kind: "damage" | "heal" }[] = [];
        const pending = pendingHitFxRef.current;
        // Explicit per-event amounts (true damage/heal, matching the log) take
        // precedence; only when a fighter had no queued event do we fall back to
        // the post-clamp HP delta so uninstrumented HP changes still show a popup.
        if (pending.p.length) {
            for (const ev of pending.p) next.push(floatAt(playerPos, ev.amount, ev.kind, "p"));
        } else {
            const pPrev = prevPlayerHpRef.current;
            if (pPrev != null && playerHp !== pPrev) {
                const d = playerHp - pPrev;
                next.push(floatAt(playerPos, Math.abs(d), d < 0 ? "damage" : "heal", "p"));
            }
        }
        if (pending.e.length) {
            for (const ev of pending.e) next.push(floatAt(enemyPos, ev.amount, ev.kind, "e"));
        } else {
            const ePrev = prevEnemyHpRef.current;
            if (ePrev != null && enemyHp !== ePrev) {
                const d = enemyHp - ePrev;
                next.push(floatAt(enemyPos, Math.abs(d), d < 0 ? "damage" : "heal", "e"));
            }
        }
        pendingHitFxRef.current = { p: [], e: [] };
        prevPlayerHpRef.current = playerHp;
        prevEnemyHpRef.current = enemyHp;
        if (!next.length) return;
        setPveHitFx((cur) => [...cur, ...next].slice(-8));
        const t = window.setTimeout(() => {
            setPveHitFx((cur) => cur.filter((f) => !next.some((n) => n.id === f.id)));
        }, 1100);
        return () => window.clearTimeout(t);
    }, [playerHp, enemyHp, hitFxTick]);

    // On unmount, cancel any in-flight enemy-turn continuation so the recursive
    // 850ms setTimeout chain can't keep running (firing setState into a dead
    // component) after the player leaves the fight. Prevents a leaked, board-
    // thrashing background loop that compounds across re-entries on mobile.
    useEffect(() => () => {
        if (enemyTurnTimerRef.current !== null) {
            window.clearTimeout(enemyTurnTimerRef.current);
            enemyTurnTimerRef.current = null;
        }
        enemyTurnActiveRef.current = false;
        if (petPhaseTimerRef.current !== null) {
            window.clearTimeout(petPhaseTimerRef.current);
            petPhaseTimerRef.current = null;
        }
        petActingRef.current = false;
    }, []);

    useEffect(() => {
        // Retire pre-cutover browser snapshots. Every current AI launch enters
        // AiFightHost; a catalog id alone can never arm the local reducer.
        if (pendingAiProfileId) setPendingAiProfileId("");
    }, [pendingAiProfileId]);

    useEffect(() => {
        if (lobbyMode === "arenaDistrict") return;
        if (!pendingPvpOpponent || battleStarted) return;
        const opponent = normalizeCharacter(pendingPvpOpponent);
        setPendingAiProfileId("");
        if (raidBattleKind === "none") setRaidBattleKind("raidPlayer");
        setRankedBattleActive(false);
        setClanWarPointsActive(0);
        setOpponentCharacter(opponent);
        setEnemyHp(opponent.maxHp);
        setPendingPvpOpponent(null);
        startPrefight(opponent.maxHp, `PvP battle started against ${opponent.name}. Weather: ${weatherEffects[currentWeather].name}.`);
    }, [lobbyMode, pendingPvpOpponent?.name, battleStarted]);

    function startPrefight(hp: number, logMsg: string) {
        // Coin flip — 50/50 who gets first turn
        const firstActor: "player" | "enemy" = Math.random() < 0.5 ? "player" : "enemy";
        // Start the battle immediately so the full arena UI renders behind the
        // countdown overlay. The overlay just delays player input, not rendering.
        setBattleStarted(true);
        setEnemyJutsuCooldowns({});
        resetBattleRef.current(hp, firstActor);
        setLogRef.current(logMsg);
        setPrefightFirstActor(firstActor);
        setPrefightCountdown(3);
        // Fresh fight — clear any prior explore-ambush win flag.
        setExploreAmbushWin(false);
    }

    function beginAiBattle() {
        if (!requestAiFight({
            opponentId: publishedPracticeOpponentForLevel(aiLevel),
            opponentLevel: aiLevel,
            battleKind: "practice",
            returnScreen: "arena",
        })) alert("The sealed practice arena is unavailable. No fight was started.");
    }

    async function challengePlayer(
        opponent: PlayerRecord,
        mode: DuelChallenge["mode"] = "standard",
        clanWarPoints = 0,
        party = false,
        rankedAuthority?: PlayerRankedAuthority,
    ) {
        if (mode === "ranked" && !rankedAuthority) {
            alert("A current server-ranked match proof is required. Rejoin the ranked queue.");
            return;
        }
        const isPetMode = mode === "clanWarPet" || mode === "rankedPet";
        const availablePetCount = availablePetBattleCount(combatEligiblePets);
        if (isPetMode && availablePetCount < 1) {
            alert("You need a pet that is not on an expedition before sending a pet battle challenge.");
            return;
        }
        if (party && availablePetCount < 2) {
            alert("A 2v2 pet battle needs two pets not away on an expedition.");
            return;
        }
        const knownPetTarget = isPetMode ? playerRoster.find((player) => player.name.toLowerCase() === opponent.name.toLowerCase()) : undefined;
        if (isPetMode && knownPetTarget && availablePetBattleCount(publicEligiblePets(knownPetTarget)) < (party ? 2 : 1)) {
            alert(`${opponent.name} does not have a pet available for battle.`);
            return;
        }
        // Pet ranked: mint ONE server-minted match token (seals BOTH pre-match
        // pet ratings) so the rating swing is server-authoritative + exactly-once.
        // The SAME token rides the challenge to the responder and back via the
        // accepted notice, so both sides report it (the server NX-dedups per
        // token, settling both accounts once). Mint failure → local Elo fallback.
        let petRankedToken: string | undefined;
        const challengePet = isPetMode ? (combatEligiblePets.find(pet => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? combatEligiblePets.find(pet => !isPetOnExpedition(pet))) : undefined;
        const petBattleSeed = isPetMode ? Date.now() + Math.floor(Math.random() * 100000) : undefined;
        // 2v2 party: field my two best available (not-on-expedition) pets, lead
        // first. The responder auto-picks their own best two on accept
        // (acceptPetChallengeGlobal). The accept path enforces both full teams;
        // a requested 2v2 never silently changes into a different mode.
        const partyPetIds: [string, string] | null = (party && isPetMode && challengePet)
            ? (() => {
                const reserve = combatEligiblePets
                    .filter((p) => !isPetOnExpedition(p) && p.id !== challengePet.id)
                    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
                return reserve ? [challengePet.id, reserve.id] : null;
            })()
            : null;
        if (mode === "rankedPet") {
            try {
                const tokRes = await fetch("/api/pet/ranked-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ opponentName: opponent.name, petId: challengePet?.id, seed: petBattleSeed }),
                });
                if (tokRes.ok) petRankedToken = ((await tokRes.json()) as { matchToken?: string }).matchToken;
            } catch { /* fall back to local Elo estimate */ }
        }
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: opponent.name,
            challenger: { ...character, pets: combatEligiblePets },
            challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
            challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            challengerPetId: challengePet?.id,
            petBattleSeed,
            // Pet ranked: stamp my account-level pet Elo so the responder's
            // accepted-notice carries both ratings for symmetric deltas.
            challengerPetRating: mode === "rankedPet" ? (character.petRankedRating ?? 1000) : undefined,
            petRankedToken,
            createdAt: Date.now(),
            mode,
            ...(mode === "ranked" ? rankedAuthority : {}),
            clanWarPoints,
            ...(partyPetIds ? { petParty: true, challengerPetIds: partyPetIds } : {}),
        };
        try {
            const res = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: opponent.name, challenge }),
            });
            if (!res.ok) {
                // The server returns a specific reason for every reject: a 409
                // block (target traveling / already in a battle / engaged), or a
                // 403 Academy protection (sub-Genin targets — a fresh Lv 1 can't
                // be challenged until Genin). Surface that message rather than the
                // generic "not reachable", which made a deliberate block look like
                // the target was simply offline. A thrown fetch (real network
                // failure) still lands in the catch below.
                const data = await res.json().catch(() => ({} as { error?: string }));
                alert(data?.error ?? `${opponent.name} is not reachable live right now. Challenge was not sent.`);
                return;
            }
            // Drop any prior pending outgoing challenge of ours (the server just
            // superseded it) and keep only this fresh one.
            setDuelChallenges([
                ...duelChallenges.filter((c) => !(c.fromName === character.name && !c.accepted && !c.declined && !c.battleId)),
                challenge,
            ]);
            alert(`${mode === "ranked" ? "Ranked challenge" : mode === "rankedPet" ? "Ranked pet challenge" : mode === "clanWarPet" ? (partyPetIds ? "2v2 pet challenge" : "Pet challenge") : "Challenge"} sent to ${opponent.name}.`);
        } catch {
            alert(`${opponent.name} is not reachable live right now. Challenge was not sent.`);
        }
    }

    function declineChallenge(challenge: DuelChallenge) {
        setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id));
        fetch('/api/player/challenge', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: challenge.toName, fromName: challenge.fromName, challengeId: challenge.id }),
        }).catch(() => {});
        fetch('/api/player/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetName: challenge.fromName,
                challenge: { ...challenge, declined: true, fromName: character.name, toName: challenge.fromName },
            }),
        }).catch(() => {});
    }

    async function acceptChallenge(challenge: DuelChallenge) {
        if (!requireServerSettlement("pvpSession")) return;
        const rankedAuthority = challenge.mode === "ranked"
            ? playerRankedAuthorityFromChallenge(challenge)
            : null;
        if (challenge.mode === "ranked" && !rankedAuthority) {
            alert("This ranked challenge is missing its server match proof. Decline it and rejoin the ranked queue.");
            return;
        }
        const challenger = normalizeCharacter(challenge.challenger);
        setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id));
        try {
            const { captureOwnSaveRead } = await loadOwnSaveRead();
            const p2ReadAnchor = captureOwnSaveRead(character);
            // Create a shared turn-based hex-grid PvP session: challenger = p1, us = p2
            const [p1CombatSave, p2CombatSave] = await Promise.all([
                fetchPlayerCombatSave(challenge.fromName),
                fetchPlayerCombatSave(character.name),
            ]);
            if (p2CombatSave && await onOwnSaveRead(p2ReadAnchor, p2CombatSave.character, p2CombatSave._saveVersion) === "foreign") return;
            const p1SavedBloodlines = p1CombatSave?.savedBloodlines ?? savedBloodlines;
            const p1CreatorJutsus = p1CombatSave?.creatorJutsus ?? creatorJutsus;
            const p2SavedBloodlines = p2CombatSave?.savedBloodlines ?? savedBloodlines;
            const p2CreatorJutsus = p2CombatSave?.creatorJutsus ?? creatorJutsus;
            const p1Character = p1CombatSave?.character ?? challenger;
            const p2Character = p2CombatSave?.character ?? character;
            const p1AllItems = getAllItems(p1CombatSave?.creatorItems ?? creatorItems);
            const p2AllItems = getAllItems(p2CombatSave?.creatorItems ?? creatorItems);
            const p1Jutsus = p1CombatSave?.character
                ? getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character)
                : challenge.challengerJutsus?.length
                    ? challenge.challengerJutsus.map(normalizeJutsu)
                    : getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character);
            const p2Jutsus = getPvpJutsuLoadout(p2SavedBloodlines, p2CreatorJutsus, p2Character);
            const res = await fetch('/api/pvp/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: stringifyPvpSessionPayload({ challengeId: challenge.id, useCurrentVitals: !!challenge.sectorAttack, ranked: challenge.mode === "ranked", rankedKind: "player", ...(rankedAuthority ?? {}), baseRewards: !(!challenge.mode || (challenge.mode === "standard" && !challenge.clanWarPoints && !challenge.sectorAttack)), rewardSector: currentSector, ...pvpSessionEnvironment(challenge.mode === "ranked", currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement), p1Character: { ...p1Character, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(p1Character, p1AllItems), bloodlineMult: challenge.challengerBloodlineMult ?? getBloodlineMultiplier(p1Character, p1SavedBloodlines), armorFactor: getCharacterArmorFactor(p1Character, p1AllItems), armorRawDR: getCharacterArmorRawDR(p1Character, p1AllItems), itemDamagePct: getEquippedItemBonus(p1Character, p1AllItems, "damagePercent") }, p2Character: { ...p2Character, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(p2Character, p2AllItems), bloodlineMult: getBloodlineMultiplier(p2Character, p2SavedBloodlines), armorFactor: getCharacterArmorFactor(p2Character, p2AllItems), armorRawDR: getCharacterArmorRawDR(p2Character, p2AllItems), itemDamagePct: getEquippedItemBonus(p2Character, p2AllItems, "damagePercent") } }),
            });
            if (!res.ok) throw new Error('Session create failed');
            // Mirrors acceptChallengeGlobal (App.tsx ~6763): read the session
            // payload returned alongside battleId and seed PvpBattleScreen so
            // the grid renders on first paint. Without this, accept-from-Arena
            // (Spar / Ranked tab) flashes the "Connecting…" card for the GET
            // round-trip even though sector attacks no longer do.
            const acceptData = await res.json() as { battleId: string; session?: PvpSessionState };
            const battleId = acceptData.battleId;
            if (acceptData.session) setPvpSeedSession?.(acceptData.session);
            // Push acceptance notification back so the original challenger gets routed to p1
            const notified = await postPlayerChallengeNotice(challenge.fromName, { ...challenge, battleId, accepted: true, fromName: character.name, toName: challenge.fromName });
            setPvpBattleId?.(battleId);
            setPvpRole?.("p2");
            setPvpBattleContext?.({ mode: challenge.mode, clanWarPoints: challenge.clanWarPoints, sectorAttack: challenge.sectorAttack, sector: currentSector, kageChallengeId: challenge.kageChallengeId, kageVillage: challenge.kageVillage });
            setScreen("pvpBattle");
            if (!notified) alert(`${challenge.fromName} may not be pulled in automatically. Ask them to reopen the game or wait for heartbeat.`);
        } catch {
            // Refuse to fall through to the local-sim arena. That fallback
            // used to grant ranked/clan-war wins from a CLIENT-decided
            // outcome with no server session to cross-check. Better UX: keep
            // the challenge in the inbox so the player can retry once the
            // transient session-create error clears.
            // (Arena's setDuelChallenges prop takes a DuelChallenge[] directly,
            // not the functional updater form — re-add by value.)
            const stillPresent = duelChallenges.some(c => c.id === challenge.id);
            if (!stillPresent) setDuelChallenges([challenge, ...duelChallenges]);
            alert("Couldn't reach the battle server to start the duel. The challenge is still in your inbox — try accepting again in a moment.");
        }
    }

    function startTournament() {
        const participants = [character.name, ...playerRoster.map((player) => player.name)].filter((name, index, names) => names.indexOf(name) === index);
        const tournament: ArenaTournament = {
            id: `tourney-${Date.now()}`,
            name: `Weekly Arena Tournament`,
            createdBy: character.name,
            startsAt: Date.now(),
            endsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            matchDeadline: Date.now() + 24 * 60 * 60 * 1000,
            participants,
            advancedPlayers: [],
        };
        saveArenaTournament(tournament);
        setArenaTournament(tournament);
    }

    function advanceTournamentPlayer(playerName: string) {
        if (!arenaTournament) return;
        const next = { ...arenaTournament, advancedPlayers: [...arenaTournament.advancedPlayers, playerName].filter((name, index, names) => names.indexOf(name) === index) };
        saveArenaTournament(next);
        setArenaTournament(next);
    }

    function clearTournament() {
        saveArenaTournament(null);
        setArenaTournament(null);
    }

    function addCombatLog(entry: string, actionId = "system", actor = activeActor === "player" ? character.name : opponentName, actorRole: BattleActor = actor === opponentName ? "enemy" : "player") {
        setCombatLog((current) => [`Round ${turn}: ${entry}`, ...current].slice(0, 14));
        setBattleHistory((current) => [{ round: turn, actor, actorRole, actionId, description: entry, actionNumber: (current[0]?.actionNumber ?? 0) + 1, createdAt: Date.now() }, ...current].slice(0, 40));
    }

    function xy(pos: number) {
        return { x: pos % gridWidth, y: Math.floor(pos / gridWidth) };
    }

    function posFromXY(x: number, y: number) {
        if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return -1;
        return y * gridWidth + x;
    }

    function axial(pos: number) {
        const { x, y } = xy(pos);
        return { q: x, r: y - ((x - (x & 1)) / 2) };
    }

    function distance(a: number, b: number) {
        const A = axial(a);
        const B = axial(b);
        return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
    }

    function hexNeighbors(pos: number) {
        const { x, y } = xy(pos);
        const even = x % 2 === 0;
        const deltas = even
            ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
            : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
        return deltas
            .map(([dx, dy]) => posFromXY(x + dx, y + dy))
            .filter((next) => next >= 0);
    }

    function jutsuRangeTiles(jutsu: Jutsu | null | undefined) {
        if (!jutsu || isSelfCastJutsu(jutsu)) return new Set<number>();
        // Floor non-Move range to 1 — protects against malformed jutsu data
        // (range:0 from a stale save) silently disabling the targeting overlay.
        const range = isMoveJutsu(jutsu) ? moveJutsuRange(jutsu) : Math.max(1, Number(jutsu.range) || 1);
        if (range <= 0) return new Set<number>();
        return new Set(
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile)
                .filter((tile) => tile !== playerPos && distance(playerPos, tile) <= range)
        );
    }

    function jutsuAoeTiles(jutsu: Jutsu | null | undefined) {
        if (!jutsu || isGroundEffectJutsu(jutsu) || isMoveJutsu(jutsu)) return new Set<number>();
        if (!jutsuRangeTiles(jutsu).has(enemyPos)) return new Set<number>();
        return jutsuImpactPreviewTiles(
            jutsu.method,
            enemyPos,
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile),
            distance,
            hexNeighbors,
            true,
        );
    }

    function groundAffectedTiles(jutsu: Jutsu | null | undefined, groundTile: number | null) {
        if (!jutsu || !isGroundEffectJutsu(jutsu)) return new Set<number>();
        if (groundTile === null) return new Set<number>();
        const impact = jutsuImpactPreviewTiles(
            jutsu.method,
            groundTile,
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile),
            distance,
            hexNeighbors,
        );
        return impact.size > 0 ? impact : new Set([groundTile]);
    }

    function weaponRangeTiles(item: GameItem | null | undefined) {
        if (!item) return new Set<number>();
        const slot = normalizeEquipmentSlot(item.slot);
        const range = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
        if (range <= 0) return new Set<number>();
        return new Set(
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile)
                .filter((tile) => tile !== playerPos && distance(playerPos, tile) <= range)
        );
    }

    function nextStepToward(origin: number, target: number) {
        const occupied = new Set([playerPos]);
        const candidates = hexNeighbors(origin).filter((next) => !occupied.has(next));
        return candidates.sort((a, b) => distance(a, target) - distance(b, target))[0] ?? origin;
    }

    // Like nextStepToward, but with an explicit avoid-list (and barrier tiles) so a
    // THIRD unit (the summoned pet, or the enemy pathing toward the pet) doesn't
    // stack onto an occupied tile. nextStepToward hardcodes only the player's tile.
    function nextStepTowardFor(origin: number, target: number, avoid: number[]) {
        const occupied = new Set(avoid);
        const candidates = hexNeighbors(origin).filter((next) => !occupied.has(next) && !barrierTiles.some((b) => b.tile === next));
        return candidates.sort((a, b) => distance(a, target) - distance(b, target))[0] ?? origin;
    }

    // Pet displacement — the enemy's Push/Pull neighbor logic with the PET as the
    // source and the enemy as the target (shove away / drag closer, barrier-aware).
    function pushEnemyFromPet(dist: number) {
        let newPos = enemyPos;
        for (let step = 0; step < dist; step++) {
            const away = hexNeighbors(newPos).filter((t) => distance(t, petPos) > distance(newPos, petPos) && t !== petPos && t !== playerPos && !barrierTiles.some((b) => b.tile === t));
            if (away.length === 0) break;
            newPos = away[0];
        }
        if (newPos !== enemyPos) setEnemyPos(newPos);
    }
    function pullEnemyTowardPet(dist: number) {
        let newPos = enemyPos;
        for (let step = 0; step < dist; step++) {
            const closer = hexNeighbors(newPos).filter((t) => distance(t, petPos) < distance(newPos, petPos) && t !== petPos && t !== playerPos && !barrierTiles.some((b) => b.tile === t));
            if (closer.length === 0) break;
            newPos = closer[0];
        }
        if (newPos !== enemyPos) setEnemyPos(newPos);
    }

    function spendAp(cost: number, actionId = "action") {
        const adjustedCost = adjustedApCost(cost);
        if (activeActor !== "player") {
            setLog(`${opponentName} has initiative. End turn to resolve their action.`);
            addCombatLog(`${character.name} cannot act until ${opponentName}'s action resolves.`, actionId, character.name);
            return false;
        }
        if (actionsThisTurn >= 5) {
            setLog("Maximum actions reached. End your turn.");
            addCombatLog(`${character.name} has already taken 5 actions this turn.`, actionId, character.name);
            return false;
        }
        if (ap < adjustedCost) {
            setLog(`Not enough AP. Need ${adjustedCost}.`);
            addCombatLog(`${character.name} tried to act but did not have enough AP. Needed ${adjustedCost}.`, actionId, character.name);
            return false;
        }
        setAp((current) => current - adjustedCost);
        setActionsThisTurn((current) => current + 1);
        // Reset the 45-second round timer on every successful action so the
        // player's clock doesn't expire while they're mid-combo.
        setRoundTimerKey((k) => k + 1);
        // Record the action for the enemy AI's playstyle read (Phase 1 memory).
        // Coarse classification — the enemy only needs the broad shape of what the
        // player did, not the exact id. Capped to the last 8 entries.
        const jutsuForAction = equippedJutsus.find((j) => j.id === actionId);
        const itemForAction = combatEquippedItems.find((it) => it.id === actionId);
        const itemSlot = itemForAction ? normalizeEquipmentSlot(itemForAction.slot) : undefined;
        const isWeaponAction = itemSlot === "hand" || itemSlot === "thrown";
        const actionKind = classifyPlayerAction(actionId, {
            isSelfSupport: jutsuForAction ? isSelfSupportJutsu(jutsuForAction) : false,
            isWeapon: isWeaponAction,
            isItem: !!itemForAction && !isWeaponAction,
            dealtDamage: jutsuForAction ? !isSelfSupportJutsu(jutsuForAction) && jutsuForAction.effectPower > 0 : undefined,
        });
        playerActionLogRef.current = [...playerActionLogRef.current.slice(-7), { kind: actionKind, turn }];
        return true;
    }

    function summonActivePet() {
        if (!activeBattlePet) {
            setLog("No active pet selected. Choose one in the Pet Yard first.");
            return;
        }
        if (isPetOnExpedition(activeBattlePet)) {
            setLog(`${petDisplayName(activeBattlePet)} is exploring and cannot join PvE battles.`);
            return;
        }
        if (!activeBattlePet.unlockedForPve && activeBattlePet.level < 50) {
            setLog(`${petDisplayName(activeBattlePet)} must reach level 50 before it can join PvE battles.`);
            return;
        }
        if (opponentCharacter || opponentIsMerc) {
            setLog(opponentCharacter ? "Pets cannot be summoned in player-vs-player battles." : "Pets cannot be summoned against mercenaries.");
            return;
        }
        if (summonedPetId === activeBattlePet.id) {
            setLog(`${petDisplayName(activeBattlePet)} is already fighting beside you.`);
            return;
        }
        setSummonedPetId(activeBattlePet.id);
        setPetSummonedThisFight(true);
        // Place the pet on a free tile beside the player and give it its own HP +
        // lifespan so it fights as a real board actor on its own phase.
        const petSpawn = hexNeighbors(playerPos).find((t) => t !== enemyPos && !barrierTiles.some((b) => b.tile === t)) ?? playerPos;
        setPetPos(petSpawn);
        setPetHp(activeBattlePet.hp);
        setPetMaxHp(activeBattlePet.hp);
        setPetStatuses([]);
        setPetShield(0);
        setPetJutsuCooldowns({});
        setPetTurnsRemaining(PET_FIELD_TURNS);
        petActingRef.current = false;
        petPhaseStepsRef.current = 0;
        petHasAttackedRef.current = false;
        // PVE gear durability: a spent piece (durability 0) breaks before this
        // fight and gives no effect; otherwise the gear is active and ticks down
        // one summon (it still applies this fight).
        const pveId = activeBattlePet.loadout?.pve;
        const pveDur = activeBattlePet.loadout?.pveDurability ?? 0;
        const gearBroke = !!pveId && pveDur <= 0;
        const gearActive = !!pveId && pveDur > 0;
        let nextPets = character.pets;
        if (gearBroke) {
            nextPets = character.pets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, pve: undefined, pveDurability: undefined } } : p);
        } else if (gearActive) {
            nextPets = character.pets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, pveDurability: pveDur - 1 } } : p);
        }
        // Heal-on-summon (Guardian's Blessing, etc.) — only while the gear is live.
        const summonHealPct = gearActive ? petPveHealOnSummonPct(activeBattlePet) : 0;
        const heal = summonHealPct > 0 ? Math.floor(character.maxHp * summonHealPct / 100) : 0;
        // Battle consumable in PvE: reactive effects need a pet that takes hits,
        // so when summoned the pet instead spends the item to shield you.
        const consId = activeBattlePet.loadout?.consumable;
        const consHeal = consId ? Math.max(1, Math.floor(character.maxHp * PET_CONSUMABLE_PVE_HEAL_PCT / 100)) : 0;
        if (consId) nextPets = nextPets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, consumable: undefined } } : p);
        const healedFinal = Math.min(character.maxHp, playerHp + heal + consHeal);
        if (heal + consHeal > 0) setPlayerHp(healedFinal);
        updateCharacter({ ...character, hp: healedFinal, pets: nextPets });
        // `loadout` is a server-owned pet field, so the local nextPets edit above
        // is only the optimistic mirror — without this call the durability tick
        // and the consumable spend are discarded by the save and the gear never
        // actually wears out. Fire-and-forget: a failure just leaves the pet's
        // gear intact, and combat continues on the local state either way.
        void spendPetSummonCost(character.name, activeBattlePet.id);
        const brokeNote = gearBroke ? ` ${petPveGearById(pveId)?.name ?? "Its PVE gear"} has worn out and breaks.` : "";
        const healNote = heal > 0 ? ` It steadies you — +${heal} HP.` : "";
        const consNote = consHeal > 0 ? ` ${petConsumableById(consId)?.name ?? "A consumable"} shields you for +${consHeal} HP.` : "";
        setLog(`${petDisplayName(activeBattlePet)} takes the field and fights on its own each round.${healNote}${consNote}${brokeNote}`);
        addCombatLog(`${character.name} summons ${petDisplayName(activeBattlePet)}. Happiness: ${petHappiness(activeBattlePet)}%.`, "summonPet", petDisplayName(activeBattlePet));
    }

    // ── Summoned-pet phase (PvE) ──────────────────────────────────────────────
    // The pet acts on its own dedicated phase between the player's turn and the
    // enemy's (You → Pet → Enemy). It closes toward the foe by its role's
    // engagement range, then strikes — mirroring the enemy's paced multi-action
    // loop (afterEnemyAction/enemyContinue) so each sub-action reads fresh
    // committed state. Pet damage never routes through guardEnemyHit (that budget
    // is the ENEMY's per-turn cap against the player).

    // Apply a pet strike/jutsu hit to the enemy. Returns the dealt amount + whether
    // it was lethal; the caller does any follow-up (lifesteal) and calls winBattle.
    function applyPetDamageToEnemy(raw: number, opts: { crit?: boolean; sourceName: string; verb?: string }): { dealt: number; lethal: boolean } {
        if (battleEnded || enemyHp <= 0) return { dealt: 0, lethal: false };
        const capped = Math.min(raw, enemyMaxHp * PET_PHASE_DAMAGE_MAX_FRAC);
        let dmg = Math.max(1, Math.floor(capped * PET_PHASE_DAMAGE_MULT));
        let shieldNote = "";
        // Mark: the next pet hit on a marked foe deals bonus damage, then clears it.
        if (enemyStatuses.some((s) => s.name === "Mark")) {
            dmg = Math.floor(dmg * 1.3);
            setEnemyStatuses((s) => s.filter((st) => st.name !== "Mark"));
            shieldNote += " (marked!)";
        }
        if (enemyShield > 0) {
            const absorbed = Math.min(enemyShield, dmg);
            if (absorbed > 0) { setEnemyShield((s) => Math.max(0, s - absorbed)); dmg -= absorbed; shieldNote = ` (${absorbed} absorbed)`; }
        }
        const newEnemyHp = Math.max(0, enemyHp - dmg);
        setEnemyHp(newEnemyHp);
        if (dmg > 0) queueHitFx("e", dmg, "damage");
        const critNote = opts.crit ? " — CRITICAL HIT!" : "";
        const line = `${opts.sourceName} ${opts.verb ?? "attacks"} ${opponentName} for ${dmg} damage${critNote}${shieldNote}.`;
        setLog(line);
        addCombatLog(line, "petAttack", opts.sourceName);
        return { dealt: dmg, lethal: newEnemyHp <= 0 };
    }

    // The pet's basic strike (same damage core as the old summon: attack + summon
    // gear mult + speed-scaled crit + variance) plus PvE-gear lifesteal-to-player.
    function petBasicStrike(pet: Pet) {
        const petName = petDisplayName(pet);
        const enemyHpPct = (enemyHp / Math.max(1, enemyMaxHp)) * 100;
        const playerHpPct = (playerHp / Math.max(1, character.maxHp)) * 100;
        const crit = Math.random() < Math.min(0.45, 0.16 + pet.speed / 1100);
        const variance = 0.9 + Math.random() * 0.2;
        const raw = petCombatDamage(pet) * petOutgoingMult() * petPveSummonDamageMult(pet, enemyHpPct, playerHpPct) * (crit ? PET_CRIT_MULT : 1) * variance;
        const res = applyPetDamageToEnemy(raw, { crit, sourceName: petName, verb: "strikes" });
        const lsPct = petPveLifestealPct(pet);
        if (lsPct > 0 && res.dealt > 0) {
            const heal = Math.max(1, Math.floor(res.dealt * lsPct / 100));
            const healedHp = Math.min(character.maxHp, playerHp + heal);
            if (healedHp > playerHp) {
                setPlayerHp(healedHp);
                updateCharacter({ ...character, hp: healedHp });
                queueHitFx("p", heal, "heal");
            }
        }
        if (res.lethal) winBattle();
    }

    // Sum of the pet's own "Increase Damage Given" self-buffs → outgoing multiplier.
    function petOutgoingMult(): number {
        const inc = petStatuses.filter((s) => s.name === "Increase Damage Given").reduce((a, s) => a + (s.percent || 0), 0);
        return 1 + Math.min(60, inc) / 100;
    }

    // Pick a heal/shield jutsu when the pet is hurt (castable from any range).
    function pickPetSupportJutsu(pet: Pet): PetJutsu | null {
        if (petMaxHp <= 0 || petHp / petMaxHp >= 0.5) return null;
        const supportKinds = new Set(["heal", "shield", "barrier"]);
        return pet.jutsus.find((j) => supportKinds.has(j.kind) && (petJutsuCooldowns[j.name] ?? 0) <= 0) ?? null;
    }

    // Pick the pet's best offensive jutsu that's off cooldown (signature first, else
    // highest power). Self-support kinds are excluded. Null → fall back to a strike.
    function pickPetOffensiveJutsu(pet: Pet): PetJutsu | null {
        const selfKinds = new Set(["heal", "shield", "barrier", "buff", "haste", "absorb", "taunt", "move"]);
        const usable = pet.jutsus.filter((j) => !selfKinds.has(j.kind) && (petJutsuCooldowns[j.name] ?? 0) <= 0);
        if (usable.length === 0) return null;
        return usable.find((j) => j.signature) ?? usable.slice().sort((a, b) => (b.power || 0) - (a.power || 0))[0] ?? null;
    }

    // Resolve a pet jutsu against the enemy (offensive) or the pet (support) using
    // the Arena's own CombatStatus / DoT / stun / push-pull machinery, so ticking,
    // cleanse and HUD display all work for free. Exotic pet-only kinds
    // (mark/slow/haste/taunt/confuse/freeze/movelock/crush) map onto existing
    // primitives; only "Mark" is a new status (consumed in applyPetDamageToEnemy).
    function castPetJutsu(pet: Pet, j: PetJutsu) {
        const petName = petDisplayName(pet);
        setPetJutsuCooldowns((cds) => ({ ...cds, [j.name]: Math.max(1, j.cooldown || 1) }));
        const rounds = j.rounds ?? 2;
        const addEnemyStatus = (st: CombatStatus) => setEnemyStatuses((s) => capWoundStacks(mergeCombatStatus(s, st)));
        const addSelfStatus = (st: CombatStatus) => setPetStatuses((s) => mergeCombatStatus(s, st));
        const note = (extra: string) => { const line = `${petName} uses ${j.name}${extra}.`; setLog(line); addCombatLog(line, "petAttack", petName); };
        const doDamage = (scale = 1) => {
            const enemyHpPct = (enemyHp / Math.max(1, enemyMaxHp)) * 100;
            const playerHpPct = (playerHp / Math.max(1, character.maxHp)) * 100;
            const crit = Math.random() < Math.min(0.45, 0.16 + pet.speed / 1100);
            const variance = 0.9 + Math.random() * 0.2;
            const powerScale = Math.max(0.6, Math.min(1.4, (j.power || 40) / 45)) * scale;
            const raw = petCombatDamage(pet) * petOutgoingMult() * powerScale * petPveSummonDamageMult(pet, enemyHpPct, playerHpPct) * (crit ? PET_CRIT_MULT : 1) * variance;
            const res = applyPetDamageToEnemy(raw, { crit, sourceName: petName, verb: `uses ${j.name} on` });
            if (res.lethal) winBattle();
            return res;
        };
        switch (j.kind) {
            case "heal": {
                const heal = Math.max(1, Math.floor(petMaxHp * 0.25 + (j.power || 0) * 0.5));
                setPetHp((hp) => Math.min(petMaxHp, hp + heal));
                note(` and recovers ${heal} HP`);
                return;
            }
            case "shield":
            case "barrier": {
                const amt = Math.max(1, Math.floor(petMaxHp * 0.2));
                setPetShield((s) => s + amt);
                note(` and raises a ${amt} HP shield`);
                return;
            }
            case "buff":
            case "haste": {
                addSelfStatus({ name: "Increase Damage Given", rounds, percent: 25, kind: "positive" });
                note(" and steels itself (+25% damage)");
                return;
            }
            case "absorb": {
                addSelfStatus({ name: "Absorb", rounds, percent: 30, kind: "positive" });
                note(" and hardens (absorb)");
                return;
            }
            case "taunt": {
                addSelfStatus({ name: "Decrease Damage Taken", rounds, percent: 25, kind: "positive" });
                note(" and braces (−25% damage taken)");
                return;
            }
            case "move": {
                const next = nextStepTowardFor(petPos, enemyPos, [playerPos, enemyPos]);
                if (next !== petPos) setPetPos(next);
                note(" and repositions");
                return;
            }
            case "stun":
            case "freeze":
            case "movelock": {
                doDamage(0.6);
                addEnemyStatus({ name: "Stun", rounds: 1, kind: "negative" });
                return;
            }
            case "wound": {
                const res = doDamage(0.5);
                addEnemyStatus({ name: "Wound", rounds, amount: Math.max(1, Math.floor((res.dealt || petCombatDamage(pet)) * 0.4)), kind: "negative" });
                return;
            }
            case "dot":
            case "burn": {
                doDamage(0.5);
                addEnemyStatus({ name: "Poison", rounds, percent: 8, kind: "negative" });
                if (j.kind === "burn") addEnemyStatus({ name: "Decrease Damage Given", rounds, percent: 15, kind: "negative" });
                return;
            }
            case "crush": {
                doDamage(1);
                addEnemyStatus({ name: "Decrease Damage Given", rounds, percent: 25, kind: "negative" });
                return;
            }
            case "confuse":
            case "debuff":
            case "slow": {
                doDamage(0.6);
                addEnemyStatus({ name: "Decrease Damage Given", rounds, percent: j.kind === "confuse" ? 40 : 25, kind: "negative" });
                return;
            }
            case "mark": {
                doDamage(0.7);
                addEnemyStatus({ name: "Mark", rounds, kind: "negative" });
                return;
            }
            case "lifesteal": {
                const res = doDamage(1);
                if (res.dealt > 0) { const heal = Math.max(1, Math.floor(res.dealt * 0.5)); setPetHp((hp) => Math.min(petMaxHp, hp + heal)); }
                return;
            }
            case "push": {
                doDamage(0.6);
                pushEnemyFromPet(1);
                return;
            }
            case "pull": {
                doDamage(0.6);
                pullEnemyTowardPet(1);
                return;
            }
            case "damage":
            default: {
                doDamage(1);
                return;
            }
        }
    }

    // One pet sub-action: self-support if hurt, else an offensive jutsu/strike once
    // in the pet's role range, else close the distance. Returns the enemy-loop-style
    // {acted, apSpent} so afterPetAction can pace + chain via a fresh continuation.
    function petTakeAction(): { acted: boolean; apSpent: number } {
        if (battleEnded || !summonedPet || petHp <= 0 || enemyHp <= 0 || playerHp <= 0) return { acted: false, apSpent: 0 };
        const pet = summonedPet;
        if (petHasAttackedRef.current) return { acted: false, apSpent: 0 };
        const support = pickPetSupportJutsu(pet);
        if (support) {
            petHasAttackedRef.current = true;
            castPetJutsu(pet, support);
            return { acted: true, apSpent: 40 };
        }
        const atkTiles = Math.max(1, Math.round(ROLE_RANGE[petRoleOf(pet)].atkRange));
        if (distance(petPos, enemyPos) <= atkTiles) {
            petHasAttackedRef.current = true;
            const off = pickPetOffensiveJutsu(pet);
            if (off) castPetJutsu(pet, off);
            else petBasicStrike(pet);
            return { acted: true, apSpent: 40 };
        }
        if (petPhaseStepsRef.current < (pet.moveRange ?? 2)) {
            const next = nextStepTowardFor(petPos, enemyPos, [playerPos, enemyPos]);
            if (next !== petPos) {
                setPetPos(next);
                petPhaseStepsRef.current += 1;
                return { acted: true, apSpent: 30 };
            }
        }
        return { acted: false, apSpent: 0 };
    }

    function afterPetAction(res: { acted: boolean; apSpent: number }) {
        if (battleEnded) { petActingRef.current = false; return; }
        if (!res.acted || res.apSpent <= 0) { finishPetPhase(); return; }
        // Same beats as the enemy loop: a near-instant step, a readable pause on a hit.
        const beat = res.apSpent === 30 ? (combatFastRef.current ? 0 : 150) : (combatFastRef.current ? 250 : 500);
        petPhaseTimerRef.current = window.setTimeout(() => {
            petPhaseTimerRef.current = null;
            petContinueRef.current();
        }, beat);
    }

    // Scheduled continuation — runs in a fresh render so it reads committed state.
    function petContinue() {
        if (battleEnded) { petActingRef.current = false; return; }
        if (!petActingRef.current) return;
        afterPetAction(petTakeAction());
    }

    // End the pet's phase: tick its lifespan (despawn at 0), then hand off to the
    // enemy exactly once. Decrementing here means a KO'd pet naturally skips a round.
    function finishPetPhase() {
        petActingRef.current = false;
        if (petPhaseTimerRef.current !== null) { window.clearTimeout(petPhaseTimerRef.current); petPhaseTimerRef.current = null; }
        if (summonedPetId && petHp > 0) {
            // Tick the pet's own buffs + jutsu cooldowns once per round (its phase).
            setPetStatuses((s) => tickStatuses(s));
            setPetJutsuCooldowns((cds) => { const n: Record<string, number> = {}; for (const k in cds) { const v = Math.max(0, cds[k] - 1); if (v > 0) n[k] = v; } return n; });
            const remaining = petTurnsRemaining - 1;
            if (remaining <= 0) {
                const petName = summonedPet ? petDisplayName(summonedPet) : "The pet";
                setSummonedPetId("");
                setPetTurnsRemaining(0);
                setLog(`${petName} leaves the battlefield.`);
                addCombatLog(`${petName} leaves the battlefield.`, "petLeave", petName);
            } else {
                setPetTurnsRemaining(remaining);
            }
        }
        enemyTurn();
    }

    // Run the pet's whole phase. A low-happiness, non-loyal pet may disobey and
    // hold position (skipping its phase) instead of the old friendly-fire backfire.
    function runPetPhase() {
        if (petActingRef.current) return; // already resolving
        if (!isPetAlive || opponentCharacter || opponentIsMerc || battleEnded || enemyHp <= 0 || playerHp <= 0) { finishPetPhase(); return; }
        const pet = summonedPet as Pet;
        const obeys = petHappiness(pet) >= 71 || petPveLoyalty(pet) || Math.random() >= 0.35;
        if (!obeys) {
            const petName = petDisplayName(pet);
            setLog(`${petName} ignores your command and holds its position.`);
            addCombatLog(`${petName} ignores your command and holds its position.`, "petIdle", petName);
            finishPetPhase();
            return;
        }
        petActingRef.current = true;
        petPhaseStepsRef.current = 0;
        petHasAttackedRef.current = false;
        setActiveActor("enemy"); // lock player input during the animated pet phase
        afterPetAction(petTakeAction());
    }

    // Player's turn is over: run the pet phase (which chains into the enemy turn),
    // or go straight to the enemy if there's no live pet. Both waitTurn and the
    // auto-pass effect funnel through here so the order is always You → Pet → Enemy.
    function advanceAfterPlayer() {
        if (battleEnded) return;
        if (isPetAlive && !opponentCharacter && !opponentIsMerc) { runPetPhase(); return; }
        enemyTurn();
    }

    function waitTurn() {
        if (battleEnded) return;
        if (activeActor === "enemy") {
            enemyTurn();
            return;
        }
        addCombatLog(`${character.name} waits and ends their turn with ${ap} AP remaining.`, "wait", character.name);
        advanceAfterPlayer();
    }

    // (The pet now acts on its own dedicated phase via runPetPhase/advanceAfterPlayer,
    // not as a bonus attack keyed to each of the player's actions.)  

    function reduceCooldowns() {
        setCooldowns((current) => {
            const next: Record<string, number> = {};
            Object.entries(current).forEach(([key, value]) => {
                next[key] = Math.max(0, value - 1);
            });
            return next;
        });

        setJutsuCooldowns((current) => {
            const next: Record<string, number> = {};
            Object.entries(current).forEach(([key, value]) => {
                next[key] = Math.max(0, value - 1);
            });
            return next;
        });

        setEnemyJutsuCooldowns((current) => {
            const next: Record<string, number> = {};
            Object.entries(current).forEach(([key, value]) => {
                next[key] = Math.max(0, value - 1);
            });
            return next;
        });
    }

    function tickStatuses(statuses: CombatStatus[]) {
        return statuses
            .map((s) => ({ ...s, rounds: s.rounds - 1 }))
            .filter((s) => s.rounds > 0);
    }

    function withoutStun(statuses: CombatStatus[]) {
        return statuses.filter((s) => s.name !== "Stun");
    }
    function activeStatuses(statuses: CombatStatus[]) {
        return statuses.filter((status) => (status.activeRound ?? turn) <= turn);
    }
    // Sum the percents of every active stack of a status. Absorb/Reflect/Lifesteal
    // stack additively and the total is hard-capped at 60% by cappedPostDamage.
    // A single stack sums to itself, so this is behaviour-preserving for one stack.
    function sumActiveStatusPct(statuses: CombatStatus[], name: string, fallback = 30): number {
        return activeStatuses(statuses)
            .filter((s) => s.name === name)
            .reduce((sum, s) => sum + (s.percent || fallback), 0);
    }
    // Tags resolve next round for ALL jutsus except INSTANT_EFFECT ground-zone jutsus.
    function bloodlineTagsResolveNextRound(jutsu: Pick<Jutsu, "bloodlineRank" | "target" | "method">) {
        return !(jutsu.target === "EMPTY_GROUND" && jutsu.method === "INSTANT_EFFECT");
    }
    function statusForJutsu(jutsu: Pick<Jutsu, "bloodlineRank" | "target" | "method">, status: CombatStatus): CombatStatus {
        return bloodlineTagsResolveNextRound(jutsu) ? { ...status, rounds: status.rounds + 1, activeRound: turn + 1 } : status;
    }
    // HUD display only: a deferred (not-yet-active) status carries an extra +1
    // round (statusForJutsu) so it survives the unconditional end-of-turn tick.
    // That buffer must not show to the player — on the cast turn a 2-round buff
    // would otherwise read "3r". Subtract it for not-yet-active statuses so the
    // counter matches PvP and the move's intent. Gameplay/ticking are untouched.
    function displayStatuses(statuses: CombatStatus[]): CombatStatus[] {
        return statuses.map((s) =>
            s.activeRound != null && s.activeRound > turn ? { ...s, rounds: Math.max(1, s.rounds - 1) } : s,
        );
    }
    function isMoveJutsu(jutsu: Pick<Jutsu, "target" | "tags">) {
        return jutsu.tags.some((tag) => tagMatchesName(tag.name, "Move"));
    }

    function isGroundEffectJutsu(jutsu: Pick<Jutsu, "target" | "tags">) {
        return jutsu.target === "EMPTY_GROUND" && !isMoveJutsu(jutsu);
    }

    // A jutsu is self-cast (heal/shield/buff) when it isn't a Move/ground jutsu
    // AND it either declares SELF or touches no opponent (no damage + no
    // opponent-affecting tag). Mirrors PvP's pvpIsSelfTargetJutsu
    // (PvpBattleScreen.tsx via lib/tags pvpAffectsOpponent) so PvE and PvP agree:
    // a self-cast jutsu ARMS and is confirmed by clicking your OWN ninja, instead
    // of instant-firing the moment the card is clicked.
    function isSelfCastJutsu(jutsu: Jutsu | null | undefined) {
        return Boolean(jutsu) && !isMoveJutsu(jutsu!) && !isGroundEffectJutsu(jutsu!) &&
            (jutsu!.target === "SELF" || !pvpAffectsOpponent(jutsu!));
    }

    function battleGroundEffectClass(jutsu: Jutsu | null | undefined, tileUse: "target" | "affected") {
        if (!jutsu) return "";
        const tagNames = new Set((jutsu.tags ?? []).map(tag => normalizeTagName(tag.name)));
        const element = jutsu.element;
        if (tileUse === "target" && tagNames.has("Move")) return " ground-effect-move";
        if (tagNames.has("Poison") || tagNames.has("Drain") || tagNames.has("Siphon")) return " ground-effect-poison";
        if (tagNames.has("Ignition") || element === "Fire") return " ground-effect-fire";
        if (tagNames.has("Stun") || tagNames.has("Lag") || tagNames.has("Overclock") || element === "Lightning") return " ground-effect-lightning";
        if (tagNames.has("Shield") || tagNames.has("Barrier") || tagNames.has("Absorb") || tagNames.has("Reflect") || tagNames.has("Decrease Damage Taken")) return " ground-effect-guard";
        if (element === "Water") return " ground-effect-water";
        if (element === "Earth") return " ground-effect-earth";
        if (element === "Wind") return " ground-effect-wind";
        return " ground-effect-force";
    }

    function groundTargetCatchesEnemy(jutsu: Pick<Jutsu, "method">, tile: number) {
        return tile === enemyPos ||
            (jutsu.method === "AOE_CIRCLE" && hexNeighbors(tile).includes(enemyPos)) ||
            (jutsu.method === "INSTANT_EFFECT" && hexNeighbors(tile).includes(enemyPos));
    }

    function groundTargetRelocatesUser(jutsu: Pick<Jutsu, "target" | "method" | "tags">) {
        return jutsu.target === "EMPTY_GROUND" && isMoveJutsu(jutsu);
    }

    function moveJutsuRange(jutsu: Pick<Jutsu, "range">) {
        return Math.max(1, Number(jutsu.range) || 1);
    }

    function activeBloodlineMultiplier(attacker: Character | null | undefined, statuses: CombatStatus[]) {
        if (!attacker || activeStatuses(statuses).some((status) => status.name === "Bloodline Seal" || status.name === "Seal")) return 1.0;
        return getBloodlineMultiplier(attacker, savedBloodlines);
    }

    function handleTileClick(tile: number) {
        if (battleEnded) return;

        if (pendingTargetWeapon) {
            if (tile === enemyPos) {
                const weapon = pendingTargetWeapon;
                setPendingTargetWeaponRaw(null);
                activateCombatWeapon(weapon);
            } else {
                setLog(`Select ${opponentName} to attack with ${pendingTargetWeapon.name}.`);
            }
            return;
        }

        // Move+AOE_CIRCLE: player moves to the tile then damages the adjacent ring.
        // Validation mirrors pure-move but delegates resource/damage to castJutsu.
        if (pendingTargetJutsu && isMoveJutsu(pendingTargetJutsu) && pendingTargetJutsu.method === "AOE_CIRCLE") {
            if (tile === enemyPos) { setLog(`${pendingTargetJutsu.name}: choose a landing tile, not the enemy.`); return; }
            if (tile === playerPos) { setLog(`${pendingTargetJutsu.name}: choose a different tile.`); return; }
            if (barrierTiles.some((b) => b.tile === tile)) { setLog("A barrier wall blocks that tile."); return; }
            const dist = distance(playerPos, tile);
            const moveRange = moveJutsuRange(pendingTargetJutsu);
            if (dist < 1 || dist > moveRange) { setLog(`${pendingTargetJutsu.name} can move up to ${moveRange} tile(s).`); return; }
            castJutsu(pendingTargetJutsu, true, tile);
            return;
        }

        if (pendingTargetJutsu && isMoveJutsu(pendingTargetJutsu)) {
            if (tile === enemyPos) {
                setLog(`${pendingTargetJutsu.name}: choose an open tile, not the enemy.`);
                return;
            }

            if (tile === playerPos) {
                setLog(`${pendingTargetJutsu.name}: choose a different open tile.`);
                return;
            }

            if (barrierTiles.some((b) => b.tile === tile)) {
                setLog("A barrier wall blocks that tile.");
                return;
            }

            const dist = distance(playerPos, tile);
            const moveRange = moveJutsuRange(pendingTargetJutsu);

            if (dist < 1 || dist > moveRange) {
                setLog(`${pendingTargetJutsu.name} can move up to ${moveRange} tile(s).`);
                return;
            }

            if ((jutsuCooldowns[pendingTargetJutsu.id] ?? 0) > 0) {
                setLog(`${pendingTargetJutsu.name} cooldown: ${jutsuCooldowns[pendingTargetJutsu.id]} rounds.`);
                return;
            }

            const mastery = getJutsuMastery(character, pendingTargetJutsu.id);
            const scaled = scaleJutsuCostsForCharacter(pendingTargetJutsu, mastery.level, character);

            if (activeStatuses(playerStatuses).some((s) => s.name === "Elemental Seal") && pendingTargetJutsu.element && pendingTargetJutsu.element !== "None") {
                setLog(`${pendingTargetJutsu.element} jutsu is sealed.`);
                return;
            }

            if (character.hp <= scaled.healthCost) {
                setLog("Not enough health.");
                return;
            }

            if (character.chakra < scaled.chakraCost) {
                setLog("Not enough chakra.");
                return;
            }

            if (character.stamina < scaled.staminaCost) {
                setLog("Not enough stamina.");
                return;
            }

            if (!spendAp(pendingTargetJutsu.ap, pendingTargetJutsu.id)) return;

            setPlayerPos(tile);
            setPendingTargetJutsuId("");
            setSelectedActionId(undefined);
            setJutsuCooldowns((c) => ({ ...c, [pendingTargetJutsu.id]: pendingTargetJutsu.cooldown }));

            // combatResourcesV2: Poison feeds on exertion — this move/ground cast spends.
            const movePoisonPct = COMBAT_RESOURCES_V2 ? sumActiveStatusPct(playerStatuses, "Poison", 6) : 0;
            const movePoisonDmg = movePoisonPct > 0 ? v2PoisonOnSpend((scaled.chakraCost || 0) + (scaled.staminaCost || 0), movePoisonPct) : 0;
            if (movePoisonDmg > 0) { setPlayerHp((hp) => Math.max(0, hp - movePoisonDmg)); queueHitFx("p", movePoisonDmg, "damage"); addCombatLog(`Poison: ${character.name} takes ${movePoisonDmg} damage from exertion.`, "effects", character.name); }

            updateCharacter({
                ...character,
                hp: Math.max(0, character.hp - scaled.healthCost - movePoisonDmg),
                chakra: Math.max(0, character.chakra - scaled.chakraCost),
                stamina: Math.max(0, character.stamina - scaled.staminaCost),
            });

            const flavorText = interpolateFlavor(
                pendingTargetJutsu.battleDescription?.trim() ||
                pendingTargetJutsu.description?.trim() ||
                `${character.name} shifts across the battlefield.`,
                character.name, opponentName);

            setLog(`${pendingTargetJutsu.name}: moved ${dist} tile(s).`);

            addCombatLog(
                `${pendingTargetJutsu.name}: ${flavorText} Move: ${character.name} relocates ${dist} tile(s) to an open tile.`,
                pendingTargetJutsu.id,
                character.name
            );

            return;
        }

        if (pendingTargetJutsu && isGroundEffectJutsu(pendingTargetJutsu)) {
            if (tile === enemyPos) {
                setLog(`${pendingTargetJutsu.name}: choose an open ground tile, not ${opponentName}.`);
                return;
            }
            if (tile === playerPos) {
                setLog(`${pendingTargetJutsu.name}: choose a different ground tile.`);
                return;
            }
            if (barrierTiles.some((b) => b.tile === tile)) {
                setLog("A barrier wall blocks that tile.");
                return;
            }
            const range = Math.max(0, Number(pendingTargetJutsu.range) || 0);
            if (range > 0 && distance(playerPos, tile) > range) {
                setLog(`${pendingTargetJutsu.name} needs range ${range}.`);
                return;
            }
            castJutsu(pendingTargetJutsu, true, tile);
            return;
        }

        // Self-cast jutsu (heal/shield/buff): confirmed by clicking your OWN ninja,
        // matching PvP's arm-then-click-self flow. A click anywhere else just nudges.
        if (pendingTargetJutsu && isSelfCastJutsu(pendingTargetJutsu)) {
            if (tile === playerPos) {
                castJutsu(pendingTargetJutsu, true, playerPos);
            } else {
                setLog(`Click yourself to cast ${pendingTargetJutsu.name}, or cancel the jutsu.`);
            }
            return;
        }

        if (pendingTargetJutsu && tile === enemyPos) {
            castJutsu(pendingTargetJutsu, true, tile);
            return;
        }

        if (pendingTargetJutsu && tile !== enemyPos) {
            setLog(`Choose ${opponentName} for ${pendingTargetJutsu.name}, or cancel the jutsu.`);
            return;
        }

        if (tile === enemyPos) {
            setLog("Select a jutsu first, then choose this target.");
            return;
        }

        const dist = distance(playerPos, tile);

        if (dist !== 1) {
            setLog("Normal movement is 1 tile at a time.");
            return;
        }

        if (barrierTiles.some((b) => b.tile === tile)) {
            setLog("A barrier wall blocks that tile.");
            return;
        }

        if (!spendAp(30, "move")) return;

        setPlayerPos(tile);
        setSelectedActionId(undefined);
        setPendingTargetJutsuId("");
        setLog("Moved 1 tile for 30 AP.");
        addCombatLog(`${character.name} moves 1 tile for 30 AP.`, "move", character.name);
    }

    function basicAttack() {
        if (battleEnded) return;
        setPendingTargetJutsuId("");
        if (distance(playerPos, enemyPos) > 1) {
            setLog("Basic Attack must be adjacent.");
            return;
        }

        if (character.stamina < 10) return setLog("Basic Attack needs 10 stamina.");
        if (!spendAp(40, "basicAttack")) return;
        playPetSfx("hit"); // combat SFX — gated by the master mute (silent by default)
        if (isAcademySpar && !sparAttacked) setSparAttacked(true); // tutorial banner only

        const basicAttackJutsu = makeJutsu("basic-attack", "Basic Attack", character.specialty, 40, 1, 10, 0, 0, 10, [{ name: "Damage", percent: 10 }], "Earth");
        let damage = calculateDamage(
            basicAttackJutsu,
            characterCombatStats,
            enemyCombatStats,
            enemyMaxHp,
            activeBloodlineMultiplier(character, playerStatuses),
            enemyArmorFactor,
            playerItemMult,
            weatherDamageMultiplier(basicAttackJutsu) * territoryDamageMultiplier(basicAttackJutsu) * biomeTerrainMultiplier(basicAttackJutsu),
            // ACTIVE statuses only — raw arrays let a just-cast (deferred,
            // "starting next round") amp/debuff boost this same attack.
            activeStatuses(playerStatuses),
            activeStatuses(enemyStatuses),
            // Basic attack has no trained mastery — match PvP (move.ts uses
            // mastery 0), not calculateDamage's default of max level.
            0,
        );
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }
        const blocked = Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        const basicLsHeal = equippedLifeStealPercent > 0 ? Math.floor(cappedPostDamage(finalDamage, equippedLifeStealPercent)) : 0;
        // Honor the player's Lifesteal / Recoil STATUS (from a jutsu buff/debuff),
        // not just item lifesteal — matches castJutsu. Recoil makes the attacker
        // take a cut of their own damage.
        const activeP = activeStatuses(playerStatuses);
        const lsStatusPct = activeP.filter((s) => s.name === "Lifesteal").reduce((sum, s) => sum + (s.percent ?? 0), 0);
        const statusLsHeal = lsStatusPct > 0 && finalDamage > 0 ? Math.floor(cappedPostDamage(finalDamage, lsStatusPct)) : 0;
        const recoilStatus = activeP.find((s) => s.name === "Recoil");
        const recoilDmg = recoilStatus && finalDamage > 0 ? Math.floor(cappedPostDamage(finalDamage, recoilStatus.percent ?? 30)) : 0;
        const basicHeal = basicLsHeal + statusLsHeal;

        const { net: enemyNet, reflected: enemyReflected, absorbed: enemyAbsorbed } = enemyDefenseFor(finalDamage);
        const basicSelfDamage = recoilDmg + enemyReflected;
        setEnemyShield((s) => Math.max(0, s - blocked));
        setEnemyHp((hp) => Math.max(0, Math.min(enemyMaxHp, hp - enemyNet)));
        queueHitFx("e", enemyNet, "damage");
        if (basicHeal > 0 || basicSelfDamage > 0) setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + basicHeal - basicSelfDamage)));
        queueHitFx("p", basicSelfDamage, "damage");
        queueHitFx("p", basicHeal, "heal");

        addCombatLog(
            `Basic Attack: ${character.name} hits ${opponentName} for ${enemyNet} damage.${blocked ? ` Enemy shield blocks ${blocked}.` : ""}${enemyAbsorbed > 0 ? ` Absorb: ${opponentName} absorbs ${enemyAbsorbed} damage.` : ""}${enemyReflected > 0 ? ` Reflect: ${opponentName} returns ${enemyReflected} damage.` : ""}${statusLsHeal > 0 ? ` Lifesteal restores ${statusLsHeal} HP.` : ""}${basicLsHeal > 0 ? ` Gear lifesteal restores ${basicLsHeal} HP.` : ""}${recoilDmg > 0 ? ` Recoil: ${character.name} takes ${recoilDmg} damage.` : ""}`,
            "basicAttack",
            character.name
        );

        if (enemyHp - enemyNet <= 0) return winBattle({ ...character, stamina: Math.max(0, character.stamina - 10) });

        // Player can kill THEMSELVES via Recoil + the enemy's Reflect on their own
        // swing — register the defeat instead of silently dropping to 0 HP.
        if (playerHp + basicHeal - basicSelfDamage <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} fell to recoil/reflected damage.`);
            addCombatLog(`${character.name} is defeated by recoil/reflected damage.`, "defeat", opponentName);
            if (rankedBattleActive) applyRankedLoss();
            else updateCharacter({ ...character, hp: 0, hospitalized: true });
            return;
        }

        updateCharacter({ ...character, stamina: Math.max(0, character.stamina - 10) });
        setLog(`Basic Attack hit for ${finalDamage} damage.`);
    }

    function itemBonusTotal(item: GameItem) {
        return Object.values(item.bonuses).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
    }

    function combatItemSummary(item: GameItem) {
        const lines = Object.entries(item.bonuses)
            .filter(([, value]) => Number(value) !== 0)
            .map(([stat, value]) => `${stat.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} +${value}`);
        if (item.weaponEp) lines.unshift(`EP ${item.weaponEp}`);
        if (item.weaponEffect) lines.push(`${item.weaponEffect} ${item.weaponEffectValue}${item.weaponEffect === "Shield" ? " HP" : "%"}`);
        if (item.weaponCooldown) lines.push(`${item.weaponCooldown}-round cooldown`);
        if (item.weaponElement) lines.push(`Requires ${item.weaponElement}`);
        return lines.length ? lines.join(" | ") : "No combat bonus";
    }

    function activateCombatWeapon(item: GameItem) {
        if (battleEnded) return;
        setPendingTargetJutsuId("");
        setPendingTargetWeaponRaw(null);
        setSelectedActionId(undefined);

        if (item.weaponElement && !hasCharacterElement(character, item.weaponElement)) {
            setLog(`${item.name} requires the ${item.weaponElement} element.`);
            return;
        }

        // Hand/thrown weapons cool down between uses. Catalog weapons set this
        // explicitly (CD 5); forged "named weapons", forged hand-slot gauntlets, and
        // older admin weapons can omit it — fall back to the standard 5-round weapon
        // cooldown so none are spammable (covers weapons already crafted into saves).
        // Keep the default in sync with the PvP server (api/pvp/move.ts). An explicit
        // 0 is honoured (?? only fills null/undefined).
        const weaponCd = item.weaponCooldown ?? 5;
        if (weaponCd > 0 && (jutsuCooldowns[item.id] ?? 0) > 0) {
            setLog(`${item.name} is on cooldown: ${jutsuCooldowns[item.id]} round(s) remaining.`);
            return;
        }

        const slot = normalizeEquipmentSlot(item.slot);
        const isThrown = slot === "thrown";
        const range = item.weaponRange ?? (isThrown ? 4 : 1);
        const apCost = item.apCost ?? 40;
        const staminaCost = isThrown ? 8 : 10;

        // Throwables are spent from inventory on each throw — block when empty.
        if (isThrown && countItem(character, item.id) <= 0) {
            setLog(`Out of ${item.name}.`);
            return;
        }

        if (distance(playerPos, enemyPos) > range) {
            setLog(`${item.name} needs range ${range}. Move closer or use a longer range option.`);
            return;
        }

        if (character.stamina < staminaCost) {
            setLog(`${item.name} needs ${staminaCost} stamina.`);
            return;
        }

        if (!spendAp(apCost, item.id)) return;

        const ep = item.weaponEp ?? Math.floor(22 + characterCombatStats.strength * 0.18 + characterCombatStats.bukijutsuOffense * 0.1 + itemBonusTotal(item) * 0.18);
        const weaponJutsu = makeJutsu(`item-${item.id}`, item.name, "Bukijutsu", apCost, range, ep, 0, 0, staminaCost, [{ name: "Damage", percent: 100 }], item.weaponElement ?? "None");
        const weaponBloodlineMultiplier = item.weaponElement && hasCharacterElement(character, item.weaponElement)
            ? activeBloodlineMultiplier(character, playerStatuses)
            : 1;
        let damage = calculateDamage(
            weaponJutsu,
            characterCombatStats,
            enemyCombatStats,
            enemyMaxHp,
            weaponBloodlineMultiplier,
            enemyArmorFactor,
            playerItemMult,
            weatherDamageMultiplier(weaponJutsu) * territoryDamageMultiplier(weaponJutsu) * biomeTerrainMultiplier(weaponJutsu),
            // ACTIVE statuses only — see basic-attack note (deferred amps must
            // not boost the attack they were cast alongside).
            activeStatuses(playerStatuses),
            activeStatuses(enemyStatuses),
            // Weapon has no trained jutsu mastery — match PvP (mastery 0).
            0,
        );
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }

        // A weaponTags "Pierce" makes the strike true damage — bypass the enemy
        // shield (and, below, enemy Absorb/Reflect). Previously Pierce only logged.
        const weaponPierce = item.weaponTags?.some((t) => t.name === "Pierce") ?? false;
        const blocked = weaponPierce ? 0 : Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        const weaponLsHeal = equippedLifeStealPercent > 0 ? Math.floor(cappedPostDamage(finalDamage, equippedLifeStealPercent)) : 0;
        const effectVal = item.weaponEffectValue ?? 0;

        const effectLines: string[] = [];
        if (item.weaponEffect === "Absorb") {
            setPlayerStatuses((s) => [...s, { name: "Absorb", rounds: 2, percent: effectVal, kind: "positive" }]);
            effectLines.push(`Absorb: ${character.name} converts ${effectVal}% incoming damage into healing for 2 rounds.`);
        }
        if (item.weaponEffect === "Lifesteal") {
            // Match PvP/jutsu Lifesteal: apply a 2-round status that heals a % of
            // damage dealt on subsequent attacks (was a one-time instant heal).
            setPlayerStatuses((s) => mergeCombatStatus(s, { name: "Lifesteal", rounds: 2, percent: effectVal, kind: "positive" }));
            effectLines.push(`Lifesteal: ${character.name} will heal ${effectVal}% of damage dealt for 2 rounds.`);
        }
        if (item.weaponEffect === "Reflect") {
            setPlayerStatuses((s) => [...s, { name: "Reflect", rounds: 2, percent: effectVal, kind: "positive" }]);
            effectLines.push(`Reflect: ${character.name} reflects ${effectVal}% damage for 2 rounds.`);
        }
        if (item.weaponEffect === "Increase Damage Given") {
            setPlayerStatuses((s) => [...s, { name: "Increase Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: effectVal, kind: "positive" }]);
            effectLines.push(`Increase Damage Given: ${character.name}'s next attacks deal ${effectVal}% more damage for 2 rounds.`);
        }
        if (item.weaponEffect === "Decrease Damage Given") {
            setEnemyStatuses((s) => [...s, { name: "Decrease Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: effectVal, kind: "negative" }]);
            effectLines.push(`Decrease Damage Given: ${opponentName} deals ${effectVal}% less damage for 2 rounds.`);
        }
        if (item.weaponEffect === "Shield") {
            setPlayerShield((s) => s + effectVal);
            effectLines.push(`Shield: ${character.name} gains ${effectVal} shield.`);
        }
        if (item.weaponEffect === "Wound") {
            setEnemyStatuses((s) => capWoundStacks([...s, { name: "Wound", rounds: 2, amount: effectVal, kind: "negative" }]));
            effectLines.push(`Wound: ${opponentName} takes ${effectVal} damage per round for 2 rounds.`);
        }
        if (item.weaponEffect === "Poison") {
            setEnemyStatuses((s) => mergeCombatStatus(s, { name: "Poison", rounds: 2, percent: effectVal, kind: "negative" }));
            effectLines.push(COMBAT_RESOURCES_V2
                ? `Poison: ${opponentName} is poisoned for 2 rounds — casting jutsu will hurt.`
                : `Poison: ${opponentName} is poisoned — takes ${effectVal}% chakra as damage per round for 2 rounds.`);
        }

        // Named Weapon: apply weaponTags array (same logic as weaponEffect but iterated)
        if (item.weaponTags && item.weaponTags.length > 0) {
            for (const wt of item.weaponTags) {
                const p = wt.percent;
                if (wt.name === "Absorb") {
                    setPlayerStatuses((s) => [...s, { name: "Absorb", rounds: 2, percent: p, kind: "positive" }]);
                    effectLines.push(`Absorb ${p}%`);
                } else if (wt.name === "Lifesteal") {
                    // Match PvP/jutsu Lifesteal: 2-round status that heals a % of
                    // damage dealt on subsequent attacks (was a one-time instant heal).
                    setPlayerStatuses((s) => mergeCombatStatus(s, { name: "Lifesteal", rounds: 2, percent: p, kind: "positive" }));
                    effectLines.push(`Lifesteal: ${character.name} will heal ${p}% of damage dealt for 2 rounds.`);
                } else if (wt.name === "Siphon") {
                    // Siphon stays an instant one-time heal off this swing (per its tooltip).
                    const ls = Math.floor(cappedPostDamage(finalDamage, p));
                    if (ls > 0) { setPlayerHp((hp) => Math.min(character.maxHp, hp + ls)); effectLines.push(`Siphon +${ls} HP`); }
                } else if (wt.name === "Reflect") {
                    setPlayerStatuses((s) => [...s, { name: "Reflect", rounds: 2, percent: p, kind: "positive" }]);
                    effectLines.push(`Reflect ${p}%`);
                } else if (wt.name === "Shield" || wt.name === "Barrier") {
                    // Use the same flat shield/heal magnitudes as jutsu (was a tiny
                    // finalDamage-scaled shield / a hardcoded 200-400 heal).
                    setPlayerShield((s) => s + SHIELD_FLAT_PVE);
                    effectLines.push(`Shield +${SHIELD_FLAT_PVE}`);
                } else if (wt.name === "Heal") {
                    setPlayerHp((hp) => Math.min(character.maxHp, hp + HEAL_FLAT_PVE));
                    effectLines.push(`Heal +${HEAL_FLAT_PVE} HP`);
                } else if (wt.name === "Wound") {
                    setEnemyStatuses((s) => capWoundStacks([...s, { name: "Wound", rounds: 2, amount: Math.floor(finalDamage * (p / 100)), kind: "negative" }]));
                    effectLines.push(`Wound ${p}%`);
                } else if (wt.name === "Poison") {
                    setEnemyStatuses((s) => mergeCombatStatus(s, { name: "Poison", rounds: 2, percent: p, kind: "negative" }));
                    effectLines.push(`Poison ${p}%`);
                } else if (tagMatchesName(wt.name, "Ignition")) {
                    setEnemyStatuses((s) => [...s, { name: "Ignition", rounds: 2, percent: p, kind: "negative" }]);
                    effectLines.push(`Ignition ${p}%`);
                } else if (wt.name === "Drain") {
                    // Drain ticks read `amount` (fallback 250); store a real amount so
                    // the weapon's percent isn't silently flattened to 250.
                    const drainAmt = drainTickPVE(character.level);
                    setEnemyStatuses((s) => mergeCombatStatus(s, { name: "Drain", rounds: 2, amount: drainAmt, kind: "negative" }));
                    effectLines.push(`Drain ${drainAmt}/round`);
                } else if (wt.name === "Increase Damage Given") {
                    setPlayerStatuses((s) => [...s, { name: "Increase Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: p, kind: "positive" }]);
                    effectLines.push(`+${p}% Damage Given`);
                } else if (wt.name === "Increase Generals") {
                    // Self-buff: raises str/spd/int/wil (read by generalsBonusFromStatuses
                    // in calculateDamage). Mirrors the Increase Damage Given weapon branch.
                    setPlayerStatuses((s) => [...s, { name: "Increase Generals", rounds: AMP_STATUS_ROUNDS_PVE, percent: p, kind: "positive" }]);
                    effectLines.push(`+${p}% General stats`);
                } else if (wt.name === "Decrease Damage Taken") {
                    setPlayerStatuses((s) => [...s, { name: "Decrease Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: p, kind: "positive" }]);
                    effectLines.push(`-${p}% Damage Taken`);
                } else if (wt.name === "Pierce") {
                    effectLines.push(`Pierce`);
                } else if (wt.name === "Damage") {
                    effectLines.push(`+${p}% Damage`);
                } else if (wt.name === "Recoil") {
                    setEnemyStatuses((s) => mergeCombatStatus(s, { name: "Recoil", rounds: 2, percent: p, kind: "negative" }));
                    effectLines.push(`Recoil ${p}%`);
                } else if (wt.name === "Stun Prevent" || wt.name === "Debuff Prevent") {
                    setPlayerStatuses((s) => mergeCombatStatus(s, { name: wt.name, rounds: 2, percent: p, kind: "positive" }));
                    effectLines.push(`${wt.name}`);
                } else if (wt.name === "Copy") {
                    const copied = activeStatuses(enemyStatuses).filter((st) => st.kind === "positive");
                    if (copied.length) setPlayerStatuses((s) => copied.reduce((acc, c) => mergeCombatStatus(acc, { ...c, rounds: Math.min(2, c.rounds) }), s));
                    effectLines.push(`Copy ${copied.length} buff(s)`);
                } else if (wt.name === "Mirror") {
                    const mirrored = activeStatuses(playerStatuses).filter((st) => st.kind === "negative" && st.name !== "Wound" && !statusMatchesName(st, "Ignition"));
                    if (mirrored.length) setEnemyStatuses((s) => mirrored.reduce((acc, m) => mergeCombatStatus(acc, { ...m, rounds: Math.min(2, m.rounds) }), s));
                    effectLines.push(`Mirror ${mirrored.length} debuff(s)`);
                }
            }
        }

        // Honor the player's Lifesteal / Recoil STATUS (jutsu buff/debuff) on weapon
        // hits too — item lifesteal (weaponLsHeal / weaponTags) is handled above.
        const activeWp = activeStatuses(playerStatuses);
        const wLsStatusPct = activeWp.filter((s) => s.name === "Lifesteal").reduce((sum, s) => sum + (s.percent ?? 0), 0);
        const wStatusLsHeal = wLsStatusPct > 0 && finalDamage > 0 ? Math.floor(cappedPostDamage(finalDamage, wLsStatusPct)) : 0;
        const wRecoilStatus = activeWp.find((s) => s.name === "Recoil");
        const wRecoilDmg = wRecoilStatus && finalDamage > 0 ? Math.floor(cappedPostDamage(finalDamage, wRecoilStatus.percent ?? 30)) : 0;
        const wHeal = weaponLsHeal + wStatusLsHeal;
        const { net: wEnemyNet, reflected: wEnemyReflected, absorbed: wEnemyAbsorbed } = enemyDefenseFor(finalDamage, weaponPierce);
        const wSelfDamage = wRecoilDmg + wEnemyReflected;
        setEnemyShield((shieldValue) => Math.max(0, shieldValue - blocked));
        setEnemyHp((hp) => Math.max(0, Math.min(enemyMaxHp, hp - wEnemyNet)));
        queueHitFx("e", wEnemyNet, "damage");
        if (wHeal > 0 || wSelfDamage > 0) setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + wHeal - wSelfDamage)));
        queueHitFx("p", wSelfDamage, "damage");
        queueHitFx("p", wHeal, "heal");
        triggerWeaponCombatFx(item, {
            focusPos: enemyPos,
            casterPos: playerPos,
            heavy: wEnemyNet >= enemyMaxHp * 0.18,
            isKO: enemyHp - wEnemyNet <= 0,
        });
        // Spend one thrown weapon from inventory on the throw (melee weapons aren't consumed).
        const afterThrow = isThrown ? removeItem(character, item.id, 1) : character;
        const postThrowCharacter: Character = { ...afterThrow, stamina: Math.max(0, afterThrow.stamina - staminaCost) };
        updateCharacter(postThrowCharacter);

        if (weaponCd > 0) setJutsuCooldowns((c) => ({ ...c, [item.id]: weaponCd }));

        const effectSuffix = effectLines.length ? ` ${effectLines.join(" ")}` : "";
        addCombatLog(`${item.name}: ${character.name} uses ${item.name} for ${wEnemyNet} damage.${blocked ? ` Enemy shield blocks ${blocked}.` : ""}${wEnemyAbsorbed > 0 ? ` Absorb: ${opponentName} absorbs ${wEnemyAbsorbed} damage.` : ""}${wEnemyReflected > 0 ? ` Reflect: ${opponentName} returns ${wEnemyReflected} damage.` : ""}${wStatusLsHeal > 0 ? ` Lifesteal restores ${wStatusLsHeal} HP.` : ""}${weaponLsHeal > 0 ? ` Gear lifesteal restores ${weaponLsHeal} HP.` : ""}${effectSuffix}`, item.id, character.name);

        if (enemyHp - wEnemyNet <= 0) return winBattle(postThrowCharacter);

        // Player self-KO via Recoil + enemy Reflect on their own swing.
        if (playerHp + wHeal - wSelfDamage <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} fell to recoil/reflected damage.`);
            addCombatLog(`${character.name} is defeated by recoil/reflected damage.`, "defeat", opponentName);
            if (rankedBattleActive) applyRankedLoss();
            else updateCharacter({ ...character, hp: 0, hospitalized: true });
            return;
        }

        setLog(`${item.name} hit for ${finalDamage} damage.${effectLines.length ? " " + effectLines[0] : ""}`);
    }

    function activateCombatItem(item: GameItem) {
        if (battleEnded) return;
        // Consumables/potions are spent from inventory — refuse when out of stock
        // (or, for the potion, once the per-battle sip cap is reached).
        if (!canUseCombatItem(item)) {
            setLog(countItem(character, item.id) <= 0
                ? `Out of ${item.name}.`
                : `${item.name} can only be used ${POTION_USES_PER_BATTLE}× per battle.`);
            return;
        }
        setPendingTargetJutsuId("");
        setSelectedActionId(undefined);

        const apCost = item.apCost ?? 35;
        if (!spendAp(apCost, item.id)) return;

        const maxHpBonus = Number(item.bonuses.maxHp) || 0;
        const maxChakraBonus = Number(item.bonuses.maxChakra) || 0;
        const maxStaminaBonus = Number(item.bonuses.maxStamina) || 0;
        const defensiveBonus = (Number(item.bonuses.taijutsuDefense) || 0) + (Number(item.bonuses.ninjutsuDefense) || 0) + (Number(item.bonuses.genjutsuDefense) || 0) + (Number(item.bonuses.bukijutsuDefense) || 0);
        const offensiveBonus = (Number(item.bonuses.strength) || 0) + (Number(item.bonuses.bukijutsuOffense) || 0) + (Number(item.bonuses.taijutsuOffense) || 0) + (Number(item.bonuses.ninjutsuOffense) || 0) + (Number(item.bonuses.genjutsuOffense) || 0);

        const heal = Math.max(maxHpBonus > 0 ? Math.floor(maxHpBonus * 0.35) : 0, item.armorQuality ? Math.floor(character.maxHp * 0.06) : 0);
        // Flat potion restore (restoreChakra/restoreStamina) is added on top of
        // the legacy 0.35×maxChakra-bonus path so existing consumables are
        // unchanged; potions carry the flat amounts and no maxChakra bonus.
        const chakraRestore = Math.max(0, Math.floor(maxChakraBonus * 0.35)) + (Number(item.restoreChakra) || 0);
        const staminaRestore = Math.max(0, Math.floor(maxStaminaBonus * 0.35)) + (Number(item.restoreStamina) || 0);
        const shield = Math.max(0, Math.floor(defensiveBonus * 0.55));
        const focus = Math.max(0, Math.floor(offensiveBonus * 0.25));

        setPlayerHp((hp) => Math.min(character.maxHp, hp + heal));
        setPlayerShield((current) => current + shield + focus);

        // Spend one copy from inventory on use (item & potion slots both consume).
        const afterUse = removeItem(character, item.id, 1);
        updateCharacter({
            ...afterUse,
            hp: Math.min(character.maxHp, afterUse.hp + heal),
            chakra: Math.min(character.maxChakra, afterUse.chakra + chakraRestore),
            stamina: Math.min(character.maxStamina, afterUse.stamina + staminaRestore),
        });
        if (normalizeEquipmentSlot(item.slot) === "potion") setPotionUsesThisBattle((n) => n + 1);

        // weaponEffect overrides for support items (Smoke Bomb, Attack Pill, Defense Pill, etc.)
        const effectVal = item.weaponEffectValue ?? 0;
        const isBothTarget = item.weaponEffectTarget === "both";
        const itemEffectLines: string[] = [];
        if (item.weaponEffect === "Increase Damage Given") {
            setPlayerStatuses((s) => [...s, { name: "Increase Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: effectVal, kind: "positive" }]);
            itemEffectLines.push(`boosts your damage by ${effectVal}% for 2 rounds`);
        }
        if (item.weaponEffect === "Decrease Damage Given") {
            // Always debuff enemy; if weaponEffectTarget === "both" also debuff self (Smoke Bomb)
            const smokeRounds = isBothTarget ? 1 : 2;
            setEnemyStatuses((s) => [...s, { name: "Decrease Damage Given", rounds: smokeRounds, percent: effectVal, kind: "negative" }]);
            if (isBothTarget) {
                setPlayerStatuses((s) => [...s, { name: "Decrease Damage Given", rounds: 1, percent: effectVal, kind: "negative" }]);
                itemEffectLines.push(`smoke fills the field — both you and ${opponentName} deal 0 damage for 1 round (Pierce bypasses)`);
            } else {
                itemEffectLines.push(`reduces ${opponentName}'s damage by ${effectVal}% for 2 rounds`);
            }
        }
        if (item.weaponEffect === "Decrease Damage Taken") {
            setPlayerStatuses((s) => [...s, { name: "Decrease Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: effectVal, kind: "positive" }]);
            itemEffectLines.push(`reduces damage you take by ${effectVal}% for 2 rounds`);
        }
        if (item.weaponEffect === "Shield") {
            setPlayerShield((s) => s + effectVal);
            itemEffectLines.push(`grants ${effectVal} shield`);
        }

        const effects = [
            heal ? `restores ${heal} HP` : "",
            chakraRestore ? `restores ${chakraRestore} chakra` : "",
            staminaRestore ? `restores ${staminaRestore} stamina` : "",
            shield + focus ? `grants ${shield + focus} shield` : "",
            ...itemEffectLines,
        ].filter(Boolean);

        const summary = effects.length ? effects.join(", ") : "steadies your stance but has no active combat effect";
        triggerConsumableCombatFx(item, playerPos, { heal: heal > 0, shield: shield + focus > 0 || item.weaponEffect === "Shield" });
        setLog(`${item.name}: ${summary}.`);
        addCombatLog(`${item.name}: ${character.name} uses equipped item and ${summary}.`, item.id, character.name);
    }

    function activateEquippedCombatItem(item: GameItem) {
        const slot = normalizeEquipmentSlot(item.slot);
        if (slot === "hand" || slot === "thrown") {
            // Toggle: clicking the same weapon again cancels arming
            if (pendingTargetWeapon?.id === item.id) {
                setPendingTargetWeaponRaw(null);
                setLog(`${item.name} deselected.`);
                return;
            }
            // Arm for targeting — clear any pending jutsu
            setPendingTargetJutsuIdRaw("");
            setPendingTargetJutsuDirect(null);
            setSelectedActionId(undefined);
            setPendingTargetWeaponRaw(item);
            const weapRange = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
            setLog(`${item.name} armed — select ${opponentName} to attack (range ${weapRange}).`);
            return;
        }
        activateCombatItem(item);
    }

    function basicHeal() {
        setPendingTargetJutsuId("");
        if (playerHp >= character.maxHp) return setLog("You are already at full HP. Save your AP and chakra for another action.");
        if ((cooldowns.basicHeal ?? 0) > 0) return setLog(`Basic Heal cooldown: ${cooldowns.basicHeal} rounds.`);
        if (character.chakra < 10) return setLog("Basic Heal needs 10 chakra.");
        if (!spendAp(60, "basicHeal")) return;

        const healAmount = Math.max(1, Math.floor(character.maxHp * 0.1));
        setPlayerHp((hp) => Math.min(character.maxHp, hp + healAmount));
        setCooldowns((c) => ({ ...c, basicHeal: 5 }));
        updateCharacter({ ...character, chakra: Math.max(0, character.chakra - 10) });
        triggerBasicHealFx(playerPos);
        setLog(`Basic Heal restored ${healAmount} HP.`);
        addCombatLog(`${character.name} uses Basic Heal and restores ${healAmount} HP. Basic Heal cooldown: 5 rounds.`, "basicHeal", character.name);
    }

    function clearEnemyPositiveEffects() {
        setPendingTargetJutsuId("");
        if ((cooldowns.clear ?? 0) > 0) return setLog(`Clear cooldown: ${cooldowns.clear} rounds.`);
        if (!spendAp(60, "clear")) return;

        if (enemyStatuses.some((s) => s.name === "Clear Prevent")) {
            setLog("Clear was prevented.");
            addCombatLog(`${opponentName}'s Clear Prevent blocks the clear attempt.`, "clear", opponentName);
            setCooldowns((c) => ({ ...c, clear: 10 }));
            return;
        }
        const removed = enemyStatuses.filter((s) => s.kind === "positive").map((s) => s.name);
        setEnemyStatuses((statuses) => statuses.filter((s) => s.kind !== "positive"));
        setCooldowns((c) => ({ ...c, clear: 10 }));
        setLog("Clear removed enemy positive effects.");
        addCombatLog(`Clear: removed enemy positive effects${removed.length ? `: ${removed.join(", ")}` : "."} Cooldown: 10 rounds.`, "clear", character.name);
    }

    function cleansePlayerNegativeEffects() {
        setPendingTargetJutsuId("");
        if ((cooldowns.cleanse ?? 0) > 0) return setLog(`Cleanse cooldown: ${cooldowns.cleanse} rounds.`);
        if (!spendAp(60, "cleanse")) return;

        if (playerStatuses.some((s) => s.name === "Cleanse Prevent")) {
            setLog("Cleanse was prevented.");
            addCombatLog(`${character.name}'s Cleanse Prevent blocks the cleanse attempt.`, "cleanse", character.name);
            setCooldowns((c) => ({ ...c, cleanse: 10 }));
            return;
        }
        const removed = playerStatuses.filter((s) => s.kind === "negative").map((s) => s.name);
        setPlayerStatuses((statuses) => statuses.filter((s) => s.kind !== "negative"));
        setCooldowns((c) => ({ ...c, cleanse: 10 }));
        setLog("Cleanse removed your negative effects.");
        addCombatLog(`Cleanse: removed ${character.name}'s negative effects${removed.length ? `: ${removed.join(", ")}` : "."} Cooldown: 10 rounds.`, "cleanse", character.name);
    }

    function flee() {
        setPendingTargetJutsuId("");
        if (!spendAp(100, "flee")) return;

        const hpCost = Math.max(1, Math.floor(character.maxHp * 0.1));
        const escaped = Math.random() < 0.5;
        setPlayerHp((hp) => Math.max(0, hp - hpCost));

        if (escaped) {
            setBattleEnded(true);
            setBattleResult("fled");
            setRaidBattleKind("none");
            setLog("You escaped the fight.");
            addCombatLog(`${character.name} successfully fled the battle, losing ${hpCost} HP in the retreat.`, "flee", character.name);
        } else {
            setLog("Flee failed. 50% odds missed.");
            addCombatLog(`${character.name} tried to flee, lost ${hpCost} HP, but failed.`, "flee", character.name);
        }
    }

    async function continuePendingStoryResult() {
        if (!battleResult || !onPendingStoryBattleContinue) return;
        setStorySettlementPending(true);
        try {
            await onPendingStoryBattleContinue(battleResult, playerHp);
        } finally {
            setStorySettlementPending(false);
        }
    }

    function applyRankedLoss() {
        if (!rankedBattleActive || !opponentCharacter) return;
        const loss = rankedDelta(opponentCharacter.rankedRating ?? 1000, character.rankedRating ?? 1000);
        updateCharacter({
            ...character,
            hp: 0,
            hospitalized: true,
            rankedRating: Math.max(0, (character.rankedRating ?? 1000) - loss),
            rankedLosses: (character.rankedLosses ?? 0) + 1,
        });
        setLog(`${character.name} was defeated. Ranked -${loss} Elo.`);
    }

    function winBattle(baseCharacter?: Character) {
        // The reward character must be composed off the POST-action character so a
        // FINISHING move's own mutations (a killing jutsu's gainJutsuXp mastery
        // increment + chakra/stamina cost, a killing basic attack's -10 stamina, a
        // killing thrown weapon's removeItem + stamina cost) survive into the win
        // payout instead of being clobbered by the stale `character` prop. Each
        // finishing path threads its already-computed object in via baseCharacter;
        // every other caller (pet attack, enemy-turn reflect, DoT) has no pre-win
        // spend to preserve and falls back to `character`.
        const base = baseCharacter ?? character;
        if (pendingStoryBattle) {
            setBattleEnded(true);
            setBattleResult("win");
            setRaidBattleKind("none");
            const fallback = `${opponentName} defeated. Story battle complete.`;
            const tokenRequest = aiFightTokenPromiseRef.current ?? Promise.resolve("");
            void tokenRequest
                .then((token) => onPendingStoryBattleWin?.(playerHp, token) ?? fallback)
                .then((rewardLog) => {
                    setLog(rewardLog);
                    addCombatLog(rewardLog, "storyVictory", character.name);
                })
                .catch(() => {
                    const failed = `${opponentName} defeated, but the story reward could not be verified. Retry from the story screen.`;
                    setLog(failed);
                    addCombatLog(failed, "storyVictory", character.name);
                })
                .finally(() => undefined);
            aiFightTokenPromiseRef.current = null;
            return;
        }

        // No PvP win can be decided client-side. All real human-vs-human fights
        // (sector raid / village guard / spar / ranked / clan war / defense)
        // route through PvpBattleScreen, where the SERVER resolves the winner
        // and `/api/pvp/claim-rewards` credits ranked rating + base XP/ryo
        // with NX receipts under save locks. If something ever sets
        // opponentCharacter and lands us here (a future routing bug, a
        // resurrected fallback path), refuse to award rewards rather than
        // silently inflate kill counters / honor seals / ryo / XP from a
        // local outcome. AI fights (opponentCharacter === null) are unchanged.
        if (opponentCharacter) {
            setBattleEnded(true);
            setBattleResult("win");
            setRaidBattleKind("none");
            setClanWarPointsActive(0);
            setLog(`${opponentName} defeated, but the battle never reached the server. No rewards granted — please retry the action through the PvP screen.`);
            addCombatLog(`Local-only PvP win against ${opponentName} — rewards withheld (no server session).`, "defeat", character.name);
            console.warn("[winBattle] PvP outcome decided client-side; rewards withheld. This path should be unreachable — investigate the route that landed here.");
            return;
        }

        // Combat missions (Mission Hall → Combat) pay out on a CLAIM step, not
        // here. Winning the fight only queues the claim on the character; the
        // XP / ryo / territory scroll / kill-counters / daily-mission slot are
        // all granted when the player returns to the Mission Hall and clicks
        // "Claim Reward" (Missions.claimCombatMission). Stamina is intentionally
        // never part of the reward. raidBattleKind === "none" excludes raids;
        // combatMissionByAiId distinguishes a ranked combat mission from a
        // field-mission "Battle AI" fight (which keeps its old immediate path).
        const combatMission = missionBattleActive && raidBattleKind === "none"
            ? combatMissionByAiId(pendingAiProfile?.id ?? "")
            : undefined;
        if (combatMission) {
            // Ranked Mission Hall battles now start with a bound solo-PvE runId.
            // A local Arena result has no server combat proof and must never mint
            // a pending claim or enter the run-scoped outbox.
            setBattleEnded(true);
            setBattleResult("win");
            setRaidBattleKind("none");
            setClanWarPointsActive(0);
            const claimNote = `${opponentName} defeated in an unverified legacy route. No mission reward was queued — restart ${combatMission.name} from the Mission Hall.`;
            setLog(claimNote);
            addCombatLog(claimNote);
            return;
        }

        // Past the opponentCharacter guard above: this is an AI fight (story
        // boss already returned earlier). All PvP reward paths are dead code
        // here — ratingGain / rankedWins / totalPvpKills / monthlyPvpKills /
        // villageWarPvpNote / deathsGatePvp / clan-war-point bonus are all
        // intrinsically zero or only set when opponentCharacter is truthy.
        // Stripped to keep the function honest (a future code change can't
        // resurrect a dead branch and start writing PvP counters by accident).
        // "Normal battle arena" = a plain practice AI fight — NOT a mission, raid,
        // hunt (raidAi), or explore ambush (story / PvP / combat-mission already
        // returned above). Per design these grant NOTHING: no XP, ryo, stats,
        // currency, items, or kill credit — just end the battle. Progression comes
        // from missions/hunts/raids + real PvP + training.
        const isPlainPractice = !missionBattleActive && raidBattleKind === "none" && !exploreAmbushActive;
        if (isPlainPractice) {
            updateCharacter({ ...base, hp: playerHp });
            setBattleEnded(true);
            setBattleResult("win");
            setRaidBattleKind("none");
            setClanWarPointsActive(0);
            const note = `${opponentName} defeated. Practice bout — no rewards.`;
            setLog(note);
            addCombatLog(note);
            return;
        }
        const activeTrait = getActivePetTrait(character);
        // XP is retired — AI wins pay ryo only (the legacy xp field rides the
        // report payload as 0 for shape compatibility).
        const xpGain = 0;
        const ryoGain = activeTrait === "Lucky" ? 90 : 75;
        const honorSealGain = raidBattleKind === "defense" ? 20 : raidBattleKind === "raidAi" ? 5 : 0;
        const auraDustGain = raidBattleKind === "defense" ? 8 : raidBattleKind === "raidAi" ? 4 : 0;
        const territoryScrollReward = 1;
        const territoryRaidDamageAmount = (raidBattleKind === "raidAi" || raidBattleKind === "raidPlayer") ? sectorRaidDamageAmount(currentSector) : 0;
        const territoryRaidDamage = territoryRaidDamageAmount > 0 ? damageSectorTerritory(currentSector, territoryRaidDamageAmount) : null;
        const buildWin = (serverCharacter?: Partial<Character>): Character => {
            if (!serverCharacter) return { ...base, hp: Math.min(base.hp, playerHp) };
            const committed = { ...base, ...serverCharacter } as Character;
            const reconciled = { ...committed, hp: Math.min(committed.hp, playerHp) };
            return missionBattleActive && raidBattleKind === "none" ? markMissionCompleted(reconciled) : reconciled;
        };
        // AI XP/ryo is server-capped. The battle-end UI and territory /
        // village-war side effects above already ran synchronously, so only the
        // XP/ryo grant defers to the endpoint. If the endpoint cannot verify the
        // reward, the win still resolves locally but grants 0 XP/ryo.
        const rewardPayload = {
            playerName: character.name,
            opponentId: pendingAiProfile?.id ?? "",
            opponentLevel: aiLevel,
            xp: xpGain,
            ryo: ryoGain,
        };
        const tokenRequest = aiFightTokenPromiseRef.current ?? Promise.resolve("");
        tokenRequest
            .then((aiFightToken) => {
                if (!aiFightToken) return null;
                return fetch("/api/missions/report-ai-fight", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...rewardPayload, aiFightToken }),
                }).then((r) => (r.ok ? r.json() : null));
            })
            .then((data: { xp?: unknown; ryo?: unknown; character?: Partial<Character>; _saveVersion?: unknown } | null) => {
                if (data?.character) {
                    if (!onVersionedCharacter(buildWin(data.character), data._saveVersion)) return;
                } else {
                    updateCharacter(buildWin());
                }
                // Report what the server actually paid, not what we predicted.
                // A null `data` means the token was missing or the report was
                // refused — that grants nothing, and the banner must say so.
                const grantedRyo = Number(data?.ryo);
                announceWinRewards(Number.isFinite(grantedRyo) ? grantedRyo : 0);
            })
            .catch(() => {
                updateCharacter({ ...base, hp: playerHp });
                announceWinRewards(0);
            });
        aiFightTokenPromiseRef.current = null;
        if (exploreAmbushActive && raidBattleKind === "none") {
            // Explore-mission credit deferred from exploreSector — granted only
            // now that the ambush was won. Flag the win so the victory overlay
            // offers a single "Return to Sector" exit (back to where the player
            // was exploring) instead of Fight Again / Return to Village.
            setExploreAmbushWin(true);
            onExploreAmbushWon?.();
        }
        if (raidBattleKind === "raidAi" || raidBattleKind === "raidPlayer") {
            onMissionRaidComplete?.(currentSector);
        }
        if (raidBattleKind === "raidAi") {
            // Hunt contracts complete ONLY on an actual kill. The beast is fought
            // as a raidAi; huntSector holds tracking at requiredTracks-1, and this
            // marks the matching accepted hunt mission complete (claimable).
            onHuntBeastDefeated?.(pendingAiProfile?.id ?? "");
        }

        const bonusNote = activeTrait === "Lucky" ? " (Lucky +20% ryo)" : "";
        const honorNote = honorSealGain > 0 ? ` +${honorSealGain} Honor Seals.` : "";
        const auraDustNote = auraDustGain > 0 ? ` +${auraDustGain} Aura Dust.` : "";
        setBattleEnded(true);
        setBattleResult("win");
        const scrollNote = ` +${territoryScrollReward} Territory Control Scroll.`;
        const raidNote = territoryRaidDamage?.ownerClan ? ` Sector ${currentSector} HP -${territoryRaidDamageAmount}.` : territoryRaidDamage ? ` Sector ${currentSector} control broken.` : "";
        const villageWarNote = "";
        // Hoisted so the report-ai-fight `.then` above can call it with the
        // amount the SERVER actually granted. (XP is retired — hunts/fields pay
        // their stat points on the once-per-day CLAIM, not per fight.)
        function announceWinRewards(ryo: number) {
            // Say where levelling actually comes from now. A veteran who used to
            // grind the Arena for XP would otherwise just see a smaller banner
            // and assume something broke.
            const growthNote = " Stat points come from training, your dailies, and serious PvP.";
            const rewardNote = ryo > 0
                ? ` +${ryo} ryo, +15 stamina.${bonusNote}${growthNote}`
                : " No ryo was awarded for this fight.";
            setLog(`${opponentName} defeated.${rewardNote}${honorNote}${auraDustNote}${scrollNote}${raidNote}${villageWarNote}`);
            addCombatLog(`${opponentName} is defeated. ${character.name} gains ${ryo} ryo, 15 stamina${honorNote}${auraDustNote}${bonusNote}${scrollNote}${raidNote}${villageWarNote}`);
        }
        // Under server-auth these numbers are only a PREDICTION: report-ai-fight
        // caps ryo and a profession can substitute the payout, so the banner
        // used to promise rewards the server had already refused. Announce the
        // win now, and let announceWinRewards (called from the report response)
        // restate the line with the amounts actually granted.
        setLog(`${opponentName} defeated. Tallying rewards…`);
        setRaidBattleKind("none");
        setClanWarPointsActive(0);
    }
    function selectCombatJutsu(jutsu: Jutsu) {
        if (battleEnded) return;
        const cooldown = jutsuCooldowns[jutsu.id] ?? 0;
        if (cooldown > 0) {
            setPendingTargetJutsuId("");
            return setLog(`${jutsu.name} cooldown: ${cooldown} rounds.`);
        }

        setSelectedActionId(undefined);

        // Uniform two-step flow for EVERY jutsu (matches PvP): clicking the card
        // only ARMS it — the cast fires on the follow-up target click. Self-buffs
        // are confirmed by clicking your OWN ninja (handleTileClick), so they no
        // longer instant-fire the moment the card is clicked.
        armPendingTargetJutsu(jutsu);

        if (isMoveJutsu(jutsu)) {
            setLog(`${jutsu.name} selected. Choose an open tile within ${moveJutsuRange(jutsu)} spaces.`);
        } else if (isGroundEffectJutsu(jutsu)) {
            setLog(`${jutsu.name} selected. Choose a ground tile within ${jutsu.range} spaces.`);
        } else if (isSelfCastJutsu(jutsu)) {
            setLog(`${jutsu.name} selected. Click yourself to cast.`);
        } else {
            setLog(`${jutsu.name} selected. Click ${opponentName} on the battlefield.`);
        }
    }
    function castJutsu(jutsu: Jutsu, targetConfirmed = false, targetTile = enemyPos) {
        if (battleEnded) return;

        const moveJutsu = isMoveJutsu(jutsu);
        const needsTargetClick = moveJutsu || jutsu.target !== "SELF";

        // FIRST CLICK: only arm the jutsu. Do not spend AP or check costs yet.
        if (needsTargetClick && !targetConfirmed) {
            armPendingTargetJutsu(jutsu);
            setSelectedActionId(undefined);

            if (moveJutsu) {
                setLog(`${jutsu.name} selected. Choose an open tile within ${moveJutsuRange(jutsu)} spaces.`);
            } else if (isGroundEffectJutsu(jutsu)) {
                setLog(`${jutsu.name} selected. Choose a ground tile within ${jutsu.range} spaces.`);
            } else {
                setLog(`${jutsu.name} selected. Click ${opponentName} on the battlefield.`);
            }

            return;
        }

        // SECOND CLICK / SELF JUTSU: now actually validate and use it.
        if ((jutsuCooldowns[jutsu.id] ?? 0) > 0) {
            return setLog(`${jutsu.name} cooldown: ${jutsuCooldowns[jutsu.id]} rounds.`);
        }

        const mastery = getJutsuMastery(character, jutsu.id);
        // Rank cap: the jutsu's EFFECTIVE combat level is clamped to the player's
        // rank ceiling (mirrors the server clamp in api/pvp/move.ts applyJutsu).
        // Stored mastery is untouched; costs intentionally keep the true level.
        const effMasteryLevel = Math.min(mastery.level, jutsuLevelCapForLevel(character.level));
        const scaled = scaleJutsuCostsForCharacter(jutsu, mastery.level, character);

        if (activeStatuses(playerStatuses).some((s) => s.name === "Elemental Seal") && jutsu.element && jutsu.element !== "None") {
            return setLog(`${jutsu.element} jutsu is sealed.`);
        }

        if (character.hp <= scaled.healthCost) return setLog("Not enough health.");
        if (character.chakra < scaled.chakraCost) return setLog("Not enough chakra.");
        if (character.stamina < scaled.staminaCost) return setLog("Not enough stamina.");

        const groundTargeted = isGroundEffectJutsu(jutsu);
        const groundHitEnemy = groundTargeted
            ? groundTargetCatchesEnemy(jutsu, targetTile)
            : (moveJutsu && jutsu.method === "AOE_CIRCLE")
                ? hexNeighbors(targetTile).includes(enemyPos)
                : true;
        const relocatesToGround = groundTargetRelocatesUser(jutsu);
        const effectiveTargetTile = groundTargeted ? targetTile : enemyPos;
        if (!moveJutsu && !isSelfCastJutsu(jutsu) && jutsu.range > 0 && distance(playerPos, effectiveTargetTile) > jutsu.range) {
            return setLog(`${jutsu.name} needs range ${jutsu.range}. Move closer or use a longer range jutsu.`);
        }

        if (!spendAp(jutsu.ap, jutsu.id)) return;
        if (isAcademySpar && !sparCasted) setSparCasted(true); // tutorial banner only
        setPendingTargetJutsuId("");

        if (relocatesToGround) {
            setPlayerPos(targetTile);
        }

        let damage = calculateDamage(
            // Raw effectPower — calculateDamage applies the single mastery step
            // (rawEP + level×0.2) via the masteryLevel arg below, exactly like
            // the PvP server (api/pvp/move.ts). Passing scaled.scaledEffectPower
            // here double-scaled mastery (scaleJutsuByLevel already baked level
            // in), so PvE only matched PvP at max mastery. `scaled.*` is still
            // used for the resource costs.
            jutsu,
            characterCombatStats,
            enemyCombatStats,
            enemyMaxHp,
            activeBloodlineMultiplier(character, playerStatuses),
            enemyArmorFactor,
            playerItemMult,
            weatherDamageMultiplier(jutsu) * territoryDamageMultiplier(jutsu) * biomeTerrainMultiplier(jutsu),
            // ACTIVE statuses only. This was the "buffs are instant" bug: a
            // 40AP IDG/IDT cast said "starting next round" but the raw arrays
            // fed pvpAmpMultiplier, so the very next 60AP jutsu in the SAME
            // turn was already amplified (946 → 1378 with two 21% amps).
            activeStatuses(playerStatuses),
            activeStatuses(enemyStatuses),
            effMasteryLevel,
        );
        if (!opponentCharacter && getActiveAuraSphereBonuses(character).pveDamagePercent > 0) {
            damage = boostAmount(damage, getActiveAuraSphereBonuses(character).pveDamagePercent);
        }
        if (!groundHitEnemy) damage = 0;

        let healing = 0;
        let shield = 0;
        let pierce = false;
        const effectLines: string[] = [];
        const postDamageTags: JutsuTag[] = [];
        const currentPlayerStatuses = activeStatuses(playerStatuses);
        const currentEnemyStatuses = activeStatuses(enemyStatuses);
        const queuePlayerStatus = (status: CombatStatus) => setPlayerStatuses((s) => mergeCombatStatus(s, statusForJutsu(jutsu, status)));
        const queueEnemyStatus = (status: CombatStatus) => setEnemyStatuses((s) => capWoundStacks(mergeCombatStatus(s, statusForJutsu(jutsu, status))));
        const tagTimingText = bloodlineTagsResolveNextRound(jutsu) ? " starting next round" : "";
        const activeDamageTakenTags = currentEnemyStatuses.filter((s) => s.name === "Increase Damage Taken");
        const activeDamageGivenDebuffs = currentPlayerStatuses.filter((s) => s.name === "Decrease Damage Given");
        const activeDamageTakenReductions = currentEnemyStatuses.filter((s) => s.name === "Decrease Damage Taken");
        const healMultiplier = multiplicativeTagMultiplier(currentPlayerStatuses.filter((s) => s.name === "Increase Heal"), "increase");
        const activePlayerDmgBoosts = currentPlayerStatuses.filter((s) => s.name === "Increase Damage Given");
        const activeIgnition = currentEnemyStatuses.filter((s) => statusMatchesName(s, "Ignition"));
        const activePlayerLifesteal = currentPlayerStatuses.filter((s) => s.name === "Lifesteal");
        const enemyDebuffPrevented = currentEnemyStatuses.some((s) => s.name === "Debuff Prevent");
        const playerBuffPrevented = currentPlayerStatuses.some((s) => s.name === "Buff Prevent");
        // Flavor: label the player's own damage effects with their discipline,
        // matching the Profile/Training/inspect lens. Trailing space so
        // `${flavorDisc}damage` reads "Genjutsu damage" / "damage" if ever empty.
        const flavorDisc = `${playerLensDiscipline(character)} `;

        // Canonical opponent-affecting set (Buff Prevent / Cleanse Prevent / Recoil
        // included). Mirrors the server's OPPONENT_AFFECTING_TAGS so an out-of-range
        // ground jutsu can't apply an enemy debuff the server would reject. Sourced
        // from lib/tags.ts (single source of truth) — do NOT re-hardcode here.
        const enemyAffectingTags = new Set(opponentAffectingTags);

        jutsu.tags.forEach((tag) => {
            const tagName = normalizeTagName(tag.name);
            if (!groundHitEnemy && enemyAffectingTags.has(tagName)) {
                return;
            }
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank, effMasteryLevel);

            if (tag.name === "Increase Damage Given") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s Increase Damage Given was prevented`);
                else {
                    queuePlayerStatus({ name: "Increase Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`Increase Damage Given: ${character.name} deals ${pct}% more ${flavorDisc}damage for 2 rounds${tagTimingText}.`);
                }
            }

            // Increase Generals: self-buff to str/spd/int/wil. The stat lift is read from
            // active stacks by generalsBonusFromStatuses inside calculateDamage, so it
            // raises the caster's damage dealt AND lowers damage taken. Buff-Prevent-gated
            // like the other self-buffs; the % is rank-capped via effectiveTagPercent.
            if (tag.name === "Increase Generals") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s Increase Generals was prevented`);
                else {
                    queuePlayerStatus({ name: "Increase Generals", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`Increase Generals: ${character.name}'s general stats rise ${pct}% for 2 rounds${tagTimingText}.`);
                }
            }

            // Increase Discipline (legacy signature jutsu): style-locked self-buff — lifts
            // ONLY the offense composite of this jutsu's discipline. The stack stores the
            // cast type; disciplineBonusFromStatuses inside calculateDamage applies it per
            // cast. No-op on an 'Any'/typeless cast, mirroring the server guard.
            if (tag.name === "Increase Discipline") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s Increase Discipline was prevented`);
                else if (["Taijutsu", "Bukijutsu", "Genjutsu", "Ninjutsu"].includes(jutsu.type)) {
                    queuePlayerStatus({ name: "Increase Discipline", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive", discipline: jutsu.type });
                    effectLines.push(`Increase Discipline: ${character.name}'s ${jutsu.type} offense rises ${pct}% for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Increase Damage Taken") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists damage taken debuff`);
                else {
                    queueEnemyStatus({ name: "Increase Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "negative" });
                    effectLines.push(`Increase Damage Taken: ${opponentName} takes ${pct}% more ${flavorDisc}damage for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Decrease Damage Taken") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s damage taken buff was prevented`);
                else {
                    queuePlayerStatus({ name: "Decrease Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`Decrease Damage Taken: ${character.name} takes ${pct}% less ${flavorDisc}damage for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Decrease Damage Given") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists damage given debuff`);
                else {
                    queueEnemyStatus({ name: "Decrease Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "negative" });
                    effectLines.push(`Decrease Damage Given: ${opponentName} deals ${pct}% less damage for 2 rounds${tagTimingText}.`);
                }
            }

            if (["Wound", "Recoil", "Siphon"].includes(tag.name)) {
                postDamageTags.push(tag);
            }
            if (tagMatchesName(tag.name, "Ignition")) {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Ignition`);
                else {
                    queueEnemyStatus({ name: "Ignition", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`Ignition: ${opponentName} will take ${pct}% extra ${flavorDisc}damage for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Lifesteal") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s Lifesteal was prevented`);
                else {
                    queuePlayerStatus({ name: "Lifesteal", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`Lifesteal: ${character.name} will heal ${pct}% of ${flavorDisc}damage dealt for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Heal") {
                // Increase Heal boosts the flat Heal too (matches PvP move.ts
                // `HEAL_FLAT * healBoost`); ramp by jutsu mastery + hard-cap at
                // HEAL_FLAT_PVE, identical to the server.
                const healAmt = Math.min(HEAL_FLAT_PVE, Math.floor(HEAL_FLAT_PVE * masteryDamageFrac(effMasteryLevel) * healMultiplier));
                healing += healAmt;
                damage = 0;
                effectLines.push(`Heal: ${character.name} restores ${healAmt} HP.`);
            }

            if (tag.name === "Shield") {
                const shieldAmt = Math.min(SHIELD_FLAT_PVE, Math.floor(SHIELD_FLAT_PVE * masteryDamageFrac(effMasteryLevel)));
                shield += shieldAmt;
                damage = 0;
                effectLines.push(`Shield: ${character.name} gains ${shieldAmt} shield.`);
            }

            if (tag.name === "Barrier") {
                const barrierTile = nextStepToward(playerPos, enemyPos);
                if (barrierTile !== playerPos && barrierTile !== enemyPos) {
                    setBarrierTiles((prev) => [...prev, { tile: barrierTile, rounds: 2 }]);
                    effectLines.push(`Barrier: ${character.name} erects a wall between the fighters for 2 rounds.`);
                } else {
                    effectLines.push(`Barrier: no room to place a wall.`);
                }
                damage = 0;
            }

            if (tag.name === "Absorb") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s absorb was prevented`);
                else {
                    queuePlayerStatus({ name: "Absorb", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`Absorb: ${character.name} converts ${pct}% incoming damage into healing for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Reflect") {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s reflect was prevented`);
                else {
                    queuePlayerStatus({ name: "Reflect", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`${character.name} reflects ${pct}% damage for 2 rounds${tagTimingText}`);
                }
            }

            if (tag.name === "Mirror") {
                // Exclude DoTs (Wound/Poison/Drain) + Ignition — matches PvP Mirror
                // (api/pvp/move.ts:514-516), which is "spread the pain" for plain
                // debuffs, not a DoT-transfer.
                const mirrored = currentPlayerStatuses.filter((s) => s.kind === "negative" && s.name !== "Wound" && s.name !== "Poison" && s.name !== "Drain" && !statusMatchesName(s, "Ignition"));
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists mirrored debuffs`);
                else if (mirrored.length) {
                    setEnemyStatuses((s) => mirrored.reduce((acc, m) => mergeCombatStatus(acc, statusForJutsu(jutsu, { ...m, rounds: Math.min(2, m.rounds) })), s));
                    effectLines.push(`mirrored ${mirrored.length} negative effect(s) to ${opponentName}`);
                } else effectLines.push("no negative effects to mirror");
            }

            if (tag.name === "Copy") {
                const copied = currentEnemyStatuses.filter((s) => s.kind === "positive");
                if (playerBuffPrevented) effectLines.push(`${character.name}'s copy was prevented`);
                else if (copied.length) {
                    setPlayerStatuses((s) => copied.reduce((acc, c) => mergeCombatStatus(acc, statusForJutsu(jutsu, { ...c, rounds: Math.min(2, c.rounds) })), s));
                    effectLines.push(`copied ${copied.length} positive effect(s)`);
                } else effectLines.push("no positive effects to copy");
            }

            if (tag.name === "Pierce") {
                pierce = true;
                effectLines.push(`${jutsu.name}: true damage — bypasses all defenses.`);
            }

            if (tag.name === "Stun") {
                if (currentEnemyStatuses.some((s) => s.name === "Stun Prevent")) effectLines.push(`${opponentName} resisted stun`);
                else if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists stun`);
                else {
                    queueEnemyStatus({ name: "Stun", rounds: 1, kind: "negative" });
                    effectLines.push(`Stun: ${opponentName} loses ${STUN_AP_PENALTY} AP on their next turn${tagTimingText}.`);
                }
            }

            if (tag.name === "Bloodline Seal" || tag.name === "Seal") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists bloodline seal`);
                else {
                    queueEnemyStatus({ name: "Bloodline Seal", rounds: 2, kind: "negative" });
                    effectLines.push(`${opponentName}'s bloodline is sealed for 2 rounds${tagTimingText}`);
                }
            }

            if (tag.name === "Poison") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists poison`);
                else {
                    // Legacy (v1) poison ticks floor(maxChakra × pct/100) per round. Under
                    // combatResourcesV2 poison instead bites on-spend (no per-round tick), so
                    // the stored amount is inert and the log reflects the exertion model.
                    const poisonDmg = Math.floor(enemyMaxChakra * (pct / 100));
                    queueEnemyStatus({ name: "Poison", rounds: 2, percent: pct, kind: "negative", amount: poisonDmg });
                    effectLines.push(COMBAT_RESOURCES_V2
                        ? `${opponentName} is poisoned for 2 rounds — casting jutsu will cost them HP${tagTimingText}`
                        : `${opponentName} is poisoned — takes ${poisonDmg} damage/round for 2 rounds${tagTimingText}`);
                }
            }

            if (tag.name === "Drain") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists drain`);
                else {
                    // Match PvP (api/pvp/move.ts): mastery-scaled 50–300 per tick,
                    // draining HP + chakra only (was a flat 250 incl. stamina).
                    const drainAmt = drainTickPVE(effMasteryLevel);
                    queueEnemyStatus({ name: "Drain", rounds: 2, amount: drainAmt, kind: "negative" });
                    effectLines.push(`${opponentName} is drained — loses ${drainAmt} HP and chakra/round for 2 rounds${tagTimingText}`);
                }
            }

            if (tag.name === "Buff Prevent") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Buff Prevent`);
                else {
                    queueEnemyStatus({ name: "Buff Prevent", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`Buff Prevent: ${opponentName} cannot gain positive effects for 2 rounds${tagTimingText}.`);
                }
            }

            if (tag.name === "Cleanse Prevent") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Cleanse Prevent`);
                else {
                    queueEnemyStatus({ name: "Cleanse Prevent", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`Cleanse Prevent: ${opponentName} cannot cleanse debuffs for 2 rounds${tagTimingText}.`);
                }
            }

            if (["Clear Prevent", "Overclock", "Increase Heal"].includes(tagName)) {
                if (playerBuffPrevented) effectLines.push(`${character.name}'s ${tagName} was prevented`);
                else {
                    const statusRounds = tagName === "Overclock" ? 1 : 2;
                    queuePlayerStatus({ name: tagName, rounds: statusRounds, percent: pct, kind: "positive" });
                    effectLines.push(`${character.name} gains ${tagName} for ${statusRounds} round${statusRounds === 1 ? "" : "s"}${tagTimingText}`);
                }
            }
            // Defensive self-Prevents (Stun Prevent, Debuff Prevent) are NOT blocked
            // by Buff Prevent — api/pvp/move.ts applies them unconditionally so a
            // buff-prevented fighter can still self-protect. (Clear Prevent /
            // Overclock / Increase Heal stay buff-prevent-gated, matching the server.)
            if (tag.name === "Stun Prevent") {
                queuePlayerStatus({ name: "Stun Prevent", rounds: 2, percent: pct, kind: "positive" });
                effectLines.push(`Stun Prevent: ${character.name} is immune to Stun for 2 rounds${tagTimingText}.`);
            }

            if (tag.name === "Debuff Prevent") {
                queuePlayerStatus({ name: "Debuff Prevent", rounds: 2, percent: pct, kind: "positive" });
                effectLines.push(`Debuff Prevent: ${character.name} cannot be debuffed for 2 rounds${tagTimingText}.`);
            }
            if (tag.name === "Elemental Seal") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Elemental Seal`);
                else {
                    queueEnemyStatus({ name: "Elemental Seal", rounds: 1, percent: pct, kind: "negative" });
                    effectLines.push(`Elemental Seal: ${opponentName}'s elemental jutsu are sealed for 1 round${tagTimingText}.`);
                }
            }
            if (tagMatchesName(tag.name, "Lag")) {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Lag`);
                else {
                    queueEnemyStatus({ name: "Lag", rounds: 1, percent: pct, kind: "negative" });
                    effectLines.push(`Lag: ${opponentName}'s AP costs are increased for 1 round${tagTimingText}.`);
                }
            }

            if (tag.name === "Move") {
                const next = Math.max(0, Math.min(gridWidth * gridHeight - 1, playerPos + (playerPos > enemyPos ? 1 : -1)));
                if (!relocatesToGround && next !== enemyPos) setPlayerPos(next);
                effectLines.push(`${character.name} shifts position`);
            }

            if (tag.name === "Push") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Push`);
                else {
                    const pushDist = Math.max(1, Number(jutsu.range) || 1);
                    let newPos = enemyPos;
                    for (let step = 0; step < pushDist; step++) {
                        const away = hexNeighbors(newPos).filter((t) => distance(t, playerPos) > distance(newPos, playerPos) && t !== playerPos && t >= 0 && t < gridWidth * gridHeight);
                        if (away.length === 0) break;
                        newPos = away[0];
                    }
                    if (newPos !== enemyPos) setEnemyPos(newPos);
                    effectLines.push(`${opponentName} is pushed ${pushDist} tile(s) away.`);
                }
            }
            if (tag.name === "Pull") {
                if (enemyDebuffPrevented) effectLines.push(`${opponentName} resists Pull`);
                else {
                    const pullDist = Math.max(1, Number(jutsu.range) || 1);
                    let newPos = enemyPos;
                    for (let step = 0; step < pullDist; step++) {
                        const toward = hexNeighbors(newPos).filter((t) => distance(t, playerPos) < distance(newPos, playerPos) && t !== playerPos && t >= 0 && t < gridWidth * gridHeight);
                        if (toward.length === 0) break;
                        newPos = toward[0];
                    }
                    if (newPos !== enemyPos) setEnemyPos(newPos);
                    effectLines.push(`${opponentName} is pulled ${pullDist} tile(s) closer.`);
                }
            }
        });

        // Drop a persistent ground zone for INSTANT_EFFECT ground jutsu carrying a
        // zone tag (Decrease Damage Given / Recoil / Poison). The tags above already
        // applied once on cast (the "instant" hit); the zone re-applies them to the
        // enemy each turn it stands here, for 2 rounds (mirrors PvP groundEffects).
        if (groundTargeted && jutsu.method === "INSTANT_EFFECT") {
            const zoneTags = jutsu.tags
                .map((t) => ({ name: normalizeTagName(t.name), percent: t.percent }))
                .filter((t) => GROUND_ZONE_TAGS.has(t.name));
            if (zoneTags.length) {
                const tiles = [targetTile, ...hexNeighbors(targetTile)];
                setGroundZones((z) => [...z, { id: `gz-${jutsu.id}-${turn}-${z.length}`, owner: "player", tiles, rounds: 2, tags: zoneTags }]);
                effectLines.push(`${jutsu.name} leaves a lingering zone for 2 rounds.`);
            }
        }

        // IDG/IDT/Ignition/DDG/DDT are now folded into calculateDamage via
        // the soft-cap pools (mirrors server). Pierce is also handled inside
        // calculateDamage (returns true damage capped at 900). The `pierce`
        // variable is still consulted below for shield bypass + post-damage
        // tag suppression.
        void activePlayerDmgBoosts; void activeDamageTakenTags; void activeIgnition;
        void activeDamageGivenDebuffs; void activeDamageTakenReductions;

        const blocked = pierce ? 0 : Math.min(enemyShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        const extraEnemyDamage = 0;
        let recoilDamage = 0;

        postDamageTags.forEach((tag) => {
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank, effMasteryLevel);
            if (tag.name === "Wound" && !enemyDebuffPrevented) {
                // Rank-cap the wound % to match PvP (api/pvp/move.ts woundCapForJutsu):
                // "Wound" isn't in cappedDamageTags, so effectiveTagPercent leaves pct
                // uncapped — apply the rank cap (25/30/35) here, as PvP does.
                const wound = cappedPostDamage(finalDamage, Math.min(pct, woundCapForRankPVE(jutsu.bloodlineRank)));
                queueEnemyStatus({ name: "Wound", rounds: 2, amount: wound, kind: "negative" });
                effectLines.push(`Wound: ${opponentName} bleeds for ${wound} damage on their turns${tagTimingText}.`);
            }
            if (tag.name === "Recoil") {
                queueEnemyStatus({ name: "Recoil", rounds: 2, percent: pct, kind: "negative" });
                effectLines.push(`Recoil: ${opponentName} will take recoil when attacking${tagTimingText}.`);
            }
            if (tag.name === "Siphon") {
                const restored = Math.floor(cappedPostDamage(finalDamage, pct) * healMultiplier);
                healing += restored;
                effectLines.push(`${tag.name} restores ${restored} HP`);
            }
        });

        if (equippedLifeStealPercent > 0) {
            const itemLsHeal = Math.floor(cappedPostDamage(finalDamage, equippedLifeStealPercent));
            healing += itemLsHeal;
            // "Gear lifesteal" (not "Lifesteal") — this is the equipped-item
            // passive, which heals instantly by design. The Lifesteal TAG is a
            // deferred 2-round buff; sharing one label made the tag look like it
            // healed the cast attack ("all tags are instant" reports).
            if (itemLsHeal > 0) effectLines.push(`Gear lifesteal restores ${itemLsHeal} HP`);
        }

        if (activePlayerLifesteal.length > 0 && finalDamage > 0) {
            const lsPct = activePlayerLifesteal.reduce((sum, s) => sum + (s.percent ?? 0), 0);
            const lsHeal = Math.floor(cappedPostDamage(finalDamage, lsPct) * healMultiplier);
            if (lsHeal > 0) { healing += lsHeal; effectLines.push(`Lifesteal: restores ${lsHeal} HP.`); }
        }

        const activePlayerRecoil = currentPlayerStatuses.find((s) => s.name === "Recoil");
        if (activePlayerRecoil && finalDamage > 0) {
            recoilDamage += cappedPostDamage(finalDamage, activePlayerRecoil.percent ?? 30);
            effectLines.push(`Recoil: ${character.name} takes ${recoilDamage} recoil damage.`);
        }

        // combatResourcesV2: Poison feeds on exertion — casting spends chakra/stamina,
        // which deals HP damage scaled by the spend + the caster's active Poison.
        const playerPoisonPct = COMBAT_RESOURCES_V2 ? sumActiveStatusPct(currentPlayerStatuses, "Poison", 6) : 0;
        const poisonSpendDmg = playerPoisonPct > 0 ? v2PoisonOnSpend((scaled.chakraCost || 0) + (scaled.staminaCost || 0), playerPoisonPct) : 0;
        if (poisonSpendDmg > 0) effectLines.push(`Poison: ${character.name} takes ${poisonSpendDmg} damage from exertion.`);

        const { net: castEnemyNet, reflected: castEnemyReflected, absorbed: castEnemyAbsorbed } = enemyDefenseFor(finalDamage + extraEnemyDamage, pierce);
        setEnemyShield((s) => pierce ? s : Math.max(0, s - blocked));
        setEnemyHp((hp) => Math.max(0, Math.min(enemyMaxHp, hp - castEnemyNet)));
        queueHitFx("e", castEnemyNet, "damage");
        setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + healing - recoilDamage - castEnemyReflected - poisonSpendDmg)));
        queueHitFx("p", recoilDamage + castEnemyReflected + poisonSpendDmg, "damage");
        queueHitFx("p", healing, "heal");
        setPlayerShield((s) => s + shield);

        setJutsuCooldowns((c) => ({ ...c, [jutsu.id]: jutsu.cooldown }));

        const postJutsuCharacter: Character = {
            ...character,
            hp: Math.max(0, character.hp - scaled.healthCost - poisonSpendDmg),
            chakra: Math.max(0, character.chakra - scaled.chakraCost),
            stamina: Math.max(0, character.stamina - scaled.staminaCost),
        };
        updateCharacter(postJutsuCharacter);

        const flavorText = interpolateFlavor(
            jutsu.battleDescription?.trim() ||
            jutsu.description?.trim() ||
            `${character.name} unleashes ${jutsu.name}.`,
            character.name, opponentName);

        const totalDamage = finalDamage + extraEnemyDamage;

        const groundTargetNote = (groundTargeted || (moveJutsu && jutsu.method === "AOE_CIRCLE"))
            ? groundHitEnemy
                ? `AOE: ${character.name} lands on hex ${targetTile}; the blast catches ${opponentName}.`
                : `AOE: ${character.name} lands on hex ${targetTile}; ${opponentName} is outside the blast.`
            : "";

        const timelineParts = [
            `${jutsu.name}: ${flavorText}`,
            groundTargetNote,
            // Log the NET damage (what the enemy's HP actually lost). Logging the
            // pre-Absorb total made a working Absorb look like it did nothing.
            castEnemyNet > 0 ? `Damage Dealt: ${opponentName} takes ${castEnemyNet} damage.` : "",
            castEnemyAbsorbed > 0 ? `Absorb: ${opponentName} absorbs ${castEnemyAbsorbed} damage.` : "",
            castEnemyReflected > 0 ? `Reflect: ${character.name} takes ${castEnemyReflected} reflected damage.` : "",
            blocked > 0 ? `Shield: ${opponentName}'s shield blocks ${blocked} damage.` : "",
            healing > 0 ? `Heal: ${character.name} restores ${healing} HP.` : "",
            shield > 0 ? `Shield: ${character.name} gains ${shield} shield.` : "",
            ...effectLines,
        ].filter(Boolean).join("\n");

        addCombatLog(
            timelineParts,
            jutsu.id,
            character.name
        );

        triggerCombatFx(jutsu, {
            selfCast: isSelfSupportJutsu(jutsu),
            focusPos: isSelfSupportJutsu(jutsu)
                ? playerPos
                : (groundTargeted || (moveJutsu && jutsu.method === "AOE_CIRCLE")) ? targetTile : enemyPos,
            heavy: totalDamage >= enemyMaxHp * 0.18,
            isKO: enemyHp - castEnemyNet <= 0,
            ground: groundTargeted,
            area: groundTargeted || (moveJutsu && jutsu.method === "AOE_CIRCLE"),
        });

        if (enemyHp - castEnemyNet <= 0) return winBattle(postJutsuCharacter);

        // Player self-KO via Recoil + enemy Reflect on their own jutsu.
        if (playerHp + healing - recoilDamage - castEnemyReflected - poisonSpendDmg <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} fell to recoil/reflected damage.`);
            addCombatLog(`${character.name} is defeated by recoil/reflected damage.`, "defeat", opponentName);
            if (rankedBattleActive) applyRankedLoss();
            else updateCharacter({ ...character, hp: 0, hospitalized: true });
            return;
        }

        setLog((groundTargeted || (moveJutsu && jutsu.method === "AOE_CIRCLE"))
            ? `${jutsu.name}: moved to hex ${targetTile}. ${groundHitEnemy ? `${castEnemyNet} damage.` : `${opponentName} was outside the blast.`} ${healing ? `Healed ${healing}.` : ""}`
            : `${jutsu.name} used on ${opponentName}. ${castEnemyNet} damage. ${healing ? `Healed ${healing}.` : ""}`);
    }

    function aiRuleMatches(rule: AiRule) {
        return matchesArenaAiRule(rule, {
            distanceToPlayer: distance(playerPos, enemyPos),
            turn,
            enemyHp,
            enemyMaxHp,
            playerHp,
            playerMaxHp: character.maxHp,
            playerShield,
            playerAp: ap,
            activePlayerStatuses: activeStatuses(playerStatuses),
            activeEnemyStatuses: activeStatuses(enemyStatuses),
        });
    }

    // Reused damage estimator — calls calculateDamage with the AI's current
    // stats / multipliers so the AI scores jutsus the same way it'd actually
    // resolve them. Skips self-support jutsus (returns 0 for those).
    function estimateAiJutsuDamage(jutsu: Jutsu): number {
        if (isSelfSupportJutsu(jutsu)) return 0;
        try {
            return calculateDamage(
                jutsu, enemyCombatStats, characterCombatStats,
                character.maxHp,
                activeBloodlineMultiplier(opponentCharacter, enemyStatuses),
                playerArmorFactor, 1.0,
                weatherDamageMultiplier(jutsu) * biomeTerrainMultiplier(jutsu),
                // ACTIVE statuses only, so the AI scores jutsu with the same
                // deferred-amp rules its actual cast resolves with.
                activeStatuses(enemyStatuses),
                activeStatuses(playerStatuses),
                // Score moves at the AI's real (level-tied) mastery so it picks
                // the same jutsu its cast will actually resolve at.
                pveAiMastery,
            );
        } catch {
            return jutsu.effectPower;
        }
    }

    function highestPowerAiJutsu(availableAp = 100) {
        return pickArenaAiJutsu({
            allJutsus,
            enemyAiJutsus,
            opponentLevel,
            usesSmartScorer: pveAiCompetence(opponentLevel, pendingAiProfile?.masterAi).usesSmartScorer,
            enemyChakra,
            enemyStamina,
            enemyJutsuCooldowns,
            availableAp,
            distanceToPlayer: distance(playerPos, enemyPos),
            turn,
            isStandardPve,
            enemyHp,
            enemyMaxHp,
            playerHp,
            playerMaxHp: character.maxHp,
            playerShield,
            playerAp: ap,
            playerArmorFactor,
            playerStatuses,
            enemyStatuses,
            combatResourcesV2: COMBAT_RESOURCES_V2,
            estimateDamage: estimateAiJutsuDamage,
        });
    }
    function enemyUseAiJutsu(jutsu: Jutsu, availableAp = 100) {
        if (jutsu.ap > availableAp) return false;
        if ((enemyJutsuCooldowns[jutsu.id] ?? 0) > 0) return false;
        if (jutsu.target !== "SELF" && jutsu.range > 0 && distance(playerPos, enemyPos) > jutsu.range) return false;

        const damageBase = jutsu.tags.some((tag) => ["Heal", "Shield", "Barrier"].includes(tag.name))
            ? 0
            : calculateDamage(
                jutsu,
                enemyCombatStats,
                characterCombatStats,
                character.maxHp,
                activeBloodlineMultiplier(opponentCharacter, enemyStatuses),
                playerArmorFactor,
                1.0,
                weatherDamageMultiplier(jutsu) * biomeTerrainMultiplier(jutsu),
                // ACTIVE statuses only — the AI's own just-cast (deferred)
                // buffs must not amplify the attack it makes the same turn.
                activeStatuses(enemyStatuses),
                activeStatuses(playerStatuses),
                pveAiMastery,
            );
        // Guard the hit (per-hit cap + per-turn cap + easy-band mercy; no-op in
        // non-standard PvE). Guarding here — before finalDamage/Wound/Siphon derive
        // from it — keeps bleed and lifesteal proportional to the damage dealt.
        const damage = guardEnemyHit(damageBase);
        let healing = 0;
        let shield = 0;
        // Wound is now applied as a 2-round bleed DoT (queued to the player), not
        // an instant hit, so nothing adds to this anymore — kept at 0 so the
        // damage/KO expressions below read uniformly with the player path.
        const extraDamage = 0;
        const effectLines: string[] = [];
        // ACTIVE only — a prevent the target gained THIS turn (deferred) must not
        // gate effects until next round (mirrors the player-cast path's
        // currentPlayerStatuses/currentEnemyStatuses).
        const playerDebuffPrevented = activeStatuses(playerStatuses).some((s) => s.name === "Debuff Prevent");
        const enemyBuffPrevented = activeStatuses(enemyStatuses).some((s) => s.name === "Buff Prevent");
        // Defer status effects to next round unless this is an INSTANT_EFFECT ground-zone jutsu.
        const deferEnemyStatus = (status: CombatStatus): CombatStatus =>
            !(jutsu.target === "EMPTY_GROUND" && jutsu.method === "INSTANT_EFFECT")
                ? { ...status, rounds: status.rounds + 1, activeRound: turn + 1 }
                : status;
        const queueToPlayer = (status: CombatStatus) => setPlayerStatuses((s) => capWoundStacks(mergeCombatStatus(s, deferEnemyStatus(status))));
        const queueToEnemy = (status: CombatStatus) => setEnemyStatuses((s) => mergeCombatStatus(s, deferEnemyStatus(status)));

        jutsu.tags.forEach((tag) => {
            const pct = effectiveTagPercent(tag, jutsu.bloodlineRank, pveAiMastery);
            if (tag.name === "Heal") {
                const enemyHealMult = multiplicativeTagMultiplier(activeStatuses(enemyStatuses).filter((s) => s.name === "Increase Heal"), "increase");
                const healAmt = Math.min(HEAL_FLAT_PVE, Math.floor(HEAL_FLAT_PVE * masteryDamageFrac(pveAiMastery) * enemyHealMult));
                healing += healAmt;
                effectLines.push(`${opponentName} heals ${healAmt} HP`);
            }
            if (tag.name === "Shield") {
                const shieldAmt = Math.min(SHIELD_FLAT_PVE, Math.floor(SHIELD_FLAT_PVE * masteryDamageFrac(pveAiMastery)));
                shield += shieldAmt;
                effectLines.push(`${opponentName} gains ${shieldAmt} shield`);
            }
            if (tag.name === "Barrier") {
                const barrierTile = nextStepToward(enemyPos, playerPos);
                if (barrierTile !== enemyPos && barrierTile !== playerPos) {
                    setBarrierTiles((prev) => [...prev, { tile: barrierTile, rounds: 2 }]);
                    effectLines.push(`${opponentName} raises a barrier wall for 2 rounds`);
                } else {
                    effectLines.push(`${opponentName}'s barrier has no room to form`);
                }
            }
            if (tag.name === "Wound") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists Wound`);
                else {
                    // Rank-cap the wound % (matches PvP), then apply as a 2-round
                    // bleed DoT on the player — was a one-shot extra hit before,
                    // which ignored Debuff Prevent and couldn't be cleansed.
                    const wound = cappedPostDamage(damage, Math.min(pct, woundCapForRankPVE(jutsu.bloodlineRank)));
                    queueToPlayer({ name: "Wound", rounds: 2, amount: wound, kind: "negative" });
                    effectLines.push(`${character.name} bleeds for ${wound} damage on their turns`);
                }
            }
            if (tag.name === "Poison") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists poison`);
                else {
                    const poisonDmg = Math.floor(character.maxChakra * (pct / 100));
                    queueToPlayer({ name: "Poison", rounds: 2, percent: pct, amount: poisonDmg, kind: "negative" });
                    effectLines.push(COMBAT_RESOURCES_V2
                        ? `${character.name} is poisoned for 2 rounds — casting jutsu will cost them HP`
                        : `${character.name} is poisoned — takes ${poisonDmg} damage/round for 2 rounds`);
                }
            }
            if (tag.name === "Drain") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists drain`);
                else {
                    const drainAmt = drainTickPVE(opponentLevel);
                    queueToPlayer({ name: "Drain", rounds: 2, amount: drainAmt, kind: "negative" });
                    effectLines.push(`${character.name} is drained — loses ${drainAmt} HP and chakra/round for 2 rounds`);
                }
            }
            if (tag.name === "Recoil") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists Recoil`);
                else {
                    queueToPlayer({ name: "Recoil", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name} will take recoil when attacking`);
                }
            }
            if (tag.name === "Increase Damage Given") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Increase Damage Given was prevented`);
                else {
                    queueToEnemy({ name: "Increase Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} deals ${pct}% more damage for ${AMP_STATUS_ROUNDS_PVE} rounds`);
                }
            }
            if (tag.name === "Increase Generals") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Increase Generals was prevented`);
                else {
                    queueToEnemy({ name: "Increase Generals", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName}'s general stats rise ${pct}% for ${AMP_STATUS_ROUNDS_PVE} rounds`);
                }
            }
            // Increase Discipline: style-locked offense self-buff (see player branch).
            if (tag.name === "Increase Discipline") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Increase Discipline was prevented`);
                else if (["Taijutsu", "Bukijutsu", "Genjutsu", "Ninjutsu"].includes(jutsu.type)) {
                    queueToEnemy({ name: "Increase Discipline", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive", discipline: jutsu.type });
                    effectLines.push(`${opponentName}'s ${jutsu.type} offense rises ${pct}% for ${AMP_STATUS_ROUNDS_PVE} rounds`);
                }
            }
            if (tag.name === "Decrease Damage Taken") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Decrease Damage Taken was prevented`);
                else {
                    queueToEnemy({ name: "Decrease Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} takes ${pct}% less damage for ${AMP_STATUS_ROUNDS_PVE} rounds`);
                }
            }
            if (tag.name === "Absorb") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Absorb was prevented`);
                else {
                    queueToEnemy({ name: "Absorb", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} converts ${pct}% incoming damage into healing for 2 rounds`);
                }
            }
            if (tag.name === "Reflect") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Reflect was prevented`);
                else {
                    queueToEnemy({ name: "Reflect", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} reflects ${pct}% damage for 2 rounds`);
                }
            }
            if (tag.name === "Lifesteal") {
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s Lifesteal was prevented`);
                else {
                    queueToEnemy({ name: "Lifesteal", rounds: 2, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} will heal ${pct}% of damage dealt for 2 rounds`);
                }
            }
            if (tagMatchesName(tag.name, "Ignition")) {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists Ignition`);
                else {
                    queueToPlayer({ name: "Ignition", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`Ignition: ${character.name} takes ${pct}% extra damage for 2 rounds.`);
                }
            }
            if (tag.name === "Stun") {
                if (activeStatuses(playerStatuses).some((s) => s.name === "Stun Prevent")) effectLines.push(`${character.name} resisted stun`);
                else if (playerDebuffPrevented) effectLines.push(`${character.name} prevents stun`);
                else {
                    pendingPlayerStunApPenaltyRef.current = true;
                    queueToPlayer({ name: "Stun", rounds: 1, kind: "negative" });
                    effectLines.push(`Stun: ${character.name} loses ${STUN_AP_PENALTY} AP on their next turn`);
                }
            }
            if (tag.name === "Bloodline Seal" || tag.name === "Seal") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents bloodline seal`);
                else {
                    queueToPlayer({ name: "Bloodline Seal", rounds: 2, kind: "negative" });
                    effectLines.push(`${character.name}'s bloodline is sealed for 2 rounds`);
                }
            }
            if (tag.name === "Elemental Seal") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents elemental seal`);
                else {
                    queueToPlayer({ name: "Elemental Seal", rounds: 1, kind: "negative" });
                    effectLines.push(`${character.name}'s elemental jutsu are sealed for 1 round`);
                }
            }
            if (tag.name === "Decrease Damage Given") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents damage given debuff`);
                else {
                    queueToPlayer({ name: "Decrease Damage Given", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name}'s damage given is decreased by ${pct}%`);
                }
            }
            if (tag.name === "Increase Damage Taken") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents damage taken debuff`);
                else {
                    queueToPlayer({ name: "Increase Damage Taken", rounds: AMP_STATUS_ROUNDS_PVE, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name}'s damage taken is increased by ${pct}%`);
                }
            }
            if (tag.name === "Copy") {
                const copied = activeStatuses(playerStatuses).filter((s) => s.kind === "positive");
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s copy was prevented`);
                else if (copied.length) {
                    setEnemyStatuses((s) => copied.reduce((acc, status) => mergeCombatStatus(acc, deferEnemyStatus({ ...status, rounds: Math.min(2, status.rounds) })), s));
                    effectLines.push(`${opponentName} copies ${copied.length} positive effect(s)`);
                } else effectLines.push("no positive effects to copy");
            }
            if (tag.name === "Mirror") {
                const mirrored = activeStatuses(enemyStatuses).filter((s) => s.kind === "negative" && s.name !== "Wound" && s.name !== "Poison" && s.name !== "Drain" && !statusMatchesName(s, "Ignition"));
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents mirrored debuffs`);
                else if (mirrored.length) {
                    setPlayerStatuses((s) => mirrored.reduce((acc, status) => mergeCombatStatus(acc, deferEnemyStatus({ ...status, rounds: Math.min(2, status.rounds) })), s));
                    effectLines.push(`${opponentName} mirrors ${mirrored.length} negative effect(s)`);
                } else effectLines.push("no negative effects to mirror");
            }
            if (tag.name === "Buff Prevent") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents Buff Prevent`);
                else {
                    queueToPlayer({ name: "Buff Prevent", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name} cannot gain positive effects for 2 rounds`);
                }
            }

            if (tag.name === "Cleanse Prevent") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents Cleanse Prevent`);
                else {
                    queueToPlayer({ name: "Cleanse Prevent", rounds: 2, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name} cannot cleanse debuffs for 2 rounds`);
                }
            }

            if (["Clear Prevent", "Overclock", "Increase Heal"].includes(normalizeTagName(tag.name))) {
                const statusName = normalizeTagName(tag.name);
                const statusRounds = statusName === "Overclock" ? 1 : 2;
                if (enemyBuffPrevented) effectLines.push(`${opponentName}'s ${statusName} was prevented`);
                else {
                    queueToEnemy({ name: statusName, rounds: statusRounds, percent: pct, kind: "positive" });
                    effectLines.push(`${opponentName} gains ${statusName} for ${statusRounds} round${statusRounds === 1 ? "" : "s"}`);
                }
            }
            // Defensive self-Prevents are unconditional (see api/pvp/move.ts) — not
            // gated by Buff Prevent, matching the player path.
            if (tag.name === "Stun Prevent") {
                queueToEnemy({ name: "Stun Prevent", rounds: 2, percent: pct, kind: "positive" });
                effectLines.push(`${opponentName} gains Stun Prevent for 2 rounds`);
            }
            if (tag.name === "Debuff Prevent") {
                queueToEnemy({ name: "Debuff Prevent", rounds: 2, percent: pct, kind: "positive" });
                effectLines.push(`${opponentName} gains Debuff Prevent for 2 rounds`);
            }
            if (tagMatchesName(tag.name, "Lag")) {
                if (playerDebuffPrevented) effectLines.push(`${character.name} prevents Lag`);
                else {
                    queueToPlayer({ name: "Lag", rounds: 1, percent: pct, kind: "negative" });
                    effectLines.push(`${character.name} suffers Lag for 1 round`);
                }
            }
            // Displacement — the enemy moves the PLAYER (Push away / Pull toward)
            // or repositions itself (Move). Mirrors the player cast path (inverted
            // source/target) and gates Push/Pull on the player's Debuff Prevent,
            // matching api/pvp/move.ts. Previously absent: an AI jutsu carrying
            // these tags silently did nothing.
            if (tag.name === "Push") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists Push`);
                else {
                    const pushDist = Math.max(1, Number(jutsu.range) || 1);
                    let newPos = playerPos;
                    for (let step = 0; step < pushDist; step++) {
                        const away = hexNeighbors(newPos).filter((t) => distance(t, enemyPos) > distance(newPos, enemyPos) && t !== enemyPos && t >= 0 && t < gridWidth * gridHeight);
                        if (away.length === 0) break;
                        newPos = away[0];
                    }
                    if (newPos !== playerPos) setPlayerPos(newPos);
                    effectLines.push(`${character.name} is pushed ${pushDist} tile(s) away.`);
                }
            }
            if (tag.name === "Pull") {
                if (playerDebuffPrevented) effectLines.push(`${character.name} resists Pull`);
                else {
                    const pullDist = Math.max(1, Number(jutsu.range) || 1);
                    let newPos = playerPos;
                    for (let step = 0; step < pullDist; step++) {
                        const toward = hexNeighbors(newPos).filter((t) => distance(t, enemyPos) < distance(newPos, enemyPos) && t !== enemyPos && t >= 0 && t < gridWidth * gridHeight);
                        if (toward.length === 0) break;
                        newPos = toward[0];
                    }
                    if (newPos !== playerPos) setPlayerPos(newPos);
                    effectLines.push(`${character.name} is pulled ${pullDist} tile(s) closer.`);
                }
            }
            if (tag.name === "Move") {
                const stepToward = hexNeighbors(enemyPos)
                    .filter((t) => t !== playerPos && t >= 0 && t < gridWidth * gridHeight)
                    .sort((a, b) => distance(a, playerPos) - distance(b, playerPos))[0];
                if (stepToward !== undefined && stepToward !== enemyPos) setEnemyPos(stepToward);
                effectLines.push(`${opponentName} shifts position`);
            }
        });

        // Keep AI ground jutsu on the field just like player ground jutsu.
        // Previously the visual played, but the enemy patch vanished immediately.
        if (jutsu.target === "EMPTY_GROUND" && jutsu.method === "INSTANT_EFFECT") {
            const zoneTags = jutsu.tags
                .map((tag) => ({ name: normalizeTagName(tag.name), percent: tag.percent }))
                .filter((tag) => GROUND_ZONE_TAGS.has(tag.name));
            if (zoneTags.length) {
                const tiles = [playerPos, ...hexNeighbors(playerPos)];
                setGroundZones((zones) => [...zones, {
                    id: `gz-enemy-${jutsu.id}-${turn}-${zones.length}`,
                    owner: "enemy",
                    tiles,
                    rounds: 2,
                    tags: zoneTags,
                }]);
                effectLines.push(`${jutsu.name} leaves a lingering zone for 2 rounds.`);
            }
        }

        // IDG/IDT/Ignition/DDG/DDT are already folded into `damage` by the
        // soft-cap pools inside calculateDamage (the player path does the same and
        // voids the old multiplicativeTagMultiplier pass). Re-applying them here
        // double-counted every amp/debuff — removed. Pierce bypasses shield.
        const pierce = jutsu.tags?.some((t) => t.name === "Pierce") ?? false;
        const blocked = pierce ? 0 : Math.min(playerShield, damage);
        const finalDamage = Math.max(0, damage - blocked);
        // Siphon: enemy heals a capped % of damage dealt (post-damage, self-contained).
        const siphonTag = jutsu.tags.find((t) => t.name === "Siphon");
        if (siphonTag) {
            const restored = Math.floor(cappedPostDamage(finalDamage, effectiveTagPercent(siphonTag, jutsu.bloodlineRank, pveAiMastery)));
            healing += restored;
            if (restored > 0) effectLines.push(`Siphon: ${opponentName} restores ${restored} HP`);
        }
        // Lifesteal: enemy heals a % of damage it deals while its Lifesteal buff is active.
        const enemyLsPct = sumActiveStatusPct(enemyStatuses, "Lifesteal");
        if (enemyLsPct > 0 && finalDamage > 0) {
            const lsHeal = Math.floor(cappedPostDamage(finalDamage, enemyLsPct));
            if (lsHeal > 0) { healing += lsHeal; effectLines.push(`Lifesteal: ${opponentName} restores ${lsHeal} HP`); }
        }
        // Player defensive buffs vs the enemy's JUTSU. Previously ONLY the enemy
        // basic-attack path honored these, so a player's Absorb/Reflect did nothing
        // against enemy jutsu (their main attack). Absorb converts a capped % of the
        // hit into avoided damage; Reflect bounces a capped % back to the enemy.
        // Pierce bypasses both. Mirrors the enemy basic-attack path (3357+).
        const pStatusAbsorbPct = pierce ? 0 : sumActiveStatusPct(playerStatuses, "Absorb");
        const pStatusAbsorbed = pStatusAbsorbPct > 0 ? cappedPostDamage(finalDamage, pStatusAbsorbPct) : 0;
        const pItemAbsorbed = (!pierce && equippedAbsorbPercent > 0) ? Math.floor(cappedPostDamage(finalDamage, equippedAbsorbPercent)) : 0;
        const pAbsorbed = Math.min(finalDamage, pStatusAbsorbed + pItemAbsorbed);
        const pStatusReflectPct = pierce ? 0 : sumActiveStatusPct(playerStatuses, "Reflect");
        const pStatusReflected = pStatusReflectPct > 0 ? Math.floor(cappedPostDamage(finalDamage, pStatusReflectPct)) : 0;
        const pItemReflected = (!pierce && equippedReflectPercent > 0) ? Math.floor(cappedPostDamage(finalDamage, equippedReflectPercent)) : 0;
        const pReflected = pStatusReflected + pItemReflected;
        const playerNetTaken = Math.max(0, finalDamage - pAbsorbed + extraDamage);
        // Enemy Recoil debuff (the player applied it): the enemy hurts itself when
        // it attacks. Previously NEVER consumed — a player-cast Recoil on the enemy
        // was a complete no-op. Mirrors the player's own Recoil self-damage.
        const enemyRecoil = activeStatuses(enemyStatuses).find((s) => s.name === "Recoil");
        const enemyRecoilDmg = (enemyRecoil && finalDamage > 0) ? Math.floor(cappedPostDamage(finalDamage, enemyRecoil.percent ?? 30)) : 0;
        // combatResourcesV2: enemy Poison feeds on exertion. The enemy pays no resource
        // cost in PvE, so scale off the jutsu's v2 cost for its level.
        const enemyPoisonPct = COMBAT_RESOURCES_V2 ? sumActiveStatusPct(enemyStatuses, "Poison", 6) : 0;
        const enemyPoisonSpend = (enemyPoisonPct > 0 && (((jutsu.chakraCost ?? 0) > 0) || ((jutsu.staminaCost ?? 0) > 0))) ? v2JutsuResourceCost(jutsu.ap ?? 0, opponentLevel) : 0;
        const enemyPoisonSpendDmg = enemyPoisonSpend > 0 ? v2PoisonOnSpend(enemyPoisonSpend, enemyPoisonPct) : 0;
        setPlayerShield((s) => Math.max(0, s - blocked));
        setPlayerHp((hp) => Math.max(0, hp - playerNetTaken));
        queueHitFx("p", playerNetTaken, "damage");
        setEnemyHp((hp) => Math.min(enemyMaxHp, hp + healing));
        queueHitFx("e", healing, "heal");
        if (pReflected > 0) {
            setEnemyHp((hp) => Math.max(0, hp - pReflected));
        }
        queueHitFx("e", pReflected, "damage");
        if (enemyRecoilDmg > 0) {
            setEnemyHp((hp) => Math.max(0, hp - enemyRecoilDmg));
        }
        queueHitFx("e", enemyRecoilDmg, "damage");
        if (enemyPoisonSpendDmg > 0) {
            setEnemyHp((hp) => Math.max(0, hp - enemyPoisonSpendDmg));
            queueHitFx("e", enemyPoisonSpendDmg, "damage");
        }
        setEnemyShield((s) => s + shield);
        setEnemyJutsuCooldowns((current) => ({ ...current, [jutsu.id]: Math.max(1, jutsu.cooldown || 1) }));
        updateCharacter({ ...character, hp: Math.max(0, playerHp - playerNetTaken) });
        const enemyFlavorText = interpolateFlavor(
            jutsu.battleDescription?.trim() ||
            jutsu.description?.trim() ||
            `${opponentName} uses ${jutsu.name}.`,
            opponentName, character.name);

        const enemyTimelineParts = [
            `${jutsu.name}: ${enemyFlavorText}`,
            playerNetTaken > 0 ? `Damage Dealt: ${character.name} takes ${playerNetTaken} damage.` : "",
            pAbsorbed > 0 ? `Absorb: ${character.name} absorbs ${pAbsorbed} damage.` : "",
            pReflected > 0 ? `Reflect: ${opponentName} takes ${pReflected} reflected damage.` : "",
            enemyRecoilDmg > 0 ? `Recoil: ${opponentName} takes ${enemyRecoilDmg} recoil damage.` : "",
            enemyPoisonSpendDmg > 0 ? `Poison: ${opponentName} takes ${enemyPoisonSpendDmg} damage from exertion.` : "",
            blocked > 0 ? `Shield: ${character.name}'s shield blocks ${blocked} damage.` : "",
            healing > 0 ? `Heal: ${opponentName} restores ${healing} HP.` : "",
            shield > 0 ? `Shield: ${opponentName} gains ${shield} shield.` : "",
            ...effectLines,
        ].filter(Boolean).join("\n");

        addCombatLog(enemyTimelineParts, jutsu.id, opponentName);
        triggerCombatFx(jutsu, {
            selfCast: isSelfSupportJutsu(jutsu),
            focusPos: isSelfSupportJutsu(jutsu) ? enemyPos : playerPos,
            heavy: playerNetTaken >= Math.max(1, character.maxHp) * 0.18,
            isKO: playerHp - playerNetTaken <= 0,
            area: jutsu.method === "AOE_CIRCLE" || jutsu.method === "AOE_SPIRAL" || jutsu.method === "AOE_BURST",
            ground: jutsu.target === "EMPTY_GROUND",
        });
        setLog(`${opponentName} used ${jutsu.name}.`);

        // Player's Reflect can kill the enemy on the enemy's own turn — register
        // the win immediately instead of waiting for the player's next action.
        // winBattle() returns void, so set it then return true (the caller treats
        // true as "acted"; battleEnded guards stop any further enemy action).
        if (enemyHp + healing - pReflected - enemyRecoilDmg <= 0 && playerHp - playerNetTaken > 0) {
            winBattle();
            return true;
        }
        if (playerHp - playerNetTaken <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} was defeated.`);
            addCombatLog(`${opponentName} defeats ${character.name}.`, "defeat", opponentName);
            if (rankedBattleActive) applyRankedLoss();
            else updateCharacter({ ...character, hp: 0, hospitalized: true });
        }
        return true;
    }

    // ── Multi-action enemy turn (Phase 0) ──────────────────────────────────
    // The enemy now spends its full 100-AP / 5-action budget instead of taking
    // one action and ending. enemyTurn() does the once-per-turn start bookkeeping
    // then takes the first action; afterEnemyAction schedules the next via
    // enemyContinueRef (so each follow-up reads FRESH committed state); when the
    // budget is spent, endEnemyTurn() runs the once-per-turn end bookkeeping and
    // hands the turn back. AP costs / damage / tags are byte-identical to before
    // — only the NUMBER and SEQUENCING of actions changed.

    // Cheapest AP an enemy action could still cost this turn (mirrors the player's
    // pveMinActionCost). Drives the auto-end: once the enemy can't afford even the
    // cheapest move, the turn ends.
    function enemyMinActionCost(): number {
        const dist = distance(playerPos, enemyPos);
        const costs: number[] = [dist <= 1 ? 40 : 30]; // basic strike (adjacent) or a 30-AP step to close
        for (const j of enemyAiJutsus) {
            if ((enemyJutsuCooldowns[j.id] ?? 0) > 0) continue;
            if (j.target !== "SELF" && j.range > 0 && dist > j.range) continue;
            costs.push(j.ap);
        }
        return Math.min(...costs);
    }

    // Reactive Clear (Phase 2): the enemy strips the player's positive effects,
    // mirroring the player's clearEnemyPositiveEffects but in the other direction.
    // Costs 60 AP and a 10-turn enemy cooldown (tracked in enemyJutsuCooldowns).
    function enemyClearPlayerBuffs() {
        if (activeStatuses(playerStatuses).some((s) => s.name === "Clear Prevent")) {
            addCombatLog(`${character.name}'s Clear Prevent blocks ${opponentName}'s clear attempt.`, "clear", character.name);
            setEnemyJutsuCooldowns((c) => ({ ...c, clear: 10 }));
            return;
        }
        const removed = playerStatuses.filter((s) => s.kind === "positive").map((s) => s.name);
        setPlayerStatuses((statuses) => statuses.filter((s) => s.kind !== "positive"));
        setEnemyJutsuCooldowns((c) => ({ ...c, clear: 10 }));
        setLog(`${opponentName} clears your buffs.`);
        addCombatLog(`Clear: ${opponentName} removes ${character.name}'s positive effects${removed.length ? `: ${removed.join(", ")}` : "."}`, "clear", opponentName);
    }

    // Reactive Cleanse (Phase 2): the enemy sheds its own negative effects,
    // mirroring the player's cleansePlayerNegativeEffects.
    function enemyCleanseSelf() {
        if (activeStatuses(enemyStatuses).some((s) => s.name === "Cleanse Prevent")) {
            addCombatLog(`${opponentName}'s cleanse was prevented.`, "cleanse", opponentName);
            setEnemyJutsuCooldowns((c) => ({ ...c, cleanse: 10 }));
            return;
        }
        const removed = enemyStatuses.filter((s) => s.kind === "negative").map((s) => s.name);
        setEnemyStatuses((statuses) => statuses.filter((s) => s.kind !== "negative"));
        setEnemyJutsuCooldowns((c) => ({ ...c, cleanse: 10 }));
        setLog(`${opponentName} cleanses itself.`);
        addCombatLog(`Cleanse: ${opponentName} removes its negative effects${removed.length ? `: ${removed.join(", ")}` : "."}`, "cleanse", opponentName);
    }

    // One enemy basic action: step toward the player (30 AP) when out of range,
    // else strike (40 AP). Honors the player's Absorb/Reflect/Recoil and the
    // enemy's Lifesteal exactly as before; registers a player-Reflect win / a
    // player KO. Does NOT run end-of-turn — endEnemyTurn does that once the whole
    // turn is spent. Returns the AP spent (0 if it could do nothing).
    function enemyBasicAttackOrMove(): number {
        if (distance(playerPos, enemyPos) > 1) {
            const next = nextStepToward(enemyPos, playerPos);
            if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos) setEnemyPos(next);
            setLog("Enemy moved closer across the grid.");
            addCombatLog(`${opponentName} moves closer across the battlefield.`, "move", opponentName);
            return 30;
        }
        const enemyBasicJutsu = makeJutsu("enemy-basic-strike", "Enemy Strike", "Taijutsu", 40, 1, 100, 0, 0, 0, [], "Earth");
        let enemyDamage = calculateDamage(
            enemyBasicJutsu,
            enemyCombatStats,
            characterCombatStats,
            character.maxHp,
            activeBloodlineMultiplier(opponentCharacter, enemyStatuses),
            playerArmorFactor,
            1.0,
            weatherDamageMultiplier(enemyBasicJutsu) * biomeTerrainMultiplier(enemyBasicJutsu),
            activeStatuses(enemyStatuses),
            activeStatuses(playerStatuses),
            pveAiMastery,
        );
        if (activeStatuses(enemyStatuses).some((s) => s.name === "Bloodline Seal" || s.name === "Seal" || s.name === "Elemental Seal")) {
            enemyDamage = Math.floor(enemyDamage * 0.85);
        }
        enemyDamage = guardEnemyHit(enemyDamage);
        const blocked = Math.min(playerShield, enemyDamage);
        const finalDamage = enemyDamage - blocked;
        const statusAbsorbPct = sumActiveStatusPct(playerStatuses, "Absorb");
        const itemAbsorbed = equippedAbsorbPercent > 0 ? Math.floor(cappedPostDamage(finalDamage, equippedAbsorbPercent)) : 0;
        const statusAbsorbed = statusAbsorbPct > 0 ? cappedPostDamage(finalDamage, statusAbsorbPct) : 0;
        const absorbed = Math.min(finalDamage, itemAbsorbed + statusAbsorbed);
        const statusReflectPct = sumActiveStatusPct(playerStatuses, "Reflect");
        const statusReflected = statusReflectPct > 0 ? cappedPostDamage(finalDamage, statusReflectPct) : 0;
        const itemReflected = equippedReflectPercent > 0 ? Math.floor(cappedPostDamage(finalDamage, equippedReflectPercent)) : 0;

        setPlayerShield((s) => Math.max(0, s - blocked));
        setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp - finalDamage + absorbed)));
        queueHitFx("p", Math.max(0, finalDamage - absorbed), "damage");
        if (statusReflected > 0) {
            setEnemyHp((hp) => Math.max(0, hp - statusReflected));
            queueHitFx("e", statusReflected, "damage");
            addCombatLog(`Reflect: ${opponentName} takes ${statusReflected} reflected damage.`, "reflect", character.name);
        }
        if (itemReflected > 0) {
            setEnemyHp((hp) => Math.max(0, hp - itemReflected));
            queueHitFx("e", itemReflected, "damage");
            addCombatLog(`Reflect (armor): ${opponentName} takes ${itemReflected} reflected damage.`, "reflect", character.name);
        }
        const enemyDealtToPlayer = Math.max(0, finalDamage - absorbed);
        const basicEnemyLsPct = sumActiveStatusPct(enemyStatuses, "Lifesteal");
        if (basicEnemyLsPct > 0 && enemyDealtToPlayer > 0) {
            const lsHeal = Math.floor(cappedPostDamage(enemyDealtToPlayer, basicEnemyLsPct));
            if (lsHeal > 0) { setEnemyHp((hp) => Math.min(enemyMaxHp, hp + lsHeal)); queueHitFx("e", lsHeal, "heal"); addCombatLog(`Lifesteal: ${opponentName} restores ${lsHeal} HP.`, "effects", opponentName); }
        }
        const basicEnemyRecoil = activeStatuses(enemyStatuses).find((s) => s.name === "Recoil");
        const basicEnemyRecoilDmg = (basicEnemyRecoil && finalDamage > 0) ? Math.floor(cappedPostDamage(finalDamage, basicEnemyRecoil.percent ?? 30)) : 0;
        if (basicEnemyRecoilDmg > 0) {
            setEnemyHp((hp) => Math.max(0, hp - basicEnemyRecoilDmg));
            queueHitFx("e", basicEnemyRecoilDmg, "damage");
            addCombatLog(`Recoil: ${opponentName} takes ${basicEnemyRecoilDmg} recoil damage.`, "reflect", character.name);
        }
        if (enemyHp - statusReflected - itemReflected - basicEnemyRecoilDmg <= 0 && playerHp - finalDamage + absorbed > 0) {
            winBattle();
            return 40;
        }
        updateCharacter({ ...character, hp: Math.max(0, Math.min(character.maxHp, playerHp - finalDamage + absorbed)) });
        if (playerHp - finalDamage + absorbed <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} was defeated.`);
            addCombatLog(`${opponentName} defeats ${character.name}.`, "defeat", opponentName);
            if (rankedBattleActive) applyRankedLoss();
            return 40;
        }
        setLog(`Enemy attacked for ${finalDamage}.`);
        addCombatLog(`${opponentName} attacks ${character.name} for ${finalDamage} damage.${blocked ? ` Shield blocks ${blocked}.` : ""}${absorbed ? ` Absorb restores ${absorbed}.` : ""}`, "basicAttack", opponentName);
        return 40;
    }

    // ── Enemy targeting the summoned pet (Stage 3) ────────────────────────────
    // The pet is a real, attackable unit: the enemy sometimes strikes it instead
    // of the player. This is an ADDITIVE parallel path — the player-targeted
    // enemyUseAiJutsu / enemyBasicAttackOrMove internals are untouched. Pet damage
    // never routes through guardEnemyHit (that's the enemy's budget vs the player).

    // Remove a KO'd pet from the field WITHOUT ending the fight (only the player
    // going down loses the battle).
    function petKnockedOut() {
        const petName = summonedPet ? petDisplayName(summonedPet) : "The pet";
        setPetHp(0);
        setSummonedPetId("");
        setPetTurnsRemaining(0);
        petActingRef.current = false;
        if (petPhaseTimerRef.current !== null) { window.clearTimeout(petPhaseTimerRef.current); petPhaseTimerRef.current = null; }
        setLog(`${petName} is knocked out!`);
        addCombatLog(`${opponentName} knocks out ${petName}. The fight continues.`, "petKO", opponentName);
    }

    // Does the enemy go after the pet this action? Mostly the player; more likely
    // the pet when it's low (easy KO) or nearer; the easy band leans back to you.
    function enemyPickTarget(): "player" | "pet" {
        if (!isPetAlive) return "player";
        let petWeight = 0.32;
        if (distance(enemyPos, petPos) < distance(enemyPos, playerPos)) petWeight += 0.15;
        if (petMaxHp > 0 && petHp / petMaxHp < 0.4) petWeight += 0.2;
        if (isStandardPve && opponentLevel <= 20) petWeight -= 0.1;
        return Math.random() < Math.max(0, Math.min(0.7, petWeight)) ? "pet" : "player";
    }

    // Pet-directed clone of enemyBasicAttackOrMove: step toward the pet, or strike
    // it. Damage is a share of the pet's max HP (folds under focus in ~3-4 hits),
    // reduced by the pet's own Decrease-Damage-Taken / Absorb buffs + shield.
    function enemyBasicAttackOrMovePet(): number {
        if (!isPetAlive) return enemyBasicAttackOrMove();
        const petName = summonedPet ? petDisplayName(summonedPet) : "your pet";
        if (distance(petPos, enemyPos) > 1) {
            const next = nextStepTowardFor(enemyPos, petPos, [playerPos]);
            if (next >= 0 && next < gridWidth * gridHeight && next !== petPos && next !== playerPos) setEnemyPos(next);
            setLog(`${opponentName} moves toward ${petName}.`);
            addCombatLog(`${opponentName} moves toward ${petName}.`, "move", opponentName);
            return 30;
        }
        const band = opponentLevel >= 80 ? 0.3 : opponentLevel >= 40 ? 0.26 : 0.22;
        let dmg = Math.max(1, Math.floor(petMaxHp * band * (0.85 + Math.random() * 0.3)));
        const ddtPct = petStatuses.filter((s) => s.name === "Decrease Damage Taken").reduce((a, s) => a + (s.percent || 0), 0);
        if (ddtPct > 0) dmg = Math.floor(dmg * (1 - Math.min(60, ddtPct) / 100));
        const absorbPct = petStatuses.filter((s) => s.name === "Absorb").reduce((a, s) => a + (s.percent || 0), 0);
        if (absorbPct > 0) dmg = Math.max(0, dmg - Math.floor(dmg * Math.min(60, absorbPct) / 100));
        const blocked = Math.min(petShield, dmg);
        if (blocked > 0) { setPetShield((s) => Math.max(0, s - blocked)); dmg -= blocked; }
        dmg = Math.max(0, dmg);
        const newPetHp = Math.max(0, petHp - dmg);
        setPetHp(newPetHp);
        setLog(`${opponentName} strikes ${petName} for ${dmg}.`);
        addCombatLog(`${opponentName} attacks ${petName} for ${dmg} damage${blocked ? ` (${blocked} blocked)` : ""}.`, "enemyAttackPet", opponentName);
        if (newPetHp <= 0) petKnockedOut();
        return 40;
    }

    // Pick + execute ONE enemy action. Reactive counter-play (Clear/Cleanse) is
    // tried first, gated by band competence (pveAiCompetence) and the player read
    // (buildPlayerRead) — standard PvE only, so PvP/ranked/endless are untouched.
    // Then the existing rule engine, the opponentCharacter fallback, and finally
    // a basic attack / step. Returns whether it acted and the AP it spent.
    function enemyTakeAction(availableAp: number): { acted: boolean; apSpent: number } {
        if (battleEnded) return { acted: false, apSpent: 0 };

        // Target selection: the enemy sometimes goes after the summoned pet instead
        // of the player (a step toward it / a basic strike). The player-directed
        // logic below is unchanged.
        if (enemyPickTarget() === "pet") {
            const apSpent = enemyBasicAttackOrMovePet();
            return { acted: apSpent > 0, apSpent };
        }

        if (isStandardPve) {
            const comp = pveAiCompetence(opponentLevel, pendingAiProfile?.masterAi);
            const read = buildPlayerRead({
                turn,
                hp: playerHp,
                maxHp: character.maxHp,
                ap,
                shield: playerShield,
                statuses: activeStatuses(playerStatuses),
                recentActions: playerActionLogRef.current,
            });
            // Clear the player's buffs once they've stacked enough — or the moment
            // they power up, if this band reads playstyle (hard/peer).
            const clearThreshold = comp.readsBehavior && read.justPoweredUp ? 1 : comp.clearBuffThreshold;
            if (Number.isFinite(clearThreshold) && read.meaningfulBuffCount >= clearThreshold && availableAp >= 60 && (enemyJutsuCooldowns["clear"] ?? 0) <= 0) {
                enemyClearPlayerBuffs();
                return { acted: true, apSpent: 60 };
            }
            // Shed our own debuffs when heavily afflicted.
            if (Number.isFinite(comp.cleanseSelfThreshold) && availableAp >= 60 && (enemyJutsuCooldowns["cleanse"] ?? 0) <= 0) {
                const selfDebuffs = activeStatuses(enemyStatuses).filter((s) => s.kind === "negative").length;
                if (selfDebuffs >= comp.cleanseSelfThreshold) {
                    enemyCleanseSelf();
                    return { acted: true, apSpent: 60 };
                }
            }
        }

        if (pendingAiProfile) {
            const matchedRules = pendingAiProfile.rules.filter(aiRuleMatches);
            for (const rule of matchedRules) {
                const specificJutsu = rule.jutsuId ? enemyAiJutsus.find((jutsu) => jutsu.id === rule.jutsuId) : undefined;
                const chosenJutsu = rule.action === "use_specific_jutsu" ? specificJutsu : rule.action === "use_highest_power_jutsu" ? highestPowerAiJutsu(availableAp) : undefined;
                if (chosenJutsu && enemyUseAiJutsu(chosenJutsu, availableAp)) {
                    return { acted: true, apSpent: chosenJutsu.ap };
                }
                if (rule.action === "clear_player_buffs" && isStandardPve && availableAp >= 60 && (enemyJutsuCooldowns["clear"] ?? 0) <= 0 && activeStatuses(playerStatuses).some((s) => s.kind === "positive")) {
                    enemyClearPlayerBuffs();
                    return { acted: true, apSpent: 60 };
                }
                if (rule.action === "cleanse_self" && isStandardPve && availableAp >= 60 && (enemyJutsuCooldowns["cleanse"] ?? 0) <= 0 && activeStatuses(enemyStatuses).some((s) => s.kind === "negative")) {
                    enemyCleanseSelf();
                    return { acted: true, apSpent: 60 };
                }
                if (rule.action === "defend") {
                    const defJ = enemyAiJutsus.find((j) => isSelfSupportJutsu(j) && j.ap <= availableAp && (enemyJutsuCooldowns[j.id] ?? 0) <= 0 && (j.target === "SELF" || j.range <= 0 || distance(playerPos, enemyPos) <= j.range));
                    if (defJ && enemyUseAiJutsu(defJ, availableAp)) return { acted: true, apSpent: defJ.ap };
                }
                if (rule.action === "move_towards_opponent" && distance(playerPos, enemyPos) > 1) {
                    const next = nextStepToward(enemyPos, playerPos);
                    if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos && !barrierTiles.some((b) => b.tile === next)) setEnemyPos(next);
                    setLog(`${opponentName} moves closer.`);
                    addCombatLog(`${opponentName} moves toward ${character.name}.`, "move", opponentName);
                    return { acted: true, apSpent: 30 }; // a positioning step costs the move AP
                }
                if (rule.action === "use_basic_attack" && distance(playerPos, enemyPos) <= 1) {
                    break;
                }
            }
        }

        if (opponentCharacter && enemyAiJutsus.length > 0) {
            const chosenJutsu = highestPowerAiJutsu(availableAp);
            if (chosenJutsu && enemyUseAiJutsu(chosenJutsu, availableAp)) {
                addCombatLog(`${opponentName} uses an equipped player jutsu.`, chosenJutsu.id, opponentName);
                return { acted: true, apSpent: chosenJutsu.ap };
            }
            if (distance(playerPos, enemyPos) > 1) {
                const next = nextStepToward(enemyPos, playerPos);
                if (next >= 0 && next < gridWidth * gridHeight && next !== playerPos && !barrierTiles.some((b) => b.tile === next)) setEnemyPos(next);
                setLog(`${opponentName} moves closer.`);
                addCombatLog(`${opponentName} moves toward ${character.name}.`, "move", opponentName);
                return { acted: true, apSpent: 30 };
            }
        }

        const apSpent = enemyBasicAttackOrMove();
        return { acted: apSpent > 0, apSpent };
    }

    // After an action: debit the budget and either schedule the next action (so it
    // reads fresh committed state via enemyContinueRef) or end the turn. A failed
    // or zero-cost action ends the turn so the loop always makes progress.
    function afterEnemyAction(res: { acted: boolean; apSpent: number }) {
        if (battleEnded) { enemyTurnActiveRef.current = false; return; }
        if (!res.acted || res.apSpent <= 0) { endEnemyTurn(); return; }
        enemyTurnApRef.current = Math.max(0, enemyTurnApRef.current - res.apSpent);
        enemyTurnActionsRef.current += 1;
        setEnemyAp(enemyTurnApRef.current);
        // Beat between chained actions: lets React commit (so the next action
        // reads fresh state) and gives the fight a readable rhythm. ~500ms for a
        // combat action (was 850ms); a pure repositioning step (apSpent === 30 —
        // the only 30-AP action; attacks are 40, jutsu ≥40, clear/cleanse 60)
        // gets a near-instant beat so walking toward the player adds no dead air.
        // Tracked so an unmount can cancel the chain (see the cleanup effect).
        const beat = res.apSpent === 30 ? (combatFastRef.current ? 0 : 150) : (combatFastRef.current ? 250 : 500);
        enemyTurnTimerRef.current = window.setTimeout(() => {
            enemyTurnTimerRef.current = null;
            enemyContinueRef.current();
        }, beat);
    }

    // Scheduled continuation — runs in a fresh render so it sees committed state.
    function enemyContinue() {
        if (battleEnded) { enemyTurnActiveRef.current = false; return; }
        if (!enemyTurnActiveRef.current) return;
        if (enemyTurnActionsRef.current >= 5 || enemyTurnApRef.current < enemyMinActionCost()) {
            endEnemyTurn();
            return;
        }
        afterEnemyAction(enemyTakeAction(enemyTurnApRef.current));
    }

    // Once-per-turn end bookkeeping (was finishEnemyAiAction + the basic-attack
    // tail, now unified). Player DoT ticks only for statuses ACTIVE this turn
    // (activeRound <= turn), so a DoT applied earlier in THIS multi-action turn
    // defers to next turn — reproducing the old commit-timing deferral now that
    // end-of-turn runs in a post-commit closure.
    function endEnemyTurn() {
        enemyTurnActiveRef.current = false;
        if (battleEnded) return;
        setEnemyStatuses((s) => tickStatuses(s));
        const playerStunned = pendingPlayerStunApPenaltyRef.current || playerStatuses.some((s) => s.name === "Stun");
        pendingPlayerStunApPenaltyRef.current = false;
        // Enemy-owned patches get exactly one lifetime tick when the player's turn
        // begins. Player-owned patches are untouched here and advance at enemyTurn.
        const playerZoneTurn = advancePveGroundZonesForTurn(groundZones, "player", playerPos);
        const playerZoneHits = playerZoneTurn.hits;
        const playerZoneStatuses: CombatStatus[] = [];
        if (playerZoneHits.length && !activeStatuses(playerStatuses).some((status) => status.name === "Debuff Prevent")) {
            const zoneNotes: string[] = [];
            for (const zone of playerZoneHits) {
                for (const tag of zone.tags) {
                    const status = pveGroundZoneDebuff(tag, COMBAT_RESOURCES_V2);
                    if (!status) continue;
                    playerZoneStatuses.push(status);
                    if (status.name === "Decrease Damage Given") zoneNotes.push(`−${status.percent}% damage`);
                    else if (status.name === "Recoil") zoneNotes.push("recoil");
                    else zoneNotes.push("poison");
                }
            }
            if (playerZoneStatuses.length) {
                addCombatLog(`${character.name} is caught in a ground zone (${[...new Set(zoneNotes)].join(", ")}).`, "effects", opponentName);
            }
        }
        if (groundZones.some((zone) => zone.owner === "enemy")) setGroundZones(playerZoneTurn.zones);
        // DoT damage is summed from statuses ACTIVE this turn at their CURRENT
        // rounds — NOT pre-ticked. Mirrors api/pvp/move.ts applyDoTs, which reads
        // activeStatuses() and applies tick damage separately from the round
        // decrement (the setPlayerStatuses below). Pre-ticking here dropped the
        // final tick, so a 2-round bleed hit only once instead of twice.
        const activeDotPlayerStatuses = withoutStun(playerStatuses).filter((s) => (s.activeRound ?? turn) <= turn);
        // FUNCTIONAL set: ticks the LIVE committed state so debuffs queued this
        // turn (Poison/Drain/Ignition/Seal/Lag/Recoil) are preserved and ticked.
        // Tick the statuses that just completed, then apply the incoming zone.
        // Reversing this order erased 1-round DDG/Recoil before the player could act.
        setPlayerStatuses((prev) => playerZoneStatuses.reduce(
            (statuses, status) => mergeCombatStatus(statuses, status),
            tickStatuses(withoutStun(prev)),
        ));
        const playerDotMit = dotMitigationPVE(armorFactorToRawDr(playerArmorFactor), activeDotPlayerStatuses);
        let pDotDamage = 0;
        let pDrainChakra = 0;
        activeDotPlayerStatuses.filter((s) => s.name !== "Stun").forEach((s) => {
            if (s.name === "Wound") pDotDamage += Math.floor((s.amount || 0) * playerDotMit);
            if (s.name === "Drain") {
                const amt = Math.floor((s.amount ?? 50) * playerDotMit);
                pDotDamage += amt;
                pDrainChakra += amt;
            }
            if (s.name === "Poison" && !COMBAT_RESOURCES_V2) {
                // Legacy per-round pool poison. Under combatResourcesV2 poison has no
                // per-round tick — it triggers on-spend when the player casts (below).
                const raw = s.amount ?? Math.floor(character.maxChakra * (s.percent ?? 6) / 100);
                pDotDamage += Math.floor(raw * playerDotMit);
            }
        });
        // DoT counts toward the enemy-turn budget so a bleed can't slip a player
        // under the easy-band mercy floor.
        pDotDamage = guardEnemyHit(pDotDamage);
        if (pDotDamage > 0) {
            const nextHp = Math.max(0, playerHp - pDotDamage);
            setPlayerHp(nextHp);
            queueHitFx("p", pDotDamage, "damage");
            // combatResourcesV2: player regenerates chakra/stamina at the start of their turn.
            const pRegen = COMBAT_RESOURCES_V2 ? v2ResourceRegen(character.level) : 0;
            const nextChakra = Math.min(character.maxChakra, Math.max(0, character.chakra - (pDrainChakra > 0 ? pDrainChakra : 0)) + pRegen);
            const nextStamina = Math.min(character.maxStamina, character.stamina + pRegen);
            updateCharacter({ ...character, hp: nextHp, chakra: nextChakra, stamina: nextStamina });
            const drainNote = pDrainChakra > 0 ? ` Drain also removes ${pDrainChakra} chakra.` : "";
            addCombatLog(`Damage over time: ${character.name} takes ${pDotDamage} damage from active effects.${drainNote}`, "effects", character.name);
            if (nextHp <= 0) {
                setBattleEnded(true);
                setBattleResult("loss");
                setRaidBattleKind("none");
                setLog(`${character.name} bleeds out from active effects.`);
                addCombatLog(`${character.name} is defeated by damage over time.`, "defeat", opponentName);
                if (rankedBattleActive) applyRankedLoss();
                return;  // don't set up the next turn for a downed player
            }
        } else if (COMBAT_RESOURCES_V2) {
            const pRegen = v2ResourceRegen(character.level);
            updateCharacter({ ...character, chakra: Math.min(character.maxChakra, character.chakra + pRegen), stamina: Math.min(character.maxStamina, character.stamina + pRegen) });
        }
        setBarrierTiles((prev) => prev.map((b) => ({ ...b, rounds: b.rounds - 1 })).filter((b) => b.rounds > 0));
        reduceCooldowns();
        setAp(playerStunned ? Math.max(0, 100 - STUN_AP_PENALTY) : 100);
        setEnemyAp(100);
        setActiveActor("player");
        setActionsThisTurn(0);
        setTurn((t) => t + 1);
        if (playerStunned) {
            addCombatLog(`Stun: ${character.name} starts their turn with ${STUN_AP_PENALTY} less AP.`, "stun", character.name);
        }
    }

    function enemyTurn() {
        if (battleEnded) return;
        if (enemyTurnActiveRef.current) return; // a multi-action enemy turn is already resolving
        setActiveActor("enemy");
        setActionsThisTurn(0);
        // Snapshot HP at the start of the enemy's turn and reset the per-turn
        // damage accumulator — both feed the easy-band mercy floor / per-turn cap
        // in guardEnemyHit, which now bounds the enemy's whole multi-action turn.
        enemyTurnStartHpRef.current = playerHp;
        enemyTurnDealtRef.current = 0;
        const enemyStunned = enemyStatuses.some((s) => s.name === "Stun");
        const enemyLagStatus = enemyStatuses.find((s) => statusMatchesName(s, "Lag"));
        const enemyCompressed = !!enemyLagStatus;
        // Percent-scaled Lag to match PvP (was a flat -10 AP): reduce the turn's AP
        // budget by the Lag percent (the enemy has no per-action cost model). Binary
        // Lag (percent 0) uses the standard 20% via `|| 20`.
        const enemyLagApLoss = enemyLagStatus ? Math.floor(100 * (enemyLagStatus.percent || 20) / 100) : 0;
        const enemyTurnAp = Math.max(0, 100 - (enemyStunned ? STUN_AP_PENALTY : 0) - enemyLagApLoss);
        setEnemyAp(enemyTurnAp);
        if (enemyStunned) {
            setEnemyStatuses((s) => withoutStun(s));
            setLog(`Stun: ${opponentName} loses ${STUN_AP_PENALTY} AP this turn.`);
            addCombatLog(`Stun: ${opponentName} starts their turn with ${STUN_AP_PENALTY} less AP.`, "stun", opponentName);
        }
        if (enemyCompressed) {
            addCombatLog(`Lag: ${opponentName}'s actions cost ${enemyLagStatus?.percent || 20}% more AP this turn.`, "lag", opponentName);
        }

        // Player-owned patches get exactly one lifetime tick when the enemy's turn
        // begins. Enemy-owned patches are untouched here and advance when the
        // player's turn begins in endEnemyTurn().
        const enemyZoneTurn = advancePveGroundZonesForTurn(groundZones, "enemy", enemyPos);
        const enemyZoneHits = enemyZoneTurn.hits;
        if (enemyZoneHits.length && !activeStatuses(enemyStatuses).some((s) => s.name === "Debuff Prevent")) {
            const zoneStatuses: CombatStatus[] = [];
            const zoneNotes: string[] = [];
            for (const z of enemyZoneHits) {
                for (const tag of z.tags) {
                    const status = pveGroundZoneDebuff(tag, COMBAT_RESOURCES_V2);
                    if (!status) continue;
                    zoneStatuses.push(status);
                    if (status.name === "Decrease Damage Given") zoneNotes.push(`−${status.percent}% damage`);
                    else if (status.name === "Recoil") zoneNotes.push("recoil");
                    else zoneNotes.push("poison");
                }
            }
            if (zoneStatuses.length) {
                setEnemyStatuses((s) => zoneStatuses.reduce((acc, st) => mergeCombatStatus(acc, st), s));
                addCombatLog(`${opponentName} is caught in a ground zone (${[...new Set(zoneNotes)].join(", ")}).`, "effects", character.name);
            }
        }
        if (groundZones.some((zone) => zone.owner === "player")) setGroundZones(enemyZoneTurn.zones);

        // DoT DR mitigation (PvE↔PvP parity, mirrors api/pvp/move.ts applyDoTs):
        // ticks scale by (1 - effDR × DR_DOT_SCALE) using the defender's own
        // armor + Decrease Damage Taken stacks. Without this PvE DoTs landed
        // raw while the same Wound/Poison/Drain stack was DR-mitigated server-
        // side — heavy-armor PvE enemies took ~2× the DoT they would in PvP.
        // Tick only statuses ACTIVE this turn (mirrors the player DoT path above +
        // server applyDoTs). A debuff the player applied THIS round is deferred via
        // activeRound, so reading the raw list bled the enemy a round early — a
        // 2-round bleed hit 3× instead of 2×. (Round decrement still happens
        // unconditionally in endEnemyTurn's setEnemyStatuses(tickStatuses).)
        const activeDotEnemyStatuses = activeStatuses(enemyStatuses);
        const enemyDotMit = dotMitigationPVE(armorFactorToRawDr(enemyArmorFactor), activeDotEnemyStatuses);
        let dotDamage = 0;
        let drainChakra = 0;
        activeDotEnemyStatuses.filter((s) => s.name !== "Stun").forEach((s) => {
            if (s.name === "Wound") dotDamage += Math.floor((s.amount || 0) * enemyDotMit);
            if (s.name === "Drain") {
                // Match PvP: Drain hits HP + chakra only (never stamina). Jutsu drain
                // carries a mastery-scaled `amount`; weapon-proc drain (no amount)
                // keeps its prior 250 magnitude via the fallback.
                const amt = Math.floor((s.amount ?? 50) * enemyDotMit);
                dotDamage += amt;
                drainChakra += amt;
            }
            if (s.name === "Poison" && !COMBAT_RESOURCES_V2) {
                // Legacy per-round pool poison. Under combatResourcesV2 the enemy takes
                // poison on-spend when it casts (in the enemy jutsu path) instead.
                const raw = s.amount ?? Math.floor(enemyMaxChakra * (s.percent ?? 6) / 100);
                dotDamage += Math.floor(raw * enemyDotMit);
            }
        });

        if (dotDamage > 0) {
            setEnemyHp((hp) => Math.max(0, Math.min(enemyMaxHp, hp - dotDamage)));
            queueHitFx("e", dotDamage, "damage");
            if (drainChakra > 0) setEnemyChakra((c) => Math.max(0, c - drainChakra));
            const drainNote = drainChakra > 0 ? ` Drain also removes ${drainChakra} chakra.` : "";
            addCombatLog(`Damage over time: ${opponentName} takes ${dotDamage} damage from active effects.${drainNote}`, "effects", opponentName);
        }

        if (enemyHp - dotDamage <= 0) return winBattle();

        // Start after React commits the start-of-turn zone statuses. This makes a
        // freshly re-applied 1-round DDG/Recoil affect the first enemy action too;
        // follow-up actions already use this same fresh-state path.
        enemyTurnActiveRef.current = true;
        enemyTurnApRef.current = enemyTurnAp;
        enemyTurnActionsRef.current = 0;
        enemyTurnTimerRef.current = window.setTimeout(() => {
            enemyTurnTimerRef.current = null;
            enemyContinueRef.current();
        }, 0);
    }

    function resetBattle(nextEnemyHp = enemyMaxHp, firstActor?: "player" | "enemy") {
        setPlayerPos(62);
        setEnemyPos(33);
        setPlayerHp(character.hp);
        setEnemyHp(nextEnemyHp);
        setEnemyChakra(enemyMaxChakra);
        setEnemyStamina(enemyMaxStamina);
        setPlayerShield(0);
        setEnemyShield(0);
        setAp(100);
        setEnemyAp(100);
        setTurn(1);
        setPlayerStatuses([]);
        setEnemyStatuses([]);
        setBarrierTiles([]);
        setGroundZones([]);
        setCooldowns({});
        setJutsuCooldowns({});
        setBattleEnded(false);
        setBattleResult(null);
        setSelectedActionId(undefined);
        setPotionUsesThisBattle(0);
        setSummonedPetId("");
        setPetPos(63);
        setPetHp(0);
        setPetMaxHp(0);
        setPetStatuses([]);
        setPetShield(0);
        setPetJutsuCooldowns({});
        setPetTurnsRemaining(0);
        setPetSummonedThisFight(false);
        petActingRef.current = false;
        petPhaseStepsRef.current = 0;
        petHasAttackedRef.current = false;
        if (petPhaseTimerRef.current !== null) { window.clearTimeout(petPhaseTimerRef.current); petPhaseTimerRef.current = null; }
        // Reset the multi-action enemy-turn bookkeeping so a fresh fight never
        // inherits a stale "turn in progress" flag or leftover budget/memory.
        enemyTurnActiveRef.current = false;
        enemyTurnApRef.current = 100;
        enemyTurnActionsRef.current = 0;
        playerActionLogRef.current = [];
        const initiative = firstActor ?? rollInitiative();
        setActiveActor(initiative);
        setActionsThisTurn(0);
        setLog(initiative === "player" ? `${character.name} wins the coin flip — you have initiative!` : `${opponentName} wins the coin flip — they move first!`);
        setCombatLog([]);
        setBattleHistory([]);
    }

    // Keep stable refs fresh — must be after all functions are defined.
    //
    // Assigned in an EFFECT rather than during render: a ref write during the
    // render pass is a side effect (react-hooks/refs), and under a concurrent
    // re-render that is thrown away it can publish a callback closed over state
    // that never committed. Every consumer of these refs is a timer, a socket
    // handler or a deferred continuation — all of which fire after commit — so
    // refreshing them post-commit is both correct and sufficient. No dep array:
    // these must track the LATEST render's closures, which is the whole point
    // of the ref indirection.
    useEffect(() => {
        resetBattleRef.current  = resetBattle;
        setLogRef.current       = setLog;
        autoEndTurnRef.current  = () => {
            if (!battleStarted || battleEnded || activeActor !== "player") return;
            addCombatLog(`⏱ ${character.name}'s turn timed out! Turn passes to ${opponentName}.`, "timeout", character.name);
            waitTurn();
        };
        enemyTurnRef.current    = enemyTurn;
        enemyContinueRef.current = enemyContinue;
        petContinueRef.current  = petContinue;
    });

    // ── Combat-board memoization (mobile perf; see docs/combat-board-memoization-handoff.md) ──
    // The 120-tile hex grid + its range/AOE highlight Sets used to rebuild on
    // EVERY combat state commit (HP/AP/log/status). On a budget phone that
    // stutters/freezes during the enemy's multi-action turn. Memoizing the Sets
    // and the grid element subtree lets commits that don't touch the board skip
    // re-rendering it entirely (a commit that doesn't change any dep below
    // reuses the cached element array, so React bails out of the 120-tile diff).
    //
    // These hooks MUST be declared before the `if (!battleStarted)` early return
    // (rules-of-hooks). All inputs are already in scope here. react-hooks/
    // exhaustive-deps is disabled file-wide, so deps are hand-verified: pure
    // hoisted helpers (distance / hexNeighbors / isMoveJutsu / moveJutsuRange /
    // isGroundEffectJutsu / battleGroundEffectClass), the stable click ref, and
    // setHoveredBattleTile are intentionally omitted — their behavior is
    // render-stable, so they can never go stale.
    const handleTileClickRef = useRef<(tile: number) => void>(() => {});
    // Same reasoning as the block above: the memoized 120-tile grid reads this
    // ref from a click handler, which only runs after commit.
    useEffect(() => { handleTileClickRef.current = handleTileClick; });
    const activeJutsuRangeTiles = useMemo(() => jutsuRangeTiles(pendingTargetJutsu), [pendingTargetJutsu, playerPos]);
    const activeJutsuAoeTiles = useMemo(() => jutsuAoeTiles(pendingTargetJutsu), [pendingTargetJutsu, playerPos, enemyPos]);
    const activeWeaponRangeTiles = useMemo(() => weaponRangeTiles(pendingTargetWeapon), [pendingTargetWeapon, playerPos]);
    const activeGroundAffectedTiles = useMemo(() => groundAffectedTiles(pendingTargetJutsu, hoveredBattleTile), [pendingTargetJutsu, hoveredBattleTile]);
    const activeMoveAffectedTiles = useMemo(() => {
        if (!pendingTargetJutsu || !isMoveJutsu(pendingTargetJutsu) || hoveredBattleTile === null) return new Set<number>();
        const landingTile = hoveredBattleTile;
        const validLandingTile =
            distance(playerPos, landingTile) >= 1 &&
            distance(playerPos, landingTile) <= moveJutsuRange(pendingTargetJutsu) &&
            landingTile !== playerPos &&
            landingTile !== enemyPos &&
            !barrierTiles.some((barrier) => barrier.tile === landingTile);
        if (!validLandingTile) return new Set<number>();
        const impact = jutsuImpactPreviewTiles(
            pendingTargetJutsu.method,
            landingTile,
            Array.from({ length: gridWidth * gridHeight }, (_, tile) => tile),
            distance,
            hexNeighbors,
        );
        // Pure movement has no damage footprint, but the hovered destination
        // still needs a marker distinct from the green reachable-range tiles.
        return impact.size > 0 ? impact : new Set([landingTile]);
    }, [pendingTargetJutsu, hoveredBattleTile, playerPos, enemyPos, barrierTiles]);
    const boardGrid = useMemo(() => (
        Array.from({ length: gridHeight }).map((_, row) =>
            Array.from({ length: gridWidth }).map((_, col) => {
                const i = row * gridWidth + col;
                const x = col * X_STEP;
                const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0);

                const isBarrierTile = barrierTiles.some((b) => b.tile === i);
                const isGroundZoneTile = groundZones.some((z) => z.tiles.includes(i));
                const isJutsuRangeTile = (activeJutsuRangeTiles.has(i) && !(pendingTargetJutsu && isMoveJutsu(pendingTargetJutsu))) || activeWeaponRangeTiles.has(i);
                const isMoveAoeAffectedTile = activeMoveAffectedTiles.has(i);
                const isJutsuAoeTile = activeJutsuAoeTiles.has(i);
                const isJutsuAoeCenterTile = pendingTargetJutsu?.method === "AOE_CIRCLE" && i === enemyPos && isJutsuAoeTile;
                const isGroundAffectedTile = activeGroundAffectedTiles.has(i);
                const isPendingJutsuTarget =
                    ((pendingTargetJutsu != null && !isGroundEffectJutsu(pendingTargetJutsu) && !isMoveJutsu(pendingTargetJutsu) && !isSelfCastJutsu(pendingTargetJutsu)) || Boolean(pendingTargetWeapon)) &&
                    i === enemyPos &&
                    (activeJutsuRangeTiles.has(i) || activeWeaponRangeTiles.has(i));
                // Self-cast jutsu: light up the caster's OWN tile as the click target,
                // so the arm-then-click-self flow reads the same as enemy targeting.
                const isSelfTargetTile = pendingTargetJutsu != null && isSelfCastJutsu(pendingTargetJutsu) && i === playerPos;
                // Ground-target jutsu: highlight valid open landing tiles in range.
                // Floor to 1 — see normalizeJutsu comment.
                const isGroundTargetTile = pendingTargetJutsu != null &&
                    isGroundEffectJutsu(pendingTargetJutsu) &&
                    distance(playerPos, i) <= Math.max(1, Number(pendingTargetJutsu.range) || 1) &&
                    i !== playerPos &&
                    i !== enemyPos &&
                    !isBarrierTile;
                const groundEffectClass = pendingTargetJutsu && (isGroundTargetTile || isGroundAffectedTile || isMoveAoeAffectedTile)
                    ? battleGroundEffectClass(pendingTargetJutsu, (isGroundAffectedTile || isMoveAoeAffectedTile) ? "affected" : "target")
                    : "";
                // Move jutsu: highlight valid landing tiles.
                const isMoveLandingTile = pendingTargetJutsu != null &&
                    isMoveJutsu(pendingTargetJutsu) &&
                    distance(playerPos, i) >= 1 &&
                    distance(playerPos, i) <= moveJutsuRange(pendingTargetJutsu) &&
                    i !== playerPos &&
                    i !== enemyPos &&
                    !isBarrierTile;
                // Basic Move uses the same green landing cue as movement jutsu.
                // Previously selecting Move changed only the log text, leaving a
                // new player to guess which cells the hex-grid rules considered
                // adjacent.
                const isBasicMoveLandingTile = selectedActionId === "move" &&
                    distance(playerPos, i) === 1 &&
                    i !== enemyPos &&
                    !isBarrierTile;
                // Mark an adjacent enemy's occupied square so "in melee range" is
                // readable from the board, not something the player must infer by
                // clicking Attack and watching whether it fails.
                const isBasicAttackReadyTile = i === enemyPos && distance(playerPos, enemyPos) <= 1;

                return (
                    <button
                        key={i}
                        data-tile={i}
                        className={`hex-tile ${i === playerPos ? "hex-player" : ""
                            } ${i === enemyPos ? "hex-enemy" : ""
                            } ${isBarrierTile ? "hex-barrier" : ""
                            } ${isJutsuRangeTile ? "jutsu-range-tile" : ""
                            } ${isJutsuAoeTile ? "jutsu-aoe-tile" : ""
                            } ${(isGroundAffectedTile || isMoveAoeAffectedTile || isGroundZoneTile) ? "ground-affected-tile" : ""
                            } ${isJutsuAoeCenterTile ? "jutsu-aoe-center-tile" : ""
                            } ${isPendingJutsuTarget ? "jutsu-target-tile" : ""
                            } ${isSelfTargetTile ? "jutsu-target-tile jutsu-self-target-tile" : ""
                            } ${isGroundTargetTile ? "ground-target-tile" : ""
                            } ${groundEffectClass
                            } ${(isMoveLandingTile || isBasicMoveLandingTile) ? "dash-target-tile" : ""
                            } ${isBasicAttackReadyTile ? "basic-attack-ready-tile" : ""
                            }`}
                        style={{
                            left: `${x}px`,
                            top: `${y}px`,
                            width: `${HEX_W}px`,
                            height: `${HEX_H}px`,
                        }}
                        title={isBarrierTile ? `Barrier wall — impassable (${barrierTiles.find((b) => b.tile === i)?.rounds ?? 0} rounds)` : isGroundTargetTile ? `Place ${pendingTargetJutsu?.name} here` : isGroundAffectedTile ? `${pendingTargetJutsu?.name} affected tile` : isJutsuAoeTile ? `${pendingTargetJutsu?.name} AOE hit tile` : isPendingJutsuTarget ? `Target ${opponentName} with ${pendingTargetJutsu?.name ?? pendingTargetWeapon?.name}` : isSelfTargetTile ? `Cast ${pendingTargetJutsu?.name} on yourself` : isJutsuRangeTile ? `${pendingTargetJutsu?.name ?? pendingTargetWeapon?.name} range` : undefined}
                        onMouseEnter={() => setHoveredBattleTile(i)}
                        onMouseLeave={() => setHoveredBattleTile(null)}
                        onClick={() => handleTileClickRef.current(i)}
                    >
                        {/* Fighters are drawn ONLY by the orb overlay above the tiles —
                            it now renders unconditionally (initials fallback included),
                            so the tile must stay empty or an art-less fighter would show
                            twice: once as this bare text and once inside its orb. */}
                        {isBarrierTile ? <GiShield aria-hidden="true" /> : ""}
                    </button>
                );
            })
        )
    ), [playerPos, enemyPos, barrierTiles, groundZones, pendingTargetJutsu, pendingTargetWeapon, selectedActionId, hoveredBattleTile, activeJutsuRangeTiles, activeJutsuAoeTiles, activeWeaponRangeTiles, activeGroundAffectedTiles, activeMoveAffectedTiles, character.avatarImage, character.name, opponentAvatar, opponentName]);

    if (!battleStarted) {
        const availablePetCount = availablePetBattleCount(combatEligiblePets);
        const sparOpponents = sparSearch.trim() ? playerRoster.filter((player) => playerSearchMatches(player, sparSearch)) : [];
        const clanWarOpponents = opponentClanData
            ? opponentClanData.members
                .map((member) => playerRoster.find((player) => player.name === member.name))
                .filter((player): player is PlayerRecord => Boolean(player))
            : [];
        const tournamentRemaining = arenaTournament ? Math.max(0, arenaTournament.endsAt - Date.now()) : 0;
        const matchRemaining = arenaTournament ? Math.max(0, arenaTournament.matchDeadline - Date.now()) : 0;
        const isAdminTournamentManager = isAdminAccountName(character.name);

        if (lobbyMode === "battleArena") {
            const incomingSpars = incomingChallenges.filter((challenge) => !challenge.clanWarPoints && challenge.mode !== "ranked" && challenge.mode !== "clanWarPet" && !challenge.sectorAttack);
            const incomingPetSpars = incomingChallenges.filter((challenge) => challenge.mode === "clanWarPet" && !challenge.clanWarPoints);
            return (
                <BattleArenaLobby
                    character={character}
                    updateCharacter={updateCharacter}
                    playerRoster={playerRoster}
                    activeTab={battleArenaTab}
                    aiLevel={aiLevel}
                    sparSearch={sparSearch}
                    sparOpponents={sparOpponents}
                    incomingSpars={incomingSpars}
                    incomingPetSpars={incomingPetSpars}
                    availablePetCount={availablePetCount}
                    onBack={() => setScreen("village")}
                    onTabChange={setBattleArenaTab}
                    onAiLevelChange={setAiLevel}
                    onBeginAiBattle={beginAiBattle}
                    onSparSearchChange={setSparSearch}
                    onSendDirectSpar={(name) => {
                        if (!name || name === character.name) return;
                        const stub = { name, level: 1, village: "", specialty: "Ninjutsu", character: { ...character, name } as Character, currentSector: 0, lastSeenAt: Date.now() } as PlayerRecord;
                        challengePlayer(stub);
                    }}
                    onChallengePlayer={challengePlayer}
                    onAcceptChallenge={acceptChallenge}
                    onDeclineChallenge={declineChallenge}
                    onAcceptPetChallenge={onAcceptPetChallenge}
                    onOpenPetArena={() => setScreen("petArena")}
                    onOpenCardHall={() => setScreen("shinobiTiles")}
                />
            );
        }

        const incomingClanWarChallenges = incomingChallenges.filter((challenge) => Boolean(challenge.clanWarPoints));
        const activeSpectatorFights = spectatorFights.filter((fight) => fight.battleId);
        const pendingSpectatorChallenges = duelChallenges.filter((challenge) =>
            !challenge.accepted &&
            !challenge.declined &&
            (Boolean(challenge.clanWarPoints) || challenge.mode === "ranked")
        );

        const acceptDistrictChallenge = (challenge: DuelChallenge) => {
            if (challenge.mode === "clanWarPet") {
                const challengerPet = challenge.challenger.pets.find((pet) => pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)) ?? challenge.challenger.pets.find((pet) => !isPetOnExpedition(pet));
                const responderPet = combatEligiblePets.find((pet) => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));
                if (!challengerPet || !responderPet) {
                    alert("Both players need a pet before this pet battle can start.");
                    return;
                }
                savePendingClanPetBattle({
                    clanName: character.clan,
                    points: challenge.clanWarPoints ?? 25,
                    opponentName: challenge.fromName,
                    createdAt: Date.now(),
                });
                setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id));
                fetch('/api/player/challenge', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetName: challenge.toName, fromName: challenge.fromName, challengeId: challenge.id }),
                }).catch(() => {});
                fetch('/api/player/challenge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetName: challenge.fromName, challenge: { ...challenge, accepted: true, fromName: character.name, toName: challenge.fromName, responderPetId: responderPet.id, responderPet } }),
                }).catch(() => {});
                setPendingPetBattleOpponent?.({ owner: challenge.fromName, pet: challengerPet, battleSeed: challenge.petBattleSeed });
                setScreen("petArena");
                return;
            }
            acceptChallenge(challenge);
        };

        const spectateFight = (fight: ArenaSpectatorFight) => {
            if (fight.battleId && setPvpBattleId && setPvpRole) {
                fetch(`/api/pvp/spectate?id=${encodeURIComponent(fight.battleId)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: character.name, action: "join" }),
                }).catch(() => {});
                setPvpBattleId(fight.battleId);
                setPvpRole("p1");
                setScreen("pvpBattle" as Screen);
            } else {
                alert(`Spectating ${fight.title}. Live replay streams will use this fight feed.`);
            }
        };

        return (
            <ArenaDistrictLobby
                character={character}
                activeTab={activeArenaTab}
                hasAvailablePet={combatEligiblePets.some((pet) => !isPetOnExpedition(pet))}
                availablePetCount={availablePetCount}
                opponentClanData={opponentClanData}
                clanWarOpponents={clanWarOpponents}
                incomingClanWarChallenges={incomingClanWarChallenges}
                arenaTournament={arenaTournament}
                tournamentRemaining={tournamentRemaining}
                matchRemaining={matchRemaining}
                isAdminTournamentManager={isAdminTournamentManager}
                playerRankedEnabled={playerRankedEnabled}
                rankedQueueActive={rankedQueueActive}
                rankedQueueSize={rankedQueueSize}
                spectatorFights={activeSpectatorFights}
                pendingSpectatorChallenges={pendingSpectatorChallenges}
                onBack={() => setScreen("centralHub")}
                onTabChange={setActiveArenaTab}
                onChallengePlayer={challengePlayer}
                onAcceptDistrictChallenge={acceptDistrictChallenge}
                onDeclineChallenge={declineChallenge}
                onAdvanceTournamentPlayer={advanceTournamentPlayer}
                onClearTournament={clearTournament}
                onStartTournament={startTournament}
                onJoinRankedQueue={joinRankedQueue}
                onLeaveRankedQueue={leaveRankedQueue}
                onRefreshFights={() => setSpectatorFights(loadArenaActiveFights())}
                onSpectateFight={spectateFight}
                onViewPendingChallenge={() => alert("This fight has not started yet.")}
                onOpenPetLadder={(mode) => {
                    sessionStorage.setItem("petLadder.mode", mode);
                    setScreen("petLadder");
                }}
            />
        );
    }

    const showRookieCombatTip = battleStarted
        && !battleEnded
        && !isAcademySpar
        && (missionBattleActive || directCombat)
        && character.level < 20
        && ((character.totalAiKills ?? 0) < 3);
    // activeJutsuRangeTiles / activeJutsuAoeTiles / activeWeaponRangeTiles /
    // activeGroundAffectedTiles are now memoized above (before the
    // !battleStarted early return) so they're not rebuilt on every commit.

    // ── Mid-battle PvE state persistence (isolated-component v3) ────────
    // Previous two attempts added hooks DIRECTLY to Arena and tripped
    // React #310. Even with a minimal deps array, something in Arena's
    // 50+-hook footprint causes count mismatches when new hooks land.
    //
    // v3 fix: render an <ArenaBattlePersister/> child below — its hooks
    // live in their own scope, so Arena's hook count is COMPLETELY
    // UNCHANGED by the persistence feature. Save fires on turn-boundary
    // (deps: 4), restore is one-shot on mount, and the child component
    // takes all the state as props + an onRestore callback.

    // The shared CombatHudLayout keeps the PvE and PvP shells in lockstep;
    // this screen still owns its PvE-only pet command and battle behavior.
    return (
        <ShinobiCombatShell mode="solo" className={`pvp-battle-layout arena-bg-${currentBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
            {/* Onboarding spar coaching — read-only top banner, only during the
                guaranteed-first-win Academy spar. Never covers the bottom action
                bar; dismissible so it can't trap. */}
            {isAcademySpar && battleStarted && !battleEnded && (
                <SparCoach
                    attacked={sparAttacked}
                    casted={sparCasted}
                    ap={ap}
                    enemyHp={enemyHp}
                    enemyMaxHp={enemyMaxHp}
                />
            )}
            {/* Legacy safety net only. Current AI/PvP launches use server hosts;
                App retires any pre-cutover local lock without paying or punishing. */}
            <BattleLockKeeper
                active={battleStarted && !battleEnded
                    && !(raidBattleKind === "raidPlayer" || rankedBattleActive)
                    && !opponentCharacter && !pendingStoryBattle}
                kind="arena"
                screen="arena"
                playerName={character.name}
            />
            {/* Pre-cutover story-lock guard. No current story, creator-event,
                Academy, Dungeon, or Hollow Gate launch enters this reducer. */}
            <BattleLockKeeper
                active={battleStarted && !battleEnded
                    && !(raidBattleKind === "raidPlayer" || rankedBattleActive)
                    && !opponentCharacter && Boolean(pendingStoryBattle)}
                kind="arenaStory"
                screen="arena"
                playerName={character.name}
            />
            {/* Rolling-upgrade cleanup for old local snapshots; current combat
                state is recovered from its server session by the canonical host. */}
            <ArenaBattlePersister
                characterName={character.name}
                battleStarted={battleStarted}
                battleEnded={battleEnded}
                isPvpFight={raidBattleKind === "raidPlayer" || rankedBattleActive}
                opponentName={opponentCharacter?.name ?? pendingAiProfile?.name}
                pendingStoryKind={pendingStoryBattle?.kind}
                playerHp={playerHp} enemyHp={enemyHp}
                enemyChakra={enemyChakra} enemyStamina={enemyStamina}
                ap={ap} enemyAp={enemyAp}
                turn={turn} activeActor={activeActor} actionsThisTurn={actionsThisTurn}
                playerStatuses={playerStatuses} enemyStatuses={enemyStatuses}
                barrierTiles={barrierTiles} groundZones={groundZones}
                cooldowns={cooldowns} jutsuCooldowns={jutsuCooldowns} enemyJutsuCooldowns={enemyJutsuCooldowns}
                playerShield={playerShield} enemyShield={enemyShield}
                playerPos={playerPos} enemyPos={enemyPos}
                battleHistory={battleHistory} summonedPetId={summonedPetId}
                petPos={petPos} petHp={petHp} petMaxHp={petMaxHp}
                petStatuses={petStatuses} petShield={petShield}
                petJutsuCooldowns={petJutsuCooldowns} petTurnsRemaining={petTurnsRemaining}
                rankedBattleActive={rankedBattleActive} clanWarPointsActive={clanWarPointsActive}
                onRestore={(saved) => {
                    setBattleStarted(saved.battleStarted);
                    setPotionUsesThisBattle(0);
                    setPlayerHp(saved.playerHp);
                    setEnemyHp(saved.enemyHp);
                    setEnemyChakra(saved.enemyChakra);
                    setEnemyStamina(saved.enemyStamina);
                    setAp(saved.ap);
                    setEnemyAp(saved.enemyAp);
                    setTurn(saved.turn);
                    setActiveActor(saved.activeActor);
                    setActionsThisTurn(saved.actionsThisTurn);
                    setPlayerStatuses(saved.playerStatuses as CombatStatus[]);
                    setEnemyStatuses(saved.enemyStatuses as CombatStatus[]);
                    setBarrierTiles(saved.barrierTiles);
                    setGroundZones((saved.groundZones ?? []).map((zone) => ({
                        ...zone,
                        owner: zone.owner === "enemy" ? "enemy" : "player",
                    })) as PveGroundZone[]);
                    setCooldowns(saved.cooldowns);
                    setJutsuCooldowns(saved.jutsuCooldowns);
                    setEnemyJutsuCooldowns(saved.enemyJutsuCooldowns);
                    setPlayerShield(saved.playerShield);
                    setEnemyShield(saved.enemyShield);
                    setPlayerPos(saved.playerPos);
                    setEnemyPos(saved.enemyPos);
                    setBattleHistory(saved.battleHistory as BattleActionEntry[]);
                    setSummonedPetId(saved.summonedPetId);
                    setPetPos(saved.petPos ?? 63);
                    setPetHp(saved.petHp ?? 0);
                    setPetMaxHp(saved.petMaxHp ?? 0);
                    setPetStatuses((saved.petStatuses ?? []) as CombatStatus[]);
                    setPetShield(saved.petShield ?? 0);
                    setPetJutsuCooldowns(saved.petJutsuCooldowns ?? {});
                    setPetTurnsRemaining(saved.petTurnsRemaining ?? 0);
                    setPetSummonedThisFight(Boolean(saved.summonedPetId));
                    setRankedBattleActive(saved.rankedBattleActive);
                    setClanWarPointsActive(saved.clanWarPointsActive);
                    setLog("Mid-battle state restored from previous session.");
                }}
            />
            {/* Pre-fight countdown overlay — shown for ALL battle types */}
            {prefightCountdown !== null && (
                <div className="pvp-countdown-overlay">
                    <div className="pvp-countdown-box">
                        <div className="pvp-countdown-vs">
                            <span className="pvp-countdown-name">{character.name}</span>
                            <span className="pvp-countdown-badge">VS</span>
                            <span className="pvp-countdown-name">{opponentName}</span>
                        </div>
                        {prefightFirstActor && (
                            <div className={`pvp-coinflip-result${prefightFirstActor === "player" ? " coinflip-win" : " coinflip-lose"}`}>
                                {prefightFirstActor === "player"
                                    ? `${character.name} goes first!`
                                    : `${opponentName} goes first!`}
                            </div>
                        )}
                        <div className="pvp-countdown-number">{prefightCountdown}</div>
                        <p className="pvp-countdown-label">Battle begins in…</p>
                    </div>
                </div>
            )}
            {/* Portal player HUD to left sidebar on xl viewport */}
            {(() => {
                const portalTarget = document.getElementById("battle-hud-portal");
                return portalTarget ? createPortal(
                    <div className="battle-hud-sidebar">
                        <CombatSideHud
                            name={character.name}
                            avatar={playerBattleAvatar || character.name.slice(0, 2).toUpperCase()}
                            hp={playerHp}
                            maxHp={character.maxHp}
                            chakra={character.chakra}
                            maxChakra={character.maxChakra}
                            stamina={character.stamina}
                            maxStamina={character.maxStamina}
                            shield={playerShield}
                            village={character.village}
                            turn={turn}
                            statuses={displayStatuses(playerStatuses)}
                        />
                    </div>,
                    portalTarget
                ) : null;
            })()}
            <CombatHudLayout hasActionNotice={showRookieCombatTip}>
                {/* In-grid player HUD — visible on non-xl, hidden on xl via CSS */}
                <CombatSideHud
                    name={character.name}
                    avatar={playerBattleAvatar || character.name.slice(0, 2).toUpperCase()}
                    hp={playerHp}
                    maxHp={character.maxHp}
                    chakra={character.chakra}
                    maxChakra={character.maxChakra}
                    stamina={character.stamina}
                    maxStamina={character.maxStamina}
                    shield={playerShield}
                    village={character.village}
                    turn={turn}
                    statuses={displayStatuses(playerStatuses)}
                    isActive={activeActor === "player"}
                    level={character.level}
                    power={earnedStatPoints(character)}
                />

                <CombatHudMain activeTab={battleTabs.tab}>
                    <CombatHudHeader
                        title={biomeLabel(currentBiome)}
                        subtitle={<>Turn {turn} | Shinobi Duel</>}
                    />

                    <CombatEnvironmentStrip>
                        <span className="twp-strip-biome">{biomeLabel(currentBiome)}</span>
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Terrain</span>
                        <span className="twp-strip-value">{terrainEffects[currentBiome].description}</span>
                        {terrainEffects[currentBiome].playerBuff && (
                            <span className="twp-buff twp-positive">{terrainEffects[currentBiome].playerBuff}</span>
                        )}
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Weather</span>
                        <span className="twp-strip-value">{weatherEffects[currentWeather].name}</span>
                        {weatherEffects[currentWeather].positiveElement && (
                            <span className="twp-buff twp-positive">{weatherEffects[currentWeather].positiveElement} +5%</span>
                        )}
                        {weatherEffects[currentWeather].negativeElement && (
                            <span className="twp-buff twp-negative">{weatherEffects[currentWeather].negativeElement} -2%</span>
                        )}
                    </CombatEnvironmentStrip>

                    <CombatApPanel>
                        <div>
                            <strong>{character.name} AP</strong>
                            <div className="hud-bar ap-display-bar">
                                <span style={{ width: `${ap}%` }} />
                            </div>
                            <small>{ap}/100 | {activeActor === "player" ? "Active" : "Waiting"}</small>
                        </div>

                        {/* Round timer — shown in the middle column when it's the player's
                            turn. Isolated component so its 1s tick doesn't re-render the board. */}
                        {activeActor === "player" && battleStarted && !battleEnded && (
                            <CombatRoundTimer
                                active={activeActor === "player" && battleStarted && !battleEnded && prefightCountdown === null}
                                resetSignal={roundTimerKey}
                                onExpire={() => autoEndTurnRef.current()}
                            />
                        )}
                        {(activeActor !== "player" || !battleStarted || battleEnded) && (
                            <div className="round-timer-display round-timer-inactive">
                                <div className="round-timer-ring">
                                    <span className="round-timer-num">—</span>
                                </div>
                                <small>{activeActor === "enemy" ? `${opponentName}'s Turn` : "—"}</small>
                            </div>
                        )}

                        <div>
                            <strong>{opponentName} AP</strong>
                            <div className="hud-bar enemy-ap-display-bar">
                                <span style={{ width: `${enemyAp}%` }} />
                            </div>
                            <small>{enemyAp}/100 | {activeActor === "enemy" ? "Active" : "Waiting"}</small>
                        </div>
                    </CombatApPanel>

                    <ArenaCombatBoardStage
                        currentBiome={currentBiome}
                        currentSector={currentSector}
                        battlefieldCallbackRef={battlefieldCallbackRef}
                        boardContainerSize={boardContainerSize}
                        effectiveScale={effectiveScale}
                        gridLayerWidth={GRID_LAYER_W}
                        gridLayerHeight={GRID_LAYER_H}
                        gridWidth={gridWidth}
                        hexWidth={HEX_W}
                        hexHeight={HEX_H}
                        xStep={X_STEP}
                        yStep={Y_STEP}
                        orbSize={ORB}
                        playerPos={playerPos}
                        playerBattleAvatar={playerBattleAvatar}
                        playerName={character.name}
                        playerHp={playerHp}
                        playerMaxHp={character.maxHp}
                        enemyPos={enemyPos}
                        opponentAvatar={opponentAvatar}
                        opponentName={opponentName}
                        opponentBattleSprite={opponentBattleSprite}
                        enemyHp={enemyHp}
                        enemyMaxHp={enemyMaxHp}
                        isPetAlive={isPetAlive}
                        summonedPet={summonedPet}
                        petPos={petPos}
                        petHp={petHp}
                        petMaxHp={petMaxHp}
                        petTurnsRemaining={petTurnsRemaining}
                        sharedImages={sharedImages}
                        pveHitFx={pveHitFx}
                        boardGrid={boardGrid}
                        combatVfxLayerRef={combatVfxLayerRef}
                        combatVfx={combatVfx}
                        renderCombatVfx={renderArenaCombatVfx}
                    />

                    <ArenaCommandDeck
                        battleTab={battleTabs.tab}
                        setBattleTab={battleTabs.setTab}
                        unreadBattleEntries={battleTabs.unread}
                        showRookieCombatTip={showRookieCombatTip}
                        battleEnded={battleEnded}
                        activeActor={activeActor}
                        actionsThisTurn={actionsThisTurn}
                        character={character}
                        lensDiscipline={playerLensDiscipline(character)}
                        playerHp={playerHp}
                        ap={ap}
                        adjustedApCost={adjustedApCost}
                        cooldowns={cooldowns}
                        selectedActionId={selectedActionId}
                        canSummonPet={canSummonPet}
                        activeBattlePetCanSummon={activeBattlePetCanSummon}
                        summonedPet={summonedPet}
                        petSummonedThisFight={petSummonedThisFight}
                        activeBattlePetSummonNote={activeBattlePetSummonNote}
                        opponentName={opponentName}
                        equippedJutsus={equippedJutsus}
                        combatEquippedItems={combatEquippedItems}
                        pendingTargetJutsuId={pendingTargetJutsuId}
                        pendingTargetWeapon={pendingTargetWeapon}
                        jutsuCooldowns={jutsuCooldowns}
                        inspectedJutsu={inspectedJutsu}
                        inspectedCombatItem={inspectedCombatItem}
                        inspectedJutsuId={inspectedJutsuId}
                        inspectedCombatItemId={inspectedCombatItemId}
                        combatItemConsumed={combatItemConsumed}
                        canUseCombatItem={canUseCombatItem}
                        combatItemSummary={combatItemSummary}
                        onBasicAttack={basicAttack}
                        onToggleMove={() => {
                            setPendingTargetJutsuId("");
                            setSelectedActionId((current) => current === "move" ? undefined : "move");
                            setLog("Move selected. Click an adjacent tile.");
                        }}
                        onBasicHeal={basicHeal}
                        onClearEnemyPositiveEffects={clearEnemyPositiveEffects}
                        onCleansePlayerNegativeEffects={cleansePlayerNegativeEffects}
                        onSummonActivePet={summonActivePet}
                        onFlee={flee}
                        onWaitTurn={waitTurn}
                        onSelectJutsu={(jutsu) => {
                            setInspectedJutsuId("");
                            setInspectedCombatItemId("");
                            selectCombatJutsu(jutsu);
                        }}
                        onActivateCombatItem={(item) => {
                            setInspectedJutsuId("");
                            activateEquippedCombatItem(item);
                        }}
                        onInspectJutsu={(id) => {
                            setInspectedCombatItemId("");
                            setInspectedJutsuId(id);
                        }}
                        onInspectCombatItem={(id) => {
                            setInspectedJutsuId("");
                            setInspectedCombatItemId(id);
                        }}
                        onCloseJutsu={() => setInspectedJutsuId("")}
                        onCloseCombatItem={() => setInspectedCombatItemId("")}
                    />

                    <ArenaBattleTimeline
                        combatLogRef={combatLogRef}
                        activeActor={activeActor}
                        playerName={character.name}
                        opponentName={opponentName}
                        battleHistory={battleHistory}
                        logRoundOverrides={logRoundOverridesA}
                        onToggleRound={(round, currentlyOpen) => {
                            setLogRoundOverridesA((previous) => ({ ...previous, [round]: !currentlyOpen }));
                        }}
                        formatEntryTime={(createdAt) => new Date(createdAt ?? Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                        battleStarted={battleStarted}
                        battleEnded={battleEnded}
                    />
                </CombatHudMain>
                <CombatSideHud
                    name={opponentName}
                    avatar={opponentAvatar}
                    hp={enemyHp}
                    maxHp={enemyMaxHp}
                    chakra={enemyMaxChakra}
                    maxChakra={enemyMaxChakra}
                    stamina={enemyMaxStamina}
                    maxStamina={enemyMaxStamina}
                    shield={enemyShield}
                    village={opponentCharacter?.village ?? pendingAiProfile?.village ?? "AI"}
                    turn={turn}
                    statuses={displayStatuses(enemyStatuses)}
                    isActive={activeActor === "enemy"}
                    level={opponentLevel}
                />
            </CombatHudLayout>

            {battleEnded && (
                <div className="battle-ended-overlay">
                    <div className="card battle-ended-card">
                        <>
                                <h2 className={battleResult === "win" ? "battle-result-win" : battleResult === "fled" ? "battle-result-fled" : "battle-result-loss"}>
                                    {battleResult === "win"
                                        ? "Victory"
                                        : battleResult === "fled"
                                            ? "Escaped"
                                        : pendingStoryBattle?.kind === "dungeonAi"
                                            ? "The Seal Rejects You"
                                            : "Knocked Out"}
                                </h2>
                                <p>{log}</p>
                                {battleResult === "loss" && pendingStoryBattle?.kind === "dungeonAi" ? (
                                    <>
                                        <p style={{ color: "#f87171", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            Your Dungeon Key was consumed by the failed run. You return to your village empty-handed.
                                        </p>
                                        <button
                                            style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }}
                                            disabled={storySettlementPending}
                                            onClick={() => {
                                                if (storySettlementPending) return;
                                                setStorySettlementPending(true);
                                                void Promise.resolve(onDungeonFail?.())
                                                    .catch(() => undefined)
                                                    .finally(() => setStorySettlementPending(false));
                                            }}
                                        >
                                            <GiVillage style={ARENA_ICON} />{storySettlementPending ? "Closing Run..." : "Return to Village"}
                                        </button>
                                    </>
                                ) : battleResult === "loss" ? (
                                    <>
                                        <p style={{ color: "#f87171", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            You've been rushed to the village hospital. Pay <strong style={{ color: "#fde047" }}>1,000 ryo</strong> to be treated and released.
                                        </p>
                                        <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => { if (pendingStoryBattle) void continuePendingStoryResult(); setScreen("hospital"); }}>
                                            <GiFirstAidKit style={ARENA_ICON} />Go to Hospital
                                        </button>
                                    </>
                                ) : pendingStoryBattle ? (
                                    <div className="menu">
                                        <button
                                            className="admin-button"
                                            disabled={storySettlementPending}
                                            onClick={() => { void continuePendingStoryResult(); }}
                                        >
                                            {storySettlementPending ? "Settling..." : "Continue Story"}
                                        </button>
                                    </div>
                                ) : exploreAmbushWin ? (
                                    <div className="menu">
                                        <button className="admin-button" onClick={() => setScreen("worldMap")}>Return to Sector</button>
                                    </div>
                                ) : directCombat ? (
                                    // Launched fight (mission / hunt / world-map encounter): no
                                    // "Fight Again" — re-fighting handed out XP without re-crediting
                                    // the mission. Send the player back to the screen they came from.
                                    <div className="menu">
                                        <button className="admin-button" onClick={() => (onReturnFromCombat ? onReturnFromCombat() : setScreen("village"))}>Return</button>
                                    </div>
                                ) : (
                                    <div className="menu">
                                        <button className="admin-button" onClick={() => resetBattle()}>Fight Again</button>
                                        <button onClick={() => setScreen("village")}>Return to Village</button>
                                    </div>
                                )}
                        </>
                    </div>
                </div>
            )}
        </ShinobiCombatShell>
    );
}

// --- True Player-vs-Player Battle Screen ------------------------------------

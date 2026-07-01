/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useMemo } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import {
    GiCrossedSwords, GiTrophy, GiLadder, GiEyeball, GiBoxingGlove, GiPawPrint,
    GiColiseum, GiLaurelsTrophy, GiSkullCrossedBones, GiFirstAidKit, GiScrollUnfurled,
    GiVillage, GiNextButton,
} from "react-icons/gi";
// Inline style for a glyph that prefixes button/heading text — seats it on the baseline.
const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { createPortal } from "react-dom";
import type { Biome, JutsuElement, JutsuType, Screen, WeatherType } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { EquipmentSlot, GameItem, Jutsu, JutsuTag, SavedBloodline, Stats } from "../types/combat";
import type { AiRule, CreatorAi } from "../types/creator-ai";
import type { EnhancedClanData } from "../types/clan";
import type { Pet } from "../types/pet";
import { JUTSU_MAX_LEVEL, LEGENDARY_WAR_CRATE_ID, MAX_LEVEL, STUN_AP_PENALTY, jutsuLevelCapForLevel, perRankStatCap } from "../constants/game";
import { ArenaBattlePersister } from "../components/ArenaBattlePersister";
import { BattleLockKeeper } from "../components/BattleLockKeeper";
import { SparCoach } from "../components/SparCoach";
import { BattleLogLine } from "../components/BattleLogLine";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { interpolateFlavor } from "../lib/battle-log-format";
import { playPetSfx } from "../lib/pet-sfx";
import { masteryHasCapstone } from "../lib/profession-mastery";
import { isMercAiId } from "../lib/merc-ai";
import coliseumLadderImg from "../assets/coliseum/coliseum-bg.webp";
import tacticalLadderImg from "../assets/ladder/tactical-hero.webp";
import { CombatSideHud } from "../components/CombatSideHud";
import { JutsuEffectCards } from "../components/JutsuEffectCards";
import { JutsuSpriteFx } from "../components/JutsuSpriteFx";
import { PET_CONSUMABLE_PVE_HEAL_PCT, petCollarVisual, petConsumableById, petPveGearById, petPveHealOnSummonPct, petPveLifestealPct, petPveLoyalty, petPveSummonDamageMult } from "../data/pet-config";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";
import { biomeLabel, terrainEffects, weatherEffects } from "../data/world";
import { AMP_STATUS_ROUNDS_PVE, HEAL_FLAT_PVE, SHIELD_FLAT_PVE, armorFactorToRawDr, calculateDamage, capWoundStacks, dotMitigationPVE, drainTickPVE, getBloodlineMultiplier, masteryDamageFrac, mergeCombatStatus, multiplicativeTagMultiplier, woundCapForRankPVE } from "../lib/combat-math";
import { petRankedChallengeEnabled } from "../lib/pet-coliseum-flag";
import { aiFightServerAuthEnabled } from "../lib/ai-fight-flag";
import { warCrateServerAuthEnabled } from "../lib/war-crate-flag";
import { isImageAvatar } from "../lib/avatar";
import { aiArmorFactorForProfile, aiPrimaryJutsuType, aiStatsForLevel } from "../lib/ai-stats";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { jutsuFxSpriteKey, jutsuVfxBurst } from "../lib/jutsu-vfx";
import { cappedPostDamage, formatJutsuResourcePercent, gainJutsuXpForRank, getJutsuMastery, scaleJutsuByLevel, scaleJutsuCostsForCharacter } from "../lib/jutsu-scaling";
import { pveDifficultyStatMultiplier, pveDifficultyHpMultiplier, scaleStatsForPveDifficulty, pveAiMasteryForLevel, pveGuardedEnemyHit, pveEasyBandHoldsBurst, pveIsBurstJutsuAp, pveEasyBandAllowsLethal, pveAiCompetence } from "../lib/pve-difficulty";
import { buildPlayerRead, classifyPlayerAction, type PlayerActionRecord } from "../lib/combat-ai-tactics";
import { isControlJutsu, isPressureJutsu, isSelfSupportJutsu, makeJutsu, normalizeJutsu } from "../lib/jutsu";
import { effectiveTagPercent, normalizeTagName, opponentAffectingTags, pvpAffectsOpponent, statusMatchesName, tagMatchesName } from "../lib/tags";
import { canEquipElementJutsu } from "../lib/bloodline";
import { hasCharacterElement, weatherElementOf } from "../lib/elements";
import { minActionCost } from "../lib/combat-affordability";
import { getActivePetTrait, getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus, getPvpItemLoadout } from "../lib/equipment-stats";
import { combatLoadoutSlots, equipmentSlotLabel, normalizeEquipmentSlot } from "../lib/equipment";
import { maxChakraForLevel, maxHpForLevel, maxStaminaForLevel } from "../lib/stats";
import { markMissionCompleted } from "../lib/character-progress";
import { combatMissionByAiId, missionAiLevelAndBonus } from "../data/combat-missions";
import { relevelBuiltinAi } from "../lib/combat-ai";
import { getAllItems, getItemById } from "../lib/items";
import { countItem, removeItem } from "../lib/inventory";
import { makeId } from "../lib/utils";
import { useBoardScale } from "../lib/use-board-scale";
import { isPetOnExpedition, petCombatDamage, petDisplayName, petHappiness } from "../lib/pet";
import { PetParticleField } from "../lib/pet-vfx-particles";
import { prefersLiteCombatFx } from "../lib/device-tier";
import { PET_CRIT_MULT } from "../lib/pet-battle-sim";
import { petCardImage } from "../lib/pet-battle-anim";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "../lib/pvp-session";
import { postPlayerChallengeNotice } from "../lib/player-api";
import { boostAmount } from "../lib/village-upgrades";
import { effectiveCharacterXpGain, rankedDelta } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import {
    gainXp,
    getAllJutsus,
    getPvpJutsuLoadout,
    isAdminAccountName,
    normalizeCharacter,
    nonVanguardCharmSubstitute,
    nonVanguardShardSubstitute,
    playerLensDiscipline,
    vanguardOnlyHonorSeals,
    type DuelChallenge,
    type PendingArenaStoryBattle,
    type PvpSessionState,
    type SharedPvpBattleContext,
} from "../App";
import { activeVillageWarsFor, damageSectorTerritory, grantTerritoryScrolls, loadArenaActiveFights, loadArenaTournament, loadSectorTerritory, recordVillageWarRaid, saveArenaActiveFights, saveArenaTournament, savePendingClanPetBattle, sectorRaidDamageAmount, unregisterLocalFight, type ArenaSpectatorFight, type ArenaTournament, type TerritoryBuffStat } from "../lib/world-state";

export function Arena({
    lobbyMode = "battleArena",
    character,
    updateCharacter,
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
    endlessBattleActive = false,
    endlessBattleWave = 0,
    onEndlessWin,
    onEndlessBattleEnd,
    pendingStoryBattle,
    onPendingStoryBattleWin,
    onPendingStoryBattleContinue,
    onDungeonFail,
    onWeeklyBossLogDamage,
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
    onBattleActiveChange,
    directCombat = false,
    onReturnFromCombat,
    onQueueCombatClaim,
}: {
    lobbyMode?: "battleArena" | "arenaDistrict";
    character: Character;
    updateCharacter: (character: Character) => void;
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
    endlessBattleActive?: boolean;
    endlessBattleWave?: number;
    onEndlessWin?: (wave: number) => void;
    onEndlessBattleEnd?: () => void;
    pendingStoryBattle?: PendingArenaStoryBattle | null;
    onPendingStoryBattleWin?: (survivingHp: number) => string;
    onPendingStoryBattleContinue?: () => void;
    onDungeonFail?: () => void;
    onWeeklyBossLogDamage?: (damageDealt: number) => void;
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
    // Reports "an arena fight is in progress" up to App so the global nav lock
    // can block travelling out of any arena fight (AI, ranked, endless, story,
    // human). Fires false on resolve/unmount.
    onBattleActiveChange?: (active: boolean) => void;
    // True when this is a "launched" fight — a mission / hunt / world-map encounter
    // dropped straight into combat on the dedicated `arena` screen — as opposed to a
    // Battle Arena lobby spar (`battleArena`). Launched fights drop the "Fight Again"
    // loop (which re-ran the same fight for XP without re-crediting the mission) and
    // instead send the player back to the screen they came from via onReturnFromCombat.
    directCombat?: boolean;
    onReturnFromCombat?: () => void;
    // Queue a won combat-mission claim SERVER-SIDE (POST /api/missions/queue-combat-claim).
    // The Mission Hall "Claim Reward" step is server-authoritative and rejects the
    // claim unless the queue is already on the server, so winning must persist the
    // queue durably — not rely on the 3s debounced autosave (which a quick claim,
    // a refresh, or a save-conflict refetch races and drops). The endpoint mints a
    // single-use claim token + writes the durable flag under the save lock; we
    // still set the local flag optimistically for instant UI + an autosave fallback.
    onQueueCombatClaim?: (missionKey: string) => void;
}) {
    type CombatStatus = {
        name: string;
        rounds: number;
        activeRound?: number;
        amount?: number;
        percent?: number;
        kind: "positive" | "negative";
    };
    type BattleActor = "player" | "enemy";
    type BattleActionEntry = {
        round: number;
        actor: string;
        actorRole: BattleActor;
        actionId: string;
        description: string;
        actionNumber: number;
        createdAt: number;
    };
    type SelectedCombatAction = "move" | undefined;

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
    const { battlefieldRef, battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale } = useBoardScale(GRID_LAYER_W, GRID_LAYER_H);

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
    const allItems = getAllItems(creatorItems);
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
    // arrangement players set in the Profile loadout carries into battle.
    const equippedJutsus = character.equippedJutsuIds
        .map((id) => allJutsus.find((jutsu) => jutsu.id === id))
        .filter((jutsu): jutsu is Jutsu => !!jutsu && canEquipElementJutsu(character, jutsu, savedBloodlines));
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
    // An elemental particle burst on each jutsu cast, drawn on a <canvas> that
    // overlays the hex board. Reuses the pet arena's PetParticleField engine.
    // The main Arena fight is computed client-side with NO ranked-replay /
    // determinism constraint (unlike the pet sim and live PvP), so this layer is
    // purely visual and can never affect balance, rewards, or outcomes.
    // Weak phones AND weak desktops skip the heavy combat VFX (rAF particle
    // canvas + per-cast sprite-frame swaps) that lags low-end hardware; only the
    // cheap tile hit-flash stays. Computed once (cached in device-tier).
    const liteFx = useMemo(() => prefersLiteCombatFx(), []);
    const combatVfxCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const combatVfxFieldRef = useRef<PetParticleField | null>(null);
    // Floating ±damage/heal numbers over a fighter on every HP change (D3 — PvE
    // parity with PvP's pvp-hit-fx). Purely cosmetic overlay; reuses the same CSS
    // classes/palette. Per-HP refs dedup so each transition fires once.
    const [pveHitFx, setPveHitFx] = useState<{ id: string; x: number; y: number; amount: number; kind: "damage" | "heal" }[]>([]);
    const prevPlayerHpRef = useRef<number | null>(null);
    const prevEnemyHpRef = useRef<number | null>(null);
    // Persisted "fast battles" preference (B2): halves the enemy-turn pacing
    // beats. Read via a ref in the delay code so a mid-fight toggle applies on
    // the next beat without stale-closure issues.
    const [combatFast, setCombatFast] = useState(false);
    const combatFastRef = useRef(false);
    useEffect(() => { combatFastRef.current = combatFast; }, [combatFast]);
    useEffect(() => { try { setCombatFast(localStorage.getItem("combatFast.v1") === "1"); } catch { /* ignore */ } }, []);
    const combatFxSeq = useRef(0);
    const [combatFx, setCombatFx] = useState<{ id: number; focusPos: number; spec: ReturnType<typeof jutsuVfxBurst>; frames: string[] | null; single: boolean; variant?: string } | null>(null);
    // The currently-playing sprite-sheet FX overlay. Resolved from combatFx in
    // the burst effect (its on-screen x/y is read from the live tile DOM rect).
    const [combatSpriteFx, setCombatSpriteFx] = useState<{ id: number; frames: string[]; single: boolean; x: number; y: number; variant?: string } | null>(null);
    // Queue a baseline cosmetic burst at a board tile for a cast jutsu (called
    // from castJutsu and the enemy AI turn). The old heavy/KO escalation tier
    // (scaled drop-shadow sprite + whole-board screen shake) was removed: it was
    // GPU-expensive and froze older iPhones / budget Androids on damage casts.
    // `heavy`/`isKO` are still accepted from callers but no longer change the
    // visuals — every cast uses the cheap baseline burst. focusPos < 0 → skip.
    const triggerCombatFx = (
        jutsu: Jutsu,
        opts: { selfCast: boolean; focusPos: number; heavy?: boolean; isKO?: boolean },
    ) => {
        // Combat SFX — reuse the pet sound engine, which routes through the global
        // master mute (so it's SILENT by default / whenever audio is muted, and the
        // one mute button covers it). Plays for player + enemy casts; deliberately
        // NOT gated by reduced-motion (that's a motion preference, not audio).
        playPetSfx(opts.isKO ? "ko" : opts.selfCast ? "buff" : opts.heavy ? "crit" : "hit");
        if (opts.focusPos < 0) return;
        const spec = jutsuVfxBurst({ element: jutsu.element, selfCast: opts.selfCast });
        // Sprite layer: a KV override (jutsufx:<id> / jutsufx:<element>, which may
        // be an animated GIF/WebP) wins; else the bundled CC0 frame sequence picked
        // by intent/discipline/element (jutsuFxSpriteKey, not element alone, so a
        // heal/shield/debuff/DoT no longer all flash the same element explosion);
        // else null → particle burst only. On weak devices the whole sprite/particle
        // layer is gated off (only the cheap tile flash plays), so skip resolving it.
        let frames: string[] | null = null;
        let single = false;
        let variant: string | undefined;
        if (!liteFx) {
            const elKey = String(jutsu.element ?? "").toLowerCase();
            const kvFx = sharedImages[`jutsufx:${jutsu.id}`] || sharedImages[`jutsufx:${elKey}`] || "";
            const pick = jutsuFxSpriteKey(jutsu, {});
            frames = kvFx ? [kvFx] : bundledJutsuFxFrames(pick.key);
            single = !!kvFx;
            variant = kvFx ? undefined : pick.variant;
        }
        setCombatFx({ id: combatFxSeq.current++, focusPos: opts.focusPos, spec, frames, single, variant });
    };
    // Spin up / tear down the canvas particle field when the battlefield mounts.
    // Skipped entirely on weak devices — no canvas, no rAF loop, no lag.
    useEffect(() => {
        if (!battleStarted || liteFx) return;
        const canvas = combatVfxCanvasRef.current;
        if (!canvas) return;
        let field: PetParticleField | null = null;
        try { field = new PetParticleField(canvas); } catch { return; }
        combatVfxFieldRef.current = field;
        const onResize = () => field?.resize();
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); field?.dispose(); combatVfxFieldRef.current = null; };
    }, [battleStarted]);
    // Keep the canvas backing store matched to the board as it resizes / zooms.
    useEffect(() => { combatVfxFieldRef.current?.resize(); }, [boardContainerSize, effectiveScale, battleStarted]);
    // Fire the queued burst at its focal tile (target for a hit, caster for a
    // self-buff), reading the live tile DOM rect so it stays correct under the
    // board's scale transform. Also pulses a brief flash on the struck tile.
    // Skipped under prefers-reduced-motion.
    useEffect(() => {
        if (!combatFx) return;
        const board = battlefieldRef.current;
        if (!board) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const tileEl = board.querySelector<HTMLElement>(`.hex-tile[data-tile="${combatFx.focusPos}"]`);
        if (!tileEl) return;
        // Lightweight impact feedback — the cheap tile flash plays on EVERY device
        // (this is the "impact" kept when the heavy layer is gated off on weak HW).
        tileEl.classList.add("jutsu-impact-flash");
        const clear = window.setTimeout(() => tileEl.classList.remove("jutsu-impact-flash"), 460);
        // Heavy cosmetic layer — particle burst + sprite-sheet overlay. The field
        // is never created on weak devices (see the mount effect above), so this
        // whole block is naturally skipped there.
        const field = combatVfxFieldRef.current;
        const canvas = combatVfxCanvasRef.current;
        if (field && canvas) {
            const t = tileEl.getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            const cx = (t.left + t.right) / 2 - c.left;
            const cy = (t.top + t.bottom) / 2 - c.top;
            field.burst(cx, cy, combatFx.spec);
            if (combatFx.frames && combatFx.frames.length) {
                setCombatSpriteFx({ id: combatFx.id, frames: combatFx.frames, single: combatFx.single, x: cx, y: cy, variant: combatFx.variant });
            }
        }
        return () => { window.clearTimeout(clear); };
    }, [combatFx]);

    const [aiLevel, setAiLevel] = useState(character.level);
    const [sparSearch, setSparSearch] = useState("");
    const [activeArenaTab, setActiveArenaTab] = useState<"clanWar" | "tournaments" | "ranked" | "spectate" | "spar" | "petBattles">("ranked");
    const [opponentCharacter, setOpponentCharacter] = useState<Character | null>(null);
    const [rankedBattleActive, setRankedBattleActive] = useState(false);
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
                    setRankedQueueSize(data.queueSize ?? 0);
                    if (data.match) {
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
                            challengePlayer(stub, "ranked");
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
    const opponentAvatar = opponentCharacter?.avatarImage
        || (opponentCharacter ? (sharedImages['avatar:' + opponentCharacter.name.toLowerCase()] ?? '') : '')
        || pendingAiProfile?.image
        || (pendingAiProfile ? (sharedImages['ai:' + pendingAiProfile.id] ?? '') : '')
        || pendingAiProfile?.icon
        || "EN";
    // PvE difficulty curve — scale standard PvE AI enemy stats AND max HP by the
    // band for the ENCOUNTER's level (easy 1-30, medium 31-50, hard 51-90,
    // peer 91+). Excludes real PvP (opponentCharacter), the endless tower
    // (already wave-scaled), and ranked, so nothing double-dips and PvP balance
    // is untouched. The HP factor only applies to the AI fallback / authored HP
    // (a live opponentCharacter is gated out by isStandardPve). See
    // lib/pve-difficulty.ts.
    const isStandardPve = !opponentCharacter && !endlessBattleActive && !rankedBattleActive;
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
    const enemyAiJutsus = pendingAiProfile
        ? allJutsus.filter((jutsu) => pendingAiProfile.jutsuIds.includes(jutsu.id))
        : opponentCharacter
            ? getAllJutsus(savedBloodlines, creatorJutsus, opponentCharacter).filter((jutsu) => opponentCharacter.equippedJutsuIds.includes(jutsu.id))
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
    const [enemyJutsuCooldowns, setEnemyJutsuCooldowns] = useState<Record<string, number>>({});

    const [playerShield, setPlayerShield] = useState(equippedShieldBonus);
    const [enemyShield, setEnemyShield] = useState(0);

    const [ap, setAp] = useState(100);
    const [enemyAp, setEnemyAp] = useState(100);
    const [turn, setTurn] = useState(1);
    // Easy-band "teach, don't ambush" pacing: in the opening rounds an easy-band
    // enemy holds its burst/signature jutsu, so the AI move-pickers fall through
    // to weaker attacks / movement first. Standard PvE only.
    const easyHoldBurst = isStandardPve && pveEasyBandHoldsBurst(opponentLevel, turn);
    const applyEasyBurstHold = (jutsus: Jutsu[]): Jutsu[] =>
        easyHoldBurst ? jutsus.filter((jutsu) => !pveIsBurstJutsuAp(jutsu.ap)) : jutsus;
    const [battleEnded, setBattleEnded] = useState(false);
    const [battleResult, setBattleResult] = useState<"win" | "loss" | "fled" | null>(null);
    // Battle-end sting — a victory chime on a win, a KO thud on a loss/flee.
    // Routes through the pet SFX engine's master mute, so it's silent by default.
    useEffect(() => {
        if (battleResult === "win") playPetSfx("victory");
        else if (battleResult === "loss" || battleResult === "fled") playPetSfx("ko");
    }, [battleResult]);
    // In-flight guard for the weekly-boss "Log Damage & Return" button. The handler
    // (onWeeklyBossLogDamage) fires a logFight POST and navigates away, so a fast
    // double-click would otherwise submit two attempts and double-count the damage.
    // Set on click, disable the button while true; the handler leaves the screen so
    // no reset is needed.
    const [logging, setLogging] = useState(false);
    // True only for an explore-ambush win. winBattle sets it (the exploreAmbushActive
    // prop is cleared by onExploreAmbushWon in the same call, so we capture it here)
    // and the victory overlay reads it to offer a single "Return to Sector" exit
    // instead of Fight Again / Return to Village. Reset at each fight start.
    const exploreAmbushWinRef = useRef(false);
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
    // Persistent ground-effect zones the PLAYER drops with an INSTANT_EFFECT
    // ground jutsu (mirrors PvP `groundEffects`). Each re-applies its debuffs to
    // the enemy whenever the enemy stands in it, for `rounds` rounds. Only the
    // player owns zones — the AI never casts ground jutsu. (PvP: api/pvp/move.ts
    // groundEffects / applyGroundEffects / tickGroundEffects.)
    type GroundZone = { id: string; tiles: number[]; rounds: number; tags: { name: string; percent?: number }[] };
    const [groundZones, setGroundZones] = useState<GroundZone[]>([]);
    // Tags a ground zone may carry — matches PvP groundEffectTags.
    const GROUND_ZONE_TAGS = new Set(["Decrease Damage Given", "Recoil", "Poison"]);

    const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
    const [jutsuCooldowns, setJutsuCooldowns] = useState<Record<string, number>>({});
    const [log, setLog] = useState("Battle started.");
    const [, setCombatLog] = useState<string[]>([]);
    const [activeActor, setActiveActor] = useState<BattleActor>(rollInitiative);
    const [actionsThisTurn, setActionsThisTurn] = useState(0);
    const [battleHistory, setBattleHistory] = useState<BattleActionEntry[]>([]);
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
    const lastPetActionKeyRef = useRef("");

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
    const activeBattlePet = character.pets.find((pet) => pet.id === character.activePetId);
    const summonedPet = activeBattlePet && summonedPetId === activeBattlePet.id ? activeBattlePet : null;
    const canSummonPet = Boolean(!opponentCharacter && !opponentIsMerc && battleStarted && !battleEnded);

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
        // `absorbed` is returned so callers can LOG it — it used to silently
        // shrink the damage number, which read as "the AI's Absorb did nothing".
        return { net: Math.max(0, rawDamage - absorbed), reflected, absorbed };
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
            enemyTurn();
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
        const pPrev = prevPlayerHpRef.current;
        if (pPrev != null && playerHp !== pPrev) {
            const d = playerHp - pPrev;
            next.push(floatAt(playerPos, Math.abs(d), d < 0 ? "damage" : "heal", "p"));
        }
        const ePrev = prevEnemyHpRef.current;
        if (ePrev != null && enemyHp !== ePrev) {
            const d = enemyHp - ePrev;
            next.push(floatAt(enemyPos, Math.abs(d), d < 0 ? "damage" : "heal", "e"));
        }
        prevPlayerHpRef.current = playerHp;
        prevEnemyHpRef.current = enemyHp;
        if (!next.length) return;
        setPveHitFx((cur) => [...cur, ...next].slice(-8));
        const t = window.setTimeout(() => {
            setPveHitFx((cur) => cur.filter((f) => !next.some((n) => n.id === f.id)));
        }, 1100);
        return () => window.clearTimeout(t);
    }, [playerHp, enemyHp]);

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
    }, []);

    useEffect(() => {
        if (lobbyMode === "arenaDistrict") return;
        if (!pendingAiProfile || battleStarted) return;
        const battleWeather = currentWeather;
        setOpponentCharacter(null);
        setAiLevel(pendingAiProfile.level);
        setEnemyHp(pendingAiProfile.hp);
        startPrefight(pendingAiProfile.hp, `Event battle started against ${pendingAiProfile.name}. Weather: ${weatherEffects[battleWeather].name}.`);
    }, [lobbyMode, pendingAiProfile?.id, battleStarted]);

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
        exploreAmbushWinRef.current = false;
    }

    function beginAiBattle() {
        const hp = maxHpForLevel(aiLevel);
        setPendingAiProfileId("");
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setRankedBattleActive(false);
        setClanWarPointsActive(0);
        setOpponentCharacter(null);
        setEnemyHp(hp);
        startPrefight(hp, `AI battle started against a Level ${aiLevel} AI Ninja. Weather: ${weatherEffects[currentWeather].name}.`);
    }

    async function challengePlayer(opponent: PlayerRecord, mode: DuelChallenge["mode"] = "standard", clanWarPoints = 0) {
        const isPetMode = mode === "clanWarPet" || mode === "rankedPet";
        if (isPetMode && !character.pets.length) {
            alert("You need a pet before sending a pet battle challenge.");
            return;
        }
        const knownPetTarget = isPetMode ? playerRoster.find((player) => player.name.toLowerCase() === opponent.name.toLowerCase()) : undefined;
        if (isPetMode && knownPetTarget && knownPetTarget.character.pets.length === 0) {
            alert(`${opponent.name} does not have a pet available for battle.`);
            return;
        }
        // Pet ranked: mint ONE server-minted match token (seals BOTH pre-match
        // pet ratings) so the rating swing is server-authoritative + exactly-once.
        // The SAME token rides the challenge to the responder and back via the
        // accepted notice, so both sides report it (the server NX-dedups per
        // token, settling both accounts once). Mint failure → local Elo fallback.
        let petRankedToken: string | undefined;
        if (mode === "rankedPet") {
            try {
                const tokRes = await fetch("/api/pet/ranked-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ opponentName: opponent.name }),
                });
                if (tokRes.ok) petRankedToken = ((await tokRes.json()) as { matchToken?: string }).matchToken;
            } catch { /* fall back to local Elo estimate */ }
        }
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: opponent.name,
            challenger: character,
            challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
            challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            challengerPetId: isPetMode ? (character.pets.find(pet => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? character.pets.find(pet => !isPetOnExpedition(pet)))?.id : undefined,
            petBattleSeed: isPetMode ? Date.now() + Math.floor(Math.random() * 100000) : undefined,
            // Pet ranked: stamp my account-level pet Elo so the responder's
            // accepted-notice carries both ratings for symmetric deltas.
            challengerPetRating: mode === "rankedPet" ? (character.petRankedRating ?? 1000) : undefined,
            petRankedToken,
            createdAt: Date.now(),
            mode,
            clanWarPoints,
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
            alert(`${mode === "ranked" ? "Ranked challenge" : mode === "rankedPet" ? "Ranked pet challenge" : mode === "clanWarPet" ? "Pet challenge" : "Challenge"} sent to ${opponent.name}.`);
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
        const challenger = normalizeCharacter(challenge.challenger);
        setDuelChallenges(duelChallenges.filter((candidate) => candidate.id !== challenge.id));
        try {
            // Create a shared turn-based hex-grid PvP session: challenger = p1, us = p2
            const [p1CombatSave, p2CombatSave] = await Promise.all([
                fetchPlayerCombatSave(challenge.fromName),
                fetchPlayerCombatSave(character.name),
            ]);
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
                body: stringifyPvpSessionPayload({ useCurrentVitals: !!challenge.sectorAttack, ranked: challenge.mode === "ranked", rankedKind: "player", baseRewards: true, rewardSector: currentSector, ...pvpSessionEnvironment(challenge.mode === "ranked", currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement), p1Character: { ...p1Character, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(p1Character, p1AllItems), bloodlineMult: challenge.challengerBloodlineMult ?? getBloodlineMultiplier(p1Character, p1SavedBloodlines), armorFactor: getCharacterArmorFactor(p1Character, p1AllItems), armorRawDR: getCharacterArmorRawDR(p1Character, p1AllItems), itemDamagePct: getEquippedItemBonus(p1Character, p1AllItems, "damagePercent") }, p2Character: { ...p2Character, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(p2Character, p2AllItems), bloodlineMult: getBloodlineMultiplier(p2Character, p2SavedBloodlines), armorFactor: getCharacterArmorFactor(p2Character, p2AllItems), armorRawDR: getCharacterArmorRawDR(p2Character, p2AllItems), itemDamagePct: getEquippedItemBonus(p2Character, p2AllItems, "damagePercent") } }),
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
        if (!jutsu || jutsu.method !== "AOE_CIRCLE") return new Set<number>();
        if (isGroundEffectJutsu(jutsu)) return new Set<number>();
        if (isMoveJutsu(jutsu)) return new Set<number>(); // Move+AOE_CIRCLE uses hover-based ring preview
        if (!jutsuRangeTiles(jutsu).has(enemyPos)) return new Set<number>();
        return new Set([enemyPos, ...hexNeighbors(enemyPos)]);
    }

    function groundAffectedTiles(jutsu: Jutsu | null | undefined, groundTile: number | null) {
        if (!jutsu || !isGroundEffectJutsu(jutsu)) return new Set<number>();
        if (groundTile === null) return new Set<number>();
        if (jutsu.method === "INSTANT_EFFECT") return new Set([groundTile, ...hexNeighbors(groundTile)]);
        if (jutsu.method === "AOE_CIRCLE") return new Set(hexNeighbors(groundTile));
        return new Set([groundTile]);
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
        const brokeNote = gearBroke ? ` ${petPveGearById(pveId)?.name ?? "Its PVE gear"} has worn out and breaks.` : "";
        const healNote = heal > 0 ? ` It steadies you — +${heal} HP.` : "";
        const consNote = consHeal > 0 ? ` ${petConsumableById(consId)?.name ?? "A consumable"} shields you for +${consHeal} HP.` : "";
        setLog(`${petDisplayName(activeBattlePet)} joins the fight and will act after your moves.${healNote}${consNote}${brokeNote}`);
        addCombatLog(`${character.name} summons ${petDisplayName(activeBattlePet)}. Happiness: ${petHappiness(activeBattlePet)}%.`, "summonPet", petDisplayName(activeBattlePet));
    }

    function runSummonedPetAction() {
        if (!summonedPet || opponentCharacter || opponentIsMerc || battleEnded || activeActor !== "player") return;
        if (enemyHp <= 0 || playerHp <= 0) return;

        const petName = petDisplayName(summonedPet);
        const happiness = petHappiness(summonedPet);
        const loyalTarget = happiness >= 71;
        // PVE gear: a loyalty charm stops backfires; summon-damage gear scales
        // the hit (with execute vs a low-HP foe / avenger while you're low).
        const gearLoyal = petPveLoyalty(summonedPet);
        const attacksEnemy = loyalTarget || gearLoyal || Math.random() >= 0.5;
        const enemyHpPct = (enemyHp / Math.max(1, enemyMaxHp)) * 100;
        const playerHpPct = (playerHp / Math.max(1, character.maxHp)) * 100;
        // Speed-scaled crit + a damage roll so summon hits have visible punch.
        const summonCrit = Math.random() < Math.min(0.45, 0.16 + summonedPet.speed / 1100);
        const summonVar = 0.9 + Math.random() * 0.2;
        const damage = Math.max(1, Math.floor(petCombatDamage(summonedPet) * petPveSummonDamageMult(summonedPet, enemyHpPct, playerHpPct) * (summonCrit ? PET_CRIT_MULT : 1) * summonVar));
        const critNote = summonCrit ? " — CRITICAL HIT!" : "";

        if (attacksEnemy) {
            const newEnemyHp = Math.max(0, enemyHp - damage);
            setEnemyHp(newEnemyHp);
            const loyaltyNote = (loyalTarget || gearLoyal) ? "" : " despite its low happiness";
            // PVE gear lifesteal — heal the player for a cut of the damage dealt.
            const lsPct = petPveLifestealPct(summonedPet);
            let healNote = "";
            if (lsPct > 0) {
                const heal = Math.max(1, Math.floor(damage * lsPct / 100));
                const healedHp = Math.min(character.maxHp, playerHp + heal);
                if (healedHp > playerHp) {
                    setPlayerHp(healedHp);
                    updateCharacter({ ...character, hp: healedHp });
                    healNote = ` It channels ${heal} HP back to you.`;
                }
            }
            setLog(`${petName} attacks ${opponentName}${loyaltyNote} for ${damage} damage${critNote}.${healNote}`);
            addCombatLog(`${petName} attacks ${opponentName}${loyaltyNote} for ${damage} damage${critNote}.${healNote}`, "petAttack", petName);
            if (newEnemyHp <= 0) winBattle();
            return;
        }

        const friendlyDamage = Math.max(1, Math.floor(damage * 0.65));
        const newPlayerHp = Math.max(0, playerHp - friendlyDamage);
        setPlayerHp(newPlayerHp);
        updateCharacter({ ...character, hp: newPlayerHp });
        setLog(`${petName}'s low happiness backfires. It attacks you for ${friendlyDamage} damage.`);
        addCombatLog(`${petName}'s low happiness backfires and it attacks ${character.name} for ${friendlyDamage} damage.`, "petBackfire", petName);

        if (newPlayerHp <= 0) {
            setBattleEnded(true);
            setBattleResult("loss");
            setRaidBattleKind("none");
            setLog(`${character.name} was defeated after ${petName}'s backfire.`);
            addCombatLog(`${petName}'s backfire defeats ${character.name}.`, "defeat", petName);
        }
    }

    function waitTurn() {
        if (battleEnded) return;
        if (activeActor === "enemy") {
            enemyTurn();
            return;
        }
        addCombatLog(`${character.name} waits and ends their turn with ${ap} AP remaining.`, "wait", character.name);
        enemyTurn();
    }

    useEffect(() => {
        if (!summonedPet || opponentCharacter || !battleStarted || battleEnded || activeActor !== "player" || actionsThisTurn <= 0) return;
        const key = `${turn}:${actionsThisTurn}`;
        if (lastPetActionKeyRef.current === key) return;
        lastPetActionKeyRef.current = key;
        runSummonedPetAction();
    }, [actionsThisTurn, activeActor, battleEnded, battleStarted, opponentCharacter, summonedPet?.id, turn]);  

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

            updateCharacter({
                ...gainJutsuXpForRank(character, pendingTargetJutsu.id, boostAmount(currentSector === 99 && !!opponentCharacter ? 40 : 20, getActiveAuraSphereBonuses(character).jutsuXpPercent)),
                hp: Math.max(0, character.hp - scaled.healthCost),
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
        if (basicHeal > 0 || basicSelfDamage > 0) setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + basicHeal - basicSelfDamage)));

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

    function combatItemInitials(name: string) {
        return name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "IT";
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
        let damage = calculateDamage(
            weaponJutsu,
            characterCombatStats,
            enemyCombatStats,
            enemyMaxHp,
            activeBloodlineMultiplier(character, playerStatuses),
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
            effectLines.push(`Poison: ${opponentName} is poisoned — takes ${effectVal}% chakra as damage per round for 2 rounds.`);
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
        if (wHeal > 0 || wSelfDamage > 0) setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + wHeal - wSelfDamage)));
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
        if ((cooldowns.basicHeal ?? 0) > 0) return setLog(`Basic Heal cooldown: ${cooldowns.basicHeal} rounds.`);
        if (character.chakra < 10) return setLog("Basic Heal needs 10 chakra.");
        if (!spendAp(60, "basicHeal")) return;

        const healAmount = Math.max(1, Math.floor(character.maxHp * 0.1));
        setPlayerHp((hp) => Math.min(character.maxHp, hp + healAmount));
        setCooldowns((c) => ({ ...c, basicHeal: 5 }));
        updateCharacter({ ...character, chakra: Math.max(0, character.chakra - 10) });
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
            const rewardLog = onPendingStoryBattleWin?.(playerHp) ?? `${opponentName} defeated. Story battle complete.`;
            setBattleEnded(true);
            setBattleResult("win");
            setLog(rewardLog);
            addCombatLog(rewardLog, "storyVictory", character.name);
            setRaidBattleKind("none");
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
            const queued = (base.pendingCombatMissionClaims ?? []).includes(combatMission.key)
                ? (base.pendingCombatMissionClaims ?? [])
                : [...(base.pendingCombatMissionClaims ?? []), combatMission.key];
            const queuedChar = { ...base, hp: playerHp, pendingCombatMissionClaims: queued };
            updateCharacter(queuedChar);
            // Queue the claim SERVER-SIDE so it's durable and the Mission Hall claim
            // can't be rejected `not-queued`. The endpoint mints a single-use claim
            // token + writes the flag under the save lock; the local set above is
            // just optimistic UI + an autosave fallback if this POST fails.
            onQueueCombatClaim?.(combatMission.key);
            setBattleEnded(true);
            setBattleResult("win");
            setRaidBattleKind("none");
            setClanWarPointsActive(0);
            const claimNote = `${opponentName} defeated. Return to the Mission Hall to claim your ${combatMission.name} reward.`;
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
        const activeTrait = getActivePetTrait(character);
        const xpGain = activeTrait === "Swift" ? 125 : 100;
        const ryoGain = activeTrait === "Lucky" ? 90 : 75;
        const honorSealGain = raidBattleKind === "defense" ? 20 : raidBattleKind === "raidAi" ? 5 : 0;
        const auraDustGain = raidBattleKind === "defense" ? 8 : raidBattleKind === "raidAi" ? 4 : 0;
        const defeatedAiIds = pendingAiProfile?.id && !(base.defeatedAiIds ?? []).includes(pendingAiProfile.id)
            ? [...(base.defeatedAiIds ?? []), pendingAiProfile.id]
            : base.defeatedAiIds ?? [];
        // Per-AI kill count for the Bestiary (kill-count tiers).
        const aiKills = pendingAiProfile?.id
            ? { ...(base.aiKills ?? {}), [pendingAiProfile.id]: ((base.aiKills ?? {})[pendingAiProfile.id] ?? 0) + 1 }
            : (base.aiKills ?? {});
        const territoryScrollReward = 1;
        const territoryRaidDamageAmount = (raidBattleKind === "raidAi" || raidBattleKind === "raidPlayer") ? sectorRaidDamageAmount(currentSector) : 0;
        const territoryRaidDamage = territoryRaidDamageAmount > 0 ? damageSectorTerritory(currentSector, territoryRaidDamageAmount) : null;
        // Village War HP/ground damage is gated to PvP raids only. AI raids
        // would let a single player solo-grind enemy village HP to zero
        // while no enemy is online — defeats the whole point of village
        // war as a player-vs-player meta. The win-condition is unchanged:
        // PvP raids still drive both warGroundHp and the enemy village HP.
        const villageWarRaid = (raidBattleKind === "raidPlayer") ? recordVillageWarRaid(character, currentSector, playerRoster) : { note: "", characterPatch: {} as Partial<Character>, warCrate: false, warCrateId: undefined as string | undefined, bountyRyo: 0, bountyFateShards: 0 };
        // P0.2c: when warCrateServerAuth.v1 is ON the village-war WINNER crate is
        // granted server-side (claimServerVillageWarCrates via the post-poll sweep,
        // validated against the authoritative war record), so winBattle stops adding
        // it inline. Flag OFF → inline grant exactly as before (byte-identical). Kept
        // out of the async grant path so it never races the P0.2b updateCharacter.
        const grantWarCrateInline = villageWarRaid.warCrate && !warCrateServerAuthEnabled();
        // Assemble the win-reward character from a (possibly soft-capped) XP/ryo
        // pair. Everything it captures above is computed ONCE (the territory /
        // village-war side effects mutate shared state, so they must not re-run);
        // buildWin itself is pure apart from the single Ironclad bonecharm roll,
        // and is called exactly once per win — synchronously when the flag is OFF,
        // or once inside the fetch .then/.catch when ON — so that roll never doubles.
        const buildWin = (effXp: number, effRyo: number): Character => {
            const leveled = gainXp({ ...base, hp: playerHp }, effXp);
            const rewarded = grantTerritoryScrolls(leveled, territoryScrollReward);
            const winCharacter: Character = {
                ...rewarded,
                ...villageWarRaid.characterPatch,
                ryo: rewarded.ryo + effRyo + villageWarRaid.bountyRyo,
                fateShards: (rewarded.fateShards ?? 0) + villageWarRaid.bountyFateShards + nonVanguardShardSubstitute(rewarded, honorSealGain),
                honorSeals: (rewarded.honorSeals ?? 0) + vanguardOnlyHonorSeals(rewarded, honorSealGain),
                auraDust: (rewarded.auraDust ?? 0) + auraDustGain,
                stamina: Math.min(rewarded.maxStamina, rewarded.stamina + 15),
                // + Vanguard mastery (Ironclad): a chance at a Bone Charm per AI kill.
                boneCharms: (rewarded.boneCharms ?? 0) + nonVanguardCharmSubstitute(rewarded, honorSealGain) + (masteryHasCapstone(character, "ironclad") && Math.random() < 0.15 ? 1 : 0),
                inventory: grantWarCrateInline ? [...rewarded.inventory, LEGENDARY_WAR_CRATE_ID] : rewarded.inventory,
                claimedWarCrateIds: grantWarCrateInline && villageWarRaid.warCrateId
                    ? [...(rewarded.claimedWarCrateIds ?? []), villageWarRaid.warCrateId]
                    : (rewarded.claimedWarCrateIds ?? []),
                // clanBattleContrib intentionally NOT incremented here — it's a
                // PvP-only contribution counter and the AI-only branch shouldn't
                // touch it (the save endpoint also caps growth, but the cleaner
                // contract is "only PvP wins move clan-war contribs").
                totalAiKills: (rewarded.totalAiKills ?? 0) + 1,
                dailyAiKills: (rewarded.dailyAiKills ?? 0) + 1,
                totalVillageRaids: (rewarded.totalVillageRaids ?? 0) + (raidBattleKind === "raidAi" || raidBattleKind === "raidPlayer" ? 1 : 0),
                defeatedAiIds,
                aiKills,
            };
            // Mission battles credit completion (daily slot / clan contrib / lifetime)
            // ONLY on an actual AI win — never at battle start — so losing or fleeing a
            // mission no longer counts. raidBattleKind === "none" excludes raids.
            return missionBattleActive && raidBattleKind === "none" ? markMissionCompleted(winCharacter) : winCharacter;
        };
        // P0.2b: when aiFightServerAuth.v1 is ON, the server keeps an authoritative
        // per-day AI-win counter and returns the soft-capped XP/ryo the client may
        // grant; we apply exactly those. The battle-end UI + the territory /
        // village-war side effects above already ran synchronously, so only the
        // reward GRANT defers to the .then. OFF (default) — or any network/endpoint
        // failure — grants the locally-computed base, so the result is byte-identical
        // to before the flag existed and a server hiccup never costs the player a win.
        if (aiFightServerAuthEnabled()) {
            fetch("/api/missions/report-ai-fight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, xp: xpGain, ryo: ryoGain }),
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((data: { xp?: unknown; ryo?: unknown } | null) => {
                    const okXp = typeof data?.xp === "number" ? data.xp : xpGain;
                    const okRyo = typeof data?.ryo === "number" ? data.ryo : ryoGain;
                    updateCharacter(buildWin(okXp, okRyo));
                })
                .catch(() => updateCharacter(buildWin(xpGain, ryoGain)));
        } else {
            updateCharacter(buildWin(xpGain, ryoGain));
        }
        if (exploreAmbushActive && raidBattleKind === "none") {
            // Explore-mission credit deferred from exploreSector — granted only
            // now that the ambush was won. Flag the win so the victory overlay
            // offers a single "Return to Sector" exit (back to where the player
            // was exploring) instead of Fight Again / Return to Village.
            exploreAmbushWinRef.current = true;
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

        const bonusNote = activeTrait === "Swift" ? " (Swift +25% XP)" : activeTrait === "Lucky" ? " (Lucky +20% ryo)" : "";
        const honorNote = honorSealGain > 0 ? ` +${honorSealGain} Honor Seals.` : "";
        const auraDustNote = auraDustGain > 0 ? ` +${auraDustGain} Aura Dust.` : "";
        setBattleEnded(true);
        setBattleResult("win");
        const scrollNote = ` +${territoryScrollReward} Territory Control Scroll.`;
        const raidNote = territoryRaidDamage?.ownerClan ? ` Sector ${currentSector} HP -${territoryRaidDamageAmount}.` : territoryRaidDamage ? ` Sector ${currentSector} control broken.` : "";
        const villageWarNote = `${villageWarRaid.note}${villageWarRaid.warCrate ? " Your village won the war. +1 Legendary War Crate." : ""}`;
        const effectiveXpGain = effectiveCharacterXpGain(character, xpGain);
        setLog(`${opponentName} defeated. +${effectiveXpGain} XP, +${ryoGain} ryo, +15 stamina.${bonusNote}${honorNote}${auraDustNote}${scrollNote}${raidNote}${villageWarNote}`);
        addCombatLog(`${opponentName} is defeated. ${character.name} gains ${effectiveXpGain} XP, ${ryoGain} ryo, 15 stamina${honorNote}${auraDustNote}${bonusNote}${scrollNote}${raidNote}${villageWarNote}`);
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
                    // Match PvP (api/pvp/move.ts): poison ticks floor(maxChakra × pct/100),
                    // UNCAPPED. PvE previously clamped this to ½·(chakra+stamina cost).
                    const poisonDmg = Math.floor(enemyMaxChakra * (pct / 100));
                    queueEnemyStatus({ name: "Poison", rounds: 2, percent: pct, kind: "negative", amount: poisonDmg });
                    effectLines.push(`${opponentName} is poisoned — takes ${poisonDmg} damage/round for 2 rounds${tagTimingText}`);
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
                setGroundZones((z) => [...z, { id: `gz-${jutsu.id}-${turn}-${z.length}`, tiles, rounds: 2, tags: zoneTags }]);
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

        const { net: castEnemyNet, reflected: castEnemyReflected, absorbed: castEnemyAbsorbed } = enemyDefenseFor(finalDamage + extraEnemyDamage, pierce);
        setEnemyShield((s) => pierce ? s : Math.max(0, s - blocked));
        setEnemyHp((hp) => Math.max(0, hp - castEnemyNet));
        setPlayerHp((hp) => Math.max(0, Math.min(character.maxHp, hp + healing - recoilDamage - castEnemyReflected)));
        setPlayerShield((s) => s + shield);

        setJutsuCooldowns((c) => ({ ...c, [jutsu.id]: jutsu.cooldown }));

        const postJutsuCharacter: Character = {
            ...gainJutsuXpForRank(character, jutsu.id, boostAmount(currentSector === 99 && !!opponentCharacter ? 40 : 20, getActiveAuraSphereBonuses(character).jutsuXpPercent)),
            hp: Math.max(0, character.hp - scaled.healthCost),
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
        });

        if (enemyHp - castEnemyNet <= 0) return winBattle(postJutsuCharacter);

        // Player self-KO via Recoil + enemy Reflect on their own jutsu.
        if (playerHp + healing - recoilDamage - castEnemyReflected <= 0) {
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
        const dist = distance(playerPos, enemyPos);
        if (rule.condition === "always") return true;
        if (rule.condition === "specific_round") return turn === rule.value;
        if (rule.condition === "distance_lower_than") return dist < rule.value;
        if (rule.condition === "distance_higher_than") return dist > rule.value;
        if (rule.condition === "hp_lower_than") return (enemyHp / enemyMaxHp) * 100 < rule.value;
        // Player-reactive conditions (Phase 2) — read the player's live state so a
        // rule can answer what the player is doing, not just the clock/distance.
        if (rule.condition === "player_hp_lower_than") return (playerHp / Math.max(1, character.maxHp)) * 100 < rule.value;
        if (rule.condition === "player_has_shield") return playerShield > 0;
        if (rule.condition === "player_has_buff") return activeStatuses(playerStatuses).filter((s) => s.kind === "positive").length >= Math.max(1, rule.value);
        if (rule.condition === "player_low_ap") return ap < (rule.value || 50);
        if (rule.condition === "self_has_debuff") return activeStatuses(enemyStatuses).filter((s) => s.kind === "negative").length >= Math.max(1, rule.value);
        return false;
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

    // Damage the player will take from ALREADY-ACTIVE DoT effects this turn
    // (Wound + Poison + Drain). Folded into lethal detection so a single
    // killing-blow jutsu doesn't need to do the full HP solo — if the player
    // is bleeding 200/turn from a stacked Wound and is at 250 HP, a 60-damage
    // jutsu can lethal.
    function activePlayerDotThisTurn(): number {
        let dot = 0;
        for (const s of playerStatuses) {
            if (s.name === "Wound")  dot += s.amount || 0;
            if (s.name === "Drain")  dot += s.amount ?? 50;
            if (s.name === "Poison") dot += s.amount ?? Math.floor(character.maxHp * (s.percent ?? 6) / 100);
        }
        return dot;
    }

    // Expanded jutsu pool for level-30+ smart AI. Pulls from THE FULL game
    // jutsu pool (allJutsus, includes starters + admin-created), filtered to
    // what this AI could reasonably wield:
    //   • No bloodline-locked jutsus (AI has no bloodline)
    //   • Element compatibility — favor the AI's primary jutsu type's element
    //     range over a random Lightning AI casting Water moves
    //   • Rank cap by AI level so a level-30 mob doesn't pull a level-100
    //     mythic Ninjutsu from the pool:
    //         level 30-49  → AP ≤ 60  (rough B-rank cutoff)
    //         level 50-79  → AP ≤ 80  (A-rank)
    //         level 80+    → AP ≤ 100 (S-rank, full power)
    //   • Chakra/stamina the AI can actually pay
    //   • Always includes the AI's equipped loadout (enemyAiJutsus) — even
    //     if it would otherwise be filtered out — so admin-curated AIs
    //     still get their flavor moves.
    function smartExpandedJutsuPool(): Jutsu[] {
        const lvl = opponentLevel ?? 1;
        const apCap = lvl >= 80 ? 100 : lvl >= 50 ? 80 : 60;
        // Primary element of the AI's loadout — used to bias element
        // matching (we don't HARD-filter so the AI keeps utility access).
        const primaryType = aiPrimaryJutsuType(enemyAiJutsus);
        const primaryEls = new Set<JutsuElement>();
        for (const j of enemyAiJutsus) if (j.element && j.element !== "None") primaryEls.add(j.element);

        const fromPool = allJutsus.filter((jutsu) => {
            if (jutsu.bloodlineRank) return false;                          // bloodline-locked
            if (jutsu.ap > apCap) return false;                             // rank cap
            if (jutsu.chakraCost > enemyChakra) return false;               // can't pay chakra
            if (jutsu.staminaCost > enemyStamina) return false;             // can't pay stamina
            // Element bias — if the AI has a clear primary type AND this
            // jutsu's type matches AND its element differs from the AI's
            // pool elements, skip it. Keeps a Lightning AI from spamming
            // Water moves. None-element + matching-type utility passes.
            if (primaryType && jutsu.type !== "Any" && jutsu.type !== primaryType) {
                // Allow cross-type if the AI has no jutsus of this type's
                // element — small openness so the AI can grab a useful Stun
                // or Heal it doesn't already have access to.
                if (jutsu.tags.length === 0) return false;
            }
            if (primaryEls.size > 0 && jutsu.element && jutsu.element !== "None" && !primaryEls.has(jutsu.element)) {
                return false;
            }
            return true;
        });

        // Merge with equipped loadout, dedup by id (loadout wins on ties).
        const merged = new Map<string, Jutsu>();
        for (const j of fromPool)       merged.set(j.id, j);
        for (const j of enemyAiJutsus)  merged.set(j.id, j);
        return Array.from(merged.values());
    }

    // SMART AI — used for opponents at level 30+. Pulls from the FULL game
    // jutsu pool (filtered by element/rank/affordability), then scores with
    // a multi-axis tactical model:
    //   1. LETHAL — any jutsu (alone OR combined with active player DoT)
    //      that KOs the player → fire immediately, cheapest first.
    //   2. SUSTAIN — at HP < 35%, grab heal/sustain.
    //   3. NO-REDUNDANT STATUS — skip a stun if player is already stunned,
    //      a poison/wound/drain if that DoT is already stacking, etc.
    //   4. ELEMENT MATCHUP — small bonus when the jutsu element matches a
    //      gap in the player's defensive stat allocation.
    //   5. SYNERGY — if I land a Stun, the player loses AP next turn → my
    //      follow-up nuke gets a setup bonus. If player has Decrease
    //      Damage Taken active → my big jutsus get penalized.
    //   6. AP-EFFICIENCY + SIGNATURE-RESERVE (carried over).
    function smartAiJutsuPick(availableAp: number): Jutsu | undefined {
        const expanded = smartExpandedJutsuPool();
        // Easy band holds its burst jutsu in the opening rounds (no-op otherwise).
        const usable = applyEasyBurstHold(expanded
            .filter((jutsu) => jutsu.ap <= availableAp)
            .filter((jutsu) => (enemyJutsuCooldowns[jutsu.id] ?? 0) <= 0)
            .filter((jutsu) => jutsu.target === "SELF" || jutsu.range <= 0 || distance(playerPos, enemyPos) <= jutsu.range));

        // 1. Lethal scan — include active DoT damage in the KO threshold so
        // a setup jutsu can finish through chip damage. Cheapest lethal wins.
        // Gated in the easy band: the AI only deliberately goes for the kill when
        // the player is already very low, so a healthy learner isn't executed.
        const allowLethal = !isStandardPve || pveEasyBandAllowsLethal(opponentLevel, playerHp / Math.max(1, character.maxHp));
        const dotThisTurn = activePlayerDotThisTurn();
        const requiredKo = Math.max(0, playerHp + playerShield - dotThisTurn);
        let bestLethal: { jutsu: Jutsu; ap: number } | null = null;
        for (const jutsu of usable) {
            const dmg = estimateAiJutsuDamage(jutsu);
            if (dmg >= requiredKo && dmg > 0) {
                if (!bestLethal || jutsu.ap < bestLethal.ap) bestLethal = { jutsu, ap: jutsu.ap };
            }
        }
        if (allowLethal && bestLethal) return bestLethal.jutsu;

        // 2. Sustain trigger — heal at 40% so a single nuke can't catch the
        // AI mid-heal. Previous 35% left zero buffer against a follow-up hit
        // (heal ≈ one standard hit; nuke is 1.2× that).
        const hpPct = enemyHp / Math.max(1, enemyMaxHp);
        if (hpPct < 0.40) {
            const healish = usable.find(j => isSelfSupportJutsu(j));
            if (healish) return healish;
        }

        // Pre-compute facts the score function reuses.
        const playerMaxHp = Math.max(1, character.maxHp);
        const playerStunned    = playerStatuses.some(s => s.name === "Stun");
        const playerSealed     = playerStatuses.some(s => s.name === "Bloodline Seal" || s.name === "Seal" || s.name === "Elemental Seal");
        const playerPoisoned   = playerStatuses.some(s => s.name === "Poison");
        const playerWounded    = playerStatuses.some(s => s.name === "Wound");
        const playerDrained    = playerStatuses.some(s => s.name === "Drain");
        const playerDmgUp      = playerStatuses.some(s => s.name === "Increase Damage Taken" || s.name === "Ignition");
        const playerDmgDown    = playerStatuses.some(s => s.name === "Decrease Damage Taken");
        // Lower of player's two combat resources — a low-resource player is
        // already throttled, so resource-drain jutsus lose value.
        const playerLowAp      = ap < 50; // engine-side player AP

        // ── Stack-awareness pre-computes (diminishing returns aware) ──
        // multiplicativeTagMultiplier already applies diminishing returns per
        // stack, so 2nd stack of any amp tag gives much less than the 1st,
        // and 3rd+ is near-wasted. The AI used to keep applying these even
        // when stacked — these counts let the score function penalize it.
        const selfIdgStacks      = enemyStatuses.filter(s => s.name === "Increase Damage Given").length;
        const playerIdtStacks    = playerStatuses.filter(s => s.name === "Increase Damage Taken").length;
        const playerIgnStacks    = playerStatuses.filter(s => s.name === "Ignition" || statusMatchesName(s, "Ignition")).length;
        // Defensive stacks the AI itself has on
        const selfDdtStacks      = enemyStatuses.filter(s => s.name === "Decrease Damage Taken").length;
        const playerDdgStacks    = playerStatuses.filter(s => s.name === "Decrease Damage Given").length;

        // ── Pierce-vs-armor signal ──
        // playerArmorFactor is 0.25..1.0 where lower = more armor mitigation.
        // <0.55 means the player has stacked ≥45% raw armor DR — Pierce is
        // disproportionately valuable here since it bypasses both armor and
        // any active shield.
        const playerHeavyArmor = playerArmorFactor < 0.55;
        const playerShielded   = playerShield > 0;

        return usable.sort((a, b) => {
            const tacticalScore = (jutsu: Jutsu) => {
                let score = jutsu.effectPower;
                const dmg = estimateAiJutsuDamage(jutsu);

                // ── Self-support
                if (isSelfSupportJutsu(jutsu) && hpPct > 0.70) score -= 50;
                else if (isSelfSupportJutsu(jutsu) && hpPct < 0.50) score += 15;

                // ── Control / pressure baseline (unchanged)
                if (isControlJutsu(jutsu)) score += 12;
                if (isPressureJutsu(jutsu)) score += 8;

                // ── No-redundant status — heavy penalty so the AI never
                // re-applies a status already active on the player.
                const tagNames = jutsu.tags.map(t => t.name);
                if (playerStunned   && tagNames.includes("Stun"))           score -= 40;
                if (playerSealed    && (tagNames.includes("Bloodline Seal") || tagNames.includes("Seal") || tagNames.includes("Elemental Seal"))) score -= 30;
                if (playerPoisoned  && tagNames.includes("Poison"))         score -= 25;
                if (playerWounded   && tagNames.includes("Wound"))          score -= 25;
                if (playerDrained   && tagNames.includes("Drain"))          score -= 25;
                if (playerLowAp     && tagNames.includes("Lag"))            score -= 20;

                // ── Diminishing-returns awareness for amp tags ──
                // 1st stack of an amp tag is huge; 2nd is half-value; 3rd+
                // is near-wasted under multiplicativeTagMultiplier's curve.
                // Score the cast accordingly so the AI pivots to damage
                // once a stack is up rather than spamming the buff.
                if (tagNames.includes("Increase Damage Given")) {
                    score += selfIdgStacks === 0 ? 14 : selfIdgStacks === 1 ? -2 : -25;
                }
                if (tagNames.includes("Increase Damage Taken")) {
                    score += playerIdtStacks === 0 ? 12 : playerIdtStacks === 1 ? -2 : -25;
                }
                if (tagNames.includes("Ignition")) {
                    score += playerIgnStacks === 0 ? 12 : playerIgnStacks === 1 ? -2 : -25;
                }
                if (tagNames.includes("Decrease Damage Taken")) {
                    score += selfDdtStacks === 0 ? 10 : selfDdtStacks === 1 ? -2 : -20;
                }
                if (tagNames.includes("Decrease Damage Given")) {
                    score += playerDdgStacks === 0 ? 10 : playerDdgStacks === 1 ? -2 : -20;
                }

                // ── Pierce-vs-armor bonus ──
                // Pierce bypasses both armor and shield in PvE (set to
                // flat 900 when ap≥60). Against a heavy-armor or shielded
                // player it's worth far more than its raw effect power.
                if (tagNames.includes("Pierce")) {
                    if (playerHeavyArmor) score += 25;
                    if (playerShielded)   score += 30;
                }

                // ── Mirror — only useful when carrying ≥1 transferable debuff
                // (post-fix it copies, doesn't strip from self). Penalize
                // casting Mirror in clean state since it'd send nothing.
                if (tagNames.includes("Mirror")) {
                    const selfNegStacks = enemyStatuses.filter(s => s.kind === "negative" && s.name !== "Wound" && s.name !== "Poison" && s.name !== "Drain" && !statusMatchesName(s, "Ignition")).length;
                    score += selfNegStacks >= 2 ? 22 : selfNegStacks === 1 ? 6 : -15;
                }

                // ── Synergy bonuses — set up future damage / capitalize on
                // player's current debuffs.
                if (playerDmgUp && dmg > 0) score += 8;     // their Ignition / IDT is up — hit harder
                if (playerDmgDown && dmg > 0) score -= 10;  // their DDT is up — save the AP
                if (playerStunned && dmg > 0 && jutsu.ap >= 50) score += 12; // big hit while they can't react

                // ── AP-efficiency bonus
                if (dmg > 0) score += (dmg / Math.max(1, jutsu.ap)) * 1.5;

                // ── Signature-reserve logic
                if (jutsu.ap >= 60) {
                    if (dmg / playerMaxHp >= 0.35) score += 10;
                    else                          score -= 20;
                }
                return score;
            };
            return tacticalScore(b) - tacticalScore(a) || b.ap - a.ap;
        })[0];
    }

    function highestPowerAiJutsu(availableAp = 100) {
        // Gating: opponents at level 30+ use the smart AI automatically, and
        // admins can flag an AI as masterAi to force it on at any level (elite /
        // boss mobs). Routed through pveAiCompetence.usesSmartScorer so the
        // basic→smart threshold lives in ONE place (lib/pve-difficulty.ts).
        if (pveAiCompetence(opponentLevel, pendingAiProfile?.masterAi).usesSmartScorer) {
            return smartAiJutsuPick(availableAp);
        }
        return applyEasyBurstHold([...enemyAiJutsus]
            .filter((jutsu) => jutsu.ap <= availableAp)
            .filter((jutsu) => (enemyJutsuCooldowns[jutsu.id] ?? 0) <= 0)
            .filter((jutsu) => jutsu.target === "SELF" || jutsu.range <= 0 || distance(playerPos, enemyPos) <= jutsu.range))
            .sort((a, b) => {
                const tacticalScore = (jutsu: Jutsu) => {
                    let score = jutsu.effectPower;
                    if (isSelfSupportJutsu(jutsu) && enemyHp / enemyMaxHp > 0.65) score -= 45;
                    if (isControlJutsu(jutsu)) score += 8;
                    if (isPressureJutsu(jutsu)) score += 6;
                    return score;
                };
                return tacticalScore(b) - tacticalScore(a) || b.ap - a.ap;
            })[0];
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
                    effectLines.push(`${character.name} is poisoned — takes ${poisonDmg} damage/round for 2 rounds`);
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
        setPlayerShield((s) => Math.max(0, s - blocked));
        setPlayerHp((hp) => Math.max(0, hp - playerNetTaken));
        setEnemyHp((hp) => Math.min(enemyMaxHp, hp + healing));
        if (pReflected > 0) setEnemyHp((hp) => Math.max(0, hp - pReflected));
        if (enemyRecoilDmg > 0) setEnemyHp((hp) => Math.max(0, hp - enemyRecoilDmg));
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
        if (statusReflected > 0) {
            setEnemyHp((hp) => Math.max(0, hp - statusReflected));
            addCombatLog(`Reflect: ${opponentName} takes ${statusReflected} reflected damage.`, "reflect", character.name);
        }
        if (itemReflected > 0) {
            setEnemyHp((hp) => Math.max(0, hp - itemReflected));
            addCombatLog(`Reflect (armor): ${opponentName} takes ${itemReflected} reflected damage.`, "reflect", character.name);
        }
        const enemyDealtToPlayer = Math.max(0, finalDamage - absorbed);
        const basicEnemyLsPct = sumActiveStatusPct(enemyStatuses, "Lifesteal");
        if (basicEnemyLsPct > 0 && enemyDealtToPlayer > 0) {
            const lsHeal = Math.floor(cappedPostDamage(enemyDealtToPlayer, basicEnemyLsPct));
            if (lsHeal > 0) { setEnemyHp((hp) => Math.min(enemyMaxHp, hp + lsHeal)); addCombatLog(`Lifesteal: ${opponentName} restores ${lsHeal} HP.`, "effects", opponentName); }
        }
        const basicEnemyRecoil = activeStatuses(enemyStatuses).find((s) => s.name === "Recoil");
        const basicEnemyRecoilDmg = (basicEnemyRecoil && finalDamage > 0) ? Math.floor(cappedPostDamage(finalDamage, basicEnemyRecoil.percent ?? 30)) : 0;
        if (basicEnemyRecoilDmg > 0) {
            setEnemyHp((hp) => Math.max(0, hp - basicEnemyRecoilDmg));
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

    // Pick + execute ONE enemy action. Reactive counter-play (Clear/Cleanse) is
    // tried first, gated by band competence (pveAiCompetence) and the player read
    // (buildPlayerRead) — standard PvE only, so PvP/ranked/endless are untouched.
    // Then the existing rule engine, the opponentCharacter fallback, and finally
    // a basic attack / step. Returns whether it acted and the AP it spent.
    function enemyTakeAction(availableAp: number): { acted: boolean; apSpent: number } {
        if (battleEnded) return { acted: false, apSpent: 0 };

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
        // DoT damage is summed from statuses ACTIVE this turn at their CURRENT
        // rounds — NOT pre-ticked. Mirrors api/pvp/move.ts applyDoTs, which reads
        // activeStatuses() and applies tick damage separately from the round
        // decrement (the setPlayerStatuses below). Pre-ticking here dropped the
        // final tick, so a 2-round bleed hit only once instead of twice.
        const activeDotPlayerStatuses = withoutStun(playerStatuses).filter((s) => (s.activeRound ?? turn) <= turn);
        // FUNCTIONAL set: ticks the LIVE committed state so debuffs queued this
        // turn (Poison/Drain/Ignition/Seal/Lag/Recoil) are preserved and ticked.
        setPlayerStatuses((prev) => tickStatuses(withoutStun(prev)));
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
            if (s.name === "Poison") {
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
            const nextChakra = pDrainChakra > 0 ? Math.max(0, character.chakra - pDrainChakra) : character.chakra;
            if (pDrainChakra > 0) updateCharacter({ ...character, hp: nextHp, chakra: nextChakra });
            else updateCharacter({ ...character, hp: nextHp });
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

        // Ground zones: the player's lingering patches re-apply their debuffs to
        // the enemy while it stands in one (mirrors PvP applyGroundEffects). The
        // zone's own Poison status then ticks through the normal enemy DoT below.
        // Functional setEnemyStatuses so we don't clobber other same-turn changes.
        const enemyZoneHits = groundZones.filter((z) => z.tiles.includes(enemyPos));
        if (enemyZoneHits.length && !activeStatuses(enemyStatuses).some((s) => s.name === "Debuff Prevent")) {
            const zoneStatuses: CombatStatus[] = [];
            const zoneNotes: string[] = [];
            for (const z of enemyZoneHits) {
                for (const tag of z.tags) {
                    const pct = tag.percent ?? (tag.name === "Poison" ? 6 : 30);
                    if (tag.name === "Decrease Damage Given") { zoneStatuses.push({ name: "Decrease Damage Given", rounds: 2, percent: pct, kind: "negative" }); zoneNotes.push(`−${pct}% damage`); }
                    else if (tag.name === "Recoil") { zoneStatuses.push({ name: "Recoil", rounds: 2, percent: pct, kind: "negative" }); zoneNotes.push("recoil"); }
                    else if (tag.name === "Poison") { zoneStatuses.push({ name: "Poison", rounds: 2, percent: pct, kind: "negative" }); zoneNotes.push("poison"); }
                }
            }
            if (zoneStatuses.length) {
                setEnemyStatuses((s) => zoneStatuses.reduce((acc, st) => mergeCombatStatus(acc, st), s));
                addCombatLog(`${opponentName} is caught in a ground zone (${[...new Set(zoneNotes)].join(", ")}).`, "effects", character.name);
            }
        }
        // Tick the player's zones down once per round (the enemy's turn marks a round).
        if (groundZones.length) setGroundZones((zones) => zones.map((z) => ({ ...z, rounds: z.rounds - 1 })).filter((z) => z.rounds > 0));

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
            if (s.name === "Poison") {
                const raw = s.amount ?? Math.floor(enemyMaxChakra * (s.percent ?? 6) / 100);
                dotDamage += Math.floor(raw * enemyDotMit);
            }
        });

        if (dotDamage > 0) {
            setEnemyHp((hp) => Math.max(0, hp - dotDamage));
            if (drainChakra > 0) setEnemyChakra((c) => Math.max(0, c - drainChakra));
            const drainNote = drainChakra > 0 ? ` Drain also removes ${drainChakra} chakra.` : "";
            addCombatLog(`Damage over time: ${opponentName} takes ${dotDamage} damage from active effects.${drainNote}`, "effects", opponentName);
        }

        if (enemyHp - dotDamage <= 0) return winBattle();

        // Start the multi-action turn. The first action runs synchronously (same
        // closure as the start bookkeeping above — identical to the old single-
        // action behaviour); afterEnemyAction schedules any follow-ups via
        // enemyContinueRef so they read fresh committed state. enemyTurnActiveRef
        // guards against a double-begin (e.g. waitTurn + the auto-resolve effect).
        enemyTurnActiveRef.current = true;
        enemyTurnApRef.current = enemyTurnAp;
        enemyTurnActionsRef.current = 0;
        afterEnemyAction(enemyTakeAction(enemyTurnAp));
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
        lastPetActionKeyRef.current = "";
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

    // Keep stable refs fresh — must be after all functions are defined
    resetBattleRef.current  = resetBattle;
    setLogRef.current       = setLog;
    autoEndTurnRef.current  = () => {
        if (!battleStarted || battleEnded || activeActor !== "player") return;
        addCombatLog(`⏱ ${character.name}'s turn timed out! Turn passes to ${opponentName}.`, "timeout", character.name);
        waitTurn();
    };
    enemyTurnRef.current    = enemyTurn;
    enemyContinueRef.current = enemyContinue;

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
    handleTileClickRef.current = handleTileClick;
    const activeJutsuRangeTiles = useMemo(() => jutsuRangeTiles(pendingTargetJutsu), [pendingTargetJutsu, playerPos]);
    const activeJutsuAoeTiles = useMemo(() => jutsuAoeTiles(pendingTargetJutsu), [pendingTargetJutsu, playerPos, enemyPos]);
    const activeWeaponRangeTiles = useMemo(() => weaponRangeTiles(pendingTargetWeapon), [pendingTargetWeapon, playerPos]);
    const activeGroundAffectedTiles = useMemo(() => groundAffectedTiles(pendingTargetJutsu, hoveredBattleTile), [pendingTargetJutsu, hoveredBattleTile]);
    const boardGrid = useMemo(() => (
        Array.from({ length: gridHeight }).map((_, row) =>
            Array.from({ length: gridWidth }).map((_, col) => {
                const i = row * gridWidth + col;
                const x = col * X_STEP;
                const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0);

                const isBarrierTile = barrierTiles.some((b) => b.tile === i);
                const isGroundZoneTile = groundZones.some((z) => z.tiles.includes(i));
                const isJutsuRangeTile = (activeJutsuRangeTiles.has(i) && !(pendingTargetJutsu && isMoveJutsu(pendingTargetJutsu))) || activeWeaponRangeTiles.has(i);
                const isMoveAoeAffectedTile = pendingTargetJutsu != null &&
                    isMoveJutsu(pendingTargetJutsu) &&
                    pendingTargetJutsu.method === "AOE_CIRCLE" &&
                    hoveredBattleTile !== null &&
                    hexNeighbors(hoveredBattleTile).includes(i);
                const isJutsuAoeTile = activeJutsuAoeTiles.has(i);
                const isJutsuAoeCenterTile = pendingTargetJutsu?.method === "AOE_CIRCLE" && i === enemyPos && isJutsuAoeTile;
                const isGroundAffectedTile = activeGroundAffectedTiles.has(i);
                const isPendingJutsuTarget =
                    ((pendingTargetJutsu != null && !isGroundEffectJutsu(pendingTargetJutsu) && !isMoveJutsu(pendingTargetJutsu) && !isSelfCastJutsu(pendingTargetJutsu)) || Boolean(pendingTargetWeapon)) &&
                    i === enemyPos;
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
                            } ${isMoveLandingTile ? "dash-target-tile" : ""
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
                        {isBarrierTile ? "🛡"
                            : i === playerPos ? (character.avatarImage ? "" : "🥷")
                            : i === enemyPos ? (isImageAvatar(opponentAvatar) ? "" : opponentAvatar)
                                : ""}
                    </button>
                );
            })
        )
    ), [playerPos, enemyPos, barrierTiles, groundZones, pendingTargetJutsu, pendingTargetWeapon, hoveredBattleTile, activeJutsuRangeTiles, activeJutsuAoeTiles, activeWeaponRangeTiles, activeGroundAffectedTiles, character.avatarImage, opponentAvatar, opponentName]);

    if (!battleStarted) {
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
            return (
                <div className="card arena-lobby">
                    <BackToVillageButton onClick={() => setScreen("village")} />
                    <h2>Battle Arena</h2>
                    <p>Train against AI fighters or send casual spar requests to other players.</p>

                    <section className="summary-box">
                        <h3>Fight AI</h3>
                        <p className="hint">Pick an AI level and start a practice battle. This stays separate from ranked, clan war, and tournament play.</p>
                        <label>AI Level</label>
                        <input
                            type="number"
                            min={1}
                            max={MAX_LEVEL}
                            value={aiLevel}
                            onChange={(e) => setAiLevel(Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value))))}
                        />
                        <button onClick={beginAiBattle}>Start AI Battle</button>
                    </section>

                    <section className="summary-box">
                        <h3><GiPawPrint style={ARENA_ICON} />Incoming Pet Challenges</h3>
                        {incomingChallenges.filter((c) => c.mode === "clanWarPet" && !c.clanWarPoints).length === 0
                            ? <p className="hint">No incoming pet challenges.</p>
                            : incomingChallenges.filter((c) => c.mode === "clanWarPet" && !c.clanWarPoints).map((challenge) => (
                                <div className="summary-box" key={challenge.id}>
                                    <strong>{challenge.fromName}</strong> wants a pet battle!
                                    <div className="menu">
                                        <button onClick={() => {
                                            setScreen("petArena");
                                        }}><GiColiseum style={ARENA_ICON} />Go to Pet Coliseum</button>
                                        <button className="danger-button" onClick={() => declineChallenge(challenge)}>Decline</button>
                                    </div>
                                </div>
                            ))}
                    </section>

                </div>
            );
        }
        return (
            <div className="card arena-lobby">
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <button className="back-to-hub-btn" onClick={() => setScreen("centralHub")}>← Central Hub</button>
                    <h2 style={{ margin: 0 }}>Arena District</h2>
                </div>
                <p>Clan battles, ranked mode, tournaments, spectator view, and pet battles are handled here.</p>

                <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                    <button className={activeArenaTab === "clanWar" ? "active" : ""} onClick={() => setActiveArenaTab("clanWar")}><GiCrossedSwords style={ARENA_ICON} />Clan War</button>
                    <button className={activeArenaTab === "tournaments" ? "active" : ""} onClick={() => setActiveArenaTab("tournaments")}><GiTrophy style={ARENA_ICON} />Tournaments</button>
                    <button className={activeArenaTab === "ranked" ? "active" : ""} onClick={() => setActiveArenaTab("ranked")}><GiLadder style={ARENA_ICON} />Ranked</button>
                    <button className={activeArenaTab === "spectate" ? "active" : ""} onClick={() => setActiveArenaTab("spectate")}><GiEyeball style={ARENA_ICON} />Spectate</button>
                    <button className={activeArenaTab === "spar" ? "active" : ""} onClick={() => setActiveArenaTab("spar")}><GiBoxingGlove style={ARENA_ICON} />Spar / AI Battle</button>
                    <button className={activeArenaTab === "petBattles" ? "active" : ""} onClick={() => setActiveArenaTab("petBattles")}><GiPawPrint style={ARENA_ICON} />Pet Battles</button>
                </div>

                {activeArenaTab === "clanWar" && (
                    <>
                        <section className="summary-box">
                            <h3>Clan War Challenges</h3>
                            {!character.clan ? <p className="hint">Join a clan to see clan war opponents.</p> : !opponentClanData ? <p className="hint">Your clan is not currently at war with a player clan.</p> : (
                                <>
                                    <p className="hint">War opponent: <strong>{opponentClanData.name}</strong>. Winners earn clan war points.</p>
                                    <div className="jutsu-list">
                                        {clanWarOpponents.length === 0 ? <p className="hint">No online roster records found for enemy clan members yet.</p> : clanWarOpponents.map((player) => (
                                            <div className="summary-box" key={`war-${player.name}`}>
                                                <strong>{player.name}</strong>
                                                <p>Level {player.level} | {player.specialty}</p>
                                                <div className="menu">
                                                    <button onClick={() => challengePlayer(player, "clanWar1v1", 50)}>1v1 +50</button>
                                                    <button onClick={() => challengePlayer(player, "clanWar2v2", 100)}>2v2 +100</button>
                                                    <button onClick={() => challengePlayer(player, "clanWarPet", 25)}>Pet Battle +25</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </section>

                        <section className="summary-box">
                            <h3>Incoming Clan War Challenges</h3>
                            {incomingChallenges.filter((challenge) => Boolean(challenge.clanWarPoints)).length === 0 ? <p className="hint">No incoming clan war challenges.</p> : incomingChallenges.filter((challenge) => Boolean(challenge.clanWarPoints)).map((challenge) => (
                                <div className="summary-box" key={challenge.id}>
                                    <strong>{challenge.fromName}</strong>
                                    <p>{challenge.mode ?? "standard"} challenge to {challenge.toName} | {challenge.clanWarPoints} clan points</p>
                                    <div className="menu">
                                        <button onClick={() => {
                                            if (challenge.mode === "clanWarPet") {
                                                const challengerPet = challenge.challenger.pets.find(pet => pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)) ?? challenge.challenger.pets.find(pet => !isPetOnExpedition(pet));
                                                const responderPet = character.pets.find(pet => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? character.pets.find(pet => !isPetOnExpedition(pet));
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
                                        }}>{challenge.mode === "clanWarPet" ? "Open Pet Coliseum" : "Accept Duel"}</button>
                                        <button className="danger-button" onClick={() => declineChallenge(challenge)}>Decline</button>
                                    </div>
                                </div>
                            ))}
                        </section>
                    </>
                )}

                {activeArenaTab === "tournaments" && (
                    <section className="summary-box">
                        <h3>Tournaments</h3>
                        {arenaTournament ? (
                            <>
                                <p><strong>{arenaTournament.name}</strong> | Started by {arenaTournament.createdBy}</p>
                                <p>Event ends in {Math.ceil(tournamentRemaining / (60 * 60 * 1000))} hour(s). Match timer: {Math.ceil(matchRemaining / (60 * 60 * 1000))} hour(s).</p>
                                <p className="hint">Participants: {arenaTournament.participants.join(", ") || "No participants"}</p>
                                <p className="hint">Advanced: {arenaTournament.advancedPlayers.join(", ") || "None yet"}</p>
                                {isAdminTournamentManager && <div className="jutsu-list">{arenaTournament.participants.map((name) => <div className="summary-box" key={`advance-${name}`}><strong>{name}</strong><button onClick={() => advanceTournamentPlayer(name)}>Advance Player</button></div>)}</div>}
                                {isAdminTournamentManager && <button className="danger-button" onClick={clearTournament}>End Tournament</button>}
                            </>
                        ) : (
                            <>
                                <p className="hint">Only Admin 1 or Admin 2 can start a weekly tournament.</p>
                                <button disabled={!isAdminTournamentManager} onClick={startTournament}>{isAdminTournamentManager ? "Start 1 Week Tournament" : "Admin Only"}</button>
                            </>
                        )}
                    </section>
                )}

                {activeArenaTab === "ranked" && (
                    <section className="summary-box">
                        <h3>Ranked Battles</h3>
                        <p>Rating: <strong>{character.rankedRating ?? 1000}</strong> Elo | Wins {character.rankedWins ?? 0} | Losses {character.rankedLosses ?? 0}</p>
                        <p className="hint">Ranked fights use neutral ground: no terrain or weather modifiers.</p>
                        <p>Players in queue: <strong>{rankedQueueSize}</strong></p>
                        <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
                            {rankedQueueActive ? (
                                <button className="danger-button" onClick={leaveRankedQueue}>Leave Queue</button>
                            ) : (
                                <button onClick={joinRankedQueue}>Queue Up for Ranked</button>
                            )}
                        </div>
                        {rankedQueueActive && <p className="hint">Searching for opponent...</p>}

                        <hr style={{ border: "none", borderTop: "1px solid rgba(148,163,184,.25)", margin: "16px 0" }} />
                        <p className="hint"><GiPawPrint style={ARENA_ICON} />Ranked pet battles moved to the <strong>Pet Battles</strong> tab — climb the global <strong>Coliseum</strong> (1v1) and <strong>Tactical</strong> (4v4) ladders.</p>
                    </section>
                )}

                {activeArenaTab === "spectate" && (
                    <section className="summary-box">
                        <h3>Spectator Board</h3>
                        <button onClick={() => setSpectatorFights(loadArenaActiveFights())}>Refresh Fights</button>
                        {spectatorFights.filter((fight) => fight.battleId).length === 0 && duelChallenges.filter((challenge) => !challenge.accepted && !challenge.declined && (Boolean(challenge.clanWarPoints) || challenge.mode === "ranked")).length === 0 ? <p className="hint">No active fights or open district challenges detected right now.</p> : (
                            <div className="jutsu-list">
                                {spectatorFights.filter((fight) => fight.battleId).map((fight) => <div className="summary-box" key={fight.id}><strong>{fight.title}</strong><p>{fight.mode}{fight.biome ? ` | ${fight.biome}` : ""} | Started {new Date(fight.startedAt).toLocaleTimeString()}</p><button onClick={() => {
                                    if (fight.battleId && setPvpBattleId && setPvpRole) {
                                        // Join as spectator
                                        fetch(`/api/pvp/spectate?id=${encodeURIComponent(fight.battleId)}`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ name: character.name, action: "join" }),
                                        }).catch(() => {});
                                        setPvpBattleId(fight.battleId);
                                        setPvpRole("p1"); // spectator uses p1 view but can't act
                                        setScreen("pvpBattle" as Screen);
                                    } else {
                                        alert(`Spectating ${fight.title}. Live replay streams will use this fight feed.`);
                                    }
                                }}>Spectate</button></div>)}
                                {duelChallenges.filter((challenge) => !challenge.accepted && !challenge.declined && (Boolean(challenge.clanWarPoints) || challenge.mode === "ranked")).map((challenge) => <div className="summary-box" key={`spectate-${challenge.id}`}><strong>{challenge.fromName} vs {challenge.toName}</strong><p>{challenge.mode ?? "standard"} challenge pending</p><button onClick={() => alert("This fight has not started yet.")}>View Challenge</button></div>)}
                            </div>
                        )}
                    </section>
                )}

                {activeArenaTab === "spar" && (
                    <>
                        <section className="summary-box">
                            <h3>Fight AI</h3>
                            <p className="hint">Pick an AI level (1–{MAX_LEVEL}) and start a practice battle. This stays separate from ranked, clan war, and tournament play.</p>
                            <label>AI Level</label>
                            <input
                                type="number"
                                min={1}
                                max={MAX_LEVEL}
                                value={aiLevel}
                                onChange={(e) => setAiLevel(Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value))))}
                            />
                            <button onClick={beginAiBattle}>Start AI Battle</button>
                        </section>

                        <section className="summary-box">
                            <h3>Spar Requests</h3>
                            <label>Search Player Name</label>
                            <input value={sparSearch} onChange={(e) => setSparSearch(e.target.value)} placeholder="Type a player name to challenge..." />
                            {sparSearch.trim() && (
                                <div className="jutsu-list">
                                    {sparOpponents.length === 0 ? (
                                        <>
                                            <p className="hint">No roster match. Send a challenge directly.</p>
                                            <button onClick={() => {
                                                const name = sparSearch.trim();
                                                if (!name || name === character.name) return;
                                                const stub = { name, level: 1, village: "", specialty: "Ninjutsu", character: { ...character, name } as Character, currentSector: 0, lastSeenAt: Date.now() } as PlayerRecord;
                                                challengePlayer(stub);
                                            }}>Send Spar Challenge to "{sparSearch.trim()}"</button>
                                        </>
                                    ) : sparOpponents.map((player) => (
                                        <div className="summary-box" key={`spar-${player.name}`}>
                                            <strong>{player.name}</strong>
                                            <p>Level {player.level} | {player.village} | {player.specialty}</p>
                                            <div className="menu">
                                                <button onClick={() => challengePlayer(player)}>Send Spar Challenge</button>
                                                {petRankedChallengeEnabled() && <button onClick={() => challengePlayer(player, "rankedPet")}>Ranked Pet Duel ⚔</button>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="summary-box">
                            <h3>Incoming Spar Requests</h3>
                            {incomingChallenges.filter((challenge) => !challenge.clanWarPoints && challenge.mode !== "ranked" && challenge.mode !== "clanWarPet" && !challenge.sectorAttack).length === 0 ? <p className="hint">No incoming spar requests.</p> : incomingChallenges.filter((challenge) => !challenge.clanWarPoints && challenge.mode !== "ranked" && challenge.mode !== "clanWarPet" && !challenge.sectorAttack).map((challenge) => (
                                <div className="summary-box" key={challenge.id}>
                                    <strong>{challenge.fromName}</strong>
                                    <p>Casual spar request to {challenge.toName}</p>
                                    <div className="menu">
                                        <button onClick={() => acceptChallenge(challenge)}>Accept Spar</button>
                                        <button className="danger-button" onClick={() => declineChallenge(challenge)}>Decline</button>
                                    </div>
                                </div>
                            ))}
                        </section>
                    </>
                )}

                {activeArenaTab === "petBattles" && (
                    <section className="summary-box">
                        <h3><GiPawPrint style={ARENA_ICON} />Pet Battles</h3>
                        <p className="hint">Compete on the global pet ranked ladders — climb by beating the rival ranked above you — or jump into the casual pet arena.</p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, margin: "12px 0" }}>
                            {[
                                { mode: "coliseum" as const, img: coliseumLadderImg, emoji: <GiColiseum size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Coliseum", sub: "1v1 ranked ladder" },
                                { mode: "tactical" as const, img: tacticalLadderImg, emoji: <GiCrossedSwords size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Tactical", sub: "4v4 ranked ladder" },
                            ].map((c) => (
                                <button key={c.mode} type="button"
                                    onClick={() => { sessionStorage.setItem("petLadder.mode", c.mode); setScreen("petLadder"); }}
                                    style={{ position: "relative", padding: 0, border: "1px solid rgba(244,196,81,.3)", borderRadius: 14, overflow: "hidden", cursor: "pointer", textAlign: "left", height: 132, background: "#11141f" }}>
                                    <img src={c.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: .85 }} />
                                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,10,18,.05), rgba(8,10,18,.85))" }} />
                                    <div style={{ position: "absolute", left: 14, right: 14, bottom: 12 }}>
                                        <div style={{ fontSize: 19, fontWeight: 800, color: "#f7d98a", textShadow: "0 2px 8px #000" }}>{c.emoji} {c.title}</div>
                                        <div style={{ fontSize: 12.5, color: "rgba(231,237,247,.9)", textShadow: "0 1px 5px #000" }}>{c.sub} · climb the global rankings</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                        <button onClick={() => setScreen("petArena")}><GiColiseum style={ARENA_ICON} />Open Casual Pet Coliseum</button>
                    </section>
                )}
            </div>
        );
    }

    const timelineRounds = battleHistory.reduce<{ round: number; entries: BattleActionEntry[] }[]>((groups, entry) => {
        const group = groups.find((candidate) => candidate.round === entry.round);
        if (group) group.entries.push(entry);
        else groups.push({ round: entry.round, entries: [entry] });
        return groups;
    }, []);
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

    return (
        <div className={`arena-fullscreen arena-bg-${currentBiome}${currentSector === 99 ? " arena-bg-deathsgate" : ""}`}>
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
            {/* Server battle-lock keeper — registers an un-skippable lock while a
                live arena fight can ACTUALLY resume from disk, so a refresh can't
                flee it. Limited to plain AI-profile fights: those rebuild from the
                persisted pendingAiProfileId + ArenaBattlePersister. Story / weekly
                boss / dungeon-AI / endless / human-opponent (spar) fights carry
                their enemy + context in React-only state that a refresh loses, so
                the persister can't restore them — locking those would force re-
                entry into an empty lobby and (after the persister TTL) a false
                loss. They stay on the Phase-A safe-routing until each gets its own
                context-persister. PvP/ranked have their own server session. */}
            <BattleLockKeeper
                active={battleStarted && !battleEnded
                    && !(raidBattleKind === "raidPlayer" || rankedBattleActive)
                    && !opponentCharacter && !pendingStoryBattle && !endlessBattleActive}
                kind="arena"
                screen="arena"
                playerName={character.name}
            />
            {/* Endless-tower fights (kind="endless") — resumable now that the
                endless wave/flag + scaled enemy are persisted (see the App-level
                endless-context effect). Mutually exclusive with the plain-AI keeper
                above (they split on endlessBattleActive), so the shared lock id is
                never contended. */}
            <BattleLockKeeper
                active={battleStarted && !battleEnded
                    && !(raidBattleKind === "raidPlayer" || rankedBattleActive)
                    && !opponentCharacter && endlessBattleActive}
                kind="endless"
                screen="arena"
                playerName={character.name}
            />
            {/* Story/boss/event arena fights (kind="arenaStory") — weekly boss,
                dungeon-AI warden, arena story boss, triggered-event battle, hollow-
                gate arena fight. All carry a pendingArenaStoryBattle, persisted by
                the App-level arena-story context effect so they resume on refresh.
                Mutually exclusive with the other two keepers. */}
            <BattleLockKeeper
                active={battleStarted && !battleEnded
                    && !(raidBattleKind === "raidPlayer" || rankedBattleActive)
                    && !opponentCharacter && !endlessBattleActive && Boolean(pendingStoryBattle)}
                kind="arenaStory"
                screen="arena"
                playerName={character.name}
            />
            {/* Mid-battle state persistence — isolated in a child component
                so Arena's hook count is unchanged. Renders nothing visible. */}
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
                    setGroundZones((saved.groundZones ?? []) as GroundZone[]);
                    setCooldowns(saved.cooldowns);
                    setJutsuCooldowns(saved.jutsuCooldowns);
                    setEnemyJutsuCooldowns(saved.enemyJutsuCooldowns);
                    setPlayerShield(saved.playerShield);
                    setEnemyShield(saved.enemyShield);
                    setPlayerPos(saved.playerPos);
                    setEnemyPos(saved.enemyPos);
                    setBattleHistory(saved.battleHistory as BattleActionEntry[]);
                    setSummonedPetId(saved.summonedPetId);
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
                            avatar={character.avatarImage || "🥷"}
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
            <div className="combat-layout">
                {/* In-grid player HUD — visible on non-xl, hidden on xl via CSS */}
                <CombatSideHud
                    name={character.name}
                    avatar={character.avatarImage || "🥷"}
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

                <main className="combat-main-area">
                    <div className="arena-top-panel">
                        <div className="arena-title-panel">
                            <h2>{biomeLabel(currentBiome)}</h2>
                            <p>Turn {turn} | Shinobi Duel</p>
                        </div>
                    </div>

                    <div className="twp-strip">
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
                            <span className="twp-buff twp-positive">🔺 {weatherEffects[currentWeather].positiveElement} +5%</span>
                        )}
                        {weatherEffects[currentWeather].negativeElement && (
                            <span className="twp-buff twp-negative">🔻 {weatherEffects[currentWeather].negativeElement} -2%</span>
                        )}
                    </div>

                    <div className="dual-ap-panel">
                        <div>
                            <strong>{character.name} AP</strong>
                            <div className="hud-bar ap-display-bar">
                                <span style={{ width: `${ap}%` }} />
                            </div>
                            <small>{ap}/100 | {activeActor === "player" ? `Active: ${actionsThisTurn}/5 actions` : "Waiting"}</small>
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
                                <small>{activeActor === "enemy" ? "Enemy turn…" : "—"}</small>
                            </div>
                        )}

                        <div>
                            <strong>Enemy AP</strong>
                            <div className="hud-bar enemy-ap-display-bar">
                                <span style={{ width: `${enemyAp}%` }} />
                            </div>
                            <small>{enemyAp}/100 | {activeActor === "enemy" ? "Active" : "Waiting"}</small>
                        </div>
                    </div>

                    <div className="hex-zoom-bar">
                        <span className="hex-zoom-label">🔍</span>
                        <input
                            type="range"
                            className="hex-zoom-slider"
                            min={-0.4}
                            max={0.5}
                            step={0.02}
                            value={userScaleOffset}
                            onChange={(e) => setUserScaleOffset(Number(e.target.value))}
                        />
                        <button
                            className="hex-zoom-reset"
                            onClick={() => setUserScaleOffset(0)}
                            title="Reset zoom"
                        >↺</button>
                    </div>
                    <div className={`hex-battlefield hex-${currentBiome}${currentSector === 99 ? " hex-deathsgate" : ""}`} ref={battlefieldCallbackRef}>
                        {/*
                          Clip-wrapper: sized to the POST-TRANSFORM visual dimensions so
                          overflow:hidden clips at exactly the right boundary regardless
                          of how the browser applies transform vs. overflow interaction.
                          Centred inside the battlefield via absolute left/top offsets.
                        */}
                        <div style={(() => {
                            const scaledW = GRID_LAYER_W * effectiveScale;
                            const scaledH = GRID_LAYER_H * effectiveScale;
                            const cW = boardContainerSize.w || (battlefieldRef.current?.clientWidth  ?? scaledW);
                            const cH = boardContainerSize.h || (battlefieldRef.current?.clientHeight ?? scaledH);
                            const leftOffset = Math.max(0, (cW - scaledW) / 2);
                            const topOffset  = Math.max(0, (cH - scaledH) / 2);
                            return {
                                position: "absolute" as const,
                                left:   `${leftOffset}px`,
                                top:    `${topOffset}px`,
                                width:  `${scaledW}px`,
                                height: `${scaledH}px`,
                                overflow: "hidden",
                            };
                        })()}>
                        <div
                            className="hex-grid-layer"
                            style={{
                                // Grid layer occupies its full pre-scale size; the transform
                                // shrinks it to exactly fill the clip-wrapper above.
                                position: "absolute" as const,
                                width: `${GRID_LAYER_W}px`,
                                height: `${GRID_LAYER_H}px`,
                                transform: `scale(${effectiveScale})`,
                                transformOrigin: "top left",
                                left: "0",
                                top: "0",
                            }}
                        >
                            {/* Avatar overlay — sits above tiles, not clipped by hex clip-path */}
                            {(() => {

                                const orbForPos = (pos: number, isEnemy: boolean, imgSrc: string, altText: string) => {
                                    const row = Math.floor(pos / gridWidth);
                                    const col = pos % gridWidth;
                                    const x = col * X_STEP + HEX_W / 2 - ORB / 2;
                                    const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - ORB;
                                    return (
                                        // Glide between cells instead of snapping (Move / Push / Pull /
                                        // ground relocation) so units read as walking, not teleporting. The
                                        // stable key keeps the same DOM node, so CSS transitions a position
                                        // change but never the initial mount.
                                        <div key={isEnemy ? "enemy-orb" : "player-orb"} className={`avatar-orb ${isEnemy ? "enemy-orb" : ""}`} style={{ position: "absolute", left: x, top: y, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                            <img className="tiny-map-avatar" src={imgSrc} alt={altText} />
                                        </div>
                                    );
                                };
                                // Summoned pet — a smaller companion orb tucked beside the
                                // player. A Glow Collar (pet.loadout.collar) lights it up.
                                const petOrbForPos = (pos: number, pet: Pet) => {
                                    const row = Math.floor(pos / gridWidth);
                                    const col = pos % gridWidth;
                                    const PET_ORB = Math.round(ORB * 0.62);
                                    const x = col * X_STEP + HEX_W / 2 - ORB / 2 + ORB * 0.62;
                                    const y = row * Y_STEP + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.85 - PET_ORB + ORB * 0.12;
                                    const collarVisual = petCollarVisual(pet.loadout?.collar);
                                    // Glide alongside the player (see orbForPos) rather than snapping.
                                    const style: Record<string, string | number> = { position: "absolute", left: x, top: y, width: PET_ORB, height: PET_ORB, zIndex: 9, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" };
                                    if (collarVisual) style["--collar-glow"] = collarVisual.glow;
                                    const orbGlowClass = collarVisual ? (collarVisual.prismatic ? " pet-collar-prismatic" : " pet-collar-glow") : "";
                                    return (
                                        <div key="pet-summon-orb" className={`avatar-orb pet-summon-orb${orbGlowClass}`} style={style as React.CSSProperties}>
                                            {(() => {
                                                const petImg = petCardImage(pet, sharedImages);
                                                return petImg
                                                    ? <img className="tiny-map-avatar" src={petImg} alt={petDisplayName(pet)} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                                    : <span style={{ fontSize: PET_ORB * 0.5 }}>🐾</span>;
                                            })()}
                                            {collarVisual?.prismatic && <span className="pet-collar-sparkles" aria-hidden="true" />}
                                        </div>
                                    );
                                };
                                return (
                                    <>
                                        {character.avatarImage && orbForPos(playerPos, false, character.avatarImage, character.name)}
                                        {summonedPet && petOrbForPos(playerPos, summonedPet)}
                                        {isImageAvatar(opponentAvatar) && orbForPos(enemyPos, true, opponentAvatar, opponentName)}
                                    </>
                                );
                            })()}
                            {/* Floating ±damage/heal numbers (D3) — above the orbs, same
                                coordinate origin as the board layer; never intercept clicks. */}
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
                        </div>{/* end clip-wrapper */}
                        {/* Cosmetic elemental cast/impact particles (jutsu VFX). Sits
                            above the board, never intercepts clicks. Skipped on weak
                            devices (no canvas → no rAF particle loop). */}
                        {!liteFx && <canvas ref={combatVfxCanvasRef} className="combat-vfx-canvas" aria-hidden="true" />}
                        {/* Sprite-sheet effect overlay (CC0 art / KV override), above
                            the particles. Re-keyed per cast so it restarts cleanly. */}
                        {combatSpriteFx && (
                            <JutsuSpriteFx
                                key={combatSpriteFx.id}
                                frames={combatSpriteFx.frames}
                                single={combatSpriteFx.single}
                                x={combatSpriteFx.x}
                                y={combatSpriteFx.y}
                                variant={combatSpriteFx.variant}
                                onDone={() => setCombatSpriteFx((s) => (s && s.id === combatSpriteFx.id ? null : s))}
                            />
                        )}
                    </div>

                    <div className="basic-action-bar shinobi-command-bar">
                        {/* Affordance feedback: each action disables when it can't be
                            taken (not your turn / 5 actions used / not enough AP·SP·CP /
                            on cooldown), mirroring each handler's own guards so a
                            disabled button can never block a legal action. Wait stays
                            live (it also skips the enemy-turn delay). */}
                        <button onClick={basicAttack} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || character.stamina < 10 || ap < adjustedApCost(40)}><span>Attack</span><small>40 AP | 10 SP</small></button>
                        <button className={selectedActionId === "move" ? "selected-action" : ""} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(30)} onClick={() => { setPendingTargetJutsuId(""); setSelectedActionId((current) => current === "move" ? undefined : "move"); setLog("Move selected. Click an adjacent tile."); }}><span>Move</span><small>{adjustedApCost(30)} AP / tile</small></button>
                        <button onClick={basicHeal} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || (cooldowns.basicHeal ?? 0) > 0 || character.chakra < 10 || ap < adjustedApCost(60)}><span>Heal</span><small>60 AP | 10 CP | CD {cooldowns.basicHeal ?? 0}</small></button>
                        <button onClick={clearEnemyPositiveEffects} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || (cooldowns.clear ?? 0) > 0 || ap < adjustedApCost(60)}><span>Clear</span><small>60 AP | CD {cooldowns.clear ?? 0}</small></button>
                        <button onClick={cleansePlayerNegativeEffects} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || (cooldowns.cleanse ?? 0) > 0 || ap < adjustedApCost(60)}><span>Cleanse</span><small>60 AP | CD {cooldowns.cleanse ?? 0}</small></button>
                        {canSummonPet && (
                            <button onClick={summonActivePet} disabled={!activeBattlePet || Boolean(summonedPet) || activeActor !== "player"}>
                                <span>Pet</span>
                                <small>{summonedPet ? `${petDisplayName(summonedPet)} active` : activeBattlePet ? `Summon ${petDisplayName(activeBattlePet)}` : "No active pet"}</small>
                            </button>
                        )}
                        <button onClick={flee} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(100)}><span>Flee</span><small>100 AP | 50%</small></button>
                        <button onClick={waitTurn}><span>Wait</span><small>{activeActor === "enemy" ? "Skip delay" : "End turn"}</small></button>
                    </div>

                    <div className="jutsu-layout-card combat-jutsu-bar">
                        {/* Armed jutsu indicator removed — the jutsu card highlight
                             and log message are enough feedback while targeting. */}

                        {equippedJutsus.length === 0 && combatEquippedItems.length === 0 ? (
                            <div className="summary-box">
                                No equipped jutsus or combat items. Equip trained jutsus, weapons, or items from Profile.
                            </div>
                        ) : (
                            <>
                                <div className="combat-equipped-jutsu-grid">
                                    {/* ── Jutsu cards ── */}
                                    {equippedJutsus.map((jutsu) => {
                                        const isArmed = pendingTargetJutsuId === jutsu.id;
                                        const cooldown = jutsuCooldowns[jutsu.id] ?? 0;
                                        const isOnCooldown = cooldown > 0;
                                        const image = jutsu.image;

                                        const fallbackIcon =
                                            jutsu.type === "Taijutsu" ? "👊" :
                                                jutsu.type === "Bukijutsu" ? "⚔️" :
                                                    jutsu.type === "Genjutsu" ? "👁️" :
                                                        "🌀";

                                        return (
                                            <div
                                                key={jutsu.id}
                                                className={`combat-jutsu-card-wrap ${isArmed ? "selected-action" : ""}`}
                                            >
                                                {isOnCooldown && <span className="combat-cd-badge" title={`${cooldown} round(s) until ready`}>{cooldown}</span>}
                                                <button
                                                    type="button"
                                                    className={`combat-jutsu-button ${isArmed ? "selected-action" : ""} ${isOnCooldown ? "jutsu-on-cooldown" : ""}`}
                                                    disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || isOnCooldown || ap < adjustedApCost(jutsu.ap)}
                                                    title={isOnCooldown ? `${jutsu.name} cooldown: ${cooldown} rounds` : `${jutsu.name} | ${jutsu.ap} AP | Range ${jutsu.range}`}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedJutsuId("");
                                                        setInspectedCombatItemId("");
                                                        selectCombatJutsu(jutsu);
                                                    }}
                                                >
                                                    <span className="combat-jutsu-thumb">
                                                        {image ? (
                                                            <img src={image} alt={jutsu.name} />
                                                        ) : (
                                                            <strong>{fallbackIcon}</strong>
                                                        )}
                                                    </span>

                                                    <span className="combat-jutsu-name">{jutsu.name}</span>

                                                    <span className="combat-jutsu-info">
                                                        {jutsu.ap} AP | R{jutsu.range} | CD {cooldown}
                                                    </span>
                                                </button>

                                                <button
                                                    type="button"
                                                    className="combat-jutsu-help"
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedCombatItemId("");
                                                        setInspectedJutsuId(jutsu.id);
                                                    }}
                                                    title={`View ${jutsu.name} details`}
                                                >
                                                    ?
                                                </button>
                                            </div>
                                        );
                                    })}

                                    {/* ── Weapon & item cards (inline after jutsu) ── */}
                                    {combatEquippedItems.map((item) => {
                                        const slot = normalizeEquipmentSlot(item.slot);
                                        const isWeapon = slot === "hand" || slot === "thrown";
                                        const icon = slot === "thrown" ? "🎯" : slot === "hand" ? "⚔" : slot === "potion" ? "🧪" : "💼";
                                        const itemAp = item.apCost ?? (slot === "thrown" ? 40 : slot === "hand" ? 40 : 35);
                                        const weaponDisplayRange = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                        // Consumables (thrown/item/potion) show remaining supply and disable
                                        // when out of stock — or, for the potion, at its per-battle sip cap.
                                        const consumed = combatItemConsumed(item);
                                        const owned = consumed ? countItem(character, item.id) : null;
                                        const usable = canUseCombatItem(item);
                                        const countSuffix = owned != null ? ` ×${owned}` : "";
                                        // Hand/thrown weapons cool down between uses (tracked in
                                        // jutsuCooldowns keyed by item id, set on use). Grey the card
                                        // out + disable it while the cooldown ticks, matching the jutsu
                                        // cards. Consumables never set a cooldown, so itemCd stays 0.
                                        const itemCd = jutsuCooldowns[item.id] ?? 0;
                                        const onCooldown = itemCd > 0;
                                        const cdSuffix = onCooldown ? ` | CD ${itemCd}` : "";
                                        const actionText = isWeapon
                                            ? `${itemAp} AP | R${weaponDisplayRange}${countSuffix}${cdSuffix}`
                                            : `${itemAp} AP | Use${countSuffix}${cdSuffix}`;
                                        const isArmed = pendingTargetWeapon?.id === item.id;

                                        return (
                                            <div className={`combat-jutsu-card-wrap combat-item-card-wrap ${isWeapon ? "combat-weapon-card" : "combat-consumable-card"}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                                {onCooldown && <span className="combat-cd-badge" title={`${itemCd} round(s) until ready`}>{itemCd}</span>}
                                                <button
                                                    type="button"
                                                    className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " jutsu-armed" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                                    title={onCooldown ? `${item.name} — on cooldown (${itemCd} round(s) left)` : isArmed ? `${item.name} armed — click ${opponentName} to fire` : !usable ? `${item.name} — none left this battle` : `${item.name} | ${equipmentSlotLabel(item.slot)} | ${combatItemSummary(item)}`}
                                                    disabled={!usable || onCooldown || battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(itemAp)}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedJutsuId("");
                                                        activateEquippedCombatItem(item);
                                                    }}
                                                >
                                                    <span className="combat-jutsu-thumb combat-item-thumb">
                                                        {item.image ? (
                                                            <img src={item.image} alt={item.name} />
                                                        ) : (
                                                            <strong>{icon || combatItemInitials(item.name)}</strong>
                                                        )}
                                                    </span>
                                                    <span className="combat-jutsu-name">{item.name}</span>
                                                    <span className="combat-jutsu-info">{equipmentSlotLabel(item.slot)} | {actionText}</span>
                                                </button>

                                                <button
                                                    type="button"
                                                    className="combat-jutsu-help"
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        setInspectedJutsuId("");
                                                        setInspectedCombatItemId(item.id);
                                                    }}
                                                    title={`View ${item.name} details`}
                                                >
                                                    ?
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                {inspectedJutsu && (() => {
                                    const mastery = getJutsuMastery(character, inspectedJutsu.id);
                                    // Show the EFFECTIVE (rank-capped) level so the displayed EP/effects
                                    // match what actually lands in combat (see the castJutsu clamp above).
                                    const effLevel = Math.min(mastery.level, jutsuLevelCapForLevel(character.level));
                                    const scaled = scaleJutsuByLevel(inspectedJutsu, effLevel);
                                    const cooldown = jutsuCooldowns[inspectedJutsu.id] ?? 0;
                                    const cleanTarget = inspectedJutsu.target.toLowerCase().replaceAll("_", " ");
                                    const cleanMethod = inspectedJutsu.method.toLowerCase().replaceAll("_", " ");

                                    return (
                                        <div className="combat-jutsu-detail-popover">
                                            <div className="combat-jutsu-detail-header">
                                                <div>
                                                    <strong>{inspectedJutsu.name}</strong>
                                                    <small>Level {mastery.level} / {JUTSU_MAX_LEVEL}{mastery.level > effLevel ? ` · combat-capped to ${effLevel} at your rank` : ""}</small>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => setInspectedJutsuId("")}
                                                >
                                                    ×
                                                </button>
                                            </div>

                                            <div className="combat-jutsu-detail-grid">
                                                <span><strong>Type:</strong> {inspectedJutsu.type}</span>
                                                <span><strong>Element:</strong> {inspectedJutsu.element}</span>
                                                <span><strong>AP:</strong> {inspectedJutsu.ap}</span>
                                                <span><strong>Range:</strong> {inspectedJutsu.range}</span>
                                                <span><strong>Cooldown:</strong> {cooldown > 0 ? `${cooldown} active` : inspectedJutsu.cooldown}</span>
                                                <span><strong>Target:</strong> {cleanTarget}</span>
                                                <span><strong>Method:</strong> {cleanMethod}</span>
                                                <span><strong>Effect Power:</strong> {scaled.scaledEffectPower}</span>
                                                <span><strong>Chakra Usage:</strong> {formatJutsuResourcePercent(inspectedJutsu, "chakra", mastery.level)}</span>
                                                <span><strong>Stamina Usage:</strong> {formatJutsuResourcePercent(inspectedJutsu, "stamina", mastery.level)}</span>
                                            </div>

                                            {inspectedJutsu.description && (
                                                <p className="combat-jutsu-detail-desc">
                                                    {inspectedJutsu.description}
                                                </p>
                                            )}

                                            <div className="combat-jutsu-effects-list">
                                                <JutsuEffectCards jutsu={inspectedJutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={effLevel} lensDiscipline={playerLensDiscipline(character)} />
                                            </div>
                                        </div>
                                    );
                                })()}

                                {inspectedCombatItem && (
                                    <div className="combat-jutsu-detail-popover combat-item-detail-popover">
                                        <div className="combat-jutsu-detail-header">
                                            <div>
                                                <strong>{inspectedCombatItem.name}</strong>
                                                <small>{equipmentSlotLabel(inspectedCombatItem.slot)} | {inspectedCombatItem.rarity}</small>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setInspectedCombatItemId("")}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        <div className="combat-jutsu-detail-grid">
                                            <span><strong>Action:</strong> {["hand", "thrown"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? "Weapon attack" : "Support item"}</span>
                                            <span><strong>AP:</strong> {inspectedCombatItem.apCost ?? (normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 40 : ["hand"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? 40 : 35)}</span>
                                            <span><strong>Range:</strong> {normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 4 : normalizeEquipmentSlot(inspectedCombatItem.slot) === "hand" ? 1 : "Self"}</span>
                                            <span><strong>Rarity:</strong> {inspectedCombatItem.rarity}</span>
                                        </div>

                                        <p className="combat-jutsu-detail-desc">
                                            {inspectedCombatItem.description}
                                        </p>

                                        <div className="combat-item-effect-box">
                                            <strong>Combat Bonuses</strong>
                                            <p>{combatItemSummary(inspectedCombatItem)}</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <div className="combat-text-log combat-timeline" ref={combatLogRef} aria-live="polite" aria-label="Battle log">
                        <div className="combat-log-header">
                            <strong>Battle Log</strong>
                            <span>{activeActor === "player" ? `${character.name}'s turn` : `${opponentName}'s turn`}</span>
                        </div>
                        {battleHistory.length === 0 ? (
                            <p>No entries yet.</p>
                        ) : (
                            timelineRounds.map((roundGroup) => {
                                const maxLogRound = timelineRounds[timelineRounds.length - 1]?.round ?? 0;
                                const roundOpen = logRoundOverridesA[roundGroup.round] ?? (roundGroup.round >= maxLogRound - 1);
                                return (
                                <section className={`timeline-round${roundOpen ? " open" : " collapsed"}`} key={roundGroup.round}>
                                    <button type="button" className="timeline-round-header timeline-round-toggle" aria-expanded={roundOpen}
                                        onClick={() => setLogRoundOverridesA((prev) => ({ ...prev, [roundGroup.round]: !roundOpen }))}>
                                        <span className="timeline-round-chevron" aria-hidden="true">▾</span>
                                        <span>Round {roundGroup.round}</span>
                                        <small>{new Date(roundGroup.entries[0]?.createdAt ?? Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</small>
                                        <span className="timeline-round-count">{roundGroup.entries.length}</span>
                                    </button>
                                    {roundOpen && roundGroup.entries.map((entry) => {
                                        const lines = entry.description.split("\n");
                                        const [headLine, ...effectLines] = lines;
                                        return (
                                            <div className={`timeline-entry timeline-${entry.actorRole}`} key={`${entry.round}-${entry.actionId}-${entry.actionNumber}`}>
                                                <p className="timeline-entry-head">
                                                    <strong>#{entry.actionNumber}</strong> {entry.actor}: {headLine}
                                                </p>
                                                {effectLines.map((line, i) => <BattleLogLine line={line} key={i} />)}
                                            </div>
                                        );
                                    })}
                                </section>
                                );
                            })
                        )}
                    </div>
                </main>
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
                />
            </div>

            {battleEnded && (
                <div className="battle-ended-overlay">
                    <div className="card battle-ended-card">
                        {endlessBattleActive && battleResult === "win" ? (
                            <>
                                <h2 className="battle-result-win"><GiLaurelsTrophy style={ARENA_ICON} />Wave {endlessBattleWave} Clear!</h2>
                                <p>{log}</p>
                                <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: "0.4rem 0" }}>
                                    HP carried into next wave. Stay alive as long as you can.
                                </p>
                                <button
                                    className="admin-button"
                                    style={{ background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontSize: "1rem", padding: "0.7rem 1.5rem" }}
                                    onClick={() => onEndlessWin?.(endlessBattleWave)}
                                >
                                    <GiNextButton style={ARENA_ICON} />Next Wave
                                </button>
                            </>
                        ) : endlessBattleActive && battleResult === "loss" ? (
                            <>
                                <h2 className="battle-result-loss"><GiSkullCrossedBones style={ARENA_ICON} />Tower Collapsed</h2>
                                <p style={{ color: "#fde047", fontSize: "1.1rem", fontWeight: 800 }}>
                                    You reached Wave {endlessBattleWave}
                                </p>
                                <p>{log}</p>
                                <p style={{ color: "#f87171", fontSize: "0.88rem", margin: "0.4rem 0" }}>
                                    You've been rushed to the village hospital. Pay <strong style={{ color: "#fde047" }}>1,000 ryo</strong> to be treated.
                                </p>
                                <div className="menu">
                                    <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => { onEndlessBattleEnd?.(); setScreen("hospital"); }}>
                                        <GiFirstAidKit style={ARENA_ICON} />Go to Hospital
                                    </button>
                                    <button onClick={() => { onEndlessBattleEnd?.(); setScreen("centralHub"); }}>
                                        Return to Central
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className={battleResult === "win" ? "battle-result-win" : battleResult === "fled" ? "battle-result-fled" : "battle-result-loss"}>
                                    {battleResult === "win"
                                        ? "Victory"
                                        : battleResult === "fled"
                                            ? "Escaped"
                                            : pendingStoryBattle?.kind === "dungeonAi"
                                                ? "💀 The Seal Rejects You"
                                                : pendingStoryBattle?.kind === "weeklyBoss"
                                                    ? "💀 Knocked Out by the Weekly Boss"
                                                    : "💥 Knocked Out"}
                                </h2>
                                <p>{log}</p>
                                {pendingStoryBattle?.kind === "weeklyBoss" && (battleResult === "loss" || battleResult === "fled") ? (
                                    <>
                                        <p style={{ color: "#facc15", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            Total damage dealt this attempt: <strong>{(pendingStoryBattle.bossInitialHp - enemyHp).toLocaleString()}</strong>.
                                            {battleResult === "fled"
                                                ? " Fleeing still counts as an attempt and logs your damage."
                                                : ""}
                                        </p>
                                        <button
                                            style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#facc15" }}
                                            disabled={logging}
                                            onClick={() => { setLogging(true); onWeeklyBossLogDamage?.(pendingStoryBattle.bossInitialHp - enemyHp); }}
                                        >
                                            <GiScrollUnfurled style={ARENA_ICON} />Log Damage & Return
                                        </button>
                                    </>
                                ) : battleResult === "loss" && pendingStoryBattle?.kind === "dungeonAi" ? (
                                    <>
                                        <p style={{ color: "#f87171", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            Your Dungeon Key was consumed by the failed run. You return to your village empty-handed.
                                        </p>
                                        <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => onDungeonFail?.()}>
                                            <GiVillage style={ARENA_ICON} />Return to Village
                                        </button>
                                    </>
                                ) : battleResult === "loss" ? (
                                    <>
                                        <p style={{ color: "#f87171", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                                            You've been rushed to the village hospital. Pay <strong style={{ color: "#fde047" }}>1,000 ryo</strong> to be treated and released.
                                        </p>
                                        <button style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }} onClick={() => { if (pendingStoryBattle) onPendingStoryBattleContinue?.(); setScreen("hospital"); }}>
                                            <GiFirstAidKit style={ARENA_ICON} />Go to Hospital
                                        </button>
                                    </>
                                ) : pendingStoryBattle ? (
                                    <div className="menu">
                                        <button className="admin-button" onClick={onPendingStoryBattleContinue}>
                                            Continue Story
                                        </button>
                                    </div>
                                ) : exploreAmbushWinRef.current ? (
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
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// --- True Player-vs-Player Battle Screen ------------------------------------

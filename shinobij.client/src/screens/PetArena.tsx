/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useLayoutEffect, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import type { Character, PlayerRecord, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen, JutsuElement } from "../types/core";
import { PET_ELEMENT_BEATS } from "../constants/pet-arena";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { scorePetMatchup } from "../lib/pet-battle-sim";
import { type DuelResult } from "../lib/pet-duel-sim";
import { runPetDuelCinematic, runPetPartyDuelCinematic } from "../lib/pet-duel-cinematic";
import { createLiveDuel, createLivePartyDuel, type LiveDuel } from "../lib/pet-duel-live";
import { PetDuelLiveHost, type PetDuelLiveHandle } from "../components/PetDuelLiveHost";
import { gameToast } from "../components/GameToast";
import { petPlayerControlEnabled } from "../lib/pet-coliseum-flag";
import { petCardImage } from "../lib/pet-battle-anim";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    availablePetBattleCount,
    canEnterTacticalArena,
    isPetOnExpedition,
    petDisplayName,
    pickArenaTeam,
} from "../lib/pet";
import { derivePetRole, ROLE_META, type PetRole } from "../lib/pet-roles";
import { ROLE_ICON } from "../lib/role-icons";
import { ELEMENT_ICON } from "../lib/element-icons";
import { primePetSfx } from "../lib/pet-sfx";
import { primeWarfrontAudio } from "../lib/warfront-audio";
import { startBattleMusic } from "../lib/pet-music";
import { makeId } from "../lib/utils";
import { genericPetArenaOpponents, isGenericPetOpponent, type PetArenaOpponent } from "../data/pet-arena-opponents";
import {
    petTamerPveMultiplier,
    type DuelChallenge,
} from "../App";
import { loadPendingClanPetBattle, savePendingClanPetBattle } from "../lib/world-state";
import { petPveHpMult, petAlphaBond } from "../lib/profession-mastery";
import {
    arenaMatchOwnedByPlayer,
    arenaSizeOf,
    buildAcceptedArenaMatch,
    buildResponderArenaMatch,
    sharedWarfrontSetup,
    stripInlinePetImages,
    WF_BUILD_PACKAGES,
    WF_COACH_ORDERS,
    WF_COUNTERSTRIKES,
    WF_DEPLOYMENT_LANES,
    WF_OBJECTIVE_TECHNIQUES,
    WF_SETUP_DOCTRINES,
    WF_SETUP_STANCES,
    WF_SHARED_BUY_POLICIES,
    type ArenaTeam,
    type PlayerOwnedArenaMatch,
    type WarfrontSetup,
} from "../lib/arena-challenge";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { activeCarriedPets } from "../lib/entitlements";
import { publicEligiblePets } from "../lib/public-pet-roster";
import { settleHollowGateCombat, type HollowGateCombatSettleResult } from "../lib/hollow-gate-combat-api";
import type { ArenaSlot, ArenaRole } from "../lib/pet-arena-sim";
import { wfThemeForVillage } from "../lib/pet-warfront-theme";
import {
    arenaSelectionCount,
    assignArenaSelectionSlot,
    clearArenaSelectionSlot,
    isExactAvailableArenaSelection,
    nextOpenArenaSlot,
    normalizeArenaSelection,
} from "../lib/arena-selection";
import { PlayerRequestOwner, normalizePlayerIdentity } from "../lib/player-request-owner";
import {
    clearArenaPvpRecovery,
    readArenaPvpRecovery,
    recoveredChallengeMatches,
    writeArenaPvpRecovery,
    type ArenaPvpRecovery,
} from "../lib/arena-pvp-recovery";
import {
    clearPreparedWarfrontContract,
    parsePreparedWarfrontContract,
    readPreparedWarfrontContract,
    writePreparedWarfrontContract,
    type PreparedWarfrontContract,
} from "../lib/warfront-prepared-seed";
import {
    clearPendingWarfrontSettlement,
    parseWarfrontTerminalReceipt,
    isSafeExpiredWarfrontExit,
    readPendingWarfrontSettlement,
    warfrontEarlyRetryDelay,
    warfrontTerminalReceiptMatchesPlayer,
    warfrontTerminalReceiptMessage,
    writePendingWarfrontSettlement,
    WARFRONT_EARLY_RETRY_CUSHION_MS,
    type PendingWarfrontSettlement,
    type WarfrontTerminalReceipt,
} from "../lib/warfront-pending-settlement";
import type {
    WarfrontChoice, WarfrontRoundChoice, WarfrontRoundDecision, WarfrontResult, WfBuildPackage, WfBuyPolicy,
    WfCoachOrder, WfCounterstrike, WfObjectiveTechnique, WfOpeningDeployment,
} from "../lib/pet-warfront-sim";
import { WF_STANCES, WF_DOCTRINES, type WfStance, type WfDoctrine } from "../lib/pet-warfront-strategy";
import tacticalArenaHero from "../assets/coliseum/tactical-arena-hero.webp";
import petDuelHero from "../assets/coliseum/pet-duel-hero.webp";
import duelFire from "../assets/coliseum/duel-fire.webp";
import duelWater from "../assets/coliseum/duel-water.webp";
import duelWind from "../assets/coliseum/duel-wind.webp";
import duelLightning from "../assets/coliseum/duel-lightning.webp";
import duelEarth from "../assets/coliseum/duel-earth.webp";

// Cinematic-duel hero banner matched to the selected pet's element. Falls back
// to the generic blue-vs-red showdown for None / unknown elements.
const DUEL_HERO_BY_ELEMENT: Record<string, string> = {
    Fire: duelFire, Water: duelWater, Wind: duelWind, Lightning: duelLightning, Earth: duelEarth,
};

// Painted element emblem, inline. Renders nothing for None/unknown elements.
function ElIcon({ el, size = 16 }: { el?: string; size?: number }) {
    const src = el ? ELEMENT_ICON[el] : undefined;
    return src ? <img src={src} alt="" aria-hidden="true" style={{ width: size, height: size, objectFit: "contain", verticalAlign: "-3px", marginRight: 2 }} /> : null;
}

// Rock-paper-scissors element edge (Fire▸Wind▸Lightning▸Earth▸Water▸Fire, ±15%).
// Returns the element this one is strong vs + the element it's weak to.
function elementMatchup(el?: string): { strong?: JutsuElement; weak?: JutsuElement } {
    if (!el || el === "None") return {};
    const strong = PET_ELEMENT_BEATS[el as JutsuElement];
    const weak = (Object.keys(PET_ELEMENT_BEATS) as JutsuElement[]).find((k) => PET_ELEMENT_BEATS[k] === el);
    return { strong, weak };
}

// Small element strength/weakness line shown under a pet so the player can read
// the matchup at a glance instead of memorising the chakra wheel.
function MatchupHint({ element }: { element?: string }) {
    if (!element || element === "None") {
        return <p className="pet-matchup-hint neutral">◇ Neutral element — no elemental edge or weakness.</p>;
    }
    const { strong, weak } = elementMatchup(element);
    return (
        <p className="pet-matchup-hint">
            <span className="el"><ElIcon el={element} /> {element}</span>
            {strong && <span className="adv">▲ vs <ElIcon el={strong} /> {strong}</span>}
            {weak && <span className="dis">▼ vs <ElIcon el={weak} /> {weak}</span>}
        </p>
    );
}

const ROLE_ORDER: PetRole[] = ["defender", "assassin", "tracker", "sage"];
const WARFRONT_ROLE_FIT: Record<PetRole, string> = {
    defender: "Frontline",
    sage: "Sustain",
    tracker: "Range",
    assassin: "Burst",
};

const WARFRONT_DEPLOYMENT_SLOTS = [
    { id: "top", label: "Top", mark: "T", forecast: "Holds the upper route and meets the first side-lane pressure." },
    { id: "mid", label: "Mid", mark: "M", forecast: "Anchors the shortest route to Sigils and the Hollow Gate." },
    { id: "bottom", label: "Bottom", mark: "B", forecast: "Holds the lower route and protects the second approach." },
    { id: "flex", label: "Flex", mark: "F", forecast: "Roams after the opening lock to reinforce, hunt, or contest." },
] as const;
const WARFRONT_OPENING_DEPLOYMENT: WfOpeningDeployment = ["top", "mid", "bottom", "flex"];
type WfPlaybookId = "hold-turn" | "blood-hunt" | "objective-control";
const WARFRONT_PLAYBOOKS: ReadonlyArray<{
    id: WfPlaybookId;
    icon: string;
    label: string;
    summary: string;
    tradeoff: string;
    buyPolicy: Exclude<WfBuyPolicy, "off">;
    buildPackage: WfBuildPackage;
    coachOrder: WfCoachOrder;
    objectiveTechnique: WfObjectiveTechnique;
    counterstrike: WfCounterstrike;
    requiredRoles: readonly PetRole[];
}> = [
    { id: "hold-turn", icon: "🛡", label: "Hold & Turn", summary: "Absorb pressure, own the objective, then counter-push.", tradeoff: "Safest frontline; gives up early chase pressure.", buyPolicy: "defense", buildPackage: "hold-line", coachOrder: "contest", objectiveTechnique: "zone", counterstrike: "fortify", requiredRoles: ["defender"] },
    { id: "blood-hunt", icon: "🗡", label: "Blood Hunt", summary: "Create picks and turn a shutdown into a fast breach.", tradeoff: "Highest burst; riskiest in a grouped objective fight.", buyPolicy: "offense", buildPackage: "blood-hunt", coachOrder: "ambush", objectiveTechnique: "hijack", counterstrike: "bounty-hunt", requiredRoles: ["assassin"] },
    { id: "objective-control", icon: "◆", label: "Objective Control", summary: "Sustain escorts and trade lanes around predictable Sigils.", tradeoff: "Best map control; slower direct structure damage.", buyPolicy: "balanced", buildPackage: "escort-rite", coachOrder: "trade", objectiveTechnique: "secure", counterstrike: "cross-map", requiredRoles: ["sage", "tracker"] },
] as const;

// Tactical-Arena "battle plan" — a composition read-out + coaching hint that
// fills the space beside the team picker. Pure: derives role counts / element
// spread / avg level from the picked pets and surfaces the weakest-link tip.
function BattlePlan({ pets, size }: { pets: Pet[]; size: number }) {
    const counts: Record<PetRole, number> = { defender: 0, tracker: 0, assassin: 0, sage: 0 };
    let levelSum = 0;
    const elements = new Set<string>();
    for (const p of pets) {
        const role = (p.role ?? derivePetRole(p).role) as PetRole;
        counts[role] = (counts[role] ?? 0) + 1;
        levelSum += p.level ?? 1;
        if (p.element && p.element !== "None") elements.add(p.element);
    }
    const avg = pets.length ? Math.round(levelSum / pets.length) : 0;
    const fullCoverage = pets.length > 0 && counts.defender > 0 && counts.sage > 0 && counts.tracker > 0 && counts.assassin > 0;
    const hint = !pets.length ? "Pick your squad below — your role coverage shows up here."
        : counts.defender === 0 ? "No Defender — add one to hold the front line and soak hits."
        : counts.sage === 0 ? "No Sage — without a healer your squad has no sustain."
        : counts.tracker === 0 ? "No Tracker — you have no ranged pressure to chip from afar."
        : counts.assassin === 0 ? "No Assassin — add burst to finish low targets."
        : "All four battlefield jobs are covered. Final strength still depends on lane fit, kits, elements, and level.";
    return (
        <div className="pet-pick-panel pet-battle-plan">
            <h4 className="bp-title">🧭 Battle Plan</h4>
            <div className="bp-roles">
                {ROLE_ORDER.map((r) => {
                    const m = ROLE_META[r];
                    return (
                        <div key={r} className={`bp-role${counts[r] === 0 ? " empty" : ""}`} style={{ color: m.color }}>
                            <img src={ROLE_ICON[r]} alt="" aria-hidden="true" />
                            <span className="bp-role-name">{m.label}</span>
                            <span className="bp-role-count">×{counts[r]}</span>
                            <span className="bp-role-beats" style={{ fontSize: 10, opacity: 0.8, whiteSpace: "nowrap" }}>{WARFRONT_ROLE_FIT[r]}</span>
                        </div>
                    );
                })}
            </div>
            <p className={`pet-matchup-hint ${fullCoverage ? "good" : "warn"}`} style={{ marginTop: 10 }}>{hint}</p>
            <div className="bp-stats">
                <span>Squad <strong>{pets.length}/{size}</strong></span>
                <span>Avg Lv <strong>{avg || "—"}</strong></span>
                <span>Elements <strong>{elements.size ? [...elements].map((e) => <ElIcon key={e} el={e} size={15} />) : "—"}</strong></span>
            </div>
            <div className="bp-tips">
                <div>🏁 Win lanes, break Guardian Totems, then shatter the rival Ward Seal.</div>
                <div>🧠 Pets auto-fight by role — defenders tank, sages heal, trackers poke, assassins dive.</div>
                <div>🧭 Top, Mid, and Bottom hold their named routes for 40s; Flex responds across the map.</div>
                <div>⚡ Element edge ±15%: Fire▸Wind▸Lightning▸Earth▸Water▸Fire.</div>
            </div>
        </div>
    );
}

const preloadPetColiseumModels = (pets: readonly Pet[]) => import("../lib/pet-model-preload")
    .then((module) => module.preloadPetColiseumModels(pets));
// Every current Coliseum route uses the continuous duel engine. Keep its Three.js
// presentation lazy; the retired round-frame renderer no longer ships here.
const PetColiseumDuel = lazyWithRetry(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));
// Hollow Warfront — the lane-war game mode that REPLACED the capture-scroll
// Tactical Arena (Ward Seal objective, Guardian Totems, the Hollow Gate breach,
// bounty coins + the 30 s War Council). Own lazy chunk (three-heavy).
const PetWarfrontMatch = lazyWithRetry(() => import("../components/PetWarfrontMatch").then((m) => ({ default: m.PetWarfrontMatch })));
const preloadWarfrontExperience = (pets: readonly Pet[]) => {
    void Promise.all([
        import("../components/PetWarfrontMatch"),
        import("../lib/pet-model-preload").then((module) => module.preloadPetWarfrontModels(pets)),
    ]).catch(() => undefined);
};
// Pet Gauntlet — the roguelike run mode (3rd tab). Self-contained (owns its run
// state + its own fight), so it's lazy-loaded and never touches the duel/arena state here.
const PetGauntlet = lazyWithRetry(() => import("../components/PetGauntlet").then((m) => ({ default: m.PetGauntlet })));
// Co-op lobby (play the Tactical Arena 4v4 with friends) — lazy; pulls the arena chunk.
const ArenaCoopLobby = lazyWithRetry(() => import("../components/ArenaCoopLobby").then((m) => ({ default: m.ArenaCoopLobby })));

// Build the arena slots from each pet's NATIVE role (pet.role, set by
// derivePetRole + backfilled in capPetStats). Pets now carry an intrinsic role,
// so the tactical AI reads it directly instead of stat-guessing a comp. Fallback
// to derivePetRole for any pet that somehow lacks one.
function autoRoleTeam(pets: Pet[], count: number): ArenaSlot[] {
    return pets.slice(0, Math.max(1, count)).map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));
}

function WarfrontChoiceButtons<T extends string>({ label, items, value, onSelect, disabled, maxWidth = 620 }: {
    label: string;
    items: readonly { id: T; icon?: string; label: string; desc?: string }[];
    value: T;
    onSelect: (value: T) => void;
    disabled?: boolean;
    maxWidth?: number;
}) {
    return (
        <div role="group" aria-label={label} className="pet-arena-mode-toggle" style={{ maxWidth, marginTop: 6, flexWrap: "wrap" }}>
            {items.map((item) => <button key={item.id} type="button" disabled={disabled} aria-pressed={value === item.id} title={item.desc} className={value === item.id ? "active" : ""} onClick={() => onSelect(item.id)}>{item.icon} {item.label}</button>)}
        </div>
    );
}

function storedChoice<T extends string>(key: string, values: ReadonlySet<T>, fallback: T): T {
    try {
        const value = localStorage.getItem(key) as T | null;
        return value && values.has(value) ? value : fallback;
    } catch { return fallback; }
}

function saveChoice<T extends string>(key: string, value: T, setValue: (next: T) => void): void {
    setValue(value);
    try { localStorage.setItem(key, value); } catch { /* storage disabled */ }
}

async function postWarfront<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<[Response, T | null]> {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    return [response, await response.json().catch(() => null) as T | null];
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Request aborted", "AbortError"));
            return;
        }
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Request aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

type WarfrontAuthoredSetup = {
    deployment: WfOpeningDeployment;
    buildPackage: WfBuildPackage;
    coachOrder: WfCoachOrder;
    objectiveTechnique?: WfObjectiveTechnique;
    counterstrike?: WfCounterstrike;
};
type WarfrontPlaybackSetup = Omit<WarfrontSetup, "buyPolicy" | "objectiveTechnique" | "counterstrike"> & { buyPolicy: WfBuyPolicy } & WarfrontAuthoredSetup;
type SharedWarfrontPlaybackSetup = WarfrontSetup & Required<Pick<WarfrontAuthoredSetup, "objectiveTechnique" | "counterstrike">>;
type ActiveWarfrontMatch = {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    vsAi: boolean;
    blueSetup: WarfrontPlaybackSetup;
    redSetup?: SharedWarfrontPlaybackSetup;
    localTeam: ArenaTeam;
    reportKey?: string;
    prepareToken?: string;
    committedChoices?: WarfrontRoundChoice[];
    difficulty?: WarfrontDifficultyDisclosure;
    rewardModel?: WarfrontRewardModel;
};
type WarfrontRewardState = {
    phase: "idle" | "minting" | "ready" | "settling" | "settled" | "error";
    message: string;
    retry: "mint" | "settle" | null;
};
type AuthorizedWarfrontMatch = {
    token: string;
    seed: number;
    reportKey: string;
    rewardEligible: boolean;
    blue: ArenaSlot[];
    red: ArenaSlot[];
    setup: WarfrontPlaybackSetup;
    redSetup: SharedWarfrontPlaybackSetup;
    committedChoices: WarfrontRoundChoice[];
    difficulty: WarfrontDifficultyDisclosure;
    rewardModel: WarfrontRewardModel;
};
type WarfrontDifficultyDisclosure = {
    version: 1;
    band: "rookie" | "veteran" | "elite";
    label: "Rising Squad" | "Veteran Front" | "Elite Warfront";
    playerPower: number;
    opponentPower: number;
};
type WarfrontRewardModel = {
    kind: "coach-completion" | "competitive-outcome";
    currency: "ryo";
    amount: number;
    dailyCap: number;
    outcomeIndependent: boolean;
};
type WarfrontLifecycle = {
    epoch: number;
    normalizedPlayerName: string;
    active: boolean;
};
type WarfrontAsyncAttempt = {
    epoch: number;
    playerName: string;
    normalizedPlayerName: string;
    battleToken?: string;
    controller: AbortController;
};
type WarfrontSettlementRetryTimer = {
    epoch: number;
    normalizedPlayerName: string;
    battleToken: string;
    id: number;
};
const normalizeWarfrontPlayerName = (playerName: string): string => playerName.trim().toLowerCase();
const AUTHORIZED_ARENA_ROLES = new Set<ArenaRole>(["defender", "tracker", "assassin", "sage"]);
let lastArenaChallengeCreatedAt = 0;

function nextArenaChallengeCreatedAt(): number {
    lastArenaChallengeCreatedAt = Math.max(Date.now(), lastArenaChallengeCreatedAt + 1);
    return lastArenaChallengeCreatedAt;
}

function parseAuthorizedWarfrontSlots(value: unknown): ArenaSlot[] | null {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const slots: ArenaSlot[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) return null;
        const slot = entry as { role?: unknown; pet?: unknown };
        if (!AUTHORIZED_ARENA_ROLES.has(slot.role as ArenaRole) || !isRecord(slot.pet)) return null;
        const pet = slot.pet as Partial<Pet>;
        if (typeof pet.id !== "string" || !pet.id || typeof pet.name !== "string" || !pet.name) return null;
        slots.push({ role: slot.role as ArenaRole, pet: pet as Pet });
    }
    return new Set(slots.map((slot) => slot.pet.id)).size === 4 ? slots : null;
}

function parseWarfrontDifficulty(value: unknown): WarfrontDifficultyDisclosure | null {
    if (!isRecord(value) || value.version !== 1
        || (value.band !== "rookie" && value.band !== "veteran" && value.band !== "elite")
        || (value.label !== "Rising Squad" && value.label !== "Veteran Front" && value.label !== "Elite Warfront")
        || !Number.isSafeInteger(value.playerPower) || Number(value.playerPower) <= 0
        || !Number.isSafeInteger(value.opponentPower) || Number(value.opponentPower) <= 0) return null;
    const expectedLabel = value.band === "rookie" ? "Rising Squad" : value.band === "veteran" ? "Veteran Front" : "Elite Warfront";
    if (value.label !== expectedLabel) return null;
    return {
        version: 1,
        band: value.band,
        label: value.label,
        playerPower: Number(value.playerPower),
        opponentPower: Number(value.opponentPower),
    };
}

function parseWarfrontRewardModel(value: unknown, rewardEligible: boolean): WarfrontRewardModel | null {
    if (!isRecord(value) || (value.kind !== "coach-completion" && value.kind !== "competitive-outcome")
        || value.currency !== "ryo" || !Number.isSafeInteger(value.amount) || Number(value.amount) < 0
        || !Number.isSafeInteger(value.dailyCap) || Number(value.dailyCap) <= 0
        || typeof value.outcomeIndependent !== "boolean") return null;
    if (rewardEligible) {
        if (value.kind !== "competitive-outcome" || value.outcomeIndependent !== false || value.dailyCap !== 100) return null;
    } else if (value.kind !== "coach-completion" || value.outcomeIndependent !== true || value.dailyCap !== 3 || Number(value.amount) < 20) return null;
    return {
        kind: value.kind,
        currency: "ryo",
        amount: Number(value.amount),
        dailyCap: Number(value.dailyCap),
        outcomeIndependent: value.outcomeIndependent,
    };
}

function parseAuthorizedWarfrontSetup(value: unknown): WarfrontPlaybackSetup | null {
    if (!isRecord(value)) return null;
    const setup = value as { stance?: unknown; doctrine?: unknown; buyPolicy?: unknown; deployment?: unknown; buildPackage?: unknown; coachOrder?: unknown; objectiveTechnique?: unknown; counterstrike?: unknown };
    const coachMode = setup.buyPolicy === "off";
    const techniqueValid = setup.objectiveTechnique === undefined || WF_OBJECTIVE_TECHNIQUES.has(setup.objectiveTechnique as WfObjectiveTechnique);
    const counterstrikeValid = setup.counterstrike === undefined || WF_COUNTERSTRIKES.has(setup.counterstrike as WfCounterstrike);
    if (!WF_SETUP_STANCES.has(setup.stance as WfStance)
        || !WF_SETUP_DOCTRINES.has(setup.doctrine as WfDoctrine)
        || (setup.buyPolicy !== "off" && !WF_SHARED_BUY_POLICIES.has(setup.buyPolicy as Exclude<WfBuyPolicy, "off">))
        || !Array.isArray(setup.deployment) || setup.deployment.length !== 4
        || new Set(setup.deployment).size !== 4
        || !setup.deployment.every((lane) => WF_DEPLOYMENT_LANES.has(lane as "top" | "mid" | "bottom" | "flex"))
        || !WF_BUILD_PACKAGES.has(setup.buildPackage as WfBuildPackage)
        || !WF_COACH_ORDERS.has(setup.coachOrder as WfCoachOrder)
        || !techniqueValid || !counterstrikeValid
        || (!coachMode && (setup.objectiveTechnique === undefined || setup.counterstrike === undefined))) return null;
    return { ...setup, deployment: [...setup.deployment] } as unknown as WarfrontPlaybackSetup;
}

function asSharedWarfrontSetup(setup: WarfrontPlaybackSetup): SharedWarfrontPlaybackSetup | null {
    return setup.buyPolicy === "off" ? null : setup as SharedWarfrontPlaybackSetup;
}

function parseAuthorizedCouncilChoices(value: unknown): WarfrontRoundChoice[] | null {
    if (!Array.isArray(value) || value.length > 6) return null;
    const allowedKinds = new Set(["strike", "guard", "vitality", "swift", "mend"]);
    const choices: WarfrontRoundChoice[] = [];
    for (let index = 0; index < value.length; index++) {
        const entry = value[index];
        if (!isRecord(entry)) return null;
        const raw = entry as { round?: unknown; choices?: unknown; stance?: unknown; coachOrder?: unknown; buildPackage?: unknown; objectiveTechnique?: unknown; counterstrike?: unknown };
        if (raw.round !== index + 1 || !Array.isArray(raw.choices)) return null;
        const roundChoices: WarfrontChoice[] = [];
        for (const choice of raw.choices) {
            if (!isRecord(choice)) return null;
            const item = choice as { petIndex?: unknown; kind?: unknown };
            if (!Number.isInteger(item.petIndex) || Number(item.petIndex) < 0 || Number(item.petIndex) > 3 || !allowedKinds.has(String(item.kind))) return null;
            roundChoices.push({ petIndex: Number(item.petIndex), kind: item.kind as WarfrontChoice["kind"] });
        }
        if (raw.stance !== undefined && !WF_SETUP_STANCES.has(raw.stance as WfStance)) return null;
        if (raw.coachOrder !== undefined && !WF_COACH_ORDERS.has(raw.coachOrder as WfCoachOrder)) return null;
        if (raw.buildPackage !== undefined && !WF_BUILD_PACKAGES.has(raw.buildPackage as WfBuildPackage)) return null;
        if (raw.objectiveTechnique !== undefined && !WF_OBJECTIVE_TECHNIQUES.has(raw.objectiveTechnique as WfObjectiveTechnique)) return null;
        if (raw.counterstrike !== undefined && !WF_COUNTERSTRIKES.has(raw.counterstrike as WfCounterstrike)) return null;
        const parsed: WarfrontRoundChoice = { round: index + 1, choices: roundChoices };
        if (raw.stance !== undefined) parsed.stance = raw.stance as WfStance;
        if (raw.coachOrder !== undefined) parsed.coachOrder = raw.coachOrder as WfCoachOrder;
        if (raw.buildPackage !== undefined) parsed.buildPackage = raw.buildPackage as WfBuildPackage;
        if (raw.objectiveTechnique !== undefined) parsed.objectiveTechnique = raw.objectiveTechnique as WfObjectiveTechnique;
        if (raw.counterstrike !== undefined) parsed.counterstrike = raw.counterstrike as WfCounterstrike;
        choices.push(parsed);
    }
    return choices;
}

class PreparedWarfrontContractError extends Error {}
const WARFRONT_DOCTRINE_COUNTER: Partial<Record<WfDoctrine, WfDoctrine>> = {
    vanguard: "bulwark",
    bulwark: "zealot",
    zealot: "vanguard",
};


export function PetArena({ character, updateCharacter, playerRoster, allServerPlayers, setScreen, sharedImages, duelChallenges, setDuelChallenges, pendingPetBattleOpponent, onPendingPetBattleStarted, pendingArenaMatch, onPendingArenaMatchStarted, pendingArenaResponse, onArenaResponseHandled, pendingArenaRecovery, onPendingArenaRecoveryHandled, onClanWarBattleEnd, onBattleActiveChange, onFullscreenActiveChange, onHollowGatePetBattleEnd }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; playerRoster: PlayerRecord[]; allServerPlayers: ServerPlayerSummary[]; setScreen: (screen: Screen) => void; sharedImages: Record<string, string>; duelChallenges: DuelChallenge[]; setDuelChallenges: React.Dispatch<React.SetStateAction<DuelChallenge[]>>; pendingPetBattleOpponent?: PetArenaOpponent | null; onPendingPetBattleStarted?: () => void; pendingArenaMatch?: PlayerOwnedArenaMatch | null; onPendingArenaMatchStarted?: () => void; pendingArenaResponse?: DuelChallenge | null; onArenaResponseHandled?: () => void; pendingArenaRecovery?: ArenaPvpRecovery | null; onPendingArenaRecoveryHandled?: () => void; onClanWarBattleEnd?: (youWon: boolean | "draw", opponentName?: string) => void; onBattleActiveChange?: (active: boolean) => void; onFullscreenActiveChange?: (active: boolean) => void; onHollowGatePetBattleEnd?: (result: HollowGateCombatSettleResult, opponent: PetArenaOpponent) => void }) {
    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const preservedPetOverflow = Math.max(0, character.pets.length - combatEligiblePets.length);
    const [selectedPetId, setSelectedPetId] = useState(character.activePetId ?? combatEligiblePets[0]?.id ?? "");
    const [opponentMode, setOpponentMode] = useState<"player" | "ai">("player");
    const [opponentSearch, setOpponentSearch] = useState("");
    const [petChallengeMsg, setPetChallengeMsg] = useState("");
    // Live PvP duels (lockstep) are owned end-to-end by PetDuelLiveHost; this
    // screen only asks it to send a challenge and reports the settled result.
    const liveDuelRef = useRef<PetDuelLiveHandle>(null);
    // 2v2 party mode — works for both AI and PvP battles. AI auto-picks a
    // random second opponent from the AI pool. PvP attaches both pet IDs to
    // the duel challenge so the target's client knows to run the party variant
    // (with their own top-2 pets auto-selected for them).
    const [partyMode, setPartyMode] = useState(false);
    // Default the 2v2 reserve to the saved "2v2 Partner" set in the Pet Yard
    // (character.activePetId2v2). Still overridable per battle via the dropdown.
    const [reservePetId, setReservePetId] = useState<string>(character.activePetId2v2 ?? "");
    // Hollow Warfront game mode — a full-screen 4v4 MOBA/autobattler match.
    // Teams and both coaches' opening plans are frozen on launch.
    const [arenaMatch, setArenaMatch] = useState<ActiveWarfrontMatch | null>(null);
    // Server-authoritative Warfront authorization + settlement. A vs-AI match
    // never begins without a minted token, and a dropped result response leaves
    // an explicit retry action instead of silently discarding an honest win.
    const normalizedCharacterName = normalizeWarfrontPlayerName(character.name);
    const arenaRequestOwner = useRef<PlayerRequestOwner | null>(null);
    if (!arenaRequestOwner.current) arenaRequestOwner.current = new PlayerRequestOwner();
    const warfrontRewardToken = useRef<{ seed: number; token: string; reportKey: string; rewardEligible: boolean; playerName: string; prepareToken?: string } | null>(null);
    const warfrontRetryRef = useRef<(() => Promise<void>) | null>(null);
    const warfrontLifecycle = useRef<WarfrontLifecycle>({ epoch: 0, normalizedPlayerName: normalizedCharacterName, active: false });
    const warfrontPrepareAttempt = useRef<WarfrontAsyncAttempt | null>(null);
    const warfrontStartAttempt = useRef<WarfrontAsyncAttempt | null>(null);
    const warfrontCouncilAttempt = useRef<WarfrontAsyncAttempt | null>(null);
    const warfrontSettlementAttempt = useRef<WarfrontAsyncAttempt | null>(null);
    const warfrontForfeitAttempt = useRef<WarfrontAsyncAttempt | null>(null);
    const warfrontSettlementRetryTimer = useRef<WarfrontSettlementRetryTimer | null>(null);
    const warfrontSettlementEarlyRetryUsed = useRef<string | null>(null);
    const settledWarfrontSeeds = useRef<Set<number>>(new Set());
    const [warfrontRewardState, setWarfrontRewardState] = useState<WarfrontRewardState>({ phase: "idle", message: "", retry: null });
    const cancelWarfrontSettlementRetry = (ownerEpoch?: number) => {
        const timer = warfrontSettlementRetryTimer.current;
        if (!timer || (ownerEpoch !== undefined && timer.epoch !== ownerEpoch)) return;
        window.clearTimeout(timer.id);
        if (warfrontSettlementRetryTimer.current === timer) warfrontSettlementRetryTimer.current = null;
    };
    const isCurrentWarfrontIdentity = (identity: Pick<WarfrontAsyncAttempt, "epoch" | "normalizedPlayerName">): boolean => {
        const current = warfrontLifecycle.current;
        return current.active
            && current.epoch === identity.epoch
            && current.normalizedPlayerName === identity.normalizedPlayerName;
    };
    const captureWarfrontAttempt = (battleToken?: string): WarfrontAsyncAttempt | null => {
        const current = warfrontLifecycle.current;
        if (!current.active || current.normalizedPlayerName !== normalizedCharacterName) return null;
        return {
            epoch: current.epoch,
            playerName: character.name,
            normalizedPlayerName: current.normalizedPlayerName,
            ...(battleToken ? { battleToken } : {}),
            controller: new AbortController(),
        };
    };
    const isCurrentWarfrontAttempt = (attempt: WarfrontAsyncAttempt): boolean =>
        !attempt.controller.signal.aborted && isCurrentWarfrontIdentity(attempt);

    // A player transition invalidates every response and timer owned by the old
    // identity before the browser can paint or a passive recovery effect runs.
    useLayoutEffect(() => {
        const epoch = warfrontLifecycle.current.epoch + 1;
        warfrontLifecycle.current = { epoch, normalizedPlayerName: normalizedCharacterName, active: true };
        settledWarfrontSeeds.current = new Set();
        return () => {
            const current = warfrontLifecycle.current;
            if (current.epoch !== epoch) return;
            warfrontLifecycle.current = { epoch: epoch + 1, normalizedPlayerName: current.normalizedPlayerName, active: false };
            cancelWarfrontSettlementRetry(epoch);
            for (const attemptRef of [warfrontPrepareAttempt, warfrontStartAttempt, warfrontCouncilAttempt, warfrontSettlementAttempt, warfrontForfeitAttempt]) {
                const attempt = attemptRef.current;
                if (attempt?.epoch !== epoch) continue;
                attempt.controller.abort();
                if (attemptRef.current === attempt) attemptRef.current = null;
            }
            warfrontRewardToken.current = null;
            warfrontRetryRef.current = null;
            warfrontSettlementEarlyRetryUsed.current = null;
        };
    }, [normalizedCharacterName]);
    // Co-op (play the Tactical Arena 4v4 with friends) — opens the lobby overlay.
    const [showCoop, setShowCoop] = useState(false);
    // Top-level view switch. "battle" is the classic cinematic 1v1/2v2 duel;
    // "tactical" is the full-screen team game mode (vs AI / challenge / co-op).
    // Defaults to the cinematic battle so Pet Arena opens straight into it.
    const [arenaView, setArenaView] = useState<"battle" | "tactical" | "gauntlet">("battle");
    // Tactical Arena setup (single screen): a size toggle + a team grid shared by
    // Fight AI and Challenge-a-Player. Picks seed to the top pets and re-seed on
    // a size change.
    // Warfront is always 4v4; kept as state-shaped
    // const so the challenge payload + pick caps read unchanged.
    const [tacticalSize] = useState<2 | 4>(4);
    // War Council preference for the Warfront's 30 s buy rounds: manual popup or
    // a silent auto-buy policy. Per-device persisted; PvP/co-op always lock auto
    // so both clients' replays stay deterministic.
    const [wfAutoPref, setWfAutoPref] = useState<WfBuyPolicy>(() => storedChoice<WfBuyPolicy>("wfAutoBuy.v1", WF_SHARED_BUY_POLICIES, "off"));
    const setWfAuto = (value: WfBuyPolicy) => saveChoice("wfAutoBuy.v1", value, setWfAutoPref);
    const [wfPlaybookPref, setWfPlaybookPref] = useState<WfPlaybookId>(() => {
        try {
            const stored = localStorage.getItem("wfPlaybook.v1");
            if (stored === "hold-turn" || stored === "blood-hunt" || stored === "objective-control") return stored;
            const legacy = localStorage.getItem("wfAutoBuy.v1");
            return legacy === "defense" ? "hold-turn" : legacy === "offense" ? "blood-hunt" : "objective-control";
        } catch { return "objective-control"; }
    });
    const activeWfPlaybook = WARFRONT_PLAYBOOKS.find((item) => item.id === wfPlaybookPref) ?? WARFRONT_PLAYBOOKS[2];
    const activeWfAuthoredSetup: WarfrontAuthoredSetup = {
        deployment: WARFRONT_OPENING_DEPLOYMENT,
        buildPackage: activeWfPlaybook.buildPackage,
        coachOrder: activeWfPlaybook.coachOrder,
        objectiveTechnique: activeWfPlaybook.objectiveTechnique,
        counterstrike: activeWfPlaybook.counterstrike,
    };
    const localWarfrontSetup = (buyPolicy: WfBuyPolicy): WarfrontPlaybackSetup => {
        const setup = { stance: wfStancePref, doctrine: wfDoctrinePref, buyPolicy, ...activeWfAuthoredSetup };
        if (buyPolicy === "off") {
            delete setup.objectiveTechnique;
            delete setup.counterstrike;
        }
        return setup;
    };
    const setWfPlaybook = (id: WfPlaybookId) => {
        const playbook = WARFRONT_PLAYBOOKS.find((item) => item.id === id) ?? WARFRONT_PLAYBOOKS[2];
        setWfPlaybookPref(playbook.id);
        if (wfAutoPref !== "off") setWfAuto(playbook.buyPolicy);
        try { localStorage.setItem("wfPlaybook.v1", playbook.id); } catch { /* storage disabled — ignore */ }
    };
    // Opening FORMATION (stance) for the Warfront — per-device persisted; also
    // adjustable at every manual War Council mid-match.
    const [wfStancePref, setWfStancePref] = useState<WfStance>(() => storedChoice("wfStance.v1", WF_SETUP_STANCES, "balanced"));
    const setWfStance = (value: WfStance) => saveChoice("wfStance.v1", value, setWfStancePref);
    // Team DOCTRINE — a second pre-match strategic axis (a team-wide boon).
    const [wfDoctrinePref, setWfDoctrinePref] = useState<WfDoctrine>(() => storedChoice("wfDoctrine.v1", WF_SETUP_DOCTRINES, "vanguard"));
    const setWfDoctrine = (value: WfDoctrine) => saveChoice("wfDoctrine.v1", value, setWfDoctrinePref);
    // The scouting tell comes from a server-held one-at-a-time grant. Local
    // storage only survives navigation; it cannot choose or forge the seed
    // because Start must present the matching server token.
    const [preparedWarfrontContract, setPreparedWarfrontContract] = useState<PreparedWarfrontContract | null>(() => readPreparedWarfrontContract(character.name));
    const [warfrontPrepareMessage, setWarfrontPrepareMessage] = useState("Loading the next server scouting contract...");
    const [warfrontPreparing, setWarfrontPreparing] = useState(false);
    useLayoutEffect(() => {
        const cached = readPreparedWarfrontContract(character.name);
        setPreparedWarfrontContract(cached);
        setWarfrontPrepareMessage(cached ? "Server scouting contract ready." : "Loading the next server scouting contract...");
        setWarfrontPreparing(false);
        setWarfrontRewardState({ phase: "idle", message: "", retry: null });
    }, [normalizedCharacterName]);
    async function requestPreparedWarfrontContract() {
        const currentAttempt = warfrontPrepareAttempt.current;
        if (currentAttempt && isCurrentWarfrontAttempt(currentAttempt)) return;
        currentAttempt?.controller.abort();
        const attempt = captureWarfrontAttempt();
        if (!attempt) return;
        warfrontPrepareAttempt.current = attempt;
        setWarfrontPreparing(true);
        setWarfrontPrepareMessage("Loading the next server scouting contract...");
        try {
            const [response, data] = await postWarfront<{
                prepareToken?: unknown;
                scoutedDoctrineOptions?: unknown;
                scoutedWarband?: unknown;
                preparedAt?: unknown;
                error?: unknown;
                code?: unknown;
                retryAfterSeconds?: unknown;
            }>("/api/pet/warfront-start", { playerName: attempt.playerName, action: "prepare" }, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) return;
            const contract = parsePreparedWarfrontContract({
                prepareToken: data?.prepareToken,
                scoutedDoctrineOptions: data?.scoutedDoctrineOptions,
                scoutedWarband: data?.scoutedWarband,
                preparedAt: data?.preparedAt,
            });
            if (!response.ok || !contract) {
                const retrySeconds = typeof data?.retryAfterSeconds === "number" && Number.isFinite(data.retryAfterSeconds) ? Math.max(1, data.retryAfterSeconds) : null;
                const fallback = data?.code === "warfront-forfeit-cooldown"
                    ? `That forfeited seed remains sealed for about ${retrySeconds && retrySeconds >= 60 ? `${Math.ceil(retrySeconds / 60)}m` : `${Math.ceil(retrySeconds ?? 1)}s`}; fresh scouting unlocks after its original regulation clock.`
                    : data?.code === "warfront-match-active"
                        ? "The next scouting report unlocks after your active Warfront settles or finishes its regulation lease."
                        : "The next scouting contract is unavailable.";
                throw new Error(data?.code === "warfront-forfeit-cooldown" ? fallback : typeof data?.error === "string" ? data.error : fallback);
            }
            writePreparedWarfrontContract(attempt.playerName, contract);
            setPreparedWarfrontContract(contract);
            setWarfrontPrepareMessage("Server scouting contract ready.");
        } catch (error) {
            if (!isCurrentWarfrontAttempt(attempt)) return;
            setWarfrontPrepareMessage(error instanceof Error ? error.message : "The next scouting contract is unavailable.");
        } finally {
            if (warfrontPrepareAttempt.current === attempt) {
                warfrontPrepareAttempt.current = null;
                if (isCurrentWarfrontAttempt(attempt)) setWarfrontPreparing(false);
            }
        }
    }
    useEffect(() => {
        void requestPreparedWarfrontContract();
    }, [normalizedCharacterName]);
    const [tacticalPicks, setTacticalPicks] = useState<string[]>(() => normalizeArenaSelection(pickArenaTeam(combatEligiblePets, 4).map((p) => p.id), 4));
    const [tacticalSlot, setTacticalSlot] = useState(0);
    const [arenaChallengeName, setArenaChallengeName] = useState("");
    const [arenaChallengeMsg, setArenaChallengeMsg] = useState("");
    const [arenaSending, setArenaSending] = useState(false);
    const [arenaRecoveryRevision, setArenaRecoveryRevision] = useState(0);
    // 5→1 pre-roll shown to both players before the match plays. Holds the built
    // slots; when it hits 0 we mount PetArenaMatch (same seed → identical fight).
    const [arenaCountdown, setArenaCountdown] = useState<{ secs: number; match: ActiveWarfrontMatch } | null>(null);
    useLayoutEffect(() => {
        setArenaMatch(null);
        setArenaCountdown(null);
    }, [normalizedCharacterName]);
    // Responder team picks (for an incoming arena challenge, separate from the
    // wizard's tacticalPicks so an in-progress send isn't clobbered).
    const [respondPicks, setRespondPicks] = useState<string[]>(() => normalizeArenaSelection([], 4));
    const [respondSlot, setRespondSlot] = useState(0);
    const [arenaResponding, setArenaResponding] = useState(false);
    const currentPendingArenaResponse = pendingArenaResponse
        && normalizePlayerIdentity(pendingArenaResponse.toName) === normalizedCharacterName
        ? pendingArenaResponse
        : null;

    // PvP/co-op UI state and every request it can launch belong to the active
    // normalized player. Layout cleanup runs before a newly selected account can
    // paint, so a late response cannot start a match or clear the next account's
    // busy state.
    useLayoutEffect(() => {
        const owner = arenaRequestOwner.current!;
        const epoch = owner.activate(character.name);
        setShowCoop(false);
        setArenaSending(false);
        setArenaResponding(false);
        setArenaChallengeName("");
        setArenaChallengeMsg("");
        setArenaRecoveryRevision((revision) => revision + 1);
        setTacticalPicks(normalizeArenaSelection(pickArenaTeam(combatEligiblePets, 4).map((pet) => pet.id), 4));
        setTacticalSlot(0);
        setRespondPicks(normalizeArenaSelection([], 4));
        setRespondSlot(0);
        return () => owner.deactivate(epoch);
    }, [normalizedCharacterName]);

    function sendDirectPetChallenge(toName: string) {
        const targetRecord = allServerPlayers.find((player) => player.name.toLowerCase() === toName.toLowerCase());
        if (targetRecord && publicEligiblePets(targetRecord).length === 0) {
            setPetChallengeMsg(`${toName} does not have a pet available for battle.`);
            return;
        }
        if (!selectedPet) {
            setPetChallengeMsg("Choose one of your pets first.");
            return;
        }
        // 2v2 challenge needs the player to have a reserve and the target
        // to have at least 2 pets. If either fails, fall back to 1v1.
        const wantsParty = partyMode && combatEligiblePets.length >= 2;
        const reserveCandidate = wantsParty
            ? (combatEligiblePets.find(p => p.id === reservePetId && p.id !== selectedPet.id)
                ?? combatEligiblePets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0]
                ?? null)
            : null;
        const targetCanParty = publicEligiblePets(targetRecord).length >= 2;
        const doParty = wantsParty && !!reserveCandidate && targetCanParty;
        if (wantsParty && !doParty) {
            setPetChallengeMsg(
                !reserveCandidate
                    ? "Need a reserve pet (a second pet not on expedition). Sending a 1v1 challenge instead."
                    : `${toName} only has one pet — sending a 1v1 challenge instead.`
            );
        }
        setBattleReady(false);
        // LIVE PvP (docs/pet-coliseum-player-control-plan.md §10). Player-versus-
        // player pet duels are lockstep and require both people present, so the
        // challenge goes over the realtime socket instead of being queued as a
        // DuelChallenge. There is deliberately no async fallback: if the target is
        // not connected the server refuses and says so.
        const liveErr = liveDuelRef.current?.challenge(
            toName,
            doParty ? "2v2" : "1v1",
        ) ?? "Live duels need a realtime connection — reconnect and try again.";
        setPetChallengeMsg(liveErr ?? `Challenge sent to ${toName}. Waiting for them to accept…`);
        return;
    }

    // Build the role-assigned slots + start the 5s pre-roll, evening both teams
    // to the smaller roster so a lopsided pick can't auto-stomp. Both clients
    // run this from identical embedded teams, so the match stays in sync.
    function startArenaMatch(
        blue: Pet[],
        red: Pet[],
        seed: number,
        options: {
            vsAi?: boolean;
            blueSetup?: WarfrontPlaybackSetup;
            redSetup?: SharedWarfrontPlaybackSetup;
            localTeam?: ArenaTeam;
            authoritativeBlue?: ArenaSlot[];
            authoritativeRed?: ArenaSlot[];
            reportKey?: string;
            prepareToken?: string;
            committedChoices?: WarfrontRoundChoice[];
            difficulty?: WarfrontDifficultyDisclosure;
            rewardModel?: WarfrontRewardModel;
        } = {},
    ) {
        primeWarfrontAudio();
        // Use the five-second pre-roll to fetch/parse the Warfront renderer
        // instead of showing another loading panel after the countdown.
        preloadWarfrontExperience([...blue, ...red]);
        const n = Math.max(1, Math.min(
            options.authoritativeBlue?.length ?? blue.length,
            options.authoritativeRed?.length ?? red.length,
        ));
        setArenaView("tactical");
        // AI authorization is minted before this function is called. Shared
        // matches arrive with both coaches' deterministic setup already sealed.
        const fallbackBuyPolicy = options.vsAi ? wfAutoPref : activeWfPlaybook.buyPolicy;
        const blueSetup = options.blueSetup ?? localWarfrontSetup(fallbackBuyPolicy);
        setArenaCountdown({
            secs: 5,
            match: {
                blue: options.authoritativeBlue?.slice(0, n) ?? autoRoleTeam(blue, n),
                red: options.authoritativeRed?.slice(0, n) ?? autoRoleTeam(red, n),
                seed,
                vsAi: options.vsAi === true,
                blueSetup,
                redSetup: options.redSetup,
                localTeam: options.localTeam ?? "blue",
                reportKey: options.reportKey,
                prepareToken: options.prepareToken,
                committedChoices: options.committedChoices,
                difficulty: options.difficulty,
                rewardModel: options.rewardModel,
            },
        });
    }

    // Hollow Warfront vs-AI is SERVER-AUTHORITATIVE. At launch we mint a token via
    // /api/pet/warfront-start seals the exact deterministic match. Auto-Council
    // seals its winner immediately; Manual seals immutable combat inputs and the
    // result endpoint replays the effective Council log before paying its fixed,
    // outcome-independent completion reward (never win/first-win credit).
    async function mintWarfrontToken(contract: PreparedWarfrontContract, bluePets: Pet[], attempt: WarfrontAsyncAttempt): Promise<AuthorizedWarfrontMatch> {
        type StartResponse = { token?: unknown; seed?: unknown; reportKey?: unknown; rewardEligible?: unknown; blue?: unknown; red?: unknown; setup?: unknown; redSetup?: unknown; committedChoices?: unknown; difficulty?: unknown; rewardModel?: unknown; error?: unknown; code?: unknown; retryAfterMs?: unknown };
        const request = {
            playerName: attempt.playerName,
            playerPetIds: bluePets.map((pet) => pet.id),
            prepareToken: contract.prepareToken,
            ...localWarfrontSetup(wfAutoPref),
        };
        let r: Response;
        let data: StartResponse | null;
        for (let retry = 0; ; retry++) {
            [r, data] = await postWarfront<StartResponse>("/api/pet/warfront-start", request, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) throw new Error("The active Warfront player changed before authorization completed.");
            if (r.status !== 425 || data?.code !== "warfront-start-in-flight") break;
            if (retry >= 3) throw new Error("The server is still sealing this exact match. Retry Start in a moment; no second authorization was created.");
            setWarfrontRewardState({ phase: "minting", message: "The server is sealing this exact prepared match. Waiting for its single authorization...", retry: null });
            const retryAfterMs = typeof data.retryAfterMs === "number" && Number.isFinite(data.retryAfterMs)
                ? Math.max(250, Math.min(1_500, data.retryAfterMs))
                : 500;
            await abortableDelay(retryAfterMs, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) throw new Error("The active Warfront player changed before authorization completed.");
        }
        if (!r.ok || typeof data?.token !== "string") {
            if (data?.code === "prepared-contract-invalid") {
                throw new PreparedWarfrontContractError(typeof data.error === "string" ? data.error : "The scouting contract expired.");
            }
            throw new Error(typeof data?.error === "string" ? data.error : "The Warfront contract could not be authorized.");
        }
        const authorizedBlue = parseAuthorizedWarfrontSlots(data.blue);
        const authorizedRed = parseAuthorizedWarfrontSlots(data.red);
        const authorizedSetup = parseAuthorizedWarfrontSetup(data.setup);
        const parsedRedSetup = parseAuthorizedWarfrontSetup(data.redSetup);
        const authorizedRedSetup = parsedRedSetup ? asSharedWarfrontSetup(parsedRedSetup) : null;
        const authorizedSeed = Number(data.seed);
        const authorizedReportKey = typeof data.reportKey === "string" ? data.reportKey : "";
        const committedChoices = parseAuthorizedCouncilChoices(data.committedChoices);
        const difficulty = parseWarfrontDifficulty(data.difficulty);
        const rewardModel = typeof data.rewardEligible === "boolean" ? parseWarfrontRewardModel(data.rewardModel, data.rewardEligible) : null;
        if (!authorizedBlue || !authorizedRed || !authorizedSetup || !authorizedRedSetup
            || !Number.isSafeInteger(authorizedSeed) || authorizedSeed <= 0 || authorizedSeed > 0x7fffffff
            || authorizedReportKey !== `${authorizedSeed}:tactical`
            || typeof data.rewardEligible !== "boolean"
            || data.rewardEligible !== (authorizedSetup.buyPolicy !== "off")
            || !committedChoices || !difficulty || !rewardModel) {
            throw new Error("The server did not return the exact sealed Warfront roster, setup, difficulty, and reward model.");
        }
        cancelWarfrontSettlementRetry();
        warfrontSettlementEarlyRetryUsed.current = null;
        warfrontRewardToken.current = {
            seed: authorizedSeed,
            token: data.token,
            reportKey: authorizedReportKey,
            rewardEligible: data.rewardEligible,
            playerName: attempt.playerName,
            prepareToken: contract.prepareToken,
        };
        return {
            token: data.token,
            seed: authorizedSeed,
            reportKey: authorizedReportKey,
            rewardEligible: data.rewardEligible,
            blue: authorizedBlue,
            red: authorizedRed,
            setup: authorizedSetup,
            redSetup: authorizedRedSetup,
            committedChoices,
            difficulty,
            rewardModel,
        };
    }

    async function startAuthorizedAiWarfront(blue: Pet[], contract: PreparedWarfrontContract) {
        const launch = async () => {
            const currentAttempt = warfrontStartAttempt.current;
            if (currentAttempt && isCurrentWarfrontAttempt(currentAttempt)) return;
            currentAttempt?.controller.abort();
            const attempt = captureWarfrontAttempt();
            if (!attempt) return;
            warfrontStartAttempt.current = attempt;
            setWarfrontRewardState({ phase: "minting", message: "Authorizing this exact squad, setup, and battlefield seed...", retry: null });
            warfrontRetryRef.current = null;
            warfrontRewardToken.current = null;
            try {
                const authorization = await mintWarfrontToken(contract, blue, attempt);
                if (!isCurrentWarfrontAttempt(attempt)) return;
                const powerLine = `${authorization.difficulty.label}: your squad ${authorization.difficulty.playerPower.toLocaleString()} power vs ${authorization.difficulty.opponentPower.toLocaleString()}.`;
                const authorizationMessage = authorization.rewardEligible
                    ? `${powerLine} Competitive rewards require a verified victory.`
                    : `${powerLine} Coach completion pays ${authorization.rewardModel.amount.toLocaleString()} ryo regardless of win, loss, or draw, for up to ${authorization.rewardModel.dailyCap} paid completions per UTC day.`;
                setWarfrontRewardState({ phase: "ready", message: authorizationMessage, retry: null });
                gameToast(authorization.rewardEligible
                    ? "Warfront contract sealed. Victory rewards are protected."
                    : `Coach contract sealed: ${authorization.rewardModel.amount.toLocaleString()} ryo on completion, outcome-independent.`, { kind: "info" });
                startArenaMatch(blue, authorization.red.map((slot) => slot.pet), authorization.seed, {
                    vsAi: true,
                    blueSetup: authorization.setup,
                    redSetup: authorization.redSetup,
                    localTeam: "blue",
                    authoritativeBlue: authorization.blue,
                    authoritativeRed: authorization.red,
                    reportKey: authorization.reportKey,
                    prepareToken: contract.prepareToken,
                    committedChoices: authorization.committedChoices,
                    difficulty: authorization.difficulty,
                    rewardModel: authorization.rewardModel,
                });
                // Keep the exact grant locally until settlement. If the route or
                // tab reloads mid-match, Start can idempotently recover the same
                // server authorization instead of orphaning its reward token.
                setWarfrontPrepareMessage("This scouting contract is active until its result settles.");
            } catch (error) {
                if (!isCurrentWarfrontAttempt(attempt)) return;
                const message = error instanceof Error ? error.message : "The Warfront contract could not be authorized.";
                if (error instanceof PreparedWarfrontContractError) {
                    clearPreparedWarfrontContract(attempt.playerName, contract.prepareToken);
                    setPreparedWarfrontContract(null);
                    void requestPreparedWarfrontContract();
                    setWarfrontRewardState({ phase: "error", message: `${message} A new server scouting report is being prepared.`, retry: null });
                    return;
                }
                warfrontRetryRef.current = launch;
                setWarfrontRewardState({ phase: "error", message: `${message} No match started and no settlement was put at risk.`, retry: "mint" });
            } finally {
                if (warfrontStartAttempt.current === attempt) warfrontStartAttempt.current = null;
            }
        };
        await launch();
    }

    async function commitAuthorizedWarfrontCouncil(
        match: ActiveWarfrontMatch,
        round: number,
        decision: WarfrontRoundDecision,
    ): Promise<void> {
        const authorization = warfrontRewardToken.current;
        const reportKey = match.reportKey ?? authorization?.reportKey;
        if (!match.vsAi || match.blueSetup.buyPolicy !== "off" || !authorization
            || authorization.seed !== match.seed || normalizeWarfrontPlayerName(authorization.playerName) !== normalizedCharacterName || !reportKey) {
            throw new Error("The sealed Coach Mode authorization is unavailable. This Council was not applied.");
        }
        const currentAttempt = warfrontCouncilAttempt.current;
        if (currentAttempt && isCurrentWarfrontAttempt(currentAttempt)) {
            throw new Error("This Council decision is already being secured.");
        }
        currentAttempt?.controller.abort();
        const attempt = captureWarfrontAttempt(authorization.token);
        if (!attempt) throw new Error("The active Warfront player changed before this Council could be secured.");
        warfrontCouncilAttempt.current = attempt;
        const expected: WarfrontRoundChoice = {
            round,
            choices: decision.choices ?? [],
            ...(decision.stance !== undefined ? { stance: decision.stance } : {}),
            ...(decision.coachOrder !== undefined ? { coachOrder: decision.coachOrder } : {}),
            ...(decision.buildPackage !== undefined ? { buildPackage: decision.buildPackage } : {}),
            ...(decision.objectiveTechnique !== undefined ? { objectiveTechnique: decision.objectiveTechnique } : {}),
            ...(decision.counterstrike !== undefined ? { counterstrike: decision.counterstrike } : {}),
        };
        try {
            const [response, data] = await postWarfront<{ committedChoices?: unknown; error?: unknown }>("/api/pet/warfront-council", {
                    playerName: attempt.playerName,
                    battleToken: authorization.token,
                    reportKey,
                    ...expected,
                }, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) throw new Error("The active Warfront player changed before this Council completed.");
            const committedChoices = parseAuthorizedCouncilChoices(data?.committedChoices);
            const accepted = committedChoices?.[round - 1];
            if (!response.ok || !committedChoices || committedChoices.length !== round
                || JSON.stringify(accepted) !== JSON.stringify(expected)) {
                throw new Error(typeof data?.error === "string" ? data.error : "The server could not secure this Council decision. Retry the same choice.");
            }
            setArenaMatch((current) => current && current.seed === match.seed
                ? { ...current, committedChoices }
                : current);
        } finally {
            if (warfrontCouncilAttempt.current === attempt) warfrontCouncilAttempt.current = null;
        }
    }

    function clearMatchingPreparedWarfront(playerName: string, prepareToken?: string): void {
        const prepared = readPreparedWarfrontContract(playerName);
        if (!prepared || !prepareToken || prepared.prepareToken !== prepareToken) return;
        clearPreparedWarfrontContract(playerName, prepared.prepareToken);
        if (normalizeWarfrontPlayerName(playerName) === warfrontLifecycle.current.normalizedPlayerName) {
            setPreparedWarfrontContract(null);
        }
    }

    function finishWarfrontReceipt(
        receipt: WarfrontTerminalReceipt,
        match: { seed: number; playerName: string; battleToken: string; prepareToken?: string },
        attempt: WarfrontAsyncAttempt,
        exitRace = false,
    ): boolean {
        if (!isCurrentWarfrontAttempt(attempt)
            || attempt.battleToken !== match.battleToken
            || attempt.normalizedPlayerName !== normalizeWarfrontPlayerName(match.playerName)
            || !warfrontTerminalReceiptMatchesPlayer(receipt, attempt.playerName)) return false;
        const receivedCharacter = receipt.character as unknown as Character;
        updateCharacter((current) => current && normalizeWarfrontPlayerName(current.name) === attempt.normalizedPlayerName
            ? receivedCharacter
            : current);
        cancelWarfrontSettlementRetry();
        warfrontSettlementEarlyRetryUsed.current = null;
        settledWarfrontSeeds.current.add(match.seed);
        clearPendingWarfrontSettlement(match.playerName, match.battleToken);
        clearMatchingPreparedWarfront(match.playerName, match.prepareToken);
        warfrontRewardToken.current = null;
        warfrontRetryRef.current = null;
        const message = warfrontTerminalReceiptMessage(receipt, exitRace);
        setWarfrontRewardState({ phase: "settled", message, retry: null });
        gameToast(message, { kind: exitRace || receipt.unranked || receipt.forfeited ? "info" : "success" });
        if (exitRace) setArenaMatch(null);
        void requestPreparedWarfrontContract();
        return true;
    }

    async function forfeitAuthorizedWarfront(match: ActiveWarfrontMatch): Promise<void> {
        const authorization = warfrontRewardToken.current;
        const reportKey = match.reportKey ?? authorization?.reportKey;
        if (!match.vsAi || !authorization || authorization.seed !== match.seed
            || normalizeWarfrontPlayerName(authorization.playerName) !== normalizedCharacterName || !reportKey) {
            throw new Error("The active server Warfront authorization is unavailable. Return to the match and retry.");
        }
        const currentAttempt = warfrontForfeitAttempt.current;
        if (currentAttempt && isCurrentWarfrontAttempt(currentAttempt)) throw new Error("This forfeit is already being secured.");
        currentAttempt?.controller.abort();
        const attempt = captureWarfrontAttempt(authorization.token);
        if (!attempt) throw new Error("The active Warfront player changed before this forfeit could be secured.");
        warfrontForfeitAttempt.current = attempt;
        try {
            const [response, raw] = await postWarfront<Record<string, unknown>>("/api/pet/warfront-forfeit", { playerName: attempt.playerName, battleToken: authorization.token, reportKey }, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) return;
            if (!response.ok) throw new Error(typeof raw?.error === "string" ? raw.error : "The server could not secure this forfeit. Retry without closing the match.");
            if (isSafeExpiredWarfrontExit(raw)) {
                cancelWarfrontSettlementRetry();
                warfrontSettlementEarlyRetryUsed.current = null;
                settledWarfrontSeeds.current.add(match.seed);
                clearPendingWarfrontSettlement(attempt.playerName, authorization.token);
                clearMatchingPreparedWarfront(attempt.playerName, authorization.prepareToken);
                warfrontRewardToken.current = null;
                warfrontRetryRef.current = null;
                const message = "The server confirmed this authorization expired and no different match lease is active. Exited safely; no reward, mastery, or progress was settled.";
                setWarfrontRewardState({ phase: "settled", message, retry: null });
                gameToast(message, { kind: "info" });
                setArenaMatch(null);
                void requestPreparedWarfrontContract();
                return;
            }
            const receipt = parseWarfrontTerminalReceipt(raw);
            if (!receipt) throw new Error("The server response did not contain a durable terminal Warfront receipt.");
            if (!warfrontTerminalReceiptMatchesPlayer(receipt, attempt.playerName)) {
                throw new Error("The server returned a terminal receipt for a different player.");
            }
            finishWarfrontReceipt(receipt, {
                seed: match.seed,
                playerName: attempt.playerName,
                battleToken: authorization.token,
                prepareToken: authorization.prepareToken,
            }, attempt, true);
        } finally {
            if (warfrontForfeitAttempt.current === attempt) warfrontForfeitAttempt.current = null;
        }
    }

    // Tactical Arena settlement (vs-AI only): redeem the sealed Warfront token.
    // Auto Council can pay from its sealed server outcome; deterministic Coach
    // Mode remains outcome-unranked but pays its fixed completion contract. The receipt is
    // sealed by seed (`${seed}:tactical`) so refresh/replay cannot double-apply.
    async function settlePendingWarfrontReward(pending: PendingWarfrontSettlement) {
        if (!warfrontLifecycle.current.active
            || normalizeWarfrontPlayerName(pending.playerName) !== warfrontLifecycle.current.normalizedPlayerName) return;
        const currentAttempt = warfrontSettlementAttempt.current;
        if (currentAttempt && isCurrentWarfrontAttempt(currentAttempt)) return;
        currentAttempt?.controller.abort();
        const attempt = captureWarfrontAttempt(pending.battleToken);
        if (!attempt || attempt.normalizedPlayerName !== normalizeWarfrontPlayerName(pending.playerName)) return;
        warfrontSettlementAttempt.current = attempt;
        cancelWarfrontSettlementRetry();
        const settlementMessage = pending.rewardEligible === false
            ? "Verifying the Coach decision log and its fixed completion reward..."
            : "Verifying the result and banking your Warfront reward...";
        setWarfrontRewardState({ phase: "settling", message: settlementMessage, retry: null });
        gameToast(settlementMessage, { kind: "info" });
        warfrontRetryRef.current = null;
        try {
            const [r, raw] = await postWarfront<Record<string, unknown>>("/api/pet/battle-result", {
                    playerName: pending.playerName,
                    outcome: pending.outcome,
                    reportKey: pending.reportKey,
                    battleToken: pending.battleToken,
                    warfrontChoices: pending.warfrontChoices,
                }, attempt.controller.signal);
            if (!isCurrentWarfrontAttempt(attempt)) return;
            const earlyRetryDelay = r.status === 425 ? warfrontEarlyRetryDelay(raw) : null;
            if (earlyRetryDelay !== null && warfrontSettlementEarlyRetryUsed.current !== pending.battleToken) {
                warfrontSettlementEarlyRetryUsed.current = pending.battleToken;
                const waitMs = Math.max(0, earlyRetryDelay - WARFRONT_EARLY_RETRY_CUSHION_MS);
                const waitLabel = waitMs >= 60_000 ? `${Math.ceil(waitMs / 60_000)}m` : `${Math.max(1, Math.ceil(waitMs / 1_000))}s`;
                const message = `Result sealed; reward unlocks in about ${waitLabel}. Settlement will retry automatically.`;
                setWarfrontRewardState({ phase: "settling", message, retry: null });
                gameToast(message, { kind: "info" });
                const retryOwner: WarfrontSettlementRetryTimer = {
                    epoch: attempt.epoch,
                    normalizedPlayerName: attempt.normalizedPlayerName,
                    battleToken: pending.battleToken,
                    id: 0,
                };
                retryOwner.id = window.setTimeout(() => {
                    if (warfrontSettlementRetryTimer.current !== retryOwner) return;
                    warfrontSettlementRetryTimer.current = null;
                    if (!isCurrentWarfrontIdentity(retryOwner)) return;
                    void settlePendingWarfrontReward(pending);
                }, earlyRetryDelay);
                warfrontSettlementRetryTimer.current = retryOwner;
                return;
            }
            if (raw?.reason === "invalid-or-spent-pet-battle-token") {
                warfrontSettlementEarlyRetryUsed.current = null;
                clearMatchingPreparedWarfront(pending.playerName, pending.prepareToken);
                clearPendingWarfrontSettlement(pending.playerName, pending.battleToken);
                warfrontRewardToken.current = null;
                setWarfrontRewardState({ phase: "error", message: "This Warfront authorization expired before the server could recover a settlement receipt. No reward was silently marked paid.", retry: null });
                void requestPreparedWarfrontContract();
                return;
            }
            if (!r.ok) throw new Error(typeof raw?.error === "string" ? raw.error : "The server could not confirm this Warfront settlement.");
            const receipt = parseWarfrontTerminalReceipt(raw);
            if (!receipt) {
                throw new Error("The server response did not contain a durable Warfront settlement receipt.");
            }
            if (!warfrontTerminalReceiptMatchesPlayer(receipt, attempt.playerName)) {
                throw new Error("The server returned a terminal receipt for a different player.");
            }
            finishWarfrontReceipt(receipt, pending, attempt);
        } catch (error) {
            if (!isCurrentWarfrontAttempt(attempt)) return;
            const message = error instanceof Error ? error.message : "The reward settlement did not complete.";
            const retry = () => settlePendingWarfrontReward(pending);
            warfrontRetryRef.current = retry;
            setWarfrontRewardState({ phase: "error", message: `${message} Your sealed result is saved on this device; retry settlement.`, retry: "settle" });
        } finally {
            if (warfrontSettlementAttempt.current === attempt) warfrontSettlementAttempt.current = null;
        }
    }

    function reportTacticalArenaResult(m: ActiveWarfrontMatch, result: WarfrontResult) {
        if (!m.vsAi) return;
        if (settledWarfrontSeeds.current.has(m.seed)
            || (warfrontSettlementAttempt.current && isCurrentWarfrontAttempt(warfrontSettlementAttempt.current))) return;
        const authorization = warfrontRewardToken.current;
        if (!authorization || authorization.seed !== m.seed
            || normalizeWarfrontPlayerName(authorization.playerName) !== normalizedCharacterName) {
            setWarfrontRewardState({ phase: "error", message: "The sealed match authorization is missing. No result or reward was marked settled.", retry: null });
            return;
        }
        const winner = result.winner ?? "draw";
        const outcome = winner === "blue" ? "win" : winner === "red" ? "loss" : "draw";
        const pending: PendingWarfrontSettlement = {
            version: 1,
            playerName: character.name,
            seed: m.seed,
            reportKey: m.reportKey ?? authorization.reportKey,
            battleToken: authorization.token,
            ...(m.prepareToken ?? authorization.prepareToken ? { prepareToken: m.prepareToken ?? authorization.prepareToken } : {}),
            rewardEligible: authorization.rewardEligible,
            outcome,
            ...(result.choiceLog ? { warfrontChoices: result.choiceLog } : {}),
            createdAt: Date.now(),
        };
        // Persist before the request. A route change, refresh, or lost response
        // can therefore replay this exact idempotent settlement on next entry.
        writePendingWarfrontSettlement(pending);
        warfrontRetryRef.current = () => settlePendingWarfrontReward(pending);
        void settlePendingWarfrontReward(pending);
    }

    useEffect(() => {
        const pending = readPendingWarfrontSettlement(character.name);
        if (!pending) return;
        warfrontRewardToken.current = {
            seed: pending.seed,
            token: pending.battleToken,
            reportKey: pending.reportKey,
            rewardEligible: pending.rewardEligible !== false,
            playerName: pending.playerName,
            prepareToken: pending.prepareToken,
        };
        warfrontRetryRef.current = () => settlePendingWarfrontReward(pending);
        setWarfrontRewardState({ phase: "settling", message: "Recovering your unfinished Warfront settlement...", retry: null });
        void settlePendingWarfrontReward(pending);
    }, [character.name]);

    // Send a Tactical Arena PvP challenge with my hand-picked roster. Rides the
    // same /api/player/challenge delivery as cinematic pet challenges (mode
    // "clanWarPet" so the global accept banner surfaces it) but flagged
    // arenaMatch; my roster is referenced by id (resolved against the server-kept
    // challenger.pets snapshot) for a deterministic match.
    async function sendArenaChallenge(toName: string, size: 2 | 4, teamIds: string[]) {
        const owner = arenaRequestOwner.current!;
        if (owner.current("arena-send")) return;
        const name = toName.trim();
        if (!name) { setArenaChallengeMsg("Enter a player name to challenge."); return; }
        if (normalizePlayerIdentity(name) === normalizedCharacterName) { setArenaChallengeMsg("You can't challenge yourself."); return; }
        const availableIds = new Set(combatEligiblePets.filter((pet) => !isPetOnExpedition(pet)).map((pet) => pet.id));
        if (!isExactAvailableArenaSelection(teamIds, availableIds, size)) {
            setArenaChallengeMsg(`A ${size}v${size} match requires exactly ${size} unique pets that are currently available.`);
            return;
        }
        const targetRecord = allServerPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (targetRecord && availablePetBattleCount(publicEligiblePets(targetRecord)) < size) {
            setArenaChallengeMsg(`${name} needs ${size} available pets for a ${size}v${size} arena match.`);
            return;
        }
        const challengerWarfrontSetup = sharedWarfrontSetup(wfStancePref, wfDoctrinePref, activeWfPlaybook.buyPolicy, activeWfAuthoredSetup);
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: name,
            challenger: character,
            createdAt: nextArenaChallengeCreatedAt(),
            mode: "clanWarPet",
            arenaMatch: true,
            arenaSize: size,
            challengerTeamIds: [...teamIds],
            challengerWarfrontSetup,
        };
        const attempt = owner.begin("arena-send", character.name);
        if (!attempt) return;
        setArenaSending(true);
        try {
            const res = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: name, challenge }),
                signal: attempt.controller.signal,
            });
            if (!owner.isCurrent(attempt)) return;
            const data = await res.json().catch(() => ({} as { error?: string }));
            if (!owner.isCurrent(attempt)) return;
            if (!res.ok) {
                setArenaChallengeMsg(`❌ ${data?.error ?? `Could not reach ${name}. Check the name and try again.`}`);
                return;
            }
            writeArenaPvpRecovery({
                version: 1,
                challengeId: challenge.id,
                playerName: attempt.playerName,
                counterpartName: name,
                role: "challenger",
                createdAt: challenge.createdAt,
            });
            setArenaRecoveryRevision((revision) => revision + 1);
            setDuelChallenges((current) => [
                ...current.filter((candidate) => !(normalizePlayerIdentity(candidate.fromName) === attempt.normalizedPlayerName && !candidate.accepted && !candidate.declined && !candidate.battleId)),
                challenge,
            ]);
            setArenaChallengeMsg(`✅ ${size === 4 ? "4v4" : "2v2"} challenge sent to ${name}. Your ${challengerWarfrontSetup.doctrine} doctrine and ${challengerWarfrontSetup.stance} formation are sealed.`);
        } catch (error) {
            if (!owner.isCurrent(attempt)) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            setArenaChallengeMsg("❌ Network error sending challenge.");
        } finally {
            if (owner.finish(attempt)) setArenaSending(false);
        }
    }

    // Responder side: I picked my team for an incoming arena challenge. Echo it
    // back (image-stripped) on the accepted notice and launch the same match the
    // challenger will — blue resolved from their snapshot, red = my picks.
    async function respondToArenaChallenge(challenge: DuelChallenge, teamIds: string[]) {
        const owner = arenaRequestOwner.current!;
        if (owner.current("arena-respond")) return;
        if (normalizePlayerIdentity(challenge.toName) !== normalizedCharacterName) {
            setArenaChallengeMsg("This challenge belongs to a different player and was not opened.");
            return;
        }
        const size = arenaSizeOf(challenge);
        const availableIds = new Set(combatEligiblePets.filter((pet) => !isPetOnExpedition(pet)).map((pet) => pet.id));
        if (!isExactAvailableArenaSelection(teamIds, availableIds, size)) {
            setArenaChallengeMsg(`This ${size}v${size} challenge needs exactly ${size} unique pets that are currently available. It was not started.`);
            return;
        }
        const myTeam = teamIds
            .map((id) => combatEligiblePets.find((pet) => pet.id === id && !isPetOnExpedition(pet)))
            .filter((pet): pet is Pet => Boolean(pet));
        if (new Set(myTeam.map((pet) => pet.id)).size !== size) {
            setArenaChallengeMsg(`This ${size}v${size} challenge needs ${size} of your available pets. It was not started.`);
            return;
        }
        const responderWarfrontSetup = sharedWarfrontSetup(wfStancePref, wfDoctrinePref, activeWfPlaybook.buyPolicy, activeWfAuthoredSetup);
        const acceptedChallenge: DuelChallenge = {
            ...challenge,
            accepted: true,
            fromName: character.name,
            toName: challenge.fromName,
            responderTeam: stripInlinePetImages(myTeam),
            responderWarfrontSetup,
        };
        const attempt = owner.begin("arena-respond", character.name);
        if (!attempt) return;
        writeArenaPvpRecovery({
            version: 1,
            challengeId: challenge.id,
            playerName: attempt.playerName,
            counterpartName: challenge.fromName,
            role: "responder",
            createdAt: Date.now(),
        });
        setArenaRecoveryRevision((revision) => revision + 1);
        setArenaResponding(true);
        setArenaChallengeMsg("Sealing both teams' Warfront plans...");
        try {
            const response = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: challenge.fromName, challenge: acceptedChallenge }),
                signal: attempt.controller.signal,
            });
            if (!owner.isCurrent(attempt)) return;
            const data = await response.json().catch(() => null) as { error?: string; challenge?: DuelChallenge } | null;
            if (!owner.isCurrent(attempt)) return;
            if (!response.ok) {
                throw new Error(data?.error ?? "The accepted match could not reach the challenger.");
            }
            const revealedChallenge = data?.challenge;
            if (!revealedChallenge
                || revealedChallenge.id !== challenge.id
                || !revealedChallenge.accepted
                || normalizePlayerIdentity(revealedChallenge.fromName) !== attempt.normalizedPlayerName
                || normalizePlayerIdentity(revealedChallenge.toName) !== normalizePlayerIdentity(challenge.fromName)
                || !revealedChallenge.challengerWarfrontSetup
                || !revealedChallenge.responderWarfrontSetup) {
                throw new Error("The server did not reveal both sealed Warfront plans. Nothing was started.");
            }
            const revealedRed = Array.isArray(revealedChallenge.responderTeam) ? revealedChallenge.responderTeam : [];
            const match = buildResponderArenaMatch(revealedChallenge, revealedRed);
            if (!match) throw new Error("The sealed Warfront payload was incomplete. Nothing was started.");
            clearArenaPvpRecovery(attempt.playerName, challenge.id);
            onArenaResponseHandled?.();
            startArenaMatch(match.blue, match.red, match.seed, {
                blueSetup: match.blueSetup,
                redSetup: match.redSetup,
                localTeam: "red",
            });
        } catch (error) {
            if (!owner.isCurrent(attempt)) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            setArenaChallengeMsg(error instanceof Error ? error.message : "The accepted match could not be delivered. Retry acceptance.");
        } finally {
            if (owner.finish(attempt)) setArenaResponding(false);
        }
    }

    async function declineArenaChallenge(challenge: DuelChallenge) {
        const owner = arenaRequestOwner.current!;
        if (owner.current("arena-respond")) return;
        if (normalizePlayerIdentity(challenge.toName) !== normalizedCharacterName) {
            setArenaChallengeMsg("This challenge belongs to a different player and was not declined.");
            return;
        }
        const attempt = owner.begin("arena-respond", character.name);
        if (!attempt) return;
        setArenaResponding(true);
        setArenaChallengeMsg("Authorizing the decline...");
        try {
            const response = await fetch("/api/player/challenge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    targetName: challenge.fromName,
                    challenge: {
                        ...challenge,
                        accepted: false,
                        declined: true,
                        fromName: attempt.playerName,
                        toName: challenge.fromName,
                    },
                }),
                signal: attempt.controller.signal,
            });
            if (!owner.isCurrent(attempt)) return;
            const data = await response.json().catch(() => null) as { error?: string } | null;
            if (!owner.isCurrent(attempt)) return;
            if (!response.ok) throw new Error(data?.error ?? "The decline could not be authorized.");
            // Only now may App DELETE the incoming row; the sealed terminal POST
            // needed its still-live authorization first.
            clearArenaPvpRecovery(attempt.playerName, challenge.id);
            setRespondPicks(normalizeArenaSelection([], arenaSizeOf(challenge)));
            onArenaResponseHandled?.();
        } catch (error) {
            if (!owner.isCurrent(attempt)) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            setArenaChallengeMsg(error instanceof Error ? error.message : "The decline could not be authorized. Retry while it remains open.");
        } finally {
            if (owner.finish(attempt)) setArenaResponding(false);
        }
    }

    const playerOpponentPets: PetArenaOpponent[] = playerRoster
        .filter((player) => player.name !== character.name)
        .flatMap((player) => publicEligiblePets(player).filter((pet) => !isPetOnExpedition(pet)).map((pet) => ({ owner: player.name, pet })));
    const playerOpponentQuery = opponentSearch.trim().toLowerCase();
    const filteredPlayerOpponentPets = playerOpponentQuery
        ? playerOpponentPets.filter((entry) => entry.owner.toLowerCase().includes(playerOpponentQuery))
        : playerOpponentPets;
    const opponentPets: PetArenaOpponent[] = opponentMode === "player" ? filteredPlayerOpponentPets : genericPetArenaOpponents;
    const [selectedOpponentKey, setSelectedOpponentKey] = useState("");
    const selectedPet = combatEligiblePets.find((pet) => pet.id === selectedPetId && !isPetOnExpedition(pet)) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));
    const selectedOpponent = opponentPets.find((entry) => `${entry.owner}:${entry.pet.id}` === selectedOpponentKey) ?? opponentPets[0];

    // The matchup cards are visible for several seconds before Fight begins.
    // Spend that idle time fetching/parsing the exact two GLBs so the live duel
    // opens on finished 3D combatants instead of its temporary sprite fallback.
    useEffect(() => {
        if (!selectedPet || !selectedOpponent?.pet) return;
        void preloadPetColiseumModels([selectedPet, selectedOpponent.pet]).catch(() => undefined);
    }, [selectedPet?.id, selectedPet?.evolutionStage, selectedPet?.rarity, selectedOpponent?.pet.id, selectedOpponent?.pet.evolutionStage, selectedOpponent?.pet.rarity]);

    const [battleReady, setBattleReady] = useState(false);
    const [battleOpponent, setBattleOpponent] = useState<PetArenaOpponent | null>(null);
    const [battleLog, setBattleLog] = useState<string[]>([]);
    // Holds the current continuous-duel timeline or live controller.
    const [duelBattle, setDuelBattle] = useState<{
        // Exactly one of `result` / `live` is set: a precomputed timeline to watch,
        // or a live player-controlled fight that reports its outcome via onOutcome.
        result: DuelResult | null; live?: LiveDuel | null; onOutcome?: (result: DuelResult) => void;
        playerPet: Pet; enemyPet: Pet;
        playerReservePet?: Pet; enemyReservePet?: Pet; seed: number;
        id: number; // per-fight nonce → React key so "Fight again" remounts the player
    } | null>(null);
    const [duelNonce, setDuelNonce] = useState(0); // monotonic per-fight id source (state, not ref → no render-time ref read)
    const [hollowGateSettlementStatus, setHollowGateSettlementStatus] = useState<"idle" | "pending" | "error" | "settled">("idle");
    const hollowGateSettlementRetryRef = useRef<(() => Promise<void>) | null>(null);
    const hollowGateSettlementInFlightRef = useRef(false);
    const hollowGateSettlementFinishedRef = useRef(false);
    // Fullscreen presentation is deliberately separate from App's unresolved
    // battle signal: the latter also controls presence, regen, and clan-war
    // launch behavior, while already-decided cinematic playback must not.
    const fullscreenBattleActive = arenaMatch !== null
        || arenaCountdown !== null
        || battleReady
        || duelBattle !== null;
    useEffect(() => {
        const unresolvedBattleActive = arenaMatch !== null
            || arenaCountdown !== null
            || Boolean(battleReady && battleOpponent?.hollowGate && hollowGateSettlementStatus !== "settled");
        onBattleActiveChange?.(unresolvedBattleActive);
        return () => onBattleActiveChange?.(false);
    }, [
        arenaMatch,
        arenaCountdown,
        battleReady,
        battleOpponent?.hollowGate,
        hollowGateSettlementStatus,
        onBattleActiveChange,
    ]);
    useEffect(() => {
        onFullscreenActiveChange?.(fullscreenBattleActive);
        return () => onFullscreenActiveChange?.(false);
    }, [fullscreenBattleActive, onFullscreenActiveChange]);
    useEffect(() => {
        if (!fullscreenBattleActive) return;
        document.body.classList.add("pet-combat-active");
        return () => document.body.classList.remove("pet-combat-active");
    }, [fullscreenBattleActive]);
    // Auto-scroll to the fight the moment a battle becomes ready — both sides
    // accept (1v1 or 2v2 / PvP) and the page glides down to the arena so they
    // can watch it play out without hunting for it. Covers every accept path
    // because all three setBattleReady(true) sites flip this same flag.
    const battlefieldRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!battleReady || !duelBattle) return;
        const t = window.setTimeout(() => {
            battlefieldRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80); // let the battlefield mount first
        return () => window.clearTimeout(t);
    }, [battleReady, duelBattle?.id]);

    useEffect(() => {
        if (opponentPets.length === 0) {
            if (selectedOpponentKey) setSelectedOpponentKey("");
            return;
        }
        const keyStillExists = opponentPets.some((entry) => `${entry.owner}:${entry.pet.id}` === selectedOpponentKey);
        if (!selectedOpponentKey || !keyStillExists) setSelectedOpponentKey(`${opponentPets[0].owner}:${opponentPets[0].pet.id}`);
    }, [selectedOpponentKey, opponentMode, opponentPets[0]?.owner, opponentPets[0]?.pet.id, opponentPets.length]);

    // Battle consumables are applied inside the sim from each pet's loadout
    // (kept deterministic), then spent here once the sim has run. Returns the
    // character.pets array with the given pets' consumable slots cleared.
    function clearConsumablePets(petIds: string[]) {
        return character.pets.map((p) => petIds.includes(p.id) && p.loadout?.consumable
            ? { ...p, loadout: { ...p.loadout, consumable: undefined } }
            : p);
    }

    async function mintCasualPetBattleToken(opponent: PetArenaOpponent, mode: "1v1" | "2v2", playerPets: Pet[], opponentPets: Pet[]): Promise<{ token: string; seed: number; reportKey: string } | null> {
        try {
            const r = await fetch("/api/pet/battle-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName: character.name,
                    opponentName: opponent.owner,
                    opponentLevel: opponent.pet.level,
                    mode,
                    playerPetIds: playerPets.map((pet) => pet.id),
                    opponentPetIds: opponentPets.map((pet) => pet.id),
                    hollowGate: opponent.hollowGate
                        ? { token: opponent.hollowGate.token, runId: opponent.hollowGate.runId }
                        : undefined,
                }),
            });
            if (!r.ok) return null;
            const data = await r.json().catch(() => null) as { token?: unknown; seed?: unknown; reportKey?: unknown } | null;
            return typeof data?.token === "string"
                && Number.isSafeInteger(Number(data.seed))
                && typeof data.reportKey === "string"
                ? { token: data.token, seed: Number(data.seed), reportKey: data.reportKey }
                : null;
        } catch {
            return null;
        }
    }

    async function settleHollowGatePetBattle(
        opponent: PetArenaOpponent,
        petBattleResult: { hollowGate?: boolean; outcome?: "win" | "loss" | "draw"; petReceipt?: string },
    ): Promise<boolean> {
        const gate = opponent.hollowGate;
        if (!gate) return false;
        if (!petBattleResult.hollowGate || !petBattleResult.petReceipt || !petBattleResult.outcome) {
            throw new Error("The Hollow Hound duel did not return a verified Gate receipt.");
        }
        const settled = await settleHollowGateCombat({
            playerName: character.name,
            token: gate.token,
            runId: gate.runId,
            petReceipt: petBattleResult.petReceipt,
        });
        if (settled.character) updateCharacter(settled.character);
        setBattleLog((prev) => [
            ...prev,
            settled.won
                ? "The Gate accepts the server-verified pet victory."
                : "The Gate rejects the Hound duel as a victory; 20% max HP recoil was applied once.",
        ]);
        onHollowGatePetBattleEnd?.(settled, opponent);
        return true;
    }

    async function startBattle(opponentOverride?: PetArenaOpponent) {
        setArenaView("battle"); // any duel (incl. challenge accepts) shows in the battle view
        primePetSfx(); // unlock the audio context inside the click gesture
        startBattleMusic(); // rotate to a fresh battle track
        if (!selectedPet) return alert("Choose one of your pets first.");
        if (isPetOnExpedition(selectedPet)) return alert(`${petDisplayName(selectedPet)} is exploring and cannot battle right now.`);
        const opponent = opponentOverride ?? selectedOpponent;
        if (!opponent) {
            return alert(opponentMode === "player"
                ? "No player pets found. Choose Fight AI or have another player with pets in the roster."
                : "No AI pets found.");
        }
        hollowGateSettlementRetryRef.current = null;
        hollowGateSettlementInFlightRef.current = false;
        hollowGateSettlementFinishedRef.current = false;
        setHollowGateSettlementStatus("idle");
        const pendingClanPetBattle = loadPendingClanPetBattle();
        if (isPetOnExpedition(opponent.pet)) return alert(`${petDisplayName(opponent.pet)} is exploring and cannot battle right now.`);
        // Also cover instant incoming challenges, which can bypass the ordinary
        // matchup-card dwell time used by the preload effect above.
        void preloadPetColiseumModels([selectedPet, opponent.pet]).catch(() => undefined);
        setDuelBattle(null); // fresh fight — clear any prior duel overlay
        const nextDuelId = duelNonce + 1; // React key for the duel renderer
        setDuelNonce(nextDuelId);

        // 2v2 party path — two entry points:
        //   • PvP party challenge: opponent already carries both parties (set
        //     when the accept handler fired runPetArenaParty's data through).
        //   • Local AI battle: in-component partyMode toggle, player picks
        //     reserve, AI gets a random second pet from the pool.
        const pvpParty = !!(opponent.opponentParty && opponent.challengerParty);
        const canAiParty = !opponent.hollowGate && partyMode && opponentMode === "ai" && combatEligiblePets.length >= 2;
        if (pvpParty || canAiParty) {
            let myLead: Pet;
            let myReserve: Pet;
            let enemyLead: Pet;
            let enemyReserve: Pet;
            if (pvpParty) {
                [myLead, myReserve] = opponent.challengerParty!;
                [enemyLead, enemyReserve] = opponent.opponentParty!;
            } else {
                const reserveCandidate = combatEligiblePets.find(p => p.id === reservePetId && p.id !== selectedPet.id)
                    ?? combatEligiblePets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0]
                    ?? null;
                if (!reserveCandidate) {
                    return alert("Need a reserve pet (a second pet not on expedition).");
                }
                // Player's order is locked (they chose lead + reserve).
                myLead = selectedPet;
                myReserve = reserveCandidate;
                enemyLead = opponent.pet;
                // AI reserve pick: try to pick a pet that scores best against
                // the player's RESERVE (since AI's reserve will face it in
                // match 2). The AI is forced to use the originally-selected
                // opponent as its LEAD (the player picked the lead matchup),
                // but it gets to pick its own counter-pick for the reserve
                // slot — same as the player picking strategically.
                const aiPool = genericPetArenaOpponents
                    .map(o => o.pet)
                    .filter(p => p.id !== opponent.pet.id);
                let enemyReserveCandidate: Pet = opponent.pet; // safe fallback
                if (aiPool.length > 0) {
                    let bestScore = -Infinity;
                    let bestPick: Pet = aiPool[0];
                    for (const candidate of aiPool) {
                        // Score the candidate against the player's reserve.
                        const score = scorePetMatchup(candidate, reserveCandidate);
                        if (score > bestScore) {
                            bestScore = score;
                            bestPick = candidate;
                        }
                    }
                    enemyReserveCandidate = bestPick;
                }
                enemyReserve = enemyReserveCandidate;
            }
            const battleSeal = await mintCasualPetBattleToken(opponent, "2v2", [myLead, myReserve], [enemyLead, enemyReserve]);
            const seed = battleSeal?.seed ?? opponent.battleSeed ?? Date.now();
            const reportKey = battleSeal?.reportKey ?? `unrewarded:${seed}:2v2`;
            // Spend any battle consumables on the pets that fought (2v2) — both engines.
            if ([myLead, myReserve].some((p) => p.loadout?.consumable)) {
                updateCharacter({ ...character, pets: clearConsumablePets([myLead.id, myReserve.id]) });
            }
            setBattleOpponent(opponent);
            setBattleReady(true);
            // 2v2 teamfight on the continuous engine (the old round engine is
            // retired). matchesWon (0/1) drives the per-win ryo report; PvE mastery
            // modifiers only vs AI; PvP/clan party fights get none.
            // plantedMotion (LAST arg) = the casual cinematic "planted face-off" motion, ON
            // for EVERY 2v2 here (PvE + clan-war party): all are client-resolved and the
            // server trusts the reported outcome (no pet-duel re-sim; clan-war just records
            // it), and plantedMotion is deterministic so both clients of a clan-war party
            // fight still agree. The PvE mastery mults stay pvpParty-gated (PvE only).
            // CINEMATIC engine (redesigned context-steering + role/element/stat/item AI)
            // when the flag is on; else the previous planted engine. Items ON in the
            // Cinematic engine everywhere now (uniform with ranked/ladder/sector) — equipped
            // gear/consumables matter (applyItems true). PvE mults stay pveOpp/pvpParty-gated.
            // PLAYER CONTROL: PvE teamfights run live and commanded; a clan-war /
            // PvP party fight stays precomputed so both clients derive the same fight.
            const partyControlled = !pvpParty && petPlayerControlEnabled();
            const partyDmgMult = pvpParty ? 1 : petTamerPveMultiplier(character);
            const partyHpMult = pvpParty ? 1 : petPveHpMult(character);
            const partyRevive = pvpParty ? false : petAlphaBond(character);
            const livePartyDuel = partyControlled
                ? createLivePartyDuel(myLead, myReserve, enemyLead, enemyReserve, seed, partyDmgMult, partyHpMult, partyRevive, true)
                : null;
            const duel = partyControlled
                ? null
                : runPetPartyDuelCinematic(myLead, myReserve, enemyLead, enemyReserve, seed, partyDmgMult, partyHpMult, partyRevive, true);
            const settleParty = (partyOutcome: "win" | "loss" | "draw") => {
                // Clan-war auto-report (pet 2v2): if this party battle was
                // launched from a clan-war pet2v2 challenge, post the outcome
                // to /api/clan/war/report so both clients converge on the
                // same result. autoReportClanWarBattleResult no-ops when no
                // clan-war stash is in sessionStorage AND the opponent name
                // doesn't match the challenge — safe for every party battle.
                if (onClanWarBattleEnd) {
                    onClanWarBattleEnd(partyOutcome === "draw" ? "draw" : partyOutcome === "win", opponent.owner);
                }
                // Award ryo once per match won — keeps the existing server cap
                // intact (each call is rate-limited and counts toward daily cap).
                // Pass battleSeed + match-index so the server can dedup a
                // refresh-replay (same seed → same reportKey → no double-claim).
                // The teamfight engine reports a single `${seed}:2v2` key (its own
                // keyspace) so it never collides with the old best-of-3 match keys.
                //
                // Tier-2 security fix made reportKey REQUIRED for wins. The
                // static genericPetArenaOpponents array doesn't have battleSeed,
                // and the roster-opponent constructor doesn't stamp one either.
                // Without a fallback, every AI-arena and roster-opponent win
                // was rejected with 400 (silent — wrapped in try/catch). Stamp
                // a click-stable fallback so honest wins still pay out. Refresh-
                // replay dedup is weakened for unseeded opponents, but the
                // server's 5s/12-per-min/100-per-day caps still bound damage.
                void (async () => {
                    try {
                        const battleToken = battleSeal?.token ?? null;
                        const r = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                playerName: character.name,
                                outcome: partyOutcome,
                                opponentLevel: opponent.pet.level,
                                reportKey,
                                battleToken,
                                inputLog: livePartyDuel?.inputLog(),
                            }),
                        });
                        if (r.ok) {
                            const data = await r.json() as { character?: Character };
                            if (data.character) updateCharacter(data.character);
                        }
                    } catch { /* the server save remains authoritative */ }
                })();
            };
            setDuelBattle({
                result: duel, live: livePartyDuel, onOutcome: (r) => settleParty(r.result),
                playerPet: myLead, enemyPet: enemyLead, playerReservePet: myReserve, enemyReservePet: enemyReserve,
                seed, id: nextDuelId,
            });
            setBattleLog([]);
            if (duel) settleParty(duel.result);
            return;
        }

        // Ranked pet settlement is deliberately fail-closed until the match is
        // challenge-bound and server-resolved. Never replay a stale pre-migration
        // invite locally: even a deterministic client duel is not rating authority.
        if (opponent.ranked) {
            setPetChallengeMsg("Ranked pet battles are temporarily unavailable until server-authoritative matchmaking returns.");
            if (pendingClanPetBattle) savePendingClanPetBattle(null);
            return;
        }

        const battleSeal1v1 = await mintCasualPetBattleToken(opponent, "1v1", [selectedPet], [opponent.pet]);
        const seed1v1 = battleSeal1v1?.seed ?? opponent.battleSeed ?? Date.now();
        const reportKey1v1 = battleSeal1v1?.reportKey ?? `unrewarded:${seed1v1}:1v1`;
        // Spend the battle consumable on the pet that fought.
        if (selectedPet.loadout?.consumable) {
            updateCharacter({ ...character, pets: clearConsumablePets([selectedPet.id]) });
        }
        setBattleOpponent(opponent);
        setBattleReady(true);
        // Resolve through the continuous engine. Outcome + clan-war report + ryo
        // all key off the same `outcome` value.
        // PvE mastery modifiers only vs a built-in AI opponent. Any real-player
        // 1v1 (non-ranked challenge / clan) gets none.
        const pveOpp = isGenericPetOpponent(opponent.pet);
        // Continuous duel engine (the old round engine is retired).
        // plantedMotion (LAST arg) = the casual cinematic planted face-off, ON for EVERY
        // non-ranked 1v1 here (AI, casual-vs-player, clan-war), and plantedMotion is
        // deterministic so a two-client clan/casual fight still agrees.
        // NOTE: "the server trusts the reported outcome" is NO LONGER true for the PvE
        // path — api/pet/battle-result.ts re-derives it by replaying this fight's input
        // log (plan §9.6). Casual-vs-player and clan-war 1v1 are still client-resolved.
        // Ranked (returns above) + the
        // Cinematic engine everywhere now (uniform with ranked/ladder/sector). PvE mastery
        // mults stay pveOpp-gated (only a built-in AI fight earns the bonus).
        //
        // PLAYER CONTROL (docs/pet-coliseum-player-control-plan.md): against a
        // built-in AI opponent the fight runs LIVE and the player commands it, so
        // the outcome is not known until they have actually played it. Everything
        // else — a casual-vs-player or clan-war 1v1, where BOTH clients must derive
        // the same fight from the seed — keeps the precomputed one-shot resolve.
        const controlled = pveOpp && petPlayerControlEnabled();
        const dmgMult = pveOpp ? petTamerPveMultiplier(character) : 1;
        const hpMult = pveOpp ? petPveHpMult(character) : 1;
        const revive = pveOpp ? petAlphaBond(character) : false;
        const liveDuel = controlled
            ? createLiveDuel(selectedPet, opponent.pet, seed1v1, dmgMult, hpMult, revive, true, undefined, null)
            : null;
        const duel = controlled
            ? null
            : runPetDuelCinematic(selectedPet, opponent.pet, seed1v1, dmgMult, hpMult, revive, true, undefined, null);
        const logs: string[] = [];
        // Settlement is identical either way; only WHEN it runs differs. A live duel
        // settles from PetColiseumDuel's onOutcome once the fight actually ends.
        const settle1v1 = (outcome: "win" | "loss" | "draw") => {
            // Clan-war auto-report (pet 1v1): mirrors the party path. Safe
            // for non-clan-war battles since the helper no-ops without a
            // sessionStorage stash + opponent-name match.
            if (onClanWarBattleEnd && !opponent.hollowGate) {
                onClanWarBattleEnd(outcome === "draw" ? "draw" : outcome === "win", opponent.owner);
            }
            if (opponent.hollowGate) {
                // A Hollow Gate pet result has two authoritative hops: replay the
                // deterministic duel on the pet endpoint, then redeem its receipt
                // against the sealed Gate encounter. Keep one idempotent retry
                // closure so a transient network failure never makes the player
                // replay the duel or abandon a valid victory.
                if (hollowGateSettlementFinishedRef.current || hollowGateSettlementRetryRef.current) return;
                const reportHollowGateResult = async () => {
                    if (hollowGateSettlementInFlightRef.current || hollowGateSettlementFinishedRef.current) return;
                    hollowGateSettlementInFlightRef.current = true;
                    setHollowGateSettlementStatus("pending");
                    try {
                        const battleToken = battleSeal1v1?.token ?? null;
                        if (!battleToken) throw new Error("The Hollow Hound battle seal could not be created.");
                        const response = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                playerName: character.name,
                                outcome,
                                opponentLevel: opponent.pet.level,
                                reportKey: reportKey1v1,
                                battleToken,
                                inputLog: liveDuel?.inputLog(),
                            }),
                        });
                        const data = await response.json().catch(() => null) as {
                            error?: string;
                            character?: Character;
                            hollowGate?: boolean;
                            outcome?: "win" | "loss" | "draw";
                            petReceipt?: string;
                        } | null;
                        if (!response.ok) throw new Error(data?.error || "The Hollow Hound result could not be verified.");
                        await settleHollowGatePetBattle(opponent, data ?? {});
                        hollowGateSettlementFinishedRef.current = true;
                        hollowGateSettlementRetryRef.current = null;
                        setHollowGateSettlementStatus("settled");
                    } catch (error) {
                        setHollowGateSettlementStatus("error");
                        setBattleLog((prev) => [
                            ...prev,
                            error instanceof Error
                                ? `Gate settlement paused: ${error.message}`
                                : "Gate settlement paused. Retry from the result screen.",
                        ]);
                    } finally {
                        hollowGateSettlementInFlightRef.current = false;
                    }
                };
                hollowGateSettlementRetryRef.current = reportHollowGateResult;
                void reportHollowGateResult();
                if (pendingClanPetBattle) savePendingClanPetBattle(null);
                return;
            }
            if (outcome === "win") {
                // Pet Arena rewards are server-validated: we POST the win and the
                // server applies ryo + increments totalPetWins / dailyPetWins
                // under a per-player lock + 5s rate-limit + daily cap. Client no
                // longer touches ryo or counters directly here.
                void (async () => {
                    try {
                        // reportKey: seed-based when we have a battleSeed (refresh-
                        // replay dedupes server-side). When the opponent has no
                        // battleSeed (the static genericPetArenaOpponents AI list,
                        // or any roster opponent lacking a stamp), fall back to a
                        // click-stable key so the server doesn't 400 — Tier-2
                        // security fix made reportKey REQUIRED for wins. The
                        // server's daily cap + rate limits still bound damage.
                        const battleToken = battleSeal1v1?.token ?? null;
                        const r = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                playerName: character.name,
                                outcome: "win",
                                opponentLevel: opponent.pet.level,
                                reportKey: reportKey1v1,
                                battleToken,
                                // The commands this player issued, stamped with the tick
                                // each landed on. The server replays the seeded sim with
                                // them and derives the outcome itself — `outcome` above is
                                // no longer what it pays from (plan §9.6). Undefined for a
                                // watch-only duel, which JSON.stringify simply omits.
                                inputLog: liveDuel?.inputLog(),
                            }),
                        });
                        if (r.ok) {
                            const data = await r.json() as { character?: Character; reward?: number; balances?: { ryo: number }; totalPetWins?: number; dailyPetWins?: number; capped?: boolean; hollowGate?: boolean; outcome?: "win" | "loss" | "draw"; petReceipt?: string };
                            // Functional updater: this write lands AFTER the await, so a
                            // concurrent regen/heartbeat setState could otherwise be
                            // clobbered. ryo is a RELATIVE credit read off `prev`; the
                            // server-authoritative totals fall back to a +1 off `prev`.
                            updateCharacter((prev) => prev ? ({
                                ...(data.character ?? prev),
                                ryo: data.balances?.ryo ?? prev.ryo,
                                totalPetWins: data.totalPetWins ?? prev.totalPetWins,
                                dailyPetWins: data.dailyPetWins ?? prev.dailyPetWins,
                                // Preserve the consumable-clear from before the battle —
                                // re-spreading the stale `character` would restore it.
                                pets: clearConsumablePets([selectedPet.id]),
                            }) : prev);
                            if (data.capped) {
                                setBattleLog([...logs, "Daily Pet Coliseum reward cap reached — wins still count, but no more ryo today."]);
                            }
                        } else {
                            updateCharacter((prev) => prev ? ({ ...prev, pets: clearConsumablePets([selectedPet.id]) }) : prev);
                        }
                    } catch {
                        // Network error: consume the battle item locally, but never mint
                        // wallet or leaderboard progress without the server receipt.
                        updateCharacter((prev) => prev ? ({ ...prev, pets: clearConsumablePets([selectedPet.id]) }) : prev);
                    }
                })();
                // Old point-based clan war pet-battle credit removed — the new
                // server-managed Clan War system handles pet battles via the
                // onClanWarBattleEnd auto-report path above. The pendingClanPetBattle
                // helper is still cleared below for backwards compatibility with
                // saves that have the legacy breadcrumb.
            } else {
                // Losses and draws must also redeem the server replay token so the
                // token cannot be reused and one-use pet consumables settle durably.
                void (async () => {
                    try {
                        const battleToken = battleSeal1v1?.token ?? null;
                        const r = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                playerName: character.name,
                                outcome,
                                opponentLevel: opponent.pet.level,
                                reportKey: reportKey1v1,
                                battleToken,
                                inputLog: liveDuel?.inputLog(),
                            }),
                        });
                        if (r.ok) {
                            const data = await r.json() as { character?: Character; hollowGate?: boolean; outcome?: "win" | "loss" | "draw"; petReceipt?: string };
                            if (data.character) updateCharacter(data.character);
                        }
                    } catch { /* no reward or state is minted without a server receipt */ }
                })();
                if (opponent.owner === "Hollow Gate" && !opponent.hollowGate) {
                // Pet duel lost inside the Hollow Gate Shrine — trainer takes
                // 20% maxHp damage as residual chakra burns through the seal.
                // Mirrors the Arena loss rule for non-boss Hollow Gate fights.
                // Player still returns to the shrine via the exit button's
                // returnScreen; not hospitalized, not run-ending.
                // Functional updater: a player-controlled duel settles up to a minute
                // after it started, so the captured `character` is long stale by now —
                // read maxHp off `prev` or a regen/heartbeat tick gets clobbered.
                updateCharacter((prev) => {
                    if (!prev) return prev;
                    const hit = Math.max(1, Math.floor(prev.maxHp * 0.20));
                    return { ...prev, hp: Math.max(1, prev.hp - hit), pets: clearConsumablePets([selectedPet.id]) };
                });
                // maxHp does not change mid-duel, so the captured value is safe for the
                // player-facing number even though the HP subtraction above is not.
                const shownDmg = Math.max(1, Math.floor(character.maxHp * 0.20));
                setBattleLog([...logs, `${character.name} took ${shownDmg} HP (20% of max) as the Hollow Hound's chakra recoiled through the seal.`]);
                }
            }
            if (pendingClanPetBattle) savePendingClanPetBattle(null);
        };
        setDuelBattle({
            result: duel, live: liveDuel, onOutcome: (r) => settle1v1(r.result),
            playerPet: selectedPet, enemyPet: opponent.pet, seed: seed1v1, id: nextDuelId,
        });
        setBattleLog([]);
        // Watch-only duels are already decided, so settle immediately as before.
        if (duel) settle1v1(duel.result);
    }

    useEffect(() => {
        if (!pendingPetBattleOpponent || !selectedPet) return;
        void startBattle(pendingPetBattleOpponent);
        onPendingPetBattleStarted?.();
    }, [pendingPetBattleOpponent?.owner, pendingPetBattleOpponent?.pet.id, pendingPetBattleOpponent?.battleSeed, selectedPet?.id]);

    // Challenger side: the responder accepted + picked → launch the same match
    // (both sides hold identical embedded teams + seed) behind the countdown.
    useEffect(() => {
        if (!pendingArenaMatch) return;
        if (!arenaMatchOwnedByPlayer(pendingArenaMatch, character.name)) {
            onPendingArenaMatchStarted?.();
            return;
        }
        const match = pendingArenaMatch.match;
        const size = match.size;
        const blueIds = new Set(match.blue.map((pet) => pet.id));
        const redIds = new Set(match.red.map((pet) => pet.id));
        if (blueIds.size !== size || redIds.size !== size || match.blue.length !== size || match.red.length !== size) {
            setArenaChallengeMsg(`This ${size}v${size} match was missing a full team and could not start.`);
            onPendingArenaMatchStarted?.();
            return;
        }
        startArenaMatch(match.blue, match.red, match.seed, {
            blueSetup: match.blueSetup,
            redSetup: match.redSetup,
            localTeam: match.localTeam,
        });
        onPendingArenaMatchStarted?.();
    }, [pendingArenaMatch?.challengeId, normalizedCharacterName]);

    // Responder side: an incoming arena challenge arrived → open the tactical
    // view's responder picker, pre-selecting my top pets at the challenge's size.
    useEffect(() => {
        if (pendingArenaResponse && !currentPendingArenaResponse) {
            arenaRequestOwner.current?.abort("arena-respond");
            setArenaResponding(false);
            setRespondPicks(normalizeArenaSelection([], 4));
            setRespondSlot(0);
            onArenaResponseHandled?.();
            return;
        }
        if (!currentPendingArenaResponse) return;
        const size = arenaSizeOf(currentPendingArenaResponse);
        setArenaView("tactical");
        setArenaChallengeMsg("");
        setRespondPicks(normalizeArenaSelection(pickArenaTeam(combatEligiblePets, size).map((pet) => pet.id), size));
        setRespondSlot(0);
    }, [currentPendingArenaResponse?.id, normalizedCharacterName]);

    useEffect(() => {
        if (pendingArenaRecovery && normalizePlayerIdentity(pendingArenaRecovery.playerName) !== normalizedCharacterName) {
            onPendingArenaRecoveryHandled?.();
        }
    }, [pendingArenaRecovery?.challengeId, normalizedCharacterName]);

    // The accepted notification normally arrives over realtime. If that packet
    // is lost, recover the same server-sealed payload by challenge id. The GET is
    // idempotent; consume the inbox notice before direct-starting so a later
    // realtime echo cannot mount the match twice.
    useEffect(() => {
        if (arenaCountdown || arenaMatch) {
            const active = readArenaPvpRecovery(character.name);
            if (active) clearArenaPvpRecovery(character.name, active.challengeId);
            if (pendingArenaRecovery) onPendingArenaRecoveryHandled?.();
            return;
        }
        let recovery = pendingArenaRecovery
            && normalizePlayerIdentity(pendingArenaRecovery.playerName) === normalizedCharacterName
            ? pendingArenaRecovery
            : readArenaPvpRecovery(character.name);
        if (recovery && recovery === pendingArenaRecovery) writeArenaPvpRecovery(recovery);
        if (!recovery) {
            const outgoing = duelChallenges.find((challenge) => challenge.arenaMatch === true
                && !challenge.accepted && !challenge.declined && !challenge.battleId
                && normalizePlayerIdentity(challenge.fromName) === normalizedCharacterName);
            if (outgoing) {
                recovery = {
                    version: 1,
                    challengeId: outgoing.id,
                    playerName: character.name,
                    counterpartName: outgoing.toName,
                    role: "challenger",
                    createdAt: outgoing.createdAt,
                };
                writeArenaPvpRecovery(recovery);
            }
        }
        if (!recovery) return;
        const recoveryRecord = recovery;
        const owner = arenaRequestOwner.current!;
        const attempt = owner.begin("arena-recovery", character.name);
        if (!attempt) return;
        let timer: number | null = null;
        let finished = false;
        const schedule = (delayMs: number) => {
            if (!owner.isCurrent(attempt) || finished) return;
            timer = window.setTimeout(() => { void poll(); }, Math.max(1_000, Math.min(12_000, delayMs)));
        };
        const stop = () => {
            finished = true;
            if (timer !== null) window.clearTimeout(timer);
            owner.finish(attempt);
        };
        const poll = async () => {
            if (!owner.isCurrent(attempt) || finished) return;
            try {
                const response = await fetch(`/api/player/challenge?challengeId=${encodeURIComponent(recoveryRecord.challengeId)}`, {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                    signal: attempt.controller.signal,
                });
                if (!owner.isCurrent(attempt)) return;
                const data = await response.json().catch(() => null) as { error?: string; code?: string; retryAfterMs?: number; challenge?: DuelChallenge } | null;
                if (!owner.isCurrent(attempt)) return;
                if (response.status === 409 && data?.code === "arena-match-not-accepted") {
                    schedule(typeof data.retryAfterMs === "number" ? data.retryAfterMs : 5_000);
                    return;
                }
                if (response.status === 404 && data?.code === "arena-match-recovery-missing") {
                    clearArenaPvpRecovery(attempt.playerName, recoveryRecord.challengeId);
                    setDuelChallenges((current) => current.filter((challenge) => challenge.id !== recoveryRecord.challengeId));
                    if (pendingArenaRecovery?.challengeId === recoveryRecord.challengeId) onPendingArenaRecoveryHandled?.();
                    setArenaChallengeMsg("That Arena challenge expired before it was accepted. Send a new challenge when both players are ready.");
                    stop();
                    return;
                }
                if (!response.ok) throw new Error(data?.error ?? "Accepted-match recovery is temporarily unavailable.");
                const recovered = data?.challenge;
                if (!recovered || !recoveredChallengeMatches(recoveryRecord, recovered)) {
                    throw new Error("The recovered Arena match did not match this player and challenge.");
                }
                const match = recoveryRecord.role === "challenger"
                    ? buildAcceptedArenaMatch(recovered)
                    : buildResponderArenaMatch(recovered, Array.isArray(recovered.responderTeam) ? recovered.responderTeam : []);
                if (!match) throw new Error("The recovered Arena match was incomplete and was not started.");
                const consume = await fetch("/api/player/challenge", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        targetName: attempt.playerName,
                        fromName: recoveryRecord.counterpartName,
                        challengeId: recovered.id,
                    }),
                    signal: attempt.controller.signal,
                });
                if (!owner.isCurrent(attempt)) return;
                if (!consume.ok) throw new Error("The recovered notice could not be consumed safely; retrying before the match starts.");
                clearArenaPvpRecovery(attempt.playerName, recoveryRecord.challengeId);
                setDuelChallenges((current) => current.filter((challenge) => challenge.id !== recoveryRecord.challengeId));
                if (pendingArenaRecovery?.challengeId === recoveryRecord.challengeId) onPendingArenaRecoveryHandled?.();
                if (recoveryRecord.role === "responder") onArenaResponseHandled?.();
                setArenaChallengeMsg("Accepted match recovered from the server. Starting the sealed replay...");
                startArenaMatch(match.blue, match.red, match.seed, {
                    blueSetup: match.blueSetup,
                    redSetup: match.redSetup,
                    localTeam: match.localTeam,
                });
                stop();
            } catch (error) {
                if (!owner.isCurrent(attempt) || finished) return;
                if (error instanceof DOMException && error.name === "AbortError") return;
                schedule(5_000);
            }
        };
        schedule(1_000);
        return () => {
            finished = true;
            if (timer !== null) window.clearTimeout(timer);
            owner.abort("arena-recovery");
        };
    }, [duelChallenges, normalizedCharacterName, arenaRecoveryRevision, arenaCountdown?.match.seed, arenaMatch?.seed, pendingArenaRecovery?.challengeId]);

    // Countdown pre-roll: tick 5→0, then mount the match (same seed → same fight).
    useEffect(() => {
        if (!arenaCountdown) return;
        if (arenaCountdown.secs <= 0) {
            setArenaMatch(arenaCountdown.match);
            setArenaCountdown(null);
            return;
        }
        const t = window.setTimeout(() => setArenaCountdown((c) => (c ? { ...c, secs: c.secs - 1 } : null)), 1000);
        return () => window.clearTimeout(t);
    }, [arenaCountdown]);

    const pendingClanPetBattle = loadPendingClanPetBattle();
    // Hollow Gate (and other forced duels) skip the view tabs — those land
    // straight in a battle and shouldn't expose the Tactical Arena switch.
    const isHollowGate = pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate";
    const availableArenaPetCount = availablePetBattleCount(combatEligiblePets);
    const tacticalArenaUnlocked = canEnterTacticalArena(combatEligiblePets);
    const retryHollowGateSettlement = () => {
        const retry = hollowGateSettlementRetryRef.current;
        if (retry) void retry();
    };
    const canLeaveCurrentPetBattle = () => {
        if (!isHollowGate || hollowGateSettlementFinishedRef.current) return true;
        if (hollowGateSettlementStatus === "error") {
            alert("The Gate has not recorded this duel yet. Use Retry Gate Settlement before leaving; your completed fight will not be replayed.");
        } else {
            alert("The Hollow Hound duel is still being sealed. You can leave as soon as the server confirms the result.");
        }
        return false;
    };
    const leaveCurrentPetBattle = () => {
        if (!canLeaveCurrentPetBattle()) return;
        const back = (pendingPetBattleOpponent?.returnScreen || battleOpponent?.returnScreen) ?? "centralHub";
        setBattleOpponent(null);
        setBattleReady(false);
        setDuelBattle(null);
        setScreen(back);
    };

    // Render one pet as a visual pick-card (portrait + role badge + level/element).
    // Shared by the cinematic battle view's pickers below — replaces the bare
    // <select> dropdowns so picking a pet is a tap on its art, not a text line.
    const petPickCard = (key: string, pet: Pet, sel: boolean, onClick: () => void, opts?: { owner?: string; dim?: boolean }) => {
        const img = petCardImage(pet, sharedImages);
        const { role } = pet.role && pet.subRole ? { role: pet.role } : derivePetRole(pet);
        const rm = ROLE_META[role];
        return (
            <button key={key} type="button"
                className={`pet-pick${sel ? " selected" : ""} ${petVisualVariantClass(pet)}`}
                title={opts?.owner ? `${opts.owner}: ${petDisplayName(pet)}` : petDisplayName(pet)}
                style={opts?.dim ? { opacity: 0.5 } : undefined}
                onClick={onClick}>
                {img
                    ? <img className="pet-pick-img" src={img} alt="" />
                    : <div className="pet-pick-img placeholder" />}
                <span className="pet-pick-name">{petDisplayName(pet)}</span>
                {rm && (
                    <span className="pet-pick-role" style={{ color: rm.color }}>
                        <img className="pet-pick-role-icon" src={ROLE_ICON[role]} alt="" aria-hidden="true" /> {rm.label}
                    </span>
                )}
                <span className="pet-pick-meta">{opts?.owner ? `${opts.owner} · ` : ""}Lv {pet.level}{pet.element && pet.element !== "None" ? <> · <ElIcon el={pet.element} size={13} />{pet.element}</> : ""}</span>
            </button>
        );
    };
    // Visual single-select picker grid (scrollable). Each entry carries an explicit
    // key so it works for own pets (key = id) and owner:pet opponents alike.
    const petPicker = (
        entries: { key: string; pet: Pet; owner?: string; dim?: boolean }[],
        selectedKey: string,
        onPick: (key: string) => void,
    ) => (
        <div className="pet-pick-grid pet-pick-strip">
            {entries.map(({ key, pet, owner, dim }) => petPickCard(key, pet, key === selectedKey, () => onPick(key), { owner, dim }))}
        </div>
    );

    return (
        <div className="card pet-arena-screen">
            <div className="pet-arena-header">
                {/* Back button label adapts to context — Hollow Gate pet
                    duels route back to the shrine, not the central hub. */}
                <button
                    className="back-btn"
                    onClick={leaveCurrentPetBattle}
                >
                    {(pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate")
                        ? "Back to Shrine"
                        : "Back to Central"}
                </button>
                <div>
                    {(pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate") ? (
                        <>
                            <h2 style={{ color: "var(--purple-500)" }}>⛩ Hollow Gate — Hollow Hound Duel</h2>
                            <p className="hint" style={{ color: "#c4b5fd" }}>Your pet faces a corrupted Hollow Hound. Win to claim victory and continue the run; lose to take 20% HP damage and return to the shrine.</p>
                        </>
                    ) : (
                        <>
                            <h2>{arenaView === "tactical" ? "Tactical Pet Arena" : arenaView === "gauntlet" ? "Pet Gauntlet" : "Pet Coliseum"}</h2>
                            <p className="hint">{
                                pendingClanPetBattle
                                    ? `Clan war pet battle pending against ${pendingClanPetBattle.opponentName}. Win to earn ${pendingClanPetBattle.points} clan points.`
                                    : arenaView === "tactical"
                                        ? "Big-map MOBA battles — win lanes, control the Hollow Gate, and break the rival Ward Seal."
                                        : arenaView === "gauntlet"
                                            ? "Roguelike run — draft a one-time squad, chase element & role synergies, and survive escalating rounds. Clear rounds to earn ryo and rare materials."
                                            : "Cinematic 1v1 & 2v2 duels — your pet approaches, kites, dodges, trades elemental strikes and unleashes ultimates on its own. You build the pet; it fights the duel."
                            }</p>
                        </>
                    )}
                </div>
            </div>

            {/* Top-level view tabs — the cinematic duel vs the Tactical Arena game
                mode. Hidden for forced duels (Hollow Gate) which land in battle. */}
            {!isHollowGate && (
                <div className="pet-arena-mode-toggle" style={{ maxWidth: 660, marginBottom: 14 }}>
                    <button type="button" className={arenaView === "battle" ? "active" : ""} onClick={() => setArenaView("battle")}>
                        ⚔️ Pet Coliseum
                    </button>
                    <button
                        type="button"
                        className={arenaView === "tactical" ? "active" : ""}
                        disabled={!tacticalArenaUnlocked}
                        title={!tacticalArenaUnlocked ? `Locked: ${availableArenaPetCount}/${TACTICAL_ARENA_PET_REQUIREMENT} available pets` : undefined}
                        onClick={() => setArenaView("tactical")}
                    >
                        🏟️ Tactical Pet Arena
                    </button>
                    {!tacticalArenaUnlocked && (
                        <span className="hint" style={{ alignSelf: "center", color: "var(--gold-2)", fontSize: "0.75rem" }}>
                            Locked: {availableArenaPetCount}/{TACTICAL_ARENA_PET_REQUIREMENT} pets
                        </span>
                    )}
                    <button type="button" className={arenaView === "gauntlet" ? "active" : ""} onClick={() => setArenaView("gauntlet")}>
                        🗡️ Pet Gauntlet
                    </button>
                </div>
            )}

            {/* The async "accept a pet challenge" banner is GONE with the sender that fed
                it: PvP pet duels are live-only now (plan §10), so an invite arrives over
                the realtime socket and is answered by PetDuelLiveHost. Keeping this half
                would leave a button that starts a precomputed PvP fight — exactly the
                thing live-only exists to prevent. */}

            {arenaView === "gauntlet" && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the Gauntlet…</div>}>
                    <PetGauntlet sharedImages={sharedImages} character={character} updateCharacter={updateCharacter} />
                </Suspense>
            )}

            {arenaView === "battle" && (
            <>
            {!isHollowGate && (
                <div className="pet-arena-hero" style={{ backgroundImage: `url(${DUEL_HERO_BY_ELEMENT[selectedPet?.element ?? ""] ?? petDuelHero})` }}>
                    <h3 className="hero-title">⚔️ Pet Coliseum</h3>
                    <p className="hero-sub">
                        Call the stance. Order the technique. Win the Clash. Every decision carries your pet through the arena.
                        {selectedPet?.element && selectedPet.element !== "None" ? ` Arena attuned to ${selectedPet.element}.` : ""}
                    </p>
                </div>
            )}
            <div className="pet-arena-grid">
                <section className="summary-box pet-arena-selector">
                    <h3>Your Pet</h3>
                    {combatEligiblePets.length === 0 ? (
                        <p className="hint">You need a pet before entering the arena.</p>
                    ) : (
                        <div className="pet-pick-panel">
                            {petPicker(
                                combatEligiblePets.map((pet) => ({ key: pet.id, pet, dim: isPetOnExpedition(pet) })),
                                selectedPetId,
                                setSelectedPetId,
                            )}
                        </div>
                    )}
                    {preservedPetOverflow > 0 && (
                        <p className="hint" style={{ color: "var(--gold-2)" }}>
                            {preservedPetOverflow} overflow · cannot fight. Base: 3 carried · Supporter: 5. See Sanctuary.
                        </p>
                    )}
                    {selectedPet && <PetArenaCard owner="You" pet={selectedPet} sharedImages={sharedImages} />}
                    {selectedPet && <MatchupHint element={selectedPet.element} />}
                </section>

                <section className="summary-box pet-arena-selector">
                    <h3>Opponent Pet</h3>
                    <div className="pet-arena-mode-toggle">
                        <button
                            type="button"
                            className={opponentMode === "player" ? "active" : ""}
                            onClick={() => {
                                setOpponentMode("player");
                                setBattleReady(false);
                                setBattleLog([]);
                                setDuelBattle(null);
                            }}
                        >
                            Fight Player
                        </button>
                        <button
                            type="button"
                            className={opponentMode === "ai" ? "active" : ""}
                            onClick={() => {
                                setOpponentMode("ai");
                                setBattleReady(false);
                                setBattleLog([]);
                                setDuelBattle(null);
                            }}
                        >
                            Fight AI
                        </button>
                    </div>
                    {opponentMode === "player" && (
                        <>
                            <label>Search Player Name</label>
                            <input value={opponentSearch} onChange={(e) => { setOpponentSearch(e.target.value); setPetChallengeMsg(""); }} placeholder="Search by player name" />
                        </>
                    )}
                    {opponentMode === "player" ? (
                        opponentSearch.trim() ? (
                            <div>
                                {(() => {
                                    const q = opponentSearch.trim().toLowerCase();
                                    const matches = allServerPlayers.filter(p => p.name.toLowerCase().includes(q));
                                    if (matches.length > 0) {
                                        return (
                                            <>
                                                {matches.map(p => (
                                                    <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                                                        <strong>{p.name}</strong>
                                                        <span className="hint">Lv {p.level} · {p.village || "Unknown"} · {p.online ? "🟢 Online" : "⚫ Offline"}</span>
                                                        <button onClick={() => sendDirectPetChallenge(p.name)}>⚔️ Challenge</button>
                                                    </div>
                                                ))}
                                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                                            </>
                                        );
                                    }
                                    return (
                                        <>
                                            <p className="hint">No account found for "{opponentSearch.trim()}".</p>
                                            <button onClick={() => sendDirectPetChallenge(opponentSearch.trim())}>⚔️ Challenge "{opponentSearch.trim()}"</button>
                                            {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                                        </>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div>
                                <p className="hint" style={{ marginTop: 4 }}>Type a player's name above to find and challenge them.</p>
                                <div className="pet-arena-tips">
                                    <div>⚔️ Win pet duels to earn ryo (daily cap).</div>
                                    <div>🐾🐾 Toggle 2v2 below to bring two pets into the challenge.</div>
                                    <div>🛡 Roles &amp; element edge decide close fights — check the matchup hint.</div>
                                </div>
                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                            </div>
                        )
                    ) : (
                        <>
                            {opponentPets.length > 0 ? (
                                <div className="pet-pick-panel">
                                    {petPicker(
                                        opponentPets.map((entry) => ({ key: `${entry.owner}:${entry.pet.id}`, pet: entry.pet, owner: entry.owner })),
                                        selectedOpponentKey,
                                        setSelectedOpponentKey,
                                    )}
                                </div>
                            ) : (
                                <p className="hint">No AI opponents available.</p>
                            )}
                            {selectedOpponent && <PetArenaCard owner={selectedOpponent.owner} pet={selectedOpponent.pet} sharedImages={sharedImages} />}
                            {selectedOpponent && <MatchupHint element={selectedOpponent.pet.element} />}
                        </>
                    )}
                </section>
            </div>

            {combatEligiblePets.length >= 2 && (
                <div className="summary-box" style={{ marginTop: "0.4rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                        <input type="checkbox" checked={partyMode} onChange={(e) => setPartyMode(e.target.checked)} />
                        <strong>🐾🐾 2v2 Party Battle</strong>
                        <span className="hint" style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
                            {opponentMode === "player"
                                ? "Challenges the target to a 2v2. They need 2 pets too — otherwise it falls back to 1v1."
                                : "Lead vs lead, then reserve vs reserve. Best of 2 wins the set."}
                        </span>
                    </label>
                    {partyMode && (
                        <div style={{ marginTop: "0.5rem" }}>
                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Reserve pet (faces their reserve in match 2)</label>
                            <div className="pet-pick-panel" style={{ marginTop: 6 }}>
                                <div className="pet-pick-grid">
                                    <button type="button"
                                        className={`pet-pick pet-pick-auto${reservePetId === "" ? " selected" : ""}`}
                                        onClick={() => setReservePetId("")}>
                                        <span className="pet-pick-auto-glyph">🎲</span>
                                        <span className="pet-pick-name">Auto-pick</span>
                                        <span className="pet-pick-meta">best counter</span>
                                    </button>
                                    {combatEligiblePets.filter((p) => p.id !== selectedPetId).map((pet) =>
                                        petPickCard(pet.id, pet, reservePetId === pet.id, () => setReservePetId(pet.id), { dim: isPetOnExpedition(pet) }),
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="menu pet-coliseum-entry">
                {opponentMode === "ai" && selectedPet && selectedOpponent ? (
                    <div className="pet-coliseum-fight-card">
                        <div className="pet-coliseum-contender player">
                            <span className="pet-coliseum-kicker">Your contender</span>
                            <strong>{petDisplayName(selectedPet)}</strong>
                            <span>Lv.{selectedPet.level} · {selectedPet.element ?? "Untyped"}</span>
                        </div>
                        <div className="pet-coliseum-versus">
                            <span>Exhibition</span>
                            <strong>VS</strong>
                            <small>{partyMode && combatEligiblePets.length >= 2 ? "2v2 set" : "1v1 duel"}</small>
                        </div>
                        <div className="pet-coliseum-contender enemy">
                            <span className="pet-coliseum-kicker">Arena challenger</span>
                            <strong>{petDisplayName(selectedOpponent.pet)}</strong>
                            <span>Lv.{selectedOpponent.pet.level} · {selectedOpponent.pet.element ?? "Untyped"}</span>
                        </div>
                        <button className="pet-coliseum-enter" onClick={() => void startBattle()}>
                            <span>{partyMode && combatEligiblePets.length >= 2 ? "Enter the 2v2 Set" : "Enter the Coliseum"}</span>
                            <small>Fight under your command</small>
                        </button>
                    </div>
                ) : opponentMode === "ai" ? (
                    <button onClick={() => void startBattle()} disabled>
                        Choose both contenders
                    </button>
                ) : null}
            </div>

            {/* Live PvP: the invite prompt, the "waiting to be accepted" notice and
                the fight itself all live here. Renders nothing when idle. */}
            <PetDuelLiveHost
                ref={liveDuelRef}
                myPets={[selectedPet, partyMode ? combatEligiblePets.find((p) => p.id === reservePetId) : null].filter((p): p is Pet => !!p)}
                onError={(message) => setPetChallengeMsg(`❌ ${message}`)}
                onOutcome={(outcome, opponent) => {
                    setPetChallengeMsg(outcome === "win" ? `✅ You beat ${opponent}!` : outcome === "draw" ? `Draw with ${opponent}.` : `${opponent} won that one.`);
                    // Clan-war pet battles still record through the existing helper;
                    // it no-ops when this fight was not part of one.
                    onClanWarBattleEnd?.(outcome === "draw" ? "draw" : outcome === "win", opponent);
                }}
                sharedImages={sharedImages}
            />

            {battleReady && duelBattle && selectedPet && (battleOpponent ?? selectedOpponent) && (
                <div ref={battlefieldRef} className="pet-arena-stage-wrap" style={{ scrollMarginTop: "12px" }}>
                    <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading tactical arena…</div>}>
                        <PetColiseumDuel
                            key={duelBattle.id}
                            playerPet={duelBattle.playerPet}
                            enemyPet={duelBattle.enemyPet}
                            playerReservePet={duelBattle.playerReservePet}
                            enemyReservePet={duelBattle.enemyReservePet}
                            seed={duelBattle.seed}
                            result={duelBattle.result ?? undefined}
                            live={duelBattle.live ?? undefined}
                            onOutcome={duelBattle.onOutcome}
                            sharedImages={sharedImages}
                            onFightAgain={battleOpponent?.hollowGate ? undefined : () => void startBattle(battleOpponent ?? undefined)}
                            settlementStatus={battleOpponent?.hollowGate ? hollowGateSettlementStatus : undefined}
                            onRetrySettlement={battleOpponent?.hollowGate ? retryHollowGateSettlement : undefined}
                            onExit={leaveCurrentPetBattle}
                        />
                    </Suspense>
                </div>
            )}

            <section className="summary-box pet-arena-log">
                <h3>Battle Log</h3>
                {battleLog.length === 0 ? <p className="hint">Start a match to watch the pets fight.</p> : battleLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </section>
            </>
            )}

            {/* ── Tactical Arena view ────────────────────────────────────────
                One screen: a team-size toggle + a team grid, then Fight AI /
                Challenge a Player / Co-op. An INCOMING challenge swaps in a
                responder picker. The match plays via the arenaMatch overlay
                below (after the countdown). */}
            {arenaView === "tactical" && (
                <section className="summary-box" style={{ marginTop: "0.2rem", display: "grid", gap: "0.9rem" }}>
                    <div className="pet-arena-hero" style={{ backgroundImage: `url(${tacticalArenaHero})`, marginBottom: 0 }}>
                        <h3 className="hero-title">⛩ Hollow Warfront</h3>
                        <p className="hero-sub">
                            A lane war on a huge 3D battlefield: hollow-spawn pour from the central Hollow Gate breach, two Guardian Totems ward each village outpost, and shattering the enemy WARD SEAL wins. Every kill pays bounty coins — spend them at the 90-second War Council, where you can also switch your team's formation. Ten minutes; Ward Seal or Judgment. AI power adapts to the squad you lock, and the server reveals the exact band and reward before kickoff.
                        </p>
                    </div>

                    {(() => {
                        const available = combatEligiblePets.filter((p) => !isPetOnExpedition(p));
                        // Slot-aware pet picker. A lane is selected first; choosing a
                        // pet assigns it there, and choosing one from another lane
                        // swaps the two rather than shifting every later deployment.
                        // Each slot is a roomy card: a large portrait, the pet's name,
                        // its native combat role badge (so the player can build a
                        // balanced comp at a glance), and a level/element line. The
                        // order badge in the corner shows battle order when picked.
                        const pickGrid = (
                            picks: string[],
                            setPicks: React.Dispatch<React.SetStateAction<string[]>>,
                            max: number,
                            activeSlot: number,
                            setActiveSlot: (slot: number) => void,
                        ) => (
                            <div className="pet-pick-grid">
                                {available.map((pet) => {
                                    const sel = picks.includes(pet.id);
                                    const order = picks.indexOf(pet.id);
                                    const img = petCardImage(pet, sharedImages);
                                    const { role, subRole } = pet.role && pet.subRole ? { role: pet.role, subRole: pet.subRole } : derivePetRole(pet);
                                 const rm = ROLE_META[role];
                                 const deployment = order >= 0 ? WARFRONT_DEPLOYMENT_SLOTS[order] : null;
                                 const target = WARFRONT_DEPLOYMENT_SLOTS[activeSlot];
                                 return (
                                     <button key={pet.id} type="button"
                                         aria-pressed={sel}
                                         aria-label={`${petDisplayName(pet)}, ${rm?.label ?? role}${deployment ? `, assigned ${deployment.label}` : ""}. ${sel && order === activeSlot ? `Press to clear ${target.label}.` : `Press to assign ${target.label}${sel ? ` and swap with ${deployment?.label}` : ""}.`}`}
                                         className={`pet-pick${sel ? " selected" : ""} ${petVisualVariantClass(pet)}`}
                                         title={rm ? `${petDisplayName(pet)} — ${rm.label} (${subRole})` : petDisplayName(pet)}
                                         onClick={() => {
                                             const next = sel && order === activeSlot
                                                 ? clearArenaSelectionSlot(picks, activeSlot, max)
                                                 : assignArenaSelectionSlot(picks, activeSlot, pet.id, max);
                                             setPicks(next);
                                             setActiveSlot(nextOpenArenaSlot(next, activeSlot));
                                         }}>
                                         {deployment && <span className="pet-pick-order" title={`${deployment.label} deployment slot`}>{deployment.mark}</span>}
                                            {img
                                                ? <img className="pet-pick-img" src={img} alt="" />
                                                : <div className="pet-pick-img placeholder" />}
                                            <span className="pet-pick-name">{petDisplayName(pet)}</span>
                                            {rm && (
                                                <span className="pet-pick-role" style={{ color: rm.color }}>
                                                    <img className="pet-pick-role-icon" src={ROLE_ICON[role]} alt="" aria-hidden="true" /> {rm.label}
                                                </span>
                                            )}
                                            <span className="pet-pick-meta">Lv {pet.level}{pet.element && pet.element !== "None" ? <> · <ElIcon el={pet.element} size={13} />{pet.element}</> : ""}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        );

                        // ── Incoming challenge → pick my team, then accept ──────
                        if (currentPendingArenaResponse) {
                            const size = arenaSizeOf(currentPendingArenaResponse);
                            const responseAvailableIds = new Set(available.map((pet) => pet.id));
                            const responseReady = isExactAvailableArenaSelection(respondPicks, responseAvailableIds, size);
                            return (
                                <div style={{ display: "grid", gap: "0.6rem" }}>
                                    <strong>⚔️ {currentPendingArenaResponse.fromName} challenged you to a {size === 4 ? "4v4" : "2v2"}!</strong>
                                    <p className="hint" style={{ margin: 0 }}>Pick up to {size} pets and lock your plan. Your rival's plan is held by the server; both reveal only after you accept.</p>
                                    <div className="summary-box" style={{ display: "grid", gap: "0.55rem" }}>
                                        <strong>Seal your opening plan</strong>
                                        <WarfrontChoiceButtons label="Opening formation" items={WF_STANCES} value={wfStancePref} onSelect={setWfStance} disabled={arenaResponding} />
                                        <WarfrontChoiceButtons label="Team doctrine" items={WF_DOCTRINES} value={wfDoctrinePref} onSelect={setWfDoctrine} disabled={arenaResponding} />
                                        <WarfrontChoiceButtons label="Automatic Council playbook" items={WARFRONT_PLAYBOOKS} value={wfPlaybookPref} onSelect={setWfPlaybook} disabled={arenaResponding} />
                                        <p className="hint" style={{ margin: 0 }}>{activeWfPlaybook.summary} {activeWfPlaybook.tradeoff}</p>
                                        <p className="hint" style={{ margin: 0 }}>These choices are sealed into the shared replay, so both clients simulate the same battle.</p>
                                    </div>
                                    <div className="wf-deployment" role="group" aria-label="Response deployment slots">
                                        {WARFRONT_DEPLOYMENT_SLOTS.slice(0, size).map((slot, index) => {
                                            const pet = available.find((item) => item.id === respondPicks[index]);
                                            return (
                                                <button type="button" key={slot.id} aria-pressed={respondSlot === index}
                                                    className={`wf-deployment-card${pet ? " filled" : ""}${respondSlot === index ? " active" : ""}`}
                                                    onClick={() => setRespondSlot(index)}>
                                                    <span className="wf-lane-name">{slot.label}</span>
                                                    <strong className="wf-slot-pet">{pet ? petDisplayName(pet) : "Open slot"}</strong>
                                                    <span className="wf-slot-forecast">Select this lane, then choose a pet below.</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {available.length < size
                                        ? <p className="hint" style={{ color: "var(--gold-2)" }}>You need {size} available carried pets to accept this {size}v{size} challenge. You currently have {available.length}.</p>
                                        : <div className="pet-pick-panel">{pickGrid(respondPicks, setRespondPicks, size, respondSlot, setRespondSlot)}</div>}
                                    <div className="menu">
                                        <button disabled={arenaResponding || !responseReady} style={{ background: "#16a34a" }}
                                            onClick={() => { primeWarfrontAudio(); void respondToArenaChallenge(currentPendingArenaResponse, respondPicks); }}>
                                            {arenaResponding ? "Sealing Match..." : `Accept & Start (${arenaSelectionCount(respondPicks)}/${size})`}
                                        </button>
                                        <button className="danger-button" disabled={arenaResponding}
                                            onClick={() => { void declineArenaChallenge(currentPendingArenaResponse); }}>Decline</button>
                                    </div>
                                    {arenaChallengeMsg && <p role="status" className="hint" style={{ margin: 0, color: "var(--gold-2)" }}>{arenaChallengeMsg}</p>}
                                </div>
                            );
                        }

                        // ── Single screen: council preference + team grid + actions ───
                        // Warfront is always 4v4.
                        const availableIds = new Set(available.map((pet) => pet.id));
                        const canStart = isExactAvailableArenaSelection(tacticalPicks, availableIds, tacticalSize);
                        const selectedTacticalPets = tacticalPicks
                            .map((id) => available.find((pet) => pet.id === id))
                            .filter((pet): pet is Pet => Boolean(pet));
                        const warmSelectedWarfront = () => preloadWarfrontExperience(selectedTacticalPets);
                        const pickedRoles = new Set(tacticalPicks.map((id) => {
                            const pet = available.find((item) => item.id === id);
                            return pet ? (pet.role ?? derivePetRole(pet).role) as PetRole : null;
                        }).filter((role): role is PetRole => role !== null));
                        const selectedStance = WF_STANCES.find((item) => item.id === wfStancePref) ?? WF_STANCES[0];
                        const selectedDoctrine = WF_DOCTRINES.find((item) => item.id === wfDoctrinePref) ?? WF_DOCTRINES[0];
                        const scoutedDoctrines = (preparedWarfrontContract?.scoutedDoctrineOptions ?? [])
                            .map((id) => WF_DOCTRINES.find((item) => item.id === id))
                            .filter((item): item is (typeof WF_DOCTRINES)[number] => !!item);
                        const doctrineForecast = scoutedDoctrines.map((enemy) => {
                            const isCounter = WARFRONT_DOCTRINE_COUNTER[enemy.id] === wfDoctrinePref;
                            const isMirror = enemy.id === wfDoctrinePref;
                            const neutral = wfDoctrinePref === "none" || wfDoctrinePref === "warden-pact";
                            return `${enemy.icon} ${enemy.label}: ${neutral ? "neutral opening" : isMirror ? "mirror — no edge" : isCounter ? "you seize the edge" : "they seize the edge"}`;
                        });
                        return (
                             <div className="wf-setup">
                                 <style>{`.wf-setup{display:grid;gap:.7rem}.wf-scout{border-color:#a16207!important;background:linear-gradient(135deg,#78350f52,#0f172aeb)!important}.wf-scout>strong{color:#fde68a}.wf-scout-style{margin-top:4px;color:#e2e8f0;font-size:.86rem}.wf-scout .hint{margin:.3rem 0 0}.wf-doctrine-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}.wf-doctrine-chips span{padding:4px 8px;border-radius:999px;border:1px solid #fbbf2473;background:#78350f3d;color:#fef3c7;font-weight:800}.wf-scout-forecast{margin-top:7px;color:#bae6fd;font-weight:700}.wf-prepare-state{margin-top:6px;font-size:.8rem}.wf-prepare-state.ready{color:#86efac}.wf-prepare-state.waiting{color:#fca5a5}.wf-scout button{margin-top:8px;background:#0e7490}.wf-setup-controls{display:grid;gap:.7rem;align-content:start}.wf-setup-label{font-weight:600;font-size:.85rem}.wf-control-mode{max-width:470px!important;margin-top:6px}.wf-setup-note{margin:4px 0 0}.wf-setup-note.coach{color:#fde68a}.wf-playbooks,.wf-deployment{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px;margin-top:6px}.wf-playbook{min-height:112px;display:grid;align-content:start;gap:4px;padding:9px 10px;border-radius:10px;border:1px solid #475569;background:#0f172ab8;color:#f8fafc;text-align:left}.wf-playbook[aria-checked=true]{border-color:#67e8f9;background:#0e74903d;box-shadow:0 0 0 2px #67e8f91f}.wf-playbook-summary{color:#e2e8f0;font-size:12px}.wf-playbook-tradeoff{color:#fcd34d;font-size:11px}.wf-playbook-warning{color:#fca5a5;font-size:11px;font-weight:800}.wf-forecast{margin:5px 0 0;padding:6px 8px;border-left:2px solid #38bdf8;color:#dbeafe}.wf-forecast.doctrine{border-color:#a78bfa;color:#ede9fe}.wf-forecast.playbook{padding:0;border:0;color:#cffafe}.wf-deployment{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:7px}.wf-deployment-card{min-height:86px;display:grid;align-content:start;gap:2px;padding:8px 9px;border-radius:9px;border:1px solid #475569a6;background:#0f172a80}.wf-deployment-card.filled{border-color:#38bdf8a6;background:#0e749029}.wf-lane-name{color:#7dd3fc;font-weight:900;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.wf-slot-pet{color:#64748b;font-size:14px}.wf-deployment-card.filled .wf-slot-pet{color:#f8fafc}.wf-slot-role{font-size:12px;font-weight:700}.wf-slot-forecast{color:#94a3b8;font-size:11px;line-height:1.25}.wf-pick-panel{margin-top:6px}.wf-action-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem}.wf-action-card{display:grid!important;gap:.5rem;align-content:start}.wf-reward-toast{position:fixed;z-index:1000002;right:14px;bottom:14px;width:min(420px,calc(100vw - 28px));display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #38bdf8;border-radius:12px;background:#030712f5;box-shadow:0 14px 40px #0009;color:#f8fafc}.wf-reward-toast.error{border-color:#ef4444}.wf-reward-toast.settled{border-color:#22c55e}.wf-reward-copy{flex:1}.wf-reward-copy div{margin-top:3px;color:#cbd5e1;font-size:.9rem;line-height:1.35}.wf-reward-toast button{flex-shrink:0}`}</style>
                                 <div role="status" aria-live="polite" className="summary-box wf-scout">
                                     <strong>Next AI warband: {preparedWarfrontContract?.scoutedWarband.name ?? "Contacting the server..."}</strong>
                                     {preparedWarfrontContract?.scoutedWarband && <div className="wf-scout-style">{preparedWarfrontContract.scoutedWarband.style}</div>}
                                     <p className="hint">
                                         Intelligence narrows their locked doctrine to two possibilities. Choose a tradeoff; the exact declaration reveals only after both plans are committed.
                                         Their power band adapts to the four pets in your locked deployment; exact squad and opponent power reveal in the server authorization before kickoff.
                                     </p>
                                     {scoutedDoctrines.length === 2 && (
                                         <div className="wf-doctrine-chips" aria-label="Possible enemy doctrines">
                                             {scoutedDoctrines.map((doctrine) => <span key={doctrine.id}>{doctrine.icon} {doctrine.label}</span>)}
                                         </div>
                                     )}
                                     {doctrineForecast.length > 0 && <div className="wf-scout-forecast">{selectedDoctrine.icon} {selectedDoctrine.label} forecast · {doctrineForecast.join(" · ")}</div>}
                                     <div className={`wf-prepare-state ${preparedWarfrontContract ? "ready" : "waiting"}`}>{warfrontPrepareMessage}</div>
                                    {!preparedWarfrontContract && <button type="button" disabled={warfrontPreparing} onClick={() => void requestPreparedWarfrontContract()}>{warfrontPreparing ? "Scouting..." : "Retry scouting"}</button>}
                                 </div>
                                 <div className="pet-arena-tactical-top">
                                     <div className="wf-setup-controls">
                                        <div>
                                             <label className="wf-setup-label">📯 Control mode</label>
                                             <div role="group" aria-label="Warfront control mode" className="pet-arena-mode-toggle wf-control-mode">
                                                <button type="button" aria-pressed={wfAutoPref === "off"} className={wfAutoPref === "off" ? "active" : ""} onClick={() => setWfAuto("off")}>🧠 Coach Mode</button>
                                                <button type="button" aria-pressed={wfAutoPref !== "off"} className={wfAutoPref !== "off" ? "active" : ""} onClick={() => setWfAuto(activeWfPlaybook.buyPolicy)}>📺 Watch / Auto</button>
                                            </div>
                                             <p role="note" aria-live="polite" className={`hint wf-setup-note${wfAutoPref === "off" ? " coach" : ""}`}>
                                                {wfAutoPref === "off"
                                                    ? <><strong>Coach Mode pays a fixed completion reward.</strong> You issue decisions every 90s. Win, loss, and draw pay the same server-sealed base ryo for up to 3 paid completions per UTC day; the exact amount appears after your squad locks. It never adds first-win bonuses or win progress, and forfeits do not count.</>
                                                    : <><strong>Watch / Auto is victory-reward eligible.</strong> Your selected playbook repeats at each Council; the server seals its decisions and outcome. PvP and co-op also use sealed Auto playback.</>}
                                            </p>
                                        </div>

                                        <div>
                                             <label className="wf-setup-label">🧭 Opening playbook</label>
                                             <div className="wf-playbooks" role="radiogroup" aria-label="Opening playbook">
                                                {WARFRONT_PLAYBOOKS.map((playbook) => {
                                                    const selected = playbook.id === wfPlaybookPref;
                                                    const missingRoles = playbook.requiredRoles.filter((role) => !pickedRoles.has(role));
                                                    return (
                                                         <button className="wf-playbook" key={playbook.id} type="button" role="radio" aria-checked={selected} onClick={() => setWfPlaybook(playbook.id)}>
                                                             <strong>{playbook.icon} {playbook.label}</strong>
                                                             <span className="wf-playbook-summary">{playbook.summary}</span>
                                                             <span className="wf-playbook-tradeoff">{playbook.tradeoff}</span>
                                                             {selected && missingRoles.length > 0 && <span className="wf-playbook-warning" role="note">⚠ Needs {missingRoles.map((role) => ROLE_META[role].label).join(" + ")}; part of this playbook cannot trigger.</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                             <p role="status" aria-live="polite" className="hint wf-forecast playbook"><strong>{activeWfPlaybook.label} forecast:</strong> {activeWfPlaybook.summary} {wfAutoPref === "off" ? "This seeds your first Coach Council; you can adapt later." : "Auto repeats its Coach Order at each real Council."}</p>
                                        </div>

                                        <div>
                                             <label className="wf-setup-label">📜 Opening formation</label>
                                             <WarfrontChoiceButtons label="Opening formation" items={WF_STANCES} value={wfStancePref} onSelect={setWfStance} />
                                             <p role="status" aria-live="polite" className="hint wf-forecast">
                                                 <strong>{selectedStance.icon} {selectedStance.label} forecast:</strong> {selectedStance.desc}
                                             </p>
                                        </div>

                                        <div>
                                             <label className="wf-setup-label">🎖 Team doctrine</label>
                                             <WarfrontChoiceButtons label="Team doctrine" items={WF_DOCTRINES} value={wfDoctrinePref} onSelect={setWfDoctrine} />
                                             <p role="status" aria-live="polite" className="hint wf-forecast doctrine">
                                                 <strong>{selectedDoctrine.icon} {selectedDoctrine.label} forecast:</strong> {selectedDoctrine.desc} Vanguard beats Zealot, Zealot beats Bulwark, and Bulwark beats Vanguard.
                                             </p>
                                         </div>

                                         <div>
                                             <label className="wf-setup-label">Opening deployment ({arenaSelectionCount(tacticalPicks)}/{tacticalSize}) — select a named lane, then assign or swap its pet</label>
                                             <div className="wf-deployment" role="group" aria-label="Opening deployment slots">
                                                 {WARFRONT_DEPLOYMENT_SLOTS.map((slot, index) => {
                                                     const pet = available.find((item) => item.id === tacticalPicks[index]);
                                                     const role = pet ? (pet.role ?? derivePetRole(pet).role) as PetRole : null;
                                                     const roleMeta = role ? ROLE_META[role] : null;
                                                     return (
                                                         <button type="button" className={`wf-deployment-card${pet ? " filled" : ""}${tacticalSlot === index ? " active" : ""}`} key={slot.id}
                                                             aria-pressed={tacticalSlot === index}
                                                             aria-label={`${slot.label}: ${pet ? petDisplayName(pet) : "open"}. Select this lane to assign or swap its pet.`}
                                                             onClick={() => setTacticalSlot(index)}>
                                                             <span className="wf-lane-name">{slot.label}</span>
                                                             <strong className="wf-slot-pet">{pet ? petDisplayName(pet) : "Open slot"}</strong>
                                                             <span className="wf-slot-role" style={{ color: roleMeta?.color ?? "#94a3b8" }}>{roleMeta?.label ?? "Pick a pet below"}</span>
                                                             <span className="wf-slot-forecast">{slot.forecast}</span>
                                                         </button>
                                                     );
                                                 })}
                                             </div>
                                             <div className="wf-pick-panel">
                                                 {available.length < tacticalSize
                                                     ? <p className="hint" style={{ color: "var(--gold-2)", margin: 0 }}>This 4v4 mode requires {tacticalSize} available carried pets. You currently have {available.length}; pets on expeditions do not count.</p>
                                                    : <div className="pet-pick-panel">{pickGrid(tacticalPicks, setTacticalPicks, tacticalSize, tacticalSlot, setTacticalSlot)}</div>}
                                            </div>
                                        </div>
                                    </div>

                                    <BattlePlan pets={selectedTacticalPets} size={tacticalSize} />
                                </div>

                                 <div className="wf-action-grid">
                                     <div className="summary-box wf-action-card">
                                        <strong>🤖 Fight AI</strong>
                                        <button disabled={!canStart || !preparedWarfrontContract || warfrontPreparing || warfrontRewardState.phase === "minting" || warfrontRewardState.phase === "settling" || warfrontRewardState.retry !== null} style={{ background: "#0e7490" }}
                                            onPointerEnter={warmSelectedWarfront} onFocus={warmSelectedWarfront}
                                            onClick={() => {
                                                primeWarfrontAudio();
                                                // Tuple order is gameplay: Top, Mid, Bottom, then Flex.
                                                // Never rebuild this roster with `filter`, which silently
                                                // reverts to collection order and changes the opening lanes.
                                                const mine = tacticalPicks
                                                    .map((id) => available.find((pet) => pet.id === id))
                                                    .filter((pet): pet is Pet => !!pet);
                                                if (!mine.length) return;
                                                if (preparedWarfrontContract) void startAuthorizedAiWarfront(mine, preparedWarfrontContract);
                                            }}>
                                            {warfrontRewardState.phase === "minting" ? "Authorizing..." : "Start vs AI"}
                                        </button>
                                    </div>

                                     <div className="summary-box wf-action-card">
                                        <strong>⚔️ Challenge a Player</strong>
                                        <input
                                            value={arenaChallengeName}
                                            onChange={(e) => { setArenaChallengeName(e.target.value); setArenaChallengeMsg(""); }}
                                            placeholder="Player name"
                                            onKeyDown={(e) => { if (e.key === "Enter" && canStart && !arenaSending && arenaChallengeName.trim()) { primeWarfrontAudio(); void sendArenaChallenge(arenaChallengeName, tacticalSize, tacticalPicks); } }}
                                        />
                                        <button disabled={!canStart || !arenaChallengeName.trim() || arenaSending} style={{ background: "#b45309" }}
                                            onPointerEnter={warmSelectedWarfront} onFocus={warmSelectedWarfront}
                                            onClick={() => { primeWarfrontAudio(); void sendArenaChallenge(arenaChallengeName, tacticalSize, tacticalPicks); }}>
                                            {arenaSending ? "Sending..." : "Send Challenge"}
                                        </button>
                                        {arenaChallengeMsg && <p className="hint" style={{ margin: 0, color: arenaChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)" }}>{arenaChallengeMsg}</p>}
                                    </div>

                                     <div className="summary-box wf-action-card">
                                        <strong>🤝 Co-op with Friends</strong>
                                        <button style={{ background: "#6d28d9" }} onPointerEnter={warmSelectedWarfront} onFocus={warmSelectedWarfront}
                                            onClick={() => { primeWarfrontAudio(); setShowCoop(true); }}>Open Co-op Lobby</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </section>
            )}

            {/* Full-screen game-mode overlays — launched from the Tactical Arena
                view; rendered here so they sit above whichever view is active. */}
            {arenaMatch && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the Warfront…</div>}>
                    <PetWarfrontMatch
                        blue={arenaMatch.blue} red={arenaMatch.red} seed={arenaMatch.seed}
                        theme={wfThemeForVillage(character.village)}
                        autoBuy={arenaMatch.blueSetup.buyPolicy}
                        opponentAutoBuy={arenaMatch.redSetup?.buyPolicy}
                        stance={arenaMatch.blueSetup.stance}
                        doctrine={arenaMatch.blueSetup.doctrine}
                        opponentStance={arenaMatch.redSetup?.stance}
                        opponentDoctrine={arenaMatch.redSetup?.doctrine}
                        deployment={arenaMatch.blueSetup.deployment}
                        buildPackage={arenaMatch.blueSetup.buildPackage}
                        coachOrder={arenaMatch.blueSetup.coachOrder}
                        objectiveTechnique={arenaMatch.blueSetup.objectiveTechnique}
                        counterstrike={arenaMatch.blueSetup.counterstrike}
                        opponentDeployment={arenaMatch.redSetup?.deployment}
                        opponentBuildPackage={arenaMatch.redSetup?.buildPackage}
                        opponentCoachOrder={arenaMatch.redSetup?.coachOrder}
                        opponentObjectiveTechnique={arenaMatch.redSetup?.objectiveTechnique}
                        opponentCounterstrike={arenaMatch.redSetup?.counterstrike}
                        localTeam={arenaMatch.localTeam}
                        committedChoices={arenaMatch.committedChoices}
                        onCouncilCommit={arenaMatch.vsAi && arenaMatch.blueSetup.buyPolicy === "off"
                            ? (round, decision) => commitAuthorizedWarfrontCouncil(arenaMatch, round, decision)
                            : undefined}
                        onForfeit={arenaMatch.vsAi ? () => forfeitAuthorizedWarfront(arenaMatch) : undefined}
                        onResult={(result) => reportTacticalArenaResult(arenaMatch, result)}
                        onExit={() => setArenaMatch(null)}
                    />
                </Suspense>
            )}
            {showCoop && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading co-op…</div>}>
                    <ArenaCoopLobby key={normalizedCharacterName} character={character} sharedImages={sharedImages} onExit={() => setShowCoop(false)} />
                </Suspense>
            )}
            {warfrontRewardState.phase !== "idle" && warfrontRewardState.phase !== "ready" && (warfrontRewardState.phase === "error" || !arenaMatch) && createPortal(
                <div className={`wf-reward-toast ${warfrontRewardState.phase}`}
                    role={warfrontRewardState.phase === "error" ? "alert" : "status"}
                    aria-live={warfrontRewardState.phase === "error" ? "assertive" : "polite"}
                    style={{
                        position: "fixed", zIndex: 1000002, right: 14, bottom: 14,
                        width: "min(420px, calc(100vw - 28px))", display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 14px", borderRadius: 12,
                        border: `1px solid ${warfrontRewardState.phase === "error" ? "#ef4444" : warfrontRewardState.phase === "settled" ? "#22c55e" : "#38bdf8"}`,
                        background: "rgba(3,7,18,0.96)", boxShadow: "0 14px 40px rgba(0,0,0,0.55)", color: "#f8fafc",
                    }}
                >
                    <div className="wf-reward-copy" style={{ flex: 1 }}>
                        <strong>{warfrontRewardState.phase === "error" ? "Settlement needs attention" : warfrontRewardState.phase === "settled" ? "Result settled" : warfrontRewardState.phase === "minting" ? "Sealing match" : warfrontRewardState.phase === "settling" ? "Verifying result" : "Match authorized"}</strong>
                        <div style={{ marginTop: 3, color: "#cbd5e1", fontSize: "0.9rem", lineHeight: 1.35 }}>{warfrontRewardState.message}</div>
                    </div>
                    {warfrontRewardState.retry && (
                        <button type="button" onClick={() => void warfrontRetryRef.current?.()} style={{ background: "#b45309", flexShrink: 0 }}>
                            {warfrontRewardState.retry === "mint" ? "Retry Start" : "Retry Reward"}
                        </button>
                    )}
                    {warfrontRewardState.phase === "settled" && (
                        <button type="button" aria-label="Dismiss settlement confirmation" onClick={() => setWarfrontRewardState({ phase: "idle", message: "", retry: null })} style={{ background: "var(--slate-700)", flexShrink: 0 }}>Close</button>
                    )}
                </div>,
                document.body,
            )}
            {/* Portaled to <body> at the house z-index of 1000000. At its old 215 this
                full-screen countdown rendered UNDER both the mobile bottom nav (1000) and
                the desktop rail (999999), so the 6rem numeral was partly covered right as
                the fight began. */}
            {arenaCountdown && createPortal(
                <div style={{ position: "fixed", inset: 0, zIndex: 1000000, background: "rgba(5,6,10,0.94)", display: "grid", placeItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ color: "var(--text-dim)", letterSpacing: "0.25em", fontSize: "0.85rem", marginBottom: 10 }}>BATTLE STARTS IN</div>
                        <div style={{ fontSize: "6rem", fontWeight: 800, color: "var(--gold-300)", textShadow: "0 0 30px rgba(250,204,21,0.45)", lineHeight: 1 }}>{arenaCountdown.secs}</div>
                        {arenaCountdown.match.vsAi && <div style={{ color: "#7dd3fc", marginTop: 14, fontWeight: 800, letterSpacing: "0.08em" }}>SERVER CONTRACT SEALED</div>}
                        {arenaCountdown.match.difficulty ? <div style={{ color: "#e2e8f0", marginTop: 8 }}>
                            {arenaCountdown.match.difficulty.label} · Your power {arenaCountdown.match.difficulty.playerPower.toLocaleString()} · Rival power {arenaCountdown.match.difficulty.opponentPower.toLocaleString()}
                        </div> : null}
                        {arenaCountdown.match.rewardModel ? <div style={{ color: "#fde68a", marginTop: 5, maxWidth: 620 }}>
                            {arenaCountdown.match.rewardModel.kind === "coach-completion"
                                ? `${arenaCountdown.match.rewardModel.amount.toLocaleString()} ryo on completion · outcome-independent · ${arenaCountdown.match.rewardModel.dailyCap} paid completions per UTC day`
                                : `Competitive outcome reward · victory required · daily cap ${arenaCountdown.match.rewardModel.dailyCap}`}
                        </div> : null}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

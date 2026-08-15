/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect --
 * READ THIS BEFORE REMOVING.
 *
 * Nothing these flag is new. They started firing when the screen shrank far
 * enough for React Compiler to stop bailing out of analysing it, and what it
 * then reported was pre-existing code: the render-time `playerScopeRef`
 * account-swap sync, the render-time `activeSettlementAttempt` ref reads, and
 * the mount effects that seed state from an incoming challenge.
 *
 * ONE CAME OFF. `react-hooks/purity` is gone. Its only sites were the
 * `Date.now()` and `Math.random()` in the Warfront challenge builder, which now
 * live in a module-scope helper (`newWarfrontChallengeStamp`) where they plainly
 * belong — and the pet-duel seed that used to sit beside them is gone entirely,
 * because the server mints that seed now.
 *
 * THE TWO THAT REMAIN both sit on the settlement/receipt lifecycle. The ref
 * cluster is load-bearing: an async settlement has to read the CURRENT account
 * scope to refuse a result belonging to a player who has since been swapped out,
 * and a ref is how it reads that synchronously. Moving it into state opens a
 * window where a settlement sees a stale scope, in a file whose whole job is not
 * losing a player's result. The set-state-in-effect cluster is the arena
 * countdown and the incoming-challenge responder picker reacting to props. Both
 * are real work, and both are behaviour changes rather than cleanups.
 *
 * The follow-up stands: as this screen keeps draining, each cluster can come off
 * one at a time, and the rule should be deleted from this list as it does.
 */
import { SHOWDOWN_DAILY_WIN_CAP } from "../../../shared/pet-showdown-contract";
import { useState, useEffect, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import type { Character, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen, JutsuElement } from "../types/core";
import { PET_ELEMENT_BEATS } from "../constants/pet-arena";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { PetHomeTabs } from "../components/PetHomeTabs";
import { PetChronicleCeremony } from "../components/PetChronicleCeremony";
import { PetChronicleProgress } from "../components/PetChronicleProgress";
import { type DuelResult } from "../lib/pet-duel-sim";
import { runPetDuelCinematic } from "../lib/pet-duel-cinematic";
import { createLiveDuel, type LiveDuel } from "../lib/pet-duel-live";
import { PetDuelLiveHost, type PetDuelLiveHandle } from "../components/PetDuelLiveHost";
import { fetchRankedPetDuel } from "../lib/pet-ranked-watch-api";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";
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
import { derivePetRole, ROLE_META, ROLE_BEATS, type PetRole } from "../lib/pet-roles";
import { ROLE_ICON } from "../lib/role-icons";
import { ELEMENT_ICON } from "../lib/element-icons";
import { primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic } from "../lib/pet-music";
import { petArenaBackLabel, petArenaReturnScreen, petArenaStartIssue } from "../lib/pet-arena-entry";
import {
    petChronicleCeremonyFromSettlement,
    petChronicleProgressFromSettlement,
    type PetChronicleCeremonyReceipt,
    type PetChronicleProgressReceipt,
    type PetChronicleSettlementPayload,
} from "../lib/pet-chronicle-ceremony";
import { clearPetBattleConsumables } from "../lib/pet-battle-consumables";
import {
    isPetArenaPlayerScopeActive,
    normalizePetArenaVersionDecision,
    parseWarfrontRewardSeal,
    responseBelongsToPetArenaPlayer,
    type PetArenaPlayerScope,
    type PetArenaServerVersionDecision,
    type PetArenaServerVersionResult,
    type WarfrontRewardSeal,
} from "../lib/pet-arena-settlement";
import { rankedDelta } from "../lib/progression";
import { makeId } from "../lib/utils";
import { genericPetArenaOpponents, isGenericPetOpponent, type PetArenaOpponent } from "../data/pet-arena-opponents";
import {
    petTamerPveMultiplier,
    type DuelChallenge,
} from "../App";
import { petPveHpMult, petAlphaBond } from "../lib/profession-mastery";
import { loadPendingClanPetBattle, savePendingClanPetBattle } from "../lib/world-state";
import { resolveChallengerTeam, stripInlinePetImages, arenaSizeOf } from "../lib/arena-challenge";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { activeCarriedPets } from "../lib/entitlements";
import { publicEligiblePets } from "../lib/public-pet-roster";
import type { ArenaSlot, ArenaRole } from "../lib/pet-arena-sim";
import { wfThemeForVillage } from "../lib/pet-warfront-map";
import { WF_STANCES, WF_DOCTRINES, type WfBuyPolicy, type WfStance, type WfDoctrine } from "../lib/pet-warfront-sim";
import tacticalArenaHero from "../assets/coliseum/tactical-arena-hero.webp";
import petDuelHero from "../assets/coliseum/pet-duel-hero.webp";
import duelFire from "../assets/coliseum/duel-fire.webp";
import duelWater from "../assets/coliseum/duel-water.webp";
import duelWind from "../assets/coliseum/duel-wind.webp";
import duelLightning from "../assets/coliseum/duel-lightning.webp";
import duelEarth from "../assets/coliseum/duel-earth.webp";
import "../styles/pet-home.css";

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
    const balanced = pets.length > 0 && counts.defender > 0 && counts.sage > 0 && counts.tracker > 0 && counts.assassin > 0;
    const hint = !pets.length ? "Pick your squad below — your role coverage shows up here."
        : counts.defender === 0 ? "No Defender — add one to hold the front line and soak hits."
        : counts.sage === 0 ? "No Sage — without a healer your squad has no sustain."
        : counts.tracker === 0 ? "No Tracker — you have no ranged pressure to chip from afar."
        : counts.assassin === 0 ? "No Assassin — add burst to finish low targets."
        : "Balanced squad — all four roles covered. Strong all-round comp!";
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
                            <span className="bp-role-beats" title={`Strong vs ${ROLE_META[ROLE_BEATS[r]].label} (role counter)`} style={{ fontSize: 10, opacity: 0.8, whiteSpace: "nowrap" }}>▲ {ROLE_META[ROLE_BEATS[r]].label}</span>
                        </div>
                    );
                })}
            </div>
            <p className={`pet-matchup-hint ${balanced ? "good" : "warn"}`} style={{ marginTop: 10 }}>{hint}</p>
            <div className="bp-stats">
                <span>Squad <strong>{pets.length}/{size}</strong></span>
                <span>Avg Lv <strong>{avg || "—"}</strong></span>
                <span>Elements <strong>{elements.size ? [...elements].map((e) => <ElIcon key={e} el={e} size={15} />) : "—"}</strong></span>
            </div>
            <div className="bp-tips">
                <div>🏁 Break the enemy Ward Seal before time runs out.</div>
                <div>🧠 Pets auto-fight by role — defenders tank, sages heal, trackers poke, assassins dive.</div>
                <div>⚡ Element edge ±15%: Fire▸Wind▸Lightning▸Earth▸Water▸Fire.</div>
            </div>
        </div>
    );
}

// HD-2D coliseum renderer — the pet-battle arena. Lazy so three/react-three-fiber
// load ONLY when a battle actually mounts, keeping the cold-landing bundle untouched.
const loadPetColiseum = () => import("../components/PetColiseum");
const preloadPetColiseumModels = (pets: readonly Pet[]) => import("../lib/pet-model-preload")
    .then((module) => module.preloadPetColiseumModels(pets));
// The continuous-duel renderer. Still mounted for ONE entry: a sector wanderer
// duel launched from the World Map, which is a world-initiated PvE fight against
// a specific roaming beast. Showdown has no entry that accepts a caller-named
// opponent of that kind yet (the authored-encounter entry takes a dungeon run
// token or an admin-authored event id — neither describes a wanderer), so that
// fight still resolves on the legacy engine. Every other duel this screen starts
// is a server-resolved Showdown replay.
const PetColiseumDuel = lazyWithRetry(() => loadPetColiseum().then((m) => ({ default: m.PetColiseumDuel })));
// The Showdown replay player — how EVERY duel this screen still starts is
// shown. The server resolved the fight; this plays that resolution's event log
// through the same battle component a live Showdown uses. Lazy, and
// deliberately its OWN chunk rather than the coliseum's: the point of the port
// is that the legacy stack stops being needed, so pulling it in here would
// defeat the drain.
const PetShowdownReplay = lazyWithRetry(() => import("../components/PetShowdownReplay").then((m) => ({ default: m.PetShowdownReplay })));
// Hollow Warfront — the lane-war game mode that REPLACED the capture-scroll
// Tactical Arena (Ward Seal objective, Guardian Totems, the Hollow Gate breach,
// bounty coins + the 30 s War Council). Own lazy chunk (three-heavy).
const PetWarfrontMatch = lazyWithRetry(() => import("../components/PetWarfrontMatch").then((m) => ({ default: m.PetWarfrontMatch })));
// Pet Gauntlet — the roguelike run mode (3rd tab). Self-contained (owns its run
// state + its own fight), so it's lazy-loaded and never touches the duel/arena state here.
const PetGauntlet = lazyWithRetry(() => import("../components/PetGauntlet").then((m) => ({ default: m.PetGauntlet })));
// Co-op lobby (play the Hollow Warfront 4v4 with friends) — lazy; pulls the arena chunk.
const ArenaCoopLobby = lazyWithRetry(() => import("../components/ArenaCoopLobby").then((m) => ({ default: m.ArenaCoopLobby })));

// Build the arena slots from each pet's NATIVE role (pet.role, set by
// derivePetRole + backfilled in capPetStats). Pets now carry an intrinsic role,
// so the tactical AI reads it directly instead of stat-guessing a comp. Fallback
// to derivePetRole for any pet that somehow lacks one.
function autoRoleTeam(pets: Pet[], count: number): ArenaSlot[] {
    return pets.slice(0, Math.max(1, count)).map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));
}

type PetBattleSettlementResponse = PetChronicleSettlementPayload & {
    ok?: boolean;
    error?: string;
    character?: Character;
    reward?: number;
    balances?: { ryo: number };
    totalPetWins?: number;
    dailyPetWins?: number;
    capped?: boolean;
    outcome?: "win" | "loss" | "draw";
    reason?: string;
    _saveVersion?: number;
};

/*
 * What /api/pet/battle-start hands back, in the two shapes this screen still
 * starts a fight in.
 *
 * A PLAYER CHALLENGE comes back as `script` + `winnerName`: the server resolved
 * that duel once, for both participants, when the challenge was accepted, and
 * the script IS that fight. `winnerName` is an account name rather than a side,
 * because both participants read the same object and must never be told
 * different things about who won.
 *
 * A WORLD-INITIATED PvE duel (a sector wanderer) still comes back as sealed pet
 * snapshots plus the sim config, because that fight is resolved locally on the
 * legacy engine and replayed server-side from the input log at settlement.
 */
type CasualPetBattleSeal = {
    token: string;
    seed: number;
    reportKey: string;
    script?: ShowdownReplayScript;
    winnerName?: string;
    /** The CALLER's side of the verdict, decided by the server. Not derived
     *  here from `winnerName`: account names are normalised before they reach a
     *  duel seal, so matching one against a display name would compare unequal
     *  for any name that normalises differently and report every duel lost. */
    outcome?: "win" | "loss";
    playerPets?: Pet[];
    opponentPets?: Pet[];
    battleConfig?: CasualPetBattleConfig;
};

type CasualPetBattleConfig = {
    mode: "1v1" | "2v2";
    seed: number;
    damageMult: number;
    hpMult: number;
    revive: boolean;
    applyItems: boolean;
    accuracy: boolean;
    terrain: string | null;
};

function parseCasualPetBattleConfig(
    value: unknown,
    expectedMode: CasualPetBattleConfig["mode"],
    expectedSeed: number,
): CasualPetBattleConfig | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const config = value as Partial<CasualPetBattleConfig>;
    if (config.mode !== expectedMode || config.seed !== expectedSeed
        || !Number.isFinite(Number(config.damageMult)) || Number(config.damageMult) <= 0 || Number(config.damageMult) > 10
        || !Number.isFinite(Number(config.hpMult)) || Number(config.hpMult) <= 0 || Number(config.hpMult) > 10
        || typeof config.revive !== "boolean"
        || typeof config.applyItems !== "boolean"
        || typeof config.accuracy !== "boolean"
        || (config.terrain !== null && typeof config.terrain !== "string")) return null;
    return config as CasualPetBattleConfig;
}

function parseSealedCasualPets(value: unknown, expectedIds: readonly string[]): Pet[] | null {
    if (!Array.isArray(value) || value.length !== expectedIds.length) return null;
    const pets = value.filter((entry): entry is Pet => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const pet = entry as Partial<Pet>;
        return typeof pet.id === "string" && typeof pet.name === "string"
            && Number.isFinite(Number(pet.hp)) && Number(pet.hp) > 0
            && Number.isFinite(Number(pet.attack)) && Number(pet.attack) > 0
            && Number.isFinite(Number(pet.defense)) && Number(pet.defense) >= 0
            && Number.isFinite(Number(pet.speed)) && Number(pet.speed) > 0
            && Array.isArray(pet.jutsus)
            && !("image" in pet) && !("bodyImage" in pet);
    });
    if (pets.length !== expectedIds.length
        || pets.some((pet, index) => pet.id !== expectedIds[index])) return null;
    return pets;
}

function restoreSealedPetCosmetics(sealed: Pet, local: Pet | undefined): Pet {
    return {
        ...sealed,
        ...(local?.image ? { image: local.image } : {}),
        ...(local?.bodyImage ? { bodyImage: local.bodyImage } : {}),
    };
}

type PetSettlementStatus = "pending" | "error" | "settled";
type PetSettlementKind = "tactical" | "party" | "ranked" | "casual";

type PetSettlementAttempt = {
    id: string;
    kind: PetSettlementKind;
    label: string;
    scope: PetArenaPlayerScope;
    status: PetSettlementStatus;
    running: boolean;
    run: () => Promise<boolean>;
};

type PetSettlementPresentation = Pick<PetSettlementAttempt, "id" | "kind" | "label" | "scope" | "status"> & {
    detail?: string;
};

type WarfrontMatch = {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    vsAi: boolean;
    scope: PetArenaPlayerScope;
    buyPolicy: WfBuyPolicy;
    stance: WfStance;
    doctrine: WfDoctrine;
    opponentStance: WfStance;
    opponentDoctrine: WfDoctrine;
};

/*
 * The clock-and-dice stamp on an outgoing HOLLOW WARFRONT challenge.
 *
 * Module scope on purpose. These reads are impure, and React Compiler is right
 * to flag them inside a component body even though this only ever runs from a
 * click — the seed belongs to the message, not to a render. Out here it is
 * plainly a message-building helper, and the `purity` suppression this file
 * used to carry could come off.
 *
 * Note what is NOT here: a pet-duel seed. A pet challenge no longer carries one.
 * The fight is sealed server-side when the challenge is accepted, from a seed
 * the server mints — a client-invented seed is exactly what let the two
 * participants watch different fights.
 */
function newWarfrontChallengeStamp(): { petBattleSeed: number; createdAt: number } {
    return {
        petBattleSeed: Date.now() + Math.floor(Math.random() * 100000),
        createdAt: Date.now(),
    };
}

function settlementErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "The arena could not record this result. Your battle seal is safe to retry.";
}

export function PetArena({ character, updateCharacter, allServerPlayers, setScreen, sharedImages, duelChallenges, setDuelChallenges, pendingPetBattleOpponent, onPendingPetBattleStarted, pendingArenaMatch, onPendingArenaMatchStarted, pendingArenaResponse, onArenaResponseHandled, onClanWarBattleEnd, onBattleActiveChange, onFullscreenActiveChange, onServerVersion, onVersionedCharacter }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; allServerPlayers: ServerPlayerSummary[]; setScreen: (screen: Screen) => void; sharedImages: Record<string, string>; duelChallenges: DuelChallenge[]; setDuelChallenges: (c: DuelChallenge[]) => void; pendingPetBattleOpponent?: PetArenaOpponent | null; onPendingPetBattleStarted?: () => void; pendingArenaMatch?: { blue: Pet[]; red: Pet[]; size: 2 | 4; seed: number } | null; onPendingArenaMatchStarted?: () => void; pendingArenaResponse?: DuelChallenge | null; onArenaResponseHandled?: () => void; onClanWarBattleEnd?: (youWon: boolean | "draw", opponentName?: string) => void; onBattleActiveChange?: (active: boolean) => void; onFullscreenActiveChange?: (active: boolean) => void; onServerVersion?: (version: number | undefined, originatingPlayerName: string) => PetArenaServerVersionResult; onVersionedCharacter?: (character: Character, version: number | undefined, originatingPlayerName: string) => PetArenaServerVersionResult }) {
    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const preservedPetOverflow = Math.max(0, character.pets.length - combatEligiblePets.length);
    const mountedRef = useRef(true);
    const playerScopeRef = useRef<PetArenaPlayerScope>({ playerName: character.name, generation: 0 });
    if (playerScopeRef.current.playerName.toLowerCase() !== character.name.toLowerCase()) {
        playerScopeRef.current = {
            playerName: character.name,
            generation: playerScopeRef.current.generation + 1,
        };
    }
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const capturePlayerScope = (): PetArenaPlayerScope => ({ ...playerScopeRef.current });
    const playerScopeIsActive = (scope: PetArenaPlayerScope): boolean => (
        isPetArenaPlayerScopeActive(scope, playerScopeRef.current, mountedRef.current)
    );

    const [selectedPetId, setSelectedPetId] = useState(combatEligiblePets.find((pet) => pet.id === character.activePetId)?.id ?? combatEligiblePets[0]?.id ?? "");
    const [opponentSearch, setOpponentSearch] = useState("");
    const [petChallengeMsg, setPetChallengeMsg] = useState("");
    const [chronicleCeremony, setChronicleCeremony] = useState<PetChronicleCeremonyReceipt | null>(null);
    const [chronicleProgress, setChronicleProgress] = useState<PetChronicleProgressReceipt | null>(null);
    const settlementAttemptRef = useRef<PetSettlementAttempt | null>(null);
    const [settlementPresentation, setSettlementPresentation] = useState<PetSettlementPresentation | null>(null);
    const battleSetupRetryRef = useRef<(() => void) | null>(null);
    const [battleSetupIssue, setBattleSetupIssue] = useState<{ scope: PetArenaPlayerScope; message: string } | null>(null);
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
    // Hollow Warfront — a full-screen 4v4 lane war with Ward Seals, Guardian
    // Totems and a timed War Council. Teams are built + frozen on launch.
    const [arenaMatch, setArenaMatch] = useState<WarfrontMatch | null>(null);
    // Server-authoritative Warfront seed + reward proof. This exact promise is
    // retained through rendering and retries so the battle cannot be re-seeded.
    const warfrontRewardSealRequest = useRef<Promise<WarfrontRewardSeal | null> | null>(null);
    const warfrontSetupInFlightRef = useRef<Promise<WarfrontRewardSeal | null> | null>(null);
    const warfrontSetupErrorRef = useRef<string | null>(null);
    const warfrontResumeProbeScopeRef = useRef<string | null>(null);
    const [warfrontSetupPending, setWarfrontSetupPending] = useState(false);
    // Co-op (play the Hollow Warfront 4v4 with friends) — opens the lobby overlay.
    const [showCoop, setShowCoop] = useState(false);
    // Top-level view switch. "battle" is the classic cinematic 1v1/2v2 duel;
    // "tactical" is the full-screen team game mode (vs AI / challenge / co-op).
    // Defaults to the cinematic battle so Pet Arena opens straight into it.
    const [arenaView, setArenaView] = useState<"battle" | "tactical" | "gauntlet">("battle");
    // Warfront setup (single screen): a team grid shared by Fight AI and
    // Challenge-a-Player. Picks seed to the top available pets.
    // Warfront is always 4v4 (2v2 retired with capture-scroll); kept as state-shaped
    // const so the challenge payload + pick caps read unchanged.
    const [tacticalSize] = useState<2 | 4>(4);
    // War Council preference for the Warfront's 30 s buy rounds: manual popup or
    // a silent auto-buy policy. Per-device persisted; PvP/co-op always lock auto
    // so both clients' replays stay deterministic.
    const [wfAutoPref, setWfAutoPref] = useState<Exclude<WfBuyPolicy, "off">>(() => {
        try {
            const v = localStorage.getItem("wfAutoBuy.v1");
            return v === "offense" || v === "defense" ? v : "balanced";
        } catch { return "balanced"; }
    });
    const setWfAuto = (p: Exclude<WfBuyPolicy, "off">) => {
        setWfAutoPref(p);
        try { localStorage.setItem("wfAutoBuy.v1", p); } catch { /* storage disabled — ignore */ }
    };
    // Opening FORMATION (stance) for the Warfront — per-device persisted; also
    // adjustable at every manual War Council mid-match.
    const [wfStancePref, setWfStancePref] = useState<WfStance>(() => {
        try {
            const v = localStorage.getItem("wfStance.v1");
            return v === "siege" || v === "jungle" || v === "headhunt" || v === "turtle" ? v : "balanced";
        } catch { return "balanced"; }
    });
    const setWfStance = (s: WfStance) => {
        setWfStancePref(s);
        try { localStorage.setItem("wfStance.v1", s); } catch { /* storage disabled — ignore */ }
    };
    // Team DOCTRINE — a second pre-match strategic axis (a team-wide boon).
    const [wfDoctrinePref, setWfDoctrinePref] = useState<WfDoctrine>(() => {
        try {
            const v = localStorage.getItem("wfDoctrine.v1");
            return v === "vanguard" || v === "bulwark" || v === "zealot" || v === "warden-pact" ? v : "vanguard";
        } catch { return "vanguard"; }
    });
    const setWfDoctrine = (d: WfDoctrine) => {
        setWfDoctrinePref(d);
        try { localStorage.setItem("wfDoctrine.v1", d); } catch { /* storage disabled — ignore */ }
    };
    const receivePetBattleSettlement = (
        data: PetBattleSettlementResponse,
        scope: PetArenaPlayerScope,
        authoritativeCharacter: Character | undefined = data.character,
    ): PetArenaServerVersionDecision => {
        if (!playerScopeIsActive(scope)
            || !responseBelongsToPetArenaPlayer(scope, data.character?.name)) return "foreign";

        // Even a character-less receipt hop asks App to validate the originating
        // account. App may return `stale` for an unversioned same-account hop, but
        // returns `foreign` after logout/account switch, stopping the chain before
        // another authenticated request or run callback can fire.
        const decision = normalizePetArenaVersionDecision(
            authoritativeCharacter && onVersionedCharacter
                ? onVersionedCharacter(authoritativeCharacter, data._saveVersion, scope.playerName)
                : onServerVersion?.(data._saveVersion, scope.playerName),
        );
        if (decision === "foreign" || !playerScopeIsActive(scope)) return "foreign";

        // A stale same-account snapshot is not safe to hydrate, but its receipt is
        // still a server-authenticated deed and may be celebrated. A foreign one
        // never reaches this branch.
        const receipt = petChronicleCeremonyFromSettlement(data);
        if (receipt) {
            setChronicleCeremony((current) => playerScopeIsActive(scope) ? (current ?? receipt) : current);
        }
        const progress = petChronicleProgressFromSettlement(data);
        if (progress) {
            setChronicleProgress((current) => playerScopeIsActive(scope) ? (current ?? progress) : current);
        }
        return decision;
    };
    const playerAuthorityIsActive = (scope: PetArenaPlayerScope): boolean => {
        if (!playerScopeIsActive(scope)) return false;
        const decision = normalizePetArenaVersionDecision(
            onServerVersion?.(undefined, scope.playerName),
        );
        return decision !== "foreign" && playerScopeIsActive(scope);
    };
    const clearSpentConsumables = (petIds: readonly string[], scope: PetArenaPlayerScope = playerScopeRef.current) => {
        updateCharacter((current) => current
            && playerScopeIsActive(scope)
            && current.name.toLowerCase() === scope.playerName.toLowerCase()
            ? { ...current, pets: clearPetBattleConsumables(current.pets, petIds) }
            : current);
    };

    const applyPetBattleSettlement = (
        data: PetBattleSettlementResponse,
        scope: PetArenaPlayerScope,
        petIds: readonly string[],
    ): boolean => {
        if (!data.character) throw new Error("The arena did not return the recorded pet roster. Retry this receipt.");
        const authoritativeCharacter = {
            ...data.character,
            pets: clearPetBattleConsumables(data.character.pets, petIds),
        };
        const decision = receivePetBattleSettlement(data, scope, authoritativeCharacter);
        if (decision === "foreign") return false;
        if (decision === "stale") {
            // A newer same-account response already owns the rest of the save.
            // Preserve the one-use item spend locally without hydrating backward.
            clearSpentConsumables(petIds, scope);
            return true;
        }
        if (!onVersionedCharacter) updateCharacter((current) => {
            if (!current
                || !playerScopeIsActive(scope)
                || current.name.toLowerCase() !== scope.playerName.toLowerCase()
                || data.character?.name.toLowerCase() !== current.name.toLowerCase()) return current;
            return {
                ...authoritativeCharacter,
            };
        });
        return true;
    };

    async function postPetBattleSettlement(body: Record<string, unknown>): Promise<PetBattleSettlementResponse> {
        const response = await fetch("/api/pet/battle-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => null) as PetBattleSettlementResponse | null;
        if (!response.ok) throw new Error(data?.error || "The arena could not record this pet battle.");
        if (!data) throw new Error("The arena returned an unreadable pet battle receipt.");
        return data;
    }

    async function runPetSettlementAttempt(attempt: PetSettlementAttempt): Promise<void> {
        if (attempt.running || attempt.status === "settled" || !playerScopeIsActive(attempt.scope)) return;
        attempt.running = true;
        attempt.status = "pending";
        setSettlementPresentation({
            id: attempt.id,
            kind: attempt.kind,
            label: attempt.label,
            scope: attempt.scope,
            status: "pending",
        });
        try {
            const completed = await attempt.run();
            if (!completed
                || settlementAttemptRef.current !== attempt
                || !playerScopeIsActive(attempt.scope)) return;
            attempt.status = "settled";
            setSettlementPresentation({
                id: attempt.id,
                kind: attempt.kind,
                label: attempt.label,
                scope: attempt.scope,
                status: "settled",
                detail: "Battle record confirmed. Rewards and one-use items are sealed.",
            });
        } catch (error) {
            if (settlementAttemptRef.current !== attempt || !playerScopeIsActive(attempt.scope)) return;
            attempt.status = "error";
            setSettlementPresentation({
                id: attempt.id,
                kind: attempt.kind,
                label: attempt.label,
                scope: attempt.scope,
                status: "error",
                detail: settlementErrorMessage(error),
            });
        } finally {
            attempt.running = false;
        }
    }

    function beginPetSettlement(options: Omit<PetSettlementAttempt, "running" | "status">): void {
        const existing = settlementAttemptRef.current;
        if (existing?.id === options.id) return;
        const attempt: PetSettlementAttempt = { ...options, running: false, status: "pending" };
        settlementAttemptRef.current = attempt;
        void runPetSettlementAttempt(attempt);
    }

    function resetPetSettlement(): void {
        settlementAttemptRef.current = null;
        setSettlementPresentation(null);
    }

    function showBattleSetupIssue(scope: PetArenaPlayerScope, message: string, retry: () => void): void {
        if (!playerScopeIsActive(scope)) return;
        battleSetupRetryRef.current = retry;
        setBattleSetupIssue({ scope, message });
    }

    const [tacticalPicks, setTacticalPicks] = useState<string[]>(() => pickArenaTeam(combatEligiblePets, 4).map((p) => p.id));
    const [arenaChallengeName, setArenaChallengeName] = useState("");
    const [arenaChallengeMsg, setArenaChallengeMsg] = useState("");
    // 5→1 pre-roll shown to both players before the match plays. Holds the built
    // slots; when it hits 0 we mount PetArenaMatch (same seed → identical fight).
    const [arenaCountdown, setArenaCountdown] = useState<{ secs: number; match: WarfrontMatch } | null>(null);
    // Responder team picks (for an incoming arena challenge, separate from the
    // wizard's tacticalPicks so an in-progress send isn't clobbered).
    const [respondPicks, setRespondPicks] = useState<string[]>([]);

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
        if (isPetOnExpedition(selectedPet)) {
            setPetChallengeMsg(`${petDisplayName(selectedPet)} is exploring and cannot battle right now.`);
            return;
        }
        // 2v2 challenge needs the player to have a reserve and the target
        // to have at least 2 pets. If either fails, fall back to 1v1.
        const wantsParty = partyMode && combatEligiblePets.length >= 2;
        const reserveCandidate = wantsParty
            ? (combatEligiblePets.find(p => p.id === reservePetId && p.id !== selectedPet.id && !isPetOnExpedition(p))
                ?? combatEligiblePets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0]
                ?? null)
            : null;
        const targetCanParty = publicEligiblePets(targetRecord).filter((pet) => !isPetOnExpedition(pet)).length >= 2;
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

    function queueSealedWarfront(seal: WarfrontRewardSeal, scope: PetArenaPlayerScope): void {
        if (!playerAuthorityIsActive(scope)) return;
        const localPetsById = new Map(character.pets.map((pet) => [pet.id, pet]));
        const rivalCosmeticsById = new Map(genericPetArenaOpponents.map(({ pet }) => [pet.id, pet]));
        const blue = seal.bluePets.map((pet) => {
            const cosmetic = localPetsById.get(pet.id);
            return {
                ...pet,
                ...(cosmetic?.image ? { image: cosmetic.image } : {}),
                ...(cosmetic?.bodyImage ? { bodyImage: cosmetic.bodyImage } : {}),
            };
        });
        const red = seal.redPets.map((pet) => {
            const cosmetic = rivalCosmeticsById.get(pet.id);
            return {
                ...pet,
                ...(cosmetic?.image ? { image: cosmetic.image } : {}),
                ...(cosmetic?.bodyImage ? { bodyImage: cosmetic.bodyImage } : {}),
            };
        });
        void loadPetColiseum().catch(() => undefined);
        setChronicleCeremony(null);
        setChronicleProgress(null);
        resetPetSettlement();
        setBattleSetupIssue(null);
        battleSetupRetryRef.current = null;
        warfrontRewardSealRequest.current = Promise.resolve(seal);
        clearSpentConsumables(blue.map((pet) => pet.id), scope);
        setArenaView("tactical");
        setArenaCountdown({
            secs: 5,
            match: {
                blue: autoRoleTeam(blue, blue.length),
                red: autoRoleTeam(red, red.length),
                seed: seal.seed,
                vsAi: true,
                scope,
                buyPolicy: seal.buyPolicy,
                stance: seal.stance,
                doctrine: seal.doctrine,
                opponentStance: seal.opponentStance,
                opponentDoctrine: seal.opponentDoctrine,
            },
        });
    }

    // Build the role-assigned slots + start the 5s pre-roll, evening both teams
    // to the smaller roster so a lopsided pick can't auto-stomp. Both clients
    // run this from identical embedded teams, so the match stays in sync.
    async function startArenaMatch(blue: Pet[], red: Pet[], seed: number, vsAi = false) {
        if (vsAi && warfrontSetupInFlightRef.current) return;
        const scope = capturePlayerScope();
        const matchConfig = {
            buyPolicy: (vsAi ? wfAutoPref : "balanced") as WfBuyPolicy,
            stance: wfStancePref,
            doctrine: wfDoctrinePref,
            opponentStance: "balanced" as WfStance,
            opponentDoctrine: "vanguard" as WfDoctrine,
        };
        // Use the existing five-second pre-roll to fetch/parse Three + the arena
        // renderer instead of showing another loading panel after the countdown.
        void loadPetColiseum().catch(() => undefined);
        const n = vsAi
            ? Math.max(1, Math.min(4, blue.length))
            : Math.max(1, Math.min(blue.length, red.length));
        setArenaView("tactical");
        setChronicleCeremony(null);
        setChronicleProgress(null);
        // vs-AI is server-authoritative — mint the reward token now (the server
        // re-runs this exact match); the 5s countdown gives it time to resolve.
        resetPetSettlement();
        setBattleSetupIssue(null);
        battleSetupRetryRef.current = null;
        warfrontSetupErrorRef.current = null;
        if (vsAi) {
            const sealRequest = mintWarfrontToken(blue.slice(0, n), scope, matchConfig);
            warfrontSetupInFlightRef.current = sealRequest;
            setWarfrontSetupPending(true);
            const seal = await sealRequest;
            if (warfrontSetupInFlightRef.current === sealRequest) {
                warfrontSetupInFlightRef.current = null;
                if (playerScopeIsActive(scope)) setWarfrontSetupPending(false);
            }
            if (!playerAuthorityIsActive(scope)) return;
            if (!seal) {
                showBattleSetupIssue(
                    scope,
                    warfrontSetupErrorRef.current
                        ?? "Warfront setup could not be verified. Retry to recover any existing battle seal safely.",
                    () => { void startArenaMatch(blue, red, seed, true); },
                );
                return;
            }
            queueSealedWarfront(seal, scope);
            return;
        }
        if (!playerScopeIsActive(scope)) return;
        setArenaCountdown({
            secs: 5,
            match: {
                blue: autoRoleTeam(blue.slice(0, n), n),
                red: autoRoleTeam(red.slice(0, n), n),
                seed,
                vsAi,
                scope,
                ...matchConfig,
            },
        });
    }

    // Hollow Warfront vs-AI is SERVER-AUTHORITATIVE. At launch we mint a token via
    // /api/pet/warfront-start: the server RE-RUNS the exact deterministic match and
    // seals the winner + reward level, then returns the seed the client must use.
    // Same sealed inputs → same result on any browser
    // (the sim is cross-engine deterministic; scripts/warfront-parity.test.ts proves
    // server re-sim === the streamed render), so a win on screen always redeems.
    function mintWarfrontToken(
        bluePets: Pet[],
        scope: PetArenaPlayerScope,
        config: Pick<WarfrontMatch, "buyPolicy" | "stance" | "doctrine">,
    ): Promise<WarfrontRewardSeal | null> {
        const request = (async () => {
            try {
                const r = await fetch("/api/pet/warfront-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        playerName: scope.playerName,
                        playerPetIds: bluePets.map((p) => p.id),
                        stance: config.stance,
                        doctrine: config.doctrine,
                        buyPolicy: config.buyPolicy,
                    }),
                });
                if (!r.ok) {
                    const payload = await r.json().catch(() => null) as { error?: unknown } | null;
                    const serverMessage = typeof payload?.error === "string"
                        ? payload.error.trim().slice(0, 280)
                        : "The Warfront authority service refused this setup.";
                    const retryAfter = Number(r.headers.get("Retry-After"));
                    if (playerScopeIsActive(scope)) {
                        warfrontSetupErrorRef.current = Number.isFinite(retryAfter) && retryAfter > 1
                            ? `${serverMessage} Try again in about ${Math.ceil(retryAfter)} seconds.`
                            : serverMessage;
                    }
                    return null;
                }
                const seal = parseWarfrontRewardSeal(await r.json().catch(() => null));
                if (!seal && playerScopeIsActive(scope)) {
                    warfrontSetupErrorRef.current = "The Warfront response could not be verified. Retry to recover the existing battle seal safely.";
                }
                return seal;
            } catch {
                if (playerScopeIsActive(scope)) {
                    warfrontSetupErrorRef.current = "Warfront setup lost its connection. Retry to recover the existing battle seal; the arena will not create a second active match.";
                }
                return null;
            }
        })();
        warfrontRewardSealRequest.current = request;
        return request;
    }

    async function resumeOwnedWarfront(scope: PetArenaPlayerScope): Promise<void> {
        if (warfrontSetupInFlightRef.current || !playerAuthorityIsActive(scope)) return;
        warfrontSetupErrorRef.current = null;
        const request = (async (): Promise<WarfrontRewardSeal | null> => {
            try {
                const response = await fetch("/api/pet/warfront-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerName: scope.playerName, resumeOnly: true }),
                });
                if (response.status === 204) return null;
                if (!response.ok) {
                    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
                    const message = typeof payload?.error === "string"
                        ? payload.error.trim().slice(0, 280)
                        : "The existing Warfront seal could not be recovered.";
                    const retryAfter = Number(response.headers.get("Retry-After"));
                    const detail = Number.isFinite(retryAfter) && retryAfter > 1
                        ? `${message} Try again in about ${Math.ceil(retryAfter)} seconds.`
                        : message;
                    showBattleSetupIssue(scope, detail, () => { void resumeOwnedWarfront(scope); });
                    return null;
                }
                const seal = parseWarfrontRewardSeal(await response.json().catch(() => null));
                if (!seal) {
                    showBattleSetupIssue(
                        scope,
                        "The saved Warfront response could not be verified. Retry to recover that same battle seal.",
                        () => { void resumeOwnedWarfront(scope); },
                    );
                }
                return seal;
            } catch {
                showBattleSetupIssue(
                    scope,
                    "Warfront recovery lost its connection. Retry to recover the same active battle seal.",
                    () => { void resumeOwnedWarfront(scope); },
                );
                return null;
            }
        })();
        warfrontSetupInFlightRef.current = request;
        setWarfrontSetupPending(true);
        const seal = await request;
        if (warfrontSetupInFlightRef.current === request) {
            warfrontSetupInFlightRef.current = null;
            if (playerScopeIsActive(scope)) setWarfrontSetupPending(false);
        }
        if (seal && playerAuthorityIsActive(scope)) queueSealedWarfront(seal, scope);
    }

    // Settle every vs-AI Warfront outcome so the one-use seal and consumables are
    // durably retired even on a loss/draw. The endpoint pays only its independently
    // sealed outcome; retries reuse this token + report key and remain exact-once.
    // PvP Warfront matches intentionally have no economy settlement.
    function reportTacticalArenaResult(
        m: WarfrontMatch,
        winner: "blue" | "red" | "draw",
    ) {
        if (!m.vsAi || !playerAuthorityIsActive(m.scope)) return;
        const outcome = winner === "blue" ? "win" : winner === "red" ? "loss" : "draw";
        const reportKey = `${m.seed}:tactical`;
        const playerPetIds = m.blue.map((slot) => slot.pet.id);
        const rivalPetIds = m.red.map((slot) => slot.pet.id);
        const sealRequest = warfrontRewardSealRequest.current;
        const bodyBase = { playerName: m.scope.playerName, outcome, reportKey } as const;
        beginPetSettlement({
            id: `tactical:${reportKey}`,
            kind: "tactical",
            label: "Hollow Warfront result",
            scope: m.scope,
            run: async () => {
                const seal = await (sealRequest ?? Promise.resolve(null));
                if (!playerScopeIsActive(m.scope)) return false;
                if (!seal) throw new Error("The Warfront battle seal is unavailable. Retry this receipt before leaving.");
                if (seal.seed !== m.seed
                    || seal.reportKey !== reportKey
                    || seal.stance !== m.stance
                    || seal.doctrine !== m.doctrine
                    || seal.buyPolicy !== m.buyPolicy
                    || seal.opponentStance !== m.opponentStance
                    || seal.opponentDoctrine !== m.opponentDoctrine
                    || seal.bluePets.map((pet) => pet.id).join("\0") !== playerPetIds.join("\0")
                    || seal.redPets.map((pet) => pet.id).join("\0") !== rivalPetIds.join("\0")) {
                    throw new Error("The Warfront battle proof does not match this replay. Keep this result open and retry.");
                }
                const data = await postPetBattleSettlement({ ...bodyBase, battleToken: seal.token });
                if (!playerScopeIsActive(m.scope)) return false;
                return applyPetBattleSettlement(data, m.scope, playerPetIds);
            },
        });
    }

    // Send a Hollow Warfront PvP challenge with my hand-picked roster. Rides the
    // same /api/player/challenge delivery as cinematic pet challenges (mode
    // "clanWarPet" so the global accept banner surfaces it) but flagged
    // arenaMatch; my roster is referenced by id (resolved against the server-kept
    // challenger.pets snapshot) for a deterministic match.
    async function sendArenaChallenge(toName: string, size: 2 | 4, teamIds: string[]) {
        const name = toName.trim();
        if (!name) { setArenaChallengeMsg("Enter a player name to challenge."); return; }
        if (name.toLowerCase() === character.name.toLowerCase()) { setArenaChallengeMsg("You can't challenge yourself."); return; }
        const availableIds = new Set(combatEligiblePets.filter((pet) => !isPetOnExpedition(pet)).map((pet) => pet.id));
        if (teamIds.length !== size || new Set(teamIds).size !== size || teamIds.some((id) => !availableIds.has(id))) { setArenaChallengeMsg(`A ${size}v${size} match requires ${size} available carried pets.`); return; }
        const targetRecord = allServerPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (targetRecord && availablePetBattleCount(publicEligiblePets(targetRecord)) < size) {
            setArenaChallengeMsg(`${name} needs ${size} available pets for a ${size}v${size} arena match.`);
            return;
        }
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: name,
            challenger: { ...character, pets: combatEligiblePets },
            ...newWarfrontChallengeStamp(),
            mode: "clanWarPet",
            arenaMatch: true,
            arenaSize: size,
            challengerTeamIds: teamIds,
        };
        try {
            const res = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: name, challenge }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({} as { error?: string }));
                setArenaChallengeMsg(`❌ ${data?.error ?? `Could not reach ${name}. Check the name and try again.`}`);
                return;
            }
            setDuelChallenges([
                ...duelChallenges.filter((c: DuelChallenge) => !(c.fromName === character.name && !c.accepted && !c.declined && !c.battleId)),
                challenge,
            ]);
            setArenaChallengeMsg(`✅ ${size === 4 ? "4v4" : "2v2"} challenge sent to ${name}! Waiting for them to accept and pick their team…`);
        } catch {
            setArenaChallengeMsg("❌ Network error sending challenge.");
        }
    }

    // Responder side: I picked my team for an incoming arena challenge. Echo it
    // back (image-stripped) on the accepted notice and launch the same match the
    // challenger will — blue resolved from their snapshot, red = my picks.
    async function respondToArenaChallenge(challenge: DuelChallenge, teamIds: string[]) {
        const size = arenaSizeOf(challenge);
        const myTeam = teamIds.slice(0, size)
            .map((id) => combatEligiblePets.find((pet) => pet.id === id && !isPetOnExpedition(pet)))
            .filter((pet): pet is Pet => Boolean(pet));
        const blue = resolveChallengerTeam(challenge)
            .filter((pet) => !isPetOnExpedition(pet))
            .slice(0, size);
        if (new Set(myTeam.map((pet) => pet.id)).size !== size || new Set(blue.map((pet) => pet.id)).size !== size) {
            setArenaChallengeMsg(`This ${size}v${size} challenge needs ${size} available pets on each team. It was not started.`);
            return;
        }
        try {
            await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: challenge.fromName, challenge: {
                    ...challenge, accepted: true, fromName: character.name, toName: challenge.fromName,
                    responderTeam: stripInlinePetImages(myTeam),
                } }),
            });
        } catch { /* the challenger just won't auto-launch; my side still plays */ }
        onArenaResponseHandled?.();
        void startArenaMatch(blue, myTeam, challenge.petBattleSeed ?? 1);
    }

    const selectedPet = combatEligiblePets.find((pet) => pet.id === selectedPetId) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));

    // The champion card is visible for several seconds before a challenge is
    // answered. Spend that idle time fetching/parsing this pet's GLB so a duel
    // opens on a finished 3D combatant instead of its temporary sprite
    // fallback. The opponent's model is preloaded when the fight actually
    // starts — until a challenge is accepted there is no opponent to preload.
    useEffect(() => {
        if (!selectedPet) return;
        void preloadPetColiseumModels([selectedPet]).catch(() => undefined);
    }, [selectedPet?.id, selectedPet?.evolutionStage, selectedPet?.rarity]);

    const [battleReady, setBattleReady] = useState(false);
    const [battleOpponent, setBattleOpponent] = useState<PetArenaOpponent | null>(null);
    const [battleLog, setBattleLog] = useState<string[]>([]);
    // EVERY duel this screen starts is now WATCHED: the server resolves the
    // fight and this holds the event log it handed back. There is no local
    // simulation left to hold a result from — ranked and player challenges are
    // both decided server-side, and the AI exhibition that used to run here
    // moved to the Coliseum entry (screens/PetShowdown).
    const [watchedDuel, setWatchedDuel] = useState<{
        script: ShowdownReplayScript; playerPets: Pet[];
        id: number; // per-fight nonce → React key so "Watch again" remounts the player
    } | null>(null);
    // The one locally-resolved fight left: a sector wanderer duel from the World
    // Map. Mutually exclusive with watchedDuel.
    const [duelBattle, setDuelBattle] = useState<{
        // Exactly one of `result` / `live` is set: a precomputed timeline to watch,
        // or a live player-controlled fight that reports its outcome via onOutcome.
        result: DuelResult | null; live?: LiveDuel | null; onOutcome?: (result: DuelResult) => void;
        playerPet: Pet; enemyPet: Pet; seed: number;
        id: number;
    } | null>(null);
    const [duelNonce, setDuelNonce] = useState(0); // monotonic per-fight id source (state, not ref → no render-time ref read)
    const [result, setResult] = useState("");
    useEffect(() => {
        // React may reuse this screen component while App swaps accounts. Purge
        // every battle-owned value so the incoming player can never inherit an
        // old opponent, receipt banner, Gate retry, or callback closure.
        settlementAttemptRef.current = null;
        battleSetupRetryRef.current = null;
        warfrontRewardSealRequest.current = null;
        warfrontSetupInFlightRef.current = null;
        warfrontSetupErrorRef.current = null;
        setSettlementPresentation(null);
        setBattleSetupIssue(null);
        setWarfrontSetupPending(false);
        setChronicleCeremony(null);
        setChronicleProgress(null);
        setSelectedPetId(combatEligiblePets.find((pet) => pet.id === character.activePetId)?.id ?? combatEligiblePets[0]?.id ?? "");
        setReservePetId(character.activePetId2v2 ?? "");
        setTacticalPicks(pickArenaTeam(combatEligiblePets, 4).map((pet) => pet.id));
        setBattleOpponent(null);
        setBattleReady(false);
        setBattleLog([]);
        setWatchedDuel(null);
        setDuelBattle(null);
        setArenaMatch(null);
        setArenaCountdown(null);
        setResult("");
    }, [character.name]);
    useEffect(() => {
        // Recovery is independent of the current live roster. In particular,
        // it still runs when sealed pets are now away/on expedition and the
        // ordinary four-pet Warfront tab is locked.
        if (pendingPetBattleOpponent || pendingArenaMatch || pendingArenaResponse) return;
        const scope = capturePlayerScope();
        const scopeKey = `${scope.generation}:${scope.playerName.toLowerCase()}`;
        if (warfrontResumeProbeScopeRef.current === scopeKey) return;
        warfrontResumeProbeScopeRef.current = scopeKey;
        void resumeOwnedWarfront(scope);
    }, [
        character.name,
        pendingPetBattleOpponent?.owner,
        pendingArenaMatch?.seed,
        pendingArenaResponse?.id,
    ]);
    // Fullscreen presentation is deliberately separate from App's unresolved
    // battle signal: the latter also controls presence, regen, and clan-war
    // launch behavior, while already-decided cinematic playback must not.
    const fullscreenBattleActive = arenaMatch !== null
        || arenaCountdown !== null
        || battleReady
        || watchedDuel !== null
        || duelBattle !== null;
    useEffect(() => {
        const unresolvedBattleActive = arenaMatch !== null
            || arenaCountdown !== null
            || Boolean(battleReady && settlementPresentation && settlementPresentation.status !== "settled");
        onBattleActiveChange?.(unresolvedBattleActive);
        return () => onBattleActiveChange?.(false);
    }, [
        arenaMatch,
        arenaCountdown,
        battleReady,
        settlementPresentation?.status,
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
    const visibleLog = battleLog;

    // Auto-scroll to the fight the moment a battle becomes ready — both sides
    // accept and the page glides down to the arena so they can watch it play
    // out without hunting for it.
    const battlefieldRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!battleReady || !watchedDuel) return;
        const t = window.setTimeout(() => {
            battlefieldRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80); // let the battlefield mount first
        return () => window.clearTimeout(t);
    }, [battleReady, watchedDuel?.id]);

    /*
     * Ask the arena for this duel's reward token AND for the duel itself.
     *
     * `pvpChallengeId` is the identity of the sealed fight: the server decided
     * it once, for both participants, at the moment the challenge was accepted.
     * Whichever of us asks gets the same script and the same winner back, so
     * there is nothing left for this screen to simulate.
     *
     * There is deliberately NO fallback when this fails. The screen used to run
     * `runPetDuelCinematic` over whatever seed it had, while the server sealed
     * its own outcome from a seed it minted separately — two fights per
     * challenge, and both players could be shown a victory. Refusing to start
     * is the honest failure; inventing a fight is the bug.
     */
    async function mintCasualPetBattleToken(
        scope: PetArenaPlayerScope,
        opponent: PetArenaOpponent,
        mode: "1v1" | "2v2",
        playerPets: Pet[],
        opponentPets: Pet[],
    ): Promise<CasualPetBattleSeal | null> {
        try {
            const r = await fetch("/api/pet/battle-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName: scope.playerName,
                    opponentName: opponent.owner,
                    opponentLevel: opponent.pet.level,
                    mode,
                    playerPetIds: playerPets.map((pet) => pet.id),
                    opponentPetIds: opponentPets.map((pet) => pet.id),
                    ...(opponent.pvpChallengeId ? { pvpChallengeId: opponent.pvpChallengeId } : {}),
                }),
            });
            if (!r.ok) return null;
            const data = await r.json().catch(() => null) as {
                token?: unknown; seed?: unknown; reportKey?: unknown;
                showdownScript?: unknown; winnerName?: unknown; outcome?: unknown;
                playerPets?: unknown; opponentPets?: unknown; battleConfig?: unknown;
            } | null;
            if (typeof data?.token !== "string"
                || !Number.isSafeInteger(Number(data.seed))
                || typeof data.reportKey !== "string") return null;
            if (opponent.pvpChallengeId) {
                // A challenge duel is the server's fight or it is nothing.
                const script = data.showdownScript && typeof data.showdownScript === "object"
                    ? data.showdownScript as ShowdownReplayScript
                    : null;
                const outcome = data.outcome === "win" || data.outcome === "loss" ? data.outcome : null;
                if (!script || typeof data.winnerName !== "string" || !data.winnerName || !outcome) return null;
                return {
                    token: data.token,
                    seed: Number(data.seed),
                    reportKey: data.reportKey,
                    script,
                    winnerName: data.winnerName,
                    outcome,
                };
            }
            const expectsPveSnapshots = opponentPets.every((pet) => isGenericPetOpponent(pet));
            const sealedPlayers = data.playerPets === undefined
                ? null
                : parseSealedCasualPets(data.playerPets, playerPets.map((pet) => pet.id));
            const sealedOpponents = data.opponentPets === undefined
                ? null
                : parseSealedCasualPets(data.opponentPets, opponentPets.map((pet) => pet.id));
            const battleConfig = data.battleConfig === undefined
                ? null
                : parseCasualPetBattleConfig(data.battleConfig, mode, Number(data.seed));
            if (expectsPveSnapshots && (!sealedPlayers || !sealedOpponents || !battleConfig)) return null;
            if ((data.playerPets !== undefined && !sealedPlayers)
                || (data.opponentPets !== undefined && !sealedOpponents)
                || (data.battleConfig !== undefined && !battleConfig)) return null;
            return {
                token: data.token,
                seed: Number(data.seed),
                reportKey: data.reportKey,
                ...(sealedPlayers ? { playerPets: sealedPlayers } : {}),
                ...(sealedOpponents ? { opponentPets: sealedOpponents } : {}),
                ...(battleConfig ? { battleConfig } : {}),
            };
        } catch {
            return null;
        }
    }

    async function startBattle(opponentOverride?: PetArenaOpponent) {
        const battleScope = capturePlayerScope();
        // Every duel that reaches this screen arrives as an accepted challenge.
        // There is no opponent picker any more: the built-in AI exhibition moved
        // to the Coliseum entry (screens/PetShowdown), which does its own arena
        // matching, seals its own rewards and never comes through here.
        const opponent = opponentOverride;
        const pvpParty = Boolean(opponent?.opponentParty && opponent.challengerParty);
        const startIssue = petArenaStartIssue({
            selectedPetName: selectedPet ? petDisplayName(selectedPet) : undefined,
            selectedPetOnExpedition: isPetOnExpedition(selectedPet),
            opponentPetName: opponent ? petDisplayName(opponent.pet) : undefined,
            opponentOnExpedition: opponent ? isPetOnExpedition(opponent.pet) : false,
        });
        if (startIssue) return alert(startIssue);
        // The pure preflight above establishes these invariants for TypeScript and
        // keeps audio/state changes strictly after every synchronous rejection.
        if (!selectedPet || !opponent) return;
        if (!playerAuthorityIsActive(battleScope)) return;
        if (opponent.ranked && !opponent.petRankedToken) {
            showBattleSetupIssue(
                battleScope,
                "The ranked match proof is missing. The duel was not started and no rating can change.",
                () => { void startBattle(opponent); },
            );
            return;
        }

        setChronicleCeremony(null);
        setChronicleProgress(null);
        resetPetSettlement();
        setBattleSetupIssue(null);
        battleSetupRetryRef.current = null;
        setArenaView("battle"); // any duel (incl. challenge accepts) shows in the battle view
        primePetSfx(); // unlock the audio context inside the click gesture
        const pendingClanPetBattle = loadPendingClanPetBattle();
        // Also cover instant incoming challenges, which can bypass the ordinary
        // matchup-card dwell time used by the preload effect above.
        void preloadPetColiseumModels([selectedPet, opponent.pet]).catch(() => undefined);
        setWatchedDuel(null); // fresh fight — clear any prior replay
        setDuelBattle(null);
        const nextDuelId = duelNonce + 1; // React key for the duel renderer
        setDuelNonce(nextDuelId);

        // ── Ranked 1v1 (account-level pet ladder) ───────────────────────
        if (opponent.ranked) {
            /*
             * RANKED IS WATCHED, NOT SIMULATED.
             *
             * This branch used to run `runPetDuelCinematic` locally over
             * `opponent.battleSeed` — a clock-derived number the challenger made
             * up and shipped inside the challenge. The SERVER, meanwhile, rated
             * the match by running a DIFFERENT engine (the plain duel sim) over
             * the match token's OWN server-minted seed. Two engines, two seeds,
             * one rating: the fight on screen had no reliable relationship to
             * the Elo it moved, and a convincing victory could be recorded as a
             * loss with nothing to distinguish it from an honest one.
             *
             * Now the server resolves once (api/pet/_ranked-duel.ts) and
             * /api/pet/ranked-watch hands back that resolution's event log. We
             * play it. The winner comes back as an ACCOUNT NAME, so both
             * participants read the same answer off the same object.
             */
            const myPet = opponent.selfPet ?? selectedPet;
            // Keep the picker (and thus the on-grid sprite) in sync with the
            // locked combatant if they diverged after navigation.
            if (opponent.selfPet && opponent.selfPet.id !== selectedPetId) setSelectedPetId(opponent.selfPet.id);
            const watched = await fetchRankedPetDuel(opponent.petRankedToken!);
            if (!playerAuthorityIsActive(battleScope)) return;
            if (!watched) {
                // No local fallback, deliberately. A locally simulated ranked
                // fight is exactly the bug this replaced: it would show an
                // outcome the server never agreed to. Better to show nothing and
                // let the player retry than to show a lie.
                showBattleSetupIssue(
                    battleScope,
                    "The ranked match could not be loaded from the arena. Your rating is untouched — retry when the connection is stable.",
                    () => { void startBattle(opponent); },
                );
                return;
            }
            const myResult: "win" | "loss" = watched.winnerName === character.name ? "win" : "loss";
            startBattleMusic();
            setBattleOpponent(opponent);
            setBattleReady(true);
            setDuelNonce(nextDuelId);
            setWatchedDuel({ script: watched.script, playerPets: [myPet], id: nextDuelId });
            setBattleLog([]);
            setResult(myResult === "win" ? "Victory" : "Defeat");
            const myRating = character.petRankedRating ?? 1000;
            const oppRating = opponent.opponentRating ?? 1000;
            // Read-back + activation (audit #7 / Stage 3): the SERVER owns the
            // petRankedRating swing. Report the outcome to /api/pet/battle-result
            // (ranked) — which credits the rating under a save lock, exactly once
            // per MATCH TOKEN — and read the returned committed character back as
            // the authoritative value. Offline/503 leaves rating and counters
            // unchanged until retry.
            //
            // The reportKey is derived from the match token rather than from the
            // challenger's clock seed: the token is the match's real identity, so
            // the key is identical on both clients and stable across a refresh.
            // (The seed it used to key off was the same client-invented number
            // the retired local simulation ran on.) petRankedRating is absolute
            // and server-owned; the counters carry relative deltas applied off
            // `prev` inside the updater so a heartbeat landing mid-fetch cannot
            // clobber them.
            const reportRankedPet = (outcome: "win" | "loss" | "draw") => {
                if (!playerScopeIsActive(battleScope)) return;
                const matchToken = opponent.petRankedToken!;
                const reportKey = `${matchToken}:ranked`;
                const settlementBody = {
                    playerName: battleScope.playerName,
                    outcome,
                    ranked: true,
                    matchToken,
                    opponentName: opponent.owner,
                    opponentLevel: opponent.pet.level,
                    reportKey,
                };
                beginPetSettlement({
                    id: `ranked:${matchToken}:${reportKey}`,
                    kind: "ranked",
                    label: "Ranked Pet Coliseum result",
                    scope: battleScope,
                    run: async () => {
                        const data = await postPetBattleSettlement(settlementBody);
                        if (!playerScopeIsActive(battleScope)) return false;
                        return applyPetBattleSettlement(data, battleScope, [myPet.id]);
                    },
                });
            };
            // Showdown's judge always decides, so a ranked pet duel no longer
            // draws; the outcome posted here is the SERVER's own verdict read
            // back off the watch response, and the server re-derives it anyway
            // rather than trusting the body.
            if (myResult === "win") {
                const gain = rankedDelta(myRating, oppRating);
                reportRankedPet("win");
                setBattleLog([`🏆 Ranked pet victory! Arena settlement requested (projected +${gain} Elo).`]);
            } else {
                const drop = rankedDelta(oppRating, myRating);
                reportRankedPet("loss");
                setBattleLog([`Ranked pet defeat. Arena settlement requested (projected -${drop} Elo).`]);
            }
            if (pendingClanPetBattle) savePendingClanPetBattle(null);
            return;
        }

        /*
         * ── World-initiated PvE duel (a sector wanderer) ────────────────
         *
         * The ONE fight this screen still resolves locally. The World Map sends
         * the player here with a specific roaming beast as the opponent, and
         * Showdown has no entry that accepts a caller-named opponent of that
         * shape: the authored-encounter entry takes a dungeon run token or an
         * admin-authored event id, and the arena entry picks the opponent
         * itself. Porting it means a new server-side selector (a wanderer id
         * the server resolves into a beast), which is its own piece of work —
         * so until then this stays on the legacy engine rather than losing a
         * live world feature.
         *
         * The screen no longer offers this fight from a picker of its own. It
         * only ever arrives as an override from the world.
         */
        if (!opponent.pvpChallengeId) {
            const battleSeal1v1 = await mintCasualPetBattleToken(battleScope, opponent, "1v1", [selectedPet], [opponent.pet]);
            if (!playerAuthorityIsActive(battleScope)) return;
            if (!battleSeal1v1) {
                showBattleSetupIssue(
                    battleScope,
                    "The pet battle seal could not be created. No duel was started and no result was put at risk.",
                    () => { void startBattle(opponent); },
                );
                return;
            }
            const battlePlayerPet = battleSeal1v1.playerPets?.[0]
                ? restoreSealedPetCosmetics(battleSeal1v1.playerPets[0], selectedPet)
                : selectedPet;
            const battleOpponentPet = battleSeal1v1.opponentPets?.[0]
                ? restoreSealedPetCosmetics(battleSeal1v1.opponentPets[0], opponent.pet)
                : opponent.pet;
            const seed1v1 = battleSeal1v1.seed;
            const reportKey1v1 = battleSeal1v1.reportKey;
            startBattleMusic();
            if (battlePlayerPet.loadout?.consumable) {
                clearSpentConsumables([battlePlayerPet.id], battleScope);
            }
            setBattleOpponent(opponent);
            setBattleReady(true);
            // PvE mastery modifiers apply only against a built-in AI opponent,
            // and a wanderer is one. Player control runs the fight live and
            // commanded; battle-result re-derives the outcome by replaying the
            // input log against the seal, so the reward matches what was played.
            const pveOpp = isGenericPetOpponent(opponent.pet);
            const controlled = pveOpp && petPlayerControlEnabled();
            const dmgMult = battleSeal1v1.battleConfig?.damageMult ?? (pveOpp ? petTamerPveMultiplier(character) : 1);
            const hpMult = battleSeal1v1.battleConfig?.hpMult ?? (pveOpp ? petPveHpMult(character) : 1);
            const revive = battleSeal1v1.battleConfig?.revive ?? (pveOpp ? petAlphaBond(character) : false);
            const applyItems = battleSeal1v1.battleConfig?.applyItems ?? true;
            const accuracy = battleSeal1v1.battleConfig?.accuracy;
            const terrain = battleSeal1v1.battleConfig?.terrain ?? null;
            const liveDuel = controlled
                ? createLiveDuel(battlePlayerPet, battleOpponentPet, seed1v1, dmgMult, hpMult, revive, applyItems, accuracy, terrain)
                : null;
            const duel = controlled
                ? null
                : runPetDuelCinematic(battlePlayerPet, battleOpponentPet, seed1v1, dmgMult, hpMult, revive, applyItems, accuracy, terrain);
            const settle1v1 = (outcome: "win" | "loss" | "draw") => {
                if (!playerAuthorityIsActive(battleScope)) return;
                const battleToken = battleSeal1v1.token;
                const inputLog = liveDuel?.inputLog();
                setResult(outcome === "win" ? "Victory" : outcome === "draw" ? "Draw" : "Defeat");
                // Losses and draws settle too: the token must be redeemed so it
                // cannot be reused and one-use consumables settle durably.
                const settlementBody = {
                    playerName: battleScope.playerName,
                    outcome,
                    opponentLevel: opponent.pet.level,
                    reportKey: reportKey1v1,
                    battleToken,
                    inputLog,
                };
                beginPetSettlement({
                    id: `casual:${battleToken}:${reportKey1v1}`,
                    kind: "casual",
                    label: "Pet Coliseum result",
                    scope: battleScope,
                    run: async () => {
                        const data = await postPetBattleSettlement(settlementBody);
                        if (!playerScopeIsActive(battleScope)) return false;
                        const applied = applyPetBattleSettlement(data, battleScope, [battlePlayerPet.id]);
                        if (applied && data.capped) {
                            setBattleLog(["Daily Pet Coliseum reward cap reached — wins still count, but no more ryo today."]);
                        }
                        return applied;
                    },
                });
                if (pendingClanPetBattle) savePendingClanPetBattle(null);
            };
            setDuelBattle({
                result: duel, live: liveDuel, onOutcome: (r) => settle1v1(r.result),
                playerPet: battlePlayerPet, enemyPet: battleOpponentPet, seed: seed1v1, id: nextDuelId,
            });
            setBattleLog([]);
            // A watch-only duel is already decided, so it settles immediately.
            if (duel) settle1v1(duel.result);
            return;
        }

        /*
         * ── Player challenge, 1v1 or 2v2 ────────────────────────────────
         *
         * ALSO WATCHED, and for the same reason ranked is. This branch used to
         * mint a token, take the seed that came back, and run the cinematic
         * locally — while the server had already sealed its own verdict from
         * that seed using a different engine. Worse, each participant minted a
         * SEPARATE token with a SEPARATE random seed, so the challenger and the
         * responder were rated on two unrelated fights and both could be told
         * they had won.
         *
         * The duel is now sealed against the challenge when it is accepted
         * (api/pet/_pvp-duel.ts): one seed, both rosters, one verdict. The call
         * below returns that fight, and the outcome posted back is the server's
         * own — which it re-derives from the seal at settlement rather than
         * trusting this body.
         *
         * Consumables do not fire in a sealed duel (the fight is decided before
         * either side settles, so a burned item could never be honestly
         * charged), which is why nothing is cleared here.
         */
        const myPets = pvpParty ? opponent.challengerParty! : [opponent.selfPet ?? selectedPet];
        const theirPets = pvpParty ? opponent.opponentParty! : [opponent.pet];
        const mode: "1v1" | "2v2" = pvpParty ? "2v2" : "1v1";
        const battleSeal = await mintCasualPetBattleToken(battleScope, opponent, mode, myPets, theirPets);
        if (!playerAuthorityIsActive(battleScope)) return;
        if (!battleSeal) {
            showBattleSetupIssue(
                battleScope,
                "This duel could not be loaded from the arena. Nothing was fought and no result is at risk — retry when the connection is stable.",
                () => { void startBattle(opponent); },
            );
            return;
        }
        if (!battleSeal.script || !battleSeal.outcome) {
            // mintCasualPetBattleToken only returns a challenge seal with both
            // present; this narrows for TypeScript and fails closed if that ever
            // stops being true, rather than showing a fight nobody resolved.
            showBattleSetupIssue(
                battleScope,
                "This duel came back without its fight. Nothing was settled — retry when the connection is stable.",
                () => { void startBattle(opponent); },
            );
            return;
        }
        const myOutcome = battleSeal.outcome;
        startBattleMusic();
        setBattleOpponent(opponent);
        setBattleReady(true);
        setWatchedDuel({ script: battleSeal.script, playerPets: myPets, id: nextDuelId });
        setBattleLog([]);
        setResult(myOutcome === "win" ? "Victory" : "Defeat");
        // Clan-war auto-report: the helper no-ops without a sessionStorage stash
        // and a matching opponent name, so it is safe for every challenge duel.
        // What it reports is now the SERVER's verdict, not this client's — the
        // two participants can no longer file contradictory results.
        if (onClanWarBattleEnd) onClanWarBattleEnd(myOutcome === "win", opponent.owner);
        const battleToken = battleSeal.token;
        const reportKey = battleSeal.reportKey;
        const settlementBody = {
            playerName: battleScope.playerName,
            outcome: myOutcome,
            opponentLevel: opponent.pet.level,
            reportKey,
            battleToken,
        };
        const isParty = mode === "2v2";
        beginPetSettlement({
            id: `${isParty ? "party" : "casual"}:${battleToken}:${reportKey}`,
            kind: isParty ? "party" : "casual",
            label: isParty ? "2v2 Pet Coliseum result" : "Pet Coliseum result",
            scope: battleScope,
            run: async () => {
                const data = await postPetBattleSettlement(settlementBody);
                if (!playerScopeIsActive(battleScope)) return false;
                const applied = applyPetBattleSettlement(data, battleScope, myPets.map((pet) => pet.id));
                if (applied && data.capped) {
                    setBattleLog(["Daily Pet Coliseum reward cap reached — wins still count, but no more ryo today."]);
                }
                return applied;
            },
        });
        if (pendingClanPetBattle) savePendingClanPetBattle(null);
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
        const size = pendingArenaMatch.size;
        const blueIds = new Set(pendingArenaMatch.blue.map((pet) => pet.id));
        const redIds = new Set(pendingArenaMatch.red.map((pet) => pet.id));
        if (blueIds.size !== size || redIds.size !== size || pendingArenaMatch.blue.length < size || pendingArenaMatch.red.length < size) {
            setArenaChallengeMsg(`This ${size}v${size} match was missing a full team and could not start.`);
            onPendingArenaMatchStarted?.();
            return;
        }
        void startArenaMatch(pendingArenaMatch.blue, pendingArenaMatch.red, pendingArenaMatch.seed);
        onPendingArenaMatchStarted?.();
    }, [pendingArenaMatch?.seed]);

    // Responder side: an incoming arena challenge arrived → open the tactical
    // view's responder picker, pre-selecting my top pets at the challenge's size.
    useEffect(() => {
        if (!pendingArenaResponse) return;
        setArenaView("tactical");
        setRespondPicks(pickArenaTeam(combatEligiblePets, arenaSizeOf(pendingArenaResponse)).map((p) => p.id));
    }, [pendingArenaResponse?.id]);

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
    const returnScreen = petArenaReturnScreen(pendingPetBattleOpponent?.returnScreen || battleOpponent?.returnScreen);
    const showPetHomeTabs = !pendingPetBattleOpponent
        && !pendingArenaMatch
        && !pendingArenaResponse
        && !fullscreenBattleActive
        && !showCoop;
    const availableArenaPetCount = availablePetBattleCount(combatEligiblePets);
    const tacticalArenaUnlocked = canEnterTacticalArena(combatEligiblePets);
    const activeSettlementPresentation = settlementPresentation
        && playerScopeIsActive(settlementPresentation.scope)
        ? settlementPresentation
        : null;
    const activeSettlementAttempt = settlementAttemptRef.current
        && playerScopeIsActive(settlementAttemptRef.current.scope)
        ? settlementAttemptRef.current
        : null;
    const petSettlementBlocksExit = Boolean(
        activeSettlementAttempt && activeSettlementAttempt.status !== "settled",
    );
    const warfrontResultActionsLocked = Boolean(
        chronicleCeremony
        || (arenaMatch?.vsAi && (!activeSettlementAttempt || activeSettlementAttempt.status !== "settled")),
    );
    const activeBattleSetupIssue = battleSetupIssue && playerScopeIsActive(battleSetupIssue.scope)
        ? battleSetupIssue
        : null;
    const retryPetSettlement = () => {
        const attempt = settlementAttemptRef.current;
        if (attempt?.status === "error" && playerScopeIsActive(attempt.scope)) {
            void runPetSettlementAttempt(attempt);
        }
    };
    const canLeaveCurrentPetBattle = () => {
        if (petSettlementBlocksExit) {
            alert(activeSettlementAttempt?.status === "error"
                ? "This result is not recorded yet. Use Retry Settlement before leaving; the same battle receipt will be replayed safely."
                : "The arena is still recording this result. You can leave as soon as the receipt is confirmed.");
            return false;
        }
        return true;
    };
    const leaveCurrentPetBattle = () => {
        if (!canLeaveCurrentPetBattle()) return;
        setBattleOpponent(null);
        setBattleReady(false);
        setWatchedDuel(null);
        setDuelBattle(null);
        setScreen(returnScreen);
    };
    const duelChronicleResultSupplement = chronicleProgress || chronicleCeremony ? (
        <>
            {chronicleProgress ? <PetChronicleProgress receipt={chronicleProgress} /> : null}
            {chronicleCeremony ? (
                <PetChronicleCeremony
                    receipt={chronicleCeremony}
                    onDismiss={() => setChronicleCeremony(null)}
                    onOpenCardHall={() => {
                        setChronicleCeremony(null);
                        setChronicleProgress(null);
                        setScreen("shinobiTiles");
                    }}
                />
            ) : null}
        </>
    ) : undefined;

    // Render one pet as a visual pick-card (portrait + role badge + level/element).
    // Shared by the cinematic battle view's pickers below — replaces the bare
    // <select> dropdowns so picking a pet is a tap on its art, not a text line.
    const petPickCard = (key: string, pet: Pet, sel: boolean, onClick: () => void, opts?: { owner?: string; dim?: boolean }) => {
        const img = petCardImage(pet, sharedImages);
        const { role } = pet.role && pet.subRole ? { role: pet.role } : derivePetRole(pet);
        const rm = ROLE_META[role];
        const name = petDisplayName(pet);
        return (
            <button key={key} type="button"
                className={`pet-pick${sel ? " selected" : ""} ${petVisualVariantClass(pet)}`}
                title={opts?.dim ? `${name} is exploring and unavailable` : opts?.owner ? `${opts.owner}: ${name}` : name}
                aria-pressed={sel}
                disabled={opts?.dim}
                style={opts?.dim ? { opacity: 0.5 } : undefined}
                onClick={onClick}>
                {img
                    ? <img className="pet-pick-img" src={img} alt="" />
                    : <div className="pet-pick-img placeholder" />}
                <span className="pet-pick-name">{name}</span>
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
            {activeSettlementPresentation && typeof document !== "undefined" && createPortal(
                <aside
                    className="pet-settlement-notice"
                    data-status={activeSettlementPresentation.status}
                    role={activeSettlementPresentation.status === "error" ? "alert" : "status"}
                    aria-live={activeSettlementPresentation.status === "error" ? "assertive" : "polite"}
                    aria-atomic="true"
                >
                    <span className="pet-settlement-notice__eyebrow">Sealed battle record</span>
                    <strong>{activeSettlementPresentation.label}</strong>
                    <p>
                        {activeSettlementPresentation.status === "pending"
                            ? "Recording the sealed result. Keep this battle open."
                            : activeSettlementPresentation.detail}
                    </p>
                    {activeSettlementPresentation.status === "error" ? (
                        <button type="button" onClick={retryPetSettlement}>Retry Settlement</button>
                    ) : activeSettlementPresentation.status === "settled" ? (
                        <button type="button" onClick={() => setSettlementPresentation(null)}>Dismiss</button>
                    ) : null}
                </aside>,
                document.body,
            )}
            {activeBattleSetupIssue && typeof document !== "undefined" && createPortal(
                <aside className="pet-settlement-notice" data-status="error" role="alert" aria-live="assertive" aria-atomic="true">
                    <span className="pet-settlement-notice__eyebrow">Battle authority</span>
                    <strong>Warfront needs attention</strong>
                    <p>{activeBattleSetupIssue.message}</p>
                    <button
                        type="button"
                        onClick={() => {
                            const retry = battleSetupRetryRef.current;
                            setBattleSetupIssue(null);
                            if (retry) retry();
                        }}
                    >
                        Retry Battle Setup
                    </button>
                </aside>,
                document.body,
            )}
            {showPetHomeTabs ? <PetHomeTabs active="arena" setScreen={setScreen} /> : null}
            <div className="pet-arena-header">
                {/* Back button label adapts to context — Hollow Gate pet
                    duels route back to the shrine, not the central hub. */}
                <button
                    className="back-btn"
                    onClick={leaveCurrentPetBattle}
                >
                    {petArenaBackLabel(returnScreen)}
                </button>
                <div>
                    {(pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate") ? (
                        <>
                            <h2 style={{ color: "var(--purple-500)" }}>⛩ Hollow Gate — Hollow Hound Duel</h2>
                            <p className="hint" style={{ color: "#c4b5fd" }}>Your pet faces a corrupted Hollow Hound. Win to claim victory and continue the run; lose to take 20% HP damage and return to the shrine.</p>
                        </>
                    ) : (
                        <>
                            <h2>{arenaView === "tactical" ? "Hollow Warfront" : arenaView === "gauntlet" ? "Pet Gauntlet" : "Pet Coliseum"}</h2>
                            <p className="hint">{
                                pendingClanPetBattle
                                    ? `Clan war pet battle pending against ${pendingClanPetBattle.opponentName}. Win to earn ${pendingClanPetBattle.points} clan points.`
                                    : arenaView === "tactical"
                                        ? "Command a 4v4 lane war: defend your Guardian Totems, spend bounty at the War Council, and break the enemy Ward Seal before Judgment."
                                        : arenaView === "gauntlet"
                                            ? "Roguelike run — draft a one-time squad, chase element & role synergies, and survive escalating rounds. Clear rounds to earn ryo and rare materials."
                                            : "Cinematic 1v1 & 2v2 duels — your pet approaches, kites, dodges, trades elemental strikes and unleashes ultimates on its own. You build the pet; it fights the duel."
                            }</p>
                        </>
                    )}
                </div>
            </div>

            {/* Top-level view tabs — the cinematic duel vs the Hollow Warfront mode. */}
            {(
                <div className="pet-arena-mode-toggle" style={{ maxWidth: 660, marginBottom: 14 }}>
                    <button type="button" className={arenaView === "battle" ? "active" : ""} aria-pressed={arenaView === "battle"} onClick={() => setArenaView("battle")}>
                        ⚔️ Pet Coliseum
                    </button>
                    <button
                        type="button"
                        className={arenaView === "tactical" ? "active" : ""}
                        aria-pressed={arenaView === "tactical"}
                        disabled={!tacticalArenaUnlocked}
                        title={!tacticalArenaUnlocked ? `Locked: ${availableArenaPetCount}/${TACTICAL_ARENA_PET_REQUIREMENT} available pets` : undefined}
                        onClick={() => setArenaView("tactical")}
                    >
                        🏟️ Hollow Warfront
                    </button>
                    {!tacticalArenaUnlocked && (
                        <span className="hint" style={{ alignSelf: "center", color: "var(--gold-2)", fontSize: "0.75rem" }}>
                            Locked: {availableArenaPetCount}/{TACTICAL_ARENA_PET_REQUIREMENT} pets
                        </span>
                    )}
                    <button type="button" className={arenaView === "gauntlet" ? "active" : ""} aria-pressed={arenaView === "gauntlet"} onClick={() => setArenaView("gauntlet")}>
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
            {(
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
                            {preservedPetOverflow} preserved overflow {preservedPetOverflow === 1 ? "companion is" : "companions are"} resting from combat. Swap safely in the Sanctuary.
                        </p>
                    )}
                    {selectedPet && <PetArenaCard owner="You" pet={selectedPet} sharedImages={sharedImages} />}
                    {selectedPet && <MatchupHint element={selectedPet.element} />}
                </section>

                <section className="summary-box pet-arena-selector">
                    <h3>Challenge a Player</h3>
                    {/* The built-in AI opponent list is gone from this screen.
                        A practice fight against the arena's own pets is what the
                        Coliseum entry does — one engine, arena-matched, with the
                        daily faucet checked before you walk in — so offering a
                        second, differently-resolved version of the same fight
                        here was the split this port exists to close. What is
                        left is what only this screen does: challenging a person. */}
                    <label htmlFor="pet-arena-player-search">Search Player Name</label>
                    <input id="pet-arena-player-search" value={opponentSearch} onChange={(e) => { setOpponentSearch(e.target.value); setPetChallengeMsg(""); }} placeholder="Search by player name" />
                    {(
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
                                    <div>🏛 Want a fight right now? The Coliseum matches you against the arena.</div>
                                </div>
                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                            </div>
                        )
                    )}
                </section>
            </div>

            {combatEligiblePets.length >= 2 && (
                <div className="summary-box" style={{ marginTop: "0.4rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                        <input type="checkbox" checked={partyMode} onChange={(e) => setPartyMode(e.target.checked)} />
                        <strong>🐾🐾 2v2 Party Battle</strong>
                        <span className="hint" style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
                            Challenges the target to a 2v2. They need 2 pets too — otherwise it falls back to 1v1.
                        </span>
                    </label>
                    {partyMode && (
                        <div style={{ marginTop: "0.5rem" }}>
                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Reserve pet (faces their reserve in match 2)</label>
                            <div className="pet-pick-panel" style={{ marginTop: 6 }}>
                                <div className="pet-pick-grid">
                                    <button type="button"
                                        className={`pet-pick pet-pick-auto${reservePetId === "" ? " selected" : ""}`}
                                        aria-pressed={reservePetId === ""}
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

            {/* THE COLISEUM. One mode, two doors:
                  • the Coliseum bout — the arena matches you, the daily win cap
                    applies, and a win pays. This is the reward loop.
                  • Training Grounds — pick your own tier and fight without
                    limit. Sparring: it pays nothing and moves no counters.
                Both run the same turn-based engine; the difference is who
                chooses the fight and whether it pays. */}
            <div className="menu pet-coliseum-entry" style={{ marginBottom: 12 }}>
                <button className="pet-coliseum-enter" onClick={() => setScreen("petColiseum")}>
                    <span>🏟️ Enter the Coliseum</span>
                    <small>The arena picks your challenger and the purse is real — cinematic turn-based 1v1 · 2v2 · 3v3, up to {SHOWDOWN_DAILY_WIN_CAP} paid wins a day.</small>
                </button>
                <button className="pet-coliseum-enter" onClick={() => setScreen("petShowdown")}>
                    <span>🥋 Training Grounds</span>
                    <small>Choose your own opposition and drill as long as you like. No purse, no limit.</small>
                </button>
            </div>

            {/* The fight card that used to live here started an AI exhibition
                from this screen's own picker. Both doors above start one on the
                shared engine instead, so there is nothing left to pick: a duel
                arrives when a player accepts your challenge. */}
            {battleReady && result && (
                <div className="menu pet-coliseum-entry">
                    <strong className={result === "Victory" ? "pet-arena-win" : "pet-arena-loss"}>{result}</strong>
                </div>
            )}

            {/* Live PvP: the invite prompt, the "waiting to be accepted" notice and
                the fight itself all live here. Renders nothing when idle. */}
            <PetDuelLiveHost
                ref={liveDuelRef}
                myPets={[selectedPet, partyMode ? combatEligiblePets.find((p) => p.id === reservePetId) : null].filter((p): p is Pet => !!p)}
                onError={(message) => setPetChallengeMsg(`❌ ${message}`)}
                onOutcome={(outcome, opponent) => {
                    setResult(outcome === "win" ? "Victory" : outcome === "draw" ? "Draw" : "Defeat");
                    setPetChallengeMsg(outcome === "win" ? `✅ You beat ${opponent}!` : outcome === "draw" ? `Draw with ${opponent}.` : `${opponent} won that one.`);
                    // Clan-war pet battles still record through the existing helper;
                    // it no-ops when this fight was not part of one.
                    onClanWarBattleEnd?.(outcome === "draw" ? "draw" : outcome === "win", opponent);
                }}
                sharedImages={sharedImages}
            />

            {/* THE BATTLEFIELD. Every duel this screen starts is a replay of a
                fight the SERVER resolved — ranked from its match token, a player
                challenge from the duel sealed when it was accepted. So there is
                one renderer here rather than three, no onOutcome to honour (the
                settlement already fired against the server's own verdict), and
                no "fight again": a challenge is spent, and a rematch is a new
                challenge. The HD-2D coliseum renderer and the continuous duel
                player are both gone from this path. */}
            {battleReady && selectedPet && battleOpponent && (watchedDuel || duelBattle) && (
                <div ref={battlefieldRef} className="pet-arena-stage-wrap" style={{ scrollMarginTop: "12px" }}>
                    {watchedDuel ? (
                    <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the arena…</div>}>
                        <PetShowdownReplay
                            key={watchedDuel.id}
                            script={watchedDuel.script}
                            playerPets={watchedDuel.playerPets}
                            sharedImages={sharedImages}
                            onExit={leaveCurrentPetBattle}
                        />
                    </Suspense>
                    ) : duelBattle ? (
                    // The wanderer duel: resolved locally, played by the
                    // continuous-duel renderer. "Fight again" is offered here
                    // because a roaming beast is a repeatable world encounter,
                    // unlike a challenge, which is spent when it resolves.
                    <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the arena…</div>}>
                        <PetColiseumDuel
                            key={duelBattle.id}
                            playerPet={duelBattle.playerPet}
                            enemyPet={duelBattle.enemyPet}
                            seed={duelBattle.seed}
                            result={duelBattle.result ?? undefined}
                            live={duelBattle.live ?? undefined}
                            onOutcome={duelBattle.onOutcome}
                            sharedImages={sharedImages}
                            onFightAgain={battleOpponent?.ranked || petSettlementBlocksExit || chronicleCeremony ? undefined : () => void startBattle(battleOpponent ?? undefined)}
                            resultSupplement={duelChronicleResultSupplement}
                            onExit={leaveCurrentPetBattle}
                        />
                    </Suspense>
                    ) : null}
                    {/* The Chronicle receipt used to ride inside the retired
                        result overlay's `resultSupplement` slot, and the wanderer
                        duel above still fills that slot. The replay player has no
                        such slot, so for a watched duel a won card would be
                        awarded invisibly — it renders under the arena instead.
                        Guarded on `watchedDuel` so the two never both show it. */}
                    {watchedDuel ? duelChronicleResultSupplement : null}
                </div>
            )}

            <section className="summary-box pet-arena-log" role="log" aria-label="Pet battle log" aria-live="polite" aria-relevant="additions text">
                <h3>Battle Log</h3>
                {visibleLog.length === 0 ? <p className="hint">Start a match to watch the pets fight.</p> : visibleLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </section>
            </>
            )}

            {/* ── Hollow Warfront view ───────────────────────────────────────
                One screen: a team-size toggle + a team grid, then Fight AI /
                Challenge a Player / Co-op. An INCOMING challenge swaps in a
                responder picker. The match plays via the arenaMatch overlay
                below (after the countdown). */}
            {arenaView === "tactical" && (
                <section className="summary-box" style={{ marginTop: "0.2rem", display: "grid", gap: "0.9rem" }}>
                    <div className="pet-arena-hero" style={{ backgroundImage: `url(${tacticalArenaHero})`, marginBottom: 0 }}>
                        <h3 className="hero-title">⛩ Hollow Warfront</h3>
                        <p className="hero-sub">
                            A lane war on a huge 3D battlefield: hollow-spawn pour from the central Hollow Gate breach, two Guardian Totems ward each village outpost, and shattering the enemy WARD SEAL wins. Every kill pays bounty coins — spend them at the 90-second War Council, where you can also switch your team's formation. Ten minutes; Ward Seal or Judgment. Beat the AI team to earn pet-arena ryo (daily cap applies).
                        </p>
                    </div>

                    {(() => {
                        const available = combatEligiblePets.filter((p) => !isPetOnExpedition(p));
                        const availableById = new Map(available.map((pet) => [pet.id, pet]));
                        const isExactAvailableSelection = (ids: string[], size: number) => (
                            ids.length === size
                            && new Set(ids).size === size
                            && ids.every((id) => availableById.has(id))
                        );
                        // Reusable pet-pick grid — tap to add/remove (capped at `max`).
                        // Each slot is a roomy card: a large portrait, the pet's name,
                        // its native combat role badge (so the player can build a
                        // balanced comp at a glance), and a level/element line. The
                        // order badge in the corner shows battle order when picked.
                        const pickGrid = (picks: string[], setPicks: (ids: string[]) => void, max: number) => (
                            <div className="pet-pick-grid">
                                {available.map((pet) => {
                                    const sel = picks.includes(pet.id);
                                    const order = picks.indexOf(pet.id);
                                    const img = petCardImage(pet, sharedImages);
                                    const { role, subRole } = pet.role && pet.subRole ? { role: pet.role, subRole: pet.subRole } : derivePetRole(pet);
                                    const rm = ROLE_META[role];
                                    const atMax = !sel && picks.length >= max;
                                    return (
                                        <button key={pet.id} type="button"
                                            className={`pet-pick${sel ? " selected" : ""} ${petVisualVariantClass(pet)}`}
                                            title={rm ? `${petDisplayName(pet)} — ${rm.label} (${subRole})` : petDisplayName(pet)}
                                            aria-pressed={sel}
                                            disabled={atMax}
                                            style={atMax ? { opacity: 0.45 } : undefined}
                                            onClick={() => setPicks(sel ? picks.filter((x) => x !== pet.id) : atMax ? picks : [...picks, pet.id])}>
                                            {sel && <span className="pet-pick-order">{order + 1}</span>}
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
                        if (pendingArenaResponse) {
                            const size = arenaSizeOf(pendingArenaResponse);
                            return (
                                <div style={{ display: "grid", gap: "0.6rem" }}>
                                    <strong>⚔️ {pendingArenaResponse.fromName} challenged you to a {size === 4 ? "4v4" : "2v2"}!</strong>
                                    <p className="hint" style={{ margin: 0 }}>Pick up to {size} pets, then accept — the match begins after a short countdown.</p>
                                    {available.length < size
                                        ? <p className="hint" style={{ color: "var(--gold-2)" }}>You need {size} available pets to accept this {size}v{size} challenge. You currently have {available.length}.</p>
                                        : <div className="pet-pick-panel">{pickGrid(respondPicks, setRespondPicks, size)}</div>}
                                    <div className="menu">
                                        <button disabled={!isExactAvailableSelection(respondPicks, size)} style={{ background: "#16a34a" }}
                                            onClick={() => void respondToArenaChallenge(pendingArenaResponse, respondPicks)}>
                                            Accept &amp; Start ({respondPicks.length}/{size})
                                        </button>
                                        <button className="danger-button" onClick={() => { setRespondPicks([]); onArenaResponseHandled?.(); }}>Decline</button>
                                    </div>
                                </div>
                            );
                        }

                        // ── Single screen: council preference + team grid + actions ───
                        // (Warfront is always 4v4 — the old 2v2 size toggle retired with
                        // the capture-scroll mode.)
                        const canStart = isExactAvailableSelection(tacticalPicks, tacticalSize);
                        const selectedTacticalPets = tacticalPicks
                            .map((id) => availableById.get(id))
                            .filter((pet): pet is Pet => Boolean(pet));
                        return (
                            <div style={{ display: "grid", gap: "0.7rem" }}>
                                <div className="pet-arena-tactical-top">
                                    <div style={{ display: "grid", gap: "0.7rem", alignContent: "start" }}>
                                        <div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>📯 War Council (every 90s)</p>
                                            <div className="pet-arena-mode-toggle" role="group" aria-label="War Council control" style={{ maxWidth: 470, marginTop: 6 }}>
                                                {(["balanced", "offense", "defense"] as const).map((p) => (
                                                    <button key={p} type="button" className={wfAutoPref === p ? "active" : ""} aria-pressed={wfAutoPref === p} onClick={() => setWfAuto(p)}>
                                                        {p === "balanced" ? "⚖ Auto-Balanced" : p === "offense" ? "🗡 Auto-Attack" : "🛡 Auto-Guard"}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>Rewarded AI uses the automatic policy you seal at kickoff. The arena replays that exact plan, so rewards always match the fight you watched.</p>
                                        </div>

                                        <div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>📜 Opening formation</p>
                                            <div className="pet-arena-mode-toggle" role="group" aria-label="Opening formation" style={{ maxWidth: 620, marginTop: 6, flexWrap: "wrap" }}>
                                                {WF_STANCES.map((s) => (
                                                    <button key={s.id} type="button" title={s.desc} className={wfStancePref === s.id ? "active" : ""} aria-pressed={wfStancePref === s.id} onClick={() => setWfStance(s.id)}>
                                                        {s.icon} {s.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>Your formation is sealed at kickoff. The AI rival always fields Balanced formation.</p>
                                        </div>

                                        <div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>🎖 Team doctrine</p>
                                            <div className="pet-arena-mode-toggle" role="group" aria-label="Team doctrine" style={{ maxWidth: 620, marginTop: 6, flexWrap: "wrap" }}>
                                                {WF_DOCTRINES.map((d) => (
                                                    <button key={d.id} type="button" title={d.desc} className={wfDoctrinePref === d.id ? "active" : ""} aria-pressed={wfDoctrinePref === d.id} onClick={() => setWfDoctrine(d.id)}>
                                                        {d.icon} {d.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>Choose your sealed team-wide boon. The AI rival always fields Vanguard doctrine.</p>
                                        </div>

                                        <div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Your team ({tacticalPicks.length}/{tacticalSize}) — choose pets to add or remove</p>
                                            <div style={{ marginTop: 6 }}>
                                                {available.length < tacticalSize
                                                    ? <p className="hint" style={{ color: "var(--gold-2)", margin: 0 }}>This 4v4 mode requires {tacticalSize} available pets. You currently have {available.length}; pets on expeditions do not count.</p>
                                                    : <div className="pet-pick-panel">{pickGrid(tacticalPicks, setTacticalPicks, tacticalSize)}</div>}
                                            </div>
                                        </div>
                                    </div>

                                    <BattlePlan pets={selectedTacticalPets} size={tacticalSize} />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.7rem" }}>
                                    <div className="summary-box" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
                                        <strong>🤖 Fight AI</strong>
                                        <p className="hint" style={{ margin: 0 }}>Fixed rival plan: Balanced formation · Vanguard doctrine. Both squads are sealed before kickoff.</p>
                                        <button
                                            disabled={!canStart || warfrontSetupPending}
                                            aria-busy={warfrontSetupPending}
                                            style={{ background: "#0e7490" }}
                                            onClick={() => {
                                                if (!canStart) return;
                                                // The server seals and returns the rival squad; no bundled
                                                // combat roster participates in a rewarded replay.
                                                void startArenaMatch(selectedTacticalPets, [], (Date.now() % 100000) || 1, true);
                                            }}>
                                            {warfrontSetupPending ? "Sealing Warfront…" : "Start vs AI"}
                                        </button>
                                    </div>

                                    <div className="summary-box" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
                                        <strong>⚔️ Challenge a Player</strong>
                                        <input
                                            aria-label="Player name to challenge"
                                            value={arenaChallengeName}
                                            onChange={(e) => { setArenaChallengeName(e.target.value); setArenaChallengeMsg(""); }}
                                            placeholder="Player name"
                                            onKeyDown={(e) => { if (e.key === "Enter" && canStart && arenaChallengeName.trim()) void sendArenaChallenge(arenaChallengeName, tacticalSize, tacticalPicks); }}
                                        />
                                        <button disabled={!canStart || !arenaChallengeName.trim()} style={{ background: "#b45309" }}
                                            onClick={() => void sendArenaChallenge(arenaChallengeName, tacticalSize, tacticalPicks)}>
                                            Send Challenge
                                        </button>
                                        {arenaChallengeMsg && <p className="hint" style={{ margin: 0, color: arenaChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)" }}>{arenaChallengeMsg}</p>}
                                    </div>

                                    <div className="summary-box" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
                                        <strong>🤝 Co-op with Friends</strong>
                                        <button style={{ background: "#6d28d9" }} onClick={() => setShowCoop(true)}>Open Co-op Lobby</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </section>
            )}

            {/* Full-screen game-mode overlays — launched from the Hollow Warfront
                view; rendered here so they sit above whichever view is active. */}
            {arenaMatch && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the Warfront…</div>}>
                    <PetWarfrontMatch
                        blue={arenaMatch.blue} red={arenaMatch.red} seed={arenaMatch.seed}
                        theme={wfThemeForVillage(character.village)}
                        autoBuy={arenaMatch.buyPolicy}
                        stance={arenaMatch.stance}
                        doctrine={arenaMatch.doctrine}
                        opponentStance={arenaMatch.opponentStance}
                        opponentDoctrine={arenaMatch.opponentDoctrine}
                        onResult={(result) => reportTacticalArenaResult(arenaMatch, result.winner ?? "draw")}
                        resultActionsLocked={warfrontResultActionsLocked}
                        settlementPending={petSettlementBlocksExit}
                        resultSupplement={chronicleProgress || chronicleCeremony ? (
                            <>
                                {chronicleProgress ? <PetChronicleProgress receipt={chronicleProgress} /> : null}
                                {chronicleCeremony ? (
                                    <PetChronicleCeremony
                                        receipt={chronicleCeremony}
                                        onDismiss={() => setChronicleCeremony(null)}
                                        onOpenCardHall={() => {
                                            setChronicleCeremony(null);
                                            setChronicleProgress(null);
                                            setArenaMatch(null);
                                            setScreen("shinobiTiles");
                                        }}
                                    />
                                ) : null}
                            </>
                        ) : undefined}
                        onExit={() => { if (canLeaveCurrentPetBattle()) setArenaMatch(null); }}
                    />
                </Suspense>
            )}
            {showCoop && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading co-op…</div>}>
                    <ArenaCoopLobby character={character} sharedImages={sharedImages} onExit={() => setShowCoop(false)} />
                </Suspense>
            )}
            {/* Portaled to <body> at the house z-index of 1000000. At its old 215 this
                full-screen countdown rendered UNDER both the mobile bottom nav (1000) and
                the desktop rail (999999), so the 6rem numeral was partly covered right as
                the fight began. */}
            {arenaCountdown && createPortal(
                <div role="status" aria-live="polite" aria-atomic="true" style={{ position: "fixed", inset: 0, zIndex: 1000000, background: "rgba(5,6,10,0.94)", display: "grid", placeItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ color: "var(--text-dim)", letterSpacing: "0.25em", fontSize: "0.85rem", marginBottom: 10 }}>BATTLE STARTS IN</div>
                        <div style={{ fontSize: "6rem", fontWeight: 800, color: "var(--gold-300)", textShadow: "0 0 30px rgba(250,204,21,0.45)", lineHeight: 1 }}>{arenaCountdown.secs}</div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

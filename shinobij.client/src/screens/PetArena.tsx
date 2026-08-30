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
import { useState, useEffect, useMemo, useRef, Suspense, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import type { Character, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen, JutsuElement } from "../types/core";
import { PET_ELEMENT_BEATS } from "../constants/pet-arena";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { PetHomeTabs } from "../components/PetHomeTabs";
import { GameIcon } from "../components/icons/GameIcon";
import { PetChronicleCeremony } from "../components/PetChronicleCeremony";
import { PetChronicleProgress } from "../components/PetChronicleProgress";
import { PetDuelLiveHost, type PetDuelLiveHandle } from "../components/PetDuelLiveHost";
import { fetchRankedPetDuel } from "../lib/pet-ranked-watch-api";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";
import { petCardImage } from "../lib/pet-battle-anim";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    availableWarfrontPetCount,
    canEnterTacticalArena,
    isPetAvailableForWarfront,
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
import { clearPetArenaNavigationHint, readPetArenaPetHint, readPetArenaViewHint } from "../lib/pet-arena-navigation";
import { petHomeReturnLabel } from "../lib/pet-home-navigation";
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
    petBattleSettlementBlocksExit,
    responseBelongsToPetArenaPlayer,
    type PetArenaPlayerScope,
    type PetArenaServerVersionDecision,
    type PetArenaServerVersionResult,
    type WarfrontRewardSeal,
} from "../lib/pet-arena-settlement";
import { rankedDelta } from "../lib/progression";
import { makeId } from "../lib/utils";
import { genericPetArenaOpponents, type PetArenaOpponent } from "../data/pet-arena-opponents";
import { type DuelChallenge } from "../App";
import { loadPendingClanPetBattle, savePendingClanPetBattle } from "../lib/world-state";
import {
    resolveChallengerTeam,
    stripInlinePetImages,
    arenaSizeOf,
    parseWarfrontChallengePlan,
    type ArenaMatchPayload,
    type WarfrontChallengePlan,
    type WarfrontChallengePlans,
} from "../lib/arena-challenge";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { activeCarriedPets } from "../lib/entitlements";
import { activeClientBreedingParentIds } from "../lib/pet-breeding";
import { publicEligiblePets } from "../lib/public-pet-roster";
import { buildPetArenaLiveRoster, isLivePetDuelAvailable } from "../lib/pet-duel-live-roster";
import type { ArenaSlot, ArenaRole } from "../lib/pet-arena-sim";
import type { WfTheme } from "../lib/pet-warfront-map";
import type { WarfrontResult, WfBuyPolicy } from "../lib/pet-warfront-sim";
import { WF_DOCTRINES, WF_STANCES, type WfDoctrine, type WfStance } from "../lib/pet-warfront-contract";
import arenaModeColosseum from "../assets/coliseum/arena-mode-colosseum.webp";
import warfrontKeyArt from "../assets/warfront-three-lane/warfront-three-lane-keyart.webp";
import warfrontCardArt from "../assets/warfront-three-lane/warfront-three-lane-card.webp";
import arenaModeGauntlet from "../assets/coliseum/arena-mode-gauntlet.webp";
import petArenaCommandHero from "../assets/coliseum/pet-arena-command-v2.webp";
import petArenaCommandMobileHero from "../assets/coliseum/pet-arena-command-mobile-v2.webp";
import petDuelHero from "../assets/coliseum/pet-duel-hero.webp";
import duelFire from "../assets/coliseum/duel-fire.webp";
import duelWater from "../assets/coliseum/duel-water.webp";
import duelWind from "../assets/coliseum/duel-wind.webp";
import duelLightning from "../assets/coliseum/duel-lightning.webp";
import duelEarth from "../assets/coliseum/duel-earth.webp";
import "../styles/pet-home.css";
import "../styles/pet-arena-lobby.css";

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
                <div>🏁 Three sealed lanes. The first commander to break two Ward Towers wins.</div>
                <div>🧠 Pets auto-fight by role — defenders tank, sages heal, trackers poke, assassins dive.</div>
                <div>♜ Earn Favor through combat, then summon the Gate Warden during a command window.</div>
            </div>
        </div>
    );
}

const preloadPetColiseumModels = (pets: readonly Pet[]) => import("../lib/pet-model-preload")
    .then((module) => module.preloadPetColiseumModels(pets));
// The Showdown replay player — how EVERY duel this screen still starts is
// shown. The server resolved the fight; this plays that resolution's event log
// through the same battle component a live Showdown uses. Lazy, and
// deliberately its OWN chunk rather than the coliseum's: the point of the port
// is that the legacy stack stops being needed, so pulling it in here would
// defeat the drain.
const PetShowdownReplay = lazyWithRetry(() => import("../components/PetShowdownReplay").then((m) => ({ default: m.PetShowdownReplay })));
// Hollow Warfront — four pets, three navigation-isolated causeways, first to
// break two Ward Towers. Own lazy chunk so its simulation and presentation do
// not tax the cinematic Colosseum route.
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
    retryAfterMs?: number;
};

class PetSettlementRetryError extends Error {
    readonly retryAfterMs: number;

    constructor(message: string, retryAfterMs: number) {
        super(message);
        this.name = "PetSettlementRetryError";
        this.retryAfterMs = retryAfterMs;
    }
}

/*
 * What /api/pet/battle-start hands back. One shape now, because every fight this
 * screen starts is resolved by the server:
 *
 *   - a PLAYER CHALLENGE was decided once, for both participants, when the
 *     responder accepted (`api/pet/_pvp-duel.ts`);
 *   - a SECTOR WANDERER duel is decided at mint, against a beast the server
 *     picks from the caller's own saved level (`api/pet/_wanderer-duel.ts`).
 *
 * `script` IS the fight. `outcome` is the CALLER's side of the verdict, decided
 * by the server rather than worked out here from `winnerName`: account names are
 * normalised before they reach a duel seal, so matching one against a display
 * name would compare unequal for any name that normalises differently and would
 * report every duel as a loss. `winnerName` is display only, and only a
 * challenge has one.
 */
type CasualPetBattleSeal = {
    token: string;
    seed: number;
    reportKey: string;
    script: ShowdownReplayScript;
    outcome: "win" | "loss";
    winnerName?: string;
    // Sector-wanderer kickoffs only. That entry is its own sealed session: the
    // server resolves the ACTUAL roaming beast from the world roster (not the
    // arena-template preview this screen was handed), and the same response
    // carries the save it wrote — the per-encounter use cooldown and the
    // wanderer's relocation. Both have to be read back, or the player watches a
    // fight against a pet that is not the one the script resolved, and the world
    // never registers that the encounter happened.
    opponentPets?: Pet[];
    wandererName?: string;
    character?: Character;
    saveVersion?: number;
};

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
    theme: WfTheme;
    vsAi: boolean;
    scope: PetArenaPlayerScope;
    buyPolicy: WfBuyPolicy;
    opponentBuyPolicy: Exclude<WfBuyPolicy, "off">;
    stance: WfStance;
    doctrine: WfDoctrine;
    opponentStance: WfStance;
    opponentDoctrine: WfDoctrine;
};

/*
 * The local creation stamp on an outgoing HOLLOW WARFRONT challenge.
 *
 * Module scope on purpose. These reads are impure, and React Compiler is right
 * to flag them inside a component body even though this only ever runs from a
 * click — the seed belongs to the message, not to a render. Out here it is
 * plainly a message-building helper, and the `purity` suppression this file
 * used to carry could come off.
 *
 * Note what is NOT here: a battle seed. The challenge API mints the Warfront
 * seed while sealing the challenger's plan, so neither player can seed-shop.
 */
function newWarfrontChallengeStamp(): { createdAt: number } {
    return { createdAt: Date.now() };
}

function settlementErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "The arena could not record this result. Your battle seal is safe to retry.";
}

// Warfront loadout parsers — the save field is loose strings; anything unknown
// falls back to the default at the call site.
function parseWfAutoBuy(v: unknown): Exclude<WfBuyPolicy, "off"> | null {
    return v === "balanced" || v === "offense" || v === "defense" ? v : null;
}
function parseWfStance(v: unknown): WfStance | null {
    return v === "balanced" || v === "siege" || v === "jungle" || v === "headhunt" || v === "turtle" ? v : null;
}
function parseWfDoctrine(v: unknown): WfDoctrine | null {
    return v === "vanguard" || v === "bulwark" || v === "zealot" || v === "warden-pact" ? v : null;
}
/** Read-only fallback to the retired per-device keys (`wfAutoBuy.v1` /
 *  `wfStance.v1` / `wfDoctrine.v1`), consulted only while the save carries no
 *  value. Never written to. */
function legacyWfPref(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

export function PetArena({ character, updateCharacter, allServerPlayers, setScreen, returnScreen: petHomeReturnScreen, sharedImages, duelChallenges, setDuelChallenges, pendingPetBattleOpponent, onPendingPetBattleStarted, pendingArenaMatch, onPendingArenaMatchStarted, pendingArenaResponse, onArenaResponseHandled, onClanWarBattleEnd, onBattleActiveChange, onFullscreenActiveChange, onServerVersion, onVersionedCharacter }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; allServerPlayers: ServerPlayerSummary[]; setScreen: (screen: Screen) => void; returnScreen?: Screen; sharedImages: Record<string, string>; duelChallenges: DuelChallenge[]; setDuelChallenges: (c: DuelChallenge[]) => void; pendingPetBattleOpponent?: PetArenaOpponent | null; onPendingPetBattleStarted?: () => void; pendingArenaMatch?: ArenaMatchPayload | null; onPendingArenaMatchStarted?: () => void; pendingArenaResponse?: DuelChallenge | null; onArenaResponseHandled?: () => void; onClanWarBattleEnd?: (youWon: boolean | "draw", opponentName?: string) => void; onBattleActiveChange?: (active: boolean) => void; onFullscreenActiveChange?: (active: boolean) => void; onServerVersion?: (version: number | undefined, originatingPlayerName: string) => PetArenaServerVersionResult; onVersionedCharacter?: (character: Character, version: number | undefined, originatingPlayerName: string) => PetArenaServerVersionResult }) {
    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const warfrontBreedingPetIds = activeClientBreedingParentIds(character);
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

    const [arenaNavigationHint] = useState(() => ({
        view: readPetArenaViewHint(),
        petId: readPetArenaPetHint(),
        playerName: character.name.toLowerCase(),
    }));
    const arenaHintPetId = arenaNavigationHint.playerName === character.name.toLowerCase()
        ? arenaNavigationHint.petId
        : null;
    const [selectedPetId, setSelectedPetId] = useState(
        combatEligiblePets.find((pet) => pet.id === arenaHintPetId)?.id
        ?? combatEligiblePets.find((pet) => pet.id === character.activePetId)?.id
        ?? combatEligiblePets[0]?.id
        ?? "",
    );
    const [opponentSearch, setOpponentSearch] = useState("");
    const [petChallengeMsg, setPetChallengeMsg] = useState("");
    const [chronicleCeremony, setChronicleCeremony] = useState<PetChronicleCeremonyReceipt | null>(null);
    const [chronicleProgress, setChronicleProgress] = useState<PetChronicleProgressReceipt | null>(null);
    const settlementAttemptRef = useRef<PetSettlementAttempt | null>(null);
    const settlementRetryTimerRef = useRef<number | null>(null);
    useEffect(() => () => {
        if (settlementRetryTimerRef.current !== null) window.clearTimeout(settlementRetryTimerRef.current);
    }, []);
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
    // Hollow Warfront — a full-screen 4v4 command battle on three sealed
    // causeways. Teams are built and frozen on launch; lanes are assigned next.
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
    // Normal visits default to the cinematic battle; a one-shot cross-screen
    // hint can land a Yard CTA directly in Tactical setup or the Gauntlet.
    const [arenaView, setArenaView] = useState<"battle" | "tactical" | "gauntlet">(arenaNavigationHint.view);
    useEffect(() => clearPetArenaNavigationHint(), []);
    // Warfront setup (single screen): a team grid shared by Fight AI and
    // Challenge-a-Player. Picks seed to the top available pets.
    // Warfront is always 4v4 (2v2 retired with capture-scroll); kept as state-shaped
    // const so the challenge payload + pick caps read unchanged.
    const [tacticalSize] = useState<4>(4);
    // Warfront pre-match loadout — formation stance and team doctrine. These live
    // on the ACCOUNT (character.warfrontLoadout,
    // a client-preference save field) rather than the device, so the same shinobi
    // fights with the same plan from any browser. The old autoBuy value remains only
    // for save/challenge compatibility; the coin shop is gone. Migration: a save with no value falls
    // back ONCE to the retired per-device localStorage keys, and the first change
    // writes the whole loadout to the save (after which localStorage is never read).
    const wfLoadout = character.warfrontLoadout;
    const wfAutoPref = useMemo<Exclude<WfBuyPolicy, "off">>(
        () => parseWfAutoBuy(wfLoadout?.autoBuy) ?? parseWfAutoBuy(legacyWfPref("wfAutoBuy.v1")) ?? "balanced",
        [wfLoadout?.autoBuy],
    );
    const wfStancePref = useMemo<WfStance>(
        () => parseWfStance(wfLoadout?.stance) ?? parseWfStance(legacyWfPref("wfStance.v1")) ?? "balanced",
        [wfLoadout?.stance],
    );
    const wfDoctrinePref = useMemo<WfDoctrine>(
        () => parseWfDoctrine(wfLoadout?.doctrine) ?? parseWfDoctrine(legacyWfPref("wfDoctrine.v1")) ?? "vanguard",
        [wfLoadout?.doctrine],
    );
    const writeWfLoadout = (patch: Partial<NonNullable<Character["warfrontLoadout"]>>) => {
        updateCharacter((current) => current ? {
            ...current,
            // Persist all three so the device fallback is retired in one write.
            warfrontLoadout: { autoBuy: wfAutoPref, stance: wfStancePref, doctrine: wfDoctrinePref, ...current.warfrontLoadout, ...patch },
        } : current);
    };
    const setWfStance = (s: WfStance) => writeWfLoadout({ stance: s });
    const setWfDoctrine = (d: WfDoctrine) => writeWfLoadout({ doctrine: d });
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
        const retryAfterMs = Number(data?.retryAfterMs);
        if (response.status === 425 && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
            throw new PetSettlementRetryError(data?.error || "The Hollow Warfront is still in progress.", retryAfterMs);
        }
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
            if (error instanceof PetSettlementRetryError) {
                attempt.status = "pending";
                const delayMs = Math.min(10 * 60_000, Math.max(500, Math.ceil(error.retryAfterMs) + 250));
                setSettlementPresentation({
                    id: attempt.id,
                    kind: attempt.kind,
                    label: attempt.label,
                    scope: attempt.scope,
                    status: "pending",
                    detail: `Battle replay complete. Sealing the authoritative result in ${Math.max(1, Math.ceil(delayMs / 1_000))}s…`,
                });
                if (settlementRetryTimerRef.current !== null) window.clearTimeout(settlementRetryTimerRef.current);
                settlementRetryTimerRef.current = window.setTimeout(() => {
                    settlementRetryTimerRef.current = null;
                    if (settlementAttemptRef.current === attempt && playerScopeIsActive(attempt.scope)) {
                        void runPetSettlementAttempt(attempt);
                    }
                }, delayMs);
                return;
            }
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
        if (settlementRetryTimerRef.current !== null) {
            window.clearTimeout(settlementRetryTimerRef.current);
            settlementRetryTimerRef.current = null;
        }
        settlementAttemptRef.current = null;
        setSettlementPresentation(null);
    }

    function showBattleSetupIssue(scope: PetArenaPlayerScope, message: string, retry: () => void): void {
        if (!playerScopeIsActive(scope)) return;
        battleSetupRetryRef.current = retry;
        setBattleSetupIssue({ scope, message });
    }

    const [tacticalPicks, setTacticalPicks] = useState<string[]>(() => (
        pickArenaTeam(combatEligiblePets, 4, arenaHintPetId, warfrontBreedingPetIds).map((pet) => pet.id)
    ));
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
        if (targetRecord && publicEligiblePets(targetRecord).filter((pet) => isLivePetDuelAvailable(pet)).length === 0) {
            setPetChallengeMsg(`${toName} does not have a pet available for battle.`);
            return;
        }
        if (!selectedPet) {
            setPetChallengeMsg("Choose one of your pets first.");
            return;
        }
        if (!isLivePetDuelAvailable(selectedPet, character.petBreeding)) {
            setPetChallengeMsg(`${petDisplayName(selectedPet)} is busy with training, breeding, or an expedition reward.`);
            return;
        }
        // A requested 2v2 stays 2v2. Auto-pick supplies the local reserve; if
        // either known roster is undersized, fail closed instead of relabelling
        // the challenge as 1v1 — the server enforces exact cardinality and
        // rejects a mismatched roster rather than truncating it.
        if (partyMode && liveDuelPets.length < 2) {
            setPetChallengeMsg("A 2v2 challenge needs a second eligible pet that is not busy.");
            return;
        }
        const targetCanParty = !targetRecord
            || publicEligiblePets(targetRecord).filter((pet) => isLivePetDuelAvailable(pet)).length >= 2;
        if (partyMode && !targetCanParty) {
            setPetChallengeMsg(`${toName} needs two eligible pets for a 2v2 challenge.`);
            return;
        }
        setBattleReady(false);
        // LIVE PvP (docs/pet-coliseum-player-control-plan.md §10). Player-versus-
        // player pet duels are lockstep and require both people present, so the
        // challenge goes over the realtime socket instead of being queued as a
        // DuelChallenge. There is deliberately no async fallback: if the target is
        // not connected the server refuses and says so.
        const liveErr = liveDuelRef.current?.challenge(
            toName,
            partyMode ? "2v2" : "1v1",
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
                theme: seal.theme,
                vsAi: true,
                scope,
                buyPolicy: seal.buyPolicy,
                opponentBuyPolicy: seal.opponentBuyPolicy,
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
    async function startArenaMatch(blue: Pet[], red: Pet[], seed: number, vsAi = false, sealedPlans?: WarfrontChallengePlans) {
        if (vsAi && warfrontSetupInFlightRef.current) return;
        const scope = capturePlayerScope();
        const matchConfig = sealedPlans
            ? {
                theme: "central" as WfTheme,
                buyPolicy: sealedPlans.blue.buyPolicy as WfBuyPolicy,
                opponentBuyPolicy: sealedPlans.red.buyPolicy,
                stance: sealedPlans.blue.stance as WfStance,
                doctrine: sealedPlans.blue.doctrine as WfDoctrine,
                opponentStance: sealedPlans.red.stance as WfStance,
                opponentDoctrine: sealedPlans.red.doctrine as WfDoctrine,
            }
            : {
                theme: "central" as WfTheme,
                buyPolicy: (vsAi ? wfAutoPref : "balanced") as WfBuyPolicy,
                opponentBuyPolicy: "balanced" as const,
                stance: wfStancePref,
                doctrine: wfDoctrinePref,
                opponentStance: "balanced" as WfStance,
                opponentDoctrine: "vanguard" as WfDoctrine,
            };
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

    // Hollow Warfront vs-AI is SERVER-AUTHORITATIVE. Kickoff seals the stored
    // roster, AI team, seed, plan modifiers, and an automatic fallback outcome.
    // Settlement replays the validated opening lanes + compact command log on
    // those same inputs, so the client reports decisions but never its verdict.
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
        result: WarfrontResult,
    ) {
        if (!m.vsAi || !playerAuthorityIsActive(m.scope)) return;
        const winner = result.winner ?? "draw";
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
                    || seal.theme !== m.theme
                    || seal.reportKey !== reportKey
                    || seal.stance !== m.stance
                    || seal.doctrine !== m.doctrine
                    || seal.buyPolicy !== m.buyPolicy
                    || seal.opponentBuyPolicy !== m.opponentBuyPolicy
                    || seal.opponentStance !== m.opponentStance
                    || seal.opponentDoctrine !== m.opponentDoctrine
                    || seal.bluePets.map((pet) => pet.id).join("\0") !== playerPetIds.join("\0")
                    || seal.redPets.map((pet) => pet.id).join("\0") !== rivalPetIds.join("\0")) {
                    throw new Error("The Warfront battle proof does not match this replay. Keep this result open and retry.");
                }
                const data = await postPetBattleSettlement({
                    ...bodyBase,
                    battleToken: seal.token,
                    warfrontPlan: {
                        initialLanes: result.initialLanes.blue,
                        commands: result.commandLog,
                    },
                });
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
    async function sendArenaChallenge(toName: string, size: 4, teamIds: string[]) {
        const name = toName.trim();
        if (!name) { setArenaChallengeMsg("Enter a player name to challenge."); return; }
        if (name.toLowerCase() === character.name.toLowerCase()) { setArenaChallengeMsg("You can't challenge yourself."); return; }
        const availableIds = new Set(
            combatEligiblePets
                .filter((pet) => isPetAvailableForWarfront(pet, warfrontBreedingPetIds))
                .map((pet) => pet.id),
        );
        if (teamIds.length !== size || new Set(teamIds).size !== size || teamIds.some((id) => !availableIds.has(id))) { setArenaChallengeMsg(`A ${size}v${size} match requires ${size} available carried pets.`); return; }
        const targetRecord = allServerPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (targetRecord && availableWarfrontPetCount(publicEligiblePets(targetRecord)) < size) {
            setArenaChallengeMsg(`${name} needs ${size} available pets for a ${size}v${size} arena match.`);
            return;
        }
        const challengerWarfrontPlan: WarfrontChallengePlan = {
            buyPolicy: wfAutoPref,
            stance: wfStancePref,
            doctrine: wfDoctrinePref === "none" ? "vanguard" : wfDoctrinePref,
        };
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
            challengerWarfrontPlan,
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
            setArenaChallengeMsg(`✅ 4v4 challenge sent to ${name}! Waiting for them to accept and pick their team…`);
        } catch {
            setArenaChallengeMsg("❌ Network error sending challenge.");
        }
    }

    // Responder side: I picked my team for an incoming arena challenge. Echo it
    // back (image-stripped) on the accepted notice, then command my own roster as
    // Azure against the challenger's sealed Crimson defense. The challenger runs
    // the reciprocal attack locally; challenge exhibitions carry no rewards.
    async function respondToArenaChallenge(challenge: DuelChallenge, teamIds: string[]) {
        const size = arenaSizeOf(challenge);
        const challengerPlan = parseWarfrontChallengePlan(challenge.challengerWarfrontPlan);
        if (!challengerPlan) {
            setArenaChallengeMsg("This challenge predates sealed battle plans. Ask the challenger to send a fresh Warfront invitation.");
            return;
        }
        const responderPlan: WarfrontChallengePlan = {
            buyPolicy: wfAutoPref,
            stance: wfStancePref,
            doctrine: wfDoctrinePref === "none" ? "vanguard" : wfDoctrinePref,
        };
        const challengerBreedingPetIds = activeClientBreedingParentIds(challenge.challenger);
        const myTeam = teamIds.slice(0, size)
            .map((id) => combatEligiblePets.find((pet) => pet.id === id && isPetAvailableForWarfront(pet, warfrontBreedingPetIds)))
            .filter((pet): pet is Pet => Boolean(pet));
        const blue = resolveChallengerTeam(challenge)
            .filter((pet) => isPetAvailableForWarfront(pet, challengerBreedingPetIds))
            .slice(0, size);
        if (new Set(myTeam.map((pet) => pet.id)).size !== size || new Set(blue.map((pet) => pet.id)).size !== size) {
            setArenaChallengeMsg(`This ${size}v${size} challenge needs ${size} available pets on each team. It was not started.`);
            return;
        }
        try {
            const response = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: challenge.fromName, challenge: {
                    ...challenge, accepted: true, fromName: character.name, toName: challenge.fromName,
                    responderTeam: stripInlinePetImages(myTeam),
                    responderWarfrontPlan: responderPlan,
                } }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: unknown } | null;
                setArenaChallengeMsg(`❌ ${typeof payload?.error === "string" ? payload.error : "The Warfront invitation could not be accepted."}`);
                return;
            }
        } catch {
            setArenaChallengeMsg("❌ Network error accepting the Warfront challenge. Nothing was started.");
            return;
        }
        onArenaResponseHandled?.();
        void startArenaMatch(myTeam, blue, challenge.petBattleSeed ?? 1, false, { blue: responderPlan, red: challengerPlan });
    }

    const selectedPet = combatEligiblePets.find((pet) => pet.id === selectedPetId) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));
    // The exact roster a live duel may send. Filters pets that are busy for any
    // reason (expedition, training, breeding), not just expeditions, so a 2v2
    // cannot be assembled from a pet the server will refuse.
    const liveDuelPets = buildPetArenaLiveRoster(combatEligiblePets, selectedPet, reservePetId, character.petBreeding);

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
        setSelectedPetId(
            combatEligiblePets.find((pet) => pet.id === arenaHintPetId)?.id
            ?? combatEligiblePets.find((pet) => pet.id === character.activePetId)?.id
            ?? combatEligiblePets[0]?.id
            ?? "",
        );
        setReservePetId(character.activePetId2v2 ?? "");
        setTacticalPicks(pickArenaTeam(combatEligiblePets, 4, arenaHintPetId, warfrontBreedingPetIds).map((pet) => pet.id));
        setBattleOpponent(null);
        setBattleReady(false);
        setBattleLog([]);
        setWatchedDuel(null);
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
        || watchedDuel !== null;
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
                // A sector wanderer is a DIFFERENT request, not the ordinary one
                // with an extra field. Its kickoff authority accepts the wanderer
                // selector and nothing else: it fails closed on any opponent, PvP,
                // ranked, Hollow Gate or Dungeon context in the same body, because
                // a duel whose opponent the server resolves from the world roster
                // must not also be told who it is fighting. It needs the SECTOR
                // alongside the id — the encounter is validated against the sector
                // the save says you stand in — so sending `{ id }` alone is
                // rejected outright.
                body: JSON.stringify(opponent.wanderer
                    ? {
                        playerName: scope.playerName,
                        mode,
                        playerPetIds: playerPets.map((pet) => pet.id),
                        // The exact natural context, forwarded whole: the id AND
                        // the sector. The session validates the encounter against
                        // the sector the save says you stand in, so an id alone is
                        // refused.
                        ...(opponent.wanderer ? { wanderer: opponent.wanderer } : {}),
                    }
                    : {
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
                opponentPets?: unknown; wanderer?: { name?: unknown };
                character?: unknown; _saveVersion?: unknown;
            } | null;
            if (typeof data?.token !== "string"
                || !Number.isSafeInteger(Number(data.seed))
                || typeof data.reportKey !== "string") return null;
            // The server's fight, or nothing. Both entries that reach here are
            // resolved server-side, so a response without a script is a failure
            // to be retried — never a licence to simulate one.
            const script = data.showdownScript && typeof data.showdownScript === "object"
                ? data.showdownScript as ShowdownReplayScript
                : null;
            const outcome = data.outcome === "win" || data.outcome === "loss" ? data.outcome : null;
            if (!script || !outcome) return null;
            // Wanderer extras. Left undefined for every other entry, so nothing
            // below this changes for a player challenge.
            const sealedOpponentPets = Array.isArray(data.opponentPets) && data.opponentPets.length > 0
                ? data.opponentPets as Pet[]
                : undefined;
            return {
                token: data.token,
                seed: Number(data.seed),
                reportKey: data.reportKey,
                script,
                outcome,
                ...(typeof data.winnerName === "string" && data.winnerName ? { winnerName: data.winnerName } : {}),
                ...(sealedOpponentPets ? { opponentPets: sealedOpponentPets } : {}),
                ...(typeof data.wanderer?.name === "string" && data.wanderer.name ? { wandererName: data.wanderer.name } : {}),
                ...(data.character && typeof data.character === "object" ? { character: data.character as Character } : {}),
                ...(Number.isSafeInteger(Number(data._saveVersion)) ? { saveVersion: Number(data._saveVersion) } : {}),
            };
        } catch {
            return null;
        }
    }

    async function startBattle(opponentOverride?: PetArenaOpponent) {
        // Releases the World Map's pending wanderer context, and ONLY once the
        // duel has actually started. A wanderer encounter is a one-shot piece of
        // world state: clear it up front, as an ordinary challenge can, and a
        // kickoff that fails on a dropped connection leaves the player with no
        // fight, no cooldown spent, and no way back to the beast they walked
        // into. Every other entry clears immediately in the effect below.
        //
        // The identity check is exact because this only releases the encounter
        // it was called for — a different pending wanderer must survive.
        const finishStarted = (): true => {
            if (opponentOverride?.wanderer && pendingPetBattleOpponent?.wanderer
                && opponentOverride.owner === pendingPetBattleOpponent.owner
                && opponentOverride.pet.id === pendingPetBattleOpponent.pet.id
                && opponentOverride.battleSeed === pendingPetBattleOpponent.battleSeed
                && opponentOverride.wanderer?.id === pendingPetBattleOpponent.wanderer?.id
                && opponentOverride.wanderer?.sector === pendingPetBattleOpponent.wanderer?.sector) {
                onPendingPetBattleStarted?.();
            }
            return true;
        };
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
                    label: "Ranked Pet Colosseum result",
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
         * ── Everything else: a player challenge, or a sector wanderer ────
         *
         * BOTH ARE WATCHED, for the reason ranked is. This branch used to mint a
         * token, take the seed that came back, and run the cinematic locally —
         * while the server had already sealed its own verdict from that seed
         * using a different engine. Worse, for a challenge each participant
         * minted a SEPARATE token with a SEPARATE random seed, so the two sides
         * were rated on unrelated fights and both could be told they had won.
         *
         * A challenge is now sealed against the challenge id when it is accepted
         * (api/pet/_pvp-duel.ts): one seed, both rosters, one verdict. A
         * wanderer duel is resolved at mint (api/pet/_wanderer-duel.ts) against a
         * beast the SERVER picks from the caller's own saved level. Either way
         * the call below returns the fight, and the outcome posted back is the
         * server's own.
         *
         * This is the last local fight on the screen, and it is gone: no
         * `runPetDuelCinematic`, no `createLiveDuel`, no `PetColiseumDuel`.
         *
         * Consumables do not fire in a sealed duel (the fight is decided before
         * settlement, so a burned item could never be honestly charged), which
         * is why nothing is cleared here.
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
        // A wanderer duel is shown as the server resolved it, not as the World
        // Map previewed it. The card that opened this screen carried a cosmetic
        // arena-template stand-in; the beast in the script is the one the world
        // roster actually fields, so swap it in before anything renders or the
        // player watches a name and portrait that never fought.
        const sealedWandererPet = opponent.wanderer ? battleSeal.opponentPets?.[0] : undefined;
        const shownOpponent = sealedWandererPet
            ? { ...opponent, owner: battleSeal.wandererName ?? opponent.owner, pet: sealedWandererPet }
            : opponent;
        // The same response carried the save the kickoff wrote — the encounter's
        // use cooldown and the wanderer's relocation. Adopt it through the normal
        // versioned boundary (which rejects a foreign or stale account) so the
        // World Map reflects that this encounter was spent.
        if (opponent.wanderer && battleSeal.character) {
            receivePetBattleSettlement(
                { character: battleSeal.character, _saveVersion: battleSeal.saveVersion } as PetBattleSettlementResponse,
                battleScope,
                battleSeal.character,
            );
            if (!playerAuthorityIsActive(battleScope)) return;
        }
        startBattleMusic();
        setBattleOpponent(shownOpponent);
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
            // A wanderer duel is named for what it is. It settles through the
            // same endpoint, but it pays nothing — its token is sealed
            // casual-no-progression — so calling it a "Pet Colosseum result"
            // would tell the player a purse was involved when none was.
            label: opponent.wanderer
                ? "Natural wanderer pet duel"
                : isParty ? "2v2 Pet Colosseum result" : "Pet Colosseum result",
            scope: battleScope,
            run: async () => {
                const data = await postPetBattleSettlement(settlementBody);
                if (!playerScopeIsActive(battleScope)) return false;
                // A wanderer duel spends NO consumables, so it clears none. The
                // server already agrees — the pets it sealed on the token carry
                // an emptied consumable slot, making its own spend step a no-op —
                // and passing the fought pets here anyway would clear them on the
                // client alone: items gone locally, still held server-side, on a
                // fight that paid nothing to begin with.
                const applied = opponent.wanderer
                    ? applyPetBattleSettlement(data, battleScope, [])
                    : applyPetBattleSettlement(data, battleScope, myPets.map((pet) => pet.id));
                if (applied && data.capped) {
                    setBattleLog(["Daily Pet Colosseum reward cap reached — wins still count, but no more ryo today."]);
                }
                return applied;
            },
        });
        if (pendingClanPetBattle) savePendingClanPetBattle(null);
        return finishStarted();
    }

    useEffect(() => {
        if (!pendingPetBattleOpponent || !selectedPet) return;
        void startBattle(pendingPetBattleOpponent);
        // Every entry but the wanderer releases its pending context here, the
        // moment the fight is handed off. A natural wanderer waits for the start
        // to succeed instead — startBattle's finishStarted() releases it — so a
        // failed kickoff leaves the encounter intact and retryable rather than
        // consuming a one-shot piece of world state on a dropped request.
        if (!pendingPetBattleOpponent.wanderer) onPendingPetBattleStarted?.();
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
        void startArenaMatch(pendingArenaMatch.blue, pendingArenaMatch.red, pendingArenaMatch.seed, false, pendingArenaMatch.plans);
        onPendingArenaMatchStarted?.();
    }, [pendingArenaMatch?.seed]);

    // Responder side: an incoming arena challenge arrived → open the tactical
    // view's responder picker, pre-selecting my top pets at the challenge's size.
    useEffect(() => {
        if (!pendingArenaResponse) return;
        setArenaView("tactical");
        setRespondPicks(pickArenaTeam(combatEligiblePets, arenaSizeOf(pendingArenaResponse), null, warfrontBreedingPetIds).map((p) => p.id));
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
    // Hollow Gate (and other forced duels) skip the view tabs — those land
    // straight in a battle and shouldn't expose the Warfront switch.
    const isHollowGate = pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate";
    const forcedReturnScreen = pendingPetBattleOpponent?.returnScreen || battleOpponent?.returnScreen;
    const returnScreen = petArenaReturnScreen(forcedReturnScreen || petHomeReturnScreen);
    const returnLabel = forcedReturnScreen
        ? petArenaBackLabel(returnScreen).replace("Back to ", "")
        : petHomeReturnLabel(returnScreen);
    const showPetHomeTabs = !pendingPetBattleOpponent
        && !pendingArenaMatch
        && !pendingArenaResponse
        && !fullscreenBattleActive
        && !showCoop;
    const availableArenaPetCount = availableWarfrontPetCount(combatEligiblePets, warfrontBreedingPetIds);
    const tacticalArenaUnlocked = canEnterTacticalArena(combatEligiblePets, warfrontBreedingPetIds);
    const activeSettlementPresentation = settlementPresentation
        && playerScopeIsActive(settlementPresentation.scope)
        ? settlementPresentation
        : null;
    const activeSettlementAttempt = settlementAttemptRef.current
        && playerScopeIsActive(settlementAttemptRef.current.scope)
        ? settlementAttemptRef.current
        : null;
    const activeSettlementStatus = activeSettlementAttempt?.status ?? null;
    const petSettlementBlocksExit = petBattleSettlementBlocksExit(activeSettlementStatus);
    const warfrontSettlementBlocksExit = petBattleSettlementBlocksExit(
        activeSettlementStatus,
        Boolean(arenaMatch?.vsAi),
    );
    const warfrontResultActionsLocked = Boolean(
        chronicleCeremony
        || warfrontSettlementBlocksExit,
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
    const canLeaveCurrentPetBattle = (blocksExit = petSettlementBlocksExit) => {
        if (blocksExit) {
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

    const forcedDuelHero = DUEL_HERO_BY_ELEMENT[selectedPet?.element ?? ""] ?? petDuelHero;
    const arenaHeroImage = isHollowGate
        ? forcedDuelHero
        : arenaView === "tactical"
            ? warfrontKeyArt
            : petArenaCommandHero;
    const arenaHeroMobileImage = isHollowGate || arenaView === "tactical"
        ? arenaHeroImage
        : petArenaCommandMobileHero;
    const arenaHeroStyle = {
        "--arena-hero": `url(${arenaHeroImage})`,
        "--arena-hero-mobile": `url(${arenaHeroMobileImage})`,
    } as CSSProperties;
    const arenaHeroTitle = isHollowGate
        ? "Hollow Hound Duel"
        : arenaView === "tactical"
            ? "Hollow Warfront"
            : arenaView === "gauntlet"
                ? "Pet Gauntlet"
                : "Pet Colosseum";
    const arenaHeroEyebrow = isHollowGate
        ? "The Hollow Gate · sealed encounter"
        : arenaView === "tactical"
            ? "Four bonded pets · three sealed fronts"
            : arenaView === "gauntlet"
                ? "Endurance command · escalating run"
                : "Companion combat command";
    const arenaHeroCopy = isHollowGate
        ? "Face the corrupted guardian and seal the result before returning to the shrine."
        : arenaView === "tactical"
            ? "Deploy 2–1–1, redirect one pet every two minutes, and be first to shatter two enemy Ward Towers."
            : arenaView === "gauntlet"
                ? "Draft once, read every counter, and carry your squad through an escalating chain of fights."
                : "Choose the contender, read the matchup, then call every stance and technique from ringside.";

    return (
        <div className="card pet-arena-screen pet-arena-lobby" data-arena-view={arenaView}>
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
            <header className={`pet-arena-command${isHollowGate ? " is-forced" : ""}`} style={arenaHeroStyle}>
                <div className="pet-arena-command-topline">
                    <button
                        type="button"
                        className="pet-arena-return"
                        data-return-screen={returnScreen}
                        onClick={leaveCurrentPetBattle}
                    >
                        <span className="pet-arena-return-arrow" aria-hidden="true">←</span>
                        <span><small>Exit arena</small><strong>{returnLabel}</strong></span>
                    </button>
                    <span className="pet-arena-season"><i aria-hidden="true" /> Arena command online</span>
                </div>
                <div className="pet-arena-command-copy">
                    <span className="pet-arena-eyebrow">{arenaHeroEyebrow}</span>
                    <h1>{arenaHeroTitle}</h1>
                    <p>{pendingClanPetBattle
                        ? `Clan battle orders: defeat ${pendingClanPetBattle.opponentName} to secure ${pendingClanPetBattle.points} clan points.`
                        : arenaHeroCopy}</p>
                    <div className="pet-arena-readiness" aria-label="Arena readiness">
                        <div><GameIcon name="paw" size={20} /><span><small>Battle ready</small><strong>{availableArenaPetCount} companions</strong></span></div>
                        <div><GameIcon name="target" size={20} /><span><small>Contender</small><strong>{selectedPet ? petDisplayName(selectedPet) : "Not selected"}</strong></span></div>
                        <div><GameIcon name="medal" size={20} /><span><small>Paid wins today</small><strong>{character.dailyPetWins ?? 0} / {SHOWDOWN_DAILY_WIN_CAP}</strong></span></div>
                    </div>
                </div>

                {!isHollowGate ? (
                    <nav className="pet-arena-activity-nav" aria-label="Pet Arena activities">
                        <button type="button" className={arenaView === "battle" ? "active" : ""} aria-current={arenaView === "battle" ? "page" : undefined} onClick={() => setArenaView("battle")}>
                            <span className="pet-arena-activity-icon"><img src={arenaModeColosseum} alt="" loading="lazy" /></span>
                            <span><strong>Pet Colosseum</strong><small>Cinematic 1v1 · 2v2</small></span>
                        </button>
                        <button
                            type="button"
                            className={arenaView === "tactical" ? "active" : ""}
                            aria-current={arenaView === "tactical" ? "page" : undefined}
                            disabled={!tacticalArenaUnlocked}
                            title={!tacticalArenaUnlocked ? `Locked: ${availableArenaPetCount}/${TACTICAL_ARENA_PET_REQUIREMENT} available pets` : undefined}
                            onClick={() => setArenaView("tactical")}
                        >
                            <span className="pet-arena-activity-icon"><img src={warfrontCardArt} alt="" loading="lazy" /></span>
                            <span><strong>Hollow Warfront</strong><small>{tacticalArenaUnlocked ? "3 sealed lanes · first to 2 towers" : `Locked · ${availableArenaPetCount}/${TACTICAL_ARENA_PET_REQUIREMENT} pets`}</small></span>
                        </button>
                        <button type="button" className={arenaView === "gauntlet" ? "active" : ""} aria-current={arenaView === "gauntlet" ? "page" : undefined} onClick={() => setArenaView("gauntlet")}>
                            <span className="pet-arena-activity-icon"><img src={arenaModeGauntlet} alt="" loading="lazy" /></span>
                            <span><strong>Pet Gauntlet</strong><small>Escalating endurance run</small></span>
                        </button>
                    </nav>
                ) : null}
            </header>

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
            <div className="pet-arena-grid">
                <section className="summary-box pet-arena-selector" data-side="player">
                    <div className="pet-arena-panel-heading">
                        <span className="pet-arena-step">01</span>
                        <span><small>Lock contender</small><h2>Your companion</h2></span>
                        <strong>{combatEligiblePets.length} rostered</strong>
                    </div>
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

                <section className="summary-box pet-arena-selector" data-side="opponent">
                    <div className="pet-arena-panel-heading">
                        <span className="pet-arena-step">02</span>
                        <span><small>Set opposition</small><h2>Challenge a shinobi</h2></span>
                        <strong>Live duel</strong>
                    </div>
                    <p className="hint">Social duels are live, unrated sparring. Paid Colosseum bouts use the server-owned Showdown below.</p>
                    <div className="pet-player-search">
                        <label htmlFor="pet-arena-player-search">Search player name</label>
                        <div className="pet-player-search-field">
                            <GameIcon name="target" size={19} />
                            <input type="search" autoComplete="off" id="pet-arena-player-search" value={opponentSearch} onChange={(e) => { setOpponentSearch(e.target.value); setPetChallengeMsg(""); }} placeholder="Enter a shinobi name…" />
                        </div>
                    </div>
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
                                                    <div className="pet-challenge-row" key={p.name}>
                                                        <span className={`pet-online-dot ${p.online ? "on" : "off"}`} aria-label={p.online ? "Online" : "Offline"} />
                                                        <span><strong>{p.name}</strong><small>Level {p.level} · {p.village || "Unknown"}</small></span>
                                                        <button type="button" onClick={() => sendDirectPetChallenge(p.name)}><GameIcon name="sword" size={15} /> Challenge</button>
                                                    </div>
                                                ))}
                                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                                            </>
                                        );
                                    }
                                    return (
                                        <>
                                            <p className="hint">No account found for "{opponentSearch.trim()}".</p>
                                            <button type="button" onClick={() => sendDirectPetChallenge(opponentSearch.trim())}><GameIcon name="sword" size={15} /> Challenge "{opponentSearch.trim()}"</button>
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
                                    <div>🏛 Want a fight right now? The Colosseum matches you against the arena.</div>
                                </div>
                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "var(--green-400)" : "var(--red-400)", marginTop: 6 }}>{petChallengeMsg}</p>}
                            </div>
                        )
                    )}
                </section>
            </div>

            {combatEligiblePets.length >= 2 && (
                <section className="summary-box pet-party-config">
                    <label className="pet-party-toggle">
                        <span className="pet-party-switch"><input type="checkbox" checked={partyMode} onChange={(e) => setPartyMode(e.target.checked)} /><i aria-hidden="true" /></span>
                        <GameIcon name="paw" size={22} />
                        <span><strong>2v2 party battle</strong><small>Both players need 2 available pets; if either side is short, the challenge is declined rather than resized.</small></span>
                        <em>{partyMode ? "Enabled" : "Optional"}</em>
                    </label>
                    {partyMode && (
                        <div className="pet-party-reserve">
                            <label>Reserve pet <small>Faces their reserve in match two</small></label>
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
                </section>
            )}

            {/* THE COLISEUM. One mode, two doors:
                  • the Colosseum bout — the arena matches you, the daily win cap
                    applies, and a win pays. This is the reward loop.
                  • Training Grounds — sparring, and unlimited. By default the
                    arena draws a RANDOM team levelled pet-for-pet against the
                    one you bring, so a practice fight is always available and
                    always winnable-but-not-free; naming a tier instead is still
                    there for drilling one matchup. It pays nothing and moves no
                    counters either way.
                Both run the same turn-based engine; the difference is who
                chooses the fight and whether it pays. */}
            <section className="pet-arena-destinations" aria-labelledby="pet-arena-circuits-title">
                <div className="pet-arena-section-title">
                    <span>Official circuits</span>
                    <h2 id="pet-arena-circuits-title">Choose a fight contract</h2>
                    <p>Matchmade rewards or consequence-free drills—both use the full command combat system.</p>
                </div>
                <div className="pet-arena-destination-grid">
                    <button type="button" className="pet-arena-destination is-paid" onClick={() => setScreen("petColiseum")}>
                        <span className="pet-arena-destination-icon"><GameIcon name="medal" size={30} /></span>
                        <span className="pet-arena-destination-copy"><small>Paid circuit · daily purse</small><strong>Enter the Colosseum</strong><span>Matchmade 1v1 · 2v2 · 3v3, with up to {SHOWDOWN_DAILY_WIN_CAP} paid wins per day.</span></span>
                        <span className="pet-arena-destination-action">Find a bout <b aria-hidden="true">→</b></span>
                    </button>
                    <button type="button" className="pet-arena-destination is-training" onClick={() => setScreen("petShowdown")}>
                        <span className="pet-arena-destination-icon"><GameIcon name="dumbbell" size={30} /></span>
                        <span className="pet-arena-destination-copy"><small>Free sparring · no limit</small><strong>Training Grounds</strong><span>Choose the opposition and drill tactics without risking counters or rewards.</span></span>
                        <span className="pet-arena-destination-action">Open drills <b aria-hidden="true">→</b></span>
                    </button>
                </div>
            </section>

            {battleReady && result && (
                <div className="menu pet-arena-verdict">
                    <strong className={result === "Victory" ? "pet-arena-win" : "pet-arena-loss"}>{result}</strong>
                </div>
            )}

            {/* Live PvP: the invite prompt, the "waiting to be accepted" notice and
                the fight itself all live here. Renders nothing when idle. */}
            <PetDuelLiveHost
                ref={liveDuelRef}
                myPets={liveDuelPets}
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
                challenge from the duel sealed when it was accepted, a sector
                wanderer from the beast the server picked. So there is ONE renderer
                here rather than three, no onOutcome to honour (the settlement
                already fired against the server's own verdict), and no "fight
                again": these fights are spent when they resolve. The HD-2D
                coliseum renderer and the continuous duel player are both gone. */}
            {battleReady && selectedPet && battleOpponent && watchedDuel && (
                <div ref={battlefieldRef} className="pet-arena-stage-wrap" style={{ scrollMarginTop: "12px" }}>
                    <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the arena…</div>}>
                        <PetShowdownReplay
                            key={watchedDuel.id}
                            script={watchedDuel.script}
                            playerPets={watchedDuel.playerPets}
                            sharedImages={sharedImages}
                            onExit={leaveCurrentPetBattle}
                        />
                    </Suspense>
                </div>
            )}

            {/* THE CHRONICLE RECEIPT, over the top of the arena.
                It used to ride inside the retired result overlay's
                `resultSupplement` slot. The replay player has no such slot AND it
                portals itself fullscreen to document.body, so rendering the
                receipt as an ordinary sibling would put a won card BEHIND the
                battle — awarded invisibly, and gone the moment the player exits.
                So it gets its own portal above it, at the z-index the rest of
                this app's fullscreen overlays use.
                Mobile reachability is the point of the inner box: it scrolls on
                its own, honours the safe-area insets, and is width-capped and
                centred so a 200%-zoom viewport can still reach the dismiss
                control. */}
            {watchedDuel && duelChronicleResultSupplement && createPortal(
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Pet Colosseum result"
                    style={{
                        position: "fixed", inset: 0, zIndex: 1000000,
                        background: "rgba(4, 6, 12, 0.82)",
                        display: "flex", alignItems: "flex-start", justifyContent: "center",
                        overflowY: "auto", overscrollBehavior: "contain",
                        paddingTop: "max(12px, env(safe-area-inset-top))",
                        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                        paddingLeft: "max(12px, env(safe-area-inset-left))",
                        paddingRight: "max(12px, env(safe-area-inset-right))",
                    }}
                >
                    <div style={{ width: "min(620px, 100%)", margin: "auto", boxSizing: "border-box" }}>
                        {duelChronicleResultSupplement}
                    </div>
                </div>,
                document.body,
            )}

            <section className={`summary-box pet-arena-log${visibleLog.length === 0 ? " is-idle" : ""}`} role="log" aria-label="Pet battle log" aria-live="polite" aria-relevant="additions text">
                <div className="pet-arena-log-heading"><GameIcon name="scroll" size={18} /><span><small>Arena feed</small><strong>Battle record</strong></span><em>{visibleLog.length ? `${visibleLog.length} events` : "Awaiting bell"}</em></div>
                {visibleLog.length === 0 ? <p className="hint">Your live combat calls and decisive moments will appear here after the bell.</p> : visibleLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </section>
            </>
            )}

            {/* ── Hollow Warfront view ───────────────────────────────────────
                One screen: a team-size toggle + a team grid, then Fight AI /
                Challenge a Player / Co-op. An INCOMING challenge swaps in a
                responder picker. The match plays via the arenaMatch overlay
                below (after the countdown). */}
            {arenaView === "tactical" && (
                <section className="summary-box pet-warfront-lobby" style={{ marginTop: "0.2rem", display: "grid", gap: "0.9rem" }}>
                    {(() => {
                        const available = combatEligiblePets.filter((pet) => isPetAvailableForWarfront(pet, warfrontBreedingPetIds));
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
                                    <strong>⚔️ {pendingArenaResponse.fromName} challenged you to a 4v4!</strong>
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

                        // ── Single screen: doctrine + squad grid + actions ───────────
                        // (Warfront is always 4v4 — the old 2v2 size toggle retired with
                        // the capture-scroll mode.)
                        const canStart = isExactAvailableSelection(tacticalPicks, tacticalSize);
                        const selectedTacticalPets = tacticalPicks
                            .map((id) => availableById.get(id))
                            .filter((pet): pet is Pet => Boolean(pet));
                        const selectedFormation = WF_STANCES.find((stance) => stance.id === wfStancePref) ?? WF_STANCES[0];
                        const selectedDoctrine = WF_DOCTRINES.find((doctrine) => doctrine.id === wfDoctrinePref) ?? WF_DOCTRINES[0];
                        const planSynergy = wfStancePref === "jungle" && wfDoctrinePref === "warden-pact"
                            ? "Oathbound Warden: accelerated Favor reaches the 85-point Pact summon sooner and extends its normal duration before the shared Omen is applied."
                            : wfStancePref === "siege" && wfDoctrinePref === "vanguard"
                                ? "Breach Column: +8% team attack compounds a structure-first march."
                                : wfStancePref === "turtle" && wfDoctrinePref === "bulwark"
                                    ? "Unbroken Line: +12% team HP reinforces the strongest home-ground defense."
                                    : `${selectedFormation.label} controls field behavior; ${selectedDoctrine.label} supplies the permanent team-wide edge.`;
                        return (
                            <div style={{ display: "grid", gap: "0.7rem" }}>
                                <div className="pet-arena-tactical-top">
                                    <div style={{ display: "grid", gap: "0.7rem", alignContent: "start" }}>
                                        <div className="wf-pregame-readout" aria-label="Hollow Warfront battle laws">
                                            <div className="wf-pregame-readout-title">
                                                <span>BATTLE LAWS</span>
                                                <strong>THREE LANES · TWO TOWERS TO WIN</strong>
                                            </div>
                                            <div className="wf-pregame-readout-grid">
                                                <div><span>OPENING</span><strong>2–1–1 deployment</strong><small>Every isolated causeway must be defended.</small></div>
                                                <div><span>COMMAND</span><strong>Every 2 minutes</strong><small>Seal-transfer exactly one pet; Storm Gate accelerates this to 90 seconds.</small></div>
                                                <div><span>BREAKTHROUGH</span><strong>Redeploy the lane</strong><small>A destroyed tower frees every pet assigned there.</small></div>
                                            </div>
                                            <p><span>♜ WARDEN</span>Earn Favor from combat and tower pressure, then choose a Breaker, Sentinel, or Harrier Aspect during a command window.</p>
                                            <p><span>◐ HOLLOW OMEN</span>One shared match rule is revealed before deployment; both sides fight under the same condition.</p>
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

                                        <div className="wf-pregame-readout" aria-label="Sealed battle plan impact">
                                            <div className="wf-pregame-readout-title">
                                                <span>SEALED BATTLE PLAN</span>
                                                <strong>{selectedFormation.icon} {selectedFormation.label} · {selectedDoctrine.icon} {selectedDoctrine.label}</strong>
                                            </div>
                                            <div className="wf-pregame-readout-grid">
                                                <div><span>COMMAND RHYTHM</span><strong>120-second baseline</strong><small>One transfer or hold; the sealed Omen may alter the rhythm.</small></div>
                                                <div><span>FIELD BEHAVIOR</span><strong>{selectedFormation.label}</strong><small>{selectedFormation.desc}</small></div>
                                                <div><span>PERMANENT BOON</span><strong>{selectedDoctrine.label}</strong><small>{selectedDoctrine.desc}</small></div>
                                            </div>
                                            <p><span>◆ TACTICAL READ</span>{planSynergy}</p>
                                        </div>

                                        <div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Your team ({tacticalPicks.length}/{tacticalSize}) — choose pets to add or remove</p>
                                            <div style={{ marginTop: 6 }}>
                                                {available.length < tacticalSize
                                                    ? <p className="hint" style={{ color: "var(--gold-2)", margin: 0 }}>This 4v4 mode requires {tacticalSize} available pets. You currently have {available.length}; breeding, training, and expedition assignments do not count until cleared.</p>
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
                        theme={arenaMatch.theme}
                        autoBuy={arenaMatch.buyPolicy}
                        opponentAutoBuy={arenaMatch.opponentBuyPolicy}
                        stance={arenaMatch.stance}
                        doctrine={arenaMatch.doctrine}
                        opponentStance={arenaMatch.opponentStance}
                        opponentDoctrine={arenaMatch.opponentDoctrine}
                        matchType="unranked"
                        onResult={(result) => reportTacticalArenaResult(arenaMatch, result)}
                        resultActionsLocked={warfrontResultActionsLocked}
                        settlementPending={warfrontSettlementBlocksExit}
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
                        onExit={() => { if (canLeaveCurrentPetBattle(warfrontSettlementBlocksExit)) setArenaMatch(null); }}
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

/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import type { Character, PlayerRecord, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen, JutsuElement } from "../types/core";
import { PET_ELEMENT_BEATS } from "../constants/pet-arena";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { petFramePace, scorePetMatchup, type PetPartyBattleResult } from "../lib/pet-battle-sim";
import { type DuelResult } from "../lib/pet-duel-sim";
import { runPetDuelCinematic, runPetPartyDuelCinematic } from "../lib/pet-duel-cinematic";
import { createLiveDuel, createLivePartyDuel, type LiveDuel } from "../lib/pet-duel-live";
import { PetDuelLiveHost, type PetDuelLiveHandle } from "../components/PetDuelLiveHost";
import { petPlayerControlEnabled } from "../lib/pet-coliseum-flag";
import { petCardImage } from "../lib/pet-battle-anim";
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
import { rankedDelta } from "../lib/progression";
import { makeId } from "../lib/utils";
import { genericPetArenaOpponents, isGenericPetOpponent, type PetArenaOpponent } from "../data/pet-arena-opponents";
import {
    petTamerPveMultiplier,
    type DuelChallenge,
} from "../App";
import type { PetArenaFrame } from "../types/pet-arena";
import { loadPendingClanPetBattle, savePendingClanPetBattle } from "../lib/world-state";
import { petPveHpMult, petAlphaBond } from "../lib/profession-mastery";
import { resolveChallengerTeam, stripInlinePetImages, arenaSizeOf } from "../lib/arena-challenge";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { settleHollowGateCombat, type HollowGateCombatSettleResult } from "../lib/hollow-gate-combat-api";
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
                <div>🏁 Race to capture the scroll and clash across the map.</div>
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
const PetColiseum = lazyWithRetry(() => loadPetColiseum().then((m) => ({ default: m.PetColiseum })));
// Continuous-duel renderer (the new authoritative PvE engine, behind
// petDuelEngine.v1) — same lazy chunk, mounted instead of PetColiseum when the
// flag is on for a non-ranked fight.
const PetColiseumDuel = lazyWithRetry(() => loadPetColiseum().then((m) => ({ default: m.PetColiseumDuel })));
// Hollow Warfront — the lane-war game mode that REPLACED the capture-scroll
// Tactical Arena (Ward Seal objective, Guardian Totems, the Hollow Gate breach,
// bounty coins + the 30 s War Council). Own lazy chunk (three-heavy).
const PetWarfrontMatch = lazyWithRetry(() => import("../components/PetWarfrontMatch").then((m) => ({ default: m.PetWarfrontMatch })));
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

export function PetArena({ character, updateCharacter, playerRoster, allServerPlayers, setScreen, sharedImages, duelChallenges, setDuelChallenges, pendingPetBattleOpponent, onPendingPetBattleStarted, pendingArenaMatch, onPendingArenaMatchStarted, pendingArenaResponse, onArenaResponseHandled, onClanWarBattleEnd, onBattleActiveChange, onHollowGatePetBattleEnd }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; playerRoster: PlayerRecord[]; allServerPlayers: ServerPlayerSummary[]; setScreen: (screen: Screen) => void; sharedImages: Record<string, string>; duelChallenges: DuelChallenge[]; setDuelChallenges: (c: DuelChallenge[]) => void; pendingPetBattleOpponent?: PetArenaOpponent | null; onPendingPetBattleStarted?: () => void; pendingArenaMatch?: { blue: Pet[]; red: Pet[]; size: 2 | 4; seed: number } | null; onPendingArenaMatchStarted?: () => void; pendingArenaResponse?: DuelChallenge | null; onArenaResponseHandled?: () => void; onClanWarBattleEnd?: (youWon: boolean | "draw", opponentName?: string) => void; onBattleActiveChange?: (active: boolean) => void; onHollowGatePetBattleEnd?: (result: HollowGateCombatSettleResult, opponent: PetArenaOpponent) => void }) {
    const [selectedPetId, setSelectedPetId] = useState(character.activePetId ?? character.pets[0]?.id ?? "");
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
    // Last party result, shown as a summary block ("2–0 — You take the set!").
    const [partyResult, setPartyResult] = useState<PetPartyBattleResult | null>(null);
    // Tactical Arena game mode — a full-screen 2v2/4v4 deathmatch + capture-scroll
    // match (separate from the 1v1/2v2 battle). Teams are built + frozen on launch.
    const [arenaMatch, setArenaMatch] = useState<{ blue: ArenaSlot[]; red: ArenaSlot[]; seed: number; vsAi: boolean } | null>(null);
    // Server-authoritative Warfront reward token (minted at vs-AI launch, redeemed on win).
    const warfrontRewardToken = useRef<Promise<string | null> | null>(null);
    // Co-op (play the Tactical Arena 4v4 with friends) — opens the lobby overlay.
    const [showCoop, setShowCoop] = useState(false);
    // Top-level view switch. "battle" is the classic cinematic 1v1/2v2 duel;
    // "tactical" is the full-screen team game mode (vs AI / challenge / co-op).
    // Defaults to the cinematic battle so Pet Arena opens straight into it.
    const [arenaView, setArenaView] = useState<"battle" | "tactical" | "gauntlet">("battle");
    // Tactical Arena setup (single screen): a size toggle + a team grid shared by
    // Fight AI and Challenge-a-Player. Picks seed to the top pets and re-seed on
    // a size change.
    // Warfront is always 4v4 (2v2 retired with capture-scroll); kept as state-shaped
    // const so the challenge payload + pick caps read unchanged.
    const [tacticalSize] = useState<2 | 4>(4);
    // War Council preference for the Warfront's 30 s buy rounds: manual popup or
    // a silent auto-buy policy. Per-device persisted; PvP/co-op always lock auto
    // so both clients' replays stay deterministic.
    const [wfAutoPref, setWfAutoPref] = useState<WfBuyPolicy>(() => {
        try {
            const v = localStorage.getItem("wfAutoBuy.v1");
            return v === "balanced" || v === "offense" || v === "defense" ? v : "off";
        } catch { return "off"; }
    });
    const setWfAuto = (p: WfBuyPolicy) => {
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
    const [tacticalPicks, setTacticalPicks] = useState<string[]>(() => pickArenaTeam(character.pets, 4).map((p) => p.id));
    const [arenaChallengeName, setArenaChallengeName] = useState("");
    const [arenaChallengeMsg, setArenaChallengeMsg] = useState("");
    // 5→1 pre-roll shown to both players before the match plays. Holds the built
    // slots; when it hits 0 we mount PetArenaMatch (same seed → identical fight).
    const [arenaCountdown, setArenaCountdown] = useState<{ secs: number; match: { blue: ArenaSlot[]; red: ArenaSlot[]; seed: number; vsAi: boolean } } | null>(null);
    // Responder team picks (for an incoming arena challenge, separate from the
    // wizard's tacticalPicks so an in-progress send isn't clobbered).
    const [respondPicks, setRespondPicks] = useState<string[]>([]);

    // Report "a tactical pet match is in progress" up to App for the global
    // navigation lock. The cinematic 1v1/2v2 duel is deterministic auto-playback
    // (result is computed + applied before the animation), so it's not a
    // loss-dodge vector and isn't locked; the full-screen tactical match is.
    useEffect(() => {
        const active = arenaMatch !== null || arenaCountdown !== null;
        onBattleActiveChange?.(active);
        return () => onBattleActiveChange?.(false);
    }, [arenaMatch, arenaCountdown, onBattleActiveChange]);

    function sendDirectPetChallenge(toName: string) {
        const targetRecord = allServerPlayers.find((player) => player.name.toLowerCase() === toName.toLowerCase());
        if (targetRecord?.character && targetRecord.character.pets.length === 0) {
            setPetChallengeMsg(`${toName} does not have a pet available for battle.`);
            return;
        }
        if (!selectedPet) {
            setPetChallengeMsg("Choose one of your pets first.");
            return;
        }
        // 2v2 challenge needs the player to have a reserve and the target
        // to have at least 2 pets. If either fails, fall back to 1v1.
        const wantsParty = partyMode && character.pets.length >= 2;
        const reserveCandidate = wantsParty
            ? (character.pets.find(p => p.id === reservePetId && p.id !== selectedPet.id)
                ?? character.pets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0]
                ?? null)
            : null;
        const targetCanParty = (targetRecord?.character?.pets?.length ?? 0) >= 2;
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
    function startArenaMatch(blue: Pet[], red: Pet[], seed: number, vsAi = false) {
        // Use the existing five-second pre-roll to fetch/parse Three + the arena
        // renderer instead of showing another loading panel after the countdown.
        void loadPetColiseum().catch(() => undefined);
        const n = Math.max(1, Math.min(blue.length, red.length));
        setArenaView("tactical");
        // vs-AI is server-authoritative — mint the reward token now (the server
        // re-runs this exact match); the 5s countdown gives it time to resolve.
        if (vsAi) mintWarfrontToken(seed, blue.slice(0, n));
        setArenaCountdown({ secs: 5, match: { blue: autoRoleTeam(blue, n), red: autoRoleTeam(red, n), seed, vsAi } });
    }

    // Hollow Warfront vs-AI is SERVER-AUTHORITATIVE. At launch we mint a token via
    // /api/pet/warfront-start: the server RE-RUNS the exact deterministic match and
    // seals the winner + reward level. Same inputs → same result on any browser
    // (the sim is cross-engine deterministic; scripts/warfront-parity.test.ts proves
    // server re-sim === the streamed render), so a win on screen always redeems.
    function mintWarfrontToken(seed: number, bluePets: Pet[]) {
        const reportKey = `${seed}:tactical`;
        // Lock the buy to a deterministic policy (never interactive "off") so the
        // server can reproduce the match — the player still picks offense/defense/balanced.
        const buyPolicy = wfAutoPref === "off" ? "balanced" : wfAutoPref;
        warfrontRewardToken.current = (async () => {
            try {
                const r = await fetch("/api/pet/warfront-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerName: character.name, playerPetIds: bluePets.map((p) => p.id), seed, stance: wfStancePref, doctrine: wfDoctrinePref, buyPolicy, reportKey }),
                });
                if (!r.ok) return null;
                const data = await r.json().catch(() => null) as { token?: unknown } | null;
                return typeof data?.token === "string" ? data.token : null;
            } catch { return null; }
        })();
    }

    // Tactical Arena reward (vs-AI only): redeem the sealed Warfront token. The
    // player is `blue`, so a blue win = a player win; battle-result pays from the
    // token's SEALED outcome + opponent level, never the client's claim. Sealed by
    // seed (`${seed}:tactical`) so a refresh-replay can't double-claim. PvP tactical
    // matches pay nothing on purpose (the player isn't always "blue"; rewarding both
    // sides invites collusion farming).
    function reportTacticalArenaWin(m: { red: ArenaSlot[]; seed: number; vsAi: boolean }, winner: "blue" | "red" | "draw") {
        if (!m.vsAi || winner !== "blue") return;
        void (async () => {
            try {
                const battleToken = await (warfrontRewardToken.current ?? Promise.resolve(null));
                if (!battleToken) return;   // no server token → no payout (server authority is required)
                const r = await fetch("/api/pet/battle-result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerName: character.name, outcome: "win", reportKey: `${m.seed}:tactical`, battleToken }),
                });
                if (r.ok) {
                    const data = await r.json().catch(() => null) as { character?: Character } | null;
                    if (data?.character) updateCharacter(data.character);
                }
            } catch { /* honest wins just won't pay if the report drops */ }
        })();
    }

    // Send a Tactical Arena PvP challenge with my hand-picked roster. Rides the
    // same /api/player/challenge delivery as cinematic pet challenges (mode
    // "clanWarPet" so the global accept banner surfaces it) but flagged
    // arenaMatch; my roster is referenced by id (resolved against the server-kept
    // challenger.pets snapshot) for a deterministic match.
    async function sendArenaChallenge(toName: string, size: 2 | 4, teamIds: string[]) {
        const name = toName.trim();
        if (!name) { setArenaChallengeMsg("Enter a player name to challenge."); return; }
        if (name.toLowerCase() === character.name.toLowerCase()) { setArenaChallengeMsg("You can't challenge yourself."); return; }
        if (teamIds.length < size) { setArenaChallengeMsg(`A ${size}v${size} match requires ${size} available pets.`); return; }
        const targetRecord = allServerPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (targetRecord?.character && availablePetBattleCount(targetRecord.character.pets) < size) {
            setArenaChallengeMsg(`${name} needs ${size} available pets for a ${size}v${size} arena match.`);
            return;
        }
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: name,
            challenger: character,
            petBattleSeed: Date.now() + Math.floor(Math.random() * 100000),
            createdAt: Date.now(),
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
            .map((id) => character.pets.find((pet) => pet.id === id && !isPetOnExpedition(pet)))
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
        startArenaMatch(blue, myTeam, challenge.petBattleSeed ?? 1);
    }

    const playerOpponentPets: PetArenaOpponent[] = playerRoster
        .filter((player) => player.name !== character.name)
        .flatMap((player) => player.character.pets.filter((pet) => !isPetOnExpedition(pet)).map((pet) => ({ owner: player.name, pet })));
    const playerOpponentQuery = opponentSearch.trim().toLowerCase();
    const filteredPlayerOpponentPets = playerOpponentQuery
        ? playerOpponentPets.filter((entry) => entry.owner.toLowerCase().includes(playerOpponentQuery))
        : playerOpponentPets;
    const opponentPets: PetArenaOpponent[] = opponentMode === "player" ? filteredPlayerOpponentPets : genericPetArenaOpponents;
    const [selectedOpponentKey, setSelectedOpponentKey] = useState("");
    const selectedPet = character.pets.find((pet) => pet.id === selectedPetId && !isPetOnExpedition(pet)) ?? character.pets.find((pet) => !isPetOnExpedition(pet));
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
    const [battleFrames, setBattleFrames] = useState<PetArenaFrame[]>([]);
    // When the new continuous engine resolves a NON-ranked fight (petDuelEngine.v1
    // ON), this holds the precomputed DuelResult + combatants for PetColiseumDuel
    // to play. null → the old round engine / PetColiseum path renders instead.
    const [duelBattle, setDuelBattle] = useState<{
        // Exactly one of `result` / `live` is set: a precomputed timeline to watch,
        // or a live player-controlled fight that reports its outcome via onOutcome.
        result: DuelResult | null; live?: LiveDuel | null; onOutcome?: (result: DuelResult) => void;
        playerPet: Pet; enemyPet: Pet;
        playerReservePet?: Pet; enemyReservePet?: Pet; seed: number;
        id: number; // per-fight nonce → React key so "Fight again" remounts the player
    } | null>(null);
    const [duelNonce, setDuelNonce] = useState(0); // monotonic per-fight id source (state, not ref → no render-time ref read)
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [result, setResult] = useState("");
    const [hollowGateSettlementStatus, setHollowGateSettlementStatus] = useState<"idle" | "pending" | "error" | "settled">("idle");
    const hollowGateSettlementRetryRef = useRef<(() => Promise<void>) | null>(null);
    const hollowGateSettlementInFlightRef = useRef(false);
    const hollowGateSettlementFinishedRef = useRef(false);
    const currentFrame = battleFrames[frameIndex];
    const showResult = currentFrame?.actionKind === "result";
    const visibleLog = battleFrames.length ? battleFrames.slice(0, frameIndex + 1).map((frame) => frame.message) : battleLog;

    // Auto-scroll to the fight the moment a battle becomes ready — both sides
    // accept (1v1 or 2v2 / PvP) and the page glides down to the arena so they
    // can watch it play out without hunting for it. Covers every accept path
    // because all three setBattleReady(true) sites flip this same flag.
    const battlefieldRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!battleReady || battleFrames.length === 0) return;
        const t = window.setTimeout(() => {
            battlefieldRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80); // let the battlefield mount first
        return () => window.clearTimeout(t);
    }, [battleReady, battleFrames.length]);

    useEffect(() => {
        if (opponentPets.length === 0) {
            if (selectedOpponentKey) setSelectedOpponentKey("");
            return;
        }
        const keyStillExists = opponentPets.some((entry) => `${entry.owner}:${entry.pet.id}` === selectedOpponentKey);
        if (!selectedOpponentKey || !keyStillExists) setSelectedOpponentKey(`${opponentPets[0].owner}:${opponentPets[0].pet.id}`);
    }, [selectedOpponentKey, opponentMode, opponentPets[0]?.owner, opponentPets[0]?.pet.id, opponentPets.length]);

    useEffect(() => {
        if (!isPlaying) return;
        if (frameIndex >= battleFrames.length - 1) {
            setIsPlaying(false);
            return;
        }
        // Cinematic pacing — let dramatic frames breathe, snap through
        // routine ones. Uniform 1200ms makes every action read the same;
        // variable timing tells the player when to lean in.
        const ms = petFramePace(battleFrames[frameIndex]);
        const timer = window.setTimeout(() => setFrameIndex((index) => Math.min(index + 1, battleFrames.length - 1)), ms);
        return () => window.clearTimeout(timer);
    }, [battleFrames.length, frameIndex, isPlaying]);

    // Battle consumables are applied inside the sim from each pet's loadout
    // (kept deterministic), then spent here once the sim has run. Returns the
    // character.pets array with the given pets' consumable slots cleared.
    function clearConsumablePets(petIds: string[]) {
        return character.pets.map((p) => petIds.includes(p.id) && p.loadout?.consumable
            ? { ...p, loadout: { ...p.loadout, consumable: undefined } }
            : p);
    }

    async function mintCasualPetBattleToken(opponent: PetArenaOpponent, reportKey: string, mode: "1v1" | "2v2", playerPets: Pet[], opponentPets: Pet[], seed: number): Promise<string | null> {
        try {
            const r = await fetch("/api/pet/battle-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName: character.name,
                    opponentName: opponent.owner,
                    opponentLevel: opponent.pet.level,
                    reportKey,
                    mode,
                    playerPetIds: playerPets.map((pet) => pet.id),
                    opponentPetIds: opponentPets.map((pet) => pet.id),
                    seed,
                    hollowGate: opponent.hollowGate
                        ? { token: opponent.hollowGate.token, runId: opponent.hollowGate.runId }
                        : undefined,
                }),
            });
            if (!r.ok) return null;
            const data = await r.json().catch(() => null) as { token?: unknown } | null;
            return typeof data?.token === "string" ? data.token : null;
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
            outcome: petBattleResult.outcome === "win" ? "win" : "loss",
            survivingHp: character.hp,
            petReceipt: petBattleResult.petReceipt,
        });
        if (settled.character) updateCharacter(settled.character);
        setResult(settled.won ? "Victory" : "Defeat");
        setBattleLog((prev) => [
            ...prev,
            settled.won
                ? "The Gate accepts the server-verified pet victory."
                : "The Gate rejects the Hound duel as a victory; 20% max HP recoil was applied once.",
        ]);
        onHollowGatePetBattleEnd?.(settled, opponent);
        return true;
    }

    function startBattle(opponentOverride?: PetArenaOpponent) {
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
        setPartyResult(null);
        setDuelBattle(null); // fresh fight — clear any prior duel overlay
        const nextDuelId = duelNonce + 1; // React key for the duel renderer
        setDuelNonce(nextDuelId);

        // 2v2 party path — two entry points:
        //   • PvP party challenge: opponent already carries both parties (set
        //     when the accept handler fired runPetArenaParty's data through).
        //   • Local AI battle: in-component partyMode toggle, player picks
        //     reserve, AI gets a random second pet from the pool.
        const pvpParty = !!(opponent.opponentParty && opponent.challengerParty);
        const canAiParty = !opponent.hollowGate && partyMode && opponentMode === "ai" && character.pets.length >= 2;
        if (pvpParty || canAiParty) {
            let myLead: Pet;
            let myReserve: Pet;
            let enemyLead: Pet;
            let enemyReserve: Pet;
            if (pvpParty) {
                [myLead, myReserve] = opponent.challengerParty!;
                [enemyLead, enemyReserve] = opponent.opponentParty!;
            } else {
                const reserveCandidate = character.pets.find(p => p.id === reservePetId && p.id !== selectedPet.id)
                    ?? character.pets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0]
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
            const seed = opponent.battleSeed ?? Date.now();
            const reportKey = `${seed}:2v2`;
            const battleTokenPromise = mintCasualPetBattleToken(opponent, reportKey, "2v2", [myLead, myReserve], [enemyLead, enemyReserve], seed);
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
                setResult(partyOutcome === "win" ? "Victory" : partyOutcome === "draw" ? "Draw" : "Defeat");
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
                        const battleToken = await battleTokenPromise;
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
            setBattleFrames([]); setBattleLog([]); setIsPlaying(false);
            if (duel) settleParty(duel.result);
            return;
        }

        // ── Ranked 1v1 (account-level pet ladder) ───────────────────────
        // Both clients must agree on the winner for the Elo ladder to stay
        // honest. runPetArenaBattle is role-asymmetric (its coin flip treats
        // the FIRST arg as "player"), so two clients each passing their own
        // pet first could disagree. Fix: run a CANONICAL simulation — order
        // the two combatants by lowercase owner name so both clients feed
        // the engine identical args (and pass multiplier 1, dropping the
        // per-player Pet-Tamer PvE bonus for fairness). The seeded RNG then
        // produces a byte-identical fight. We render from MY perspective:
        // if I'm the canonical opponent, swap each frame so my pet shows on
        // the left. Rating + W/L fold into ONE updateCharacter (no ryo, no
        // clan-war report, no /api/pet/battle-result call).
        if (opponent.ranked) {
            // Use the handshake-locked pet (selfPet) rather than the UI's
            // selectedPet so both clients simulate the exact same combatants.
            const myPet = opponent.selfPet ?? selectedPet;
            // Keep the picker (and thus the on-grid sprite) in sync with the
            // locked combatant if they diverged after navigation.
            if (opponent.selfPet && opponent.selfPet.id !== selectedPetId) setSelectedPetId(opponent.selfPet.id);
            const myName = character.name.toLowerCase();
            const oppName = opponent.owner.toLowerCase();
            const iAmCanonicalPlayer = myName <= oppName;
            const seed = opponent.battleSeed ?? Date.now();
            const canonicalPlayerPet = iAmCanonicalPlayer ? myPet : opponent.pet;
            const canonicalOpponentPet = iAmCanonicalPlayer ? opponent.pet : myPet;
            // Ranked now resolves on the SAME cinematic duel engine as the Pet
            // Coliseum (the old engines are retired here). Canonical ordering
            // keeps both clients byte-identical, so they agree on the winner;
            // multiplier 1 (no per-player PvE bonus) keeps it fair. We render the
            // canonical duel (canonical player on the left, winner shown correctly)
            // and label Victory/Defeat from MY perspective.
            // applyItems=false (explicit): cinematic defaults items ON, but ranked stays
            // neutral — no gear, no per-player multiplier — so this must opt out.
            const duel = runPetDuelCinematic(canonicalPlayerPet, canonicalOpponentPet, seed, 1, 1, false, false);
            const myResult: "win" | "loss" | "draw" = iAmCanonicalPlayer
                ? duel.result
                : duel.result === "win" ? "loss" : duel.result === "loss" ? "win" : "draw";
            setBattleOpponent(opponent);
            setBattleReady(true);
            setDuelNonce(nextDuelId);
            setDuelBattle({ result: duel, playerPet: canonicalPlayerPet, enemyPet: canonicalOpponentPet, seed, id: nextDuelId });
            setBattleFrames([]); setBattleLog([]); setIsPlaying(false);
            setResult(myResult === "win" ? "Victory" : myResult === "draw" ? "Draw" : "Defeat");
            const myRating = character.petRankedRating ?? 1000;
            const oppRating = opponent.opponentRating ?? 1000;
            // Read-back + activation (audit #7 / Stage 3): the SERVER owns the
            // petRankedRating swing. Report the outcome to /api/pet/battle-result
            // (ranked) — which credits the rating under a save lock with an NX
            // receipt keyed by `${seed}:ranked` (exactly-once) — and read the
            // returned committed character back as the authoritative value.
            // Offline/503 leaves rating and counters unchanged until retry. The shared, stable
            // battleSeed makes reportKey refresh-replay-safe; ranked pet battles
            // are intentionally NOT persisted for resume (see acceptPetChallenge),
            // so this effect fires once and can't double the local counters.
            // counters carry RELATIVE deltas (e.g. +1 win) applied off `prev`
            // inside the updater so a regen/heartbeat setState landing during the
            // await fetch can't be clobbered — and the deltas aren't double-baked
            // onto a stale snapshot. petRankedRating is absolute (server-owned).
            const reportRankedPet = (outcome: "win" | "loss" | "draw") => {
                void (async () => {
                    try {
                        const r = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ playerName: character.name, outcome, ranked: true, matchToken: opponent.petRankedToken, opponentName: opponent.owner, opponentLevel: opponent.pet.level, reportKey: `${seed}:ranked` }),
                        });
                        if (r.ok) {
                            const data = await r.json() as { character?: Character };
                            if (data.character) {
                                updateCharacter({ ...data.character, pets: clearConsumablePets([myPet.id]) });
                                return;
                            }
                        }
                    } catch { /* server save remains authoritative; no local rating/counter fallback */ }
                    updateCharacter((prev) => prev ? ({ ...prev, pets: clearConsumablePets([myPet.id]) }) : prev);
                })();
            };
            if (myResult === "win") {
                const gain = rankedDelta(myRating, oppRating);
                reportRankedPet("win");
                setBattleLog([`🏆 Ranked pet victory! Server settlement requested (projected +${gain} Elo).`]);
            } else if (myResult === "loss") {
                const drop = rankedDelta(oppRating, myRating);
                reportRankedPet("loss");
                setBattleLog([`Ranked pet defeat. Server settlement requested (projected -${drop} Elo).`]);
            } else {
                reportRankedPet("draw");
                setBattleLog(["Ranked pet draw — no Elo change."]);
            }
            if (pendingClanPetBattle) savePendingClanPetBattle(null);
            return;
        }

        const seed1v1 = opponent.battleSeed ?? Date.now();
        const reportKey1v1 = `${seed1v1}:1v1`;
        const battleTokenPromise1v1 = mintCasualPetBattleToken(opponent, reportKey1v1, "1v1", [selectedPet], [opponent.pet], seed1v1);
        // Spend the battle consumable on the pet that fought.
        if (selectedPet.loadout?.consumable) {
            updateCharacter({ ...character, pets: clearConsumablePets([selectedPet.id]) });
        }
        setBattleOpponent(opponent);
        setBattleReady(true);
        // Resolve via the new continuous engine (PetColiseumDuel) or the old round
        // engine (PetColiseum). Outcome + clan-war report + ryo all key off the
        // same `outcome` value, so the swap is invisible to the reward path.
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
            setResult(outcome === "win" ? "Victory" : outcome === "draw" ? "Draw" : "Defeat");
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
                        const battleToken = await battleTokenPromise1v1;
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
                        const battleToken = await battleTokenPromise1v1;
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
                        const battleToken = await battleTokenPromise1v1;
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
        setBattleFrames([]); setBattleLog([]); setIsPlaying(false);
        // Watch-only duels are already decided, so settle immediately as before.
        if (duel) settle1v1(duel.result);
    }

    useEffect(() => {
        if (!pendingPetBattleOpponent || !selectedPet) return;
        startBattle(pendingPetBattleOpponent);
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
        startArenaMatch(pendingArenaMatch.blue, pendingArenaMatch.red, pendingArenaMatch.seed);
        onPendingArenaMatchStarted?.();
    }, [pendingArenaMatch?.seed]);

    // Responder side: an incoming arena challenge arrived → open the tactical
    // view's responder picker, pre-selecting my top pets at the challenge's size.
    useEffect(() => {
        if (!pendingArenaResponse) return;
        setArenaView("tactical");
        setRespondPicks(pickArenaTeam(character.pets, arenaSizeOf(pendingArenaResponse)).map((p) => p.id));
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
    // straight in a battle and shouldn't expose the Tactical Arena switch.
    const isHollowGate = pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate";
    const availableArenaPetCount = availablePetBattleCount(character.pets);
    const tacticalArenaUnlocked = canEnterTacticalArena(character.pets);
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
                className={`pet-pick${sel ? " selected" : ""}`}
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
                                        ? "Big-map team battles — deathmatch + capture the scroll. Fight AI, or team up with a friend against two opponents."
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
                    {character.pets.length === 0 ? (
                        <p className="hint">You need a pet before entering the arena.</p>
                    ) : (
                        <div className="pet-pick-panel">
                            {petPicker(
                                character.pets.map((pet) => ({ key: pet.id, pet, dim: isPetOnExpedition(pet) })),
                                selectedPetId,
                                setSelectedPetId,
                            )}
                        </div>
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
                                setBattleFrames([]);
                                setResult("");
                                setIsPlaying(false);
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
                                setBattleFrames([]);
                                setResult("");
                                setIsPlaying(false);
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

            {character.pets.length >= 2 && (
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
                                    {character.pets.filter((p) => p.id !== selectedPetId).map((pet) =>
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
                            <small>{partyMode && character.pets.length >= 2 ? "2v2 set" : "1v1 duel"}</small>
                        </div>
                        <div className="pet-coliseum-contender enemy">
                            <span className="pet-coliseum-kicker">Arena challenger</span>
                            <strong>{petDisplayName(selectedOpponent.pet)}</strong>
                            <span>Lv.{selectedOpponent.pet.level} · {selectedOpponent.pet.element ?? "Untyped"}</span>
                        </div>
                        <button className="pet-coliseum-enter" onClick={() => startBattle()}>
                            <span>{partyMode && character.pets.length >= 2 ? "Enter the 2v2 Set" : "Enter the Coliseum"}</span>
                            <small>Fight under your command</small>
                        </button>
                    </div>
                ) : opponentMode === "ai" ? (
                    <button onClick={() => startBattle()} disabled>
                        Choose both contenders
                    </button>
                ) : null}
                {battleReady && battleFrames.length > 0 && (
                    <button onClick={() => {
                        if (frameIndex >= battleFrames.length - 1) {
                            setFrameIndex(0);
                            setIsPlaying(true);
                            return;
                        }
                        setIsPlaying((playing) => !playing);
                    }}>
                        {isPlaying ? "Pause" : frameIndex >= battleFrames.length - 1 ? "Replay" : "Resume"}
                    </button>
                )}
                {battleReady && showResult && result && <strong className={result === "Victory" ? "pet-arena-win" : "pet-arena-loss"}>{result}</strong>}
            </div>

            {partyResult && battleReady && showResult && (
                <div className="summary-box" style={{ marginTop: "0.4rem", padding: "0.5rem 0.7rem" }}>
                    <strong>Set: {partyResult.playerWins}–{partyResult.opponentWins}{partyResult.draws ? ` (${partyResult.draws} draw)` : ""}</strong>
                    {partyResult.matches.map((m, i) => (
                        <div key={i} style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: 2 }}>
                            Match {i + 1}: {m.playerPet?.name ?? "—"} vs {m.opponentPet?.name ?? "—"} → <strong style={{ color: m.result === "win" ? "var(--green-400)" : m.result === "loss" ? "var(--red-400)" : "var(--gold)" }}>{m.result}</strong>
                        </div>
                    ))}
                </div>
            )}

            {/* Live PvP: the invite prompt, the "waiting to be accepted" notice and
                the fight itself all live here. Renders nothing when idle. */}
            <PetDuelLiveHost
                ref={liveDuelRef}
                myPets={[selectedPet, partyMode ? character.pets.find((p) => p.id === reservePetId) : null].filter((p): p is Pet => !!p)}
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

            {battleReady && selectedPet && (battleOpponent ?? selectedOpponent) && (
                <div ref={battlefieldRef} className="pet-arena-stage-wrap" style={{ scrollMarginTop: "12px" }}>
                {duelBattle ? (
                    // New continuous engine (petDuelEngine.v1 ON, non-ranked): the
                    // screen already resolved the DuelResult + posted the outcome;
                    // PetColiseumDuel just PLAYS it (full-screen portal). onExit
                    // clears the duel + honours the opponent's returnScreen (Hollow
                    // Gate sends you back to the shrine).
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
                            onFightAgain={battleOpponent?.hollowGate ? undefined : () => startBattle(battleOpponent ?? undefined)}
                            settlementStatus={battleOpponent?.hollowGate ? hollowGateSettlementStatus : undefined}
                            onRetrySettlement={battleOpponent?.hollowGate ? retryHollowGateSettlement : undefined}
                            onExit={leaveCurrentPetBattle}
                        />
                    </Suspense>
                ) : (() => {
                    // Prop block for the HD-2D coliseum renderer. The renderer is a
                    // pure presentation layer over the deterministic battle frames;
                    // the engine and frame-stepping own the outcome.
                    const battleProps = {
                        playerPet: selectedPet,
                        enemyPet: (battleOpponent ?? selectedOpponent)!.pet,
                        enemyOwner: (battleOpponent ?? selectedOpponent)!.owner,
                        // 2v2 mode — pass reserves so the renderer can place all
                        // 4 pets on the grid and show 4 HP bars. partyResult tracks
                        // them via matches[1] (or the opponent's carried
                        // challengerParty/opponentParty for PvP).
                        playerReservePet:
                            partyResult?.matches[1]?.playerPet
                            ?? (battleOpponent?.challengerParty ? battleOpponent.challengerParty[1] : undefined)
                            ?? (partyMode && opponentMode === "ai"
                                ? (character.pets.find(p => p.id === reservePetId && p.id !== selectedPet.id)
                                    ?? character.pets.filter(p => p.id !== selectedPet.id && !isPetOnExpedition(p))[0])
                                : undefined),
                        enemyReservePet:
                            partyResult?.matches[1]?.opponentPet
                            ?? (battleOpponent?.opponentParty ? battleOpponent.opponentParty[1] : undefined)
                            ?? undefined,
                        frame: currentFrame,
                        recentFrames: battleFrames.slice(Math.max(0, frameIndex - 2), frameIndex + 1).filter(f => f.actionKind && f.actionKind !== "result"),
                        result: showResult ? result : "",
                        obstacles: [],
                        tiles: [],
                        onReplay: () => {
                            if (!battleFrames.length) return;
                            setFrameIndex(0);
                            setIsPlaying(true);
                        },
                        onFightAgain: battleOpponent?.hollowGate ? undefined : () => startBattle(),
                        settlementStatus: battleOpponent?.hollowGate ? hollowGateSettlementStatus : undefined,
                        onRetrySettlement: battleOpponent?.hollowGate ? retryHollowGateSettlement : undefined,
                        onExit: () => {
                            // Honour the opponent's returnScreen override if provided —
                            // Hollow Gate pet_battle tiles set this to "hollowGateShrine"
                            // so the duel sends you back to the dungeon, not the village hub.
                            leaveCurrentPetBattle();
                        },
                        sharedImages,
                        playerRecord: { wins: character.petRankedWins ?? 0, losses: character.petRankedLosses ?? 0, rating: character.petRankedRating ?? 1000 },
                        enemyRecord: (() => {
                            // Ranked PvP carries the opponent's Elo snapshot; we don't
                            // track their W/L, so show rating only. AI/wild opponents
                            // carry no rating → no record card for them.
                            const opp = (battleOpponent ?? selectedOpponent);
                            return opp?.opponentRating !== undefined ? { rating: opp.opponentRating } : undefined;
                        })(),
                    };
                    // HD-2D coliseum is the arena renderer — lazy-loaded so
                    // three/r3f only ship when a battle actually mounts (the
                    // cold-landing bundle is untouched).
                    return (
                        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading 3D arena…</div>}>
                            <PetColiseum {...battleProps} />
                        </Suspense>
                    );
                })()}
                </div>
            )}

            <section className="summary-box pet-arena-log">
                <h3>Battle Log</h3>
                {visibleLog.length === 0 ? <p className="hint">Start a match to watch the pets fight.</p> : visibleLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
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
                            A lane war on a huge 3D battlefield: hollow-spawn pour from the central Hollow Gate breach, two Guardian Totems ward each village outpost, and shattering the enemy WARD SEAL wins. Every kill pays bounty coins — spend them at the 90-second War Council, where you can also switch your team's formation. Ten minutes; Ward Seal or Judgment. Beat the AI team to earn pet-arena ryo (daily cap applies).
                        </p>
                    </div>

                    {(() => {
                        const available = character.pets.filter((p) => !isPetOnExpedition(p));
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
                                            className={`pet-pick${sel ? " selected" : ""}`}
                                            title={rm ? `${petDisplayName(pet)} — ${rm.label} (${subRole})` : petDisplayName(pet)}
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
                                        <button disabled={respondPicks.length !== size || available.length < size} style={{ background: "#16a34a" }}
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
                        const canStart = available.length >= tacticalSize && tacticalPicks.length === tacticalSize;
                        return (
                            <div style={{ display: "grid", gap: "0.7rem" }}>
                                <div className="pet-arena-tactical-top">
                                    <div style={{ display: "grid", gap: "0.7rem", alignContent: "start" }}>
                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>📯 War Council (every 90s)</label>
                                            <div className="pet-arena-mode-toggle" style={{ maxWidth: 470, marginTop: 6 }}>
                                                {(["off", "balanced", "offense", "defense"] as const).map((p) => (
                                                    <button key={p} type="button" className={wfAutoPref === p ? "active" : ""} onClick={() => setWfAuto(p)}>
                                                        {p === "off" ? "🖐 Manual" : p === "balanced" ? "⚖ Auto" : p === "offense" ? "🗡 Auto-Attack" : "🛡 Auto-Guard"}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>Manual pauses every 90s to spend bounty coins yourself; Auto spends for you. PvP and co-op always run Auto so both players see the identical match.</p>
                                        </div>

                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>📜 Opening formation</label>
                                            <div className="pet-arena-mode-toggle" style={{ maxWidth: 620, marginTop: 6, flexWrap: "wrap" }}>
                                                {WF_STANCES.map((s) => (
                                                    <button key={s.id} type="button" title={s.desc} className={wfStancePref === s.id ? "active" : ""} onClick={() => setWfStance(s.id)}>
                                                        {s.icon} {s.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>Your team's strategy on the field — the enemy coach counter-picks, and you can adjust yours at every War Council.</p>
                                        </div>

                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>🎖 Team doctrine</label>
                                            <div className="pet-arena-mode-toggle" style={{ maxWidth: 620, marginTop: 6, flexWrap: "wrap" }}>
                                                {WF_DOCTRINES.map((d) => (
                                                    <button key={d.id} type="button" title={d.desc} className={wfDoctrinePref === d.id ? "active" : ""} onClick={() => setWfDoctrine(d.id)}>
                                                        {d.icon} {d.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="hint" style={{ margin: "4px 0 0" }}>A team-wide boon baked in at kickoff — a second strategic axis to your formation.</p>
                                        </div>

                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Your team ({tacticalPicks.length}/{tacticalSize}) — tap to add / remove</label>
                                            <div style={{ marginTop: 6 }}>
                                                {available.length < tacticalSize
                                                    ? <p className="hint" style={{ color: "var(--gold-2)", margin: 0 }}>This 4v4 mode requires {tacticalSize} available pets. You currently have {available.length}; pets on expeditions do not count.</p>
                                                    : <div className="pet-pick-panel">{pickGrid(tacticalPicks, setTacticalPicks, tacticalSize)}</div>}
                                            </div>
                                        </div>
                                    </div>

                                    <BattlePlan pets={character.pets.filter((p) => tacticalPicks.includes(p.id))} size={tacticalSize} />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.7rem" }}>
                                    <div className="summary-box" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
                                        <strong>🤖 Fight AI</strong>
                                        <button disabled={!canStart} style={{ background: "#0e7490" }}
                                            onClick={() => {
                                                const mine = character.pets.filter((p) => tacticalPicks.includes(p.id));
                                                if (!mine.length) return;
                                                // Match the AI team to my count by cycling the 3-pet pool
                                                // (cloned so the sim never shares a pet reference).
                                                const pool = genericPetArenaOpponents.map((o) => o.pet);
                                                const ai = Array.from({ length: mine.length }, (_, i) => ({ ...pool[i % pool.length] }));
                                                startArenaMatch(mine, ai, (Date.now() % 100000) || 1, true);
                                            }}>
                                            Start vs AI
                                        </button>
                                    </div>

                                    <div className="summary-box" style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
                                        <strong>⚔️ Challenge a Player</strong>
                                        <input
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

            {/* Full-screen game-mode overlays — launched from the Tactical Arena
                view; rendered here so they sit above whichever view is active. */}
            {arenaMatch && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>Loading the Warfront…</div>}>
                    <PetWarfrontMatch
                        blue={arenaMatch.blue} red={arenaMatch.red} seed={arenaMatch.seed}
                        theme={wfThemeForVillage(character.village)}
                        autoBuy={arenaMatch.vsAi ? (wfAutoPref === "off" ? "balanced" : wfAutoPref) : "balanced"}
                        stance={wfStancePref}
                        doctrine={wfDoctrinePref}
                        allowReseed={arenaMatch.vsAi}
                        onResult={(result) => reportTacticalArenaWin(arenaMatch, result.winner ?? "draw")}
                        onExit={() => setArenaMatch(null)}
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
                <div style={{ position: "fixed", inset: 0, zIndex: 1000000, background: "rgba(5,6,10,0.94)", display: "grid", placeItems: "center" }}>
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

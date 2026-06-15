/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import type { Character, PlayerRecord, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen, JutsuElement } from "../types/core";
import { PET_GRID_COLS, PET_ELEMENT_BEATS } from "../constants/pet-arena";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { type ArenaTile } from "../lib/pet-tactics";
import { mirrorPetTile, petFramePace, pickBestPartyOrder, runPetArenaBattle, runPetArenaParty, scorePetMatchup, swapPetArenaFrame, type PetPartyBattleResult } from "../lib/pet-battle-sim";
import { runPetDuel, runPetPartyDuel, type DuelResult } from "../lib/pet-duel-sim";
import { petDuelEngineEnabled } from "../lib/pet-coliseum-flag";
import { isPetOnExpedition, petDisplayName, pickArenaTeam } from "../lib/pet";
import { derivePetRole, ROLE_META, type PetRole } from "../lib/pet-roles";
import { ROLE_ICON } from "../lib/role-icons";
import { ELEMENT_ICON } from "../lib/element-icons";
import { primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic } from "../lib/pet-music";
import { rankedDelta } from "../lib/progression";
import { currentDateKey, makeId } from "../lib/utils";
import { genericPetArenaOpponents, type PetArenaOpponent } from "../data/pet-arena-opponents";
import {
    petTamerPveMultiplier,
    type DuelChallenge,
    type PetArenaFrame,
} from "../App";
import { loadPendingClanPetBattle, savePendingClanPetBattle } from "../lib/world-state";
import { resolveChallengerTeam, stripInlinePetImages, arenaSizeOf } from "../lib/arena-challenge";
import type { ArenaSlot, ArenaRole } from "../lib/pet-arena-sim";
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
const PetColiseum = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseum })));
// Continuous-duel renderer (the new authoritative PvE engine, behind
// petDuelEngine.v1) — same lazy chunk, mounted instead of PetColiseum when the
// flag is on for a non-ranked fight.
const PetColiseumDuel = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));
// Tactical Arena game mode (deathmatch + capture-scroll, 2v2 / 4v4) — same lazy chunk.
const PetArenaMatch = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetArenaMatch })));
// Co-op lobby (play the Tactical Arena 4v4 with friends) — lazy; pulls the arena chunk.
const ArenaCoopLobby = lazy(() => import("../components/ArenaCoopLobby").then((m) => ({ default: m.ArenaCoopLobby })));

// Build the arena slots from each pet's NATIVE role (pet.role, set by
// derivePetRole + backfilled in capPetStats). Pets now carry an intrinsic role,
// so the tactical AI reads it directly instead of stat-guessing a comp. Fallback
// to derivePetRole for any pet that somehow lacks one.
function autoRoleTeam(pets: Pet[], count: number): ArenaSlot[] {
    return pets.slice(0, Math.max(1, count)).map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));
}

export function PetArena({ character, updateCharacter, playerRoster, allServerPlayers, setScreen, sharedImages, duelChallenges, setDuelChallenges, pendingPetBattleOpponent, onPendingPetBattleStarted, pendingArenaMatch, onPendingArenaMatchStarted, pendingArenaResponse, onArenaResponseHandled, onClanWarBattleEnd, onBattleActiveChange }: { character: Character; updateCharacter: (character: Character) => void; playerRoster: PlayerRecord[]; allServerPlayers: ServerPlayerSummary[]; setScreen: (screen: Screen) => void; sharedImages: Record<string, string>; duelChallenges: DuelChallenge[]; setDuelChallenges: (c: DuelChallenge[]) => void; pendingPetBattleOpponent?: PetArenaOpponent | null; onPendingPetBattleStarted?: () => void; pendingArenaMatch?: { blue: Pet[]; red: Pet[]; size: 2 | 4; seed: number } | null; onPendingArenaMatchStarted?: () => void; pendingArenaResponse?: DuelChallenge | null; onArenaResponseHandled?: () => void; onClanWarBattleEnd?: (youWon: boolean | "draw", opponentName?: string) => void; onBattleActiveChange?: (active: boolean) => void }) {
    const [selectedPetId, setSelectedPetId] = useState(character.activePetId ?? character.pets[0]?.id ?? "");
    const [opponentMode, setOpponentMode] = useState<"player" | "ai">("player");
    const [opponentSearch, setOpponentSearch] = useState("");
    const [petChallengeMsg, setPetChallengeMsg] = useState("");
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
    const [arenaMatch, setArenaMatch] = useState<{ blue: ArenaSlot[]; red: ArenaSlot[]; seed: number } | null>(null);
    // Co-op (play the Tactical Arena 4v4 with friends) — opens the lobby overlay.
    const [showCoop, setShowCoop] = useState(false);
    // Top-level view switch. "battle" is the classic cinematic 1v1/2v2 duel;
    // "tactical" is the full-screen team game mode (vs AI / challenge / co-op).
    // Defaults to the cinematic battle so Pet Arena opens straight into it.
    const [arenaView, setArenaView] = useState<"battle" | "tactical">("battle");
    // Tactical Arena setup (single screen): a size toggle + a team grid shared by
    // Fight AI and Challenge-a-Player. Picks seed to the top pets and re-seed on
    // a size change.
    const [tacticalSize, setTacticalSize] = useState<2 | 4>(4);
    const [tacticalPicks, setTacticalPicks] = useState<string[]>(() => pickArenaTeam(character.pets, 4).map((p) => p.id));
    const [arenaChallengeName, setArenaChallengeName] = useState("");
    const [arenaChallengeMsg, setArenaChallengeMsg] = useState("");
    // 5→1 pre-roll shown to both players before the match plays. Holds the built
    // slots; when it hits 0 we mount PetArenaMatch (same seed → identical fight).
    const [arenaCountdown, setArenaCountdown] = useState<{ secs: number; match: { blue: ArenaSlot[]; red: ArenaSlot[]; seed: number } } | null>(null);
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

    async function sendDirectPetChallenge(toName: string, fromPetId?: string) {
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
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName,
            challenger: character,
            challengerPetId: doParty ? selectedPet.id : fromPetId,
            petBattleSeed: Date.now() + Math.floor(Math.random() * 100000),
            createdAt: Date.now(),
            mode: "clanWarPet",
            ...(doParty && reserveCandidate ? {
                petParty: true,
                challengerPetIds: [selectedPet.id, reserveCandidate.id] as [string, string],
            } : {}),
        };
        try {
            const res = await fetch('/api/player/challenge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetName: toName, challenge }),
            });
            if (!res.ok) {
                // The server returns a specific reason for every reject: a 409
                // block (target traveling / in battle / engaged), or a 403
                // Academy protection (sub-Genin targets — a fresh Lv 1 can't be
                // challenged until Genin). Surface that message instead of a
                // blanket "could not reach", which made a deliberate block look
                // like a typo or a connectivity failure.
                const data = await res.json().catch(() => ({} as { error?: string }));
                setPetChallengeMsg(`❌ ${data?.error ?? `Could not reach ${toName}. Check the name and try again.`}`);
                return;
            }
            // Drop our prior pending outgoing challenge (server just superseded
            // it) and keep this fresh one.
            setDuelChallenges([
                ...duelChallenges.filter((c: DuelChallenge) => !(c.fromName === character.name && !c.accepted && !c.declined && !c.battleId)),
                challenge,
            ]);
            setPetChallengeMsg(`✅ Pet challenge sent to ${toName}! They'll see it shortly.`);
        } catch {
            setPetChallengeMsg(`❌ Network error sending challenge.`);
        }
    }

    // Build the role-assigned slots + start the 5s pre-roll, evening both teams
    // to the smaller roster so a lopsided pick can't auto-stomp. Both clients
    // run this from identical embedded teams, so the match stays in sync.
    function startArenaMatch(blue: Pet[], red: Pet[], seed: number) {
        const n = Math.max(1, Math.min(blue.length, red.length));
        setArenaView("tactical");
        setArenaCountdown({ secs: 5, match: { blue: autoRoleTeam(blue, n), red: autoRoleTeam(red, n), seed } });
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
        if (teamIds.length < 1) { setArenaChallengeMsg("Pick at least one pet for your team."); return; }
        const targetRecord = allServerPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (targetRecord?.character && targetRecord.character.pets.length === 0) {
            setArenaChallengeMsg(`${name} has no pets available for an arena match.`);
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
        const myTeam = character.pets.filter((p) => teamIds.includes(p.id));
        const blue = resolveChallengerTeam(challenge);
        if (!myTeam.length || !blue.length) { onArenaResponseHandled?.(); return; }
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
    const [battleReady, setBattleReady] = useState(false);
    const [battleOpponent, setBattleOpponent] = useState<PetArenaOpponent | null>(null);
    const [battleLog, setBattleLog] = useState<string[]>([]);
    const [battleFrames, setBattleFrames] = useState<PetArenaFrame[]>([]);
    const [battleObstacles, setBattleObstacles] = useState<number[]>([]);
    const [battleTiles, setBattleTiles] = useState<ArenaTile[]>([]);
    // When the new continuous engine resolves a NON-ranked fight (petDuelEngine.v1
    // ON), this holds the precomputed DuelResult + combatants for PetColiseumDuel
    // to play. null → the old round engine / PetColiseum path renders instead.
    const [duelBattle, setDuelBattle] = useState<{
        result: DuelResult; playerPet: Pet; enemyPet: Pet;
        playerReservePet?: Pet; enemyReservePet?: Pet; seed: number;
        id: number; // per-fight nonce → React key so "Fight again" remounts the player
    } | null>(null);
    const [duelNonce, setDuelNonce] = useState(0); // monotonic per-fight id source (state, not ref → no render-time ref read)
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [result, setResult] = useState("");
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
        const pendingClanPetBattle = loadPendingClanPetBattle();
        if (isPetOnExpedition(opponent.pet)) return alert(`${petDisplayName(opponent.pet)} is exploring and cannot battle right now.`);
        setPartyResult(null);
        setDuelBattle(null); // fresh fight — old-engine paths (incl. ranked) clear any prior duel overlay
        const useDuel = petDuelEngineEnabled(); // new continuous engine for NON-ranked PvE
        const nextDuelId = duelNonce + 1; // React key for the duel renderer (bumped below when useDuel)
        if (useDuel) setDuelNonce(nextDuelId);

        // 2v2 party path — two entry points:
        //   • PvP party challenge: opponent already carries both parties (set
        //     when the accept handler fired runPetArenaParty's data through).
        //   • Local AI battle: in-component partyMode toggle, player picks
        //     reserve, AI gets a random second pet from the pool.
        const pvpParty = !!(opponent.opponentParty && opponent.challengerParty);
        const canAiParty = partyMode && opponentMode === "ai" && character.pets.length >= 2;
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
            // Spend any battle consumables on the pets that fought (2v2) — both engines.
            if ([myLead, myReserve].some((p) => p.loadout?.consumable)) {
                updateCharacter({ ...character, pets: clearConsumablePets([myLead.id, myReserve.id]) });
            }
            setBattleOpponent(opponent);
            setBattleReady(true);
            // Resolve via the new continuous engine (ONE 2v2 teamfight) or the old
            // best-of-3 round engine. matchesWon drives the per-win ryo reports: the
            // teamfight pays 0/1 (one fight = one result), the old set pays per match
            // won (up to 3). Outcome + clan-war report key off the same value.
            let partyOutcome: "win" | "loss" | "draw";
            let matchesWon: number;
            if (useDuel) {
                const duel = runPetPartyDuel(myLead, myReserve, enemyLead, enemyReserve, seed, petTamerPveMultiplier(character));
                partyOutcome = duel.result;
                matchesWon = duel.result === "win" ? 1 : 0;
                setDuelBattle({ result: duel, playerPet: myLead, enemyPet: enemyLead, playerReservePet: myReserve, enemyReservePet: enemyReserve, seed, id: nextDuelId });
                setBattleFrames([]); setBattleLog([]); setIsPlaying(false);
            } else {
                const party = runPetArenaParty([myLead, myReserve], [enemyLead, enemyReserve], opponent.owner, seed, petTamerPveMultiplier(character));
                partyOutcome = party.result;
                matchesWon = party.matches.filter(m => m.result === "win").length;
                // Concatenate match logs/frames into one continuous replay.
                setBattleLog(party.matches.flatMap(m => m.logs).concat(party.summaryLogs));
                setBattleFrames(party.matches.flatMap(m => m.frames));
                setBattleObstacles(party.matches[0]?.obstacles ?? []);
                setBattleTiles(party.matches[0]?.tiles ?? []); // typed terrain now flows from the 2v2 engine
                setFrameIndex(0);
                setIsPlaying(true);
                setPartyResult(party);
            }
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
            const partySeed = opponent.battleSeed ?? `party-${opponent.owner}-${opponent.pet.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            for (let i = 0; i < matchesWon; i++) {
                const reportKey = useDuel ? `${partySeed}:2v2` : `${partySeed}:match:${i}`;
                void (async () => {
                    try {
                        await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                playerName: character.name,
                                outcome: "win",
                                opponentLevel: opponent.pet.level,
                                reportKey,
                            }),
                        });
                    } catch { /* ignore */ }
                })();
            }
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
            const canonicalOpponentOwner = iAmCanonicalPlayer ? opponent.owner : character.name;
            const sim = runPetArenaBattle(canonicalPlayerPet, canonicalOpponentPet, canonicalOpponentOwner, seed, 1);
            const myResult: "win" | "loss" | "draw" = iAmCanonicalPlayer
                ? sim.result
                : sim.result === "win" ? "loss" : sim.result === "loss" ? "win" : "draw";
            setBattleOpponent(opponent);
            setBattleReady(true);
            setBattleObstacles(iAmCanonicalPlayer ? sim.obstacles : sim.obstacles.map(mirrorPetTile));
            // Mirror tactical tiles for the non-canonical side so the local pet
            // still appears on the left (matches the obstacle + frame mirroring).
            setBattleTiles(iAmCanonicalPlayer ? sim.tiles : sim.tiles.map(t => ({ ...t, col: PET_GRID_COLS - 1 - t.col })));
            setBattleFrames(iAmCanonicalPlayer ? sim.frames : sim.frames.map(swapPetArenaFrame));
            setFrameIndex(0);
            setIsPlaying(true);
            setResult(myResult === "win" ? "Victory" : myResult === "draw" ? "Draw" : "Defeat");
            const myRating = character.petRankedRating ?? 1000;
            const oppRating = opponent.opponentRating ?? 1000;
            // Read-back + activation (audit #7 / Stage 3): the SERVER owns the
            // petRankedRating swing. Report the outcome to /api/pet/battle-result
            // (ranked) — which credits the rating under a save lock with an NX
            // receipt keyed by `${seed}:ranked` (exactly-once) — and read the
            // returned rating back as the authoritative value, falling back to
            // the local rankedDelta if the call fails (offline/503) so the rating
            // still updates. The W/L + lifetime pet counters stay LOCAL: they
            // converge (server credits +1 from the same base, and only touches
            // petRankedRating + petRankedWins/Losses). The shared, stable
            // battleSeed makes reportKey refresh-replay-safe; ranked pet battles
            // are intentionally NOT persisted for resume (see acceptPetChallenge),
            // so this effect fires once and can't double the local counters.
            const reportRankedPet = (outcome: "win" | "loss", fallbackRating: number, counters: Partial<Character>) => {
                void (async () => {
                    let newRating = fallbackRating;
                    try {
                        const r = await fetch("/api/pet/battle-result", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ playerName: character.name, outcome, ranked: true, matchToken: opponent.petRankedToken, opponentName: opponent.owner, opponentLevel: opponent.pet.level, reportKey: `${seed}:ranked` }),
                        });
                        if (r.ok) {
                            const data = await r.json() as { rating?: { field: string; value: number } };
                            if (data.rating?.field === "petRankedRating" && Number.isFinite(data.rating.value)) newRating = data.rating.value;
                        }
                    } catch { /* offline → keep the local fallback */ }
                    updateCharacter({ ...character, ...counters, petRankedRating: newRating, pets: clearConsumablePets([myPet.id]) });
                })();
            };
            if (myResult === "win") {
                const gain = rankedDelta(myRating, oppRating);
                reportRankedPet("win", myRating + gain, {
                    petRankedWins: (character.petRankedWins ?? 0) + 1,
                    totalPetWins: (character.totalPetWins ?? 0) + 1,
                    dailyPetWins: (character.dailyPetWins ?? 0) + 1,
                    lastDailyReset: currentDateKey(),
                });
                setBattleLog([...sim.logs, `🏆 Ranked pet victory! +${gain} Elo — now ${myRating + gain}.`]);
            } else if (myResult === "loss") {
                const drop = rankedDelta(oppRating, myRating);
                reportRankedPet("loss", Math.max(0, myRating - drop), {
                    petRankedLosses: (character.petRankedLosses ?? 0) + 1,
                });
                setBattleLog([...sim.logs, `Ranked pet defeat. -${drop} Elo — now ${Math.max(0, myRating - drop)}.`]);
            } else {
                if (character.pets.find((p) => p.id === myPet.id)?.loadout?.consumable) {
                    updateCharacter({ ...character, pets: clearConsumablePets([myPet.id]) });
                }
                setBattleLog([...sim.logs, "Ranked pet draw — no Elo change."]);
            }
            if (pendingClanPetBattle) savePendingClanPetBattle(null);
            return;
        }

        const seed1v1 = opponent.battleSeed ?? Date.now();
        // Spend the battle consumable on the pet that fought.
        if (selectedPet.loadout?.consumable) {
            updateCharacter({ ...character, pets: clearConsumablePets([selectedPet.id]) });
        }
        setBattleOpponent(opponent);
        setBattleReady(true);
        // Resolve via the new continuous engine (PetColiseumDuel) or the old round
        // engine (PetColiseum). Outcome + clan-war report + ryo all key off the
        // same `outcome` value, so the swap is invisible to the reward path.
        let outcome: "win" | "loss" | "draw";
        let logs: string[];
        if (useDuel) {
            const duel = runPetDuel(selectedPet, opponent.pet, seed1v1, petTamerPveMultiplier(character));
            outcome = duel.result;
            logs = [];
            setDuelBattle({ result: duel, playerPet: selectedPet, enemyPet: opponent.pet, seed: seed1v1, id: nextDuelId });
            setBattleFrames([]); setBattleLog([]); setIsPlaying(false);
        } else {
            const battle = runPetArenaBattle(selectedPet, opponent.pet, opponent.owner, seed1v1, petTamerPveMultiplier(character));
            outcome = battle.result;
            logs = battle.logs;
            setBattleLog(battle.logs);
            setBattleFrames(battle.frames);
            setBattleObstacles(battle.obstacles);
            setBattleTiles(battle.tiles ?? []);
            setFrameIndex(0);
            setIsPlaying(true);
        }
        setResult(outcome === "win" ? "Victory" : outcome === "draw" ? "Draw" : "Defeat");
        // Clan-war auto-report (pet 1v1): mirrors the party path. Safe
        // for non-clan-war battles since the helper no-ops without a
        // sessionStorage stash + opponent-name match.
        if (onClanWarBattleEnd) {
            onClanWarBattleEnd(outcome === "draw" ? "draw" : outcome === "win", opponent.owner);
        }
        if (outcome === "win") {
            // Pet Arena rewards are server-validated: we POST the win and the
            // server applies ryo + increments totalPetWins / dailyPetWins
            // under a per-player lock + 5s rate-limit + daily cap. Client no
            // longer touches ryo directly here. Falls back to old behavior if
            // the endpoint is unreachable so existing saves don't get stuck.
            void (async () => {
                try {
                    // reportKey: seed-based when we have a battleSeed (refresh-
                    // replay dedupes server-side). When the opponent has no
                    // battleSeed (the static genericPetArenaOpponents AI list,
                    // or any roster opponent lacking a stamp), fall back to a
                    // click-stable key so the server doesn't 400 — Tier-2
                    // security fix made reportKey REQUIRED for wins. The
                    // server's daily cap + rate limits still bound damage.
                    const effectiveSeed = opponent.battleSeed ?? `1v1-${opponent.owner}-${opponent.pet.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const r = await fetch("/api/pet/battle-result", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            playerName: character.name,
                            outcome: "win",
                            opponentLevel: opponent.pet.level,
                            reportKey: `${effectiveSeed}:1v1`,
                        }),
                    });
                    if (r.ok) {
                        const data = await r.json() as { reward?: number; totalPetWins?: number; dailyPetWins?: number; capped?: boolean };
                        updateCharacter({
                            ...character,
                            ryo: character.ryo + (data.reward ?? 0),
                            totalPetWins: data.totalPetWins ?? ((character.totalPetWins ?? 0) + 1),
                            dailyPetWins: data.dailyPetWins ?? ((character.dailyPetWins ?? 0) + 1),
                            lastDailyReset: currentDateKey(),
                        });
                        if (data.capped) {
                            setBattleLog([...logs, "Daily Pet Arena reward cap reached — wins still count, but no more ryo today."]);
                        }
                    } else {
                        // Server refused — DON'T grant ryo locally. Stats stay client-side as before.
                        updateCharacter({
                            ...character,
                            totalPetWins: (character.totalPetWins ?? 0) + 1,
                            dailyPetWins: (character.dailyPetWins ?? 0) + 1,
                            lastDailyReset: currentDateKey(),
                        });
                    }
                } catch {
                    // Network error — record the win locally for counter UX, skip ryo.
                    updateCharacter({
                        ...character,
                        totalPetWins: (character.totalPetWins ?? 0) + 1,
                        dailyPetWins: (character.dailyPetWins ?? 0) + 1,
                        lastDailyReset: currentDateKey(),
                    });
                }
            })();
            // Old point-based clan war pet-battle credit removed — the new
            // server-managed Clan War system handles pet battles via the
            // onClanWarBattleEnd auto-report path above. The pendingClanPetBattle
            // helper is still cleared below for backwards compatibility with
            // saves that have the legacy breadcrumb.
        } else if (opponent.owner === "Hollow Gate") {
            // Pet duel lost inside the Hollow Gate Shrine — trainer takes
            // 20% maxHp damage as residual chakra burns through the seal.
            // Mirrors the Arena loss rule for non-boss Hollow Gate fights.
            // Player still returns to the shrine via the exit button's
            // returnScreen; not hospitalized, not run-ending.
            const dmg = Math.max(1, Math.floor(character.maxHp * 0.20));
            const nextHp = Math.max(1, character.hp - dmg);
            updateCharacter({ ...character, hp: nextHp });
            setBattleLog([...logs, `${character.name} took ${dmg} HP (20% of max) as the Hollow Beast's chakra recoiled through the seal.`]);
        }
        if (pendingClanPetBattle) savePendingClanPetBattle(null);
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

    // Render one pet as a visual pick-card (portrait + role badge + level/element).
    // Shared by the cinematic battle view's pickers below — replaces the bare
    // <select> dropdowns so picking a pet is a tap on its art, not a text line.
    const petPickCard = (key: string, pet: Pet, sel: boolean, onClick: () => void, opts?: { owner?: string; dim?: boolean }) => {
        const baseId = pet.id.replace(/-\d{10,}$/, "");
        const img = pet.image || sharedImages[`pet:${pet.id}`] || sharedImages[`pet:${baseId}`] || "";
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
                    onClick={() => {
                        const back = (pendingPetBattleOpponent?.returnScreen || battleOpponent?.returnScreen) ?? "centralHub";
                        setScreen(back);
                    }}
                >
                    {(pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate")
                        ? "Back to Shrine"
                        : "Back to Central"}
                </button>
                <div>
                    {(pendingPetBattleOpponent?.owner === "Hollow Gate" || battleOpponent?.owner === "Hollow Gate") ? (
                        <>
                            <h2 style={{ color: "#a855f7" }}>⛩ Hollow Gate — Hollow Beast Duel</h2>
                            <p className="hint" style={{ color: "#c4b5fd" }}>Your pet faces a corrupted Hollow Beast. Win to claim victory and continue the run; lose to take 20% HP damage and return to the shrine.</p>
                        </>
                    ) : (
                        <>
                            <h2>Pet Arena</h2>
                            <p className="hint">{
                                pendingClanPetBattle
                                    ? `Clan war pet battle pending against ${pendingClanPetBattle.opponentName}. Win to earn ${pendingClanPetBattle.points} clan points.`
                                    : arenaView === "tactical"
                                        ? "Big-map team battles — deathmatch + capture the scroll. Fight AI, or team up with a friend against two opponents."
                                        : "Autobattle only. Pets choose actions using ordered AI rules: low HP buff, opener, highest-power jutsu, then basic attack."
                            }</p>
                        </>
                    )}
                </div>
            </div>

            {/* Top-level view tabs — the cinematic duel vs the Tactical Arena game
                mode. Hidden for forced duels (Hollow Gate) which land in battle. */}
            {!isHollowGate && (
                <div className="pet-arena-mode-toggle" style={{ maxWidth: 460, marginBottom: 14 }}>
                    <button type="button" className={arenaView === "battle" ? "active" : ""} onClick={() => setArenaView("battle")}>
                        ⚔️ Pet Arena
                    </button>
                    <button type="button" className={arenaView === "tactical" ? "active" : ""} onClick={() => setArenaView("tactical")}>
                        🏟️ Tactical Arena
                    </button>
                </div>
            )}

            {duelChallenges.filter((c) => c.mode === "clanWarPet" && !c.clanWarPoints && !c.arenaMatch && c.toName.toLowerCase() === character.name.toLowerCase()).map((c) => (
                <div key={c.id} className="summary-box" style={{ background: "#1e3a2f", border: "1px solid #4ade80", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span>{c.petParty ? "🐾🐾" : "🐾"} <strong>{c.fromName}</strong> challenged you to a {c.petParty ? "2v2 pet battle" : "pet battle"}!</span>
                    <div className="menu" style={{ marginLeft: "auto" }}>
                        <button onClick={() => {
                            const challengerPet = c.challenger.pets.find(p => p.id === c.challengerPetId && !isPetOnExpedition(p)) ?? c.challenger.pets.find(p => !isPetOnExpedition(p));
                            // Party path: auto-pick our top 2 available pets by
                            // level + reconstruct challenger's pair from the IDs
                            // they sent. Fall back to 1v1 if either side can't
                            // field two pets.
                            const wantsParty = c.petParty === true && Array.isArray(c.challengerPetIds);
                            const myAvailable = character.pets.filter(p => !isPetOnExpedition(p));
                            let myParty: [Pet, Pet] | null = null;
                            let chParty: [Pet, Pet] | null = null;
                            if (wantsParty && myAvailable.length >= 2 && challengerPet) {
                                const [chId1, chId2] = c.challengerPetIds!;
                                const ch1 = c.challenger.pets.find(p => p.id === chId1) ?? challengerPet;
                                const ch2 = c.challenger.pets.find(p => p.id === chId2 && p.id !== ch1.id)
                                    ?? c.challenger.pets.find(p => p.id !== ch1.id);
                                if (ch1 && ch2) {
                                    chParty = [ch1, ch2] as [Pet, Pet];
                                    // Smart matchup picker — see acceptPetChallengeGlobal
                                    // for the rationale. Falls back to top-2-by-level
                                    // if pickBestPartyOrder can't decide.
                                    const smart = pickBestPartyOrder(myAvailable, chParty);
                                    if (smart) {
                                        myParty = smart;
                                    } else {
                                        const sorted = [...myAvailable].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
                                        myParty = [sorted[0], sorted[1]] as [Pet, Pet];
                                    }
                                }
                            }
                            const doParty = !!(wantsParty && myParty && chParty);
                            setDuelChallenges(duelChallenges.filter((x) => x.id !== c.id));
                            fetch('/api/player/challenge', {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetName: c.toName, fromName: c.fromName, challengeId: c.id }),
                            }).catch(() => {});
                            fetch('/api/player/challenge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetName: c.fromName, challenge: {
                                    ...c, accepted: true,
                                    fromName: character.name, toName: c.fromName,
                                    responderPetId: selectedPet?.id, responderPet: selectedPet,
                                    ...(doParty && myParty ? {
                                        petParty: true,
                                        responderPetIds: [myParty[0].id, myParty[1].id] as [string, string],
                                        responderParty: myParty,
                                    } : {}),
                                } }),
                            }).catch(() => {});
                            if (challengerPet) {
                                startBattle({
                                    owner: c.fromName,
                                    pet: challengerPet,
                                    battleSeed: c.petBattleSeed,
                                    ...(doParty && chParty && myParty ? {
                                        opponentParty: chParty,
                                        challengerParty: myParty,
                                    } : {}),
                                });
                            }
                        }}>{c.petParty ? "✅ Accept & Fight (2v2)" : "✅ Accept & Fight"}</button>
                        <button className="danger-button" onClick={() => {
                            setDuelChallenges(duelChallenges.filter((x) => x.id !== c.id));
                            fetch('/api/player/challenge', {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetName: c.toName, fromName: c.fromName, challengeId: c.id }),
                            }).catch(() => {});
                            fetch('/api/player/challenge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetName: c.fromName, challenge: { ...c, declined: true, fromName: character.name, toName: c.fromName } }),
                            }).catch(() => {});
                        }}>Decline</button>
                    </div>
                </div>
            ))}

            {arenaView === "battle" && (
            <>
            {!isHollowGate && (
                <div className="pet-arena-hero" style={{ backgroundImage: `url(${DUEL_HERO_BY_ELEMENT[selectedPet?.element ?? ""] ?? petDuelHero})` }}>
                    <h3 className="hero-title">⚔️ Pet Arena</h3>
                    <p className="hero-sub">
                        Cinematic 1v1 &amp; 2v2 duels — pit your pet against other players and the AI.
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
                                                        <button onClick={() => sendDirectPetChallenge(p.name, selectedPet?.id)}>⚔️ Challenge</button>
                                                    </div>
                                                ))}
                                                {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "#4ade80" : "#f87171", marginTop: 6 }}>{petChallengeMsg}</p>}
                                            </>
                                        );
                                    }
                                    return (
                                        <>
                                            <p className="hint">No account found for "{opponentSearch.trim()}".</p>
                                            <button onClick={() => sendDirectPetChallenge(opponentSearch.trim(), selectedPet?.id)}>⚔️ Challenge "{opponentSearch.trim()}"</button>
                                            {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "#4ade80" : "#f87171", marginTop: 6 }}>{petChallengeMsg}</p>}
                                        </>
                                    );
                                })()}
                            </div>
                        ) : (
                            (() => {
                                const others = allServerPlayers
                                    .filter((p) => p.name.toLowerCase() !== character.name.toLowerCase())
                                    .sort((a, b) => Number(b.online) - Number(a.online) || (b.level ?? 0) - (a.level ?? 0))
                                    .slice(0, 8);
                                return (
                                    <div>
                                        <p className="hint" style={{ marginTop: 4 }}>Challenge an online shinobi below, or search a name above.</p>
                                        {others.length > 0 ? (
                                            <div className="pet-challenge-list">
                                                {others.map((p) => (
                                                    <div key={p.name} className="pet-challenge-row">
                                                        <span className={`pet-online-dot ${p.online ? "on" : "off"}`} />
                                                        <strong>{p.name}</strong>
                                                        <span className="hint">Lv {p.level} · {p.village || "—"}</span>
                                                        <button onClick={() => sendDirectPetChallenge(p.name, selectedPet?.id)}>⚔️ Challenge</button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="hint">No other shinobi found — search a name to send an offline challenge.</p>
                                        )}
                                        <div className="pet-arena-tips">
                                            <div>⚔️ Win pet duels to earn ryo (daily cap).</div>
                                            <div>🐾🐾 Toggle 2v2 below to bring two pets into the challenge.</div>
                                            <div>🛡 Roles &amp; element edge decide close fights — check the matchup hint.</div>
                                        </div>
                                        {petChallengeMsg && <p className="hint" style={{ color: petChallengeMsg.startsWith("✅") ? "#4ade80" : "#f87171", marginTop: 6 }}>{petChallengeMsg}</p>}
                                    </div>
                                );
                            })()
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

            <div className="menu">
                {opponentMode === "ai" && (
                    <button onClick={() => startBattle()} disabled={!selectedPet || !selectedOpponent}>
                        {partyMode && character.pets.length >= 2 ? "Start 2v2 Set" : "Start Battle"}
                    </button>
                )}
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
                        <div key={i} style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: 2 }}>
                            Match {i + 1}: {m.playerPet?.name ?? "—"} vs {m.opponentPet?.name ?? "—"} → <strong style={{ color: m.result === "win" ? "#4ade80" : m.result === "loss" ? "#f87171" : "#facc15" }}>{m.result}</strong>
                        </div>
                    ))}
                </div>
            )}

            {battleReady && selectedPet && (battleOpponent ?? selectedOpponent) && (
                <div ref={battlefieldRef} className="pet-arena-stage-wrap" style={{ scrollMarginTop: "12px" }}>
                {duelBattle ? (
                    // New continuous engine (petDuelEngine.v1 ON, non-ranked): the
                    // screen already resolved the DuelResult + posted the outcome;
                    // PetColiseumDuel just PLAYS it (full-screen portal). onExit
                    // clears the duel + honours the opponent's returnScreen (Hollow
                    // Gate sends you back to the shrine).
                    <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading tactical arena…</div>}>
                        <PetColiseumDuel
                            key={duelBattle.id}
                            playerPet={duelBattle.playerPet}
                            enemyPet={duelBattle.enemyPet}
                            playerReservePet={duelBattle.playerReservePet}
                            enemyReservePet={duelBattle.enemyReservePet}
                            seed={duelBattle.seed}
                            result={duelBattle.result}
                            sharedImages={sharedImages}
                            onFightAgain={() => startBattle(battleOpponent ?? undefined)}
                            onExit={() => {
                                const back = battleOpponent?.returnScreen ?? "centralHub";
                                setBattleOpponent(null);
                                setBattleReady(false);
                                setDuelBattle(null);
                                setScreen(back);
                            }}
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
                        obstacles: battleObstacles,
                        tiles: battleTiles,
                        onReplay: () => {
                            if (!battleFrames.length) return;
                            setFrameIndex(0);
                            setIsPlaying(true);
                        },
                        onFightAgain: () => startBattle(),
                        onExit: () => {
                            // Honour the opponent's returnScreen override if provided —
                            // Hollow Gate pet_battle tiles set this to "hollowGateShrine"
                            // so the duel sends you back to the dungeon, not the village hub.
                            const back = battleOpponent?.returnScreen ?? "centralHub";
                            setBattleOpponent(null);
                            setBattleReady(false);
                            setScreen(back);
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
                        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading 3D arena…</div>}>
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
                        <h3 className="hero-title">🏟️ Tactical Arena</h3>
                        <p className="hero-sub">
                            A full-screen team battle on a big map: your pets traverse the arena, capture the scroll, and clash with abilities. Roles are auto-assigned from each pet's role. Preview mode — no rewards yet.
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
                                    const img = pet.image || sharedImages[`pet:${pet.id}`] || "";
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
                                    {available.length < 1
                                        ? <p className="hint" style={{ color: "#f59e0b" }}>You have no pets available (all on expeditions?).</p>
                                        : <div className="pet-pick-panel">{pickGrid(respondPicks, setRespondPicks, size)}</div>}
                                    <div className="menu">
                                        <button disabled={respondPicks.length < 1} style={{ background: "#16a34a" }}
                                            onClick={() => void respondToArenaChallenge(pendingArenaResponse, respondPicks)}>
                                            Accept &amp; Start ({respondPicks.length}/{size})
                                        </button>
                                        <button className="danger-button" onClick={() => { setRespondPicks([]); onArenaResponseHandled?.(); }}>Decline</button>
                                    </div>
                                </div>
                            );
                        }

                        // ── Single screen: size toggle + team grid + actions ───
                        const canStart = tacticalPicks.length >= 1;
                        const sizeBtn = (n: 2 | 4, label: string) => (
                            <button type="button" className={tacticalSize === n ? "active" : ""}
                                onClick={() => { setTacticalSize(n); setTacticalPicks(pickArenaTeam(character.pets, n).map((p) => p.id)); }}>
                                {label}
                            </button>
                        );
                        return (
                            <div style={{ display: "grid", gap: "0.7rem" }}>
                                <div className="pet-arena-tactical-top">
                                    <div style={{ display: "grid", gap: "0.7rem", alignContent: "start" }}>
                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Team size</label>
                                            <div className="pet-arena-mode-toggle" style={{ maxWidth: 320, marginTop: 6 }}>
                                                {sizeBtn(2, "👥 2v2")}{sizeBtn(4, "👥👥 4v4")}
                                            </div>
                                        </div>

                                        <div>
                                            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Your team ({tacticalPicks.length}/{tacticalSize}) — tap to add / remove</label>
                                            <div style={{ marginTop: 6 }}>
                                                {available.length < 1
                                                    ? <p className="hint" style={{ color: "#f59e0b", margin: 0 }}>You have no pets available (all on expeditions?).</p>
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
                                                startArenaMatch(mine, ai, (Date.now() % 100000) || 1);
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
                                        {arenaChallengeMsg && <p className="hint" style={{ margin: 0, color: arenaChallengeMsg.startsWith("✅") ? "#4ade80" : "#f87171" }}>{arenaChallengeMsg}</p>}
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
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading arena…</div>}>
                    <PetArenaMatch blue={arenaMatch.blue} red={arenaMatch.red} seed={arenaMatch.seed} sharedImages={sharedImages} onExit={() => setArenaMatch(null)} />
                </Suspense>
            )}
            {showCoop && (
                <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading co-op…</div>}>
                    <ArenaCoopLobby character={character} sharedImages={sharedImages} onExit={() => setShowCoop(false)} />
                </Suspense>
            )}
            {arenaCountdown && (
                <div style={{ position: "fixed", inset: 0, zIndex: 215, background: "rgba(5,6,10,0.94)", display: "grid", placeItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ color: "#94a3b8", letterSpacing: "0.25em", fontSize: "0.85rem", marginBottom: 10 }}>BATTLE STARTS IN</div>
                        <div style={{ fontSize: "6rem", fontWeight: 800, color: "#fde68a", textShadow: "0 0 30px rgba(250,204,21,0.45)", lineHeight: 1 }}>{arenaCountdown.secs}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

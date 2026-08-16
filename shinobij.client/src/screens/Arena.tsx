/* Arena is the arena LOBBY: casual-spar and challenge inboxes, the ranked queue,
 * tournaments, the spectator board, and the pet-ladder entries. It hosts no
 * fight. The browser-side PvE reducer this file used to carry was retired when
 * solo PvE moved server-side — every launch now routes to a server-driven host
 * (AiFightHost, MissionArenaFight, BattleTowerFight, PvpBattleScreen). */
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/immutability, react-hooks/purity -- SCOPED DEBT.
 * What the react-compiler rules still flag here, and why each is structural
 * rather than a bug:
 *
 *   immutability (1) — the ranked-queue polling effect calls `challengePlayer`,
 *     a hoisted function declaration defined below it. Correct at runtime (the
 *     effect body runs after render), but the compiler wants
 *     declaration-before-use before it can reason about memoization.
 *   purity (5) — Date.now() / Math.random() inside challengePlayer and
 *     startTournament, stamping ids and timestamps onto an outgoing challenge
 *     or tournament record. Event-handler output, never render output.
 *   exhaustive-deps (3) / set-state-in-effect (1) — the polling and
 *     stale-flag-clearing effects deliberately key off a narrow dep list and
 *     write parent state on entry.
 *
 * Fix these by restructuring; do not add more suppressions. */
import { useState, useEffect } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import {
    GiCrossedSwords, GiTrophy, GiLadder, GiEyeball, GiBoxingGlove, GiPawPrint,
    GiColiseum, GiRollingDices, GiTwoCoins,
} from "react-icons/gi";
// Inline style for a glyph that prefixes button/heading text — seats it on the baseline.
const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import type { Biome, Screen, WeatherType } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { EnhancedClanData } from "../types/clan";
import type { Pet } from "../types/pet";
import { MAX_LEVEL } from "../constants/game";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { BountyBoardPanel } from "../components/BountyBoardPanel";
import coliseumLadderImg from "../assets/coliseum/coliseum-bg.webp";
import tacticalLadderImg from "../assets/ladder/tactical-hero.webp";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";
import { weatherEffects } from "../data/world";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { normalizeJutsu } from "../lib/jutsu";
import { getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus, getPvpItemLoadout } from "../lib/equipment-stats";
import { getAllItems } from "../lib/items";
import { makeId } from "../lib/utils";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { requestAiFight } from "../lib/ai-fight-request";
import { publishedPracticeOpponentForLevel } from "../lib/creator-event-practice";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    availablePetBattleCount,
    isPetOnExpedition,
    } from "../lib/pet";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "../lib/pvp-session";
import {
    playerRankedAuthorityFromChallenge,
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../lib/player-ranked-authority";
import { postPlayerChallengeNotice } from "../lib/player-api";
import { enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import { activeCarriedPets } from "../lib/entitlements";
import { publicEligiblePets } from "../lib/public-pet-roster";
import {
    getPvpJutsuLoadout,
    isAdminAccountName,
    normalizeCharacter,
    type DuelChallenge,
    type PvpSessionState,
    type SharedPvpBattleContext,
} from "../App";
import { loadArenaActiveFights, loadArenaTournament, saveArenaTournament, savePendingClanPetBattle, type ArenaSpectatorFight, type ArenaTournament } from "../lib/world-state";

export function Arena({
    lobbyMode = "battleArena",
    character,
    updateCharacter,
    onServerVersion,
    savedBloodlines,
    creatorJutsus,
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
    setPvpBattleId,
    setPvpRole,
    setPvpBattleContext,
    setPvpSeedSession,
    setPendingPetBattleOpponent,
    onAcceptPetChallenge,
    onBattleActiveChange,
}: {
    lobbyMode?: "battleArena" | "arenaDistrict";
    character: Character;
    updateCharacter: (character: Character) => void;
    /** Adopt a server version observed without a character payload (see below). */
    onServerVersion?: (version?: number) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
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
    // can block travelling out of an arena fight. This screen no longer hosts a
    // fight at all, so it reports false once on mount and never holds the lock.
    onBattleActiveChange?: (active: boolean) => void;
}) {
    const combatEligiblePets = activeCarriedPets<Pet>(character);

    const [aiLevel, setAiLevel] = useState(character.level);
    const [sparSearch, setSparSearch] = useState("");
    const [activeArenaTab, setActiveArenaTab] = useState<"clanWar" | "tournaments" | "ranked" | "spectate" | "petBattles">("ranked");
    // Battle Arena hub (village casual-spar hub) sub-tabs: sparring/challenges vs the bounty board.
    const [battleArenaTab, setBattleArenaTab] = useState<"spar" | "bounty">("spar");
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);
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

    const playerSearchMatches = (player: PlayerRecord, search: string) =>
        player.name !== character.name && player.name.toLowerCase().includes(search.trim().toLowerCase());
    const incomingChallenges = duelChallenges.filter((challenge) => !challenge.accepted && !challenge.declined && challenge.toName.toLowerCase() === character.name.toLowerCase());

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
        if (lobbyMode === "arenaDistrict") {
            if (pendingAiProfileId) setPendingAiProfileId("");
            if (pendingPvpOpponent) setPendingPvpOpponent(null);
            if (raidBattleKind !== "none") setRaidBattleKind("none");
        }
    }, [lobbyMode, pendingAiProfileId, pendingPvpOpponent?.name, raidBattleKind]);

    useEffect(() => {
        // Retire pre-cutover browser snapshots. Every current AI launch enters
        // AiFightHost; a catalog id alone can never arm the local reducer.
        if (pendingAiProfileId) setPendingAiProfileId("");
    }, [pendingAiProfileId]);

    // The browser-side arena reducer is retired: no launch path arms a local
    // fight here any more (AI/story/mission/tower fights all run on their
    // server-driven hosts). Report "no arena fight in progress" once on mount so
    // App's global navigation lock can never be held by this screen.
    useEffect(() => {
        onBattleActiveChange?.(false);
    }, [onBattleActiveChange]);

    // Rolling-upgrade cleanup. A pre-cutover mid-battle snapshot can only be
    // stale now that nothing replays it, so drop it instead of leaving it in
    // localStorage forever. (App clears the matching battle lock on boot.)
    useEffect(() => {
        try { localStorage.removeItem(`arena.battle.v3.${character.name}`); } catch { /* ignore */ }
    }, [character.name]);

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
            // Create a shared turn-based hex-grid PvP session: challenger = p1, us = p2
            const [p1CombatSave, p2CombatSave] = await Promise.all([
                fetchPlayerCombatSave(challenge.fromName),
                fetchPlayerCombatSave(character.name),
            ]);
            // p2 is US: our own read settles elapsed state and can bump the stored
            // version, so adopt it or our next autosave 409s on a stale base.
            onServerVersion?.(p2CombatSave?._saveVersion);
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
        const incomingPetSpars = incomingChallenges.filter((c) => c.mode === "clanWarPet" && !c.clanWarPoints);
        // Pet-battle modes gate on how many pets you can actually field (not on
        // expedition): 1v1 needs 1 (everyone starts with a pet), 2v2 needs 2.
        return (
            <div className="card arena-lobby">
                <BackToVillageButton onClick={() => setScreen("village")} />
                <h2><GiCrossedSwords style={ARENA_ICON} />Battle Arena</h2>
                <p>Your hub for casual sparring — combat, pets, and cards — plus the bounty board.</p>

                <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                    <button className={battleArenaTab === "spar" ? "active" : ""} onClick={() => setBattleArenaTab("spar")}><GiBoxingGlove style={ARENA_ICON} />Spar &amp; Challenges</button>
                    <button className={battleArenaTab === "bounty" ? "active" : ""} onClick={() => setBattleArenaTab("bounty")}><GiTwoCoins style={ARENA_ICON} />Bounty Board</button>
                </div>

                {battleArenaTab === "spar" && (
                    <>
                        {/* ── Combat Spar: vs AI ─────────────────────────────── */}
                        <section className="summary-box">
                            <h3><GiCrossedSwords style={ARENA_ICON} />Combat Spar — Fight AI</h3>
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

                        {/* ── Challenge a player: combat spar OR 1v1 pet battle ── */}
                        <section className="summary-box">
                            <h3><GiBoxingGlove style={ARENA_ICON} />Challenge a Player</h3>
                            <p className="hint">Search a player, then send a casual combat spar or a 1v1 pet battle. They get a pop-up to Accept or Decline.</p>
                            <label>Search Player Name</label>
                            <input value={sparSearch} onChange={(e) => setSparSearch(e.target.value)} placeholder="Type a player name to challenge..." />
                            {sparSearch.trim() && (
                                <div className="jutsu-list">
                                    {sparOpponents.length === 0 ? (
                                        <>
                                            <p className="hint">No roster match. Send a spar challenge directly.</p>
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
                                                <button onClick={() => challengePlayer(player)}><GiBoxingGlove aria-hidden="true" /> Spar Challenge</button>
                                                <button
                                                    disabled={availablePetCount < 1}
                                                    title={availablePetCount < 1 ? "You need one available pet" : undefined}
                                                    onClick={() => challengePlayer(player, "clanWarPet", 0)}
                                                ><GiPawPrint aria-hidden="true" /> Pet Battle (1v1)</button>
                                                <button
                                                    disabled={availablePetCount < 2}
                                                    title={availablePetCount < 2 ? "Raise a second pet (not on an expedition) to unlock 2v2" : undefined}
                                                    onClick={() => challengePlayer(player, "clanWarPet", 0, true)}
                                                ><GiPawPrint aria-hidden="true" /> Pet Battle (2v2)</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="summary-box">
                            <h3>Incoming Spar Requests</h3>
                            {incomingSpars.length === 0 ? <p className="hint">No incoming spar requests.</p> : incomingSpars.map((challenge) => (
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

                        {/* ── Pet Spar ───────────────────────────────────────── */}
                        <section className="summary-box">
                            <h3><GiPawPrint style={ARENA_ICON} />Pet Spar</h3>
                            <p className="hint">Head to the Casual Pet Coliseum for a friendly pet duel against AI or a challenged player — no ladder rating on the line.</p>
                            <button
                                disabled={availablePetCount < 1}
                                title={availablePetCount < 1 ? "You need one pet that is not on an expedition" : undefined}
                                onClick={() => setScreen("petArena")}
                            ><GiColiseum style={ARENA_ICON} />Open Casual Pet Coliseum</button>
                            {availablePetCount < 1 && <p className="hint" style={{ color: "var(--gold-2)" }}>Locked: you need one available pet. Pets currently on expeditions cannot battle.</p>}
                            {incomingPetSpars.map((challenge) => (
                                <div className="summary-box" key={challenge.id}>
                                    <strong>{challenge.fromName}</strong> wants a pet battle!
                                    <div className="menu">
                                        <button onClick={() => onAcceptPetChallenge?.(challenge)}><GiColiseum style={ARENA_ICON} />Accept Pet Battle</button>
                                        <button className="danger-button" onClick={() => declineChallenge(challenge)}>Decline</button>
                                    </div>
                                </div>
                            ))}
                        </section>

                        {/* ── Card Battle Spar ───────────────────────────────── */}
                        <section className="summary-box">
                            <h3><GiRollingDices style={ARENA_ICON} />Card Battle Spar</h3>
                            <p className="hint">Play Shinobi Chronicle Showdown against the AI or a live free-play opponent at the Card Hall.</p>
                            <button onClick={() => setScreen("shinobiTiles")}><GiRollingDices style={ARENA_ICON} />Open Card Hall</button>
                        </section>
                    </>
                )}

                {battleArenaTab === "bounty" && (
                    <BountyBoardPanel character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} />
                )}
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
                <button
                    className={activeArenaTab === "petBattles" ? "active" : ""}
                    disabled={!combatEligiblePets.some((pet) => !isPetOnExpedition(pet))}
                    title={!combatEligiblePets.some((pet) => !isPetOnExpedition(pet)) ? "You need one available carried pet" : undefined}
                    onClick={() => setActiveArenaTab("petBattles")}
                ><GiPawPrint style={ARENA_ICON} />Ranked Pet Battles</button>
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
                                            const responderPet = combatEligiblePets.find(pet => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? combatEligiblePets.find(pet => !isPetOnExpedition(pet));
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
                                            // The challenge id is the duel's identity: the server
                                            // seals ONE fight against it on accept, and both
                                            // participants read that same fight back. Without it
                                            // the Coliseum has nothing to load.
                                            setPendingPetBattleOpponent?.({ owner: challenge.fromName, pet: challengerPet, battleSeed: challenge.petBattleSeed, pvpChallengeId: challenge.id });
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
                            <button disabled={!playerRankedEnabled} onClick={joinRankedQueue}>
                                {playerRankedEnabled ? "Queue Up for Ranked" : "Ranked Rollout Pending"}
                            </button>
                        )}
                    </div>
                    {!playerRankedEnabled && <p className="hint">Ranked matchmaking is temporarily paused during the v2 authority rollout.</p>}
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

            {activeArenaTab === "petBattles" && (
                <section className="summary-box">
                    <h3><GiPawPrint style={ARENA_ICON} />Ranked Pet Battles</h3>
                    <p className="hint">Compete on the global pet ranked ladders — climb by beating the rival ranked above you. Casual pet sparring lives in the Village Battle Arena.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, margin: "12px 0" }}>
                        {[
                            { mode: "coliseum" as const, requirement: 1, img: coliseumLadderImg, emoji: <GiColiseum size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Coliseum", sub: "1v1 ranked ladder" },
                            { mode: "tactical" as const, requirement: TACTICAL_ARENA_PET_REQUIREMENT, img: tacticalLadderImg, emoji: <GiCrossedSwords size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Tactical", sub: "4v4 ranked ladder" },
                        ].map((c) => {
                            const locked = availablePetCount < c.requirement;
                            return (
                                <button key={c.mode} type="button"
                                    disabled={locked}
                                    title={locked ? `Locked: ${availablePetCount}/${c.requirement} available pets` : undefined}
                                    onClick={() => { sessionStorage.setItem("petLadder.mode", c.mode); setScreen("petLadder"); }}
                                    style={{ position: "relative", padding: 0, border: "1px solid rgba(244,196,81,.3)", borderRadius: 14, overflow: "hidden", cursor: locked ? "not-allowed" : "pointer", textAlign: "left", height: 132, background: "#11141f" }}>
                                    <img src={c.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: locked ? .32 : .85, filter: locked ? "grayscale(.75)" : undefined }} />
                                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,10,18,.05), rgba(8,10,18,.85))" }} />
                                    <div style={{ position: "absolute", left: 14, right: 14, bottom: 12 }}>
                                        <div style={{ fontSize: 19, fontWeight: 800, color: "#f7d98a", textShadow: "0 2px 8px #000" }}>{c.emoji} {c.title}</div>
                                        <div style={{ fontSize: 12.5, color: "rgba(231,237,247,.9)", textShadow: "0 1px 5px #000" }}>
                                            {locked ? `Locked · ${availablePetCount}/${c.requirement} available pets` : `${c.sub} · climb the global rankings`}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}

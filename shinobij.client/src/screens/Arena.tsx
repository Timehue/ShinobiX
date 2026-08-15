/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/purity */
import { useEffect, useState } from "react";
import type { Screen } from "../types/core";
import type { Character, PlayerRecord } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import type { EnhancedClanData } from "../types/clan";
import type { Pet } from "../types/pet";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";
import { BattleArenaLobby } from "../features/arena/components/BattleArenaLobby";
import { ArenaDistrictLobby } from "../features/arena/components/ArenaDistrictLobby";
import type { ArenaDistrictTab, BattleArenaLobbyTab } from "../features/arena/types";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import { activeCarriedPets } from "../lib/entitlements";
import { availablePetBattleCount, isPetOnExpedition } from "../lib/pet";
import { publicEligiblePets } from "../lib/public-pet-roster";
import {
    playerRankedAuthorityFromQueueMatch,
    type PlayerRankedAuthority,
} from "../lib/player-ranked-authority";
import { publishedPracticeOpponentForLevel } from "../lib/creator-event-practice";
import { requestAiFight } from "../lib/ai-fight-request";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { makeId } from "../lib/utils";
import {
    loadArenaActiveFights,
    loadArenaTournament,
    saveArenaTournament,
    savePendingClanPetBattle,
    type ArenaSpectatorFight,
    type ArenaTournament,
} from "../lib/world-state";
import {
    getPvpJutsuLoadout,
    isAdminAccountName,
    type DuelChallenge,
} from "../App";

type ArenaProps = {
    lobbyMode?: "battleArena" | "arenaDistrict";
    character: Character;
    updateCharacter: (character: Character) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    playerRoster: PlayerRecord[];
    duelChallenges: DuelChallenge[];
    setDuelChallenges: (challenges: DuelChallenge[]) => void;
    setScreen: (screen: Screen) => void;
    setPvpBattleId?: (id: string) => void;
    setPvpRole?: (role: "p1" | "p2") => void;
    setPendingPetBattleOpponent?: (opponent: PetArenaOpponent | null) => void;
    onAcceptChallenge: (challenge: DuelChallenge) => void;
    onDeclineChallenge: (challenge: DuelChallenge) => void;
    onAcceptPetChallenge?: (challenge: DuelChallenge) => void;
};

/**
 * Battle Arena and Arena District are lobby surfaces only.
 *
 * Solo combat is admitted by requestAiFight and rendered by AiFightHost's
 * server-owned MissionArenaFight. Player combat is admitted by App's canonical
 * challenge handler and rendered by PvpBattleScreen. This component must never
 * grow a local HP/AP/turn reducer or restore a retired browser battle snapshot.
 */
export function Arena({
    lobbyMode = "battleArena",
    character,
    updateCharacter,
    savedBloodlines,
    creatorJutsus,
    playerRoster,
    duelChallenges,
    setDuelChallenges,
    setScreen,
    setPvpBattleId,
    setPvpRole,
    setPendingPetBattleOpponent,
    onAcceptChallenge,
    onDeclineChallenge,
    onAcceptPetChallenge,
}: ArenaProps) {
    const [aiLevel, setAiLevel] = useState(character.level);
    const [sparSearch, setSparSearch] = useState("");
    const [activeArenaTab, setActiveArenaTab] = useState<ArenaDistrictTab>("ranked");
    const [battleArenaTab, setBattleArenaTab] = useState<BattleArenaLobbyTab>("spar");
    const [playerRankedEnabled, setPlayerRankedEnabled] = useState(false);
    const [rankedQueueActive, setRankedQueueActive] = useState(false);
    const [rankedQueueSize, setRankedQueueSize] = useState(0);
    const [arenaTournament, setArenaTournament] = useState<ArenaTournament | null>(() => loadArenaTournament());
    const [spectatorFights, setSpectatorFights] = useState<ArenaSpectatorFight[]>(() => loadArenaActiveFights());
    const [opponentClanData, setOpponentClanData] = useState<EnhancedClanData | null>(null);

    const combatEligiblePets = activeCarriedPets<Pet>(character);
    const incomingChallenges = duelChallenges.filter((challenge) =>
        !challenge.accepted &&
        !challenge.declined &&
        challenge.toName.toLowerCase() === character.name.toLowerCase()
    );

    useEffect(() => {
        const refreshArenaState = () => {
            setArenaTournament(loadArenaTournament());
            setSpectatorFights(loadArenaActiveFights());
        };
        refreshArenaState();
        const id = window.setInterval(refreshArenaState, 5000);
        return () => window.clearInterval(id);
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

    useEffect(() => {
        if (!rankedQueueActive) return;
        let active = true;
        const poll = () => {
            if (document.visibilityState === "hidden") return;
            fetch("/api/pvp/ranked-queue", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: character.name,
                    level: character.level,
                    elo: character.rankedRating ?? 1000,
                    action: "poll",
                }),
            })
                .then((response) => response.json())
                .then((data) => {
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
                        setRankedQueueActive(false);
                        if (data.match.initiator !== false) {
                            const opponentName = data.match.opponent;
                            const stub = {
                                name: opponentName,
                                level: data.match.opponentLevel ?? 1,
                                village: "",
                                specialty: "Ninjutsu",
                                character: {
                                    ...character,
                                    name: opponentName,
                                    rankedRating: data.match.opponentElo ?? 1000,
                                } as Character,
                                currentSector: 0,
                                lastSeenAt: Date.now(),
                            } as PlayerRecord;
                            void challengePlayer(stub, "ranked", 0, false, rankedAuthority);
                        }
                    }
                    if (!data.inQueue) setRankedQueueActive(false);
                })
                .catch(() => {});
        };
        poll();
        const id = window.setInterval(poll, 3000);
        return () => {
            active = false;
            window.clearInterval(id);
        };
    }, [rankedQueueActive]);

    useEffect(() => {
        let active = true;
        if (!character.clan) {
            setOpponentClanData(null);
            return () => { active = false; };
        }
        fetchClanData(character.clan)
            .then(async (data) => {
                const activeWar = data ? enhanceClanData(data).activeWar : undefined;
                if (!activeWar?.opponentClan) return null;
                return fetchClanData(activeWar.opponentClan);
            })
            .then((data) => {
                if (active) setOpponentClanData(data ? enhanceClanData(data) : null);
            })
            .catch(() => {
                if (active) setOpponentClanData(null);
            });
        return () => { active = false; };
    }, [character.clan]);

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
            body: JSON.stringify({
                name: character.name,
                level: character.level,
                elo: character.rankedRating ?? 1000,
                action: "join",
            }),
        })
            .then(async (response) => {
                const data = await response.json().catch(() => ({} as Record<string, unknown>));
                if (!response.ok) {
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

    function beginAiBattle() {
        if (!requestAiFight({
            opponentId: publishedPracticeOpponentForLevel(aiLevel),
            opponentLevel: aiLevel,
            battleKind: "practice",
            returnScreen: "arena",
        })) {
            alert("The sealed practice arena is unavailable. No fight was started.");
        }
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
        const knownPetTarget = isPetMode
            ? playerRoster.find((player) => player.name.toLowerCase() === opponent.name.toLowerCase())
            : undefined;
        if (knownPetTarget && availablePetBattleCount(publicEligiblePets(knownPetTarget)) < (party ? 2 : 1)) {
            alert(`${opponent.name} does not have a pet available for battle.`);
            return;
        }

        const challengePet = isPetMode
            ? combatEligiblePets.find((pet) => pet.id === character.activePetId && !isPetOnExpedition(pet))
                ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet))
            : undefined;
        const petBattleSeed = isPetMode ? Date.now() + Math.floor(Math.random() * 100000) : undefined;
        const partyPetIds: [string, string] | null = party && challengePet
            ? (() => {
                const reserve = combatEligiblePets
                    .filter((pet) => !isPetOnExpedition(pet) && pet.id !== challengePet.id)
                    .sort((left, right) => (right.level ?? 0) - (left.level ?? 0))[0];
                return reserve ? [challengePet.id, reserve.id] : null;
            })()
            : null;
        let petRankedToken: string | undefined;
        if (mode === "rankedPet") {
            try {
                const response = await fetch("/api/pet/ranked-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ opponentName: opponent.name, petId: challengePet?.id, seed: petBattleSeed }),
                });
                if (response.ok) {
                    petRankedToken = ((await response.json()) as { matchToken?: string }).matchToken;
                }
            } catch { /* The existing local rating estimate remains the display fallback. */ }
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
            challengerPetRating: mode === "rankedPet" ? (character.petRankedRating ?? 1000) : undefined,
            petRankedToken,
            createdAt: Date.now(),
            mode,
            ...(mode === "ranked" ? rankedAuthority : {}),
            clanWarPoints,
            ...(partyPetIds ? { petParty: true, challengerPetIds: partyPetIds } : {}),
        };
        try {
            const response = await fetch("/api/player/challenge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetName: opponent.name, challenge }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({} as { error?: string }));
                alert(data?.error ?? `${opponent.name} is not reachable live right now. Challenge was not sent.`);
                return;
            }
            setDuelChallenges([
                ...duelChallenges.filter((candidate) => !(
                    candidate.fromName === character.name &&
                    !candidate.accepted &&
                    !candidate.declined &&
                    !candidate.battleId
                )),
                challenge,
            ]);
            alert(`${mode === "ranked" ? "Ranked challenge" : mode === "rankedPet" ? "Ranked pet challenge" : mode === "clanWarPet" ? (partyPetIds ? "2v2 pet challenge" : "Pet challenge") : "Challenge"} sent to ${opponent.name}.`);
        } catch {
            alert(`${opponent.name} is not reachable live right now. Challenge was not sent.`);
        }
    }

    function startTournament() {
        const participants = [character.name, ...playerRoster.map((player) => player.name)]
            .filter((name, index, names) => names.indexOf(name) === index);
        const tournament: ArenaTournament = {
            id: `tourney-${Date.now()}`,
            name: "Weekly Arena Tournament",
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
        const next = {
            ...arenaTournament,
            advancedPlayers: [...arenaTournament.advancedPlayers, playerName]
                .filter((name, index, names) => names.indexOf(name) === index),
        };
        saveArenaTournament(next);
        setArenaTournament(next);
    }

    function clearTournament() {
        saveArenaTournament(null);
        setArenaTournament(null);
    }

    const availablePetCount = availablePetBattleCount(combatEligiblePets);
    const sparOpponents = sparSearch.trim()
        ? playerRoster.filter((player) =>
            player.name !== character.name &&
            player.name.toLowerCase().includes(sparSearch.trim().toLowerCase())
        )
        : [];

    if (lobbyMode === "battleArena") {
        const incomingSpars = incomingChallenges.filter((challenge) =>
            !challenge.clanWarPoints &&
            challenge.mode !== "ranked" &&
            challenge.mode !== "clanWarPet" &&
            !challenge.sectorAttack
        );
        const incomingPetSpars = incomingChallenges.filter((challenge) =>
            challenge.mode === "clanWarPet" && !challenge.clanWarPoints
        );
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
                    const stub = {
                        name,
                        level: 1,
                        village: "",
                        specialty: "Ninjutsu",
                        character: { ...character, name } as Character,
                        currentSector: 0,
                        lastSeenAt: Date.now(),
                    } as PlayerRecord;
                    void challengePlayer(stub);
                }}
                onChallengePlayer={(...args) => { void challengePlayer(...args); }}
                onAcceptChallenge={onAcceptChallenge}
                onDeclineChallenge={onDeclineChallenge}
                onAcceptPetChallenge={onAcceptPetChallenge}
                onOpenPetArena={() => setScreen("petArena")}
                onOpenCardHall={() => setScreen("shinobiTiles")}
            />
        );
    }

    const clanWarOpponents = opponentClanData
        ? opponentClanData.members
            .map((member) => playerRoster.find((player) => player.name === member.name))
            .filter((player): player is PlayerRecord => Boolean(player))
        : [];
    const incomingClanWarChallenges = incomingChallenges.filter((challenge) => Boolean(challenge.clanWarPoints));
    const activeSpectatorFights = spectatorFights.filter((fight) => fight.battleId);
    const pendingSpectatorChallenges = duelChallenges.filter((challenge) =>
        !challenge.accepted &&
        !challenge.declined &&
        (Boolean(challenge.clanWarPoints) || challenge.mode === "ranked")
    );
    const tournamentRemaining = arenaTournament ? Math.max(0, arenaTournament.endsAt - Date.now()) : 0;
    const matchRemaining = arenaTournament ? Math.max(0, arenaTournament.matchDeadline - Date.now()) : 0;

    const acceptDistrictChallenge = (challenge: DuelChallenge) => {
        if (challenge.mode !== "clanWarPet") {
            onAcceptChallenge(challenge);
            return;
        }
        const challengerPet = challenge.challenger.pets.find((pet) =>
            pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)
        ) ?? challenge.challenger.pets.find((pet) => !isPetOnExpedition(pet));
        const responderPet = combatEligiblePets.find((pet) =>
            pet.id === character.activePetId && !isPetOnExpedition(pet)
        ) ?? combatEligiblePets.find((pet) => !isPetOnExpedition(pet));
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
        fetch("/api/player/challenge", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                targetName: challenge.toName,
                fromName: challenge.fromName,
                challengeId: challenge.id,
            }),
        }).catch(() => {});
        fetch("/api/player/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                targetName: challenge.fromName,
                challenge: {
                    ...challenge,
                    accepted: true,
                    fromName: character.name,
                    toName: challenge.fromName,
                    responderPetId: responderPet.id,
                    responderPet,
                },
            }),
        }).catch(() => {});
        setPendingPetBattleOpponent?.({
            owner: challenge.fromName,
            pet: challengerPet,
            battleSeed: challenge.petBattleSeed,
        });
        setScreen("petArena");
    };

    const spectateFight = (fight: ArenaSpectatorFight) => {
        if (!fight.battleId || !setPvpBattleId || !setPvpRole) {
            alert(`Spectating ${fight.title}. Live replay streams will use this fight feed.`);
            return;
        }
        fetch(`/api/pvp/spectate?id=${encodeURIComponent(fight.battleId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: character.name, action: "join" }),
        }).catch(() => {});
        setPvpBattleId(fight.battleId);
        setPvpRole("p1");
        setScreen("pvpBattle");
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
            isAdminTournamentManager={isAdminAccountName(character.name)}
            playerRankedEnabled={playerRankedEnabled}
            rankedQueueActive={rankedQueueActive}
            rankedQueueSize={rankedQueueSize}
            spectatorFights={activeSpectatorFights}
            pendingSpectatorChallenges={pendingSpectatorChallenges}
            onBack={() => setScreen("centralHub")}
            onTabChange={setActiveArenaTab}
            onChallengePlayer={(...args) => { void challengePlayer(...args); }}
            onAcceptDistrictChallenge={acceptDistrictChallenge}
            onDeclineChallenge={onDeclineChallenge}
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

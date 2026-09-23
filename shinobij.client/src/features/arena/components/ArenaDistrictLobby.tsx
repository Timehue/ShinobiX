import { GiCrossedSwords, GiLadder, GiPawPrint, GiTrophy, GiEyeball } from "../../../components/icons/LightweightGameIcons";
import type { DuelChallenge } from "../../../App";
import type { Character, PlayerRecord, VersionedCharacterCommit } from "../../../types/character";
import type { EnhancedClanData } from "../../../types/clan";
import type { ArenaSpectatorFight, ArenaTournament } from "../../../lib/world-state";
import type { ArenaDistrictTab } from "../types";
import { Ranked2v2Panel } from "../../../components/Ranked2v2Panel";
import { RankedFormatWeaponPicker } from "../../../components/RankedFormatWeaponPicker";
import { CentralDestinationHeader } from "../../../components/CentralDestinationHeader";
import { ArenaTournamentPanel } from "./ArenaTournamentPanel";
import { PetRankedModeCards } from "./PetRankedModeCards";

const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;

type ArenaDistrictLobbyProps = {
    character: Character; onVersionedCharacter: VersionedCharacterCommit;
    activeTab: ArenaDistrictTab;
    hasAvailablePet: boolean;
    availablePetCount: number;
    opponentClanData: EnhancedClanData | null;
    clanWarOpponents: PlayerRecord[];
    incomingClanWarChallenges: DuelChallenge[];
    arenaTournament: ArenaTournament | null;
    dojoCircuitEnabled?: boolean;
    tournamentRemaining: number;
    matchRemaining: number;
    isAdminTournamentManager: boolean;
    playerRankedEnabled: boolean;
    rankedQueueActive: boolean;
    rankedQueueSize: number;
    spectatorFights: ArenaSpectatorFight[];
    pendingSpectatorChallenges: DuelChallenge[];
    onBack: () => void;
    onTabChange: (tab: ArenaDistrictTab) => void;
    onChallengePlayer: (player: PlayerRecord, mode?: DuelChallenge["mode"], clanWarPoints?: number) => void;
    onAcceptDistrictChallenge: (challenge: DuelChallenge) => void;
    onDeclineChallenge: (challenge: DuelChallenge) => void;
    onAdvanceTournamentPlayer: (name: string) => void;
    onDeclareTournamentWinner: (name: string) => void;
    tournamentWinnerBusy: boolean;
    onClearTournament: () => void;
    onStartTournament: () => void;
    onJoinRankedQueue: () => void;
    onLeaveRankedQueue: () => void;
    onRefreshFights: () => void;
    onSpectateFight: (fight: ArenaSpectatorFight) => void;
    onViewPendingChallenge: () => void;
    onOpenPetLadder: (mode: "coliseum" | "tactical") => void;
    sharedImages?: Record<string, string>;
};

export function ArenaDistrictLobby({
    character, onVersionedCharacter,
    sharedImages,
    activeTab,
    hasAvailablePet,
    availablePetCount,
    opponentClanData,
    clanWarOpponents,
    incomingClanWarChallenges,
    arenaTournament,
    dojoCircuitEnabled = true,
    tournamentRemaining,
    matchRemaining,
    isAdminTournamentManager,
    playerRankedEnabled,
    rankedQueueActive,
    rankedQueueSize,
    spectatorFights,
    pendingSpectatorChallenges,
    onBack,
    onTabChange,
    onChallengePlayer,
    onAcceptDistrictChallenge,
    onDeclineChallenge,
    onAdvanceTournamentPlayer,
    onDeclareTournamentWinner,
    tournamentWinnerBusy,
    onClearTournament,
    onStartTournament,
    onJoinRankedQueue,
    onLeaveRankedQueue,
    onRefreshFights,
    onSpectateFight,
    onViewPendingChallenge,
    onOpenPetLadder,
}: ArenaDistrictLobbyProps) {
    return (
        <div className="card arena-lobby" data-central-district="true">
            <CentralDestinationHeader
                backLabel="Central"
                eyebrow="The Thousand Gates · Competitive Command"
                icon={<GiCrossedSwords />}
                onBack={onBack}
                statusLabel="District access"
                statusValue="Open"
                subtitle="Ranked combat, clan-war challenges, live tournaments, spectator boards, and companion competition."
                title="Arena District"
                tone="crimson"
            />

            <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                <button className={activeTab === "clanWar" ? "active" : ""} onClick={() => onTabChange("clanWar")}><GiCrossedSwords style={ARENA_ICON} />Clan War</button>
                {dojoCircuitEnabled && <button className={activeTab === "tournaments" ? "active" : ""} onClick={() => onTabChange("tournaments")}><GiTrophy style={ARENA_ICON} />Dojo Circuit</button>}
                <button className={activeTab === "ranked" ? "active" : ""} onClick={() => onTabChange("ranked")}><GiLadder style={ARENA_ICON} />Ranked</button>
                <button className={activeTab === "spectate" ? "active" : ""} onClick={() => onTabChange("spectate")}><GiEyeball style={ARENA_ICON} />Spectate</button>
                <button
                    className={activeTab === "petBattles" ? "active" : ""}
                    disabled={!hasAvailablePet}
                    title={!hasAvailablePet ? "You need one available carried pet" : undefined}
                    onClick={() => onTabChange("petBattles")}
                ><GiPawPrint style={ARENA_ICON} />Ranked Pet Battles</button>
            </div>

            {activeTab === "clanWar" && (
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
                                                <button onClick={() => onChallengePlayer(player, "clanWar1v1", 50)}>1v1 +50</button>
                                                <button onClick={() => onChallengePlayer(player, "clanWar2v2", 100)}>2v2 +100</button>
                                                <button onClick={() => onChallengePlayer(player, "clanWarPet", 25)}>Pet Battle +25</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </section>

                    <section className="summary-box">
                        <h3>Incoming Clan War Challenges</h3>
                        {incomingClanWarChallenges.length === 0 ? <p className="hint">No incoming clan war challenges.</p> : incomingClanWarChallenges.map((challenge) => (
                            <div className="summary-box" key={challenge.id}>
                                <strong>{challenge.fromName}</strong>
                                <p>{challenge.mode ?? "standard"} challenge to {challenge.toName} | {challenge.clanWarPoints} clan points</p>
                                <div className="menu">
                                    <button onClick={() => onAcceptDistrictChallenge(challenge)}>{challenge.mode === "clanWarPet" ? "Open Pet Colosseum" : "Accept Duel"}</button>
                                    <button className="danger-button" onClick={() => onDeclineChallenge(challenge)}>Decline</button>
                                </div>
                            </div>
                        ))}
                    </section>
                </>
            )}

            {dojoCircuitEnabled && activeTab === "tournaments" && (
                <ArenaTournamentPanel
                    tournament={arenaTournament}
                    tournamentRemaining={tournamentRemaining}
                    matchRemaining={matchRemaining}
                    isAdminTournamentManager={isAdminTournamentManager}
                    tournamentWinnerBusy={tournamentWinnerBusy}
                    onAdvancePlayer={onAdvanceTournamentPlayer}
                    onDeclareWinner={onDeclareTournamentWinner}
                    onClear={onClearTournament}
                    onStart={onStartTournament}
                />
            )}
            {activeTab === "ranked" && <Ranked2v2Panel key={character.name} character={character} sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter} />}

            {activeTab === "ranked" && (
                <section className="summary-box">
                    <h3>Ranked Battles (Solo 1v1)</h3>
                    <p>Rating: <strong>{character.rankedRating ?? 1000}</strong> Elo | Wins {character.rankedWins ?? 0} | Losses {character.rankedLosses ?? 0}</p>
                    <p className="hint">Ranked fights use neutral ground and the Ranked Format: maxed stats and equipped jutsu, maximum HP/chakra/stamina, and identical neutral legendary gear. Your weapon and bloodline/jutsu loadout are yours. Opponents can be any eligible level; the queue prefers the closest rating. Your weapon choice is shared with Ranked 2v2.</p>
                    <RankedFormatWeaponPicker character={character} onVersionedCharacter={onVersionedCharacter} />
                    <p>Players in queue: <strong>{rankedQueueSize}</strong></p>
                    <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
                        {rankedQueueActive ? (
                            <button className="danger-button" onClick={onLeaveRankedQueue}>Leave Queue</button>
                        ) : (
                            <button disabled={!playerRankedEnabled} onClick={onJoinRankedQueue}>
                                {playerRankedEnabled ? "Queue Up for Ranked" : "Ranked Season Closed"}
                            </button>
                        )}
                    </div>
                    {!playerRankedEnabled && <p className="hint">Ranked matchmaking opens when an administrator starts the current season.</p>}
                    {rankedQueueActive && <p className="hint">Searching for opponent...</p>}
                    <hr style={{ border: "none", borderTop: "1px solid rgba(148,163,184,.25)", margin: "16px 0" }} />
                    <p className="hint"><GiPawPrint style={ARENA_ICON} />Ranked pet battles live in the <strong>Pet Battles</strong> tab — queue for <strong>Pet Colosseum</strong> (2v2 with two reserves) or challenge offline <strong>Beastbound Warfront</strong> defenses (4v4).</p>
                </section>
            )}

            {activeTab === "spectate" && (
                <section className="summary-box">
                    <h3>Spectator Board</h3>
                    <button onClick={onRefreshFights}>Refresh Fights</button>
                    {spectatorFights.length === 0 && pendingSpectatorChallenges.length === 0 ? <p className="hint">No active fights or open district challenges detected right now.</p> : (
                        <div className="jutsu-list">
                            {spectatorFights.map((fight) => <div className="summary-box" key={fight.id}><strong>{fight.title}</strong><p>{fight.mode}{fight.biome ? ` | ${fight.biome}` : ""} | Started {new Date(fight.startedAt).toLocaleTimeString()}</p><button onClick={() => onSpectateFight(fight)}>Spectate</button></div>)}
                            {pendingSpectatorChallenges.map((challenge) => <div className="summary-box" key={`spectate-${challenge.id}`}><strong>{challenge.fromName} vs {challenge.toName}</strong><p>{challenge.mode ?? "standard"} challenge pending</p><button onClick={onViewPendingChallenge}>View Challenge</button></div>)}
                        </div>
                    )}
                </section>
            )}

            {activeTab === "petBattles" && (
                <section className="summary-box">
                    <h3><GiPawPrint style={ARENA_ICON} />Ranked Pet Battles</h3>
                    <p className="hint">Queue for Pet Colosseum to earn Elo, or set a Warfront defense and challenge nearby ranks. Casual pet sparring lives in the Village Battle Arena.</p>
                    <PetRankedModeCards availablePetCount={availablePetCount} onOpenPetLadder={onOpenPetLadder} />
                </section>
            )}
        </div>
    );
}

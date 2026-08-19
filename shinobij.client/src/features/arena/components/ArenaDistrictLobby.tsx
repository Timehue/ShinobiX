import { GiCrossedSwords, GiLadder, GiPawPrint, GiTrophy, GiEyeball, GiColiseum } from "react-icons/gi";
import coliseumLadderImg from "../../../assets/coliseum/coliseum-bg.webp";
import tacticalLadderImg from "../../../assets/ladder/tactical-hero.webp";
import { TACTICAL_ARENA_PET_REQUIREMENT } from "../../../lib/pet";
import type { DuelChallenge } from "../../../App";
import type { Character, PlayerRecord } from "../../../types/character";
import type { EnhancedClanData } from "../../../types/clan";
import type { ArenaSpectatorFight, ArenaTournament } from "../../../lib/world-state";
import type { ArenaDistrictTab } from "../types";

const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;

type ArenaDistrictLobbyProps = {
    character: Character;
    activeTab: ArenaDistrictTab;
    hasAvailablePet: boolean;
    availablePetCount: number;
    opponentClanData: EnhancedClanData | null;
    clanWarOpponents: PlayerRecord[];
    incomingClanWarChallenges: DuelChallenge[];
    arenaTournament: ArenaTournament | null;
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
    onClearTournament: () => void;
    onStartTournament: () => void;
    onJoinRankedQueue: () => void;
    onLeaveRankedQueue: () => void;
    onRefreshFights: () => void;
    onSpectateFight: (fight: ArenaSpectatorFight) => void;
    onViewPendingChallenge: () => void;
    onOpenPetLadder: (mode: "coliseum" | "tactical") => void;
};

export function ArenaDistrictLobby({
    character,
    activeTab,
    hasAvailablePet,
    availablePetCount,
    opponentClanData,
    clanWarOpponents,
    incomingClanWarChallenges,
    arenaTournament,
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
        <div className="card arena-lobby">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <button className="back-to-hub-btn" onClick={onBack}>← Central Hub</button>
                <h2 style={{ margin: 0 }}>Arena District</h2>
            </div>
            <p>Clan battles, ranked mode, tournaments, spectator view, and pet battles are handled here.</p>

            <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                <button className={activeTab === "clanWar" ? "active" : ""} onClick={() => onTabChange("clanWar")}><GiCrossedSwords style={ARENA_ICON} />Clan War</button>
                <button className={activeTab === "tournaments" ? "active" : ""} onClick={() => onTabChange("tournaments")}><GiTrophy style={ARENA_ICON} />Tournaments</button>
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

            {activeTab === "tournaments" && (
                <section className="summary-box">
                    <h3>Tournaments</h3>
                    {arenaTournament ? (
                        <>
                            <p><strong>{arenaTournament.name}</strong> | Started by {arenaTournament.createdBy}</p>
                            <p>Event ends in {Math.ceil(tournamentRemaining / (60 * 60 * 1000))} hour(s). Match timer: {Math.ceil(matchRemaining / (60 * 60 * 1000))} hour(s).</p>
                            <p className="hint">Participants: {arenaTournament.participants.join(", ") || "No participants"}</p>
                            <p className="hint">Advanced: {arenaTournament.advancedPlayers.join(", ") || "None yet"}</p>
                            {isAdminTournamentManager && <div className="jutsu-list">{arenaTournament.participants.map((name) => <div className="summary-box" key={`advance-${name}`}><strong>{name}</strong><button onClick={() => onAdvanceTournamentPlayer(name)}>Advance Player</button></div>)}</div>}
                            {isAdminTournamentManager && <button className="danger-button" onClick={onClearTournament}>End Tournament</button>}
                        </>
                    ) : (
                        <>
                            <p className="hint">Only Admin 1 or Admin 2 can start a weekly tournament.</p>
                            <button disabled={!isAdminTournamentManager} onClick={onStartTournament}>{isAdminTournamentManager ? "Start 1 Week Tournament" : "Admin Only"}</button>
                        </>
                    )}
                </section>
            )}

            {activeTab === "ranked" && (
                <section className="summary-box">
                    <h3>Ranked Battles</h3>
                    <p>Rating: <strong>{character.rankedRating ?? 1000}</strong> Elo | Wins {character.rankedWins ?? 0} | Losses {character.rankedLosses ?? 0}</p>
                    <p className="hint">Ranked fights use neutral ground: no terrain or weather modifiers.</p>
                    <p>Players in queue: <strong>{rankedQueueSize}</strong></p>
                    <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
                        {rankedQueueActive ? (
                            <button className="danger-button" onClick={onLeaveRankedQueue}>Leave Queue</button>
                        ) : (
                            <button disabled={!playerRankedEnabled} onClick={onJoinRankedQueue}>
                                {playerRankedEnabled ? "Queue Up for Ranked" : "Ranked Rollout Pending"}
                            </button>
                        )}
                    </div>
                    {!playerRankedEnabled && <p className="hint">Ranked matchmaking is temporarily paused during the v2 authority rollout.</p>}
                    {rankedQueueActive && <p className="hint">Searching for opponent...</p>}
                    <hr style={{ border: "none", borderTop: "1px solid rgba(148,163,184,.25)", margin: "16px 0" }} />
                    <p className="hint"><GiPawPrint style={ARENA_ICON} />Ranked pet battles moved to the <strong>Pet Battles</strong> tab — climb the global <strong>Colosseum</strong> (1v1) and <strong>Tactical</strong> (4v4) ladders.</p>
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
                    <p className="hint">Compete on the global pet ranked ladders — climb by beating the rival ranked above you. Casual pet sparring lives in the Village Battle Arena.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, margin: "12px 0" }}>
                        {[
                            { mode: "coliseum" as const, requirement: 1, img: coliseumLadderImg, emoji: <GiColiseum size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Colosseum", sub: "1v1 ranked ladder" },
                            { mode: "tactical" as const, requirement: TACTICAL_ARENA_PET_REQUIREMENT, img: tacticalLadderImg, emoji: <GiCrossedSwords size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Tactical", sub: "4v4 ranked ladder" },
                        ].map((card) => {
                            const locked = availablePetCount < card.requirement;
                            return (
                                <button key={card.mode} type="button"
                                    disabled={locked}
                                    title={locked ? `Locked: ${availablePetCount}/${card.requirement} available pets` : undefined}
                                    onClick={() => onOpenPetLadder(card.mode)}
                                    style={{ position: "relative", padding: 0, border: "1px solid rgba(244,196,81,.3)", borderRadius: 14, overflow: "hidden", cursor: locked ? "not-allowed" : "pointer", textAlign: "left", height: 132, background: "#11141f" }}>
                                    <img src={card.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: locked ? .32 : .85, filter: locked ? "grayscale(.75)" : undefined }} />
                                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,10,18,.05), rgba(8,10,18,.85))" }} />
                                    <div style={{ position: "absolute", left: 14, right: 14, bottom: 12 }}>
                                        <div style={{ fontSize: 19, fontWeight: 800, color: "#f7d98a", textShadow: "0 2px 8px #000" }}>{card.emoji} {card.title}</div>
                                        <div style={{ fontSize: 12.5, color: "rgba(231,237,247,.9)", textShadow: "0 1px 5px #000" }}>
                                            {locked ? `Locked · ${availablePetCount}/${card.requirement} available pets` : `${card.sub} · climb the global rankings`}
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

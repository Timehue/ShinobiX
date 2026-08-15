import { GiBoxingGlove, GiColiseum, GiCrossedSwords, GiPawPrint, GiRollingDices, GiTwoCoins } from "react-icons/gi";
import { BackToVillageButton } from "../../../components/BackToVillageButton";
import { BountyBoardPanel } from "../../../components/BountyBoardPanel";
import { MAX_LEVEL } from "../../../constants/game";
import type { DuelChallenge } from "../../../App";
import type { Character, PlayerRecord } from "../../../types/character";
import type { BattleArenaLobbyTab } from "../types";

const ARENA_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;

type BattleArenaLobbyProps = {
    character: Character;
    updateCharacter: (character: Character) => void;
    playerRoster: PlayerRecord[];
    activeTab: BattleArenaLobbyTab;
    aiLevel: number;
    sparSearch: string;
    sparOpponents: PlayerRecord[];
    incomingSpars: DuelChallenge[];
    incomingPetSpars: DuelChallenge[];
    availablePetCount: number;
    onBack: () => void;
    onTabChange: (tab: BattleArenaLobbyTab) => void;
    onAiLevelChange: (level: number) => void;
    onBeginAiBattle: () => void;
    onSparSearchChange: (search: string) => void;
    onSendDirectSpar: (name: string) => void;
    onChallengePlayer: (player: PlayerRecord, mode?: DuelChallenge["mode"], clanWarPoints?: number, teamBattle?: boolean) => void;
    onAcceptChallenge: (challenge: DuelChallenge) => void;
    onDeclineChallenge: (challenge: DuelChallenge) => void;
    onAcceptPetChallenge?: (challenge: DuelChallenge) => void;
    onOpenPetArena: () => void;
    onOpenCardHall: () => void;
};

export function BattleArenaLobby({
    character,
    updateCharacter,
    playerRoster,
    activeTab,
    aiLevel,
    sparSearch,
    sparOpponents,
    incomingSpars,
    incomingPetSpars,
    availablePetCount,
    onBack,
    onTabChange,
    onAiLevelChange,
    onBeginAiBattle,
    onSparSearchChange,
    onSendDirectSpar,
    onChallengePlayer,
    onAcceptChallenge,
    onDeclineChallenge,
    onAcceptPetChallenge,
    onOpenPetArena,
    onOpenCardHall,
}: BattleArenaLobbyProps) {
    return (
        <div className="card arena-lobby">
            <BackToVillageButton onClick={onBack} />
            <h2><GiCrossedSwords style={ARENA_ICON} />Battle Arena</h2>
            <p>Your hub for casual sparring — combat, pets, and cards — plus the bounty board.</p>

            <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                <button className={activeTab === "spar" ? "active" : ""} onClick={() => onTabChange("spar")}><GiBoxingGlove style={ARENA_ICON} />Spar &amp; Challenges</button>
                <button className={activeTab === "bounty" ? "active" : ""} onClick={() => onTabChange("bounty")}><GiTwoCoins style={ARENA_ICON} />Bounty Board</button>
            </div>

            {activeTab === "spar" && (
                <>
                    <section className="summary-box">
                        <h3><GiCrossedSwords style={ARENA_ICON} />Combat Spar — Fight AI</h3>
                        <p className="hint">Pick an AI level (1–{MAX_LEVEL}) and start a practice battle. This stays separate from ranked, clan war, and tournament play.</p>
                        <label>AI Level</label>
                        <input
                            type="number"
                            min={1}
                            max={MAX_LEVEL}
                            value={aiLevel}
                            onChange={(event) => onAiLevelChange(Math.max(1, Math.min(MAX_LEVEL, Number(event.target.value))))}
                        />
                        <button onClick={onBeginAiBattle}>Start AI Battle</button>
                    </section>

                    <section className="summary-box">
                        <h3><GiBoxingGlove style={ARENA_ICON} />Challenge a Player</h3>
                        <p className="hint">Search a player, then send a casual combat spar or a 1v1 pet battle. They get a pop-up to Accept or Decline.</p>
                        <label>Search Player Name</label>
                        <input value={sparSearch} onChange={(event) => onSparSearchChange(event.target.value)} placeholder="Type a player name to challenge..." />
                        {sparSearch.trim() && (
                            <div className="jutsu-list">
                                {sparOpponents.length === 0 ? (
                                    <>
                                        <p className="hint">No roster match. Send a spar challenge directly.</p>
                                        <button onClick={() => onSendDirectSpar(sparSearch.trim())}>Send Spar Challenge to "{sparSearch.trim()}"</button>
                                    </>
                                ) : sparOpponents.map((player) => (
                                    <div className="summary-box" key={`spar-${player.name}`}>
                                        <strong>{player.name}</strong>
                                        <p>Level {player.level} | {player.village} | {player.specialty}</p>
                                        <div className="menu">
                                            <button onClick={() => onChallengePlayer(player)}><GiBoxingGlove aria-hidden="true" /> Spar Challenge</button>
                                            <button
                                                disabled={availablePetCount < 1}
                                                title={availablePetCount < 1 ? "You need one available pet" : undefined}
                                                onClick={() => onChallengePlayer(player, "clanWarPet", 0)}
                                            ><GiPawPrint aria-hidden="true" /> Pet Battle (1v1)</button>
                                            <button
                                                disabled={availablePetCount < 2}
                                                title={availablePetCount < 2 ? "Raise a second pet (not on an expedition) to unlock 2v2" : undefined}
                                                onClick={() => onChallengePlayer(player, "clanWarPet", 0, true)}
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
                                    <button onClick={() => onAcceptChallenge(challenge)}>Accept Spar</button>
                                    <button className="danger-button" onClick={() => onDeclineChallenge(challenge)}>Decline</button>
                                </div>
                            </div>
                        ))}
                    </section>

                    <section className="summary-box">
                        <h3><GiPawPrint style={ARENA_ICON} />Pet Spar</h3>
                        <p className="hint">Head to the Casual Pet Coliseum for a friendly pet duel against AI or a challenged player — no ladder rating on the line.</p>
                        <button
                            disabled={availablePetCount < 1}
                            title={availablePetCount < 1 ? "You need one pet that is not on an expedition" : undefined}
                            onClick={onOpenPetArena}
                        ><GiColiseum style={ARENA_ICON} />Open Casual Pet Coliseum</button>
                        {availablePetCount < 1 && <p className="hint" style={{ color: "var(--gold-2)" }}>Locked: you need one available pet. Pets currently on expeditions cannot battle.</p>}
                        {incomingPetSpars.map((challenge) => (
                            <div className="summary-box" key={challenge.id}>
                                <strong>{challenge.fromName}</strong> wants a pet battle!
                                <div className="menu">
                                    <button onClick={() => onAcceptPetChallenge?.(challenge)}><GiColiseum style={ARENA_ICON} />Accept Pet Battle</button>
                                    <button className="danger-button" onClick={() => onDeclineChallenge(challenge)}>Decline</button>
                                </div>
                            </div>
                        ))}
                    </section>

                    <section className="summary-box">
                        <h3><GiRollingDices style={ARENA_ICON} />Card Battle Spar</h3>
                        <p className="hint">Play Shinobi Chronicle Showdown against the AI or a live free-play opponent at the Card Hall.</p>
                        <button onClick={onOpenCardHall}><GiRollingDices style={ARENA_ICON} />Open Card Hall</button>
                    </section>
                </>
            )}

            {activeTab === "bounty" && (
                <BountyBoardPanel character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} />
            )}
        </div>
    );
}

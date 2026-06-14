/*
 * CardClashDuel — the embedded single-match host for Shinobi Card Clash used by
 * PvE encounters that previously ran the old Shinobi Tiles dungeon duel: Hollow
 * Gate "tile_game" seals, world-event tile encounters, and relic-dungeon seals.
 *
 * It mirrors the old ShinobiTiles dungeon-mode API (onDungeonWin / onDungeonLose
 * / onDungeonLeave / tileDifficulty / dungeonSceneImage) so the call sites swap
 * one component for another with no change to the surrounding dungeon/event
 * logic (rewards, HP penalties, threat/torch resets stay in the callers).
 *
 * No ryo/daily-bonus is granted here — the caller owns the stakes. The player's
 * saved Card Hall deck is used; if they never built one (or own <12 cards) a
 * legal deck is auto-assembled so the encounter is always playable.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import { CARD_CLASH_BOARD_BG } from "../lib/card-clash-art";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import {
    toClashCards,
    indexClashCards,
    validateDeck,
    buildPlayableDeck,
    createCardClashMatch,
    playCard,
    endTurn,
    type CardClashMatchState,
    type CardClashCard,
} from "../lib/card-clash";
import { CardClashBoard } from "../components/CardClashBoard";

type TileDifficulty = "easy" | "normal" | "hard";

// Difficulty → AI deck strength (generateAiDeck level thresholds: 25 adds epics,
// 50 adds legendaries). Fixed tiers keep encounter difficulty predictable.
const DIFFICULTY_AI_LEVEL: Record<TileDifficulty, number> = { easy: 1, normal: 30, hard: 60 };

export function CardClashDuel({
    character,
    creatorCards,
    tileDifficulty = "normal",
    dungeonSceneImage,
    onDungeonWin,
    onDungeonLose,
    onDungeonDraw,
    onDungeonLeave,
}: {
    character: Character;
    creatorCards: TileCard[];
    tileDifficulty?: TileDifficulty;
    dungeonSceneImage?: string;
    onDungeonWin: () => void;
    /** Loss handler (e.g. Hollow Gate's 20% maxHp penalty). Falls back to leave. */
    onDungeonLose?: () => void;
    /** Draw handler. If unset, a draw is treated as a loss (seals require a win). */
    onDungeonDraw?: () => void;
    onDungeonLeave: () => void;
}) {
    const allCards = useMemo(() => getAllTileCards(creatorCards), [creatorCards]);
    const catalog = useMemo<CardClashCard[]>(() => toClashCards(allCards), [allCards]);
    const clashById = useMemo(() => indexClashCards(catalog), [catalog]);

    const deckIds = useMemo(() => {
        const saved = character.cardClashDeck ?? [];
        if (validateDeck(saved, clashById).valid) return saved;
        return buildPlayableDeck(character.tileCards ?? [], clashById, catalog);
    }, [character.cardClashDeck, character.tileCards, clashById, catalog]);

    const [match, setMatch] = useState<CardClashMatchState>(() =>
        createCardClashMatch(deckIds, allCards, DIFFICULTY_AI_LEVEL[tileDifficulty]),
    );

    function handlePlayCard(handIndex: number, locationIndex: number) {
        const res = playCard(match, "player", handIndex, locationIndex);
        if (!res.error) setMatch(res.state);
    }

    function handleEndTurn() {
        setMatch(endTurn(match));
    }

    // A win claims the seal; a loss or draw means the seal was not won → apply
    // the loss stakes (or just leave when the caller has no loss handler).
    function resolve() {
        if (match.winner === "player") onDungeonWin();
        else if (match.winner === "draw") (onDungeonDraw ?? onDungeonLose ?? onDungeonLeave)();
        else (onDungeonLose ?? onDungeonLeave)();
    }

    const done = match.status === "complete";
    const won = match.winner === "player";
    const draw = match.winner === "draw";

    return (
        <div className="card-clash-root" style={{ "--cc-board-bg": `url(${CARD_CLASH_BOARD_BG})` } as CSSProperties}>
            <div className="cc-header">
                <div className="cc-title">
                    <b>Shinobi Card Clash</b>
                    <span>{tileDifficulty === "hard" ? "Sealed Duel — Hard" : tileDifficulty === "easy" ? "Sealed Duel — Easy" : "Sealed Duel"}</span>
                </div>
                <span className="cc-header-spacer" />
                {!done && <button className="cc-btn ghost" onClick={onDungeonLeave}>Leave Duel</button>}
            </div>

            <div className="cc-body">
                {dungeonSceneImage && (
                    <div className="cc-duel-scene" style={{ backgroundImage: `url(${dungeonSceneImage})` }} />
                )}

                {done && (
                    <div className={`cc-result ${won ? "win" : draw ? "draw" : "lose"}`}>
                        <h2>{won ? "🏆 Seal Claimed!" : draw ? "🤝 Draw — Seal Holds" : "💀 Sealed Away"}</h2>
                        <div className="cc-reward">
                            {won
                                ? "You won the duel and claimed the seal."
                                : draw
                                  ? "A draw isn't enough to break the seal."
                                  : "You lost the duel."}
                        </div>
                        <div className="cc-controls" style={{ justifyContent: "center" }}>
                            <button className="cc-btn gold" onClick={resolve}>Continue</button>
                        </div>
                    </div>
                )}

                <CardClashBoard
                    match={match}
                    onPlayCard={handlePlayCard}
                    onEndTurn={handleEndTurn}
                    onRetreat={onDungeonLeave}
                    retreatLabel="Leave Duel"
                />
            </div>
        </div>
    );
}

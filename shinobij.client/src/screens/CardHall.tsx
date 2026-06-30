/*
 * CardHall — the "Card Hall" screen that hosts Shinobi Card Clash, the standalone
 * Marvel-Snap-style 3-location card game that replaces the old Shinobi Tiles
 * free-play duel. Four tabs: Collection, Deck Builder, Play vs AI, Rules.
 *
 * This component OWNS the match state (CardClashMatchState in useState) and the
 * working deck. All board interaction flows back here through callbacks which
 * call the pure engine in lib/card-clash.ts and produce new immutable states —
 * children never mutate match state directly.
 *
 * Reuses the existing 150-card TileCard catalog (and admin/creator overrides)
 * via getAllTileCards; card art comes from each card's `image`. Rewards/stats
 * persist on the Character through the normal save (additive fields).
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import { CARD_CLASH_BOARD_BG } from "../lib/card-clash-art";
import { getAllTileCards, type TileCard } from "../data/tile-cards";
import { SceneAmbience } from "../components/SceneAmbience";
import { currentDateKey } from "../lib/utils";
import {
    toClashCards,
    indexClashCards,
    validateDeck,
    buildPlayableDeck,
    createCardClashMatch,
    playCard,
    endTurn,
    retreat,
    cardClashReward,
    CARD_CLASH_DECK_SIZE,
    type CardClashCard,
    type CardClashMatchState,
    type CardClashRewardSummary,
} from "../lib/card-clash";
import { CardClashCollection } from "../components/CardClashCollection";
import { CardClashDeckBuilder } from "../components/CardClashDeckBuilder";
import { CardClashBoard } from "../components/CardClashBoard";
import { CardClashTutorial } from "../components/CardClashTutorial";

type Tab = "collection" | "deck" | "play" | "rules";

export function CardHall({
    character,
    updateCharacter,
    creatorCards,
    onBack,
    autoStart = false,
    onAutoStartConsumed,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    creatorCards: TileCard[];
    onBack: () => void;
    // When a sector "gambler" wanderer deals the player in, drop straight into a
    // match instead of the menu. Falls back to the deck tab if no valid deck.
    autoStart?: boolean;
    onAutoStartConsumed?: () => void;
}) {
    const allCards = useMemo(() => getAllTileCards(creatorCards), [creatorCards]);
    const clashCards = useMemo(() => toClashCards(allCards), [allCards]);
    const clashById = useMemo(() => indexClashCards(clashCards), [clashCards]);

    const ownedCards = useMemo(() => {
        const seen = new Set<string>();
        const out: CardClashCard[] = [];
        for (const id of character.tileCards ?? []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const c = clashById[id];
            if (c) out.push(c);
        }
        return out;
    }, [character.tileCards, clashById]);

    const [tab, setTab] = useState<Tab>("play");
    const [deckIds, setDeckIds] = useState<string[]>(() => character.cardClashDeck ?? []);
    const [match, setMatch] = useState<CardClashMatchState | null>(null);
    const [reward, setReward] = useState<CardClashRewardSummary | null>(null);
    const [showTutorial, setShowTutorial] = useState<boolean>(() => !character.cardClashTutorialSeen);

    const savedDeck = useMemo(() => character.cardClashDeck ?? [], [character.cardClashDeck]);
    const savedDeckValid = useMemo(() => validateDeck(savedDeck, clashById).valid, [savedDeck, clashById]);
    const deckDirty = useMemo(
        () => JSON.stringify(deckIds) !== JSON.stringify(savedDeck),
        [deckIds, savedDeck],
    );

    function saveDeck() {
        updateCharacter({ ...character, cardClashDeck: deckIds });
    }

    function closeTutorial() {
        setShowTutorial(false);
        if (!character.cardClashTutorialSeen) updateCharacter({ ...character, cardClashTutorialSeen: true });
    }

    // A short-lived nudge shown when we deal a player in on a starter deck.
    const [starterToast, setStarterToast] = useState(false);

    function beginMatch(deck: string[]) {
        setReward(null);
        setMatch(createCardClashMatch(deck, allCards, character.level));
    }
    function startMatch() {
        // Manual "Play" button: bounce to the deck builder if there's no valid deck.
        if (!savedDeckValid) { setTab("deck"); return; }
        beginMatch(savedDeck);
    }

    // Wanderer "deal me in" → drop straight into a match. If the player has no valid
    // deck yet, deal them in on a legal STARTER deck (built from their cards, padded
    // from the catalog) and toast them to build their own — never bounce to a menu.
    function autoStartMatch() {
        setTab("play");
        if (savedDeckValid) {
            beginMatch(savedDeck);
        } else {
            beginMatch(buildPlayableDeck(character.tileCards ?? [], clashById, clashCards));
            setStarterToast(true);
            window.setTimeout(() => setStarterToast(false), 7000);
        }
        onAutoStartConsumed?.();
    }
    // Intentional one-shot: when the gambler wanderer deals the player in, start a
    // match on mount. The state writes are deliberate (and consumed immediately),
    // so the set-state-in-effect guard doesn't apply here.
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (autoStart) autoStartMatch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart]);
    /* eslint-enable react-hooks/set-state-in-effect */

    function finalize(next: CardClashMatchState) {
        const winner = next.winner ?? "draw";
        const today = currentDateKey();
        const alreadyWonToday = character.cardClashDailyWinDate === today;
        const summary = cardClashReward(winner, alreadyWonToday);
        updateCharacter({
            ...character,
            ryo: character.ryo + summary.ryo,
            cardClashWins: (character.cardClashWins ?? 0) + (winner === "player" ? 1 : 0),
            cardClashLosses: (character.cardClashLosses ?? 0) + (winner === "opponent" ? 1 : 0),
            cardClashDraws: (character.cardClashDraws ?? 0) + (winner === "draw" ? 1 : 0),
            cardClashDailyWinDate: summary.dailyBonus ? today : character.cardClashDailyWinDate,
        });
        setReward(summary);
    }

    function handlePlayCard(handIndex: number, locationIndex: number) {
        if (!match) return;
        const res = playCard(match, "player", handIndex, locationIndex);
        if (!res.error) setMatch(res.state);
    }

    function handleEndTurn() {
        if (!match) return;
        const next = endTurn(match);
        setMatch(next);
        if (next.status === "complete") finalize(next);
    }

    function handleRetreat() {
        if (!match) return;
        const next = retreat(match);
        setMatch(next);
        finalize(next);
    }

    const record = `${character.cardClashWins ?? 0}W · ${character.cardClashLosses ?? 0}L · ${character.cardClashDraws ?? 0}D`;

    return (
        <div className="card-clash-root" style={{ "--cc-board-bg": `url(${CARD_CLASH_BOARD_BG})` } as CSSProperties}>
            <SceneAmbience className="amb-under" biome="shadow" />

            {starterToast && (
                <div
                    role="status"
                    onClick={() => setStarterToast(false)}
                    style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999, maxWidth: 460, padding: "10px 16px", borderRadius: 10, background: "linear-gradient(#1e293b,#0f172a)", border: "1px solid #a78bfa", color: "#e2e8f0", boxShadow: "0 6px 24px rgba(0,0,0,0.45)", fontSize: ".85rem", lineHeight: 1.35, cursor: "pointer", textAlign: "center" }}
                >
                    🃏 You're playing a <strong>starter deck</strong>. Build your own in the <strong>Deck Builder</strong> for a real edge. <span style={{ opacity: 0.7 }}>(tap to dismiss)</span>
                </div>
            )}

            <div className="cc-header">
                <button className="cc-btn ghost" onClick={onBack}>← Back</button>
                <div className="cc-title">
                    <b>Shinobi Card Clash</b>
                    <span>Card Hall</span>
                </div>
                <span className="cc-header-spacer" />
                <div className="cc-record">
                    <span>{record}</span>
                    <span className="cc-ryo">◈ {character.ryo.toLocaleString()}</span>
                    <button className="cc-btn ghost" style={{ padding: "6px 10px" }} title="How to play" onClick={() => setShowTutorial(true)}>?</button>
                </div>
            </div>

            <div className="cc-tabs">
                <button className={`cc-tab ${tab === "collection" ? "active" : ""}`} onClick={() => setTab("collection")}>Collection</button>
                <button className={`cc-tab ${tab === "deck" ? "active" : ""}`} onClick={() => setTab("deck")}>Deck Builder</button>
                <button className={`cc-tab ${tab === "play" ? "active" : ""}`} onClick={() => setTab("play")}>Play vs AI</button>
                <button className={`cc-tab ${tab === "rules" ? "active" : ""}`} onClick={() => setTab("rules")}>Rules</button>
            </div>

            <div className="cc-body">
                {tab === "collection" && <CardClashCollection ownedCards={ownedCards} />}

                {tab === "deck" && (
                    <CardClashDeckBuilder
                        ownedCards={ownedCards}
                        cardsById={clashById}
                        deckIds={deckIds}
                        setDeckIds={setDeckIds}
                        onSave={saveDeck}
                        dirty={deckDirty}
                    />
                )}

                {tab === "play" && (
                    <PlayTab
                        match={match}
                        reward={reward}
                        savedDeckValid={savedDeckValid}
                        savedDeckCount={savedDeck.length}
                        ownedCount={ownedCards.length}
                        onStart={startMatch}
                        onGoToDeck={() => setTab("deck")}
                        onPlayCard={handlePlayCard}
                        onEndTurn={handleEndTurn}
                        onRetreat={handleRetreat}
                        onPlayAgain={startMatch}
                        onExitMatch={() => { setMatch(null); setReward(null); }}
                    />
                )}

                {tab === "rules" && <RulesTab />}
            </div>

            {showTutorial && <CardClashTutorial onClose={closeTutorial} />}
        </div>
    );
}

// ── Play tab ─────────────────────────────────────────────────────────────────

function PlayTab({
    match, reward, savedDeckValid, savedDeckCount, ownedCount,
    onStart, onGoToDeck, onPlayCard, onEndTurn, onRetreat, onPlayAgain, onExitMatch,
}: {
    match: CardClashMatchState | null;
    reward: CardClashRewardSummary | null;
    savedDeckValid: boolean;
    savedDeckCount: number;
    ownedCount: number;
    onStart: () => void;
    onGoToDeck: () => void;
    onPlayCard: (h: number, l: number) => void;
    onEndTurn: () => void;
    onRetreat: () => void;
    onPlayAgain: () => void;
    onExitMatch: () => void;
}) {
    // Finished match → result + reward banner.
    if (match && match.status === "complete" && reward) {
        const cls = reward.result === "player" ? "win" : reward.result === "opponent" ? "lose" : "draw";
        const heading = reward.result === "player" ? "🏆 Victory!" : reward.result === "opponent" ? "💀 Defeat" : "🤝 Draw";
        return (
            <div>
                <div className={`cc-result ${cls}`}>
                    <h2>{heading}</h2>
                    <div className="cc-reward">
                        You earned <span className="gold">◈ {reward.ryo.toLocaleString()} ryo</span>
                        {reward.dailyBonus && <span className="cc-muted"> (incl. first-win-of-day bonus!)</span>}
                    </div>
                    <div className="cc-controls" style={{ justifyContent: "center" }}>
                        <button className="cc-btn primary" onClick={onPlayAgain}>Play Again</button>
                        <button className="cc-btn ghost" onClick={onExitMatch}>Back to Hall</button>
                    </div>
                </div>
                <CardClashBoard match={match} onPlayCard={onPlayCard} onEndTurn={onEndTurn} onRetreat={onRetreat} />
            </div>
        );
    }

    // Active match.
    if (match) {
        return <CardClashBoard match={match} onPlayCard={onPlayCard} onEndTurn={onEndTurn} onRetreat={onRetreat} />;
    }

    // No deck yet.
    if (!savedDeckValid) {
        return (
            <div className="cc-empty-note">
                {ownedCount < CARD_CLASH_DECK_SIZE ? (
                    <>
                        You need at least <b>{CARD_CLASH_DECK_SIZE} cards</b> to play. Open Card Packs in the Shop or Grand
                        Marketplace, then build your deck.
                    </>
                ) : (
                    <>
                        You need a saved <b>{CARD_CLASH_DECK_SIZE}-card deck</b> to play.
                        {savedDeckCount > 0 && <> Your saved deck has {savedDeckCount} cards.</>}
                        <div style={{ marginTop: 12 }}>
                            <button className="cc-btn primary" onClick={onGoToDeck}>Open Deck Builder</button>
                        </div>
                    </>
                )}
            </div>
        );
    }

    // Ready to play.
    return (
        <div className="cc-section-card" style={{ textAlign: "center", padding: 28 }}>
            <h2 style={{ marginTop: 0 }}>⚔️ Ready to Clash</h2>
            <p className="cc-muted" style={{ maxWidth: 460, margin: "0 auto 16px" }}>
                Face an AI shinobi across 3 random locations over 6 turns. Win the most locations to claim the match —
                and your first win each day pays a bonus.
            </p>
            <div className="cc-controls" style={{ justifyContent: "center" }}>
                <button className="cc-btn gold" style={{ fontSize: 16, padding: "12px 28px" }} onClick={onStart}>Start Match</button>
                <button className="cc-btn ghost" onClick={onGoToDeck}>Edit Deck</button>
            </div>
        </div>
    );
}

// ── Rules tab ────────────────────────────────────────────────────────────────

function RulesTab() {
    return (
        <div className="cc-section-card cc-rules">
            <p className="lead">Shinobi Card Clash is a 6-turn battle for control of 3 locations. Win 2 of the 3 to win the match.</p>

            <h3>The Goal</h3>
            <p>At the end of Turn 6, the side with more total Power at a location wins it. Win 2 of 3 locations to win the
                match. If it's 1–1 with one tied location, the higher total board Power wins; a full tie is a draw.</p>

            <h3>Chakra</h3>
            <ul>
                <li>Turn 1 = 1 Chakra, Turn 2 = 2 … up to Turn 6 = 6 Chakra.</li>
                <li>Each card costs Chakra to play. Unused Chakra does not carry over.</li>
            </ul>

            <h3>Cards & Hand</h3>
            <ul>
                <li>You open with 3 cards and draw 1 at the start of each new turn (max hand of 7).</li>
                <li>Each location holds up to 4 of your cards (and 4 of the opponent's).</li>
                <li>Cards have a Cost and Power derived from your collection, plus a Role and often an On-Reveal ability.</li>
            </ul>

            <h3>Locations</h3>
            <p>Three random locations are drawn each match. Many give a Power bonus to certain cards — Fire cards, Common
                cards, low-cost cards, and so on. Use them to your advantage.</p>

            <h3>Deck Building</h3>
            <ul>
                <li>A deck is exactly <b>{CARD_CLASH_DECK_SIZE}</b> cards.</li>
                <li>Common / Rare: up to 2 copies each. Epic / Legendary: 1 copy each.</li>
                <li>At most 2 Legendary cards per deck.</li>
            </ul>

            <h3>Rewards</h3>
            <ul>
                <li>Win: 50 ryo · Draw: 15 ryo · Loss: 5 ryo.</li>
                <li>Your first win each day earns a bonus 250 ryo.</li>
            </ul>
        </div>
    );
}

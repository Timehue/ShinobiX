import { useState } from "react";
import type { Character } from "../types/character";
import { ELEMENT_COUNTERS, getAllTileCards, type TileCard, type TileCardArrow } from "../data/tile-cards";
import { FestivalPortrait } from "../components/Pills";
import { currentDateKey } from "../lib/utils";
import { effectiveCharacterXpGain } from "../lib/progression";
import { gainXp } from "../App";

export function SunscarFestival({
    character,
    updateCharacter,
    creatorCards,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorCards: TileCard[];
}) {
    const [diceResult, setDiceResult] = useState<string[]>([]);
    const [festivalLog, setFestivalLog] = useState(
        "Kael the Sand Dealer watches you from beneath a gold mask."
    );

    // -- Card Duel state ------------------------------------------------------
    type DuelPhase = "idle" | "bet" | "select" | "game" | "result";
    type BoardCell = { card: TileCard; owner: "player" | "enemy" } | null;

    const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
    const [duelBet, setDuelBet] = useState(0);
    const [deckPicks, setDeckPicks] = useState<TileCard[]>([]);
    const [board, setBoard] = useState<BoardCell[]>(Array(9).fill(null));
    const [playerHand, setPlayerHand] = useState<TileCard[]>([]);
    const [enemyHand, setEnemyHand] = useState<TileCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<TileCard | null>(null);
    const [isPlayerTurn, setIsPlayerTurn] = useState(true);
    const [duelFlipped, setDuelFlipped] = useState<number[]>([]);
    const [lastPlaced, setLastPlaced] = useState<number | null>(null);
    const [duelResult, setDuelResult] = useState<"win" | "lose" | "draw" | null>(null);

    const allCards = getAllTileCards(creatorCards);
    const ownedCards = (character.tileCards ?? []).map((id) => allCards.find((c) => c.id === id)).filter(Boolean) as TileCard[];
    const kaelImage = "";
    const miraaImage = "";

    function adjPos(pos: number, dir: TileCardArrow): number | null {
        const r = Math.floor(pos / 3), c = pos % 3;
        if (dir === "up" && r > 0) return pos - 3;
        if (dir === "down" && r < 2) return pos + 3;
        if (dir === "left" && c > 0) return pos - 1;
        if (dir === "right" && c < 2) return pos + 1;
        return null;
    }

    function doFlips(b: BoardCell[], pos: number, owner: "player" | "enemy"): BoardCell[] {
        const nb = [...b];
        const placed = nb[pos]!.card;
        const justFlipped: number[] = [];
        const dirs: { atk: keyof TileCard; def: keyof TileCard; dir: TileCardArrow }[] = [
            { atk: "top", def: "bottom", dir: "up" },
            { atk: "bottom", def: "top", dir: "down" },
            { atk: "left", def: "right", dir: "left" },
            { atk: "right", def: "left", dir: "right" },
        ];
        const friendlyEls = nb.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== pos && c?.owner === owner && c.card.element === placed.element).map(({ i }) => i);
        for (const { atk, def, dir } of dirs) {
            const ap = adjPos(pos, dir);
            if (ap === null) continue;
            const cell = nb[ap];
            if (!cell || cell.owner === owner) continue;
            let atkVal = placed[atk] as number;
            const defVal = cell.card[def] as number;
            if (ELEMENT_COUNTERS[placed.element] === cell.card.element) atkVal = Math.floor(atkVal * 1.2);
            const hasFriendlyBoost = friendlyEls.some(fi => (["up","down","left","right"] as TileCardArrow[]).some(d => adjPos(pos, d) === fi));
            if (hasFriendlyBoost) atkVal = Math.floor(atkVal * 1.2);
            if (atkVal >= defVal) { nb[ap] = { ...cell, owner }; justFlipped.push(ap); }
        }
        setDuelFlipped(justFlipped);
        return nb;
    }

    function countDuelScore(b: BoardCell[]) {
        return { player: b.filter((c) => c?.owner === "player").length, enemy: b.filter((c) => c?.owner === "enemy").length };
    }

    function checkDuelEnd(b: BoardCell[], ph: TileCard[], eh: TileCard[]): boolean {
        if (!b.every((c) => c !== null) && (ph.length > 0 || eh.length > 0)) return false;
        const { player, enemy } = countDuelScore(b);
        const r = player > enemy ? "win" : player < enemy ? "lose" : "draw";
        setDuelResult(r);
        setDuelPhase("result");
        if (r === "win") updateCharacter({ ...character, ryo: character.ryo + duelBet * 2 });
        else if (r === "lose") updateCharacter({ ...character, ryo: character.ryo - duelBet });
        return true;
    }

    function startDuel() {
        if (deckPicks.length !== 5) return;
        const npcDeck = [...allCards].sort(() => Math.random() - 0.5).slice(0, 5);
        setBoard(Array(9).fill(null));
        setPlayerHand([...deckPicks]);
        setEnemyHand(npcDeck);
        setSelectedCard(null);
        setDuelFlipped([]);
        setLastPlaced(null);
        setIsPlayerTurn(true);
        setDuelResult(null);
        setDuelPhase("game");
    }

    function placeCard(pos: number) {
        if (!isPlayerTurn || !selectedCard || board[pos] !== null) return;
        const nb = [...board]; nb[pos] = { card: selectedCard, owner: "player" };
        const afterFlip = doFlips(nb, pos, "player");
        setLastPlaced(pos);
        const newPH = playerHand.filter((c) => c !== selectedCard);
        setPlayerHand(newPH); setSelectedCard(null); setBoard(afterFlip); setIsPlayerTurn(false);
        if (checkDuelEnd(afterFlip, newPH, enemyHand)) return;
        setTimeout(() => npcAiTurn(afterFlip, enemyHand, newPH), 900);
    }

    function npcAiTurn(b: BoardCell[], eh: TileCard[], ph: TileCard[]) {
        if (eh.length === 0) { checkDuelEnd(b, ph, []); return; }
        const empty = b.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
        if (empty.length === 0) { checkDuelEnd(b, ph, eh); return; }
        let bestCard = eh[0], bestPos = empty[0], bestScore = -1;
        for (const card of eh) {
            for (const pos of empty) {
                let score = 0;
                const aiDirs: { atk: keyof TileCard; def: keyof TileCard; dir: TileCardArrow }[] = [
                    { atk: "top", def: "bottom", dir: "up" },
                    { atk: "bottom", def: "top", dir: "down" },
                    { atk: "left", def: "right", dir: "left" },
                    { atk: "right", def: "left", dir: "right" },
                ];
                for (const { atk, def, dir } of aiDirs) {
                    const ap = adjPos(pos, dir);
                    if (ap === null || b[ap]?.owner !== "player") continue;
                    let atkVal = card[atk] as number;
                    const defVal = b[ap]!.card[def] as number;
                    if (ELEMENT_COUNTERS[card.element] === b[ap]!.card.element) atkVal = Math.floor(atkVal * 1.2);
                    if (atkVal >= defVal) score++;
                }
                if (score > bestScore) { bestScore = score; bestCard = card; bestPos = pos; }
            }
        }
        const nb = [...b]; nb[bestPos] = { card: bestCard, owner: "enemy" };
        const afterFlip = doFlips(nb, bestPos, "enemy");
        setLastPlaced(bestPos);
        const newEH = eh.filter((c) => c !== bestCard);
        setEnemyHand(newEH); setBoard(afterFlip); setIsPlayerTurn(true);
        checkDuelEnd(afterFlip, ph, newEH);
    }

    function togglePick(card: TileCard) {
        if (deckPicks.includes(card)) setDeckPicks(deckPicks.filter((c) => c !== card));
        else if (deckPicks.length < 5) setDeckPicks([...deckPicks, card]);
    }

    function DuelCardTile({ card, owner, selected, compact }: { card: TileCard; owner?: "player" | "enemy"; selected?: boolean; compact?: boolean }) {
        const borderColor = selected
            ? "#ffe082"
            : owner === "player" ? "#4fc3f7"
                : owner === "enemy" ? "#ef5350"
                    : card.rarity === "legendary" ? "#fbbf24"
                        : card.rarity === "epic" ? "#ce93d8"
                            : card.rarity === "rare" ? "#60a5fa"
                                : "#475569";
        const bgColor = owner === "player" ? "rgba(13,33,55,0.97)"
            : owner === "enemy" ? "rgba(40,10,10,0.97)"
                : "rgba(18,18,36,0.97)";
        const rarityGlow = card.rarity === "legendary" ? "0 0 14px rgba(251,191,36,0.6)"
            : card.rarity === "epic" ? "0 0 10px rgba(206,147,216,0.45)"
                : card.rarity === "rare" ? "0 0 8px rgba(96,165,250,0.4)"
                    : "none";
        const ec: Record<string, string> = {
            Fire: "#ff7043", Water: "#4fc3f7", Earth: "#a1887f", Wind: "#a5d6a7",
            Lightning: "#fff176", Shadow: "#ba68c8", Ice: "#b0e0ff", Neutral: "#94a3b8", None: "#555"
        };
        const w = compact ? 90 : 120;
        const ih = compact ? 60 : 80;
        const numSz = compact ? 9 : 11;
        const numColor = "#ffe082";
        const numBg = "rgba(0,0,0,0.72)";
        return (
            <div style={{
                position: "relative", width: w, background: bgColor, border: `2px solid ${borderColor}`,
                borderRadius: 8, overflow: "hidden", boxShadow: rarityGlow, boxSizing: "border-box", flexShrink: 0
            }}>
                <div style={{ position: "relative", width: "100%", height: ih, background: "#07111f", overflow: "hidden" }}>
                    {card.image
                        ? <img src={card.image} alt={card.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, opacity: 0.35 }}>🖼️</div>
                    }
                    {/* Top */}
                    <span style={{
                        position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: numSz, fontWeight: "bold", color: numColor, background: numBg,
                        padding: "1px 3px", borderRadius: 3, lineHeight: 1.2, pointerEvents: "none"
                    }}>{card.top}</span>
                    {/* Bottom */}
                    <span style={{
                        position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
                        fontSize: numSz, fontWeight: "bold", color: numColor, background: numBg,
                        padding: "1px 3px", borderRadius: 3, lineHeight: 1.2, pointerEvents: "none"
                    }}>{card.bottom}</span>
                    {/* Left */}
                    <span style={{
                        position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: numSz, fontWeight: "bold", color: numColor, background: numBg,
                        padding: "1px 3px", borderRadius: 3, lineHeight: 1.2, pointerEvents: "none"
                    }}>{card.left}</span>
                    {/* Right */}
                    <span style={{
                        position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
                        fontSize: numSz, fontWeight: "bold", color: numColor, background: numBg,
                        padding: "1px 3px", borderRadius: 3, lineHeight: 1.2, pointerEvents: "none"
                    }}>{card.right}</span>
                </div>
                <div style={{ padding: compact ? "2px 5px 3px" : "4px 6px 5px", background: "rgba(0,0,0,0.6)" }}>
                    <div style={{
                        fontSize: compact ? 8 : 10, fontWeight: "bold", color: "#e2e8f0",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>{card.name}</div>
                    {!compact && card.element !== "None" && (
                        <div style={{ fontSize: 8, color: ec[card.element] ?? "#aaa", marginTop: 1 }}>{card.element}</div>
                    )}
                </div>
            </div>
        );
    }

    const symbols = ["🦂", "🪙", "👁️", "⚔️", "🌙", "⭐"];

    function rollDice() {
        const cost = 25;
        const dailySpins = character.dailyFateSpins ?? 0;
        if (dailySpins >= 5) {
            setFestivalLog("Kael: The dice grow cold. Your fate is spent for today — return at midnight UTC.");
            return;
        }

        if (character.ryo < cost) {
            setFestivalLog("Kael: No coin, no fate. Come back with more ryo.");
            return;
        }

        const roll = Array.from({ length: 3 }).map(
            () => symbols[Math.floor(Math.random() * symbols.length)]
        );

        let rewardRyo = 0;
        let rewardXp = 0;
        let rewardStamina = 0;
        let rewardBoneCharms = 0;
        let rewardFateShards = 0;
        let rewardAuraStones = 0;
        let message: string;

        const same = roll[0] === roll[1] && roll[1] === roll[2];

        if (same && roll[0] === "👁️") {
            rewardBoneCharms = 10;
            rewardFateShards = 5;
            rewardAuraStones = 5;
            message = "LEGENDARY FATE! The Eye of the Dunes opens — rare currencies pour from the heavens.";
        } else if (same) {
            rewardBoneCharms = Math.floor(Math.random() * 5) + 1; // 1–5
            rewardFateShards = Math.floor(Math.random() * 3) + 1; // 1–3
            message = `Triple ${roll[0]}! The dice bless you with rare spoils.`;
        } else if (roll.includes("🦂")) {
            rewardRyo = 10;
            rewardXp = 15;
            message = "The scorpion strikes. A harsh lesson — you walk away with scraps.";
        } else if (roll.includes("🪙")) {
            rewardRyo = 100;
            rewardXp = 20;
            message = "Coins flash beneath the desert sun. Fortune smiles on you.";
        } else if (roll.includes("⚔️")) {
            rewardStamina = 30;
            rewardXp = 25;
            message = "Blade omen. Your body surges with fighting spirit.";
        } else if (roll.includes("🌙")) {
            rewardXp = 75;
            rewardRyo = 25;
            message = "Moon omen. A strange luck follows you through the night.";
        } else {
            rewardRyo = 40;
            rewardXp = 10;
            message = "Small fortune. The sands give a little back.";
        }

        const paidCharacter = { ...character, ryo: character.ryo - cost };
        const leveled = gainXp(paidCharacter, rewardXp);

        updateCharacter({
            ...leveled,
            ryo: leveled.ryo + rewardRyo,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + rewardStamina),
            boneCharms: (leveled.boneCharms ?? 0) + rewardBoneCharms,
            fateShards: (leveled.fateShards ?? 0) + rewardFateShards,
            auraStones: (leveled.auraStones ?? 0) + rewardAuraStones,
            dailyFateSpins: dailySpins + 1,
            lastDailyReset: currentDateKey(),
        });

        setDiceResult(roll);
        const parts = [
            rewardBoneCharms > 0 && `+${rewardBoneCharms} Bone Charms`,
            rewardFateShards > 0 && `+${rewardFateShards} Fate Shards`,
            rewardAuraStones > 0 && `+${rewardAuraStones} Aura Stones`,
            rewardRyo > 0 && `+${rewardRyo} ryo`,
            rewardXp > 0 && `+${effectiveCharacterXpGain(character, rewardXp)} XP`,
            rewardStamina > 0 && `+${rewardStamina} stamina`,
        ].filter(Boolean).join(", ");
        setFestivalLog(`Kael: ${message} ${parts}. (${dailySpins + 1}/5 spins today)`);
    }

    // -- Active card duel overlays --------------------------------------------
    if (duelPhase === "bet") {
        return (
            <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
                <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.4rem" }}>🔮</div>
                <h2 style={{ textAlign: "center", marginBottom: "0.2rem" }}>Miraa the Card Seer</h2>
                <p style={{ color: "#aaa", textAlign: "center", marginBottom: "1rem" }}>"Place your wager and we shall see whose fate runs deeper."</p>
                <p style={{ marginBottom: "0.8rem" }}>Your ryo: <strong>{character.ryo}</strong></p>
                {ownedCards.length < 5
                    ? <p style={{ color: "#ef5350" }}>You need at least 5 cards to duel. Buy packs in the Shop.</p>
                    : (
                        <div className="menu" style={{ flexDirection: "column", gap: "0.5rem" }}>
                            {[50, 100, 250, 500].map((amount) => (
                                <button key={amount}
                                    disabled={character.ryo < amount}
                                    onClick={() => { setDuelBet(amount); setDeckPicks([]); setDuelPhase("select"); }}>
                                    Bet {amount} ryo — win {amount * 2} ryo
                                </button>
                            ))}
                        </div>
                    )
                }
                <button style={{ marginTop: "1rem" }} onClick={() => setDuelPhase("idle")}>Leave</button>
            </div>
        );
    }

    if (duelPhase === "select") {
        return (
            <div className="card">
                <h2>Select Your 5 Cards</h2>
                <p style={{ color: "#aaa", marginBottom: "0.3rem" }}>Bet: <strong style={{ color: "#ffe082" }}>{duelBet} ryo</strong></p>
                <p style={{ marginBottom: "0.5rem" }}>Picked: <strong>{deckPicks.length} / 5</strong></p>
                <div className="menu" style={{ marginBottom: "1rem" }}>
                    <button onClick={startDuel} disabled={deckPicks.length !== 5}>Play</button>
                    <button onClick={() => setDuelPhase("bet")}>Back</button>
                </div>
                {deckPicks.length > 0 && (
                    <div style={{ marginBottom: "1rem" }}>
                        <h4>Your Deck</h4>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {deckPicks.map((c, i) => <div key={i} onClick={() => togglePick(c)} style={{ cursor: "pointer" }}><DuelCardTile card={c} owner="player" compact /></div>)}
                        </div>
                    </div>
                )}
                <h4>Collection</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {ownedCards.map((card, i) => {
                        const picked = deckPicks.includes(card);
                        return (
                            <div key={card.id + i} onClick={() => togglePick(card)}
                                style={{ cursor: "pointer", opacity: !picked && deckPicks.length >= 5 ? 0.4 : 1 }}>
                                <DuelCardTile card={card} owner={picked ? "player" : undefined} selected={picked} compact />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (duelPhase === "game") {
        const { player: pScore, enemy: eScore } = countDuelScore(board);
        return (
            <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <h2 style={{ margin: 0 }}>⚔️ vs Miraa</h2>
                    <span style={{ color: "#ffe082", fontSize: 13 }}>Bet: {duelBet} ryo</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: 13 }}>
                    <span style={{ color: "#4fc3f7" }}>You: {pScore}</span>
                    <span style={{ color: isPlayerTurn ? "#a5d6a7" : "#ef9a9a" }}>{isPlayerTurn ? "Your Turn" : "Miraa thinking..."}</span>
                    <span style={{ color: "#ef5350" }}>Miraa: {eScore}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} onClick={() => placeCard(i)}
                            style={{
                                background: cell ? (cell.owner === "player" ? "rgba(13,33,55,0.6)" : "rgba(40,10,10,0.6)") : "rgba(10,10,20,0.5)",
                                border: duelFlipped.includes(i) ? "2px solid #ffe082" : lastPlaced === i ? "2px solid #4ade80" : cell ? `2px solid ${cell.owner === "player" ? "#4fc3f7" : "#ef5350"}` : "2px dashed #2d3748",
                                borderRadius: 10, minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: isPlayerTurn && selectedCard && !cell ? "pointer" : "default",
                                transition: "border-color 0.2s, background 0.2s",
                                boxShadow: duelFlipped.includes(i) ? "0 0 12px rgba(255,224,130,0.4)" : lastPlaced === i ? "0 0 10px rgba(74,222,128,0.3)" : "none",
                            }}>
                            {cell
                                ? <DuelCardTile card={cell.card} owner={cell.owner} compact />
                                : isPlayerTurn && selectedCard
                                    ? <span style={{ color: "#3b82f6", fontSize: 20, opacity: 0.5 }}>+</span>
                                    : null}
                        </div>
                    ))}
                </div>
                <h4 style={{ marginBottom: "0.4rem" }}>Your Hand ({playerHand.length})</h4>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.5rem" }}>
                    {playerHand.map((card, i) => (
                        <div key={i} onClick={() => isPlayerTurn && setSelectedCard(selectedCard === card ? null : card)}
                            style={{ cursor: isPlayerTurn ? "pointer" : "default", transform: selectedCard === card ? "translateY(-4px)" : "none", transition: "transform 0.15s" }}>
                            <DuelCardTile card={card} owner="player" selected={selectedCard === card} compact />
                        </div>
                    ))}
                </div>
                {selectedCard && <p style={{ color: "#ffe082", fontSize: 12, marginTop: 4 }}>👆 {selectedCard.name} selected — tap a board cell to place it</p>}
            </div>
        );
    }

    if (duelPhase === "result") {
        const { player, enemy } = countDuelScore(board);
        const ryoChange = duelResult === "win" ? `+${duelBet} ryo` : duelResult === "lose" ? `-${duelBet} ryo` : "no change";
        const miraaQuote = duelResult === "win"
            ? "Miraa: \"The sands do not lie... you have read them well. Take your prize.\""
            : duelResult === "lose"
                ? "Miraa: \"The desert claims the weak. Come back when you are worthy.\""
                : "Miraa: \"Even fate blinks sometimes. A draw — rare as a storm with no lightning.\"";
        return (
            <div className="card" style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: "1.8rem", color: duelResult === "win" ? "#a5d6a7" : duelResult === "lose" ? "#ef5350" : "#ffe082" }}>
                    {duelResult === "win" ? "Victory!" : duelResult === "lose" ? "Defeated" : "Draw"}
                </h2>
                <p style={{ marginBottom: "0.3rem" }}>You <strong>{player}</strong> — Miraa <strong>{enemy}</strong></p>
                <p style={{ color: duelResult === "win" ? "#a5d6a7" : duelResult === "lose" ? "#ef5350" : "#ffe082", marginBottom: "0.5rem" }}>{ryoChange}</p>
                <p style={{ color: "#aaa", fontStyle: "italic", marginBottom: "1rem", fontSize: 13 }}>{miraaQuote}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem", maxWidth: 320, margin: "0 auto 1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} style={{ background: cell?.owner === "player" ? "#0d2137" : cell?.owner === "enemy" ? "#200a0a" : "#111", border: `2px solid ${cell?.owner === "player" ? "#4fc3f7" : cell?.owner === "enemy" ? "#ef5350" : "#333"}`, borderRadius: 8, padding: 4, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {cell && <DuelCardTile card={cell.card} owner={cell.owner} compact />}
                        </div>
                    ))}
                </div>
                <div className="menu">
                    <button onClick={() => { setDeckPicks([]); setDuelPhase("bet"); }}>Challenge Again</button>
                    <button onClick={() => setDuelPhase("idle")}>Return to Festival</button>
                </div>
            </div>
        );
    }

    return (
        <div className="sunscar-festival">
            <div className="sunscar-hero">
                <h1>☀️ Sunscar Festival</h1>
                <p>
                    Sector 35 — a permanent desert festival of lanterns, caravans,
                    sandstone arches, and fate-bound dice.
                </p>
            </div>

            <div className="sunscar-grid">
                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={kaelImage} icon="🎲" name="Kael the Sand Dealer" />
                    <h2>Kael the Sand Dealer</h2>
                    <p>
                        "Fortune favors the bold… and buries the weak beneath the sands."
                    </p>
                    <p><strong>Entry Cost:</strong> 25 ryo per roll</p>
                    <p><strong>Your Ryo:</strong> {character.ryo}</p>
                </section>

                <section className="sunscar-card dice-card">
                    <h2>🎲 Dice of Fate</h2>

                    <div className="dice-row">
                        {(diceResult.length ? diceResult : ["🎲", "🎲", "🎲"]).map((die, index) => (
                            <div className="fate-die" key={index}>{die}</div>
                        ))}
                    </div>

                    <button className="sunscar-roll-button" onClick={rollDice}>
                        Roll Dice of Fate
                    </button>

                    <div className="sunscar-log">{festivalLog}</div>
                </section>

                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={miraaImage} icon="🃏" name="Miraa the Card Seer" />
                    <h2>Miraa the Card Seer</h2>
                    <p style={{ fontStyle: "italic", color: "#aaa", marginBottom: "0.5rem" }}>
                        "The cards remember every shinobi who has sat across from me. Most don't return."
                    </p>
                    <p style={{ marginBottom: "0.5rem" }}>Challenge Miraa to a game of <strong>Shinobi Tiles</strong>. Bet ryo — winner takes double.</p>
                    {character.tileCards.length < 5
                        ? <p style={{ color: "#ef5350", fontSize: 13 }}>You need 5 cards to duel. Buy packs in the Shop.</p>
                        : <button onClick={() => setDuelPhase("bet")} style={{ marginTop: "0.5rem" }}>Challenge Miraa</button>
                    }
                </section>

                <section className="sunscar-card">
                    <h2>Festival Grounds</h2>
                    <div className="festival-visual">
                        <span>🏕️</span>
                        <span>🔥</span>
                        <span>🥁</span>
                        <span>🎭</span>
                        <span>🐪</span>
                        <span>🎲</span>
                    </div>
                    <p>
                        Golden tents, torch bowls, desert drums, masked merchants,
                        camel caravans, and huge carved dice statues fill the dunes.
                    </p>
                </section>
            </div>
        </div>
    );
}

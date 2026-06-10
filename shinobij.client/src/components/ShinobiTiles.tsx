 
import { useState } from "react";
import type { Character } from "../types/character";
import { ELEMENT_COUNTERS, getAllTileCards, type TileCard, type TileCardArrow } from "../data/tile-cards";

export function ShinobiTiles({ character, updateCharacter, creatorCards, dungeonMode = false, tileDifficulty = "normal", onDungeonWin, onDungeonLeave, onDungeonLose, dungeonSceneImage }: { character: Character; updateCharacter: (c: Character) => void; creatorCards: TileCard[]; dungeonMode?: boolean; tileDifficulty?: "easy" | "normal" | "hard"; onDungeonWin?: () => void; onDungeonLeave?: () => void;
    // Fired when the player exits the result screen after LOSING. Distinct
    // from onDungeonLeave (which is also called for explicit abandons before
    // a result was reached). Used by Hollow Gate to apply -20% maxHp penalty
    // only when the player actually lost the card game.
    onDungeonLose?: () => void;
    // Optional scene/opponent portrait shown as a banner in dungeon mode.
    // Set by the Hollow Gate caller to shrine:tile-tile-game so the admin-
    // generated card-game scene art actually appears during the duel.
    dungeonSceneImage?: string;
 }) {
    type BoardCell = { card: TileCard; owner: "player" | "enemy" } | null;
    type Phase = "collection" | "select" | "game" | "result";

    const allCards = getAllTileCards(creatorCards);
    const ownedCards = (character.tileCards ?? []).map((id) => allCards.find((c) => c.id === id)).filter(Boolean) as TileCard[];

    const [phase, setPhase] = useState<Phase>(dungeonMode ? "select" : "collection");
    const [deckPicks, setDeckPicks] = useState<TileCard[]>([]);
    const [collFilterRarity, setCollFilterRarity]   = useState<TileCard["rarity"] | "all">("all");
    const [collFilterElement, setCollFilterElement] = useState<string>("all");
    const [collSortBy, setCollSortBy]               = useState<"rarity" | "name" | "power">("rarity");
    const [collSelectedCard, setCollSelectedCard]   = useState<TileCard | null>(null);
    const [board, setBoard] = useState<BoardCell[]>(Array(9).fill(null));
    const [playerHand, setPlayerHand] = useState<TileCard[]>([]);
    const [enemyHand, setEnemyHand] = useState<TileCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<TileCard | null>(null);
    const [isPlayerTurn, setIsPlayerTurn] = useState(true);
    const [flipped, setFlipped] = useState<number[]>([]);
    const [lastPlaced, setLastPlaced] = useState<number | null>(null);
    const [result, setResult] = useState<"win" | "lose" | "draw" | null>(null);

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
        setFlipped(justFlipped);
        return nb;
    }

    function countScore(b: BoardCell[]) {
        return { player: b.filter((c) => c?.owner === "player").length, enemy: b.filter((c) => c?.owner === "enemy").length };
    }

    function checkEnd(b: BoardCell[], ph: TileCard[], eh: TileCard[]): boolean {
        if (!b.every((c) => c !== null) && (ph.length > 0 || eh.length > 0)) return false;
        const { player, enemy } = countScore(b);
        const r = player > enemy ? "win" : player < enemy ? "lose" : "draw";
        setResult(r);
        setPhase("result");
        if (r === "win" && !dungeonMode) updateCharacter({ ...character, ryo: character.ryo + 150 });
        return true;
    }

    function startGame() {
        if (deckPicks.length !== 5) return;
        const sortedCards = [...allCards].sort((a, b) => (b.top + b.right + b.bottom + b.left) - (a.top + a.right + a.bottom + a.left));
        const aiPool = dungeonMode
            ? tileDifficulty === "easy"
                ? sortedCards.slice(Math.max(0, sortedCards.length - Math.max(5, Math.ceil(sortedCards.length / 3))))
                : tileDifficulty === "hard"
                    ? sortedCards.slice(0, Math.max(5, Math.ceil(sortedCards.length / 4)))
                    : sortedCards.slice(0, Math.max(5, Math.ceil(sortedCards.length / 3)))
            : allCards;
        const ai = [...aiPool].sort(() => Math.random() - 0.5).slice(0, 5);
        setBoard(Array(9).fill(null));
        setPlayerHand([...deckPicks]);
        setEnemyHand(ai);
        setSelectedCard(null);
        setFlipped([]);
        setLastPlaced(null);
        setIsPlayerTurn(true);
        setResult(null);
        setPhase("game");
    }

    function placeCard(pos: number) {
        if (!isPlayerTurn || !selectedCard || board[pos] !== null) return;
        const nb = [...board]; nb[pos] = { card: selectedCard, owner: "player" };
        const afterFlip = doFlips(nb, pos, "player");
        setLastPlaced(pos);
        const newPH = playerHand.filter((c) => c !== selectedCard);
        setPlayerHand(newPH); setSelectedCard(null); setBoard(afterFlip); setIsPlayerTurn(false);
        if (checkEnd(afterFlip, newPH, enemyHand)) return;
        setTimeout(() => aiTurn(afterFlip, enemyHand, newPH), 900);
    }

    function aiTurn(b: BoardCell[], eh: TileCard[], ph: TileCard[]) {
        if (eh.length === 0) { checkEnd(b, ph, []); return; }
        const empty = b.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
        if (empty.length === 0) { checkEnd(b, ph, eh); return; }
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
        checkEnd(afterFlip, ph, newEH);
    }

    function togglePick(card: TileCard) {
        if (deckPicks.includes(card)) setDeckPicks(deckPicks.filter((c) => c !== card));
        else if (deckPicks.length < 5) setDeckPicks([...deckPicks, card]);
    }

    function CardTile({ card, owner, selected, compact }: { card: TileCard; owner?: "player" | "enemy"; selected?: boolean; compact?: boolean }) {
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
                {/* Image area with directional numbers */}
                <div style={{ position: "relative", width: "100%", height: ih, background: "#07111f", overflow: "hidden" }}>
                    {card.image
                        ? <img src={card.image} alt={card.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, opacity: 0.25 }}>🖼️</div>
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
                {/* Name / element strip */}
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

    // Collection view
    if (phase === "collection") {
        const ec: Record<string, string> = { Fire: "#ff7043", Water: "#4fc3f7", Earth: "#a1887f", Wind: "#a5d6a7", Lightning: "#fff176", Shadow: "#ba68c8", Ice: "#b0e0ff", Neutral: "#94a3b8", None: "#555" };
        const rarityOrd: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
        const rarityColor: Record<string, string> = { legendary: "#fbbf24", epic: "#ce93d8", rare: "#4fc3f7", common: "#aaa" };

        function sellCard(card: TileCard) {
            const idx = character.tileCards.indexOf(card.id);
            if (idx === -1) return;
            const updated = [...character.tileCards];
            updated.splice(idx, 1);
            updateCharacter({ ...character, tileCards: updated, ryo: character.ryo + 5 });
            setCollSelectedCard(null);
        }

        const filteredOwned = ownedCards
            .filter(c =>
                (collFilterRarity === "all" || c.rarity === collFilterRarity) &&
                (collFilterElement === "all" || c.element === collFilterElement)
            )
            .sort((a, b) => {
                if (collSortBy === "name")  return a.name.localeCompare(b.name);
                if (collSortBy === "power") return (b.top + b.right + b.bottom + b.left) - (a.top + a.right + a.bottom + a.left);
                return (rarityOrd[a.rarity] ?? 4) - (rarityOrd[b.rarity] ?? 4);
            });

        return (
            <div className="card">
                <h2>🧩 Shinobi Tiles</h2>
                <p style={{ color: "#aaa", marginBottom: "0.4rem" }}>Place cards on a 3×3 board. Arrows flip adjacent enemy cards — most cards wins.</p>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: "0.8rem", flexWrap: "wrap" }}>
                    <span>Cards owned: <strong>{ownedCards.length}</strong></span>
                    {ownedCards.length < 5 && <span style={{ color: "#ef5350", fontSize: 13 }}>Need 5 to play — buy packs in Shop</span>}
                    {ownedCards.length >= 5 && <button onClick={() => { setDeckPicks([]); setPhase("select"); }}>Build Deck &amp; Play</button>}
                </div>
                <div className="tile-card-filters">
                    <div className="tile-card-filter-group">
                        <label>Rarity</label>
                        <div className="tile-card-filter-buttons">
                            {(["all", "legendary", "epic", "rare", "common"] as const).map(r => (
                                <button key={r} type="button"
                                    className={collFilterRarity === r ? "active" : ""}
                                    onClick={() => setCollFilterRarity(r)}
                                    style={r !== "all" ? { color: rarityColor[r] } : {}}
                                >{r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}</button>
                            ))}
                        </div>
                    </div>
                    <div className="tile-card-filter-group">
                        <label>Element</label>
                        <div className="tile-card-filter-buttons">
                            {["all", "Fire", "Water", "Wind", "Earth", "Lightning", "Shadow", "Neutral", "None"].map(e => (
                                <button key={e} type="button"
                                    className={collFilterElement === e ? "active" : ""}
                                    onClick={() => setCollFilterElement(e)}
                                    style={e !== "all" ? { color: ec[e] ?? "#aaa" } : {}}
                                >{e === "all" ? "All" : e}</button>
                            ))}
                        </div>
                    </div>
                    <div className="tile-card-filter-group">
                        <label>Sort</label>
                        <div className="tile-card-filter-buttons">
                            {(["rarity", "power", "name"] as const).map(s => (
                                <button key={s} type="button"
                                    className={collSortBy === s ? "active" : ""}
                                    onClick={() => setCollSortBy(s)}
                                >{s === "rarity" ? "Rarity" : s === "power" ? "⚡ Power" : "A–Z"}</button>
                            ))}
                        </div>
                    </div>
                </div>
                {filteredOwned.length === 0
                    ? <p style={{ color: "#aaa", fontSize: 13 }}>No cards match this filter.</p>
                    : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {filteredOwned.map((card, i) => (
                                <div key={card.id + i} style={{ cursor: "pointer", position: "relative" }}
                                    onClick={() => setCollSelectedCard(card)}>
                                    <CardTile card={card} selected={collSelectedCard?.id === card.id} />
                                </div>
                            ))}
                        </div>
                    )
                }
                {collSelectedCard && (
                    <div className="summary-box tile-card-selected-detail" style={{ marginTop: 12 }}>
                        <button type="button" className="item-popup-close"
                            onClick={() => setCollSelectedCard(null)}>×</button>
                        <strong style={{ fontSize: 15 }}>{collSelectedCard.name}</strong>
                        <p style={{ fontSize: 12, margin: "4px 0 2px" }}>
                            <span style={{ color: ec[collSelectedCard.element] ?? "#aaa" }}>{collSelectedCard.element}</span>
                            {" · "}
                            <span style={{ color: rarityColor[collSelectedCard.rarity] }}>{collSelectedCard.rarity}</span>
                        </p>
                        <p style={{ fontSize: 13, fontWeight: "bold", margin: "4px 0" }}>
                            ↑{collSelectedCard.top} &nbsp; →{collSelectedCard.right} &nbsp; ↓{collSelectedCard.bottom} &nbsp; ←{collSelectedCard.left}
                            &nbsp;·&nbsp; <span style={{ color: "#facc15" }}>⚡{collSelectedCard.top + collSelectedCard.right + collSelectedCard.bottom + collSelectedCard.left} total</span>
                        </p>
                        <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{collSelectedCard.description}</p>
                        <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                            Copies owned: <strong>{ownedCards.filter(c => c.id === collSelectedCard.id).length}</strong>
                        </p>
                        <button type="button" className="danger-button" style={{ fontSize: 12 }}
                            onClick={() => sellCard(collSelectedCard)}>
                            💰 Sell 1 copy — +5 ryo
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Deck selection
    if (phase === "select") {
        if (dungeonMode && ownedCards.length < 5) {
            return (
                <div className="card cinematic-card">
                    <h2>Tile Shrine Locked</h2>
                    <p className="hint">You need at least 5 Shinobi Tile cards to complete this dungeon seal.</p>
                    <p>Cards owned: <strong>{ownedCards.length}</strong> / 5</p>
                    <button className="danger-button" onClick={onDungeonLeave}>Leave Dungeon</button>
                </div>
            );
        }
        const savedDeckCards = (character.savedTileDeck ?? [])
            .map(id => allCards.find(c => c.id === id))
            .filter(Boolean) as TileCard[];
        const hasSavedDeck = savedDeckCards.length === 5 &&
            savedDeckCards.every(c => character.tileCards.includes(c.id));

        return (
            <div className="card">
                <h2>{dungeonMode ? "Dungeon Tile Seal" : "Select 5 Cards"}</h2>
                <p style={{ marginBottom: "0.5rem" }}>Picked: <strong>{deckPicks.length} / 5</strong></p>
                <div className="menu" style={{ marginBottom: "0.5rem" }}>
                    <button onClick={startGame} disabled={deckPicks.length !== 5}>{dungeonMode ? "Challenge Shrine" : "Play"}</button>
                    <button onClick={dungeonMode ? onDungeonLeave : () => setPhase("collection")}>{dungeonMode ? "Leave Dungeon" : "Back"}</button>
                </div>
                <div className="menu" style={{ marginBottom: "1rem" }}>
                    <button
                        disabled={deckPicks.length !== 5}
                        onClick={() => updateCharacter({ ...character, savedTileDeck: deckPicks.map(c => c.id) })}
                        title="Save current 5-card deck"
                    >💾 Save Deck</button>
                    <button
                        disabled={!hasSavedDeck}
                        onClick={() => hasSavedDeck && setDeckPicks(savedDeckCards)}
                        title={hasSavedDeck ? "Load your saved deck" : "No valid saved deck"}
                    >📂 Load Deck</button>
                    {character.savedTileDeck && character.savedTileDeck.length > 0 && (
                        <button
                            className="danger-button"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => updateCharacter({ ...character, savedTileDeck: [] })}
                            title="Clear saved deck"
                        >✕ Clear</button>
                    )}
                </div>
                {character.savedTileDeck && character.savedTileDeck.length > 0 && (
                    <p style={{ fontSize: 11, color: hasSavedDeck ? "#86efac" : "#f87171", marginBottom: "0.6rem" }}>
                        {hasSavedDeck
                            ? "💾 Saved deck available — click Load Deck to use it"
                            : "⚠️ Saved deck contains cards you no longer own"}
                    </p>
                )}
                {deckPicks.length > 0 && (
                    <div style={{ marginBottom: "1rem" }}>
                        <h4>Your Deck</h4>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {deckPicks.map((c, i) => <div key={i} onClick={() => togglePick(c)} style={{ cursor: "pointer" }}><CardTile card={c} owner="player" compact /></div>)}
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
                                <CardTile card={card} owner={picked ? "player" : undefined} selected={picked} compact />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Result
    if (phase === "result") {
        const { player, enemy } = countScore(board);
        return (
            <div className="card" style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: "1.8rem", color: result === "win" ? "#a5d6a7" : result === "lose" ? "#ef5350" : "#ffe082" }}>
                    {result === "win" ? "Victory!" : result === "lose" ? "Defeated" : "Draw"}
                </h2>
                <p style={{ marginBottom: "0.5rem" }}>You <strong>{player}</strong> — Enemy <strong>{enemy}</strong></p>
                {result === "win" && !dungeonMode && <p style={{ color: "#a5d6a7", marginBottom: "0.8rem" }}>+150 ryo reward!</p>}
                {dungeonMode && result === "win" && <p style={{ color: "#a5d6a7", marginBottom: "0.8rem" }}>The second seal breaks open.</p>}
                {dungeonMode && result !== "win" && <p style={{ color: "#ef9a9a", marginBottom: "0.8rem" }}>The tile shrine refuses you.</p>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem", maxWidth: 320, margin: "0 auto 1rem" }}>
                    {board.map((cell, i) => (
                        <div key={i} style={{ background: cell?.owner === "player" ? "#0d2137" : cell?.owner === "enemy" ? "#200a0a" : "#111", border: `2px solid ${cell?.owner === "player" ? "#4fc3f7" : cell?.owner === "enemy" ? "#ef5350" : "#333"}`, borderRadius: 8, padding: 4, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {cell && <CardTile card={cell.card} owner={cell.owner} compact />}
                        </div>
                    ))}
                </div>
                <div className="menu">
                    {dungeonMode && result === "win" ? <button className="admin-button" onClick={onDungeonWin}>Continue to Final Seal</button> : <button onClick={() => { setDeckPicks([]); setPhase("select"); }}>Play Again</button>}
                    <button onClick={dungeonMode
                        // In dungeon mode the result-screen Leave button routes:
                        //   lose  → onDungeonLose (Hollow Gate uses this for -20% HP)
                        //   win   → onDungeonLeave (no penalty, just exit)
                        //   draw  → onDungeonLeave (no penalty)
                        ? (result === "lose" && onDungeonLose ? onDungeonLose : onDungeonLeave)
                        : () => setPhase("collection")
                    }>{dungeonMode ? "Leave Dungeon" : "Collection"}</button>
                </div>
            </div>
        );
    }

    // Game board
    const { player: pScore, enemy: eScore } = countScore(board);
    return (
        <div className="card">
            <h2 style={{ marginBottom: "0.3rem" }}>🀄 Shinobi Tiles</h2>
            {/* Dungeon-mode scene banner — shows the admin-generated
                opponent / table art (shrine:tile-tile-game) so the
                Hollow Gate card duel feels like an actual encounter
                instead of a vanilla card screen. */}
            {dungeonMode && dungeonSceneImage && (
                <div style={{
                    position: "relative",
                    width: "100%",
                    height: 130,
                    marginBottom: 8,
                    borderRadius: 8,
                    overflow: "hidden",
                    background: `linear-gradient(180deg, rgba(7,12,27,0.15), rgba(7,12,27,0.78)), url(${dungeonSceneImage}) center/cover no-repeat`,
                    border: "1px solid rgba(168,85,247,0.45)",
                }}>
                    <div style={{
                        position: "absolute",
                        bottom: 6,
                        left: 10,
                        color: "#e9d5ff",
                        fontSize: 12,
                        fontWeight: 600,
                        textShadow: "0 1px 4px rgba(0,0,0,0.85)",
                    }}>
                        ⛩ The shadow opponent waits across the stone table.
                    </div>
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: 13 }}>
                <span style={{ color: "#4fc3f7" }}>You: {pScore}</span>
                <span style={{ color: isPlayerTurn ? "#a5d6a7" : "#ef9a9a" }}>{isPlayerTurn ? "Your Turn" : "Enemy thinking..."}</span>
                <span style={{ color: "#ef5350" }}>Enemy: {eScore}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: "1rem" }}>
                {board.map((cell, i) => (
                    <div key={i}
                        onClick={() => placeCard(i)}
                        style={{
                            background: cell ? (cell.owner === "player" ? "rgba(13,33,55,0.6)" : "rgba(40,10,10,0.6)") : "rgba(10,10,20,0.5)",
                            border: flipped.includes(i) ? "2px solid #ffe082" : lastPlaced === i ? "2px solid #4ade80" : cell ? `2px solid ${cell.owner === "player" ? "#4fc3f7" : "#ef5350"}` : "2px dashed #2d3748",
                            borderRadius: 10, minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: isPlayerTurn && selectedCard && !cell ? "pointer" : "default",
                            transition: "border-color 0.2s, background 0.2s",
                            boxShadow: flipped.includes(i) ? "0 0 12px rgba(255,224,130,0.4)" : lastPlaced === i ? "0 0 10px rgba(74,222,128,0.3)" : "none",
                        }}>
                        {cell
                            ? <CardTile card={cell.card} owner={cell.owner} compact />
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
                        <CardTile card={card} owner="player" selected={selectedCard === card} compact />
                    </div>
                ))}
                {playerHand.length === 0 && <span style={{ color: "#555", fontSize: 12 }}>No cards remaining</span>}
            </div>
            {selectedCard && <p style={{ color: "#ffe082", fontSize: 12, marginTop: 4 }}>👆 {selectedCard.name} selected — tap a board cell to place it</p>}
        </div>
    );
}


// VillagePill moved to ./components/Pills.

// -- Shinobi Council Hall -----------------------------------------------------
// ── Clan War (new server-managed system) types + client helpers ────
// Mirror server-side ClanWar / ClanChallenge so the UI binds cleanly.
// Damage tier kept inline so the UI can show "this challenge is worth
// X HP" without round-tripping the server constants.

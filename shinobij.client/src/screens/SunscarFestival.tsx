import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0). NOTE: the dice/slot symbols
// (🦂🪙👁️⚔️🌙⭐) are gameplay data the win-check compares — left as emoji on purpose.
import { GiSun, GiDiceSixFacesSix, GiCampfire } from "react-icons/gi";
const SF_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import type { Character } from "../types/character";
import { type TileCard } from "../data/tile-cards";
import { FestivalPortrait } from "../components/Pills";
import { CardClashDuel } from "./CardClashDuel";
import { pullBlackMarket, describeReward, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP, type BlackMarketReward } from "../lib/black-market";
import { FATE_DICE_GLYPHS, rollFateDice, startMiraaWager, reportMiraaWager } from "../lib/sunscar-festival";
import { BlackMarketCrate } from "../components/BlackMarketCrate";
import festBg from "../assets/festival/fest-bg.webp";
import kaelArt from "../assets/festival/fest-kael.webp";
import miraaArt from "../assets/festival/fest-miraa.webp";
import brokerArt from "../assets/festival/fest-broker.webp";

export function SunscarFestival({
    character,
    updateCharacter,
    creatorCards,
}: {
    character: Character;
    updateCharacter: Dispatch<SetStateAction<Character | null>>;
    creatorCards: TileCard[];
}) {
    const [diceResult, setDiceResult] = useState<string[]>([]);
    const [festivalLog, setFestivalLog] = useState(
        "Kael the Sand Dealer watches you from beneath a gold mask."
    );

    // -- Card Showdown state — Miraa plays Chronicle Showdown as the wager's theatre --
    // The stake is escrowed server-side at "bet" (miraa-start → duelToken); the
    // ryo outcome is server-rolled at settle (reportMiraaWager), never decided by
    // the client card result. The match is the show; the fates decide the purse.
    type DuelPhase = "idle" | "bet" | "playing";
    const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
    const [duelBet, setDuelBet] = useState(0);
    const [duelToken, setDuelToken] = useState<string | null>(null);
    const miraaBusyRef = useRef(false);
    const kaelImage = kaelArt;
    const miraaImage = miraaArt;

    // Open a wager: escrow the stake + mint a settle token before the match.
    async function beginMiraaWager(amount: number) {
        if (miraaBusyRef.current) return;
        miraaBusyRef.current = true;
        try {
            const res = await startMiraaWager(character.name, amount);
            if (!res.ok || !res.token || !res.character) {
                setFestivalLog(`Miraa: ${res.error ?? "The wager won't hold. Try again."}`);
                return;
            }
            updateCharacter(res.character); // reflect the escrowed stake immediately
            setDuelBet(amount);
            setDuelToken(res.token);
            setDuelPhase("playing");
        } finally {
            miraaBusyRef.current = false;
        }
    }

    // -- Black Market gamble (server-authoritative ryo sink) --
    const [bmBusy, setBmBusy] = useState(false);
    const bmBusyRef = useRef(false);
    const [bmUsed, setBmUsed] = useState<number | null>(null);
    const [bmReveal, setBmReveal] = useState<BlackMarketReward | null>(null);
    const [diceBusy, setDiceBusy] = useState(false);
    const diceBusyRef = useRef(false);

    async function pullBlackMarketGamble() {
        if (bmBusyRef.current) return;
        if (character.ryo < BLACK_MARKET_COST) {
            setFestivalLog(`The Broker: "${BLACK_MARKET_COST.toLocaleString()} ryo buys a pull. Come back when your purse is heavier."`);
            return;
        }
        // No confirm() gate — the pull goes straight to the tap-to-open crate reveal.
        bmBusyRef.current = true;
        setBmBusy(true);
        try {
            const res = await pullBlackMarket(character.name);
            if (!res.ok || !res.reward || !res.character) {
                if (typeof res.dailyUsed === "number") setBmUsed(res.dailyUsed);
                setFestivalLog(`The Broker: ${res.error ?? "Not today."}`);
                return;
            }
            const reward = res.reward;
            updateCharacter(res.character);
            if (typeof res.dailyUsed === "number") setBmUsed(res.dailyUsed);
            setBmReveal(reward); // tap-to-open crate reveal
            const flourish = reward.tier === "jackpot" ? "💥 " : "";
            setFestivalLog(`The Broker: ${flourish}${reward.label} — ${describeReward(reward)}. (${res.dailyUsed ?? "?"}/${res.dailyCap ?? BLACK_MARKET_DAILY_CAP} pulls today)`);
        } finally {
            bmBusyRef.current = false;
            setBmBusy(false);
        }
    }

    async function rollDice() {
        if (diceBusyRef.current) return;
        diceBusyRef.current = true;
        setDiceBusy(true);
        try {
            const res = await rollFateDice(character.name);
            if (!res.ok || !res.reward || !res.roll || !res.character) {
                setFestivalLog(`Kael: ${res.error ?? "The dice refuse to roll."}`);
                return;
            }
            updateCharacter(res.character);
            setDiceResult(res.roll.map((symbol) => FATE_DICE_GLYPHS[symbol]));
            const parts = [
                res.reward.boneCharms > 0 && `+${res.reward.boneCharms} Bone Charms`,
                res.reward.fateShards > 0 && `+${res.reward.fateShards} Fate Shards`,
                res.reward.auraStones > 0 && `+${res.reward.auraStones} Aura Stones`,
                res.reward.ryo > 0 && `+${res.reward.ryo} ryo`,
                (res.reward.statPoints ?? 0) > 0 && `+${res.reward.statPoints} stat points`,
                res.reward.stamina > 0 && `+${res.reward.stamina} stamina`,
            ].filter(Boolean).join(", ");
            setFestivalLog(`Kael: ${res.message ?? "The dice settle."} ${parts}. (${res.dailyUsed ?? "?"}/${res.dailyCap ?? 5} spins today)`);
        } finally {
            diceBusyRef.current = false;
            setDiceBusy(false);
        }
    }

    // -- Chronicle Showdown wager vs Miraa ---------------------------------------
    if (duelPhase === "bet") {
        return (
            <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
                <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.4rem" }}>🔮</div>
                <h2 style={{ textAlign: "center", marginBottom: "0.2rem" }}>Miraa the Card Seer</h2>
                <p style={{ color: "#aaa", textAlign: "center", marginBottom: "0.6rem" }}>"The cards are a mirror of fate, not skill. Lay down your ryo — fortune favors the few."</p>
                <p style={{ color: "#7a6", textAlign: "center", fontSize: "0.85rem", marginBottom: "1rem" }}>Your stake is placed when you sit down. Most who wager walk away lighter — win, and the pot doubles.</p>
                <p style={{ marginBottom: "0.8rem" }}>Your ryo: <strong>{character.ryo}</strong></p>
                <div className="menu" style={{ flexDirection: "column", gap: "0.5rem" }}>
                    {[50, 100, 250, 500].map((amount) => (
                        <button key={amount}
                            disabled={character.ryo < amount}
                            onClick={() => void beginMiraaWager(amount)}>
                            Bet {amount} ryo — win {amount * 2} ryo
                        </button>
                    ))}
                </div>
                <button style={{ marginTop: "1rem" }} onClick={() => setDuelPhase("idle")}>Leave</button>
            </div>
        );
    }

    if (duelPhase === "playing") {
        // Settle the escrowed wager. A played-out match (win/lose/draw on the
        // board) rolls the fates server-side; leaving mid-match forfeits the stake.
        // The board result never decides the ryo — only the server roll does.
        const settle = async (forfeit: boolean) => {
            const token = duelToken;
            setDuelPhase("idle");
            setDuelToken(null);
            if (!token) {
                setFestivalLog("Miraa: that wager was already settled.");
                return;
            }
            const res = await reportMiraaWager(character.name, token, forfeit);
            if (!res.ok || !res.character) {
                setFestivalLog(`Miraa: ${res.error ?? "The verdict slips into the sand. Refresh before retrying."}`);
                return;
            }
            updateCharacter(res.character);
            const bet = res.bet ?? duelBet;
            const log =
                res.outcome === "win" ? `"The fates read in your favor." You win ${bet * 2} ryo.`
                : res.outcome === "forfeit" ? `"You fold — the wager is mine." You forfeit ${bet} ryo.`
                : `"The desert claims its due." You lose ${bet} ryo.`;
            setFestivalLog(`Miraa: ${log}`);
        };
        return (
            <CardClashDuel
                character={character}
                creatorCards={creatorCards}
                tileDifficulty="normal"
                onDungeonWin={() => void settle(false)}
                onDungeonLose={() => void settle(false)}
                onDungeonDraw={() => void settle(false)}
                onDungeonLeave={() => void settle(true)}
            />
        );
    }

    return (
        <div className="sunscar-festival">
            {bmReveal && <BlackMarketCrate reward={bmReveal} onClose={() => setBmReveal(null)} />}
            <div
                className="sunscar-hero"
                style={{
                    backgroundImage: `linear-gradient(rgba(10,8,20,0.55), rgba(10,8,20,0.78)), url(${festBg})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                }}
            >
                <h1><GiSun style={SF_ICON} />Sunscar Festival</h1>
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
                    <h2><GiDiceSixFacesSix style={SF_ICON} />Dice of Fate</h2>

                    <div className="dice-row">
                        {(diceResult.length ? diceResult : ["🎲", "🎲", "🎲"]).map((die, index) => (
                            <div className="fate-die" key={index}>{die}</div>
                        ))}
                    </div>

                    <button className="sunscar-roll-button" onClick={rollDice} disabled={diceBusy}>
                        {diceBusy ? "Rolling..." : "Roll Dice of Fate"}
                    </button>

                    <div className="sunscar-log">{festivalLog}</div>
                </section>

                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={miraaImage} icon="🃏" name="Miraa the Card Seer" />
                    <h2>Miraa the Card Seer</h2>
                    <p style={{ fontStyle: "italic", color: "#aaa", marginBottom: "0.5rem" }}>
                        "The cards remember every shinobi who has sat across from me. Most don't return."
                    </p>
                    <p style={{ marginBottom: "0.5rem" }}>Sit for a <strong>Shinobi Chronicle Showdown</strong> and wager on the fates. Win, and the pot doubles.</p>
                    <button onClick={() => setDuelPhase("bet")} style={{ marginTop: "0.5rem" }}>Challenge Miraa</button>
                </section>

                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={brokerArt} icon="🎴" name="The Broker" />
                    <h2>The Broker — Black Market</h2>
                    <p style={{ fontStyle: "italic", color: "#aaa", marginBottom: "0.5rem" }}>
                        "Everything's for sale beneath the dunes. Most walk away poorer. A rare few… don't."
                    </p>
                    <p style={{ marginBottom: "0.3rem" }}><strong>Cost:</strong> {BLACK_MARKET_COST.toLocaleString()} ryo per pull · up to {BLACK_MARKET_DAILY_CAP}/day</p>
                    <p style={{ marginBottom: "0.5rem" }}><strong>Your Ryo:</strong> {character.ryo.toLocaleString()}{bmUsed !== null ? ` · ${bmUsed}/${BLACK_MARKET_DAILY_CAP} pulls today` : ""}</p>
                    <button
                        onClick={pullBlackMarketGamble}
                        disabled={bmBusy || character.ryo < BLACK_MARKET_COST || (bmUsed !== null && bmUsed >= BLACK_MARKET_DAILY_CAP)}>
                        {bmBusy ? "Dealing…" : "Buy a Black Market Pull"}
                    </button>
                </section>

                <section className="sunscar-card">
                    <h2>Festival Grounds</h2>
                    <div className="festival-visual">
                        <span><GiCampfire /></span>
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

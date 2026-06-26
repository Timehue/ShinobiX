import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Character } from "../types/character";
import { type TileCard } from "../data/tile-cards";
import { FestivalPortrait } from "../components/Pills";
import { currentDateKey } from "../lib/utils";
import { effectiveCharacterXpGain } from "../lib/progression";
import { gainXp } from "../App";
import { CardClashDuel } from "./CardClashDuel";
import { pullBlackMarket, describeReward, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP, type BlackMarketReward } from "../lib/black-market";
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

    // -- Card Duel state — Miraa now plays Shinobi Card Clash for a ryo wager --
    type DuelPhase = "idle" | "bet" | "playing";
    const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
    const [duelBet, setDuelBet] = useState(0);
    const kaelImage = kaelArt;
    const miraaImage = miraaArt;

    // -- Black Market gamble (server-authoritative ryo sink) --
    const [bmBusy, setBmBusy] = useState(false);
    const [bmUsed, setBmUsed] = useState<number | null>(null);
    const [bmReveal, setBmReveal] = useState<BlackMarketReward | null>(null);

    async function pullBlackMarketGamble() {
        if (bmBusy) return;
        if (character.ryo < BLACK_MARKET_COST) {
            setFestivalLog(`The Broker: "${BLACK_MARKET_COST.toLocaleString()} ryo buys a pull. Come back when your purse is heavier."`);
            return;
        }
        // No confirm() gate — the pull goes straight to the tap-to-open crate reveal.
        setBmBusy(true);
        const res = await pullBlackMarket(character.name);
        setBmBusy(false);
        if (!res.ok || !res.reward) {
            if (typeof res.dailyUsed === "number") setBmUsed(res.dailyUsed);
            setFestivalLog(`The Broker: ${res.error ?? "Not today."}`);
            return;
        }
        const reward = res.reward;
        // Server already debited the cost + credited the payout. Apply the same
        // net delta locally so the autosave converges.
        updateCharacter(prev => prev ? ({
            ...prev,
            ryo: prev.ryo - (res.cost ?? BLACK_MARKET_COST) + reward.ryo,
            fateShards: (prev.fateShards ?? 0) + reward.fateShards,
            boneCharms: (prev.boneCharms ?? 0) + reward.boneCharms,
            auraStones: (prev.auraStones ?? 0) + reward.auraStones,
            mythicSeals: (prev.mythicSeals ?? 0) + reward.mythicSeals,
        }) : prev);
        if (typeof res.dailyUsed === "number") setBmUsed(res.dailyUsed);
        setBmReveal(reward); // tap-to-open crate reveal
        const flourish = reward.tier === "jackpot" ? "💥 " : "";
        setFestivalLog(`The Broker: ${flourish}${reward.label} — ${describeReward(reward)}. (${res.dailyUsed ?? "?"}/${res.dailyCap ?? BLACK_MARKET_DAILY_CAP} pulls today)`);
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

    // -- Card Clash wager vs Miraa --------------------------------------------
    if (duelPhase === "bet") {
        return (
            <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
                <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.4rem" }}>🔮</div>
                <h2 style={{ textAlign: "center", marginBottom: "0.2rem" }}>Miraa the Card Seer</h2>
                <p style={{ color: "#aaa", textAlign: "center", marginBottom: "1rem" }}>"Place your wager and we shall clash. The winner takes the pot."</p>
                <p style={{ marginBottom: "0.8rem" }}>Your ryo: <strong>{character.ryo}</strong></p>
                <div className="menu" style={{ flexDirection: "column", gap: "0.5rem" }}>
                    {[50, 100, 250, 500].map((amount) => (
                        <button key={amount}
                            disabled={character.ryo < amount}
                            onClick={() => { setDuelBet(amount); setDuelPhase("playing"); }}>
                            Bet {amount} ryo — win {amount * 2} ryo
                        </button>
                    ))}
                </div>
                <button style={{ marginTop: "1rem" }} onClick={() => setDuelPhase("idle")}>Leave</button>
            </div>
        );
    }

    if (duelPhase === "playing") {
        const settle = (delta: number, log: string) => {
            if (delta !== 0) updateCharacter({ ...character, ryo: character.ryo + delta });
            setFestivalLog(`Miraa: ${log}`);
            setDuelPhase("idle");
        };
        return (
            <CardClashDuel
                character={character}
                creatorCards={creatorCards}
                tileDifficulty="normal"
                onDungeonWin={() => settle(duelBet * 2, `"You read the sands well." You win ${duelBet * 2} ryo.`)}
                onDungeonLose={() => settle(-duelBet, `"The desert claims the weak." You lose ${duelBet} ryo.`)}
                onDungeonDraw={() => settle(0, `"Even fate blinks." A draw — your ${duelBet} ryo is returned.`)}
                onDungeonLeave={() => settle(-duelBet, `"You fold — the wager is mine." You forfeit ${duelBet} ryo.`)}
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
                    <p style={{ marginBottom: "0.5rem" }}>Challenge Miraa to <strong>Shinobi Card Clash</strong>. Bet ryo — winner takes double.</p>
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

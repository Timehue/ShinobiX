import { useRef, useState } from "react";
// Compact local chrome glyphs. NOTE: the dice/slot symbols
// (🦂🪙👁️⚔️🌙⭐) are gameplay data the win-check compares — left as emoji on purpose.
import { GiSun, GiDiceSixFacesSix, GiCampfire } from "../components/icons/LightweightGameIcons";
const SF_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import type { Character, VersionedCharacterCommit } from "../types/character";
import { type TileCard } from "../data/tile-cards";
import { FestivalPortrait } from "../components/Pills";
import { CardClashDuel } from "./CardClashDuel";
import { pullBlackMarket, describeReward, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP, type BlackMarketReward } from "../lib/black-market";
import { FATE_DICE_GLYPHS, rollFateDice } from "../lib/sunscar-festival";
import { BlackMarketCrate } from "../components/BlackMarketCrate";
import festBg from "../assets/festival/fest-bg.webp";
import kaelArt from "../assets/festival/fest-kael.webp";
import miraaArt from "../assets/festival/fest-miraa.webp";
import brokerArt from "../assets/festival/fest-broker.webp";

export function SunscarFestival({
    character,
    onVersionedCharacter,
    creatorCards,
}: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
    creatorCards: TileCard[];
}) {
    const [diceResult, setDiceResult] = useState<string[]>([]);
    const [festivalLog, setFestivalLog] = useState(
        "Kael taps three dice against the table and nods at the empty stool."
    );

    // -- Card Showdown vs Miraa — UNSTAKED --
    // Miraa used to take an even-money ryo wager here and settle it from a
    // server-rolled die. The bet was removed 2026-09-03 for the Play content
    // rating, so the match is free: nothing is escrowed, nothing is paid out,
    // and leaving early costs nothing. There is no token and no settle call.
    type DuelPhase = "idle" | "playing";
    const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
    const kaelImage = kaelArt;
    const miraaImage = miraaArt;

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
            if (!onVersionedCharacter(res.character, res._saveVersion)) return;
            if (typeof res.dailyUsed === "number") setBmUsed(res.dailyUsed);
            setBmReveal(reward); // tap-to-open crate reveal
            const flourish = reward.tier === "jackpot" ? "💥 " : "";
            setFestivalLog(`The Broker: ${flourish}${reward.label}. ${describeReward(reward)}. (${res.dailyUsed ?? "?"}/${res.dailyCap ?? BLACK_MARKET_DAILY_CAP} pulls today)`);
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
            if (!onVersionedCharacter(res.character, res._saveVersion)) return;
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

    // -- Chronicle Showdown vs Miraa (free play) ---------------------------------
    if (duelPhase === "playing") {
        // No stake, no payout, no forfeit penalty — the board result is the whole
        // result. Every exit path (win, lose, draw, leave) just returns to the
        // festival with a line of flavour.
        const finish = (log: string) => {
            setDuelPhase("idle");
            setFestivalLog(`Miraa: ${log}`);
        };
        return (
            <CardClashDuel
                character={character}
                creatorCards={creatorCards}
                tileDifficulty="normal"
                onDungeonWin={() => finish("“The white mark. Well played — this table remembers a clean hand.”")}
                onDungeonLose={() => finish("“The black mark this time. Sit again whenever you like; it costs you nothing.”")}
                onDungeonDraw={() => finish("“Even. The cards liked neither of us today.”")}
                onDungeonLeave={() => finish("“Leaving early? No matter — there is no stake for me to keep.”")}
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
                    Sector 35 hosts a caravan festival that never packed up: lanterns,
                    sandstone courts, Chronicle tables, and three well-worn dice.
                </p>
            </div>

            <div className="sunscar-grid">
                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={kaelImage} icon="🎲" name="Kael the Sand Dealer" />
                    <h2>Kael the Sand Dealer</h2>
                    <p>
                        "Three dice. Five turns a day. Blame the table after that and it charges extra."
                    </p>
                    <p><strong>Entry Cost:</strong> Free — five draws a day, and every draw pays</p>
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
                        "The scribes record great battles. I use those records to keep your hands busy. Sit down — I am not taking your ryo today."
                    </p>
                    <p style={{ marginBottom: "0.5rem" }}>Sit for a <strong>Shinobi Chronicle Showdown</strong>. The match is free: nothing is staked, nothing is owed, and you may leave whenever you like.</p>
                    <button onClick={() => setDuelPhase("playing")} style={{ marginTop: "0.5rem" }}>Challenge Miraa</button>
                </section>

                <section className="sunscar-card npc-card">
                    <FestivalPortrait image={brokerArt} icon="🎴" name="The Broker" />
                    <h2>The Broker — Black Market</h2>
                    <p style={{ fontStyle: "italic", color: "#aaa", marginBottom: "0.5rem" }}>
                        "Seventy-five thousand buys one sealed crate. You may complain about the price after you open it."
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

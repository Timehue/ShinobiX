import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import { getAllTileCards } from "../data/tile-cards";
import {
    buildChronicleDeck,
    chronicleAiAction,
    displayCardsById,
    startChronicleAi,
    type ChronicleAiDifficulty,
    type ChronicleProjection,
} from "../lib/chronicle-duel";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import "../styles/chronicle-duel.css";

type TileDifficulty = "easy" | "normal" | "hard";
const ENCOUNTER_AI_DIFFICULTY: Record<TileDifficulty, ChronicleAiDifficulty> = {
    easy: "easy",
    normal: "medium",
    hard: "hard",
};

/** Current-rules PvE host. Encounter callers retain ownership of their reward, HP,
 * torch and seal consequences; the duel server owns every card-game decision. */
export function CardClashDuel({
    character, creatorCards, tileDifficulty = "normal", dungeonSceneImage,
    opponentAvatar, onDungeonWin, onDungeonLose, onDungeonDraw, onDungeonLeave,
}: {
    character: Character;
    creatorCards: TileCard[];
    tileDifficulty?: TileDifficulty;
    dungeonSceneImage?: string;
    opponentAvatar?: string;
    onDungeonWin: () => void;
    onDungeonLose?: () => void;
    onDungeonDraw?: () => void;
    onDungeonLeave: () => void;
}) {
    const cardsById = useMemo(() => displayCardsById(getAllTileCards(creatorCards)), [creatorCards]);
    const deck = useMemo(() => buildChronicleDeck(character.cardClashDeck ?? [], character.tileCards ?? []), [character.cardClashDeck, character.tileCards]);
    const [matchId, setMatchId] = useState("");
    const [duel, setDuel] = useState<ChronicleProjection | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(true);
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void startChronicleAi(character.name, deck, ENCOUNTER_AI_DIFFICULTY[tileDifficulty], true).then((result) => {
            setBusy(false);
            if (!result.ok || !result.matchId || !result.session) setError(result.error ?? "Could not prepare the sealed duel.");
            else { setMatchId(result.matchId); setDuel(result.session); }
        });
    }, [character.name, deck, tileDifficulty]);

    async function act(intent: Parameters<typeof chronicleAiAction>[1]) {
        if (!matchId || busy) return;
        setBusy(true); setError("");
        const result = await chronicleAiAction(matchId, intent);
        setBusy(false);
        if (!result.ok || !result.session) setError(result.error ?? "That action was not legal.");
        else setDuel(result.session);
    }

    function resolve() {
        if (duel && duel.winner === duel.viewerSide) onDungeonWin();
        else if (duel?.winner === "draw") (onDungeonDraw ?? onDungeonLose ?? onDungeonLeave)();
        else (onDungeonLose ?? onDungeonLeave)();
    }

    const done = duel?.status === "complete";
    const won = Boolean(done && duel && duel.winner === duel.viewerSide);
    const draw = done && duel.winner === "draw";
    const sceneStyle = dungeonSceneImage ? { "--chronicle-scene": `url(${dungeonSceneImage})` } as CSSProperties : undefined;

    return <main className="chronicle-shell chronicle-encounter" style={sceneStyle}>
        <header className="chronicle-header">
            <button onClick={onDungeonLeave} disabled={busy}>Leave Duel</button>
            <h1>Shinobi Chronicle Duel<small>{tileDifficulty === "hard" ? "Sealed Encounter · Hard" : tileDifficulty === "easy" ? "Sealed Encounter · Easy" : "Sealed Encounter · Medium"}</small></h1>
        </header>
        {busy && !duel ? <section className="chronicle-panel"><h2>Preparing the table</h2><p>The server is validating the 40-card decks.</p></section> : null}
        {error && !duel ? <section className="chronicle-panel"><div className="chronicle-error" role="alert">{error}</div><button onClick={onDungeonLeave}>Leave encounter</button></section> : null}
        {done ? <section className="chronicle-panel" style={{ marginBottom: 12, textAlign: "center" }}><h2>{won ? "Seal Claimed" : draw ? "Draw — Seal Holds" : "Seal Holds"}</h2><p>{won ? "You won the Chronicle Duel." : draw ? "A draw is not enough to break the seal." : "The Chronicle Keeper won the duel."}</p><button onClick={resolve}>Continue</button></section> : null}
        {duel ? <ChronicleDuelBoard state={duel} cardsById={cardsById} playerAvatar={character.avatarImage} opponentAvatar={opponentAvatar} busy={busy} error={error} onAction={(intent) => void act(intent)} /> : null}
    </main>;
}

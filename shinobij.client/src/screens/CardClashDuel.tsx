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
    type ChronicleAiResult,
    type ChronicleProjection,
} from "../lib/chronicle-duel";
import { chronicleDuelistAvatar } from "../lib/chronicle-duelist-art";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import "../styles/chronicle-duel.css";

// Same replay pacing the Card Hall uses: a full beat per logged Keeper move,
// a quiet beat for silent phase bookkeeping.
const AI_STEP_BEAT_MS = 1_250;
const AI_STEP_QUIET_MS = 650;

type TileDifficulty = "easy" | "normal" | "hard";
const ENCOUNTER_AI_DIFFICULTY: Record<TileDifficulty, ChronicleAiDifficulty> = {
    easy: "easy",
    normal: "medium",
    hard: "hard",
};

/** Current-rules PvE host. Encounter callers retain ownership of their reward, HP,
 * torch and seal consequences; the showdown server owns every card-game decision. */
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
    const [aiActing, setAiActing] = useState(false);
    const started = useRef(false);
    const replayToken = useRef(0);
    useEffect(() => () => { replayToken.current += 1; }, []);

    /** Replay the Keeper's captured moves one beat at a time, then settle. */
    async function presentSession(result: ChronicleAiResult) {
        const final = result.session;
        if (!final) return;
        const steps = result.aiSteps ?? [];
        const token = ++replayToken.current;
        if (steps.length > 0) {
            setAiActing(true);
            let previousLast = duel?.log.at(-1);
            for (const step of steps) {
                setDuel(step);
                const beat = step.log.at(-1) !== previousLast ? AI_STEP_BEAT_MS : AI_STEP_QUIET_MS;
                await new Promise<void>((resolve) => window.setTimeout(resolve, beat));
                if (replayToken.current !== token) return;
                previousLast = step.log.at(-1);
            }
            setAiActing(false);
        }
        setDuel(final);
    }

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        void startChronicleAi(character.name, deck, ENCOUNTER_AI_DIFFICULTY[tileDifficulty], true).then(async (result) => {
            if (!result.ok || !result.matchId || !result.session) { setBusy(false); setError(result.error ?? "Could not prepare the sealed showdown."); return; }
            setMatchId(result.matchId);
            await presentSession(result);
            setBusy(false);
        });
        // presentSession is stable for the one-shot start effect
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.name, deck, tileDifficulty]);

    async function act(intent: Parameters<typeof chronicleAiAction>[1]) {
        if (!matchId || busy) return;
        setBusy(true); setError("");
        const result = await chronicleAiAction(matchId, intent);
        if (!result.ok || !result.session) { setBusy(false); setError(result.error ?? "That action was not legal."); return; }
        await presentSession(result);
        setBusy(false);
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
    // Encounter hosts don't pass an avatar, so the Keeper resolves its own.
    const foeName = duel ? duel[duel.viewerSide === "p1" ? "p2" : "p1"].name : "";

    return <main className={`chronicle-shell chronicle-encounter ${duel?.status === "active" ? "chronicle-shell--duel-active" : ""}`} style={sceneStyle}>
        <header className="chronicle-header">
            <button onClick={onDungeonLeave} disabled={busy}>Leave Showdown</button>
            <h1>Shinobi Chronicle Showdown<small>{tileDifficulty === "hard" ? "Sealed Encounter · Hard" : tileDifficulty === "easy" ? "Sealed Encounter · Easy" : "Sealed Encounter · Medium"}</small></h1>
        </header>
        {busy && !duel ? <section className="chronicle-panel"><h2>Preparing the table</h2><p>The server is validating the 40-card decks.</p></section> : null}
        {error && !duel ? <section className="chronicle-panel"><div className="chronicle-error" role="alert">{error}</div><button onClick={onDungeonLeave}>Leave encounter</button></section> : null}
        {done ? <section className="chronicle-panel" style={{ marginBottom: 12, textAlign: "center" }}><h2>{won ? "Seal Claimed" : draw ? "Draw — Seal Holds" : "Seal Holds"}</h2><p>{won ? "You won the Chronicle Showdown." : draw ? "A draw is not enough to break the seal." : "The Chronicle Keeper won the showdown."}</p><button onClick={resolve}>Continue</button></section> : null}
        {duel ? <ChronicleDuelBoard key={matchId || "duel"} state={duel} cardsById={cardsById} playerAvatar={character.avatarImage} opponentAvatar={opponentAvatar ?? chronicleDuelistAvatar(foeName)} busy={busy} aiActing={aiActing} error={error} onExit={onDungeonLeave} exitLabel="Leave encounter" onAction={(intent) => void act(intent)} /> : null}
    </main>;
}
